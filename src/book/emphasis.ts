export type ItalicRange = [number, number];

/**
 * Pull *emphasis* and short `code` into italic ranges and return plain text.
 * Longer fenced blocks are flattened to sentences so a tool dump cannot
 * interrupt the page; the real diff still arrives as a plate.
 */
export function toProse(input: string): { text: string; italics: ItalicRange[] } {
  let src = input.replace(/\r\n/g, "\n");
  src = src.replace(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g, (_m, body: string) => {
    const lines = body.trim().split("\n").slice(0, 8);
    return lines.join(" ").replace(/\s+/g, " ").trim();
  });
  src = src.replace(/^#{1,6}\s+/gm, "");
  src = src.replace(/^\s*[-*]\s+/gm, "");
  src = src.replace(/^\s*\d+\.\s+/gm, "");
  // Quoted passages (margin-note context) set as epigraph lines, not raw markdown.
  src = src.replace(/^\s*>\s?/gm, "— ");

  const italics: ItalicRange[] = [];
  let text = "";
  const pattern = /\*([^*\n]+)\*|`([^`\n]{1,48})`/g;
  let last = 0;
  for (const match of src.matchAll(pattern)) {
    const start = match.index ?? 0;
    text += src.slice(last, start);
    const inner = match[1] ?? match[2] ?? "";
    const from = text.length;
    text += inner;
    italics.push([from, text.length]);
    last = start + match[0].length;
  }
  text += src.slice(last);
  return { text, italics };
}

export function italicsOnLine(
  italics: ItalicRange[],
  lineStart: number,
  lineText: string,
): ItalicRange[] {
  const lineEnd = lineStart + lineText.length;
  const out: ItalicRange[] = [];
  for (const [a, b] of italics) {
    const from = Math.max(a, lineStart);
    const to = Math.min(b, lineEnd);
    if (to > from) out.push([from - lineStart, to - lineStart]);
  }
  return out;
}
