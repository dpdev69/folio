import { plateLines } from "./diff";
import { isUntitled, type Book, type Chapter, type Footnote, type Plate, type ProseBlock } from "./model";
import { footnoteSentence, type ToolLike } from "./tools";

type Event = { type?: string; properties?: Record<string, unknown> };

export function applyEvent(book: Book, event: Event): Book {
  const type = event.type ?? "";
  const props = event.properties ?? {};
  if (type === "session.created" || type === "session.updated") {
    const info = (props.info as Record<string, unknown> | undefined) ?? props;
    return upsertChapterShell(book, info);
  }
  if (type === "session.deleted") {
    const id = stringOf(props.sessionID) ?? stringOf(props.id);
    if (!id) return book;
    return { ...book, chapters: book.chapters.filter((c) => c.id !== id) };
  }
  const sessionID = stringOf(props.sessionID);
  if (!sessionID) return book;
  const index = book.chapters.findIndex((c) => c.id === sessionID);
  if (index < 0) return book;
  let chapter = book.chapters[index];

  if (type === "session.idle") {
    chapter = {
      ...chapter,
      busy: false,
      notes: chapter.notes.map((n) => (n.pending ? { ...n, pending: false } : n)),
    };
  }
  else if (type === "session.status") {
    const status = props.status as { type?: string } | undefined;
    chapter = { ...chapter, busy: status?.type !== "idle" };
  } else if (type === "session.error") {
    const message = stringOf((props.error as { message?: string } | undefined)?.message) ?? "The press stopped.";
    chapter = { ...chapter, busy: false, error: message };
  } else if (type === "session.diff") {
    chapter = applyDiff(chapter, props.diff);
  } else if (type === "message.updated") {
    const info = props.info as { id?: string; role?: string; error?: { message?: string } } | undefined;
    if (info?.id && (info.role === "user" || info.role === "assistant")) {
      chapter = {
        ...chapter,
        messageRoles: { ...chapter.messageRoles, [info.id]: info.role },
      };
    }
    if (info?.error?.message) chapter = { ...chapter, error: info.error.message, busy: false };
    if (info?.role === "assistant") chapter = { ...chapter, busy: true, error: undefined };
  } else if (type === "message.part.updated") {
    const part = props.part ?? props;
    chapter = rememberPartType(chapter, part);
    chapter = applyPart(chapter, part, roleFrom(props, chapter, part));
  } else if (type === "message.part.delta") {
    chapter = applyDelta(chapter, props, roleFrom(props, chapter, props));
  } else if (type === "message.part.removed") {
    const partID = stringOf(props.partID);
    if (partID) {
      chapter = {
        ...chapter,
        blocks: chapter.blocks.filter((b) => b.id !== partID),
        footnotes: chapter.footnotes.filter((f) => f.id !== partID),
      };
    }
  } else if (type === "permission.asked" || type === "permission.updated") {
    chapter = addAsk(chapter, props);
  } else if (type === "permission.replied") {
    const id = stringOf(props.requestID) ?? stringOf(props.permissionID) ?? stringOf(props.id);
    chapter = { ...chapter, asks: chapter.asks.filter((a) => a.id !== id) };
  } else {
    return book;
  }

  const chapters = book.chapters.slice();
  chapters[index] = chapter;
  return { ...book, chapters };
}

export function appendPrompt(chapter: Chapter, text: string, id = `local-${Date.now()}`): Chapter {
  const block: ProseBlock = { id, voice: "ink", text };
  return { ...chapter, blocks: [...chapter.blocks, block], busy: true, error: undefined };
}

export function attachNoteReply(chapter: Chapter, noteId: string, reply: string): Chapter {
  return {
    ...chapter,
    notes: chapter.notes.map((note) => (note.id === noteId ? { ...note, reply, pending: false } : note)),
  };
}

