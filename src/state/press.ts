/**
 * The engine-facing steps of the hook, as plain async functions: find and
 * start the press, set a book from its sessions, refresh a turn's diff, and
 * undo a plate. The hook keeps the state; these keep the order of calls.
 */
import { applyEvent } from "../book/events";
import { asksFirst, isUntitled, type Book, type Chapter, type Plate } from "../book/model";
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
import { patchSides, reversePatch } from "../book/diff";
import type { EventFrame } from "../engine/sse";
import { pressSummary, type PressPhase } from "../welcome/copy";
import { browserStorage, type KeyStore } from "./storage";

/** Where a step that went on without something says so, in a sentence for the banner. */
export type Notices = { onNotice?: (sentence: string) => void };

/** Said when the press would not take Folio's writing style for a new chapter. */
export const STYLE_MISSED = "The press did not take Folio's writing style for this chapter, so it writes in its own voice.";
/** Said when the press would not say which chapters it is running. */
export const RUNNING_UNKNOWN = "The press did not say which chapters it is writing; they rest until it sends word.";
/** Said when the file was set back but the model was not told. */
export const NOT_TOLD = "The file was restored, but the press was not told and may make the change again.";
/** Said when a resync after a pause could not read the history. */
export const RESYNC_FAILED = "Folio could not read the chapters again after the pause; the next turn will set them right.";

/** The press asks before it edits a file or runs a command. */
export const ASK_RULES: PermissionRule[] = [
  { action: "edit", resource: "*", effect: "ask" },
  { action: "shell", resource: "*", effect: "ask" },
];

export { asksFirst };

/**
 * Give each chapter the ask rules (on) or clear its own rules (off: `[]`, so
 * the agent's defaults apply and edits go ahead). Verified against 2.0.28:
 * PATCH replaces the session's rules and takes effect on the next tool call.
 */
export async function applyAskRules(client: EngineClient, ids: string[], on: boolean): Promise<{ done: string[]; failed: string[] }> {
  const results = await Promise.allSettled(ids.map((id) => client.setPermissions(id, on ? ASK_RULES : [])));
  const done: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => (result.status === "fulfilled" ? done : failed).push(ids[i]));
  return { done, failed };
}

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
  removeFile(directory: string, path: string): Promise<void>;
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
  async removeFile(directory, path) {
    const result = await invoke<{ ok: boolean; error?: string }>("remove_file", { directory, path });
    if (!result.ok) throw new Error(result.error ?? `${path} was not removed.`);
  },
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
  async removeFile(directory, path) {
    const result = await json<{ ok: boolean; error?: string }>("/folio/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory, path }),
    });
    if (!result.ok) throw new Error(result.error ?? `${path} was not removed.`);
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
export async function openPress(host: PressHost, target?: AttachTarget, chosen: ModelRef | null = null): Promise<OpenedPress> {
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
  const choice = defaultModelChoice(model ? { providerID: model.providerID, id: model.id } : null, models, chosen);
  return {
    client,
    version,
    models,
    providers,
    model: choice.model,
    phase: { phase: "ready", version, summary: pressSummary(version, providers, choice.model), note: choice.note },
  };
}

/**
 * The models the press will still run: every one it lists, unless it says the
 * model is deprecated or not enabled. A model with no status, or an alpha or
 * beta one, is offered.
 */
export function offeredModels<M extends ModelInfo>(models: M[]): M[] {
  return models.filter((model) => {
    const { status, enabled } = model as { status?: unknown; enabled?: unknown };
    return status !== "deprecated" && enabled !== false;
  });
}

/**
 * The model the reader chose last time while the press still offers it, else
 * the press's default, unless the press no longer offers that either: then the
 * first free (`opencode`) model, with a sentence for the title page.
 */
