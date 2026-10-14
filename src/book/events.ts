import {
  asksFirst,
  isUntitled,
  type Book,
  type Chapter,
  type Footnote,
  type Form,
  type FormField,
  type PermissionAsk,
  type ProseBlock,
} from "./model";
import { applyDiff, diffPlateId, dropPlate, filesOf, toolPlate } from "./plates";
import { NOTE_PREFIX, parseNote } from "./notes";
import { footnoteSentence, isEdit, type ToolLike } from "./tools";
import { numberOf, recordOf, stringOf, type Data } from "./values";
import { stripThink } from "./think";
import { samePath } from "./paths";

/**
 * One event frame from opencode 2.0, `{id, type, data, location?}`, as it
 * arrives, or one of Folio's own `folio.*` frames. Only `type`, `data` and
 * `location` are read; anything without `data` is ignored.
 */
export type Frame = { type?: string; data?: unknown; location?: unknown; [key: string]: unknown };

export function applyEvent(book: Book, frame: Frame): Book {
  const type = frame.type ?? "";
  const data = recordOf(frame.data);
  if (!data) return book;
  if (type === "session.created") return addChapterShell(book, data, recordOf(frame.location));
  // form.created carries its session only inside the form.
  const sessionID = stringOf(data.sessionID) ?? stringOf(recordOf(data.form)?.sessionID);
  if (!sessionID) return book;
  const index = book.chapters.findIndex((c) => c.id === sessionID);
  if (index < 0) return book;
  if (type === "session.deleted") return { ...book, chapters: book.chapters.filter((c) => c.id !== sessionID) };
  const chapter = book.chapters[index];
  const next = reduceChapter(chapter, type, data, book.directory || undefined);
  if (next === chapter) return book;
  const chapters = book.chapters.slice();
  chapters[index] = next;
  return { ...book, chapters };
}

