import { describe, expect, it } from "vitest";
import type { Book, Chapter, Plate } from "../book/model";
import type { EventFrame } from "../engine/sse";
import { FIRST_PAGE_ID } from "../welcome/copy";
import { ensureFirstPage, mergeResync } from "./resync";

const S = "ses_a";

function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: S, title: "t", untitled: false, blocks: [], footnotes: [], plates: [], notes: [], asks: [], forms: [], busy: false, ...over };
}

function plate(over: Partial<Plate> = {}): Plate {
  return { id: "call-1", n: 1, file: "a.ts", title: "a.ts", caption: "", lines: [], additions: 1, deletions: 0, status: "open", folded: false, ...over };
}

const book = (...chapters: Chapter[]): Book => ({ id: "/book", title: "book", directory: "/book", sample: false, chapters });

const frame = (type: string, data: Record<string, unknown>): EventFrame => ({ type, data: { sessionID: S, ...data } });

describe("mergeResync", () => {
  it("carries a plate's status and fold across, by id", () => {
    const current = book(chapter({ blocks: [{ id: "u1", voice: "ink", text: "go" }], plates: [plate({ status: "accepted", folded: true }), plate({ id: "call-2", status: "reverted", folded: true })] }));
    const fresh = book(chapter({ blocks: [{ id: "u1", voice: "ink", text: "go" }], plates: [plate({ additions: 3 }), plate({ id: "call-2" }), plate({ id: "call-3" })] }));
    const merged = mergeResync(current, fresh, []).chapters[0];
    expect(merged.plates.map((p) => [p.id, p.status, p.folded, p.additions])).toEqual([
      ["call-1", "accepted", true, 3],
      ["call-2", "reverted", true, 1],
      ["call-3", "open", false, 1],
    ]);
  });

  it("keeps margin notes and a local ink line the press has not taken yet", () => {
    const note = { id: "note-1", quote: "q", prompt: "p", pending: true };
    const current = book(
      chapter({ blocks: [{ id: "u1", voice: "ink", text: "first" }, { id: "local-9", voice: "ink", text: "second" }], notes: [note], busy: true }),
    );
    const fresh = book(chapter({ blocks: [{ id: "u1", voice: "ink", text: "first" }], busy: false }));
    const merged = mergeResync(current, fresh, []).chapters[0];
    expect(merged.blocks.map((b) => b.id)).toEqual(["u1", "local-9"]);
    expect(merged.notes).toEqual([note]);
    expect(merged.busy).toBe(true);
  });

  it("drops a local ink line once the history holds its prompt", () => {
    const current = book(chapter({ blocks: [{ id: "local-9", voice: "ink", text: "second" }], busy: true }));
    const fresh = book(chapter({ blocks: [{ id: "msg_u2", voice: "ink", text: "second" }], busy: true }));
    const merged = mergeResync(current, fresh, []).chapters[0];
    expect(merged.blocks.map((b) => b.id)).toEqual(["msg_u2"]);
  });

  it("replays frames that arrived while the history was fetched onto the fresh chapter", () => {
    const current = book(chapter({ busy: true, blocks: [{ id: "u1", voice: "ink", text: "go" }, { id: "a1:t0", voice: "prose", text: "Hello there" }] }));
    const fresh = book(chapter({ busy: true, blocks: [{ id: "u1", voice: "ink", text: "go" }] }));
    const frames = [
      frame("session.step.started", { assistantMessageID: "a1" }),
      frame("session.text.started", { assistantMessageID: "a1", ordinal: 0 }),
      frame("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: "Hello" }),
      frame("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: " there" }),
      frame("session.execution.succeeded", {}),
    ];
    const merged = mergeResync(current, fresh, frames).chapters[0];
    expect(merged.blocks.find((b) => b.id === "a1:t0")?.text).toBe("Hello there");
    expect(merged.busy).toBe(false);
  });

  it("does not add a delta twice to text the history already holds, and keeps the live text that runs past it", () => {
    const current = book(chapter({ busy: true, blocks: [{ id: "a1:t0", voice: "prose", text: "Hello there, reader" }] }));
    const fresh = book(chapter({ busy: true, blocks: [{ id: "a1:t0", voice: "prose", text: "Hello there" }] }));
    const frames = [
      frame("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: " there" }),
      frame("session.text.delta", { assistantMessageID: "a1", ordinal: 0, delta: ", reader" }),
    ];
    expect(mergeResync(current, fresh, frames).chapters[0].blocks[0].text).toBe("Hello there, reader");
    // Live text that does not continue the history (a gap in the stream) gives way to the history.
    const gapped = book(chapter({ blocks: [{ id: "a1:t0", voice: "prose", text: "Hel, reader" }] }));
    expect(mergeResync(gapped, fresh, frames).chapters[0].blocks[0].text).toBe("Hello there");
  });

  it("keeps chapters the fresh book does not have, without replaying frames onto them", () => {
    const other = chapter({ id: "ses_new", blocks: [{ id: "b1:t0", voice: "prose", text: "abc" }] });
    const current = book(chapter(), other);
    const fresh = book(chapter());
    const frames = [{ type: "session.text.delta", data: { sessionID: "ses_new", assistantMessageID: "b1", ordinal: 0, delta: "c" } }];
    const merged = mergeResync(current, fresh, frames);
    expect(merged.chapters.map((c) => c.id)).toEqual([S, "ses_new"]);
    expect(merged.chapters[1]).toBe(other);
  });

  it("sets the first page again on a book with no text yet", () => {
    const current = ensureFirstPage(book(chapter()));
    expect(current.chapters[0].blocks[0].id).toBe(FIRST_PAGE_ID);
    const merged = mergeResync(current, book(chapter()), []);
    expect(merged.chapters[0].blocks.map((b) => b.id)).toEqual([FIRST_PAGE_ID]);
  });
});
