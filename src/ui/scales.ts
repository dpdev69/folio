import { SERIF, type Theme } from "./themes";

export type Scale = {
  fontSize: number;
  lineHeight: number;
  width: number;
  /** Prose lines of a stacked sheet (below 900px wide), which grows to fit; on the desk the window decides. */
  lines: number;
  dropLines: number;
  dropWidth: number;
  inkSize: number;
};

/**
 * A scale after line spacing, margins, the theme's leading and the window are
 * applied. `lines` is the page's whole prose lines. `pageRoom` is the prose
 * lines the sheet physically holds, unrounded; `lines` is its whole part.
 * `quillLines` is the prose lines the quill block takes on its page, also
 * unrounded. `inkWeight` is the prose lines one wrapped line of the reader's ink
 * takes. `gapWeight` is the prose lines a paragraph gap takes. `width` is the
 * measure, never wider than the sheet's content box on the desk.
 */
export type LaidScale = Scale & { marginX: number; pageRoom: number; quillLines: number; inkWeight: number; gapWeight: number };

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

/*
 * The book on the desk, as styles.css `.book` sizes it:
 *   width:  min(1080px, calc(100vw - 48px))
 *   height: min(calc(100vh - 110px), calc(min(1080px, 100vw - 48px) / 2 * 1.55))
 * It takes the window's height, but a sheet (half the book) is never taller than
 * SHEET_RATIO times its width.
 */
/** `.book` width cap: `min(1080px, …)`. */
export const BOOK_MAX_WIDTH = 1080;
/** `.book` width: `calc(100vw - 48px)`. */
export const DESK_SIDES = 48;
/** `.book` height: `calc(100vh - 110px)`, the chrome above and the desk's margins. */
export const DESK_OVERHEAD = 110;
/** `.book` height cap: a sheet is at most 1.55 times as tall as it is wide. */
export const SHEET_RATIO = 1.55;

/*
 * What a sheet spends outside `.prose` when its foot is empty (styles.css):
 */
/** `.sheet` padding-top: `padding: 36px var(--margin-x) 22px`. */
export const SHEET_PAD_TOP = 36;
/** `.sheet` padding-bottom: `padding: 36px var(--margin-x) 22px`. */
export const SHEET_PAD_BOTTOM = 22;
/** `.running` line box: 12.5px small caps at the face's normal line height. */
export const RUNNING_LINE = 17;
/** `.running` margin-bottom: `margin: 0 0 22px`. */
export const RUNNING_GAP = 22;
/** `.folio-num` padding-top: `padding-top: 8px`. */
export const FOLIO_PAD = 8;
/** `.folio-num` line box: 14px at the face's normal line height. */
export const FOLIO_LINE = 19;
/** Pixels of a sheet outside its prose: padding, running head and folio. */
export const PAGE_OVERHEAD = SHEET_PAD_TOP + RUNNING_LINE + RUNNING_GAP + SHEET_PAD_BOTTOM + FOLIO_PAD + FOLIO_LINE;

/*
 * The quill block on the page that carries it (styles.css and Page.tsx).
 */
/** `.quill-block` margin-top. */
export const QUILL_TOP = 8;
/** `.ornament`: `height: 16px; margin: 8px auto 4px`. */
export const ORNAMENT_HEIGHT = 16;
export const ORNAMENT_ABOVE = 8;
export const ORNAMENT_BELOW = 4;
/** `textarea.quill` in Page.tsx: `rows={3}`; its rows, not its 72px min-height, set its height. */
export const QUILL_ROWS = 3;
/** `.quill`: `font-size: 28px; line-height: 1.2`. */
export const QUILL_FONT = 28;
export const QUILL_LEADING = 1.2;
/** A textarea's own padding (the browser's 2px above and below; `.quill` leaves it). */
export const QUILL_PAD = 2 + 2;
/** `.hint`: `margin: 4px 0 0`, one line of 14px type at the face's normal line height. */
export const HINT_GAP = 4;
export const HINT_FONT = 14;
export const HINT_LINE = 19;
export const QUILL_HEIGHT =
  QUILL_TOP +
  (ORNAMENT_ABOVE + ORNAMENT_HEIGHT + ORNAMENT_BELOW) +
  (QUILL_ROWS * QUILL_FONT * QUILL_LEADING + QUILL_PAD) +
  (HINT_GAP + HINT_LINE);

/** `.line.ink`: Caveat at `var(--ink-fs)` (the scale's `inkSize`), line-height 1.25, height auto. */
export const INK_LEADING = 1.25;

/** `.line.gap`: `height: calc(var(--lh) * 0.55)`, in prose lines. */
export const GAP_LINE = 0.55;

/** Below this width the spread stacks into one column of sheets that grow to fit their lines. */
export const STACKED_WIDTH = 900;
/** Fewest prose lines a page is given, however short the window. */
const MIN_LINES = 6;

export type Viewport = { width: number; height: number };

/** The height of the book on the desk, or null when the sheets stack and grow to fit. */
export function bookHeight(viewport: Viewport): number | null {
  if (viewport.width <= STACKED_WIDTH) return null;
  const sheetWidth = Math.min(BOOK_MAX_WIDTH, viewport.width - DESK_SIDES) / 2;
  return Math.min(viewport.height - DESK_OVERHEAD, sheetWidth * SHEET_RATIO);
}

/** The prose room of a sheet in a book this tall. */
export function proseHeight(height: number): number {
  return height - PAGE_OVERHEAD;
}

