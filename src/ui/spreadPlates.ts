import type { Chapter, Plate } from "../book/model";
import type { LaidPage } from "../book/paginate";

/**
 * The plates footnoted on a spread, in plate order. Each page finds its plates
 * in its own chapter, so a spread that closes one chapter and opens the next
 * keeps the footnotes of both; a plate named on both pages is listed once.
 */
export function platesOnPages(chapters: readonly Chapter[], left: LaidPage, right: LaidPage): Plate[] {
  // The ids each chapter on the spread names, the left page's chapter first.
  const named = new Map<string, Set<string>>();
  for (const page of [left, right]) {
    const ids = named.get(page.chapterId) ?? new Set<string>();
    for (const note of page.footnotes) if (note.plateId) ids.add(note.plateId);
    for (const line of page.lines) for (const id of line.plates) ids.add(id);
    named.set(page.chapterId, ids);
  }
  const out: Plate[] = [];
  const seen = new Set<string>();
  for (const [chapterId, ids] of named) {
    const chapter = chapters.find((item) => item.id === chapterId);
    for (const plate of chapter?.plates ?? []) {
      if (!ids.has(plate.id) || seen.has(plate.id)) continue;
      seen.add(plate.id);
      out.push(plate);
    }
  }
  return out;
}
