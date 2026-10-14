/**
 * The engine-facing steps of the hook, as plain async functions: find and
 * start the press, set a book from its sessions, refresh a turn's diff, and
 * undo a plate. The hook keeps the state; these keep the order of calls.
 */
import { applyEvent } from "../book/events";
import { isUntitled, type Book, type Chapter, type Plate } from "../book/model";
import { chapterFromMessages } from "../book/transcript";
import {
  EngineClient,
  EngineError,
  PRESS_STYLE,
  type FileHost,
  type ModelInfo,
  type ModelRef,
  type PermissionRule,
  type ProviderInfo,
  type SessionInfo,
} from "../engine/client";
import { reversePatch } from "../book/diff";
import type { EventFrame } from "../engine/sse";
import { pressSummary, type PressPhase } from "../welcome/copy";

/** The press asks before it edits a file or runs a command. */
export const ASK_RULES: PermissionRule[] = [
  { action: "edit", resource: "*", effect: "ask" },
  { action: "shell", resource: "*", effect: "ask" },
];

/** Sent with "No" on an ask, so the turn goes on without the change. */
export const DECLINE_MESSAGE = "The reader declined this change; continue without it.";

export type AttachTarget = { url: string; password: string };

/** Where the press runs: the Tauri shell, or the vite dev server's helper. */
export type PressHost = FileHost & {
  detect(): Promise<{ found: boolean }>;
  attach(target?: AttachTarget): Promise<{ url: string; password: string }>;
  install(): Promise<{ ok: boolean; error?: string }>;
  writeFile(directory: string, path: string, content: string): Promise<void>;
  readFile(directory: string, path: string): Promise<string>;
};

export function pressHost(): PressHost {
  return isTauri() ? tauriHost : devHost;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args);
}

type Attached = { ok: boolean; url?: string; password?: string; error?: string };

const tauriHost: PressHost = {
  detect: () => invoke<{ found: boolean }>("engine_detect"),
  async attach(target) {
    const result = await invoke<Attached>("engine_attach", { directory: null, attach: target ?? null });
    if (!result.ok || !result.url) throw new Error(result.error ?? "The press would not start.");
    return { url: result.url, password: result.password ?? "" };
  },
  install: () => invoke<{ ok: boolean; error?: string }>("engine_install"),
  async writeFile(directory, path, content) {
    const result = await invoke<{ ok: boolean; error?: string }>("write_file", { directory, path, content });
    if (!result.ok) throw new Error(result.error ?? `${path} was not written.`);
  },
  readFile: (directory, path) => invoke<string>("read_file", { directory, path }),
};

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return (await response.json()) as T;
}

const devHost: PressHost = {
  async detect() {
    const probe = await json<{ installed?: boolean; running?: boolean }>("/folio/press");
    return { found: Boolean(probe.installed || probe.running) };
  },
  async attach(target) {
    // The page checks an attach target itself, with info().
    if (target) return target;
    const result = await json<Attached>("/folio/serve", { method: "POST" });
    if (!result.ok || !result.url) throw new Error(result.error ?? "The press would not start.");
    return { url: result.url, password: result.password ?? "" };
  },
  install: () => json<{ ok: boolean; error?: string }>("/folio/install", { method: "POST" }),
  async writeFile(directory, path, content) {
    const result = await json<{ ok: boolean; error?: string }>("/folio/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory, path, content }),
    });
    if (!result.ok) throw new Error(result.error ?? `${path} was not written.`);
  },
  async readFile(directory, path) {
    const query = new URLSearchParams({ directory, path });
    const result = await json<{ ok: boolean; content?: string; error?: string }>(`/folio/read?${query}`);
    if (!result.ok || result.content === undefined) throw new Error(result.error ?? `${path} was not read.`);
    return result.content;
  },
};

export type OpenedPress = {
  client: EngineClient | null;
  phase: PressPhase;
  version?: string;
  models: ModelInfo[];
  providers: ProviderInfo[];
  model: ModelRef | null;
};

/**
 * Detect, attach, and read the press's version and default model. The free
 * `opencode` provider counts as connected, so a key is never required here.
 */
