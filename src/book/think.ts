/**
 * Some models leak their reasoning into a text part: a stray `</think>` at its
 * start, or a whole `<think>…</think>` block before the answer. Neither is
 * prose the reader was sent.
 */

const CLOSED = /^\s*<think>[\s\S]*?<\/think>\s*/;
const STRAY = /^\s*<\/think>\s*/;

/** The text with a leading reasoning block or stray closing tag taken off. */
export function stripThink(text: string): string {
  if (CLOSED.test(text)) return text.replace(CLOSED, "");
  if (STRAY.test(text)) return text.replace(STRAY, "");
  return text;
}

/**
 * What the page may show of a part still streaming: nothing while it is inside
 * an open `<think>` or has only begun a tag that may turn out to be one.
 */
export function shownProse(text: string): string {
  const start = text.trimStart();
  if (!start.startsWith("<")) return text;
  if (start.startsWith("<think>") && !start.includes("</think>")) return "";
  if ("<think>".startsWith(start) || "</think>".startsWith(start)) return "";
  return text;
}
