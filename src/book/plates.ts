import { parsePatch, plateLines, PLATE_LINES } from "./diff";
import { toRoman, type Chapter, type Plate, type PlateLine, type ToolCall } from "./model";
import { firstString, recordOf } from "./values";

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
 * A patch the plate already holds (the one a permission ask proposed) keeps
 * setting its lines, so a later call frame with only the strings cannot take
 * the real line numbers away again.
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
  const patch = entry?.patch ?? existing?.patch;
  if (entry?.patch) {
    lines = parsePatch(entry.patch);
    additions = entry.additions ?? count(lines, "add");
    deletions = entry.deletions ?? count(lines, "del");
  } else if (patch && existing) {
    lines = parsePatch(patch);
    additions = existing.additions;
    deletions = existing.deletions;
  } else {
    const own = stringsLines(call);
    if (!own) return { plates, plate: existing };
    ({ lines, additions, deletions } = own);
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
    patch,
    additions,
    deletions,
    ...changeOf(entry?.status ?? existing?.change),
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
 * has none and is the turn's only plate for the file (with two, the turn's
 * patch is neither one's, so Reject refuses), and an `unscoped` diff (the
 * whole session's) fills none at all.
 *
 * With two or more plates for a file in the turn, no plate takes the turn's
 * lines: one that holds its own patch keeps its own lines and counts (the
 * turn's patch would show A+B on a plate whose Reject undoes only B), and one
 * without shows its edit's own strings, or a caption naming the plate to see.
 *
 * A plate the diff itself made (`diff-<file>@<turn>`) takes each later scoped
 * diff's patch and lines while it is open; once answered, its patch is kept.
 */
export function applyDiff(chapter: Chapter, raw: unknown, turnMessageId: string | undefined, unscoped = false): Chapter {
  if (!Array.isArray(raw)) return chapter;
  let plates = chapter.plates;
  for (const item of raw) {
    const diff = fileDiffOf(item);
    if (!diff) continue;
    const lines = diff.patch ? parsePatch(diff.patch) : [];
    const same = plates.filter((p) => p.file === diff.file && p.turnMessageId === turnMessageId);
    const existing = same[same.length - 1];
    // The turn's patch covers every edit to the file in the turn; it is a plate's own only if that plate is the only one.
    const owns = !unscoped && same.length <= 1;
    if (!existing && !lines.length) continue;
    if (same.length > 1) {
      // Each plate shows its own change; one with no patch of its own never shows the turn's.
      plates = plates.map((p) => (same.includes(p) && !p.patch ? partOfLarger(p, same, chapter) : p));
      continue;
    }
    const id = existing?.id ?? diffPlateId(diff.file, turnMessageId);
    // A plate the diff made follows the diff while it is open: a later diff for the turn covers more.
    const refresh = owns && existing?.id === diffPlateId(diff.file, turnMessageId) && existing.status === "open" && lines.length > 0;
    const plate: Plate = {
      id,
      n: existing?.n ?? plates.length + 1,
      messageId: existing?.messageId,
      turnMessageId,
      file: diff.file,
      title: existing?.title ?? basename(diff.file),
      caption: captionFor(diff.status, diff.file),
      lines: lines.length ? lines : existing!.lines,
      patch: refresh ? diff.patch : (existing?.patch ?? (lines.length && owns ? diff.patch : undefined)),
      additions: diff.additions ?? (refresh ? undefined : existing?.additions) ?? count(lines, "add"),
      deletions: diff.deletions ?? (refresh ? undefined : existing?.deletions) ?? count(lines, "del"),
      ...changeOf(diff.status ?? existing?.change),
      status: existing?.status ?? "open",
      folded: existing?.folded ?? false,
    };
    plates = existing ? plates.map((p) => (p.id === existing.id ? plate : p)) : [...plates, plate];
  }
  return { ...chapter, plates, diffStale: false };
}

/**
 * A plate with no patch of its own among two or more for one file in a turn:
 * its lines come from its edit's own strings, or, with none, its caption says
 * where the change can be seen.
 */
function partOfLarger(plate: Plate, same: Plate[], chapter: Chapter): Plate {
  const callId = plate.id.startsWith("plate-") ? plate.id.slice("plate-".length) : undefined;
  const call = callId ? chapter.calls?.[callId] : undefined;
  const own = call ? stringsLines(call) : undefined;
  if (own) return { ...plate, ...own };
  const others = same.filter((p) => p.id !== plate.id);
  const see = [...others].reverse().find((p) => p.patch) ?? others[others.length - 1];
  const caption = see
    ? `The change is part of a larger edit to ${plate.file}; see Plate ${toRoman(see.n)}.`
    : `The change is part of a larger edit to ${plate.file}.`;
  return { ...plate, lines: [], additions: 0, deletions: 0, caption };
}

/** The lines and counts of an edit from its own strings, before or without a patch. */
function stringsLines(call: ToolCall): { lines: PlateLine[]; additions: number; deletions: number } | undefined {
  const before = firstString(call.input, ["oldString", "old_string"]) ?? "";
  const after = firstString(call.input, ["newString", "new_string", "content"]) ?? "";
  if (!before && !after) return undefined;
  const full = plateLines(before, after, { context: 1, maxLines: Infinity });
  const lines = plateLines(before, after, { context: 1, maxLines: PLATE_LINES });
  if (!lines.length) return undefined;
  return { lines, additions: count(full, "add"), deletions: count(full, "del") };
}

/** The id of a plate set from the session diff: the same for a file's turn on every read. */
export function diffPlateId(file: string, turnMessageId: string | undefined): string {
  return turnMessageId ? `diff-${file}@${turnMessageId}` : `diff-${file}`;
}

function changeOf(status: string | undefined): Pick<Plate, "change"> {
  return status === "added" || status === "deleted" || status === "modified" ? { change: status } : {};
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

