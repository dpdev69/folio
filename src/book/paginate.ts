import type { Chapter, Flow, Footnote } from "./model";
import { toProse, type ItalicRange } from "./emphasis";
import { wrapParagraphCached, type Measure, type WrappedLine } from "./wrap";
import { shownProse } from "./think";

export type LaidLine = WrappedLine & {
  blockId: string;
  voice: "prose" | "ink";
  /** Offset of this line in the block's plain text, for marginalia anchors. */
  plainStart: number;
  gap?: boolean;
};

export type LaidPage = {
  chapterId: string;
  lines: LaidLine[];
  footnotes: Footnote[];
};

export type LaidChapter = {
  chapterId: string;
  pages: LaidPage[];
};

const charMeasure: Measure = (text) => text.length;

export function paginateChapter(
  chapter: Chapter,
  opts: {
    measure?: Measure;
    inkMeasure?: Measure;
    width: number;
    linesPerPage: number;
    dropLines: number;
    dropWidth: number;
    /** The gap between the drop cap and the lines beside it; DROP_GAP (8) by default, as styles.css sets it. */
    dropGap?: number;
    /** Forced breaks, used by the sample so scenes match the mockups. */
    breaksBefore?: string[];
    /**
     * Prose lines the page foot takes for these footnotes and `extra` one-line
     * items (the slip that names a spread's plates). Without it the foot is free.
     */
    footLines?: (notes: Footnote[], extra: number) => number;
  },
): LaidPage[] {
  const measure = opts.measure ?? charMeasure;
  const inkMeasure = opts.inkMeasure ?? measure;
  const flow = flowOf(chapter, opts.breaksBefore ?? []);
  const pages: LaidPage[] = [];
  let current: LaidPage = blank(chapter.id);
  let dropUsed = false;

  const flush = () => {
    if (current.lines.length === 0 && current.footnotes.length === 0) return;
    pages.push(current);
    current = blank(chapter.id);
  };

  /**
   * Lines the foot of the page being written takes for these footnotes.
   * A right page also carries the slip when its spread footnotes a plate.
   */
  const foot = (notes: Footnote[]): number => {
    if (!opts.footLines) return 0;
    const right = pages.length % 2 === 1;
    const plated = (list: Footnote[]) => list.some((note) => note.plateId);
    const slip = right && (plated(notes) || plated(pages[pages.length - 1]?.footnotes ?? [])) ? 1 : 0;
    if (!notes.length && !slip) return 0;
    return opts.footLines(notes, slip);
  };

  /** Lines the page being written can hold with these footnotes at its foot. */
  const room = (notes: Footnote[]): number => Math.max(1, opts.linesPerPage - foot(notes));

  /**
   * A pile of footnotes on one line can be more than a page holds even with the
   * line alone on it. The footnotes that do not fit go on at the foot of the
   * next page, in order, as a book carries a long note over; the line keeps its
   * marks and at least its first footnote.
   */
  const spill = () => {
    while (current.footnotes.length > 1 && current.lines.length + foot(current.footnotes) > opts.linesPerPage) {
      const over: Footnote[] = [];
      while (current.footnotes.length > 1 && current.lines.length + foot(current.footnotes) > opts.linesPerPage) {
        over.unshift(current.footnotes.pop()!);
      }
      flush();
      current.footnotes = over;
    }
  };

  /** Footnotes of a block with no text yet: they hang on the next line laid, or at the end. */
  let orphans: Footnote[] = [];
  const hang = (line: LaidLine, notes: Footnote[]) => {
    for (const note of notes) {
      if (!line.notes.includes(note.n)) line.notes.push(note.n);
      if (note.plateId && !line.plates.includes(note.plateId)) line.plates.push(note.plateId);
    }
  };

  /**
   * A footnote placed after its lines can leave the page too full: carry its
   * last lines, with the footnotes they hold, to a new page. Earlier pages stay.
   */
  const settle = () => {
    while (current.lines.length > 1 && current.lines.length > room(current.footnotes)) {
      const carried: LaidLine[] = [];
      let kept = current.footnotes;
      while (current.lines.length > 1 && current.lines.length > room(kept)) {
        carried.unshift(current.lines.pop()!);
        const staying = new Set(current.lines.flatMap((line) => line.notes));
        const leaving = new Set(carried.flatMap((line) => line.notes));
        kept = current.footnotes.filter((note) => staying.has(note.n) || !leaving.has(note.n));
      }
      const moved = current.footnotes.filter((note) => !kept.includes(note));
      current.footnotes = kept;
      flush();
      current.lines = carried;
      current.footnotes = moved;
    }
  };

  const pushGap = (blockId: string, voice: LaidLine["voice"]) => {
    if (current.lines.length >= room(current.footnotes)) flush();
    current.lines.push({
      text: "",
      justify: false,
      besideDrop: false,
      notes: [],
      plates: [],
      italics: [],
      blockId,
      voice,
      plainStart: 0,
      gap: true,
    });
  };

  for (const item of flow) {
    if (item.kind === "break") {
      flush();
      if (pages.length % 2 === 1) pages.push(blank(chapter.id));
      continue;
    }
    const parsed = toProse(item.text);
    const paragraphs = splitParagraphs(parsed.text);
    // Marks count characters of the block as written; the page counts them in the plain text.
    const plainMarks = item.marks.map((mark) => ({ ...mark, offset: plainOffset(item.text, mark.offset) }));
    const lastParagraph = paragraphs[paragraphs.length - 1];
    paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) pushGap(item.id, item.voice);
      const useDrop = item.dropCap && !dropUsed && item.voice === "prose" && paragraphIndex === 0;
      if (useDrop) dropUsed = true;
      const wrapped = wrapParagraphCached({
        text: paragraph.text,
        italics: shiftItalics(parsed.italics, paragraph.start, paragraph.text.length),
        measure: item.voice === "ink" ? inkMeasure : measure,
        width: opts.width,
        // A mark belongs to the first paragraph that ends at or after it, so one that
        // falls before the text or between paragraphs is not left to ride the tail.
        // A mark past the end of the text so far stays with the last paragraph, at its end.
        marks: plainMarks
          .filter((mark) => {
            const previous = paragraphs[paragraphIndex - 1];
            const afterPrevious = !previous || mark.offset > previous.start + previous.text.length;
            const last = paragraph === lastParagraph;
            return afterPrevious && (last || mark.offset <= paragraph.start + paragraph.text.length);
          })
          .map((mark) => ({ ...mark, offset: Math.min(paragraph.text.length, Math.max(0, mark.offset - paragraph.start)) })),
        drop: useDrop ? { lines: opts.dropLines, width: opts.dropWidth, gap: opts.dropGap } : undefined,
      });
      let plainStart = paragraph.start;
      wrapped.forEach((line, index) => {
        const notes = [
          ...orphans,
          ...line.notes.map((n) => chapter.footnotes.find((f) => f.n === n)).filter((f): f is Footnote => Boolean(f)),
        ];
        // A line that brings a footnote needs room for both, or it starts the next page.
        const fresh = notes.filter((note) => !current.footnotes.some((f) => f.id === note.id));
        if (current.lines.length >= room([...current.footnotes, ...fresh])) flush();
        const laid: LaidLine = {
          ...line,
          blockId: item.id,
          voice: item.voice,
          plainStart,
          besideDrop: line.besideDrop && index < opts.dropLines,
        };
        if (orphans.length) {
          hang(laid, orphans);
          orphans = [];
        }
        current.lines.push(laid);
        for (const note of notes) {
          if (!current.footnotes.some((f) => f.id === note.id)) current.footnotes.push(note);
        }
        spill();
        plainStart += line.text.length + 1;
      });
    });
    // A block with no text to hang its marks on passes them to the next line laid.
    if (!paragraphs.length) {
      orphans = [...orphans, ...chapter.footnotes.filter((f) => f.blockId === item.id && !orphans.includes(f))];
    }
    settle();
  }
  if (orphans.length) {
    // Nothing followed: the last line laid takes them, or the foot of the page alone.
    const host = [...current.lines].reverse().find((line) => !line.gap);
    if (host) hang(host, orphans);
    for (const note of orphans) if (!current.footnotes.some((f) => f.id === note.id)) current.footnotes.push(note);
    orphans = [];
    settle();
    spill();
  }
  flush();
  return pages;
}

