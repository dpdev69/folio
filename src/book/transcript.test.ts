import { describe, expect, it } from "vitest";
import { applyEvent, type Frame } from "./events";
import type { Book, Chapter } from "./model";
import { chapterFromMessages } from "./transcript";
import { pushSse, unwrapEvent } from "../engine/sse";
import { captures, editMessages, FIXTURE_DIRECTORY } from "./__fixtures__/load";

function empty(id: string): Chapter {
  return { id, title: "fixture edit", untitled: false, blocks: [], footnotes: [], plates: [], notes: [], asks: [], forms: [], busy: false };
}

function pressed(): Chapter {
  const shelf: Book = { id: "repo", title: "repo", directory: FIXTURE_DIRECTORY, sample: false, chapters: [] };
  const frames: Frame[] = pushSse("", captures.edit).events.map(unwrapEvent);
  return frames.reduce(applyEvent, shelf).chapters[0];
}

/** The recorded history is newest first; the hook asks for `order=asc`. */
const ascending = editMessages.slice().reverse();

describe("chapterFromMessages", () => {
  it("builds the same page from history as the event stream does", () => {
    const streamed = pressed();
    const read = chapterFromMessages(empty(streamed.id), ascending);
    expect(read.blocks.filter((b) => b.voice === "ink")).toHaveLength(1);
    expect(read.blocks.filter((b) => b.voice === "prose")).toHaveLength(1);
    expect(read.footnotes).toHaveLength(2);
    expect(read.plates).toHaveLength(1);
    expect(read.blocks).toEqual(streamed.blocks);
    expect(read.footnotes).toEqual(streamed.footnotes);
    expect(read.plates).toEqual(streamed.plates);
    expect(read.turns).toEqual(streamed.turns);
    expect(JSON.stringify(read.blocks)).not.toContain("Brief explanation");
    expect(read.busy).toBe(false);
    expect(read.error).toBeUndefined();
  });

  it("replaces what the chapter held and keeps its notes", () => {
    const stale: Chapter = {
      ...empty("ses_1"),
      blocks: [{ id: "local-1", voice: "ink", text: "An old line." }],
      notes: [{ id: "note_1", quote: "q", prompt: "p", reply: "r" }],
    };
    const read = chapterFromMessages(stale, ascending);
    expect(read.blocks.map((b) => b.id)).not.toContain("local-1");
    expect(read.notes).toEqual(stale.notes);
  });

  it("reports the last assistant error when the session is not running, but not an interruption", () => {
    const failed = [
      { id: "msg_u", type: "user", text: "Try it." },
      { id: "msg_a", type: "assistant", content: [], error: { type: "provider", message: "The model is busy." } },
      { id: "msg_i", type: "idle", outcome: "failed" },
    ];
    expect(chapterFromMessages(empty("ses_1"), failed).error).toBe("The model is busy.");
    expect(chapterFromMessages({ ...empty("ses_1"), busy: true }, failed).error).toBeUndefined();
    const stopped = [{ ...failed[1], error: { type: "aborted", message: "Step interrupted" } }];
    expect(chapterFromMessages(empty("ses_1"), stopped).error).toBeUndefined();
  });

  it("words a failed tool and a running one from their state", () => {
    const read = chapterFromMessages(empty("ses_1"), [
      { id: "msg_u", type: "user", text: "Go." },
      {
        id: "msg_a",
        type: "assistant",
        content: [
          { type: "tool", id: "c1", name: "edit", state: { status: "error", input: { path: "a.ts" }, error: { type: "permission.rejected", message: "No." } } },
          { type: "tool", id: "c2", name: "read", state: { status: "running", input: { path: "b.ts" }, metadata: {} } },
          { type: "tool", id: "c3", name: "shell", state: { status: "streaming", input: "{\"comm" } },
          { type: "mystery" },
        ],
      },
    ]);
    expect(read.footnotes.map((f) => [f.text, f.pending])).toEqual([
      ["The edit to a.ts was declined.", false],
      ["Read b.ts.", true],
      ["Running a command…", true],
    ]);
  });
});