function upsertChapterShell(book: Book, info: Record<string, unknown>): Book {
  const id = stringOf(info.id) ?? stringOf(info.sessionID);
  if (!id) return book;
  const directory = stringOf(info.directory);
  if (directory && book.directory && directory !== book.directory) return book;
  const title = stringOf(info.title) ?? "";
  const untitled = isUntitled(title);
  const existing = book.chapters.find((c) => c.id === id);
  if (existing) {
    return {
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === id ? { ...c, title: untitled ? c.title : title, untitled: untitled && c.untitled } : c,
      ),
    };
  }
  return {
    ...book,
    chapters: [
      ...book.chapters,
      {
        id,
        title: untitled ? "Untitled" : title,
        untitled,
        blocks: [],
        footnotes: [],
        plates: [],
        notes: [],
        asks: [],
        busy: false,
      },
    ],
  };
}

function roleFrom(props: Record<string, unknown>, chapter: Chapter, raw: unknown): "user" | "assistant" {
  if (props.role === "user" || props.role === "assistant") return props.role;
  const part = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const messageID = stringOf(part.messageID) ?? stringOf(props.messageID);
  if (messageID && chapter.messageRoles?.[messageID]) return chapter.messageRoles[messageID];
  return "assistant";
}

/** Record every part's type, so delta events can be filtered by it later. */
function rememberPartType(chapter: Chapter, raw: unknown): Chapter {
  if (!raw || typeof raw !== "object") return chapter;
  const part = raw as Record<string, unknown>;
  const id = stringOf(part.id);
  const type = stringOf(part.type);
  if (!id || !type) return chapter;
  if (chapter.partTypes?.[id] === type) return chapter;
  return { ...chapter, partTypes: { ...chapter.partTypes, [id]: type } };
}

function applyPart(chapter: Chapter, raw: unknown, role: "user" | "assistant"): Chapter {
  if (!raw || typeof raw !== "object") return chapter;
  const part = raw as Record<string, unknown>;
  const id = stringOf(part.id);
  const type = stringOf(part.type);
  if (!id || !type) return chapter;
  if (type === "text") {
    const text = stringOf(part.text) ?? "";
    return upsertText(chapter, id, text, Boolean(part.ignored), role);
  }
  if (type === "tool") return upsertTool(chapter, part);
  if (type === "reasoning") return chapter;
  return chapter;
}

function upsertText(
  chapter: Chapter,
  id: string,
  text: string,
  ignored: boolean,
  role: "user" | "assistant",
): Chapter {
  if (ignored) return chapter;
  const voice = role === "user" ? "ink" : "prose";
  const blocks = chapter.blocks.slice();
  const index = blocks.findIndex((b) => b.id === id);
  if (index >= 0) {
    const prev = blocks[index];
    if (text.length < prev.text.length) return chapter;
    blocks[index] = { ...prev, text, voice: prev.marginal ? prev.voice : voice };
    // An empty echo must not close a margin note that is still waiting for prose.
    if (!text.trim()) return { ...chapter, blocks, busy: true };
    const pending = prev.marginal ? chapter.notes.find((n) => n.pending) : undefined;
    const notes = pending
      ? chapter.notes.map((n) => (n.id === pending.id ? { ...n, reply: text, pending: false } : n))
      : chapter.notes;
    const footnotes = prev.marginal ? chapter.footnotes : adoptPending(chapter.footnotes, id, text);
    return { ...chapter, blocks, notes, footnotes, busy: true };
  }
  const optimistic = blocks.findIndex((b) => b.id.startsWith("local-") && b.text.trim() === text.trim());
  if (optimistic >= 0) {
    blocks[optimistic] = { ...blocks[optimistic], id, voice: "ink" };
    return { ...chapter, blocks };
  }
  const pending = role === "assistant" ? chapter.notes.find((n) => n.pending) : undefined;
  blocks.push({ id, voice, text, marginal: Boolean(pending) });
  let notes = chapter.notes;
  if (pending && text.trim()) notes = notes.map((n) => (n.id === pending.id ? { ...n, reply: text, pending: false } : n));
  const footnotes = pending ? chapter.footnotes : adoptPending(chapter.footnotes, id, text);
  return { ...chapter, blocks, notes, footnotes, busy: true };
}