export function paginateBook(
  chapters: Chapter[],
  opts: Omit<Parameters<typeof paginateChapter>[1], "breaksBefore"> & {
    breaks?: Record<string, string[]>;
  },
): { pages: LaidPage[]; chapterStart: Record<string, number> } {
  const pages: LaidPage[] = [];
  const chapterStart: Record<string, number> = {};
  for (const chapter of chapters) {
    if (pages.length % 2 === 1) pages.push(blank(chapter.id));
    chapterStart[chapter.id] = pages.length;
    const laid = paginateChapter(chapter, {
      ...opts,
      breaksBefore: opts.breaks?.[chapter.id],
    });
    pages.push(...(laid.length ? laid : [blank(chapter.id)]));
  }
  if (pages.length % 2 === 1) pages.push(blank(pages[pages.length - 1]?.chapterId ?? "end"));
  return { pages, chapterStart };
}

/**
 * Where a character offset into a block as written falls in its plain text
 * (emphasis marks, headings and list markers taken out). Only the text before
 * the offset decides, so a mark keeps its place while the block grows.
 */
function plainOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return toProse(text).text.length + (offset - text.length);
  return toProse(text.slice(0, offset)).text.length;
}

function blank(chapterId: string): LaidPage {
  return { chapterId, lines: [], footnotes: [] };
}

