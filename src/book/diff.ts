import type { PlateLine } from "./model";

type Row =
  | { kind: "eq"; text: string; oldNo: number; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "add"; text: string; newNo: number };

/**
 * The number a plate prints beside a line: where it stands in the file after
 * the change, or, for a removed line, where it stood before.
 */
export function shownLineNumber(line: PlateLine): number | undefined {
  return line.kind === "del" ? line.oldNo : (line.newNo ?? line.oldNo);
}

/** The most lines a plate shows, its closing fold or ellipsis line included. */
export const PLATE_LINES = 42;

/**
 * A small line diff. Long files are truncated before the comparison; the
 * plate is capped at `maxLines`, its last line a fold note when cut short.
 */
export function plateLines(before: string, after: string, opts?: { context?: number; maxLines?: number }): PlateLine[] {
  const context = opts?.context ?? 1;
  const maxLines = opts?.maxLines ?? PLATE_LINES;
  const a = cap(before, 500);
  const b = cap(after, 500);
  const rows = diff(a, b);
  const hunks = withContext(rows, context);
  const lines: PlateLine[] = hunks.map((row) => {
    if (row.kind === "eq" && row.text === "…") return { kind: "context", text: "…" };
    if (row.kind === "eq") return { kind: "context", text: row.text, oldNo: row.oldNo, newNo: row.newNo };
    if (row.kind === "del") return { kind: "del", text: row.text, oldNo: row.oldNo };
    return { kind: "add", text: row.text, newNo: row.newNo };
  });
  if (lines.length <= maxLines) return lines;
  return [
    ...lines.slice(0, maxLines - 1),
    { kind: "context", text: "The rest of this plate is folded.", oldNo: undefined, newNo: undefined },
  ];
}

function cap(source: string, max: number): string[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), "…"];
}

function diff(a: string[], b: string[]): Row[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "eq", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", text: a[i], oldNo: i + 1 });
      i += 1;
    } else {
      rows.push({ kind: "add", text: b[j], newNo: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", text: a[i], oldNo: i + 1 });
    i += 1;
  }
  while (j < m) {
    rows.push({ kind: "add", text: b[j], newNo: j + 1 });
    j += 1;
  }
  return rows;
}

function withContext(rows: Row[], context: number): Row[] {
  const changed = rows.map((row) => row.kind !== "eq");
  const keep = changed.map((flag, index) => {
    if (flag) return true;
    for (let k = 1; k <= context; k++) {
      if (changed[index - k] || changed[index + k]) return true;
    }
    return false;
  });
  const out: Row[] = [];
  let skipping = false;
  rows.forEach((row, index) => {
    if (!keep[index]) {
      skipping = true;
      return;
    }
    if (skipping && out.length) {
      out.push({ kind: "eq", text: "…", oldNo: 0, newNo: 0 });
    }
    skipping = false;
    out.push(row);
  });
  return out;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Plate lines from a unified diff: a git patch (`diff --git`) or a tool patch
 * (`Index:`). Headers are skipped, hunks are separated by an ellipsis, and the
 * plate is capped at `maxLines`, its last line an ellipsis when cut short.
 */
export function parsePatch(patch: string, opts?: { maxLines?: number }): PlateLine[] {
  const maxLines = opts?.maxLines ?? PLATE_LINES;
  const lines: PlateLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (oldLeft <= 0 && newLeft <= 0) {
      // Outside a hunk only a hunk header matters; file headers are skipped.
      const hunk = HUNK.exec(raw);
      if (!hunk) continue;
      if (lines.length) lines.push({ kind: "context", text: "…" });
      oldNo = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newNo = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      continue;
    }
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === "\\") continue;
    if (mark === "-") {
      lines.push({ kind: "del", text, oldNo });
      oldNo += 1;
      oldLeft -= 1;
    } else if (mark === "+") {
      lines.push({ kind: "add", text, newNo });
      newNo += 1;
      newLeft -= 1;
    } else {
      // A context line; some tools trim the lone space from an empty one.
      lines.push({ kind: "context", text, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      oldLeft -= 1;
      newLeft -= 1;
    }
  }
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), { kind: "context", text: "…" }];
}

/** How far a hunk may have moved from where its header says, in lines. */
const FUZZ = 3;

/**
 * Undo a unified patch: given the file as it is now (the patch's "after"),
 * return it as it was before. Each hunk's context and added lines must match
 * the file exactly, where the hunk says or up to three lines either side (an
 * edit above it may have moved it); otherwise the file has moved on and this
 * returns null rather than guess. A file with CRLF endings keeps them.
 */
export function reversePatch(current: string, patch: string): string | null {
  const hunks = parseHunks(patch);
  if (!hunks) return null;
  // Patches are read with LF endings; a file kept with CRLF is written back with CRLF.
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  // A trailing newline leaves an empty last element; keep it out of the line count.
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  let shift = 0;
  let floor = 0;
  let oldEndsBare = false;
  let newEndsBare = false;
  for (const hunk of hunks) {
    const after = hunk.lines.filter((l) => l.mark !== "-").map((l) => l.text);
    const before = hunk.lines.filter((l) => l.mark !== "+").map((l) => l.text);
    const expected = (hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1) + shift;
    const at = findBlock(lines, after, expected, floor);
    if (at === null) return null;
    lines.splice(at, after.length, ...before);
    // Later hunks move with this one's offset as well as its change in length.
    shift += at - expected + before.length - after.length;
    floor = at + before.length;
    oldEndsBare ||= hunk.oldEndsBare;
    newEndsBare ||= hunk.newEndsBare;
  }
  if (!lines.length) return "";
  // "\ No newline at end of file" after a removed line: the old file had none.
  const endsWithNewline = oldEndsBare ? false : newEndsBare ? true : trailing;
  return lines.join(eol) + (endsWithNewline ? eol : "");
}

/**
 * Whether a patch creates its file (nothing on the old side) or removes it
 * (nothing on the new side): git's `/dev/null` headers, or failing those,
 * hunks that all start from or end in zero lines.
 */
export function patchSides(patch: string): { oldEmpty: boolean; newEmpty: boolean } {
  const text = patch.replace(/\r\n/g, "\n");
  const hunks = [...text.matchAll(new RegExp(HUNK.source, "gm"))];
  const all = (side: 2 | 4) => hunks.length > 0 && hunks.every((h) => h[side] !== undefined && Number(h[side]) === 0);
  return {
    oldEmpty: /^--- \/dev\/null$/m.test(text) || /^new file mode/m.test(text) || all(2),
    newEmpty: /^\+\+\+ \/dev\/null$/m.test(text) || /^deleted file mode/m.test(text) || all(4),
  };
}

/** Where `block` sits in `lines`, nearest `expected` first, never before `floor`. */
function findBlock(lines: string[], block: string[], expected: number, floor: number): number | null {
  for (let distance = 0; distance <= FUZZ; distance++) {
    for (const at of distance ? [expected - distance, expected + distance] : [expected]) {
      if (at < floor || at + block.length > lines.length) continue;
      if (block.every((text, i) => lines[at + i] === text)) return at;
    }
  }
  return null;
}

type Hunk = {
  newStart: number;
  newCount: number;
  lines: { mark: " " | "+" | "-"; text: string }[];
  oldEndsBare: boolean;
  newEndsBare: boolean;
};

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
      const header = HUNK.exec(raw);
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
