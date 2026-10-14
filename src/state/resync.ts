/**
 * Setting a book again after the event stream returns. The stream has no
 * replay, so chapters are read again from history; this merges that fresh
 * read with what the reader has on the page now.
 */
import { applyEvent, setText, textBlockId, type Frame } from "../book/events";
import type { Book, Chapter } from "../book/model";
import { recordOf, stringOf } from "../book/values";
import { FIRST_PAGE, FIRST_PAGE_ID } from "../welcome/copy";

/**
 * Merge `fresh` (from `refreshBook`) into `current`:
 * - each chapter `fresh` holds is taken from it, keeping the reader's own
 *   state: plate status and fold (by plate id), margin notes, and any
 *   `local-…` ink line the press has not taken yet;
 * - `frames`, the stream frames that reached `current` while the history was
 *   being read, are applied again to those chapters, so live text is not lost;
 *   a delta for text the history already holds is not added twice;
 * - chapters `fresh` does not hold stay as they are;
 * - the first page is set again on a book with no text.
 */
export function mergeResync(current: Book, fresh: Book, frames: Frame[]): Book {
  const freshById = new Map(fresh.chapters.map((chapter) => [chapter.id, chapter]));
  const currentById = new Map(current.chapters.map((chapter) => [chapter.id, chapter]));
  // Text the history already holds, per chapter: deltas for it are skipped.
  const held = new Map<string, Set<string>>();
  for (const chapter of fresh.chapters) {
    held.set(chapter.id, new Set(chapter.blocks.filter((b) => b.voice === "prose" && b.text).map((b) => b.id)));
  }
  let merged: Book = {
    ...current,
    chapters: current.chapters.map((chapter) => {
      const read = freshById.get(chapter.id);
      return read ? carry(chapter, read) : chapter;
    }),
  };
  const skipped: [string, string][] = [];
  for (const frame of frames) {
    const data = recordOf(frame.data);
    const sessionID = stringOf(data?.sessionID) ?? stringOf(recordOf(data?.form)?.sessionID);
    if (!data || !sessionID || !freshById.has(sessionID)) continue;
    if (frame.type === "session.text.delta") {
      const aid = stringOf(data.assistantMessageID);
      const ordinal = typeof data.ordinal === "number" ? data.ordinal : undefined;
      if (aid && ordinal != null && held.get(sessionID)?.has(textBlockId(aid, ordinal))) {
        skipped.push([sessionID, textBlockId(aid, ordinal)]);
        continue;
      }
    }
    merged = applyEvent(merged, frame);
  }
  // Live text that continues the history's is newer; text that does not (a gap) gives way.
  for (const [chapterId, blockId] of skipped) {
    const live = currentById.get(chapterId)?.blocks.find((b) => b.id === blockId)?.text;
    merged = {
      ...merged,
      chapters: merged.chapters.map((chapter) => {
        if (chapter.id !== chapterId || !live) return chapter;
        const read = chapter.blocks.find((b) => b.id === blockId)?.text ?? "";
        return live.length > read.length && live.startsWith(read) ? setText(chapter, blockId, live, "grow") : chapter;
      }),
    };
  }
  return ensureFirstPage(merged);
}

/** The fresh chapter, with the reader's own state from the one on the page. */
function carry(page: Chapter, read: Chapter): Chapter {
  const plates = new Map(page.plates.map((plate) => [plate.id, plate]));
  const known = new Set(page.blocks.map((block) => block.id));
  // Ink the history added that the page did not have: prompts the press has now taken.
  const taken = read.blocks.filter((block) => block.voice === "ink" && !known.has(block.id)).map((block) => block.text.trim());
  const waiting = page.blocks.filter((block) => {
    if (block.voice !== "ink" || !block.id.startsWith("local-")) return false;
    const index = taken.indexOf(block.text.trim());
    if (index < 0) return true;
    taken.splice(index, 1);
    return false;
  });
  return {
    ...read,
    blocks: [...read.blocks, ...waiting],
    plates: read.plates.map((plate) => {
      const was = plates.get(plate.id);
      return was ? { ...plate, status: was.status, folded: was.folded } : plate;
    }),
    notes: page.notes,
    busy: read.busy || waiting.length > 0,
  };
}

/** A book with no text yet opens on the first page, set in the last chapter. */
export function ensureFirstPage(book: Book): Book {
  if (book.chapters.some((chapter) => chapter.blocks.some((block) => block.id !== FIRST_PAGE_ID && block.text.trim()))) return book;
  const last = book.chapters[book.chapters.length - 1];
  if (!last || last.blocks.some((block) => block.id === FIRST_PAGE_ID)) return book;
  return {
    ...book,
    chapters: book.chapters.map((chapter) =>
      chapter.id === last.id
        ? { ...chapter, blocks: [{ id: FIRST_PAGE_ID, voice: "prose", text: FIRST_PAGE }, ...chapter.blocks] }
        : chapter,
    ),
  };
}
