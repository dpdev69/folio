import type { Book, Chapter, Plate } from "../book/model";

/**
 * What the reader decided about each plate, kept per session in localStorage
 * so Accept, Reject and a fold survive a reload. The press does not keep it:
 * history rebuilds every plate as open.
 */
export type PlateState = Record<string, { status: Plate["status"]; folded: boolean }>;

export type PlateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Sessions kept; saving one more forgets the one saved longest ago. */
export const PLATE_SESSIONS = 200;

const PREFIX = "folio.plates.";
const INDEX = `${PREFIX}index`;
const STATUSES: Plate["status"][] = ["open", "accepted", "reverted"];

function browserStorage(): PlateStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function load(sessionId: string, storage: PlateStorage | null = browserStorage()): PlateState {
  try {
    const raw = storage?.getItem(PREFIX + sessionId);
    return raw ? clean(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Keep the plates' state for a session, merged into what is already kept. */
export function save(sessionId: string, plates: Plate[], storage: PlateStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PREFIX + sessionId, JSON.stringify(mergeState(load(sessionId, storage), plates)));
    const order = readIndex(storage).filter((id) => id !== sessionId);
    order.push(sessionId);
    while (order.length > PLATE_SESSIONS) storage.removeItem(PREFIX + order.shift()!);
    storage.setItem(INDEX, JSON.stringify(order));
  } catch {
    // Storage that is full or refused only costs the reader a reload's memory.
  }
}

export function mergeState(kept: PlateState, plates: Plate[]): PlateState {
  const next: PlateState = { ...kept };
  for (const plate of plates) next[plate.id] = { status: plate.status, folded: plate.folded };
  return next;
}

/** Set the kept state on the chapter's plates with the same ids. */
export function applyPlates(chapter: Chapter, state: PlateState): Chapter {
  let changed = false;
  const plates = chapter.plates.map((plate) => {
    const kept = state[plate.id];
    if (!kept || (kept.status === plate.status && kept.folded === plate.folded)) return plate;
    changed = true;
    return { ...plate, status: kept.status, folded: kept.folded };
  });
  return changed ? { ...chapter, plates } : chapter;
}

/** Every chapter of a book read from history, with its plates as the reader left them. */
export function withKeptPlates(book: Book, storage: PlateStorage | null = browserStorage()): Book {
  if (book.sample) return book;
  let changed = false;
  const chapters = book.chapters.map((chapter) => {
    const next = chapter.plates.length ? applyPlates(chapter, load(chapter.id, storage)) : chapter;
    if (next !== chapter) changed = true;
    return next;
  });
  return changed ? { ...book, chapters } : book;
}

function readIndex(storage: PlateStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INDEX) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function clean(raw: unknown): PlateState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const state: PlateState = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    const status = entry?.status as Plate["status"];
    if (!STATUSES.includes(status) || typeof entry?.folded !== "boolean") continue;
    state[id] = { status, folded: entry.folded };
  }
  return state;
}