function applyDelta(chapter: Chapter, props: Record<string, unknown>, role: "user" | "assistant"): Chapter {
  const partID = stringOf(props.partID);
  const delta = stringOf(props.delta) ?? "";
  const field = stringOf(props.field) ?? "text";
  if (!partID || !delta || field !== "text") return chapter;
  // Reasoning and bookkeeping parts stream deltas too; only text parts are set in type.
  const known = chapter.partTypes?.[partID];
  if (known && known !== "text") return chapter;
  const blocks = chapter.blocks.slice();
  const index = blocks.findIndex((b) => b.id === partID);
  if (index >= 0) {
    const prev = blocks[index];
    const text = prev.text + delta;
    blocks[index] = { ...prev, text };
    const pending = prev.marginal ? chapter.notes.find((n) => n.pending) : undefined;
    const notes = pending
      ? chapter.notes.map((n) => (n.id === pending.id ? { ...n, reply: text } : n))
      : chapter.notes;
    const footnotes = prev.marginal ? chapter.footnotes : adoptPending(chapter.footnotes, partID, text);
    return { ...chapter, blocks, notes, footnotes, busy: true };
  }
  const pending = role === "assistant" ? chapter.notes.find((n) => n.pending) : undefined;
  blocks.push({
    id: partID,
    voice: role === "user" ? "ink" : "prose",
    text: delta,
    marginal: Boolean(pending),
  });
  const notes = pending
    ? chapter.notes.map((n) => (n.id === pending.id ? { ...n, reply: delta } : n))
    : chapter.notes;
  const footnotes = pending ? chapter.footnotes : adoptPending(chapter.footnotes, partID, delta);
  return { ...chapter, blocks, notes, footnotes, busy: true };
}

function upsertTool(chapter: Chapter, part: Record<string, unknown>): Chapter {
  const id = stringOf(part.id)!;
  const tool = stringOf(part.tool) ?? "tool";
  const state = (part.state as Record<string, unknown> | undefined) ?? {};
  const status = (stringOf(state.status) as ToolLike["status"]) ?? "running";
  const like: ToolLike = {
    tool,
    title: stringOf(state.title),
    input: (state.input as Record<string, unknown> | undefined) ?? {},
    status,
    output: stringOf(state.output),
    error: stringOf(state.error),
    startedAt: numberOf((state.time as { start?: number } | undefined)?.start),
    endedAt: numberOf((state.time as { end?: number } | undefined)?.end),
  };
  const opensPlate = footnoteSentence(like).opensPlate;
  let plates = chapter.plates;
  let plateId: string | undefined;
  if (opensPlate && (status === "completed" || status === "running")) {
    plateId = `plate-${id}`;
    if (!plates.some((p) => p.id === plateId)) {
      const n = plates.length + 1;
      const file = firstFile(like.input);
      plates = [
        ...plates,
        {
          id: plateId,
          n,
          messageId: stringOf(part.messageID),
          file: file ?? "the file",
          title: like.title || `Plate ${n}`,
          caption: file ? `The change in ${file}.` : "The change, before and after.",
          lines: plateFromTool(like),
          additions: count(firstString(like.input, ["newString", "new_string", "content"])),
          deletions: count(firstString(like.input, ["oldString", "old_string"])),
          status: "open",
          folded: false,
        },
      ];
    }
  }
  const sentence = footnoteSentence(like, plateId ? plates.find((p) => p.id === plateId)?.n : undefined);
  const footnotes = chapter.footnotes.slice();
  const existing = footnotes.findIndex((f) => f.id === id);
  // Once set, an anchor stays put; only a footnote still waiting for text is placed again.
  const kept = existing >= 0 && footnotes[existing].blockId !== "pending" ? footnotes[existing] : undefined;
  const anchor = kept ? { blockId: kept.blockId, offset: kept.offset } : anchorFor(chapter);
  const note: Footnote = {
    id,
    n: existing >= 0 ? footnotes[existing].n : nextFootnote(footnotes),
    blockId: anchor.blockId,
    offset: anchor.offset,
    text: sentence.text,
    plateId,
    pending: status === "running" || status === "pending",
  };
  if (existing >= 0) footnotes[existing] = note;
  else footnotes.push(note);
  return { ...chapter, footnotes, plates };
}

function plateFromTool(tool: ToolLike): Plate["lines"] {
  const before = firstString(tool.input, ["oldString", "old_string"]) ?? "";
  const after = firstString(tool.input, ["newString", "new_string", "content"]) ?? "";
  if (!before && !after) return [];
  return plateLines(before, after, { context: 1, maxLines: 40 });
}