function reduceChapter(chapter: Chapter, type: string, data: Data, directory?: string): Chapter {
  const aid = stringOf(data.assistantMessageID);
  const ordinal = numberOf(data.ordinal);
  const id = stringOf(data.id);
  switch (type) {
    case "session.renamed":
      return retitle(chapter, stringOf(data.title));
    case "session.permissions": {
      const askRules = asksFirst(data.permissions);
      return Boolean(chapter.askRules) === askRules ? chapter : { ...chapter, askRules };
    }
    case "session.execution.started":
      return { ...chapter, busy: true, error: undefined, notice: undefined };
    case "session.execution.succeeded":
      return settle(chapter);
    case "session.execution.failed":
      return { ...settle(chapter), error: errorSentence(data.error) };
    case "session.execution.interrupted":
      return stringOf(data.reason) === "user" ? settle(chapter) : { ...settle(chapter), notice: "The press was interrupted." };
    case "session.retry.scheduled": {
      const attempt = numberOf(data.attempt);
      return { ...chapter, notice: attempt ? `Trying again (attempt ${attempt})…` : "Trying again…" };
    }
    case "session.inbox.enqueued":
      return enqueue(chapter, stringOf(data.inboxID), recordOf(data.item));
    case "session.step.started":
      return aid ? stepStarted(chapter, aid) : chapter;
    case "session.step.ended":
      return Array.isArray(data.files) && data.files.length && !chapter.diffStale ? { ...chapter, diffStale: true } : chapter;
    case "session.text.started":
      return aid && ordinal != null ? setText(chapter, textBlockId(aid, ordinal), "", "grow", aid) : chapter;
    case "session.text.delta":
      return aid && ordinal != null ? setText(chapter, textBlockId(aid, ordinal), stringOf(data.delta) ?? "", "append", aid) : chapter;
    case "session.text.ended":
      return aid && ordinal != null ? setText(chapter, textBlockId(aid, ordinal), stringOf(data.text) ?? "", "end", aid) : chapter;
    case "session.tool.input.started":
      // Only this event names the tool; the rest of the input stream is ignored.
      return id ? nameTool(chapter, id, stringOf(data.name)) : chapter;
    case "session.tool.called":
      return id ? toolCalled(chapter, id, recordOf(data.input) ?? {}, aid, stringOf(data.name), directory) : chapter;
    case "session.tool.success":
      return id ? toolSucceeded(chapter, id, data.content, data.metadata, directory) : chapter;
    case "session.tool.failed":
      return id ? toolFailed(chapter, id, data.error, directory) : chapter;
    case "permission.asked":
      return addAsk(chapter, data, directory);
    case "permission.replied": {
      const requestID = stringOf(data.requestID);
      return chapter.asks.some((a) => a.id === requestID)
        ? { ...chapter, asks: chapter.asks.filter((a) => a.id !== requestID) }
        : chapter;
    }
    case "form.created":
      return addForm(chapter, recordOf(data.form));
    case "form.replied":
    case "form.cancelled":
      return chapter.forms.some((f) => f.id === id) ? { ...chapter, forms: chapter.forms.filter((f) => f.id !== id) } : chapter;
    case "folio.diff":
      return rewordPlates(applyDiff(chapter, data.diff, stringOf(data.turnMessageId) ?? lastInkId(chapter), data.unscoped === true), directory);
    default:
      return chapter;
  }
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

/** Text parts have no ids in opencode 2.0; they are addressed by message and ordinal. */
export function textBlockId(assistantMessageID: string, ordinal: number): string {
  return `${assistantMessageID}:t${ordinal}`;
}

/** The turn failed because its model is gone; the hook offers the model list. */
export const MODEL_GONE = "That model is no longer offered. Choose another from the menu.";

/** The press stopped with this error; say so in a sentence. */
export function errorSentence(raw: unknown): string {
  const error = recordOf(raw);
  const message = stringOf(error?.message)?.trim();
  if (error?.status === 410 || error?.statusCode === 410 || /deprecated/i.test(message ?? "")) return MODEL_GONE;
  if (message) return message;
  if (stringOf(error?.type) === "aborted") return "The press was stopped before it finished.";
  return "The press stopped.";
}

function addChapterShell(book: Book, data: Data, location: Data | undefined): Book {
  const id = stringOf(data.sessionID) ?? stringOf(data.id);
  // A subagent's session is part of its parent's turn, not a chapter of its own.
  if (!id || stringOf(data.parentID)) return book;
  const directory = stringOf(recordOf(data.location)?.directory) ?? stringOf(location?.directory);
  if (directory && book.directory && !samePath(directory, book.directory)) return book;
  const title = stringOf(data.title);
  const existing = book.chapters.findIndex((c) => c.id === id);
  if (existing >= 0) {
    const next = retitle(book.chapters[existing], title);
    if (next === book.chapters[existing]) return book;
    const chapters = book.chapters.slice();
    chapters[existing] = next;
    return { ...book, chapters };
  }
  const untitled = isUntitled(title);
  const chapter: Chapter = {
    id,
    title: untitled ? "Untitled" : title!,
    untitled,
    blocks: [],
    footnotes: [],
    plates: [],
    notes: [],
    asks: [],
    forms: [],
    busy: false,
    askRules: asksFirst(data.permissions),
  };
  return { ...book, chapters: [...book.chapters, chapter] };
}

/** A placeholder title never replaces a real one. */
function retitle(chapter: Chapter, title: string | undefined): Chapter {
  if (isUntitled(title) || (chapter.title === title && !chapter.untitled)) return chapter;
  return { ...chapter, title: title!, untitled: false };
}

/**
 * The run is over: idle, nothing left to answer, a margin note still waiting
 * will not get its reply, and a retry notice no longer applies.
 */
function settle(chapter: Chapter): Chapter {
  return {
    ...chapter,
    busy: false,
    notice: undefined,
    // The press asks only while it runs; an ask left over from a stopped run cannot be answered.
    asks: chapter.asks.length ? [] : chapter.asks,
    forms: chapter.forms.length ? [] : chapter.forms,
    notes: chapter.notes.some((n) => n.pending) ? chapter.notes.map((n) => (n.pending ? { ...n, pending: false } : n)) : chapter.notes,
  };
}

/**
 * The prompt reached the press. `inboxID` is the user message id (the same id
 * the prompt call returns and history uses). The quill's optimistic `local-…`
 * line with the same words is adopted under it, oldest first, each one once;
 * a prompt Folio did not write (another client, a queued line) is added.
 */
function enqueue(chapter: Chapter, inboxID: string | undefined, item: Data | undefined): Chapter {
  if (!inboxID || stringOf(item?.type) !== "user") return chapter;
  const text = stringOf(recordOf(item?.payload)?.text) ?? "";
  if (!text.trim() || chapter.blocks.some((b) => b.id === inboxID)) return chapter;
  const local = chapter.blocks.find((b) => b.voice === "ink" && b.id.startsWith("local-") && b.text.trim() === text.trim());
  if (local) return renameBlock(chapter, local.id, inboxID);
  // A waiting margin note's own question belongs in the margin, with its reply.
  const marginal = text.startsWith(NOTE_PREFIX) && chapter.notes.some((n) => n.pending);
  const next: Chapter = { ...chapter, blocks: [...chapter.blocks, { id: inboxID, voice: "ink", text, ...(marginal ? { marginal } : {}) }] };
  if (!marginal) return next;
  // The stream can name the note's message before the prompt call returns.
  const asked = parseNote(text);
  const waiting = chapter.notes.filter((n) => n.pending && !n.messageId);
  const note = waiting.find((n) => n.quote === asked?.quote && n.prompt === asked?.prompt) ?? waiting[0];
  return note ? noteSent(next, note.id, inboxID) : next;
}

/** The press took a margin note as this user message; the text of that turn is its reply. */
export function noteSent(chapter: Chapter, noteId: string, messageId: string): Chapter {
  const note = chapter.notes.find((n) => n.id === noteId);
  if (!note || note.messageId === messageId) return chapter;
  return { ...chapter, notes: chapter.notes.map((n) => (n.id === noteId ? { ...n, messageId } : n)) };
}

/**
 * Give a block a new id, and correct everything that names it: footnote
 * anchors, the turns it began, and the plates of those turns, including the id
 * of a diff plate named by that turn (`diff-<file>@<turn>`) and the footnotes
 * that point at it, so its Accept or Reject is kept under the id a reload
 * gives it. The hook calls this when the prompt call returns the user message
 * id for a `local-…` line. If a block already has the new id (the stream set
 * the prompt first), the `local-…` line is folded into it: ids stay unique.
 */
export function renameBlock(chapter: Chapter, from: string, to: string): Chapter {
  if (from === to || !chapter.blocks.some((b) => b.id === from)) return chapter;
  const taken = chapter.blocks.some((b) => b.id === to);
  const turns = chapter.turns
    ? Object.fromEntries(Object.entries(chapter.turns).map(([aid, turn]) => [aid, turn === from ? to : turn]))
    : chapter.turns;
  const plateIds = new Map<string, string>();
  for (const plate of chapter.plates) {
    if (plate.turnMessageId !== from || plate.id !== diffPlateId(plate.file, from)) continue;
    const id = diffPlateId(plate.file, to);
    if (!chapter.plates.some((p) => p.id === id)) plateIds.set(plate.id, id);
  }
  const renamePlate = (id: string | undefined) => (id !== undefined ? (plateIds.get(id) ?? id) : id);
  return {
    ...chapter,
    blocks: taken ? chapter.blocks.filter((b) => b.id !== from) : chapter.blocks.map((b) => (b.id === from ? { ...b, id: to } : b)),
    footnotes: chapter.footnotes.map((f) => {
      let note = f.blockId === from ? { ...f, blockId: to } : f;
      const plateId = renamePlate(f.plateId);
      if (plateId !== f.plateId) note = { ...note, plateId };
      return note;
    }),
    plates: chapter.plates.map((p) => (p.turnMessageId === from ? { ...p, id: renamePlate(p.id)!, turnMessageId: to } : p)),
    turns,
  };
}

/** A model step began: remember which prompt it answers, and drop a retry notice. */
export function stepStarted(chapter: Chapter, assistantMessageID: string): Chapter {
  const turn = lastInkId(chapter);
  const turns = turn && chapter.turns?.[assistantMessageID] !== turn ? { ...chapter.turns, [assistantMessageID]: turn } : chapter.turns;
  if (turns === chapter.turns && chapter.notice === undefined) return chapter;
  return { ...chapter, turns, notice: undefined };
}

/** Add a user prompt from history in ink; a margin note's question stays out of the main flow. */
export function addInk(chapter: Chapter, id: string, text: string, marginal = false): Chapter {
  if (!text.trim() || chapter.blocks.some((b) => b.id === id)) return chapter;
  return { ...chapter, blocks: [...chapter.blocks, { id, voice: "ink", text, ...(marginal ? { marginal } : {}) }] };
}

/**
 * Set a prose block's text. "grow" and "end" never shorten it; "end" also
 * closes the margin note the block answers. A block of the turn a waiting note
 * was sent as (its assistant message's turn is the note's own message) is that
 * note's reply and stays out of the main flow; any other turn's text does not.
 * Reasoning leaked at the start of the part (`</think>`, `<think>…</think>`)
 * is taken off. A part that arrives before an earlier part of its message is
 * set after that part, not at the end, so the stream's order cannot open a hole.
 */
export function setText(
  chapter: Chapter,
  id: string,
  text: string,
  mode: "append" | "grow" | "end",
  assistantMessageID?: string,
): Chapter {
  const blocks = chapter.blocks.slice();
  const index = blocks.findIndex((b) => b.id === id);
  const prev = index >= 0 ? blocks[index] : undefined;
  let next: string;
  if (!prev) next = stripThink(text);
  else if (mode === "append") next = stripThink(prev.text + text);
  else {
    const whole = stripThink(text);
    next = whole.length >= prev.text.length ? whole : prev.text;
  }
  const turn = assistantMessageID ? chapter.turns?.[assistantMessageID] : undefined;
  const owner = turn ? chapter.notes.find((n) => n.pending && n.messageId === turn) : undefined;
  const marginal = prev ? Boolean(prev.marginal) : Boolean(owner);
  const closes = marginal && mode === "end" && Boolean(next.trim());
  if (prev && next === prev.text && !closes) return chapter;
  if (prev) blocks[index] = { ...prev, text: next };
  else blocks.splice(insertAt(blocks, id), 0, { id, voice: "prose", text: next, marginal });
  const pending = marginal ? owner : undefined;
  const notes =
    pending && next.trim()
      ? chapter.notes.map((n) => (n.id === pending.id ? { ...n, reply: next, pending: !closes } : n))
      : chapter.notes;
  // Only the last block of the main flow takes a footnote that came before any text.
  const flow = blocks.filter((b) => !b.marginal);
  const last = flow[flow.length - 1]?.id === id;
  const footnotes = marginal || !last ? chapter.footnotes : adoptPending(chapter.footnotes, id, next);
  return { ...chapter, blocks, notes, footnotes };
}

/**
 * Where a new text part goes: before the first part of the same message with a
 * higher ordinal, when one came first, and otherwise at the end.
 */
function insertAt(blocks: ProseBlock[], id: string): number {
  const own = /^(.*):t(\d+)$/.exec(id);
  if (!own) return blocks.length;
  const later = blocks.findIndex((b) => {
    const other = /^(.*):t(\d+)$/.exec(b.id);
    return Boolean(other && other[1] === own[1] && Number(other[2]) > Number(own[2]));
  });
  return later < 0 ? blocks.length : later;
}

function nameTool(chapter: Chapter, id: string, name: string | undefined): Chapter {
  const known = chapter.calls?.[id];
  if (!name || known?.name === name) return chapter;
  return { ...chapter, calls: { ...chapter.calls, [id]: { input: {}, ...known, name } } };
}

export function toolCalled(
  chapter: Chapter,
  id: string,
  input: Data,
  messageId?: string,
  name?: string,
  directory?: string,
): Chapter {
  const known = chapter.calls?.[id];
  const call = { name: name ?? known?.name ?? "tool", input, messageId: messageId ?? known?.messageId };
  return placeTool({ ...chapter, calls: { ...chapter.calls, [id]: call } }, id, { status: "running" }, [], directory);
}

export function toolSucceeded(chapter: Chapter, id: string, content: unknown, metadata: unknown, directory?: string): Chapter {
  if (!chapter.calls?.[id]) return chapter;
  return placeTool(chapter, id, { status: "completed", output: joinText(content) }, filesOf(metadata), directory);
}

export function toolFailed(chapter: Chapter, id: string, raw: unknown, directory?: string): Chapter {
  if (!chapter.calls?.[id]) return chapter;
  const error = recordOf(raw);
  const type = stringOf(error?.type);
  return placeTool(chapter, id, {
    status: "error",
    error: stringOf(error?.message),
    declined: type === "aborted" || type === "permission.rejected",
  }, [], directory);
}

/** Word a tool call as a footnote, and set the plate of a file it changed. */
function placeTool(
  chapter: Chapter,
  id: string,
  outcome: Pick<ToolLike, "status" | "output" | "error" | "declined">,
  files: ReturnType<typeof filesOf> = [],
  directory?: string,
): Chapter {
  const call = chapter.calls![id];
  const like: ToolLike = { tool: call.name, input: call.input, ...outcome };
  let plates = chapter.plates;
  let plateId: string | undefined;
  if (isEdit(call.name)) {
    if (outcome.status === "error") plates = dropPlate(plates, `plate-${id}`);
    else {
      const turn = (call.messageId && chapter.turns?.[call.messageId]) || lastInkId(chapter);
      const set = toolPlate(plates, `plate-${id}`, call, files, turn);
      plates = set.plates;
      if (set.plate) {
        plateId = set.plate.id;
        like.additions = set.plate.additions;
        like.deletions = set.plate.deletions;
      }
    }
  }
  const sentence = footnoteSentence(like, plateId ? plates.find((p) => p.id === plateId)?.n : undefined, { directory });
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
    pending: outcome.status === "running",
  };
  if (existing >= 0) footnotes[existing] = note;
  else footnotes.push(note);
  return { ...chapter, footnotes, plates };
}

