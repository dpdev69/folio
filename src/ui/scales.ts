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

export function layoutScale(
  base: Scale,
  opts: { lineSpacing: LineSpacing; margins: Margins },
  theme: Theme,
): LaidScale {
  const lineHeight = Math.round(base.lineHeight * SPACING[opts.lineSpacing] * theme.leading);
  const budget = base.lines * base.lineHeight;
  const margin = MARGINS[opts.margins];
  return {
    ...base,
    lineHeight,
    lines: lineHeight === base.lineHeight ? base.lines : Math.max(6, Math.floor(budget / lineHeight)),
    width: base.width + margin.width,
    marginX: margin.marginX,
  };
}

export function proseFont(scale: Scale, theme?: Theme): string {
  return `${theme?.weight ?? 500} ${scale.fontSize}px ${theme?.face ?? SERIF}`;
}

export function inkFont(scale: Scale): string {
  return `500 ${scale.inkSize}px Caveat, cursive`;
}
