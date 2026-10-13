import { backoffDelay, pushSse, unwrapEvent, watchdog, type EventFrame } from "./sse";

/** A session as `GET /api/session` lists it (opencode 2.0). */
export type SessionInfo = {
  id: string;
  title?: string;
  parentID?: string;
  location?: { directory?: string };
  model?: ModelRef;
  time?: { created?: number; updated?: number; idle?: number };
};

export type ModelRef = { providerID: string; id: string };

export type ModelInfo = ModelRef & { name?: string };

export type ProviderInfo = { id: string; name?: string; integrationID?: string };

export type IntegrationInfo = {
  id: string;
  name?: string;
  methods?: { type?: string; label?: string }[];
  connections?: unknown[];
};

export type PermissionRule = { action: string; resource: string; effect: "allow" | "deny" | "ask" };

export type FileDiff = { file: string; patch?: string; additions?: number; deletions?: number; status?: string };

export type FormAnswer = Record<string, string | number | boolean | string[]>;

/** What the shell or the dev host can do when the press cannot. */
export type FileHost = {
  writeFile?: (directory: string, path: string, content: string) => Promise<void>;
  readFile?: (directory: string, path: string) => Promise<string>;
};

export type EngineOptions = {
  password: string;
  /** Default location for location-scoped routes (providers, models, integrations). */
  directory?: string;
  host?: FileHost;
  /** Per-request timeout; the event stream has none. */
  timeoutMs?: number;
  stream?: {
    /** A stream that sends nothing, not even a heartbeat, for this long is dropped. */
    silenceMs?: number;
    retryDelay?: (attempt: number) => number;
  };
};