/** A plate the session diff reset keeps a footnote that tells the same counts. */
function rewordPlates(chapter: Chapter, directory?: string): Chapter {
  let changed = false;
  const footnotes = chapter.footnotes.map((note) => {
    const call = chapter.calls?.[note.id];
    const plate = note.plateId ? chapter.plates.find((p) => p.id === note.plateId) : undefined;
    if (!call || !plate || note.pending) return note;
    const like: ToolLike = {
      tool: call.name,
      input: call.input,
      status: "completed",
      additions: plate.additions,
      deletions: plate.deletions,
    };
    const text = footnoteSentence(like, plate.n, { directory }).text;
    if (text === note.text) return note;
    changed = true;
    return { ...note, text };
  });
  return changed ? { ...chapter, footnotes } : chapter;
}

function addAsk(chapter: Chapter, data: Data, directory?: string): Chapter {
  const id = stringOf(data.id);
  if (!id) return chapter;
  const permission = stringOf(data.action) ?? "*";
  const patterns = Array.isArray(data.resources) ? data.resources.filter((r): r is string => typeof r === "string") : [];
  const files = filesOf(data.metadata);
  const target = patterns.filter((p) => p !== "*").join(", ") || files[0]?.file || "this";
  const source = recordOf(data.source);
  const callId = stringOf(source?.type) === "tool" ? stringOf(source?.id) : undefined;
  const ask: PermissionAsk = { id, permission, patterns, title: `May I ${verb(permission)} ${target}?`, patch: files[0]?.patch };
  if (callId) ask.callId = callId;
  const asks = chapter.asks.some((a) => a.id === id)
    ? chapter.asks.map((a) => (a.id === id ? ask : a))
    : [...chapter.asks, ask];
  const next = { ...chapter, asks };
  // The edit waiting on this ask shows the change the press proposes, not its own strings.
  const call = callId ? chapter.calls?.[callId] : undefined;
  if (!callId || !call || !isEdit(call.name) || !files.some((f) => f.patch)) return next;
  return placeTool(next, callId, { status: "running" }, files, directory);
}