function applyDiff(chapter: Chapter, raw: unknown): Chapter {
  if (!Array.isArray(raw)) return chapter;
  let plates = chapter.plates.slice();
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const diff = item as Record<string, unknown>;
    const file = stringOf(diff.file) ?? `file-${index + 1}`;
    const before = stringOf(diff.before) ?? "";
    const after = stringOf(diff.after) ?? "";
    const id = `diff-${file}`;
    const lines = plateLines(before, after, { context: 2, maxLines: 42 });
    const existing = plates.find((p) => p.id === id || p.file === file);
    const plate: Plate = {
      id: existing?.id ?? id,
      n: existing?.n ?? plates.length + 1,
      messageId: existing?.messageId,
      file,
      title: existing?.title ?? file.split("/").pop() ?? file,
      caption: `Fig. ${existing?.n ?? plates.length + 1}. ${file.split("/").pop() ?? file}.`,
      lines: lines.length ? lines : (existing?.lines ?? []),
      additions: numberOf(diff.additions) ?? existing?.additions ?? 0,
      deletions: numberOf(diff.deletions) ?? existing?.deletions ?? 0,
      status: existing?.status ?? "open",
      folded: existing?.folded ?? false,
    };
    if (existing) plates = plates.map((p) => (p.id === existing.id ? plate : p));
    else plates = [...plates, plate];
  });
  return { ...chapter, plates };
}

function addAsk(chapter: Chapter, props: Record<string, unknown>): Chapter {
  const id = stringOf(props.id);
  if (!id) return chapter;
  const permission = stringOf(props.permission) ?? stringOf(props.type) ?? "edit";
  const patterns = Array.isArray(props.patterns)
    ? props.patterns.filter((p): p is string => typeof p === "string")
    : [stringOf(props.pattern)].filter((p): p is string => Boolean(p));
  const file = patterns[0] && patterns[0] !== "*" ? patterns[0] : permission;
  const title = `May I ${verb(permission)} ${file}?`;
  const ask = { id, permission, patterns, title };
  const asks = chapter.asks.some((a) => a.id === id)
    ? chapter.asks.map((a) => (a.id === id ? ask : a))
    : [...chapter.asks, ask];
  return { ...chapter, asks };
}

function verb(permission: string): string {
  if (permission === "bash" || permission === "shell") return "run";
  if (permission === "read") return "read";
  return "edit";
}

/**
 * Hang a new footnote at the end of the last finished sentence of the last
 * block in the main flow, so the mark does not ride the tail as text streams in.
 */
function anchorFor(chapter: Chapter): { blockId: string; offset: number } {
  const blocks = chapter.blocks.filter((b) => !b.marginal);
  const last = blocks[blocks.length - 1];
  if (!last || !last.text.trim()) return { blockId: "pending", offset: 0 };
  return { blockId: last.id, offset: sentenceEnd(last.text) ?? last.text.trimEnd().length };
}

/** Offset just past the last sentence that has ended, or undefined if none has. */
function sentenceEnd(text: string): number | undefined {
  let end: number | undefined;
  for (const match of text.matchAll(/[.!?…]+["'”’)\]]*(?=\s|$)/g)) end = (match.index ?? 0) + match[0].length;
  return end;
}

/** A footnote that came before any text hangs at the start of the next text part. */
function adoptPending(footnotes: Footnote[], blockId: string, text: string): Footnote[] {
  if (!text.trim() || !footnotes.some((f) => f.blockId === "pending")) return footnotes;
  return footnotes.map((f) => (f.blockId === "pending" ? { ...f, blockId, offset: 0 } : f));
}

function nextFootnote(notes: Footnote[]): number {
  return notes.reduce((max, note) => Math.max(max, note.n), 0) + 1;
}

function firstFile(input: Record<string, unknown> | undefined): string | undefined {
  return firstString(input, ["filePath", "file", "path", "file_path"]);
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function count(text: string | undefined): number {
  if (!text) return 0;
  return text.split("\n").filter((line) => line.length).length;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
