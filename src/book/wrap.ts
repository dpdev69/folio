import type { ItalicRange } from "./emphasis";

export type Measure = (text: string) => number;

export type WrappedLine = {
  text: string;
  justify: boolean;
  drop?: string;
  besideDrop: boolean;
  notes: number[];
  plates: string[];
  italics: ItalicRange[];
};

export type Mark = { offset: number; n: number; plateId?: string };

/** The space the page sets between the drop cap and the lines beside it (styles.css `.line.beside`). */
export const DROP_GAP = 8;

/** A drop cap `lines` tall and `width` wide; the lines beside it also give up `gap` (DROP_GAP by default). */
export type Drop = { lines: number; width: number; gap?: number };

export function wrapParagraph(opts: {
  text: string;
  measure: Measure;
  width: number;
  italics?: ItalicRange[];
  marks?: Mark[];
  drop?: Drop;
}): WrappedLine[] {
  const italics = opts.italics ?? [];
  const source = opts.text.replace(/\s+/g, " ").trim();
  if (!source) return [];

  const drop = opts.drop;
  const dropChar = drop ? source.slice(0, 1) : "";
  const body = drop ? source.slice(1).trimStart() : source;
  const bodyShift = source.length - body.length;

  const words = body.length ? body.split(" ") : [];
  const draft: { text: string; start: number }[] = [];
  let index = 0;
  while (index < words.length) {
    const limit = drop && draft.length < drop.lines ? Math.max(40, opts.width - drop.width - (drop.gap ?? DROP_GAP)) : opts.width;
    let taken = "";
    let count = 0;
    while (index + count < words.length) {
      const next = words[index + count];
      const candidate = taken ? `${taken} ${next}` : next;
      if (taken && opts.measure(candidate) > limit) break;
      taken = candidate;
      count += 1;
    }
    if (!taken) break;
    const cursor = cursorAt(body, index, words);
    draft.push({ text: taken, start: bodyShift + cursor });
    index += count;
  }

  const lines: WrappedLine[] = draft.map((line, lineNo) => ({
    text: line.text,
    justify: lineNo < draft.length - 1 && line.text.includes(" "),
    drop: lineNo === 0 && drop ? dropChar : undefined,
    besideDrop: Boolean(drop) && lineNo < (drop?.lines ?? 0),
    notes: [],
    plates: [],
    italics: sliceItalics(italics, line.start, line.text.length),
  }));

  const marks = [...(opts.marks ?? [])].sort((a, b) => a.offset - b.offset);
  for (const mark of marks) {
    // A mark before the first line (the drop-cap letter, leading space) hangs on the first line.
    let home = mark.offset < (draft[0]?.start ?? 0) ? 0 : lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      const start = draft[i].start;
      const end = start + lines[i].text.length;
      if (mark.offset >= start && mark.offset <= end) {
        home = i;
        break;
      }
    }
    if (home < 0) continue;
    if (!lines[home].notes.includes(mark.n)) lines[home].notes.push(mark.n);
    if (mark.plateId && !lines[home].plates.includes(mark.plateId)) lines[home].plates.push(mark.plateId);
  }

  if (drop && lines.length === 0) {
    lines.push({
      text: "",
      justify: false,
      drop: dropChar,
      besideDrop: true,
      notes: (opts.marks ?? []).map((m) => m.n),
      plates: (opts.marks ?? []).flatMap((m) => (m.plateId ? [m.plateId] : [])),
      italics: [],
    });
  }
  return lines;
}

type WrapOptions = Parameters<typeof wrapParagraph>[0];

/** Enough paragraphs for a long book; the oldest unused ones go first. */
const CACHE_LIMIT = 10_000;
/** Fresh wraps watched for a longer self: the growing paragraph, and a few a footnote just re-marked. */
const RECENT = 8;

type WrapCache = {
  entries: Map<string, WrappedLine[]>;
  /** The paragraphs wrapped afresh most lately, so a longer self of one can take its place. */
  recent: { key: string; shape: string; text: string }[];
};
const wrapCache = new WeakMap<Measure, WrapCache>();

/**
 * wrapParagraph, remembered per measure function. While the press streams,
 * every paragraph but the growing one is found here, so earlier lines are
 * reused rather than measured again. Callers get their own copies.
 *
 * The growing paragraph is wrapped afresh on every delta; a new text that
 * extends one wrapped afresh lately (same width and drop cap) replaces its
 * entry, so the cache holds the paragraph once rather than every prefix of it.
 */
export function wrapParagraphCached(opts: WrapOptions): WrappedLine[] {
  let cache = wrapCache.get(opts.measure);
  if (!cache) {
    cache = { entries: new Map(), recent: [] };
    wrapCache.set(opts.measure, cache);
  }
  const { entries } = cache;
  const shape = JSON.stringify([opts.width, opts.drop ?? null]);
  const key = JSON.stringify([opts.width, opts.drop ?? null, opts.italics ?? [], opts.marks ?? [], opts.text]);
  let lines = entries.get(key);
  if (lines) {
    entries.delete(key);
  } else {
    lines = wrapParagraph(opts);
    cache.recent = cache.recent.filter((prior) => {
      const outgrown = prior.shape === shape && opts.text.startsWith(prior.text);
      if (outgrown) entries.delete(prior.key);
      return !outgrown;
    });
    cache.recent.push({ key, shape, text: opts.text });
    if (cache.recent.length > RECENT) cache.recent.shift();
    if (entries.size >= CACHE_LIMIT) entries.delete(entries.keys().next().value!);
  }
  entries.set(key, lines);
  return lines.map(copyLine);
}

/** How many paragraphs the cache holds for this measure (for tests). */
export function wrapCacheSize(measure: Measure): number {
  return wrapCache.get(measure)?.entries.size ?? 0;
}

function copyLine(line: WrappedLine): WrappedLine {
  return { ...line, notes: [...line.notes], plates: [...line.plates], italics: line.italics.map(([a, b]) => [a, b]) };
}

function cursorAt(body: string, wordIndex: number, words: string[]): number {
  let cursor = 0;
  for (let i = 0; i < wordIndex; i++) {
    cursor += words[i].length + 1;
  }
  if (cursor > 0 && body[cursor - 1] !== " ") {
    const found = body.indexOf(words[wordIndex] ?? "", cursor);
    return found === -1 ? cursor : found;
  }
  return cursor;
}

function sliceItalics(italics: ItalicRange[], start: number, length: number): ItalicRange[] {
  const end = start + length;
  const out: ItalicRange[] = [];
  for (const [a, b] of italics) {
    const from = Math.max(a, start);
    const to = Math.min(b, end);
    if (to > from) out.push([from - start, to - start]);
  }
  return out;
}

/** Reveal the next visual line of `full` after `shown`. */
export function revealNextLine(full: string, shown: string, measure: Measure, width: number): string {
  if (shown.length >= full.length) return full;
  const rest = full.slice(shown.length);
  const pad = rest.match(/^\s*/)?.[0] ?? "";
  const trimmed = rest.slice(pad.length);
  const parts = trimmed.split(/(\s+)/);
  let acc = "";
  let consumed = 0;
  for (const part of parts) {
    if (!part) continue;
    const next = acc + part;
    if (acc.trim() && part.trim() && measure(next.trim()) > width) break;
    acc = next;
    consumed += part.length;
    if (part.trim() && measure(acc.trim()) >= width * 0.9) break;
  }
  if (!consumed) {
    const word = trimmed.split(/\s+/)[0] ?? "";
    return shown + pad + word;
  }
  return shown + pad + trimmed.slice(0, consumed);
}
