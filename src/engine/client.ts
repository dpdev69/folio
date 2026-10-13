import { pushSse, unwrapEvent } from "./sse";

export type EngineAuth = { username: string; password: string };

export type SessionInfo = {
  id: string;
  title?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
};

export type TranscriptMessage = {
  info: { id: string; role?: string; sessionID?: string };
  parts: unknown[];
};

/**
 * A small client for the subset of `opencode serve` Folio actually uses.
 * Types are pinned to the OpenAPI documented at https://opencode.ai/docs/server/
 * (sessions, prompt_async, /global/event, diff, revert, permissions).
 * The server moves quickly; unknown event shapes are ignored by the reducer.
 */
export class EngineClient {
  constructor(
    private baseUrl: string,
    private opts: { directory?: string; auth?: EngineAuth } = {},
  ) {}

  get directory(): string | undefined {
    return this.opts.directory;
  }

  async health(): Promise<{ healthy: boolean; version: string }> {
    return this.request("GET", "/global/health");
  }

  async sessions(): Promise<SessionInfo[]> {
    const data = await this.request<unknown>("GET", "/session");
    return Array.isArray(data) ? (data as SessionInfo[]) : [];
  }

  async createSession(body: { title?: string; permission?: { permission: string; pattern: string; action: string }[] }): Promise<SessionInfo> {
    try {
      return await this.request("POST", "/session", body);
    } catch (error) {
      if (!body.permission) throw error;
      return this.request("POST", "/session", { title: body.title });
    }
  }

  async messages(sessionId: string): Promise<TranscriptMessage[]> {
    const data = await this.request<unknown>("GET", `/session/${sessionId}/message`);
    return Array.isArray(data) ? (data as TranscriptMessage[]) : [];
  }

  async prompt(sessionId: string, text: string, system: string): Promise<void> {
    await this.request("POST", `/session/${sessionId}/prompt_async`, {
      parts: [{ type: "text", text }],
      system,
    });
  }

  async revert(sessionId: string, messageID: string): Promise<void> {
    await this.request("POST", `/session/${sessionId}/revert`, { messageID });
  }

  async permission(sessionId: string, permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    await this.request("POST", `/session/${sessionId}/permissions/${permissionId}`, { response });
  }

  async abort(sessionId: string): Promise<void> {
    await this.request("POST", `/session/${sessionId}/abort`);
  }

  async providers(): Promise<{ connected: string[]; default: Record<string, string> }> {
    const data = await this.request<unknown>("GET", "/provider");
    const record = data && typeof data === "object" ? (data as { connected?: unknown; default?: unknown }) : {};
    return {
      connected: Array.isArray(record.connected) ? record.connected.filter((item): item is string => typeof item === "string") : [],
      default: record.default && typeof record.default === "object" ? (record.default as Record<string, string>) : {},
    };
  }

  async providerAuth(): Promise<Record<string, { type?: string; label?: string }[]>> {
    const data = await this.request<unknown>("GET", "/provider/auth");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data as Record<string, { type?: string; label?: string }[]>;
  }

  /** Stores a provider key in opencode. Folio does not keep a copy. */
  async setApiKey(providerId: string, key: string): Promise<void> {
    await this.request("PUT", `/auth/${encodeURIComponent(providerId)}`, { type: "api", key });
  }

  async diff(sessionId: string): Promise<unknown[]> {
    const data = await this.request<unknown>("GET", `/session/${sessionId}/diff`);
    return Array.isArray(data) ? data : [];
  }

  subscribe(onEvent: (event: { type?: string; properties?: Record<string, unknown> }) => void, signal: AbortSignal): void {
    void this.pump(onEvent, signal);
  }

  private async pump(
    onEvent: (event: { type?: string; properties?: Record<string, unknown> }) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await this.openStream(signal);
        attempt = 0;
        await readSse(response, onEvent, signal);
      } catch (error) {
        if (signal.aborted) return;
        attempt += 1;
        if (attempt === 1) onEvent({ type: "folio.stream-paused", properties: { message: errorText(error) } });
        await sleep(Math.min(4000, 400 * attempt), signal);
      }
    }
  }

  private async openStream(signal: AbortSignal): Promise<Response> {
    const headers = this.headers();
    let response = await fetch(this.url("/global/event"), { headers, signal });
    if (response.status === 404) response = await fetch(this.url("/event"), { headers, signal });
    if (!response.ok || !response.body) {
      throw new Error(`Event stream failed (${response.status}).`);
    }
    return response;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.url(path), {
      method,
      headers: this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok) throw new Error(errorText(data) || response.statusText || "The press refused the request.");
    return data as T;
  }

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    const join = `${base}${path}`;
    if (!this.opts.directory) return join;
    const sep = join.includes("?") ? "&" : "?";
    return `${join}${sep}directory=${encodeURIComponent(this.opts.directory)}`;
  }

  private headers(json = false): Headers {
    const headers = new Headers();
    if (json) headers.set("Content-Type", "application/json");
    if (this.opts.directory) headers.set("x-opencode-directory", this.opts.directory);
    if (this.opts.auth) {
      const token = btoa(`${this.opts.auth.username}:${this.opts.auth.password}`);
      headers.set("Authorization", `Basic ${token}`);
    }
    return headers;
  }
}

export const PRESS_SYSTEM = [
  "You are writing a chapter in Folio, a book-skinned coding assistant.",
  "Write calm, complete prose paragraphs, the way a careful engineer writes a letter.",
  "Do not use markdown headings, bullet lists, or fenced code blocks.",
  "When you change files or run commands, use your tools and then mention the result in a sentence.",
  "The interface sets tool calls as footnotes and diffs as plates, so do not paste diffs into the prose.",
].join(" ");

async function readSse(
  response: Response,
  onEvent: (event: { type?: string; properties?: Record<string, unknown> }) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = pushSse(rest, decoder.decode(value, { stream: true }));
    rest = parsed.rest;
    for (const event of parsed.events) {
      if (event && typeof event === "object") onEvent(unwrapEvent(event));
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 240) };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; data?: { message?: unknown } };
    if (typeof record.data?.message === "string") return record.data.message;
    if (typeof record.message === "string") return record.message;
  }
  return "The press could not be reached.";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