export async function openPress(host: PressHost, target?: AttachTarget): Promise<OpenedPress> {
  const none = { client: null, models: [], providers: [], model: null };
  if (!target) {
    const detected = await host.detect();
    if (!detected.found) return { ...none, phase: { phase: "missing" } };
  }
  let attached: { url: string; password: string };
  try {
    attached = await host.attach(target);
  } catch (error) {
    const message = messageOf(error, "The press would not start.");
    if (/password/i.test(message)) return { ...none, phase: { phase: "needs-password", detail: message } };
    if (/not installed/i.test(message)) return { ...none, phase: { phase: "missing", detail: message } };
    return { ...none, phase: { phase: "error", message } };
  }
  const client = new EngineClient(attached.url, { password: attached.password, host });
  let version: string;
  try {
    version = (await client.info()).version;
  } catch (error) {
    if (error instanceof EngineError && error.status === 401) {
      return { ...none, phase: { phase: "needs-password", detail: error.message } };
    }
    throw error;
  }
  const [model, providers, listed] = await Promise.all([
    client.defaultModel().catch(() => null),
    client.providers().catch(() => []),
    client.models().catch(() => []),
  ]);
  const models = offeredModels(listed);
  const choice = defaultModelChoice(model ? { providerID: model.providerID, id: model.id } : null, models);
  return {
    client,
    version,
    models,
    providers,
    model: choice.model,
    phase: { phase: "ready", version, summary: pressSummary(version, providers, choice.model), note: choice.note },
  };
}

/** The models the press will still run: active and enabled, when it says. */
export function offeredModels<M extends ModelInfo>(models: M[]): M[] {
  return models.filter((model) => {
    const { status, enabled } = model as { status?: unknown; enabled?: unknown };
    return (status === undefined || status === "active") && enabled !== false;
  });
}

/**
 * The press's default model, unless the press no longer offers it: then the
 * first free (`opencode`) model, with a sentence for the title page.
 */
export function defaultModelChoice(model: ModelRef | null, offered: ModelInfo[]): { model: ModelRef | null; note?: string } {
  if (!model || !offered.length || offered.some((m) => m.providerID === model.providerID && m.id === model.id)) return { model };
  const free = offered.find((m) => m.providerID === "opencode");
  if (!free) return { model };
  return {
    model: { providerID: free.providerID, id: free.id },
    note: `The press's default model, ${model.id}, is no longer offered, so Folio chose ${free.name ?? free.id}.`,
  };
}

/**
 * Reach the press again after its stream keeps failing: the host starts a new
 * one if its child has died (new port, new password), and a new client is
 * checked against it.
 */
export async function reattachPress(host: PressHost, target?: AttachTarget): Promise<EngineClient> {
  const attached = await host.attach(target);
  const client = new EngineClient(attached.url, { password: attached.password, host });
  await client.info();
  return client;
}

/** A new chapter: a session bound to the folder, with Folio's writing style. */
export async function openChapter(
  client: EngineClient,
  directory: string,
  opts: { askBeforeWrite: boolean; model?: ModelRef | null },
): Promise<SessionInfo> {
  const session = await client.createSession({
    title: "Untitled",
    directory,
    permissions: opts.askBeforeWrite ? ASK_RULES : undefined,
    model: opts.model ?? undefined,
  });
  // The chapter works without the style; it is only the voice.
  await client.setInstruction(session.id, "folio.style", PRESS_STYLE).catch(() => {});
  return session;
}

/** A book from the folder's sessions, opening its first chapter if there are none. */
export async function loadBook(
  client: EngineClient,
  directory: string,
  opts: { askBeforeWrite: boolean; model?: ModelRef | null },
): Promise<Book> {
  let sessions = await client.sessions(directory);
  if (!sessions.length) sessions = [await openChapter(client, directory, opts)];
  return refreshBook(client, bookFromSessions(directory, sessions));
}

/**
 * Set every chapter again from its history, its latest turn's diff, and
 * whether the press is running it. Used on open and after the stream returns.
 */
export async function refreshBook(client: EngineClient, book: Book): Promise<Book> {
  const running = new Set(await client.activeSessions().catch(() => []));
  const chapters: Chapter[] = [];
  for (const chapter of book.chapters) {
    let next = chapterFromMessages(chapter, await client.messages(chapter.id), book.directory);
    const frame = await turnDiff(client, next).catch(() => null);
    if (frame) next = applyEvent({ ...book, chapters: [next] }, frame).chapters[0];
    // The press's list of waiting asks and forms is the truth; if it cannot be read, keep what is held.
    const waiting = await pendingFrames(client, chapter.id).catch(() => null);
    if (waiting) next = waiting.reduce(applyEvent, { ...book, chapters: [{ ...next, asks: [], forms: [] }] }).chapters[0];
    chapters.push({ ...next, busy: running.has(next.id) });
  }
  return { ...book, chapters };
}

