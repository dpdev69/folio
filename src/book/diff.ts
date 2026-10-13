import type { PlateLine } from "./model";

type Row =
  | { kind: "eq"; text: string; oldNo: number; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "add"; text: string; newNo: number };

/** A small line diff. Long files are truncated before the comparison. */
export function plateLines(before: string, after: string, opts?: { context?: number; maxLines?: number }): PlateLine[] {
  const context = opts?.context ?? 1;
  const maxLines = opts?.maxLines ?? 48;
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
    ...lines.slice(0, maxLines),
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
  const maxLines = opts?.maxLines ?? 42;
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