/** A refused or failed call, worded for the reader. `status` is 0 when nothing answered. */
export class EngineError extends Error {
  constructor(
    readonly status: number,
    readonly tag: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export const PRESS_STYLE = [
  "You are writing a chapter in Folio, a book-skinned coding assistant.",
  "Write calm, complete prose paragraphs, the way a careful engineer writes a letter.",
  "Do not use markdown headings, bullet lists, or fenced code blocks.",
  "When you change files or run commands, use your tools and then mention the result in a sentence.",
  "The interface sets tool calls as footnotes and diffs as plates, so do not paste diffs into the prose.",
].join(" ");

type Query = Record<string, string | undefined>;
/** `raw` sends a body as bytes; `text` reads the answer as text, whatever its type. */
type Call = { query?: Query; body?: unknown; raw?: string; text?: boolean };

const MAX_SESSIONS = 200;
const MAX_PAGES = 50;

/**
 * The part of the opencode 2.0 server Folio uses. Every call carries Basic
 * auth (`opencode:<password>`) and a timeout; JSON answers are unwrapped from
 * `{data}`; failures become an `EngineError` with a calm sentence.
 */
export class EngineClient {
  private version?: string;
  private readonly auth: string;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: EngineOptions,
  ) {
    this.auth = `Basic ${base64(`opencode:${opts.password}`)}`;
  }

  get directory(): string | undefined {
    return this.opts.directory;
  }

  async info(): Promise<{ version: string }> {
    const info = await this.request<{ version?: unknown }>("GET", "/api/info");
    const version = typeof info?.version === "string" ? info.version : "";
    if (version) this.version = version;
    return { version };
  }

  /** Root sessions bound to a folder, across every page, up to 200. */
  async sessions(directory: string): Promise<SessionInfo[]> {
    const out: SessionInfo[] = [];
    await this.pages<SessionInfo>("/api/session", { directory, limit: "100" }, (page) => {
      out.push(...page);
      return out.length < MAX_SESSIONS;
    });
    return out.filter((s) => s && typeof s.id === "string" && !s.parentID).slice(0, MAX_SESSIONS);
  }

  async createSession(input: {
    title: string;
    directory: string;
    agent?: string;
    model?: ModelRef;
    permissions?: PermissionRule[];
  }): Promise<SessionInfo> {
    const body: Record<string, unknown> = { title: input.title, location: { directory: input.directory } };
    if (input.agent) body.agent = input.agent;
    if (input.model) body.model = { providerID: input.model.providerID, id: input.model.id };
    if (input.permissions) body.permissions = input.permissions;
    return this.request<SessionInfo>("POST", "/api/session", { body });
  }

  /** A session's history, oldest first, across every page. */
  async messages(sessionId: string): Promise<unknown[]> {
    const out: unknown[] = [];
    await this.pages<unknown>(`/api/session/${seg(sessionId)}/message`, { order: "asc", limit: "200" }, (page) => {
      out.push(...page);
      return true;
    });
    return out;
  }

  /** Send a prompt; the press queues it and answers with the user message id. */
  async prompt(sessionId: string, text: string, delivery?: "steer" | "queue"): Promise<string> {
    const body: Record<string, unknown> = { text };
    if (delivery) body.delivery = delivery;
    const message = await this.request<{ id?: unknown }>("POST", `/api/session/${seg(sessionId)}/prompt`, { body });
    if (typeof message?.id !== "string") throw new EngineError(500, "UnexpectedAnswer", "The press took the prompt but did not name it.");
    return message.id;
  }

  async interrupt(sessionId: string): Promise<boolean> {
    const result = await this.request<{ interrupted?: unknown }>("POST", `/api/session/${seg(sessionId)}/interrupt`);
    return result?.interrupted === true;
  }

  async permissionReply(sessionId: string, requestId: string, decision: "once" | "reject", message?: string): Promise<void> {
    const body: Record<string, unknown> = { decision };
    if (message) body.message = message;
    await this.request("POST", `/api/session/${seg(sessionId)}/permission/${seg(requestId)}/reply`, { body });
  }

  async formReply(sessionId: string, formId: string, answer: FormAnswer): Promise<void> {
    await this.request("POST", `/api/session/${seg(sessionId)}/form/${seg(formId)}/reply`, { body: { answer } });
  }

  async formCancel(sessionId: string, formId: string, message?: string): Promise<void> {
    await this.request("DELETE", `/api/session/${seg(sessionId)}/form/${seg(formId)}`, { query: { message } });
  }

  /** The session's changes; with `from` (a user message id), only that turn's and after. */
  async diff(sessionId: string, from?: string): Promise<FileDiff[]> {
    const data = await this.request<unknown>("GET", `/api/session/${seg(sessionId)}/diff`, { query: { from } });
    return Array.isArray(data) ? (data as FileDiff[]) : [];
  }

  /** Ids of the sessions the press is running now. */
  async activeSessions(): Promise<string[]> {
    const data = await this.request<unknown>("GET", "/api/session/active");
    return data && typeof data === "object" ? Object.keys(data) : [];
  }

  /** Set a per-session instruction entry. A press without the experimental route is left alone. */
  async setInstruction(sessionId: string, key: string, value: unknown): Promise<void> {
    try {
      await this.request("PUT", `/api/experimental/session/${seg(sessionId)}/instructions/entries/${seg(key)}`, {
        body: { value },
      });
    } catch (error) {
      if (error instanceof EngineError && error.status === 404) return;
      throw error;
    }
  }

  /** A note to the model that the reader did not type. */
  async synthetic(sessionId: string, text: string): Promise<void> {
    await this.request("POST", `/api/session/${seg(sessionId)}/synthetic`, { body: { text } });
  }

  /** Active providers; a provider is connected when it is listed here. */
  async providers(): Promise<ProviderInfo[]> {
    const data = await this.request<unknown>("GET", "/api/provider", { query: this.location() });
    return Array.isArray(data) ? (data as ProviderInfo[]) : [];
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.request<unknown>("GET", "/api/model", { query: this.location() });
    return Array.isArray(data) ? (data as ModelInfo[]) : [];
  }

  async defaultModel(): Promise<ModelInfo | null> {
    const data = await this.request<ModelInfo | null>("GET", "/api/model/default", { query: this.location() });
    return data && typeof data.id === "string" ? data : null;
  }

  async setSessionModel(sessionId: string, model: ModelRef): Promise<void> {
    await this.request("POST", `/api/session/${seg(sessionId)}/model`, {
      body: { model: { providerID: model.providerID, id: model.id } },
    });
  }

  async integrations(): Promise<IntegrationInfo[]> {
    const data = await this.request<unknown>("GET", "/api/integration", { query: this.location() });
    return Array.isArray(data) ? (data as IntegrationInfo[]) : [];
  }

  /** Store a provider key with the press. Folio keeps no copy. */
  async connectKey(integrationId: string, key: string, label: string): Promise<void> {
    await this.request("POST", `/api/integration/${seg(integrationId)}/connect/key`, { body: { key, label } });
  }

  async readFile(directory: string, path: string): Promise<string> {
    try {
      return await this.request<string>("GET", `/api/fs/read/${path.split("/").map(seg).join("/")}`, {
        query: { "location[directory]": directory },
        text: true,
      });
    } catch (error) {
      if (!this.opts.host?.readFile || !fallsBack(error)) throw error;
      return this.opts.host.readFile(directory, path);
    }
  }

  async writeFile(directory: string, path: string, content: string): Promise<void> {
    try {
      await this.request("POST", "/api/experimental/fs/write", {
        query: { "location[directory]": directory, path },
        raw: content,
      });
    } catch (error) {
      if (!this.opts.host?.writeFile || !fallsBack(error)) throw error;
      await this.opts.host.writeFile(directory, path, content);
    }
  }

  /**
   * Listen to the global event stream until `signal` aborts. Frames arrive as
   * the server sent them, `{type, data, location?}`, unfiltered. A dropped or
   * silent stream is opened again with backoff; `folio.stream-paused` marks the
   * start of an outage (once) and `folio.stream-resumed` its end.
   */
  subscribe(onFrame: (frame: EventFrame) => void, signal: AbortSignal): void {
    void this.pump(onFrame, signal);
  }

  private async pump(onFrame: (frame: EventFrame) => void, signal: AbortSignal): Promise<void> {
    const silenceMs = this.opts.stream?.silenceMs ?? 45_000;
    const retryDelay = this.opts.stream?.retryDelay ?? backoffDelay;
    let failures = 0;
    let paused = false;
    while (!signal.aborted) {
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      signal.addEventListener("abort", stop);
      const dog = watchdog(silenceMs, () => ctrl.abort(new Error("The event stream went quiet.")));
      try {
        const response = await fetch(this.url("/api/event"), { headers: { Authorization: this.auth }, signal: ctrl.signal });
        if (!response.ok || !response.body) throw await failure(response, this.version);
        if (paused) onFrame({ type: "folio.stream-resumed", data: {} });
        paused = false;
        failures = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rest = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          dog.poke();
          const parsed = pushSse(rest, decoder.decode(value, { stream: true }));
          rest = parsed.rest;
          for (const event of parsed.events) onFrame(unwrapEvent(event));
        }
        throw new Error("The event stream closed.");
      } catch (error) {
        if (signal.aborted) return;
        if (!paused) onFrame({ type: "folio.stream-paused", data: { message: errorText(error) } });
        paused = true;
        failures += 1;
        await sleep(retryDelay(failures), signal);
      } finally {
        dog.stop();
        signal.removeEventListener("abort", stop);
      }
    }
  }