export function defaultModelChoice(
  model: ModelRef | null,
  offered: ModelInfo[],
  chosen: ModelRef | null = null,
): { model: ModelRef | null; note?: string } {
  if (chosen && offered.some((m) => m.providerID === chosen.providerID && m.id === chosen.id)) return { model: chosen };
  if (!offered.length || (model && offered.some((m) => m.providerID === model.providerID && m.id === model.id))) return { model };
  // A press that names no default offers none: the fallback runs as for a default that is gone.
  const free = offered.find((m) => m.providerID === "opencode");
  if (!free) return { model };
  const name = free.name ?? free.id;
  return {
    model: { providerID: free.providerID, id: free.id },
    note: model
      ? `The press's default model, ${model.id}, is no longer offered, so Folio chose ${name}.`
      : `The press named no default model, so Folio chose ${name}.`,
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
  opts: { askBeforeWrite: boolean; model?: ModelRef | null } & Notices,
): Promise<SessionInfo> {
  const session = await client.createSession({
    title: "Untitled",
    directory,
    permissions: opts.askBeforeWrite ? ASK_RULES : undefined,
    model: opts.model ?? undefined,
  });
  // The chapter works without the style; it is only the voice. A press without the route
  // answers 404, which setInstruction leaves silent; anything else is said once.
  await client.setInstruction(session.id, "folio.style", PRESS_STYLE).catch(() => opts.onNotice?.(STYLE_MISSED));
  return session;
}

/** A book from the folder's sessions, opening its first chapter if there are none. */
export async function loadBook(
  client: EngineClient,
  directory: string,
  opts: { askBeforeWrite: boolean; model?: ModelRef | null } & Notices,
): Promise<Book> {
  let sessions = await client.sessions(directory);
  if (!sessions.length) sessions = [await openChapter(client, directory, opts)];
  let book = bookFromSessions(directory, sessions);
  if (opts.askBeforeWrite) {
    // The reader asked for this before the book was open; chapters without the rules get them now.
    const { done } = await applyAskRules(client, book.chapters.filter((c) => !c.askRules).map((c) => c.id), true);
    book = { ...book, chapters: book.chapters.map((c) => (done.includes(c.id) ? { ...c, askRules: true } : c)) };
  }
  return refreshBook(client, book, opts);
}

/**
 * Set every chapter again from its history, its latest turn's diff, and
 * whether the press is running it. Used on open and after the stream returns.
 */
export async function refreshBook(client: EngineClient, book: Book, opts: Notices = {}): Promise<Book> {
  const running = new Set(
    await client.activeSessions().catch(() => {
      opts.onNotice?.(RUNNING_UNKNOWN);
      return [] as string[];
    }),
  );
  // A few chapters are read at a time; the book keeps its order whatever order they finish in.
  const chapters = await mapLimit(book.chapters, REFRESH_LIMIT, async (chapter) => {
    let next = chapterFromMessages(chapter, await client.messages(chapter.id), book.directory);
    const frame = await turnDiff(client, next).catch(() => null);
    if (frame) next = applyEvent({ ...book, chapters: [next] }, frame).chapters[0];
    // The press's list of waiting asks and forms is the truth; if it cannot be read, keep what is held.
    const waiting = await pendingFrames(client, chapter.id).catch(() => null);
    if (waiting) next = waiting.reduce(applyEvent, { ...book, chapters: [{ ...next, asks: [], forms: [] }] }).chapters[0];
    return { ...next, busy: running.has(next.id) };
  });
  return { ...book, chapters };
}

/** Chapters read from history at once on open and after an outage. */
export const REFRESH_LIMIT = 4;

/** `work` over every item, at most `limit` at a time, with the results in the items' order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, lane));
  return results;
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
 * The `folio.diff` frame for a turn of the chapter (by default its latest):
 * the diff from the turn's user message on, labelled with that message id.
 *
 * The whole session's diff is never labelled as a turn's: it may hold other
 * turns' changes. A chapter with no ink at all has no turn to claim, so it
 * gets the session's diff, `unscoped` and with no turn named. A turn the press
 * has not named yet (`local-…`) or will not scope (400) gets an empty diff, so
 * the chapter is marked fresh without plates that would claim the turn; the
 * hook waits for the turn's name before it asks.
 */
export async function turnDiff(client: EngineClient, chapter: Chapter, turn: string | undefined = lastInkId(chapter)): Promise<EventFrame> {
  if (!turn) {
    const diff = await client.diff(chapter.id);
    return { type: "folio.diff", data: { sessionID: chapter.id, diff, unscoped: true } };
  }
  const empty: EventFrame = { type: "folio.diff", data: { sessionID: chapter.id, diff: [], turnMessageId: turn, unscoped: true } };
  if (isLocalId(turn)) return empty;
  try {
    const diff = await client.diff(chapter.id, turn);
    return { type: "folio.diff", data: { sessionID: chapter.id, diff, turnMessageId: turn } };
  } catch (error) {
    if (error instanceof EngineError && error.status === 400) return empty;
    throw error;
  }
}

/** An ink line the press has not named yet. */
export function isLocalId(id: string | undefined): boolean {
  return Boolean(id?.startsWith("local-"));
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
 * the same file is left alone. A file the plate created is removed, not left
 * empty; a file it removed is written back from the patch. Session revert is
 * not used; it would delete the chapter's history.
 */
export async function revertPlate(client: EngineClient, book: Book, chapter: Chapter, plate: Plate, opts: Notices = {}): Promise<EventFrame> {
  // Without its own patch a plate cannot be told apart from later changes to the file.
  if (!plate.patch) throw new Error(CANNOT_REVERT);
  const created = createsFile(plate);
  const removed = plate.change === "deleted" || patchSides(plate.patch).newEmpty;
  const moved = new Error(`${plate.file} has changed since this plate was set, so it was left as it is.`);
  let current: string;
  try {
    current = await client.readFile(book.directory, plate.file);
  } catch (error) {
    // A file the plate removed is not there to read; the patch holds all of it.
    if (!removed) throw error;
    current = "";
  }
  // Something written where a removed file was is not the plate's to replace.
  if (removed && current !== "") throw moved;
  const before = reversePatch(current, plate.patch);
  if (before === null) throw moved;
  if (created) {
    // More than the plate wrote is in the file now; removing it would lose that.
    if (before !== "") throw moved;
    await client.removeFile(book.directory, plate.file);
  } else {
    await client.writeFile(book.directory, plate.file, before);
  }
  await client.synthetic(chapter.id, revertNote(plate.file)).catch(() => opts.onNotice?.(NOT_TOLD));
  return turnDiff(client, chapter);
}

/** The plate made its file; Reject takes the file away rather than emptying it. */
export function createsFile(plate: Plate): boolean {
  return plate.change === "added" || Boolean(plate.patch && patchSides(plate.patch).oldEmpty);
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
        askRules: asksFirst(session.permissions),
      })),
  };
}

