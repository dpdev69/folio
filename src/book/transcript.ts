import { addInk, errorSentence, setText, stepStarted, textBlockId, toolCalled, toolFailed, toolSucceeded } from "./events";
import type { Chapter } from "./model";

type Data = Record<string, unknown>;

/**
 * Set a chapter from its history, `GET /api/session/{id}/message?order=asc`.
 * Each message goes through the same steps the event stream takes, so a
 * chapter read from history and one pressed live come out the same.
 * Notes, asks and forms are kept; blocks, footnotes and plates are rebuilt.
 */
export function chapterFromMessages(chapter: Chapter, messages: unknown[]): Chapter {
  let next: Chapter = { ...chapter, blocks: [], footnotes: [], plates: [], turns: undefined, calls: undefined };
  let lastError: unknown;
  for (const raw of messages) {
    const message = recordOf(raw);
    const id = stringOf(message?.id);
    if (!message || !id) continue;
    if (message.type === "user") {
      next = addInk(next, id, stringOf(message.text) ?? "");
    } else if (message.type === "assistant") {
      next = assistant(stepStarted(next, id), id, message.content);
      lastError = message.error;
    }
    // idle, synthetic, compaction and the rest are not set in type.
  }
  const error = recordOf(lastError);
  if (!next.busy && error && error.type !== "aborted") next = { ...next, error: errorSentence(error) };
  return next;
}

function assistant(chapter: Chapter, messageId: string, content: unknown): Chapter {
  let next = chapter;
  let ordinal = 0;
  for (const raw of Array.isArray(content) ? content : []) {
    const item = recordOf(raw);
    if (item?.type === "text") {
      next = setText(next, textBlockId(messageId, ordinal), stringOf(item.text) ?? "", "end");
      ordinal += 1;
    } else if (item?.type === "tool") {
      next = tool(next, messageId, item);
    }
  }
  return next;
}

function tool(chapter: Chapter, messageId: string, item: Data): Chapter {
  const id = stringOf(item.id);
  const name = stringOf(item.name);
  const state = recordOf(item.state);
  if (!id || !name || !state) return chapter;
  // A tool still streaming its input holds it as raw, partial JSON.
  const called = toolCalled(chapter, id, recordOf(state.input) ?? {}, messageId, name);
  if (state.status === "completed") return toolSucceeded(called, id, state.content, state.metadata);
  if (state.status === "error") return toolFailed(called, id, state.error);
  return called;
}

function recordOf(value: unknown): Data | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