function splitParagraphs(text: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  let cursor = 0;
  for (const chunk of text.split(/(\n\s*\n)/)) {
    if (/^\n\s*\n$/.test(chunk)) {
      cursor += chunk.length;
      continue;
    }
    const lead = chunk.length - chunk.trimStart().length;
    const trimmed = chunk.replace(/\s+/g, " ").trim();
    if (trimmed) parts.push({ text: trimmed, start: cursor + lead });
    cursor += chunk.length;
  }
  return parts;
}

function shiftItalics(italics: ItalicRange[], start: number, length: number): ItalicRange[] {
  const out: ItalicRange[] = [];
  for (const [from, to] of italics) {
    const a = Math.max(0, from - start);
    const b = Math.min(length, to - start);
    if (b > a) out.push([a, b]);
  }
  return out;
}

export function flowOf(chapter: Chapter, breaksBefore: string[]): Flow[] {
  const flow: Flow[] = [];
  let drop = true;
  for (const block of chapter.blocks) {
    if (breaksBefore.includes(block.id)) flow.push({ kind: "break" });
    if (block.marginal) continue;
    const marks = chapter.footnotes
      .filter((f) => f.blockId === block.id)
      .map((f) => ({ offset: f.offset, n: f.n, plateId: f.plateId }));
    flow.push({
      kind: "prose",
      id: block.id,
      voice: block.voice,
      // A part that has only begun a reasoning tag shows nothing until it is known.
      text: block.voice === "prose" ? shownProse(block.text) : block.text,
      dropCap: drop && block.voice === "prose",
      marks,
    });
    if (block.voice === "prose" && shownProse(block.text).trim()) drop = false;
  }
  return flow;
}

/** Pages already started stay byte-identical when only the tail grows. */
export function committedPrefix(before: LaidPage[], after: LaidPage[]): number {
  let i = 0;
  const limit = Math.max(0, Math.min(before.length, after.length) - 1);
  while (i < limit) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) break;
    i += 1;
  }
  return i;
}