function currentViewport(): Viewport | undefined {
  if (typeof window === "undefined" || !window.innerHeight) return undefined;
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The scale as laid. On the desk a page holds as many prose lines as its sheet
 * has room for: the book's height, less the running head, folio and padding,
 * in lines of the laid leading. Stacked sheets grow to fit, so they keep the
 * scale's reference count (`lines`), its height shared out at the laid leading.
 * Margins trade with the measure. `viewport` defaults to the window's.
 */
export function layoutScale(
  base: Scale,
  opts: { lineSpacing: LineSpacing; margins: Margins; viewport?: Viewport },
  theme: Theme,
): LaidScale {
  const lineHeight = Math.round(base.lineHeight * SPACING[opts.lineSpacing] * theme.leading);
  const margin = MARGINS[opts.margins];
  const viewport = opts.viewport ?? currentViewport();
  const height = viewport ? bookHeight(viewport) : null;
  let lines: number;
  let pageRoom: number;
  let quillLines = 0;
  let width = base.width + margin.width;
  if (height == null) {
    lines = lineHeight === base.lineHeight ? base.lines : Math.max(MIN_LINES, Math.floor((base.lines * base.lineHeight) / lineHeight));
    pageRoom = lines;
  } else {
    lines = Math.max(MIN_LINES, Math.floor(proseHeight(height) / lineHeight));
    pageRoom = Math.max(lines, proseHeight(height) / lineHeight);
    quillLines = QUILL_HEIGHT / lineHeight;
    // A narrow window's sheet is narrower than the measure: keep every line inside its margins.
    const sheetWidth = Math.min(BOOK_MAX_WIDTH, viewport!.width - DESK_SIDES) / 2;
    width = Math.min(width, Math.floor(sheetWidth - 2 * margin.marginX));
  }
  return {
    ...base,
    lineHeight,
    lines,
    pageRoom,
    quillLines,
    inkWeight: (base.inkSize * INK_LEADING) / lineHeight,
    gapWeight: GAP_LINE,
    width,
    marginX: margin.marginX,
  };
}

/** The footnotes' and slips' type size, as styles.css sets it. */
export const FOOT_SIZE = 15;
/** `.footnotes` line-height. */
export const FOOT_LEADING = 1.35;
/** A footnote line: 15 px type at line-height 1.35. */
export const FOOT_LINE = FOOT_SIZE * FOOT_LEADING;
/** Each footnote's `li` margin: `.footnotes li { margin: 3px 0 }` (collapsing between notes). */
export const FOOT_NOTE_GAP = 3;
/** `.footnotes`: `margin: 8px 0 0; padding: 8px 0 0; border-top: 1px`. */
export const FOOT_RULE_MARGIN = 8;
export const FOOT_RULE_PAD = 8;
export const FOOT_RULE = 1;
/** The footnotes' rule above them: margin, padding and the rule itself. */
export const FOOT_OVERHEAD = FOOT_RULE_MARGIN + FOOT_RULE_PAD + FOOT_RULE;

/** `.footnotes + .slip`: margin-top 3px, no padding or rule, above a 15px line at 1.35. */
export const SLIP_AFTER_NOTES = 3 + FOOT_LINE;
/** `.slip` alone: `margin: 8px 0 0; padding: 6px 0 0; border-top: 1px`, above a 15px line at 1.35. */
export const SLIP_ALONE = 8 + 6 + 1 + FOOT_LINE;

/**
 * The share of a foot line counted as usable: breaking at words, and the
 * footnote's number column, waste up to about a tenth of it.
 */
export const FOOT_WRAP_SLACK = 0.9;

/**
 * Characters of footnote type in one line of the foot. The foot is as wide as
 * the sheet's content box, which the laid measure never exceeds, and only
 * FOOT_WRAP_SLACK of it is counted. This assumes the face's average character
 * width holds for the note's text; a run of wide letters can still wrap sooner.
 */
export function footChars(scale: Scale, averageChar = FOOT_SIZE * 0.46): number {
  return Math.max(24, Math.floor((scale.width * FOOT_WRAP_SLACK) / Math.max(1, averageChar)));
}

/**
 * Prose lines the page foot takes: the footnotes' rule and spacing, each
 * footnote its own lines (number and text, `chars` to a line), all in pixels
 * over `lineHeight`; then the slip (`extra`, 0 or 1) at its own height, which
 * is less below footnotes than alone. The result is in prose lines and may be
 * fractional, since paginate sums the weights of a page's lines.
 */
export function footReserve(
  chars: number,
  lineHeight = SCALES[DEFAULT_SCALE_INDEX].lineHeight,
): (notes: { n: number; text: string }[], extra: number) => number {
  return (notes, extra) => {
    const line = Math.max(1, lineHeight);
    if (notes.length === 0) return (extra * SLIP_ALONE) / line;
    const px = notes.reduce(
      (sum, note) => sum + wrappedLines(`${note.n}  ${note.text}`, chars) * FOOT_LINE + FOOT_NOTE_GAP,
      FOOT_OVERHEAD + FOOT_NOTE_GAP,
    );
    return (px + extra * SLIP_AFTER_NOTES) / line;
  };
}

/**
 * Lines `text` takes when wrapped greedily at word breaks, `chars` to a line;
 * a word longer than a line takes lines of its own. It assumes every character
 * is as wide as the average one.
 */
export function wrappedLines(text: string, chars: number): number {
  const width = Math.max(1, Math.floor(chars));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= width) {
      used = need;
      continue;
    }
    if (used > 0) lines += 1;
    // A word longer than the line runs over whole lines of its own.
    lines += Math.ceil(word.length / width) - 1;
    used = word.length % width || width;
  }
  return lines;
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
