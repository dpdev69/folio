import { addInk, errorSentence, setText, stepStarted, textBlockId, toolCalled, toolFailed, toolSucceeded } from "./events";
import type { Chapter } from "./model";
import { parseNote } from "./notes";
import { recordOf, stringOf, type Data } from "./values";

/**
 * Set a chapter from its history, `GET /api/session/{id}/message?order=asc`.
 * Each message goes through the same steps the event stream takes, so a
 * chapter read from history and one pressed live come out the same.
 * Notes, asks and forms are kept (a margin question in history brings its note
 * back); blocks, footnotes and plates are rebuilt.
 */
export function chapterFromMessages(chapter: Chapter, messages: unknown[], directory?: string): Chapter {
  let next: Chapter = { ...chapter, blocks: [], footnotes: [], plates: [], turns: undefined, calls: undefined };
  let lastError: unknown;
  let answered = false;
  // The note a margin question from history opened, until its reply closes it.
  let opened: string | undefined;
  for (const raw of messages) {
    const message = recordOf(raw);
    const id = stringOf(message?.id);
    if (!message || !id) continue;
    if (message.type === "user") {
      const text = stringOf(message.text) ?? "";
      next = letGo(next, opened);
      const asked = parseNote(text);
      opened = undefined;
      if (asked) {
        ({ chapter: next, id: opened } = openNote(next, id, asked));
      }
      next = addInk(next, id, text, Boolean(asked));
    } else if (message.type === "assistant") {
      next = assistant(stepStarted(next, id), id, message.content, directory);
      lastError = message.error;
      answered = true;
    }
    // idle, synthetic, compaction and the rest are not set in type.
  }
  // A question still unanswered waits only if the reader is waiting for it now.
  if (opened && !chapter.notes.some((n) => n.id === opened && n.pending)) next = letGo(next, opened);
  const error = recordOf(lastError);
  if (!next.busy && error && error.type !== "aborted") next = { ...next, error: errorSentence(error) };
  // The last run finished without an error, so an error kept from before no longer stands.
  else if (!next.busy && answered && next.error !== undefined) next = { ...next, error: undefined };
  return next;
}

/**
 * A margin question read from history: wait on the note for the same passage
 * and question, or else on a note for the passage that has no reply yet, or
 * make that note again, so the reply that follows goes to the margin. A note
 * already answered for another question is never opened again.
 */
function openNote(chapter: Chapter, messageId: string, asked: { quote: string; prompt: string }): { chapter: Chapter; id: string } {
  const same = chapter.notes.filter((n) => n.quote === asked.quote);
  const held = same.find((n) => n.prompt === asked.prompt) ?? same.find((n) => n.reply === undefined);
  if (held) {
    const notes = chapter.notes.map((n) => (n.id === held.id ? { ...n, pending: true, messageId } : n));
    return { chapter: { ...chapter, notes }, id: held.id };
  }
  const id = `note-${messageId}`;
  return { chapter: { ...chapter, notes: [...chapter.notes, { id, ...asked, pending: true, messageId }] }, id };
}

/** A note from history that got no reply stops waiting, so later prose stays in the main flow. */
function letGo(chapter: Chapter, noteId: string | undefined): Chapter {
  if (!noteId || !chapter.notes.some((n) => n.id === noteId && n.pending)) return chapter;
  return { ...chapter, notes: chapter.notes.map((n) => (n.id === noteId ? { ...n, pending: false } : n)) };
}

function assistant(chapter: Chapter, messageId: string, content: unknown, directory?: string): Chapter {
  let next = chapter;
  let ordinal = 0;
  for (const raw of Array.isArray(content) ? content : []) {
    const item = recordOf(raw);
    if (item?.type === "text") {
      next = setText(next, textBlockId(messageId, ordinal), stringOf(item.text) ?? "", "end", messageId);
      ordinal += 1;
    } else if (item?.type === "tool") {
      next = tool(next, messageId, item, directory);
    }
  }
  return next;
}

function tool(chapter: Chapter, messageId: string, item: Data, directory?: string): Chapter {
  const id = stringOf(item.id);
  const name = stringOf(item.name);
  const state = recordOf(item.state);
  if (!id || !name || !state) return chapter;
  // A tool still streaming its input holds it as raw, partial JSON.
  const called = toolCalled(chapter, id, recordOf(state.input) ?? {}, messageId, name, directory);
  if (state.status === "completed") return toolSucceeded(called, id, state.content, state.metadata, directory);
  if (state.status === "error") return toolFailed(called, id, state.error, directory);
  return called;
}

