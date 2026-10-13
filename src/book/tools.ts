/** Plain-language footnotes. Tool calls never sit in the prose. */

export type ToolLike = {
  tool: string;
  title?: string;
  input?: Record<string, unknown>;
  status?: "pending" | "running" | "completed" | "error";
  output?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
};

export function footnoteSentence(tool: ToolLike, plateNumber?: number): { text: string; opensPlate: boolean } {
  const name = tool.tool.toLowerCase();
  const file = firstString(tool.input, ["filePath", "file", "path", "file_path"]);
  const command = firstString(tool.input, ["command", "cmd"]);
  const title = tool.title?.trim();
  const time = duration(tool);

  if (name === "bash" || name === "shell") {
    const what = title || command || "a command";
    if (tool.status === "running" || tool.status === "pending") {
      return { text: `Running ${what}…`, opensPlate: false };
    }
    if (tool.status === "error") {
      return { text: `${what} failed${tool.error ? `: ${clip(tool.error)}` : ""}.`, opensPlate: false };
    }
    const detail = summarizeOutput(tool.output);
    return {
      text: `Ran ${what}${detail ? `. ${detail}` : ""}${time}.`,
      opensPlate: false,
    };
  }

  if (name === "read") {
    const span = lineSpan(tool.input);
    const where = file ? `${file}${span}` : "a file";
    return { text: `Read ${where}.`, opensPlate: false };
  }

  if (name === "grep" || name === "glob" || name === "list") {
    const pattern = firstString(tool.input, ["pattern", "query", "glob"]);
    return {
      text: pattern ? `Looked for ${pattern}${file ? ` in ${file}` : ""}.` : `Looked through ${file ?? "the tree"}.`,
      opensPlate: false,
    };
  }

  if (isEdit(name)) {
    const removed = countLines(firstString(tool.input, ["oldString", "old_string"]));
    const added = countLines(firstString(tool.input, ["newString", "new_string", "content"]));
    const counts =
      removed || added
        ? `, ${removed} ${removed === 1 ? "line" : "lines"} removed and ${added} added`
        : "";
    const plate = plateNumber ? ` See Plate ${plateNumber} →` : "";
    const which = file ?? title ?? "a file";
    if (tool.status === "running" || tool.status === "pending") {
      return { text: `Editing ${which}…`, opensPlate: true };
    }
    return { text: `Edited ${which}${counts}.${plate}`, opensPlate: true };
  }

  const label = title || tool.tool;
  if (tool.status === "error") return { text: `${label} failed.`, opensPlate: false };
  if (tool.status === "running" || tool.status === "pending") return { text: `${label}…`, opensPlate: false };
  return { text: `${label}.`, opensPlate: false };
}

function isEdit(name: string): boolean {
  return ["edit", "write", "apply_patch", "multiedit", "patch"].includes(name);
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function lineSpan(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const offset = numberAt(input, ["offset", "start"]);
  const limit = numberAt(input, ["limit", "count"]);
  if (offset && limit) return `, lines ${offset}–${offset + limit - 1}`;
  if (offset) return `, from line ${offset}`;
  return "";
}

function numberAt(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.split("\n").filter((line) => line.length > 0).length;
}

function duration(tool: ToolLike): string {
  if (tool.startedAt == null || tool.endedAt == null || tool.endedAt < tool.startedAt) return "";
  const seconds = (tool.endedAt - tool.startedAt) / 1000;
  const shown = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(1);
  return ` · ${shown} s`;
}

function summarizeOutput(output: string | undefined): string {
  if (!output) return "";
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line) return "";
  return clip(line);
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}
