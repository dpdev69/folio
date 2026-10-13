/**
 * Undo a unified patch: given the file as it is now (the patch's "after"),
 * return it as it was before. Every hunk's context and added lines must match
 * the file exactly where the hunk says; otherwise the file has moved on and
 * this returns null rather than guess.
 *
 * A minimal stand-in until `reversePatch` lands in `src/book/diff.ts` (Task 4).
 */
export function reversePatch(current: string, patch: string): string | null {
  const hunks = parseHunks(patch);
  if (!hunks) return null;
  const lines = current.split("\n");
  // A trailing newline leaves an empty last element; keep it out of the line count.
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  let shift = 0;
  let oldEndsBare = false;
  let newEndsBare = false;
  for (const hunk of hunks) {
    const after = hunk.lines.filter((l) => l.mark !== "-").map((l) => l.text);
    const before = hunk.lines.filter((l) => l.mark !== "+").map((l) => l.text);
    const at = (hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1) + shift;
    if (at < 0 || at + after.length > lines.length) return null;
    for (let i = 0; i < after.length; i++) if (lines[at + i] !== after[i]) return null;
    lines.splice(at, after.length, ...before);
    shift += before.length - after.length;
    oldEndsBare ||= hunk.oldEndsBare;
    newEndsBare ||= hunk.newEndsBare;
  }
  if (!lines.length) return "";
  // "\ No newline at end of file" after a removed line: the old file had none.
  const endsWithNewline = oldEndsBare ? false : newEndsBare ? true : trailing;
  return lines.join("\n") + (endsWithNewline ? "\n" : "");
}

type Hunk = {
  newStart: number;
  newCount: number;
  lines: { mark: " " | "+" | "-"; text: string }[];
  oldEndsBare: boolean;
  newEndsBare: boolean;
};

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(patch: string): Hunk[] | null {
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let last: " " | "+" | "-" | null = null;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (hunk && raw.startsWith("\\")) {
      if (last === "-") hunk.oldEndsBare = true;
      else if (last === "+") hunk.newEndsBare = true;
      else if (last === " ") hunk.oldEndsBare = hunk.newEndsBare = true;
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) {
      const header = HEADER.exec(raw);
      if (!header) continue;
      hunk = {
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
        oldEndsBare: false,
        newEndsBare: false,
      };
      oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      newLeft = hunk.newCount;
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const mark = raw[0] === "+" || raw[0] === "-" ? raw[0] : " ";
    // Some tools trim the lone space from an empty context line.
    const text = raw[0] === "+" || raw[0] === "-" || raw[0] === " " ? raw.slice(1) : raw;
    hunk.lines.push({ mark, text });
    last = mark;
    if (mark !== "+") oldLeft -= 1;
    if (mark !== "-") newLeft -= 1;
  }
  return hunks.length ? hunks : null;
}