function verb(action: string): string {
  if (action === "edit") return "edit";
  if (action === "read") return "read";
  if (action === "shell" || action === "bash") return "run";
  if (action === "webfetch") return "fetch";
  return "act on";
}

function addForm(chapter: Chapter, raw: Data | undefined): Chapter {
  const id = stringOf(raw?.id);
  if (!raw || !id) return chapter;
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map(fieldOf).filter((f): f is FormField => Boolean(f));
  const form: Form = { id, title: stringOf(raw.title) ?? "A question", fields };
  const forms = chapter.forms.some((f) => f.id === id)
    ? chapter.forms.map((f) => (f.id === id ? form : f))
    : [...chapter.forms, form];
  return { ...chapter, forms };
}

function fieldOf(raw: unknown): FormField | undefined {
  const field = recordOf(raw);
  const key = stringOf(field?.key);
  const type = stringOf(field?.type);
  if (!field || !key || !type) return undefined;
  const out: FormField = { key, title: stringOf(field.title) ?? key, type };
  const description = stringOf(field.description);
  if (description) out.description = description;
  if (Array.isArray(field.options)) {
    out.options = field.options.flatMap((option) => {
      const o = recordOf(option);
      const value = stringOf(o?.value);
      if (!o || value === undefined) return [];
      const description = stringOf(o.description);
      return [{ value, label: stringOf(o.label) ?? value, ...(description ? { description } : {}) }];
    });
  }
  if (typeof field.custom === "boolean") out.custom = field.custom;
  const min = numberOf(field.minItems) ?? numberOf(field.min) ?? numberOf(field.minimum);
  const max = numberOf(field.maxItems) ?? numberOf(field.max) ?? numberOf(field.maximum);
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}

