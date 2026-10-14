import { SERIF, type Theme } from "./themes";

export type Scale = {
  fontSize: number;
  lineHeight: number;
  width: number;
  lines: number;
  dropLines: number;
  dropWidth: number;
  inkSize: number;
};

/** A scale after line spacing, margins and the theme's leading are applied. */
export type LaidScale = Scale & { marginX: number };

export type LineSpacing = "tight" | "normal" | "loose";
export type Margins = "narrow" | "normal" | "wide";

export const SCALES: Scale[] = [
  { fontSize: 16, lineHeight: 25, width: 358, lines: 15, dropLines: 3, dropWidth: 33, inkSize: 24 },
  { fontSize: 17.5, lineHeight: 27, width: 372, lines: 14, dropLines: 3, dropWidth: 36, inkSize: 26 },
  { fontSize: 19, lineHeight: 29, width: 386, lines: 13, dropLines: 3, dropWidth: 40, inkSize: 28 },
  { fontSize: 21.5, lineHeight: 33, width: 400, lines: 12, dropLines: 3, dropWidth: 46, inkSize: 31 },
  { fontSize: 24, lineHeight: 36, width: 410, lines: 11, dropLines: 3, dropWidth: 52, inkSize: 34 },
];

export const DEFAULT_SCALE_INDEX = 2;

const SPACING: Record<LineSpacing, number> = { tight: 0.93, normal: 1, loose: 1.12 };

/** Page margin in px, and what that margin gives to (or takes from) the measure. */
const MARGINS: Record<Margins, { marginX: number; width: number }> = {
  narrow: { marginX: 36, width: 24 },
  normal: { marginX: 48, width: 0 },
  wide: { marginX: 64, width: -32 },
};

/** The book's full height, and how styles.css sizes it: `min(700px, 100vh - 110px)`. */
export const BOOK_HEIGHT = 700;
const DESK_OVERHEAD = 110;
/** Below this width the spread stacks into one column of sheets that grow to fit their lines. */
const STACKED_WIDTH = 900;
/** Fewest prose lines a page is given, however short the window. */
const MIN_LINES = 6;

export type Viewport = { width: number; height: number };

/** The height of the book on the desk, or null when the sheets stack and grow to fit. */
export function bookHeight(viewport: Viewport): number | null {
  if (viewport.width <= STACKED_WIDTH) return null;
  return Math.min(BOOK_HEIGHT, viewport.height - DESK_OVERHEAD);
}

function currentViewport(): Viewport | undefined {
  if (typeof window === "undefined" || !window.innerHeight) return undefined;
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The scale as laid: line spacing and the theme's leading fit inside the same
 * page height, margins trade with the measure, and a book shorter than its full
 * height gives up whole prose lines for every pixel it lacks (the running head,
 * folio and quill keep their size). `viewport` defaults to the window's.
 */
export function layoutScale(
  base: Scale,
  opts: { lineSpacing: LineSpacing; margins: Margins; viewport?: Viewport },
  theme: Theme,
): LaidScale {
  const lineHeight = Math.round(base.lineHeight * SPACING[opts.lineSpacing] * theme.leading);
  const budget = base.lines * base.lineHeight;
  const margin = MARGINS[opts.margins];
  let lines = lineHeight === base.lineHeight ? base.lines : Math.max(MIN_LINES, Math.floor(budget / lineHeight));
  const viewport = opts.viewport ?? currentViewport();
  const height = viewport ? bookHeight(viewport) : null;
  if (height != null && height < BOOK_HEIGHT) {
    const fit = Math.floor((budget - (BOOK_HEIGHT - height)) / lineHeight);
    lines = Math.min(lines, Math.max(MIN_LINES, fit));
  }
  return {
    ...base,
    lineHeight,
    lines,
    width: base.width + margin.width,
    marginX: margin.marginX,
  };
}

/** The footnotes' and slips' type size, as styles.css sets it. */
export const FOOT_SIZE = 15;
/** A footnote line: 15 px type at line-height 1.35. */
const FOOT_LINE = FOOT_SIZE * 1.35;
/** Each footnote's `li` margin (3 px, collapsing between notes). */
const FOOT_NOTE_GAP = 3;
/** The footnotes' rule above them: `.footnotes` margin-top 8, padding-top 8, border 1. */
export const FOOT_OVERHEAD = 17;

/**
 * Characters of footnote type in one line of the foot. The foot is at least as
 * wide as the prose measure, so measuring against that leaves room for word breaks.
 */
export function footChars(scale: Scale, averageChar = FOOT_SIZE * 0.46): number {
  return Math.max(24, Math.floor(scale.width / Math.max(1, averageChar)));
}

/**
 * Prose lines the page foot takes: the footnotes' rule and spacing, each
 * footnote its own lines (number and text, `chars` to a line), all in pixels
 * and rounded up to whole prose lines of `lineHeight`; then one line for each
 * slip or ask.
 */
export function footReserve(
  chars: number,
  lineHeight = SCALES[DEFAULT_SCALE_INDEX].lineHeight,
): (notes: { n: number; text: string }[], extra: number) => number {
  return (notes, extra) => {
    if (notes.length === 0) return extra;
    const px = notes.reduce(
      (sum, note) => sum + Math.max(1, Math.ceil(`${note.n}  ${note.text}`.length / chars)) * FOOT_LINE + FOOT_NOTE_GAP,
      FOOT_OVERHEAD + FOOT_NOTE_GAP,
    );
    return Math.ceil(px / Math.max(1, lineHeight)) + extra;
  };
}

export function footFont(theme?: Theme): string {
  return `${theme?.weight ?? 500} ${FOOT_SIZE}px ${theme?.face ?? SERIF}`;
}

export function proseFont(scale: Scale, theme?: Theme): string {
  return `${theme?.weight ?? 500} ${scale.fontSize}px ${theme?.face ?? SERIF}`;
}

export function inkFont(scale: Scale): string {
  return `500 ${scale.inkSize}px Caveat, cursive`;
}
