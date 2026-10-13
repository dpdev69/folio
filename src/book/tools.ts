/** Plain-language footnotes. Tool calls never sit in the prose. */
import { plateLines } from "./diff";
import { toRoman } from "./model";

export type ToolLike = {
  tool: string;
  /** opencode 1.x sent one; 2.0 does not, so wording comes from the name and input. */
  title?: string;
  input?: Record<string, unknown>;
  status?: "pending" | "running" | "completed" | "error";
  output?: string;
  error?: string;
  /** The reader turned the call down, or interrupted it. */
  declined?: boolean;
  /** Line counts from the patch, when the press sent one. */
  additions?: number;
  deletions?: number;
  startedAt?: number;
  endedAt?: number;
};

export function footnoteSentence(tool: ToolLike, plateNumber?: number): { text: string; opensPlate: boolean } {
  const name = tool.tool.toLowerCase();
  const file = firstString(tool.input, ["filePath", "file", "path", "file_path"]);
  const command = firstString(tool.input, ["command", "cmd"]);
  const title = tool.title?.trim();
  const time = duration(tool);

  if (tool.status === "error" && tool.declined) return { text: declinedSentence(name, file, command), opensPlate: false };

  if (name === "bash" || name === "shell") {
    const what = title || command || "a command";
    if (tool.status === "running" || tool.status === "pending") {
      return { text: `Running ${what}…`, opensPlate: false };
    }
    if (tool.status === "error") return { text: `${what} failed${reason(tool.error)}.`, opensPlate: false };
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
    const which = file ?? title ?? "a file";
    if (tool.status === "error") return { text: `The edit to ${which} failed${reason(tool.error)}.`, opensPlate: false };
    if (tool.status === "running" || tool.status === "pending") {
      return { text: `Editing ${which}…`, opensPlate: true };
    }
    const plate = plateNumber ? ` See Plate ${toRoman(plateNumber)} →` : "";
    return { text: `Edited ${which}${editCounts(tool)}.${plate}`, opensPlate: true };
  }

  if (name === "question") {
    const questions = Array.isArray(tool.input?.questions) ? (tool.input.questions as unknown[]) : [];
    if (tool.status === "running" || tool.status === "pending") return { text: "Waiting for an answer…", opensPlate: false };
    if (questions.length > 1) return { text: `Asked ${questions.length} questions.`, opensPlate: false };
    const first = questions[0] && typeof questions[0] === "object" ? (questions[0] as Record<string, unknown>) : {};
    const asked = firstString(first, ["question", "header"]);
    return { text: asked ? `Asked a question: ${sentence(asked)}` : "Asked a question.", opensPlate: false };
  }

  if (name === "webfetch") {
    const url = firstString(tool.input, ["url"]) ?? "a page";
    if (tool.status === "running" || tool.status === "pending") return { text: `Fetching ${url}…`, opensPlate: false };
    if (tool.status === "error") return { text: `Could not fetch ${url}${reason(tool.error)}.`, opensPlate: false };
    return { text: `Fetched ${url}.`, opensPlate: false };
  }

  if (name === "websearch") {
    const query = firstString(tool.input, ["query"]) ?? "an answer";
    if (tool.status === "running" || tool.status === "pending") {
      return { text: `Searching the web for ${query}…`, opensPlate: false };
    }
    return { text: `Searched the web for ${query}.`, opensPlate: false };
  }

  const label = title || tool.tool;
  if (tool.status === "error") return { text: `${label} failed.`, opensPlate: false };
  if (tool.status === "running" || tool.status === "pending") return { text: `${label}…`, opensPlate: false };
  return { text: `${label}.`, opensPlate: false };
}

function declinedSentence(name: string, file: string | undefined, command: string | undefined): string {
  if (isEdit(name)) return `The edit to ${file ?? "a file"} was declined.`;
  if (name === "bash" || name === "shell") return `The request to run ${command ?? "a command"} was declined.`;
  if (name === "read") return `The request to read ${file ?? "a file"} was declined.`;
  if (name === "question") return "The question was set aside.";
  return `The ${name} call was declined.`;
}

/** "4 lines added", "2 lines removed and 1 added", from the patch counts or the edit's own strings. */
function editCounts(tool: ToolLike): string {
  let added = tool.additions;
  let removed = tool.deletions;
  if (added == null || removed == null) {
    const before = firstString(tool.input, ["oldString", "old_string"]) ?? "";
    const after = firstString(tool.input, ["newString", "new_string", "content"]) ?? "";
    const lines = before || after ? plateLines(before, after, { context: 0, maxLines: Infinity }) : [];
    added = lines.filter((line) => line.kind === "add").length;
    removed = lines.filter((line) => line.kind === "del").length;
  }
  const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
  if (added && removed) return `, ${lines(removed)} removed and ${added} added`;
  if (added) return `, ${lines(added)} added`;
  if (removed) return `, ${lines(removed)} removed`;
  return "";
}

/** ": the reason", without a doubled full stop. */
function reason(error: string | undefined): string {
  const text = error ? clip(error).replace(/[.\s]+$/, "") : "";
  return text ? `: ${text}` : "";
}

/** End with a full stop unless the text already ends a sentence. */
function sentence(text: string): string {
  return /[.?!…]$/.test(text) ? text : `${text}.`;
}

/** Tools that change a file, and so open a plate. */
export function isEdit(name: string): boolean {
  return ["edit", "write", "apply_patch", "multiedit", "patch"].includes(name.toLowerCase());
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