/**
 * The asks and forms a session is waiting on, framed the way the stream sends
 * them (`permission.asked {…request}`, `form.created {form}`), so the reducer
 * sets them exactly as it sets live ones.
 */
export async function pendingFrames(client: EngineClient, sessionId: string): Promise<EventFrame[]> {
  const [asks, forms] = await Promise.all([client.permissions(sessionId), client.forms(sessionId)]);
  return [
    ...asks.map((ask): EventFrame => ({ type: "permission.asked", data: { ...ask, sessionID: ask.sessionID ?? sessionId } })),
    ...forms.map((form): EventFrame => ({ type: "form.created", data: { form: { ...form, sessionID: form.sessionID ?? sessionId } } })),
  ];
}

/**
 * The `folio.diff` frame for a chapter's current turn: the diff from the
 * turn's user message on, or the whole session's when the press will not
 * scope it (a turn whose id it does not know yet). The whole session's diff is
 * marked `unscoped`, so its patches never become a plate's own.
 */
export async function turnDiff(client: EngineClient, chapter: Chapter): Promise<EventFrame> {
  const turn = lastInk(chapter);
  let diff;
  let unscoped = !turn;
  try {
    diff = await client.diff(chapter.id, turn);
  } catch (error) {
    if (!turn || !(error instanceof EngineError) || error.status !== 400) throw error;
    diff = await client.diff(chapter.id);
    unscoped = true;
  }
  return { type: "folio.diff", data: { sessionID: chapter.id, diff, turnMessageId: turn, ...(unscoped ? { unscoped } : {}) } };
}

/**
 * What the model is told after a Reject. The note starts a turn of its own, so
 * it says plainly that the change is unwanted; a bare "reverted" was read as an
 * accident and the model made the change again.
 */
export function revertNote(file: string): string {
  return `The reader rejected your change to ${file} and set the file back on purpose. Leave ${file} as it is now unless the reader asks again.`;
}

/** Said when a plate has no patch of its own to reverse. */
export const CANNOT_REVERT = "This plate cannot be set back on its own.";

/**
 * Undo one plate's file: reverse the plate's own patch against the file as it
 * is now, write it back through Folio, and tell the model. A later change to
 * the same file is left alone. Session revert is not used; it would delete the
 * chapter's history.
 */
export async function revertPlate(client: EngineClient, book: Book, chapter: Chapter, plate: Plate): Promise<EventFrame> {
  // Without its own patch a plate cannot be told apart from later changes to the file.
  if (!plate.patch) throw new Error(CANNOT_REVERT);
  const current = await client.readFile(book.directory, plate.file);
  const before = reversePatch(current, plate.patch);
  if (before === null) throw new Error(`${plate.file} has changed since this plate was set, so it was left as it is.`);
  await client.writeFile(book.directory, plate.file, before);
  await client.synthetic(chapter.id, revertNote(plate.file)).catch(() => {});
  return turnDiff(client, chapter);
}

export function bookFromSessions(directory: string, sessions: SessionInfo[]): Book {
  const title = directory.split(/[\\/]/).filter(Boolean).pop() || "Book";
  return {
    id: directory,
    title,
    directory,
    sample: false,
    chapters: sessions
      .slice()
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      .map((session) => ({
        id: session.id,
        title: isUntitled(session.title) ? "Untitled" : (session.title ?? "Untitled"),
        untitled: isUntitled(session.title),
        blocks: [],
        footnotes: [],
        plates: [],
        notes: [],
        asks: [],
        forms: [],
        busy: false,
      })),
  };
}

/** The user message that began the chapter's current turn, once the press has named it. */
function lastInk(chapter: Chapter): string | undefined {
  for (let i = chapter.blocks.length - 1; i >= 0; i--) {
    const block = chapter.blocks[i];
    if (block.voice === "ink") return block.id.startsWith("local-") ? undefined : block.id;
  }
  return undefined;
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
