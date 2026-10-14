import { parsePatch, plateLines } from "./diff";
import type { Chapter, Plate, PlateLine, ToolCall } from "./model";

/** A changed file as opencode 2.0 reports it, in tool metadata and in the session diff. */
export type FileDiff = { file: string; patch?: string; status?: string; additions?: number; deletions?: number };

/** The `files[]` of a tool's or a permission's metadata. */
export function filesOf(metadata: unknown): FileDiff[] {
  const files = recordOf(metadata)?.files;
  return Array.isArray(files) ? files.map(fileDiffOf).filter((f): f is FileDiff => Boolean(f)) : [];
}

/**
 * The plate of an edit or write. Its lines come from the tool's patch once it
 * has one, and from the edit's own strings until then, so it is never empty.
 */
export function toolPlate(
  plates: Plate[],
  id: string,
  call: ToolCall,
  files: FileDiff[],
  turnMessageId: string | undefined,
): { plates: Plate[]; plate?: Plate } {
  const existing = plates.find((p) => p.id === id);
  const path = firstString(call.input, ["path", "filePath", "file", "file_path"]);
  const entry = files.find((f) => f.file === path && f.patch) ?? files.find((f) => f.patch);
  let lines: PlateLine[];
  let additions: number;
  let deletions: number;
  if (entry?.patch) {
    lines = parsePatch(entry.patch);
    additions = entry.additions ?? count(lines, "add");
    deletions = entry.deletions ?? count(lines, "del");
  } else {
    const before = firstString(call.input, ["oldString", "old_string"]) ?? "";
    const after = firstString(call.input, ["newString", "new_string", "content"]) ?? "";
    if (!before && !after) return { plates, plate: existing };
    const full = plateLines(before, after, { context: 1, maxLines: Infinity });
    lines = plateLines(before, after, { context: 1, maxLines: 41 });
    additions = count(full, "add");
    deletions = count(full, "del");
  }
  if (!lines.length) return { plates, plate: existing };
  const file = entry?.file ?? path ?? "the file";
  const plate: Plate = {
    id,
    n: existing?.n ?? plates.length + 1,
    messageId: call.messageId,
    turnMessageId: existing?.turnMessageId ?? turnMessageId,
    file,
    title: basename(file),
    caption: captionFor(entry?.status, file),
    lines,
    patch: entry?.patch ?? existing?.patch,
    additions,
    deletions,
    status: existing?.status ?? "open",
    folded: existing?.folded ?? false,
  };
  return { plates: existing ? plates.map((p) => (p.id === id ? plate : p)) : [...plates, plate], plate };
}

/** A declined edit never happened; take its plate away if it is the latest. */
export function dropPlate(plates: Plate[], id: string): Plate[] {
  const plate = plates.find((p) => p.id === id);
  if (!plate || plates.some((p) => p.n > plate.n)) return plates;
  return plates.filter((p) => p.id !== id);
}

/**
 * Set plates from the session diff for the current turn, one per file.
 *
 * The hook fetches `GET /api/session/{id}/diff?from=<turnMessageId>`, where
 * `turnMessageId` is the user message id that began the current turn, so each
 * patch covers that turn only (without `from` the diff is cumulative for the
 * whole session). A patch updates the latest plate for its file in that turn,
 * keeping its number, status and fold; a file with no plate in the turn gets a
 * plate of its own. Plates of earlier turns are left alone.
 *
 * A diff plate's id names its file and its turn, `diff-<file>@<turnMessageId>`,
 * so a reload that rebuilds only the latest turn gives that plate the same id
 * it had before, and the reader's kept Accept or Reject finds it again. Only a
 * frame with no turn at all (which carries no patch) falls back to `diff-<file>`.
 *
 * The diff sets a plate's lines, never a patch the plate already has: a tool's
 * patch covers that one edit, while the turn's patch covers every edit to the
 * file, and Reject reverses `plate.patch`. A diff patch only fills a plate that
 * has none, and an `unscoped` diff (the whole session's) fills none at all.
 */
export function applyDiff(chapter: Chapter, raw: unknown, turnMessageId: string | undefined, unscoped = false): Chapter {
  if (!Array.isArray(raw)) return chapter;
  let plates = chapter.plates;
  for (const item of raw) {
    const diff = fileDiffOf(item);
    if (!diff) continue;
    const lines = diff.patch ? parsePatch(diff.patch) : [];
    const existing = plates.filter((p) => p.file === diff.file && p.turnMessageId === turnMessageId).pop();
    if (!existing && !lines.length) continue;
    const id = existing?.id ?? diffPlateId(diff.file, turnMessageId);
    const plate: Plate = {
      id,
      n: existing?.n ?? plates.length + 1,
      messageId: existing?.messageId,
      turnMessageId,
      file: diff.file,
      title: existing?.title ?? basename(diff.file),
      caption: captionFor(diff.status, diff.file),
      lines: lines.length ? lines : existing!.lines,
      patch: existing?.patch ?? (lines.length && !unscoped ? diff.patch : undefined),
      additions: diff.additions ?? existing?.additions ?? count(lines, "add"),
      deletions: diff.deletions ?? existing?.deletions ?? count(lines, "del"),
      status: existing?.status ?? "open",
      folded: existing?.folded ?? false,
    };
    plates = existing ? plates.map((p) => (p.id === existing.id ? plate : p)) : [...plates, plate];
  }
  return { ...chapter, plates, diffStale: false };
}

/** The id of a plate set from the session diff: the same for a file's turn on every read. */
export function diffPlateId(file: string, turnMessageId: string | undefined): string {
  return turnMessageId ? `diff-${file}@${turnMessageId}` : `diff-${file}`;
}

function captionFor(status: string | undefined, file: string): string {
  if (status === "added") return `New file ${file}.`;
  if (status === "deleted") return `Removed ${file}.`;
  return `The change in ${file}.`;
}

function fileDiffOf(raw: unknown): FileDiff | undefined {
  const item = recordOf(raw);
  const file = typeof item?.file === "string" ? item.file : undefined;
  if (!item || !file) return undefined;
  return {
    file,
    patch: typeof item.patch === "string" ? item.patch : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    additions: typeof item.additions === "number" ? item.additions : undefined,
    deletions: typeof item.deletions === "number" ? item.deletions : undefined,
  };
}

function basename(file: string): string {
  return file.split("/").pop() || file;
}

function count(lines: PlateLine[], kind: PlateLine["kind"]): number {
  return lines.filter((line) => line.kind === kind).length;
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
