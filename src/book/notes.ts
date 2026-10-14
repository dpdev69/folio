/**
 * A margin note goes to the press as one prompt that quotes the passage. The
 * same words come back in the event stream and in history, so they are read
 * here to keep the note in the margin.
 */

export const NOTE_PREFIX = "About this passage:";

export function composeNote(quote: string, prompt: string): string {
  return `${NOTE_PREFIX}\n\n> ${quote.trim()}\n\n${prompt.trim()}`;
}

/** The quote and the question of a composed note, or undefined for any other prompt. */
export function parseNote(text: string): { quote: string; prompt: string } | undefined {
  if (!text.startsWith(NOTE_PREFIX)) return undefined;
  const lines = text.slice(NOTE_PREFIX.length).replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.startsWith(">"));
  if (first < 0) return undefined;
  let end = first;
  while (end < lines.length && lines[end].startsWith(">")) end += 1;
  const quote = lines
    .slice(first, end)
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ")
    .trim();
  const prompt = lines.slice(end).join("\n").trim();
  return quote ? { quote, prompt } : undefined;
}