  /** Walk a cursor-paged list until it ends, `onPage` says stop, or the page cap. */
  private async pages<T>(path: string, query: Query, onPage: (page: T[]) => boolean): Promise<void> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await this.request<unknown>("GET", path, { query: { ...query, cursor } }, true);
      const record = result && typeof result === "object" ? (result as { data?: unknown; cursor?: { next?: unknown } }) : {};
      const page = Array.isArray(record.data) ? (record.data as T[]) : [];
      if (!onPage(page) || !page.length) return;
      const next = record.cursor?.next;
      if (typeof next !== "string" || !next || seen.has(next)) return;
      seen.add(next);
      cursor = next;
    }
  }

  private location(): Query {
    return { "location[directory]": this.opts.directory };
  }

  private async request<T>(method: string, path: string, call: Call = {}, whole = false): Promise<T> {
    const headers: Record<string, string> = { Authorization: this.auth };
    let body: string | undefined;
    if (call.raw !== undefined) {
      headers["Content-Type"] = "application/octet-stream";
      body = call.raw;
    } else if (call.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(call.body);
    }
    let response: Response;
    try {
      response = await fetch(this.url(path, call.query), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new EngineError(0, timedOut ? "TimeoutError" : "NetworkError", "The press could not be reached.");
    }
    if (!response.ok) throw await failure(response, this.version);
    if (response.status === 204) return undefined as T;
    const type = response.headers.get("content-type") ?? "";
    // Unknown paths on some servers fall through to the web UI with a 200.
    if (type.includes("text/html")) throw notFound(this.version);
    const text = await response.text();
    if (call.text || !type.includes("json")) return text as T;
    const data = text ? safeJson(text) : undefined;
    if (!whole && data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
      return (data as { data: T }).data;
    }
    return data as T;
  }

  private url(path: string, query?: Query): string {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") params.set(key, value);
    const search = params.toString();
    return search ? `${url}?${search}` : url;
  }
}

async function failure(response: Response, version: string | undefined): Promise<EngineError> {
  const text = await response.text().catch(() => "");
  const body = text ? safeJson(text) : undefined;
  const record = body && typeof body === "object" ? (body as { _tag?: unknown; message?: unknown }) : {};
  const tag = typeof record._tag === "string" ? record._tag : `Http${response.status}`;
  const said = typeof record.message === "string" && record.message.trim() ? record.message.trim() : undefined;
  const status = response.status;
  if (status === 401) return new EngineError(status, tag, "The press wants a different password.");
  if (status === 404) return new EngineError(status, tag, notFound(version).message);
  if (status === 409) return new EngineError(status, tag, said ?? "The press is busy with this chapter.");
  if (status >= 500) return new EngineError(status, tag, said ?? "The press stumbled.");
  return new EngineError(status, tag, said ?? `The press refused the request (${status}).`);
}

function notFound(version: string | undefined): EngineError {
  return new EngineError(404, "NotFound", `The press does not know that page (opencode ${version ?? "of an unknown version"}).`);
}

/** The press has no such route, or could not do the write itself; the host may. */
function fallsBack(error: unknown): boolean {
  return error instanceof EngineError && error.status !== 401 && error.status !== 0;
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 240) };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The press could not be reached.";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
