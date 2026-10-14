import { describe, expect, it } from "vitest";
import { applyEvent, type Frame } from "../book/events";
import type { Book, Chapter, Plate } from "../book/model";
import { chapterFromMessages } from "../book/transcript";
import { applyPlates, load, mergeState, PLATE_SESSIONS, save, withKeptPlates, type PlateStorage } from "./plateStore";

function memory(): PlateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function plate(id: string, status: Plate["status"] = "open", folded = false): Plate {
  return { id, n: 1, file: "src/a.ts", title: "a.ts", caption: "", lines: [], additions: 1, deletions: 0, status, folded };
}

function chapter(plates: Plate[]): Chapter {
  return { id: "ses_1", title: "t", untitled: false, blocks: [], footnotes: [], plates, notes: [], asks: [], forms: [], busy: false };
}

describe("the plate store", () => {
  it("keeps each plate's status and fold for its session, under folio.plates.<session>", () => {
    const storage = memory();
    save("ses_1", [plate("plate-a", "accepted"), plate("plate-b", "reverted", true)], storage);
    expect(JSON.parse(storage.data.get("folio.plates.ses_1")!)).toEqual({
      "plate-a": { status: "accepted", folded: false },
      "plate-b": { status: "reverted", folded: true },
    });
    expect(load("ses_1", storage)).toEqual({
      "plate-a": { status: "accepted", folded: false },
      "plate-b": { status: "reverted", folded: true },
    });
    expect(load("ses_2", storage)).toEqual({});
  });

  it("sets the kept state on plates with the same id, and leaves the rest as the press sent them", () => {
    const read = chapter([plate("plate-a"), plate("plate-b"), plate("diff-src/c.ts@msg_u1")]);
    const set = applyPlates(read, {
      "plate-a": { status: "accepted", folded: false },
      "diff-src/c.ts@msg_u1": { status: "reverted", folded: true },
      "plate-gone": { status: "accepted", folded: true },
    });
    expect(set.plates.map((p) => [p.id, p.status, p.folded])).toEqual([
      ["plate-a", "accepted", false],
      ["plate-b", "open", false],
      ["diff-src/c.ts@msg_u1", "reverted", true],
    ]);
    expect(applyPlates(read, {})).toBe(read);
  });

  it("sets a whole book read from history, and leaves the sample alone", () => {
    const storage = memory();
    save("ses_1", [plate("plate-a", "reverted", true)], storage);
    const read = { id: "b", title: "b", directory: "/b", sample: false, chapters: [chapter([plate("plate-a")]), { ...chapter([]), id: "ses_2" }] };
    const set = withKeptPlates(read, storage);
    expect(set.chapters[0].plates[0]).toMatchObject({ status: "reverted", folded: true });
    expect(set.chapters[1]).toBe(read.chapters[1]);
    const sample = { ...read, sample: true };
    expect(withKeptPlates(sample, storage)).toBe(sample);
  });

  it("merges a save into what is kept, so a plate not on the page yet is not forgotten", () => {
    const merged = mergeState({ "plate-old": { status: "accepted", folded: true } }, [plate("plate-new", "reverted", true)]);
    expect(merged).toEqual({
      "plate-old": { status: "accepted", folded: true },
      "plate-new": { status: "reverted", folded: true },
    });
  });

  it(`keeps at most ${PLATE_SESSIONS} sessions, dropping the one saved longest ago`, () => {
    const storage = memory();
    for (let i = 0; i <= PLATE_SESSIONS; i++) save(`ses_${i}`, [plate("p", "accepted")], storage);
    expect(load("ses_0", storage)).toEqual({});
    expect(load("ses_1", storage)).toEqual({ p: { status: "accepted", folded: false } });
    // Saving an old session again makes it the newest.
    save("ses_1", [plate("p", "reverted")], storage);
    save("ses_extra", [plate("p")], storage);
    expect(load("ses_1", storage).p.status).toBe("reverted");
    expect(load("ses_2", storage)).toEqual({});
    expect([...storage.data.keys()].filter((key) => key !== "folio.plates.index")).toHaveLength(PLATE_SESSIONS);
  });

  it("reads nothing, and throws nothing, when storage is missing, broken or full", () => {
    const broken: PlateStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(load("ses_1", broken)).toEqual({});
    expect(() => save("ses_1", [plate("p")], broken)).not.toThrow();
    const garbled = memory();
    garbled.data.set("folio.plates.ses_1", "{not json");
    garbled.data.set("folio.plates.index", "42");
    expect(load("ses_1", garbled)).toEqual({});
    expect(() => save("ses_1", [plate("p", "accepted")], garbled)).not.toThrow();
    expect(load("ses_1", garbled)).toEqual({ p: { status: "accepted", folded: false } });
    garbled.data.set("folio.plates.ses_2", JSON.stringify({ p: { status: "nonsense", folded: "yes" }, q: { status: "accepted", folded: true } }));
    expect(load("ses_2", garbled)).toEqual({ q: { status: "accepted", folded: true } });
    expect(load("ses_1", null)).toEqual({});
    expect(() => save("ses_1", [plate("p")], null)).not.toThrow();
  });

  it("gives each turn's diff plate of one file its own status across a reload", () => {
    const storage = memory();
    const patch = (line: string) => `--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -1,1 +1,2 @@\n export {};\n+${line}\n`;
    const diff = (turnMessageId: string, line: string): Frame => ({
      type: "folio.diff",
      data: { sessionID: "ses_1", turnMessageId, diff: [{ file: "src/greet.ts", patch: patch(line), status: "modified", additions: 1, deletions: 0 }] },
    });
    const prompt = (inboxID: string, text: string): Frame => ({
      type: "session.inbox.enqueued",
      data: { sessionID: "ses_1", inboxID, item: { type: "user", payload: { text } } },
    });
    // Two turns change src/greet.ts outside an edit tool (a shell call), so only the session diff sets their plates.
    const shelf: Book = { id: "r", title: "r", directory: "/r", sample: false, chapters: [chapter([])] };
    const live = [prompt("msg_u1", "Tidy greet."), diff("msg_u1", "tidy"), prompt("msg_u2", "Add a wave."), diff("msg_u2", "wave")]
      .reduce(applyEvent, shelf).chapters[0];
    expect(live.plates.map((p) => [p.id, p.n, p.turnMessageId])).toEqual([
      ["diff-src/greet.ts@msg_u1", 1, "msg_u1"],
      ["diff-src/greet.ts@msg_u2", 2, "msg_u2"],
    ]);
    // The reader rejects the first turn's change and accepts the second's.
    const [first, second] = live.plates;
    save("ses_1", [{ ...first, status: "reverted", folded: true }, { ...second, status: "accepted" }], storage);

    // A reload reads the history again and only the latest turn's diff.
    const history = [
      { id: "msg_u1", type: "user", text: "Tidy greet." },
      { id: "msg_a1", type: "assistant", content: [{ type: "text", text: "Tidied." }] },
      { id: "msg_u2", type: "user", text: "Add a wave." },
      { id: "msg_a2", type: "assistant", content: [{ type: "text", text: "Waved." }] },
    ];
    const read = chapterFromMessages(chapter([]), history, "/r");
    const rebuilt = applyEvent({ ...shelf, chapters: [read] }, diff("msg_u2", "wave")).chapters[0];
    const reopened = applyPlates(rebuilt, load("ses_1", storage));
    expect(reopened.plates).toHaveLength(1);
    expect(reopened.plates[0]).toMatchObject({ id: "diff-src/greet.ts@msg_u2", turnMessageId: "msg_u2", status: "accepted", folded: false });
    // The first turn's plate, if a later read sets it again, still finds its own status.
    const both = applyEvent({ ...shelf, chapters: [reopened] }, diff("msg_u1", "tidy")).chapters[0];
    expect(applyPlates(both, load("ses_1", storage)).plates.map((p) => [p.id, p.status, p.folded])).toEqual([
      ["diff-src/greet.ts@msg_u2", "accepted", false],
      ["diff-src/greet.ts@msg_u1", "reverted", true],
    ]);
  });

  it("saves a plate whose Reject is still in flight as open, and never reads back 'reverting'", () => {
    const storage = memory();
    save("ses_1", [plate("p", "reverting", true)], storage);
    expect(load("ses_1", storage)).toEqual({ p: { status: "open", folded: true } });
    storage.data.set("folio.plates.ses_2", JSON.stringify({ q: { status: "reverting", folded: false } }));
    expect(load("ses_2", storage)).toEqual({});
  });

  it("still holds to the cap when the index was garbled and sessions were kept outside it", () => {
    const data = new Map<string, string>();
    const storage: PlateStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
      key: (i) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    for (let i = 0; i < PLATE_SESSIONS; i++) save(`ses_${i}`, [plate("p", "accepted")], storage);
    data.set("folio.plates.index", "{garbled");
    for (let i = 0; i < 5; i++) save(`ses_new${i}`, [plate("p", "accepted")], storage);
    const kept = [...data.keys()].filter((key) => key !== "folio.plates.index");
    expect(kept).toHaveLength(PLATE_SESSIONS);
    expect(load("ses_new4", storage)).toEqual({ p: { status: "accepted", folded: false } });
    expect(JSON.parse(data.get("folio.plates.index")!)).toHaveLength(PLATE_SESSIONS);
  });
});