/** The ink line that began the chapter's current turn: a message id, or `local-…` before the press names it. */
export function lastInkId(chapter: Chapter): string | undefined {
  for (let i = chapter.blocks.length - 1; i >= 0; i--) {
    const block = chapter.blocks[i];
    if (block.voice === "ink") return block.id;
  }
  return undefined;
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type ModelStorage = KeyStore;

const MODEL_KEY = "folio.model";

/** The model the reader last chose from the menu, so a reload does not fall back to a model the press cannot run. */
export function loadChosenModel(storage: ModelStorage | null = browserStorage()): ModelRef | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(MODEL_KEY) ?? "null");
    const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (typeof value?.providerID !== "string" || typeof value?.id !== "string") return null;
    return { providerID: value.providerID, id: value.id };
  } catch {
    return null;
  }
}

const ASK_KEY = "folio.askBeforeWrite";

/** Whether the reader asked the press to ask before it writes; off unless they did. */
export function loadAskBeforeWrite(storage: ModelStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(ASK_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveAskBeforeWrite(on: boolean, storage: ModelStorage | null = browserStorage()): void {
  try {
    storage?.setItem(ASK_KEY, on ? "true" : "false");
  } catch {
    // Without storage the setting lasts until the window closes.
  }
}

export function saveChosenModel(model: ModelRef, storage: ModelStorage | null = browserStorage()): void {
  try {
    storage?.setItem(MODEL_KEY, JSON.stringify({ providerID: model.providerID, id: model.id }));
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}
