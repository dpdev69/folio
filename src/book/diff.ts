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
