/** A book is one repository. A chapter is one opencode session. */

export type Voice = "prose" | "ink";

export type ProseBlock = {
  id: string;
  voice: Voice;
  text: string;
  /** Skip the main flow. Marginal replies live on the note instead. */
  marginal?: boolean;
};

export type Footnote = {
  id: string;
  n: number;
  /** Character offset into the block this mark hangs from. */
  blockId: string;
  offset: number;
  text: string;
  plateId?: string;
  pending?: boolean;
};

export type PlateLine = {
  kind: "context" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
};

export type Plate = {
  id: string;
  n: number;
  /** The assistant message that made the change. */
  messageId?: string;
  /** The user message that began the turn, so the turn can be named and undone. */
  turnMessageId?: string;
  file: string;
  title: string;
  caption: string;
  lines: PlateLine[];
  /** The whole unified patch the lines come from, so Reject can undo exactly this change. */
  patch?: string;
  additions: number;
  deletions: number;
  status: "open" | "accepted" | "reverted";
  folded: boolean;
};

export type MarginNote = {
  id: string;
  quote: string;
  prompt: string;
  reply?: string;
  kept?: boolean;
  replaced?: boolean;
  pending?: boolean;
  /** The user message the note was sent as; only text of that turn is its reply. */
  messageId?: string;
};

export type PermissionAsk = {
  id: string;
  permission: string;
  patterns: string[];
  title: string;
  /** The proposed change, as a unified patch, when the press sent one. */
  patch?: string;
  /** The tool call the press holds until the reader answers; its plate is `plate-<callId>`. */
  callId?: string;
};

export type FormOption = { value: string; label: string; description?: string };

export type FormField = {
  key: string;
  title: string;
  description?: string;
  /** string, number, integer, boolean, multiselect, external. */
  type: string;
  options?: FormOption[];
  /** The reader may write an answer of their own. */
  custom?: boolean;
  min?: number;
  max?: number;
};

/** A question from the press, waiting for the reader. */
export type Form = { id: string; title: string; fields: FormField[] };

/** A tool call in progress. opencode 2.0 names a tool only when its input starts. */
export type ToolCall = { name: string; input: Record<string, unknown>; messageId?: string };

export type Chapter = {
  id: string;
  title: string;
  untitled: boolean;
  blocks: ProseBlock[];
  footnotes: Footnote[];
  plates: Plate[];
  notes: MarginNote[];
  asks: PermissionAsk[];
  forms: Form[];
  /** assistant message id → the user message id that began its turn. */
  turns?: Record<string, string>;
  /** tool call id → its name and input, so later events for the call can be worded. */
  calls?: Record<string, ToolCall>;
  busy: boolean;
  error?: string;
  /** A passing remark from the press, such as a retry. */
  notice?: string;
  /** Files changed since the plates were last set from the session diff. */
  diffStale?: boolean;
  /** The session's own rules make the press ask before it edits (see `asksFirst`). */
  askRules?: boolean;
};

export type Book = {
  id: string;
  title: string;
  directory: string;
  /** sample chapters never call the press. */
  sample: boolean;
  chapters: Chapter[];
};

export type FlowProse = {
  kind: "prose";
  id: string;
  voice: Voice;
  text: string;
  dropCap: boolean;
  marks: { offset: number; n: number; plateId?: string }[];
};

export type FlowBreak = { kind: "break" };

export type Flow = FlowProse | FlowBreak;

export function chapterRoman(index: number): string {
  return toRoman(index + 1);
}

export function toRoman(n: number): string {
  const pairs: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = Math.max(1, Math.floor(n));
  let out = "";
  for (const [value, glyph] of pairs) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

export function isUntitled(title: string | undefined): boolean {
  const t = (title ?? "").trim();
  if (!t) return true;
  return /^(untitled|new session|new chat)\b/i.test(t);
}

export function displayTitle(chapter: Chapter): string {
  return chapter.untitled ? "Untitled, in progress" : chapter.title;
}

/**
 * Whether a session's own permission rules make the press ask before an edit:
 * the last rule for edits (or for every action) decides, as in opencode.
 */
export function asksFirst(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  let asks = false;
  for (const rule of rules) {
    const r = rule && typeof rule === "object" ? (rule as Record<string, unknown>) : undefined;
    if (r && (r.action === "edit" || r.action === "*")) asks = r.effect === "ask";
  }
  return asks;
}
