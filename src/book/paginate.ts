import type { Chapter, Flow, Footnote } from "./model";
import { toProse, type ItalicRange } from "./emphasis";
import { wrapParagraph, type Measure, type WrappedLine } from "./wrap";

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
    /** Forced breaks, used by the sample so scenes match the mockups. */
    breaksBefore?: string[];
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

  const pushGap = (blockId: string, voice: LaidLine["voice"]) => {
    if (current.lines.length >= opts.linesPerPage) flush();
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
    paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) pushGap(item.id, item.voice);
      const useDrop = item.dropCap && !dropUsed && item.voice === "prose" && paragraphIndex === 0;
      if (useDrop) dropUsed = true;
      const wrapped = wrapParagraph({
        text: paragraph.text,
        italics: shiftItalics(parsed.italics, paragraph.start, paragraph.text.length),
        measure: item.voice === "ink" ? inkMeasure : measure,
        width: opts.width,
        marks: item.marks
          .filter((mark) => mark.offset >= paragraph.start && mark.offset <= paragraph.start + paragraph.text.length)
          .map((mark) => ({ ...mark, offset: mark.offset - paragraph.start })),
        drop: useDrop ? { lines: opts.dropLines, width: opts.dropWidth } : undefined,
      });
      let plainStart = paragraph.start;
      wrapped.forEach((line, index) => {
        if (current.lines.length >= opts.linesPerPage) flush();
        const notes = line.notes
          .map((n) => chapter.footnotes.find((f) => f.n === n))
          .filter((f): f is Footnote => Boolean(f));
        current.lines.push({
          ...line,
          blockId: item.id,
          voice: item.voice,
          plainStart,
          besideDrop: line.besideDrop && index < opts.dropLines,
        });
        for (const note of notes) {
          if (!current.footnotes.some((f) => f.id === note.id)) current.footnotes.push(note);
        }
        plainStart += line.text.length + 1;
      });
    });
    const placed = new Set<string>();
    for (const page of pages) for (const note of page.footnotes) placed.add(note.id);
    for (const note of current.footnotes) placed.add(note.id);
    for (const note of chapter.footnotes.filter((f) => f.blockId === item.id && !placed.has(f.id))) {
      current.footnotes.push(note);
      const host = [...current.lines].reverse().find((line) => !line.gap);
      if (host && !host.notes.includes(note.n)) host.notes.push(note.n);
      if (host && note.plateId && !host.plates.includes(note.plateId)) host.plates.push(note.plateId);
    }
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
      text: block.text,
      dropCap: drop && block.voice === "prose",
      marks,
    });
    if (block.voice === "prose" && block.text.trim()) drop = false;
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
