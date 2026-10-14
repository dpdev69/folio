import { describe, expect, it } from "vitest";
import { applyEvent, type Frame } from "./events";
import type { Book, Chapter } from "./model";
import { composeNote, parseNote } from "./notes";
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

  describe("margin notes", () => {
    const note = (id: string, quote: string, prompt: string) =>
      ({ id, type: "user", text: `About this passage:\n\n> ${quote}\n\n${prompt}` }) as const;
    const said = (id: string, text: string) => ({ id, type: "assistant", content: [{ type: "text", text }] });
    const history = [
      { id: "msg_u1", type: "user", text: "Fix the flaky test." },
      said("msg_a1", "The clock was frozen before the token was minted."),
      note("msg_u2", "the clock was frozen", "Why freeze it?"),
      said("msg_a2", "So the token's time is fixed."),
      { id: "msg_u3", type: "user", text: "Thank you." },
      said("msg_a3", "You are welcome."),
    ];

    it("reads back the quote and the question of the prompt the hook composes", () => {
      expect(parseNote(composeNote(" the clock was frozen ", "Why freeze it?\nAnd why there?"))).toEqual({
        quote: "the clock was frozen",
        prompt: "Why freeze it?\nAnd why there?",
      });
      expect(parseNote("Fix the flaky test.")).toBeUndefined();
    });

    it("sets a note's prompt and its reply in the margin and makes the note again", () => {
      const read = chapterFromMessages(empty("ses_1"), history);
      expect(read.blocks.filter((b) => !b.marginal).map((b) => b.text)).toEqual([
        "Fix the flaky test.",
        "The clock was frozen before the token was minted.",
        "Thank you.",
        "You are welcome.",
      ]);
      expect(read.blocks.filter((b) => b.marginal).map((b) => b.id)).toEqual(["msg_u2", "msg_a2:t0"]);
      expect(read.notes).toEqual([
        {
          id: "note-msg_u2",
          quote: "the clock was frozen",
          prompt: "Why freeze it?",
          reply: "So the token's time is fixed.",
          pending: false,
          messageId: "msg_u2",
        },
      ]);
    });

    it("gives the reply to a note the chapter already holds for the same passage", () => {
      const held = { id: "note_1", quote: "the clock was frozen", prompt: "Why freeze it?", kept: true };
      const read = chapterFromMessages({ ...empty("ses_1"), notes: [held] }, history);
      expect(read.notes).toEqual([{ ...held, reply: "So the token's time is fixed.", pending: false, messageId: "msg_u2" }]);
    });

    it("lets a note that was never answered go, so the next reply stays in the main flow", () => {
      const unanswered = [history[0], history[1], history[2], history[4], history[5]];
      const read = chapterFromMessages(empty("ses_1"), unanswered);
      expect(read.notes).toEqual([
        { id: "note-msg_u2", quote: "the clock was frozen", prompt: "Why freeze it?", pending: false, messageId: "msg_u2" },
      ]);
      expect(read.blocks.find((b) => b.id === "msg_a3:t0")?.marginal).toBe(false);
    });
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

describe("paths in history", () => {
  it("names files from the book's root when the book directory is given", () => {
    const read = chapterFromMessages(
      empty("ses_1"),
      [
        { id: "msg_u", type: "user", text: "Go." },
        {
          id: "msg_a",
          type: "assistant",
          content: [{ type: "tool", id: "c1", name: "read", state: { status: "completed", input: { filePath: "/r/book/src/a.ts" } } }],
        },
      ],
      "/r/book",
    );
    expect(read.footnotes.map((f) => f.text)).toEqual(["Read src/a.ts."]);
  });
});
