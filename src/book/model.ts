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
  messageId?: string;
  file: string;
  title: string;
  caption: string;
  lines: PlateLine[];
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
};

export type PermissionAsk = {
  id: string;
  permission: string;
  patterns: string[];
  title: string;
};

export type Chapter = {
  id: string;
  title: string;
  untitled: boolean;
  blocks: ProseBlock[];
  footnotes: Footnote[];
  plates: Plate[];
  notes: MarginNote[];
  asks: PermissionAsk[];
  /** message id → role, so streamed parts know whether they are ink or prose. */
  messageRoles?: Record<string, "user" | "assistant">;
  busy: boolean;
  error?: string;
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