function lastInkId(chapter: Chapter): string | undefined {
  for (let i = chapter.blocks.length - 1; i >= 0; i--) if (chapter.blocks[i].voice === "ink") return chapter.blocks[i].id;
  return undefined;
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

/** Words whose full stop is no sentence's end. */
const ABBREVIATIONS = /^(?:e\.g|i\.e|cf|vs|viz|al|approx|fig|mr|mrs|ms|dr)$/i;

/**
 * Offset just past the last sentence that has ended, or undefined if none has.
 * Closing quotes, brackets and markdown emphasis (`**Done.** Next`) belong to
 * the sentence; the stop of an abbreviation ("e.g. "), an initial, or a list
 * number at the start of a line ("1. ") does not end one.
 */
export function sentenceEnd(text: string): number | undefined {
  let end: number | undefined;
  for (const match of text.matchAll(/[.!?…]+["'”’)\]*_`]*(?=\s|$)/g)) {
    const at = match.index ?? 0;
    if (match[0].startsWith(".") && !/^\.{2,}/.test(match[0]) && !endsSentence(text.slice(0, at))) continue;
    end = at + match[0].length;
  }
  return end;
}

/** Whether a full stop after `before` ends a sentence. */
function endsSentence(before: string): boolean {
  const word = /(\S*)$/.exec(before)?.[1] ?? "";
  const bare = word.replace(/^[("'“‘[*_]+/, "");
  if (ABBREVIATIONS.test(bare)) return false;
  // A single letter is an initial ("J. Smith").
  if (/^\p{L}$/u.test(bare)) return false;
  // A number alone at the start of a line is a list's ("1. Read the file").
  if (/^\d+$/.test(bare) && /(^|\n)[ \t]*$/.test(before.slice(0, before.length - word.length))) return false;
  return true;
}

/** A footnote that came before any text hangs at the start of the next text part. */
function adoptPending(footnotes: Footnote[], blockId: string, text: string): Footnote[] {
  if (!text.trim() || !footnotes.some((f) => f.blockId === "pending")) return footnotes;
  return footnotes.map((f) => (f.blockId === "pending" ? { ...f, blockId, offset: 0 } : f));
}

function nextFootnote(notes: Footnote[]): number {
  return notes.reduce((max, note) => Math.max(max, note.n), 0) + 1;
}

/** A tool's output is the text of its content items. */
function joinText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => (recordOf(item)?.type === "text" ? stringOf(recordOf(item)?.text) : undefined))
    .filter((t): t is string => t !== undefined)
    .join("\n");
  return text || undefined;
}

