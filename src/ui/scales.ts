export type Scale = {
  fontSize: number;
  lineHeight: number;
  width: number;
  lines: number;
  dropLines: number;
  dropWidth: number;
  inkSize: number;
};

export const SCALES: Scale[] = [
  { fontSize: 17.5, lineHeight: 27, width: 372, lines: 14, dropLines: 3, dropWidth: 36, inkSize: 26 },
  { fontSize: 19, lineHeight: 29, width: 386, lines: 13, dropLines: 3, dropWidth: 40, inkSize: 28 },
  { fontSize: 21.5, lineHeight: 33, width: 400, lines: 12, dropLines: 3, dropWidth: 46, inkSize: 31 },
];

export function proseFont(scale: Scale): string {
  return `500 ${scale.fontSize}px "EB Garamond", Palatino, serif`;
}

export function inkFont(scale: Scale): string {
  return `500 ${scale.inkSize}px Caveat, cursive`;
}
