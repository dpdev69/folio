import { describe, expect, it } from "vitest";
import { applyEvent, appendPrompt, MODEL_GONE, renameBlock, sentenceEnd, type Frame } from "./events";
import { parsePatch, reversePatch } from "./diff";
import { applyDiff } from "./plates";
import { quillKey } from "./quill";
import type { Book, Chapter } from "./model";
import { pushSse, unwrapEvent } from "../engine/sse";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { followTail, reduceNav, initialNav, plateShown } from "../state/nav";
import { captures, editDiff, FIXTURE_DIRECTORY } from "./__fixtures__/load";

function book(): Book {
  return {
    id: "api-server",
    title: "api-server",
    directory: "/repos/api-server",
    sample: false,
    chapters: [
      {
        id: "ses_1",
        title: "Untitled",
        untitled: true,
        blocks: [],
        footnotes: [],
        plates: [],
        notes: [],
        asks: [],
        forms: [],
        busy: false,
      },
    ],
  };
}

/** An empty shelf for the repository the captures were recorded in. */
function shelf(): Book {
  return { id: "repo", title: "repo", directory: FIXTURE_DIRECTORY, sample: false, chapters: [] };
}

/** Every frame of a capture, parsed and unwrapped the way the client does it. */
function frames(capture: string): Frame[] {
  return pushSse("", capture).events.map(unwrapEvent);
}

/** Apply frames in order; stop after the first frame `until` accepts. */
function play(start: Book, list: Frame[], until?: (frame: Frame) => boolean): Book {
  let next = start;
  for (const frame of list) {
    next = applyEvent(next, frame);
    if (until?.(frame)) break;
  }
  return next;
}

function only(next: Book): Chapter {
  expect(next.chapters).toHaveLength(1);
  return next.chapters[0];
}

function data(frame: Frame): Record<string, unknown> {
  return (frame.data ?? {}) as Record<string, unknown>;
}

function ev(type: string, fields: Record<string, unknown> = {}): Frame {
  return { id: "evt_x", type, data: { sessionID: "ses_1", ...fields } };
}

const PROMPT = "Add a `farewell(name)` function next to `greet` in src/greet.ts and briefly explain what you did";

describe("the edit capture (fixture-edit.sse)", () => {
  const list = frames(captures.edit);

  it("parses as opencode 2.0 frames", () => {
    expect(list.length).toBeGreaterThan(30);
    expect(list.every((frame) => typeof frame.type === "string" && frame.data !== undefined)).toBe(true);
  });

  it("sets the prompt in ink, two footnotes, one plate and the explanation as prose", () => {
    const chapter = only(play(shelf(), list));
    expect(chapter.title).toBe("fixture edit");
    expect(chapter.untitled).toBe(false);
    const ink = chapter.blocks.filter((b) => b.voice === "ink");
    const prose = chapter.blocks.filter((b) => b.voice === "prose");
    expect(ink).toEqual([{ id: "msg_1378318cd0011en9zAGWcvx4bC", voice: "ink", text: PROMPT }]);
    expect(prose).toHaveLength(1);
    expect(prose[0].id).toBe("msg_137831fee001iiy0rpghC3oXA3:t0");
    expect(prose[0].text).toBe(
      "Added a `farewell(name)` function to `src/greet.ts` that returns `Goodbye, ${name}!`, mirroring the existing `greet` function's style.",
    );
    // The capture has two tool calls: read, then edit.
    expect(chapter.footnotes.map((f) => [f.n, f.text, f.pending])).toEqual([
      [1, "Read src/greet.ts.", false],
      [2, "Edited src/greet.ts, 4 lines added. See Plate I →", false],
    ]);
    expect(chapter.plates).toHaveLength(1);
    const plate = chapter.plates[0];
    expect(chapter.footnotes[1].plateId).toBe(plate.id);
    expect(plate).toMatchObject({
      n: 1,
      file: "src/greet.ts",
      additions: 4,
      deletions: 0,
      status: "open",
      messageId: "msg_137831c9e001HUpkVsrAUYd8JQ",
      turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC",
    });
    expect(plate.lines.some((l) => l.kind === "add" && l.text === "export function farewell(name: string): string {")).toBe(
      true,
    );
  });

  it("leaves no reasoning on the page and ends idle", () => {
    const chapter = only(play(shelf(), list));
    const page = JSON.stringify([chapter.blocks, chapter.footnotes, chapter.notes]);
    expect(page).not.toContain("Let me look at the file first");
    expect(page).not.toContain("Brief explanation");
    expect(chapter.busy).toBe(false);
    expect(chapter.error).toBeUndefined();
  });

  it("is busy while the press runs and names each step's turn", () => {
    const running = only(play(shelf(), list, (f) => f.type === "session.execution.started"));
    expect(running.busy).toBe(true);
    const chapter = only(play(shelf(), list));
    expect(chapter.turns).toEqual({
      msg_1378318e10012iu0GHevUQHJMp: "msg_1378318cd0011en9zAGWcvx4bC",
      msg_137831c9e001HUpkVsrAUYd8JQ: "msg_1378318cd0011en9zAGWcvx4bC",
      msg_137831fee001iiy0rpghC3oXA3: "msg_1378318cd0011en9zAGWcvx4bC",
    });
  });

  it("marks the diff stale only after a step that changed files", () => {
    const readStep = only(
      play(shelf(), list, (f) => f.type === "session.step.ended" && (data(f).files as string[]).length === 0),
    );
    expect(readStep.diffStale).toBeUndefined();
    const editStep = only(play(shelf(), list, (f) => f.type === "session.step.ended" && (data(f).files as string[]).length > 0));
    expect(editStep.diffStale).toBe(true);
    expect(only(play(shelf(), list)).diffStale).toBe(true);
  });

  it("sets the session diff on the plate and clears the stale mark", () => {
    const pressed = play(shelf(), list);
    const sessionID = pressed.chapters[0].id;
    const folded = {
      ...pressed,
      chapters: [{ ...pressed.chapters[0], plates: pressed.chapters[0].plates.map((p) => ({ ...p, folded: true })) }],
    };
    const chapter = only(applyEvent(folded, { type: "folio.diff", data: { sessionID, diff: editDiff } }));
    expect(chapter.diffStale).toBe(false);
    expect(chapter.plates).toHaveLength(1);
    expect(chapter.plates[0]).toMatchObject({ n: 1, folded: true, status: "open", caption: "The change in src/greet.ts." });
    expect(chapter.plates[0].lines).toEqual(parsePatch(editDiff[0].patch));
  });

  it("opens a new plate for a file the diff names first, for the current turn", () => {
    const pressed = play(shelf(), list);
    const sessionID = pressed.chapters[0].id;
    const patch = "--- /dev/null\n+++ b/src/wave.ts\n@@ -0,0 +1,1 @@\n+export const wave = 1;\n";
    const chapter = only(
      applyEvent(pressed, {
        type: "folio.diff",
        data: { sessionID, diff: [{ file: "src/wave.ts", patch, additions: 1, deletions: 0, status: "added" }] },
      }),
    );
    expect(chapter.plates[1]).toMatchObject({
      id: "diff-src/wave.ts@msg_1378318cd0011en9zAGWcvx4bC",
      n: 2,
      file: "src/wave.ts",
      caption: "New file src/wave.ts.",
      additions: 1,
      turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC",
    });
  });
});

describe("the session diff (folio.diff)", () => {
  const patch = (lines: string[]) =>
    ["--- a/src/greet.ts", "+++ b/src/greet.ts", `@@ -1,1 +1,${lines.length + 1} @@`, " export {};", ...lines.map((l) => `+${l}`), ""].join("\n");

  /** The edit capture, then a second turn that edits src/greet.ts again, once or twice. */
  function secondTurn(edits: number): Book {
    let next = play(shelf(), frames(captures.edit));
    const sessionID = next.chapters[0].id;
    const at = (type: string, fields: Record<string, unknown>): Frame => ({
      type,
      data: { sessionID, assistantMessageID: "msg_a2", ...fields },
    });
    next = play(next, [
      at("session.inbox.enqueued", { inboxID: "msg_u2", item: { type: "user", payload: { text: "And a wave." } } }),
      at("session.step.started", {}),
    ]);
    for (let i = 1; i <= edits; i++) {
      next = play(next, [
        at("session.tool.input.started", { id: `call-w${i}`, name: "edit" }),
        at("session.tool.called", { id: `call-w${i}`, input: { path: "src/greet.ts", oldString: "x", newString: "x\ny" } }),
        at("session.tool.success", {
          id: `call-w${i}`,
          content: [{ type: "text", text: "Edited" }],
          metadata: { files: [{ file: "src/greet.ts", patch: patch([`wave${i}`]), status: "modified", additions: 1, deletions: 0 }] },
        }),
      ]);
    }
    return next;
  }

  function diffed(start: Book, lines: string[]): Chapter {
    const diff = [{ file: "src/greet.ts", patch: patch(lines), status: "modified", additions: lines.length, deletions: 0 }];
    return only(applyEvent(start, { type: "folio.diff", data: { sessionID: start.chapters[0].id, diff } }));
  }

  it("sets the turn's diff on that turn's plate and leaves the earlier turn's plate alone", () => {
    const before = secondTurn(1);
    const chapter = diffed(before, ["wave1"]);
    expect(chapter.plates).toHaveLength(2);
    expect(chapter.plates[0]).toEqual(before.chapters[0].plates[0]);
    expect(chapter.plates[1]).toMatchObject({ id: "plate-call-w1", turnMessageId: "msg_u2", additions: 1 });
  });

  it("re-words the footnote of a plate the diff widened, so the two agree", () => {
    // One edit in the turn, but the turn's diff also holds a line a shell command wrote.
    const chapter = diffed(secondTurn(1), ["wave1", "wave2"]);
    expect(chapter.plates.map((p) => [p.id, p.additions])).toEqual([
      ["plate-call-816f41ab-c832-4c99-90c1-7a0d47056457", 4],
      ["plate-call-w1", 2],
    ]);
    expect(chapter.footnotes.find((f) => f.id === "call-w1")?.text).toBe("Edited src/greet.ts, 2 lines added. See Plate II →");
  });

  it("keeps each of two edits to one file in a turn showing its own change, not the turn's", () => {
    const before = secondTurn(2);
    const chapter = diffed(before, ["wave1", "wave2"]);
    expect(chapter.plates.map((p) => [p.id, p.additions])).toEqual([
      ["plate-call-816f41ab-c832-4c99-90c1-7a0d47056457", 4],
      ["plate-call-w1", 1],
      ["plate-call-w2", 1],
    ]);
    expect(chapter.plates[2].lines).toEqual(parsePatch(patch(["wave2"])));
    expect(chapter.plates[2]).toEqual(before.chapters[0].plates[2]);
    expect(chapter.footnotes.find((f) => f.id === "call-w2")?.text).toBe("Edited src/greet.ts, 1 line added. See Plate III →");
    expect(chapter.footnotes.find((f) => f.id === "call-w1")?.text).toBe("Edited src/greet.ts, 1 line added. See Plate II →");
  });

  it("leaves each of two edits to one file in a turn its own patch, so Reject undoes only its own", () => {
    const before = secondTurn(2);
    const own = before.chapters[0].plates.map((p) => p.patch);
    // Each edit added its line under `export {};`, so the turn's diff covers both.
    const chapter = diffed(before, ["wave2", "wave1"]);
    expect(chapter.plates.map((p) => p.patch)).toEqual(own);
    const [, first, second] = chapter.plates;
    expect(first.patch).toBe(patch(["wave1"]));
    expect(second.patch).toBe(patch(["wave2"]));
    // Reject on Plate III takes out wave2 and leaves Plate II's wave1 in the file.
    expect(reversePatch("export {};\nwave2\nwave1\n", second.patch!)).toBe("export {};\nwave1\n");
  });

  it("gives the turn's patch to a patchless tool plate only when it is the turn's one plate for the file", () => {
    const toolPlate = (id: string, n: number) => ({
      id,
      n,
      turnMessageId: "msg_u1",
      file: "src/greet.ts",
      title: "greet.ts",
      caption: "",
      lines: [{ kind: "add" as const, text: "x" }],
      additions: 1,
      deletions: 0,
      status: "open" as const,
      folded: false,
    });
    const diff = [{ file: "src/greet.ts", patch: patch(["wave1", "wave2"]), status: "modified" }];
    const two = { ...book().chapters[0], plates: [toolPlate("plate-a", 1), toolPlate("plate-b", 2)] };
    const shared = applyDiff(two, diff, "msg_u1");
    // The turn's patch covers both edits; neither plate may take it as its own, so Reject refuses.
    expect(shared.plates.map((p) => p.patch)).toEqual([undefined, undefined]);
    const one = { ...book().chapters[0], plates: [toolPlate("plate-a", 1)] };
    expect(applyDiff(one, diff, "msg_u1").plates[0].patch).toBe(diff[0].patch);
  });

  it("names a diff plate by its file alone only when no turn is known", () => {
    const bare = book().chapters[0];
    const diff = [{ file: "src/greet.ts", patch: patch(["wave"]), status: "modified" }];
    expect(applyDiff(bare, diff, undefined, true).plates[0]).toMatchObject({ id: "diff-src/greet.ts", patch: undefined });
    expect(applyDiff(bare, diff, "msg_u1").plates[0].id).toBe("diff-src/greet.ts@msg_u1");
  });

  it("opens a plate of its own when the current turn has none for the file", () => {
    let start = secondTurn(0);
    const chapter = diffed(start, ["wave"]);
    expect(chapter.plates[0]).toEqual(start.chapters[0].plates[0]);
    expect(chapter.plates[1]).toMatchObject({ id: "diff-src/greet.ts@msg_u2", n: 2, turnMessageId: "msg_u2", additions: 1 });
    // A later turn's plate for the same file gets an id of its own, named by its turn.
    start = play({ ...start, chapters: [chapter] }, [
      { type: "session.inbox.enqueued", data: { sessionID: chapter.id, inboxID: "msg_u3", item: { type: "user", payload: { text: "More." } } } },
    ]);
    const third = diffed(start, ["more"]);
    expect(third.plates.map((p) => [p.id, p.turnMessageId])).toEqual([
      ["plate-call-816f41ab-c832-4c99-90c1-7a0d47056457", "msg_1378318cd0011en9zAGWcvx4bC"],
      ["diff-src/greet.ts@msg_u2", "msg_u2"],
      ["diff-src/greet.ts@msg_u3", "msg_u3"],
    ]);
  });
});

describe("the ask capture (fixture-ask.sse)", () => {
  const list = frames(captures.ask);

  it("shows the ask with its patch, and the plate is never empty while it waits", () => {
    const waiting = only(play(shelf(), list, (f) => f.type === "permission.asked"));
    expect(waiting.asks).toHaveLength(1);
    expect(waiting.asks[0]).toMatchObject({
      id: "per_13784ca75001ULlav0hXATVSbe",
      permission: "edit",
      patterns: ["src/greet.ts"],
      title: "May I edit src/greet.ts?",
    });
    expect(waiting.asks[0].patch).toContain("+export function farewell(name: string): string {");
    expect(waiting.footnotes[1]).toMatchObject({ text: "Editing src/greet.ts…", pending: true });
    expect(waiting.plates).toHaveLength(1);
    expect(waiting.plates[0].lines.some((l) => l.kind === "add" && l.text.startsWith("export function farewell"))).toBe(
      true,
    );
  });

  it("takes the ask away once it is answered, and finishes the edit from the patch", () => {
    const answered = only(play(shelf(), list, (f) => f.type === "permission.replied"));
    expect(answered.asks).toEqual([]);
    const chapter = only(play(shelf(), list));
    expect(chapter.footnotes[1].text).toBe("Edited src/greet.ts, 4 lines added. See Plate I →");
    const success = list.find((f) => f.type === "session.tool.success" && data(f).metadata && "files" in (data(f).metadata as object));
    const files = (data(success!).metadata as { files: { patch: string }[] }).files;
    expect(chapter.plates[0].lines).toEqual(parsePatch(files[0].patch));
    expect(chapter.busy).toBe(false);
  });
});

describe("the question capture (aux-question.sse)", () => {
  const list = frames(captures.question);

  it("sets out the form with its options, then puts it away when answered", () => {
    const asked = only(play(shelf(), list, (f) => f.type === "form.created"));
    expect(asked.forms).toEqual([
      {
        id: "frm_137858dc2001K01Vv8YDfRjzW1",
        title: "Questions",
        fields: [
          {
            key: "q0",
            title: "Greet language",
            description: "Which language should greet() use?",
            type: "string",
            options: [
              { value: "English", label: "English", description: "Greet in English" },
              { value: "French", label: "French", description: "Greet in French" },
            ],
            custom: true,
          },
        ],
      },
    ]);
    const chapter = only(play(shelf(), list));
    expect(chapter.forms).toEqual([]);
    expect(chapter.footnotes.map((f) => f.text)).toEqual(["Asked a question: Which language should greet() use?"]);
    expect(chapter.blocks.filter((b) => b.voice === "prose").map((b) => b.text)).toEqual(["French."]);
  });
});

describe("the reject capture (aux-reject.sse)", () => {
  it("words the turned-down edit as declined, drops its plate, and lets the turn go on", () => {
    const chapter = only(play(shelf(), frames(captures.reject)));
    expect(chapter.footnotes.map((f) => f.text)).toEqual(["Read src/greet.ts.", "The edit to src/greet.ts was declined."]);
    expect(chapter.footnotes[1].plateId).toBeUndefined();
    expect(chapter.plates).toEqual([]);
    expect(chapter.asks).toEqual([]);
    const prose = chapter.blocks.filter((b) => b.voice === "prose");
    expect(prose).toHaveLength(1);
    expect(prose[0].text.startsWith("I added a `shout(name)` function")).toBe(true);
    expect(chapter.busy).toBe(false);
    expect(chapter.error).toBeUndefined();
  });
});

describe("the interrupt capture (aux-interrupt.sse)", () => {
  it("goes idle without an error and keeps the partial text", () => {
    const chapter = only(play(shelf(), frames(captures.interrupt)));
    expect(chapter.busy).toBe(false);
    expect(chapter.error).toBeUndefined();
    expect(chapter.notice).toBeUndefined();
    const prose = chapter.blocks.filter((b) => b.voice === "prose");
    expect(prose).toHaveLength(1);
    expect(prose[0].text.startsWith("# The History of Greetings")).toBe(true);
  });
});

describe("events", () => {
  it("names the chapter on rename, unless the new title is a placeholder", () => {
    let next = applyEvent(book(), ev("session.renamed", { title: "The flaky login test" }));
    expect(next.chapters[0]).toMatchObject({ title: "The flaky login test", untitled: false });
    next = applyEvent(next, ev("session.renamed", { title: "New session - 2026" }));
    expect(next.chapters[0]).toMatchObject({ title: "The flaky login test", untitled: false });
  });

  it("treats a directory written another way as the book's own", () => {
    const created = (directory: string, sessionID: string): Frame => ({
      type: "session.created",
      location: { directory },
      data: { sessionID, location: { directory }, title: "Same place" },
    });
    expect(applyEvent(book(), created("/repos/api-server/", "ses_5")).chapters.map((c) => c.id)).toEqual(["ses_1", "ses_5"]);
    const tmp = { ...book(), directory: "/tmp/folio/repo" };
    expect(applyEvent(tmp, created("/private/tmp/folio/repo", "ses_6")).chapters.map((c) => c.id)).toContain("ses_6");
  });

  it("opens chapters only for this book's directory, and closes them on delete", () => {
    const created = (directory: string, sessionID: string): Frame => ({
      type: "session.created",
      location: { directory },
      data: { sessionID, location: { directory }, title: "Elsewhere" },
    });
    let next = applyEvent(book(), created("/repos/other", "ses_2"));
    expect(next.chapters).toHaveLength(1);
    next = applyEvent(next, created("/repos/api-server", "ses_3"));
    expect(next.chapters.map((c) => c.id)).toEqual(["ses_1", "ses_3"]);
    expect(next.chapters[1]).toMatchObject({ forms: [], asks: [], busy: false });
    next = applyEvent(next, ev("session.deleted"));
    expect(next.chapters.map((c) => c.id)).toEqual(["ses_3"]);
  });

  it("knows whether a chapter asks before the press writes, from its rules", () => {
    const asking = applyEvent(book(), ev("session.permissions", { permissions: [{ action: "edit", resource: "*", effect: "ask" }] }));
    expect(asking.chapters[0].askRules).toBe(true);
    const plain = applyEvent(asking, ev("session.permissions", { permissions: [] }));
    expect(plain.chapters[0].askRules).toBe(false);
    expect(applyEvent(plain, ev("session.permissions", { permissions: [] }))).toBe(plain);
    const created = applyEvent(book(), {
      type: "session.created",
      data: { sessionID: "ses_4", location: { directory: "/repos/api-server" }, permissions: [{ action: "edit", resource: "*", effect: "ask" }] },
    });
    expect(created.chapters[1].askRules).toBe(true);
  });

  it("clears a retry or interruption notice when a run starts, succeeds or fails", () => {
    const retrying = applyEvent(book(), ev("session.retry.scheduled", { attempt: 2 }));
    expect(retrying.chapters[0].notice).toBe("Trying again (attempt 2)…");
    expect(applyEvent(retrying, ev("session.execution.succeeded")).chapters[0].notice).toBeUndefined();
    expect(applyEvent(retrying, ev("session.execution.failed", { error: { message: "No." } })).chapters[0].notice).toBeUndefined();
    const interrupted = applyEvent(book(), ev("session.execution.interrupted", { reason: "shutdown" }));
    expect(interrupted.chapters[0].notice).toBe("The press was interrupted.");
    expect(applyEvent(interrupted, ev("session.execution.started")).chapters[0].notice).toBeUndefined();
  });

  it("never opens a chapter for a subagent's session", () => {
    const start = book();
    const child: Frame = {
      type: "session.created",
      location: { directory: "/repos/api-server" },
      data: { sessionID: "ses_child", parentID: "ses_1", location: { directory: "/repos/api-server" }, title: "A subagent" },
    };
    expect(applyEvent(start, child)).toBe(start);
    // Its prose never reaches the book either, having no chapter to go to.
    const text = applyEvent(start, ev("session.text.delta", { sessionID: "ses_child", assistantMessageID: "m", ordinal: 0, delta: "x" }));
    expect(text).toBe(start);
  });

  it("returns the same book for frames it does not set in type", () => {
    const start = book();
    expect(applyEvent(start, ev("session.usage.updated", { cost: 0 }))).toBe(start);
    expect(applyEvent(start, ev("session.reasoning.delta", { assistantMessageID: "m", ordinal: 0, delta: "Hm" }))).toBe(start);
    expect(applyEvent(start, ev("session.tool.success", { id: "call-unknown", content: [] }))).toBe(start);
    expect(applyEvent(start, { type: "server.connected", data: {} })).toBe(start);
    expect(applyEvent(start, { type: "message.part.updated", properties: { sessionID: "ses_1" } })).toBe(start);
    expect(applyEvent(start, ev("session.text.delta", { sessionID: "ses_9", assistantMessageID: "m", ordinal: 0, delta: "x" }))).toBe(
      start,
    );
  });

  it("reports a failed run in a sentence and an interruption as a notice", () => {
    let next = applyEvent(book(), ev("session.execution.started"));
    next = applyEvent(next, ev("session.execution.failed", { error: { type: "provider", message: "The model is busy." } }));
    expect(next.chapters[0]).toMatchObject({ busy: false, error: "The model is busy." });
    next = applyEvent(next, ev("session.execution.started"));
    expect(next.chapters[0].error).toBeUndefined();
    next = applyEvent(next, ev("session.execution.failed", { error: { type: "unknown" } }));
    expect(next.chapters[0].error).toBe("The press stopped.");
    next = applyEvent(next, ev("session.execution.interrupted", { reason: "shutdown" }));
    expect(next.chapters[0].notice).toBe("The press was interrupted.");
  });

  it("notes a retry until the next step begins", () => {
    let next = applyEvent(book(), ev("session.retry.scheduled", { assistantMessageID: "m1", attempt: 2, error: {} }));
    expect(next.chapters[0].notice).toBe("Trying again (attempt 2)…");
    next = applyEvent(next, ev("session.step.started", { assistantMessageID: "m1" }));
    expect(next.chapters[0].notice).toBeUndefined();
  });

  it("never shortens a block when the text ends", () => {
    let next = applyEvent(book(), ev("session.text.delta", { assistantMessageID: "m1", ordinal: 0, delta: "The whole sentence." }));
    next = applyEvent(next, ev("session.text.ended", { assistantMessageID: "m1", ordinal: 0, text: "The whole" }));
    expect(next.chapters[0].blocks[0]).toEqual({ id: "m1:t0", voice: "prose", text: "The whole sentence.", marginal: false });
  });

  it("adopts the optimistic quill line under the user message id, so the turn is named by it", () => {
    const seeded = { ...book(), chapters: [appendPrompt(book().chapters[0], "Cap it at two seconds.", "local-1")] };
    let next = applyEvent(
      seeded,
      ev("session.inbox.enqueued", { inboxID: "msg_u1", item: { type: "user", payload: { text: "Cap it at two seconds.\n" } } }),
    );
    expect(next.chapters[0].blocks).toEqual([{ id: "msg_u1", voice: "ink", text: "Cap it at two seconds." }]);
    next = applyEvent(next, ev("session.step.started", { assistantMessageID: "msg_a1" }));
    expect(next.chapters[0].turns).toEqual({ msg_a1: "msg_u1" });
  });

  it("adopts each optimistic line once, oldest first, so a repeated prompt is not swallowed", () => {
    let chapter = appendPrompt(book().chapters[0], "Yes.", "local-1");
    chapter = appendPrompt(chapter, "Yes.", "local-2");
    const enqueued = (inboxID: string) =>
      ev("session.inbox.enqueued", { inboxID, item: { type: "user", payload: { text: "Yes." } } });
    let next = applyEvent({ ...book(), chapters: [chapter] }, enqueued("msg_u1"));
    expect(applyEvent(next, enqueued("msg_u1"))).toBe(next);
    next = applyEvent(next, enqueued("msg_u2"));
    expect(next.chapters[0].blocks.map((b) => b.id)).toEqual(["msg_u1", "msg_u2"]);
    next = applyEvent(next, enqueued("msg_u3"));
    expect(next.chapters[0].blocks.map((b) => b.id)).toEqual(["msg_u1", "msg_u2", "msg_u3"]);
  });

  it("renames a block late and corrects the turn, the plate and the footnotes that name it", () => {
    let next = { ...book(), chapters: [appendPrompt(book().chapters[0], "Edit a.", "local-1")] };
    next = play(next, [
      ev("session.step.started", { assistantMessageID: "msg_a1" }),
      ev("session.tool.input.started", { assistantMessageID: "msg_a1", id: "call-1", name: "edit" }),
      ev("session.tool.called", { assistantMessageID: "msg_a1", id: "call-1", input: { path: "a.ts", oldString: "a", newString: "a\nb" } }),
    ]);
    expect(next.chapters[0].turns).toEqual({ msg_a1: "local-1" });
    expect(next.chapters[0].plates[0].turnMessageId).toBe("local-1");
    expect(next.chapters[0].footnotes[0].blockId).toBe("local-1");
    const renamed = renameBlock(next.chapters[0], "local-1", "msg_u1");
    expect(renamed.blocks.map((b) => b.id)).toEqual(["msg_u1"]);
    expect(renamed.turns).toEqual({ msg_a1: "msg_u1" });
    expect(renamed.plates[0].turnMessageId).toBe("msg_u1");
    expect(renamed.footnotes[0].blockId).toBe("msg_u1");
    expect(renameBlock(renamed, "local-1", "msg_u1")).toBe(renamed);
  });

  it("asks in plain words for shell and wildcard permissions", () => {
    let next = applyEvent(book(), ev("permission.asked", { id: "per_1", action: "shell", resources: ["npm test"] }));
    next = applyEvent(next, ev("permission.asked", { id: "per_2", action: "*", resources: ["*"] }));
    expect(next.chapters[0].asks.map((a) => a.title)).toEqual(["May I run npm test?", "May I act on this?"]);
    next = applyEvent(next, ev("permission.replied", { requestID: "per_1", reply: "reject" }));
    expect(next.chapters[0].asks.map((a) => a.id)).toEqual(["per_2"]);
  });

  it("removes a cancelled form", () => {
    let next = applyEvent(
      book(),
      ev("form.created", { form: { id: "frm_1", title: "Questions", fields: [{ key: "q0", title: "Which?", type: "boolean" }] } }),
    );
    expect(next.chapters[0].forms).toEqual([{ id: "frm_1", title: "Questions", fields: [{ key: "q0", title: "Which?", type: "boolean" }] }]);
    next = applyEvent(next, ev("form.cancelled", { id: "frm_1" }));
    expect(next.chapters[0].forms).toEqual([]);
  });

  it("builds an edit plate from its strings until the patch arrives", () => {
    let next = applyEvent(book(), ev("session.tool.input.started", { assistantMessageID: "m1", id: "call-1", name: "edit" }));
    next = applyEvent(
      next,
      ev("session.tool.called", {
        assistantMessageID: "m1",
        id: "call-1",
        input: { path: "src/a.ts", oldString: "one\ntwo", newString: "one\n2\ntwo" },
      }),
    );
    const plate = next.chapters[0].plates[0];
    expect(plate).toMatchObject({ id: "plate-call-1", file: "src/a.ts", additions: 1, deletions: 0, messageId: "m1" });
    expect(plate.lines.map((l) => [l.kind, l.text])).toEqual([
      ["context", "one"],
      ["add", "2"],
      ["context", "two"],
    ]);
  });
});

describe("margin notes", () => {
  function noted(): Book {
    return {
      ...book(),
      chapters: [
        {
          ...book().chapters[0],
          notes: [{ id: "note_1", quote: "mirrors", prompt: "why?", pending: true, messageId: "msg_note" }],
          turns: { m2: "msg_note" },
        },
      ],
    };
  }
  const text = (type: string, fields: Record<string, unknown>) => ev(type, { assistantMessageID: "m2", ordinal: 0, ...fields });

  it("gives a note only the text of its own turn; the main reply still writing stays in the flow", () => {
    // The main turn (msg_main) is still writing when the note is sent.
    const start: Book = {
      ...book(),
      chapters: [
        {
          ...book().chapters[0],
          blocks: [{ id: "msg_main", voice: "ink", text: "Fix the test." }],
          notes: [{ id: "note_1", quote: "mirrors", prompt: "why?", pending: true }],
          turns: { m1: "msg_main" },
        },
      ],
    };
    let next = applyEvent(start, ev("session.text.started", { assistantMessageID: "m1", ordinal: 1 }));
    next = applyEvent(next, ev("session.text.ended", { assistantMessageID: "m1", ordinal: 1, text: "The test passes now." }));
    expect(next.chapters[0].blocks[1]).toMatchObject({ id: "m1:t1", marginal: false, text: "The test passes now." });
    expect(next.chapters[0].notes[0]).toMatchObject({ pending: true });
    expect(next.chapters[0].notes[0].reply).toBeUndefined();
  });

  it("learns a note's message id from its own prompt in the inbox, and gives that turn's text to it", () => {
    const composed = "About this passage:\n\n> mirrors\n\nwhy?";
    const start: Book = {
      ...book(),
      chapters: [{ ...book().chapters[0], notes: [{ id: "note_1", quote: "mirrors", prompt: "why?", pending: true }] }],
    };
    let next = applyEvent(start, ev("session.inbox.enqueued", { inboxID: "msg_n", item: { type: "user", payload: { text: composed } } }));
    expect(next.chapters[0].notes[0].messageId).toBe("msg_n");
    next = applyEvent(next, ev("session.step.started", { assistantMessageID: "m9" }));
    next = applyEvent(next, ev("session.text.ended", { assistantMessageID: "m9", ordinal: 0, text: "Because greet does." }));
    expect(next.chapters[0].blocks.find((b) => b.id === "m9:t0")).toMatchObject({ marginal: true });
    expect(next.chapters[0].notes[0]).toMatchObject({ pending: false, reply: "Because greet does." });
  });

  it("keeps a note open through the empty start and closes it with the full reply", () => {
    let next = applyEvent(noted(), text("session.text.started", {}));
    expect(next.chapters[0].blocks[0]).toMatchObject({ id: "m2:t0", marginal: true, text: "" });
    expect(next.chapters[0].notes[0].pending).toBe(true);
    expect(next.chapters[0].notes[0].reply).toBeUndefined();
    next = applyEvent(next, text("session.text.delta", { delta: "It mirrors " }));
    expect(next.chapters[0].notes[0]).toMatchObject({ pending: true, reply: "It mirrors " });
    next = applyEvent(next, text("session.text.ended", { text: "It mirrors the shape of greet." }));
    expect(next.chapters[0].notes[0]).toMatchObject({ pending: false, reply: "It mirrors the shape of greet." });
  });

  it("does not let reasoning take a pending note", () => {
    let next = applyEvent(noted(), text("session.reasoning.started", {}));
    next = applyEvent(next, text("session.reasoning.delta", { delta: "Thinking about the quote." }));
    expect(next.chapters[0].notes[0].reply).toBeUndefined();
    expect(next.chapters[0].blocks).toHaveLength(0);
  });

  it("closes a note still waiting when the run ends", () => {
    const next = applyEvent(noted(), ev("session.execution.succeeded"));
    expect(next.chapters[0].notes[0].pending).toBe(false);
    expect(next.chapters[0].busy).toBe(false);
  });
});

describe("quill", () => {
  it("submits on a second return and keeps a single return", () => {
    const once = quillKey("Cap it.", "Enter");
    expect(once.submit).toBeNull();
    expect(once.value).toBe("Cap it.\n");
    const twice = quillKey(once.value, "Enter");
    expect(twice.submit).toBe("Cap it.");
    expect(twice.value).toBe("");
    expect(quillKey("\n", "Enter").submit).toBeNull();
  });
});

describe("sse", () => {
  it("parses complete frames and holds a partial one", () => {
    const first = pushSse("", 'data: {"id":"evt_1","type":"server.connected","data":{}}\n\n: heartbeat\n\n');
    expect(first.events).toEqual([{ id: "evt_1", type: "server.connected", data: {} }]);
    const partial = pushSse("", 'data: {"type":"session.execution.started"');
    expect(partial.events).toEqual([]);
    const done = pushSse(partial.rest, ',"data":{"sessionID":"ses_1"}}\n\n');
    expect(done.events).toEqual([{ type: "session.execution.started", data: { sessionID: "ses_1" } }]);
  });

  it("unwraps an opencode 2.0 frame to its type, data and location", () => {
    const frame = pushSse(
      "",
      'data: {"id":"evt_1","created":1,"type":"session.text.delta","location":{"directory":"/r"},"data":{"sessionID":"ses_1","delta":"Hi"},"durable":{"seq":3}}\n\n',
    );
    expect(unwrapEvent(frame.events[0])).toEqual({
      type: "session.text.delta",
      data: { sessionID: "ses_1", delta: "Hi" },
      location: { directory: "/r" },
    });
    expect(unwrapEvent({ type: "server.connected", data: {} })).toEqual({ type: "server.connected", data: {} });
  });
});

describe("license", () => {
  it("leaves this build unchecked and does not block", async () => {
    const status = await uncheckedLicense.check();
    expect(status.state).toBe("unchecked");
    expect(licenseBlocks(status)).toBe(false);
    expect(licenseBlocks({ state: "expired" })).toBe(true);
  });
});

describe("page turns", () => {
  it("turns within the book and asks for a new chapter past the last page", () => {
    let nav = initialNav(0);
    let step = reduceNav(nav, { type: "turn", forward: true, spreadCount: 3 });
    expect(step.nav.curl?.to).toBe(1);
    nav = reduceNav(step.nav, { type: "curl-done" }).nav;
    step = reduceNav(nav, { type: "turn", forward: true, spreadCount: 2 });
    expect(step.effect).toBe("new-chapter");
    expect(step.nav.spread).toBe(1);
  });

  it("opens a plate over the right page and folds it back", () => {
    const opened = reduceNav(initialNav(1), { type: "open-plate", id: "plate-1" }).nav;
    expect(opened).toMatchObject({ spread: 1, plateOpen: "plate-1", curl: null });
    expect(reduceNav(opened, { type: "fold-plate" }).nav.plateOpen).toBeNull();
    expect(initialNav(0).plateOpen).toBeNull();
  });

  it("closes an open plate on a turn either way, and asks for a chapter only past the last spread", () => {
    const opened = reduceNav(initialNav(1), { type: "open-plate", id: "plate-1" }).nav;
    const forward = reduceNav(opened, { type: "turn", forward: true, spreadCount: 3 });
    expect(forward.effect).toBeUndefined();
    expect(forward.nav).toMatchObject({ plateOpen: null, curl: { to: 2, forward: true } });
    const back = reduceNav(opened, { type: "turn", forward: false, spreadCount: 3 });
    expect(back.nav).toMatchObject({ plateOpen: null, curl: { to: 0, forward: false } });
    const last = reduceNav(opened, { type: "turn", forward: true, spreadCount: 2 });
    expect(last.effect).toBe("new-chapter");
    expect(last.nav.plateOpen).toBeNull();
    expect(reduceNav(opened, { type: "jump", spread: 0 }).nav.plateOpen).toBeNull();
  });

  it("folds an open plate back when a curl lands, whoever started it", () => {
    const opened = reduceNav(initialNav(1), { type: "open-plate", id: "plate-1" }).nav;
    // The tail-follow and chapter-jump effects set the curl directly, not through turn or jump.
    const carried = { ...opened, curl: { to: 2, forward: true } };
    expect(reduceNav(carried, { type: "curl-done" }).nav).toMatchObject({ spread: 2, curl: null, plateOpen: null });
  });

  it("does not open a plate while a page is turning", () => {
    const turning = { ...initialNav(1), curl: { to: 2, forward: true } };
    expect(reduceNav(turning, { type: "open-plate", id: "plate-1" }).nav.plateOpen).toBeNull();
  });

  it("shows an open plate only on the spread that footnotes it, and not under a curl", () => {
    const opened = reduceNav(initialNav(1), { type: "open-plate", id: "plate-1" }).nav;
    expect(plateShown(opened, ["plate-1", "plate-2"])).toBe("plate-1");
    expect(plateShown(opened, ["plate-2"])).toBeNull();
    expect(plateShown({ ...opened, curl: { to: 2, forward: true } }, ["plate-1"])).toBeNull();
    expect(plateShown(initialNav(1), ["plate-1"])).toBeNull();
  });
});

describe("footnote anchors", () => {
  const AID = "msg_a";
  function tool(status: "running" | "completed"): Frame[] {
    if (status === "completed") return [ev("session.tool.success", { assistantMessageID: AID, id: "call-1", content: [] })];
    return [
      ev("session.tool.input.started", { assistantMessageID: AID, id: "call-1", name: "shell" }),
      ev("session.tool.called", { assistantMessageID: AID, id: "call-1", input: { command: "npm test" } }),
    ];
  }
  function delta(ordinal: number, text: string): Frame {
    return ev("session.text.delta", { assistantMessageID: AID, ordinal, delta: text });
  }

  it("anchors at the last finished sentence and stays there while the text grows", () => {
    let next = applyEvent(book(), delta(0, "I reordered the setup. Then I ra"));
    next = play(next, tool("running"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "msg_a:t0", offset: "I reordered the setup.".length });
    next = applyEvent(next, delta(0, "n the suite again. It passed."));
    next = play(next, tool("completed"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({
      blockId: "msg_a:t0",
      offset: "I reordered the setup.".length,
      pending: false,
      text: "Ran npm test.",
    });
  });

  it("holds a tool that comes before any text until the next text part adopts it", () => {
    let next = play(book(), tool("running"));
    expect(next.chapters[0].footnotes[0].blockId).toBe("pending");
    next = applyEvent(next, delta(1, "The suite ran clean."));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "msg_a:t1", offset: 0 });
    next = applyEvent(next, delta(1, " Twice."));
    next = play(next, tool("completed"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "msg_a:t1", offset: 0 });
  });

  it("names an absolute path from the book's root, for an edit and for its ask", () => {
    const file = "/repos/api-server/src/greet.ts";
    const patch = "--- a/src/greet.ts\n+++ b/src/greet.ts\n@@ -1,1 +1,2 @@\n a\n+b\n";
    let next = play(book(), [
      delta(0, "Done."),
      ev("session.tool.input.started", { assistantMessageID: AID, id: "call-e", name: "edit" }),
      ev("session.tool.called", { assistantMessageID: AID, id: "call-e", input: { filePath: file, oldString: "a", newString: "a\nb" } }),
    ]);
    expect(next.chapters[0].footnotes[0].text).toBe("Editing src/greet.ts…");
    next = applyEvent(
      next,
      ev("permission.asked", {
        id: "per_1",
        action: "edit",
        resources: [file],
        source: { type: "tool", id: "call-e" },
        metadata: { files: [{ file, patch }] },
      }),
    );
    expect(next.chapters[0].footnotes[0].text).toBe("Editing src/greet.ts…");
    next = applyEvent(next, ev("session.tool.success", { assistantMessageID: AID, id: "call-e", content: [], metadata: { files: [{ file, patch }] } }));
    expect(next.chapters[0].footnotes[0].text).toBe("Edited src/greet.ts, 1 line added. See Plate I →");
  });
});

describe("plates keep their patch", () => {
  it("keeps the tool's patch once set; the session diff sets the lines only", () => {
    const pressed = play(shelf(), frames(captures.edit));
    const plate = only(pressed).plates[0];
    expect(plate.patch).toMatch(/^Index: src\/greet\.ts\n/);
    const diffed = only(applyEvent(pressed, { type: "folio.diff", data: { sessionID: pressed.chapters[0].id, diff: editDiff } }));
    expect(diffed.plates[0].patch).toBe(plate.patch);
    expect(diffed.plates[0].lines).toEqual(parsePatch(editDiff[0].patch));
  });

  it("gives a plate with no patch the session diff's patch", () => {
    const pressed = play(shelf(), frames(captures.edit));
    const sessionID = pressed.chapters[0].id;
    const bare = { ...pressed, chapters: [{ ...pressed.chapters[0], plates: pressed.chapters[0].plates.map((p) => ({ ...p, patch: undefined })) }] };
    const diffed = only(applyEvent(bare, { type: "folio.diff", data: { sessionID, diff: editDiff } }));
    expect(diffed.plates[0].patch).toBe(editDiff[0].patch);
  });

  it("takes no patch from a whole-session diff, so Reject refuses its plates", () => {
    const pressed = play(shelf(), frames(captures.edit));
    const sessionID = pressed.chapters[0].id;
    const bare = { ...pressed, chapters: [{ ...pressed.chapters[0], plates: pressed.chapters[0].plates.map((p) => ({ ...p, patch: undefined })) }] };
    const kept = only(applyEvent(bare, { type: "folio.diff", data: { sessionID, diff: editDiff, unscoped: true } }));
    expect(kept.plates[0].patch).toBeUndefined();
    expect(kept.plates[0].lines).toEqual(parsePatch(editDiff[0].patch));
    // A file the turn has no plate for gets a diff plate, still without a patch.
    const other = [{ ...editDiff[0], file: "README.md", patch: editDiff[0].patch.replaceAll("src/greet.ts", "README.md") }];
    const opened = only(applyEvent(bare, { type: "folio.diff", data: { sessionID, diff: other, unscoped: true } }));
    const plate = opened.plates.find((p) => p.file === "README.md")!;
    expect(plate.id).toBe(`diff-README.md@${opened.plates[0].turnMessageId}`);
    expect(plate.lines.length).toBeGreaterThan(0);
    expect(plate.patch).toBeUndefined();
  });

  it("sets the session diff on the turn the frame names, not the latest one", () => {
    let next = play(shelf(), frames(captures.edit));
    const sessionID = next.chapters[0].id;
    const firstTurn = next.chapters[0].plates[0].turnMessageId;
    next = applyEvent(next, {
      type: "session.inbox.enqueued",
      data: { sessionID, inboxID: "msg_u2", item: { type: "user", payload: { text: "Now explain it." } } },
    });
    const chapter = only(applyEvent(next, { type: "folio.diff", data: { sessionID, diff: editDiff, turnMessageId: firstTurn } }));
    expect(chapter.plates).toHaveLength(1);
    expect(chapter.plates[0]).toMatchObject({ turnMessageId: firstTurn, lines: parsePatch(editDiff[0].patch) });
  });
});

describe("an ask about an edit", () => {
  it("names the tool call it holds up and sets that call's plate from the proposed patch", () => {
    const list = frames(captures.ask);
    const asked = list.find((f) => f.type === "permission.asked")!;
    const source = data(asked).source as { id: string };
    const waiting = only(play(shelf(), list, (f) => f.type === "permission.asked"));
    expect(waiting.asks[0].callId).toBe(source.id);
    const plate = waiting.plates.find((p) => p.id === `plate-${source.id}`)!;
    expect(plate.patch).toBe(waiting.asks[0].patch);
    expect(plate.lines).toEqual(parsePatch(waiting.asks[0].patch!));
    expect(plate.additions).toBe(4);
  });
});

describe("a run that ends", () => {
  it("takes away asks and questions the press no longer waits on", () => {
    const waiting = play(book(), [
      ev("session.execution.started"),
      ev("permission.asked", { id: "per_1", action: "shell", resources: ["git show"] }),
      ev("form.created", { form: { id: "frm_1", sessionID: "ses_1", title: "Q", fields: [] } }),
    ]);
    expect(only(waiting).asks).toHaveLength(1);
    expect(only(waiting).forms).toHaveLength(1);
    for (const end of ["session.execution.interrupted", "session.execution.succeeded", "session.execution.failed"]) {
      const settled = only(applyEvent(waiting, ev(end, { reason: "user", error: { type: "x" } })));
      expect([settled.asks, settled.forms]).toEqual([[], []]);
    }
  });
});

describe("margin notes from the press", () => {
  const COMPOSED = "About this passage:\n\n> the clock was frozen\n\nWhy freeze it?";
  const noted = (): Book => ({
    ...book(),
    chapters: [{ ...book().chapters[0], notes: [{ id: "note_1", quote: "the clock was frozen", prompt: "Why freeze it?", pending: true }] }],
  });
  const enqueued = (text: string) => ev("session.inbox.enqueued", { inboxID: "msg_n", item: { type: "user", payload: { text } } });

  it("keeps the composed prompt of a waiting note out of the main flow", () => {
    const chapter = only(applyEvent(noted(), enqueued(COMPOSED)));
    expect(chapter.blocks).toEqual([{ id: "msg_n", voice: "ink", text: COMPOSED, marginal: true }]);
  });

  it("sets the same words in ink when no note waits for them", () => {
    const chapter = only(applyEvent(book(), enqueued(COMPOSED)));
    expect(chapter.blocks[0].marginal).toBeUndefined();
  });
});

describe("a model the press no longer offers", () => {
  it("says so in a sentence that points to the menu", () => {
    const gone = (error: Record<string, unknown>) => only(applyEvent(book(), ev("session.execution.failed", { error }))).error;
    expect(gone({ type: "api", message: "Model exo-free has been deprecated.", status: 410 })).toBe(MODEL_GONE);
    expect(gone({ type: "api", message: "Gone.", status: 410 })).toBe(MODEL_GONE);
    expect(gone({ type: "api", message: "This model is deprecated" })).toBe(MODEL_GONE);
    expect(gone({ type: "api", message: "Rate limited.", status: 429 })).toBe("Rate limited.");
    expect(MODEL_GONE).toBe("That model is no longer offered. Choose another from the menu.");
  });
});

describe("following the tail", () => {
  // One chapter id per laid page; two pages make a spread.
  const before = ["i", "i", "ii", "ii", "ii", "ii"];

  it("turns when the reader is on the last spread of the chapter that grew onto a new page", () => {
    expect(followTail(before, [...before, "ii", "ii"], 2)).toBe(3);
  });

  it("stays when the reader is earlier in that chapter", () => {
    expect(followTail(before, [...before, "ii", "ii"], 1)).toBeNull();
  });

  it("stays when another chapter grew", () => {
    const after = ["i", "i", "i", "i", "ii", "ii", "ii", "ii"];
    expect(followTail(before, after, 2)).toBeNull();
    expect(followTail(before, [...before, "iii", "iii"], 2)).toBeNull();
  });

  it("stays when the chapter grew onto the blank page of the reader's own spread", () => {
    // Chapter i ends on a left page; the blank right page beside it is laid as chapter ii's, which starts on page 4.
    const middle = ["i", "i", "i", "ii", "ii", "ii"];
    const grown = ["i", "i", "i", "i", "ii", "ii"];
    expect(followTail(middle, grown, 1)).toBeNull();
  });
});

describe("following the reader's prose as the press writes it", () => {
  const AID = "msg_a";
  const delta = (ordinal: number, text: string) => ev("session.text.delta", { assistantMessageID: AID, ordinal, delta: text });
  const started = (ordinal: number) => ev("session.text.started", { assistantMessageID: AID, ordinal });
  const tool = (id: string, name?: string): Frame[] => [
    ...(name ? [ev("session.tool.input.started", { assistantMessageID: AID, id, name })] : []),
    ev("session.tool.called", { assistantMessageID: AID, id, input: { command: "npm test" } }),
  ];

  it("lets only the last block take a footnote that came before any text", () => {
    let next = play(book(), [started(0), started(1), ...tool("call-1", "shell")]);
    expect(next.chapters[0].footnotes[0].blockId).toBe("pending");
    next = applyEvent(next, delta(0, "An earlier part."));
    expect(next.chapters[0].footnotes[0].blockId).toBe("pending");
    next = applyEvent(next, delta(1, "The suite ran."));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "msg_a:t1", offset: 0 });
  });

  it("sets a part that arrives early after the parts before it, so no hole opens", () => {
    const next = play(book(), [delta(2, "Third."), delta(0, "First."), delta(1, "Second."), delta(2, " Still third.")]);
    expect(next.chapters[0].blocks.map((b) => [b.id, b.text])).toEqual([
      ["msg_a:t0", "First."],
      ["msg_a:t1", "Second."],
      ["msg_a:t2", "Third. Still third."],
    ]);
    // A later message's part still goes after them all.
    const later = applyEvent(next, ev("session.text.delta", { assistantMessageID: "msg_b", ordinal: 0, delta: "Next." }));
    expect(later.chapters[0].blocks.map((b) => b.id).at(-1)).toBe("msg_b:t0");
  });

  it("names a tool it has no words for in a sentence", () => {
    const next = play(book(), [delta(0, "Working."), ...tool("call-x", "todowrite"), ...tool("call-y")]);
    expect(next.chapters[0].footnotes.map((f) => f.text)).toEqual(["Using the todowrite tool…", "Using a tool…"]);
    const done = applyEvent(next, ev("session.tool.success", { assistantMessageID: AID, id: "call-x", content: [] }));
    expect(done.chapters[0].footnotes[0].text).toBe("Used the todowrite tool.");
  });

  it("takes a stray </think> and a leading reasoning block off the prose, even split across deltas", () => {
    let next = play(book(), [delta(0, "</thi"), delta(0, "nk>\n\nDone."), delta(1, "<think>Weigh it"), delta(1, " up.</think>"), delta(1, "Answer.")]);
    expect(next.chapters[0].blocks.map((b) => b.text)).toEqual(["Done.", "Answer."]);
    next = applyEvent(next, ev("session.text.ended", { assistantMessageID: AID, ordinal: 1, text: "<think>Weigh it up.</think>Answer." }));
    expect(next.chapters[0].blocks.map((b) => b.text)).toEqual(["Done.", "Answer."]);
  });

  it("takes the finished text over reasoning that never closed in the deltas", () => {
    let next = play(book(), [delta(0, "<think>Weigh it up at length, every side of it")]);
    expect(next.chapters[0].blocks[0].text.startsWith("<think>")).toBe(true);
    next = applyEvent(next, ev("session.text.ended", { assistantMessageID: AID, ordinal: 0, text: "<think>Weigh it.</think>Yes." }));
    expect(next.chapters[0].blocks.map((b) => b.text)).toEqual(["Yes."]);
  });
});

describe("sentence ends", () => {
  it("does not end a sentence at an abbreviation, an initial or a list number", () => {
    expect(sentenceEnd("Use a flag, e.g. --watch")).toBeUndefined();
    expect(sentenceEnd("That is, i.e. the same")).toBeUndefined();
    expect(sentenceEnd("1. Read the file")).toBeUndefined();
    expect(sentenceEnd("Steps:\n2. Run it")).toBeUndefined();
    expect(sentenceEnd("Ask J. Smith")).toBeUndefined();
  });

  it("ends a sentence after closing emphasis, and after a number that ends one", () => {
    expect(sentenceEnd("**Done.** Next")).toBe("**Done.**".length);
    expect(sentenceEnd("It is *fixed.* Then")).toBe("It is *fixed.*".length);
    expect(sentenceEnd("I bumped it to version 2. Then I ran")).toBe("I bumped it to version 2.".length);
    expect(sentenceEnd("Use a flag, e.g. --watch. Then")).toBe("Use a flag, e.g. --watch.".length);
    expect(sentenceEnd("Why? Because")).toBe("Why?".length);
    expect(sentenceEnd("It was shorter than I. Then")).toBe("It was shorter than I.".length);
  });
});

describe("renaming a prompt line", () => {
  const seeded = (): Book => ({ ...book(), chapters: [appendPrompt(book().chapters[0], "Edit a.", "local-1")] });
  const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n a\n+b\n";

  it("never leaves two blocks with one id", () => {
    let chapter = seeded().chapters[0];
    chapter = { ...chapter, blocks: [...chapter.blocks, { id: "msg_u1", voice: "ink", text: "Edit a. " }] };
    chapter = { ...chapter, footnotes: [{ id: "f", n: 1, blockId: "local-1", offset: 2, text: "Ran it." }] };
    const renamed = renameBlock(chapter, "local-1", "msg_u1");
    expect(renamed.blocks.map((b) => b.id)).toEqual(["msg_u1"]);
    expect(renamed.footnotes[0].blockId).toBe("msg_u1");
  });

  it("gives a diff plate named by the local turn the real turn's id, and keeps its status", () => {
    let next = play(seeded(), [
      ev("session.step.started", { assistantMessageID: "msg_a1" }),
      ev("folio.diff", { diff: [{ file: "a.ts", patch, status: "modified", additions: 1, deletions: 0 }] }),
    ]);
    const plate = next.chapters[0].plates[0];
    expect(plate.id).toBe("diff-a.ts@local-1");
    next = { ...next, chapters: [{ ...next.chapters[0], plates: [{ ...plate, status: "accepted" }], footnotes: [{ id: "f", n: 1, blockId: "msg_a1:t0", offset: 0, text: "Edited a.ts.", plateId: plate.id }] }] };
    const renamed = renameBlock(next.chapters[0], "local-1", "msg_u1");
    expect(renamed.plates[0]).toMatchObject({ id: "diff-a.ts@msg_u1", turnMessageId: "msg_u1", status: "accepted" });
    expect(renamed.footnotes[0].plateId).toBe("diff-a.ts@msg_u1");
    // The diff read again for the real turn finds the same plate, not a second one.
    const again = applyEvent({ ...next, chapters: [renamed] }, ev("folio.diff", { diff: [{ file: "a.ts", patch, status: "modified" }], turnMessageId: "msg_u1" }));
    expect(again.chapters[0].plates.map((p) => [p.id, p.status])).toEqual([["diff-a.ts@msg_u1", "accepted"]]);
  });

  it("leaves a tool plate's id alone, since it names the call, not the turn", () => {
    const next = play(seeded(), [
      ev("session.step.started", { assistantMessageID: "msg_a1" }),
      ev("session.tool.input.started", { assistantMessageID: "msg_a1", id: "call-1", name: "edit" }),
      ev("session.tool.called", { assistantMessageID: "msg_a1", id: "call-1", input: { path: "a.ts", oldString: "a", newString: "a\nb" } }),
    ]);
    const renamed = renameBlock(next.chapters[0], "local-1", "msg_u1");
    expect(renamed.plates[0]).toMatchObject({ id: "plate-call-1", turnMessageId: "msg_u1" });
    expect(renamed.footnotes[0].plateId).toBe("plate-call-1");
  });
});

describe("a plate from strings, then the press's patch", () => {
  const AID = "msg_a";
  // The edit's own strings sit at line 1; the real file has them at line 12.
  const patch = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -12,2 +12,3 @@\n one\n+2\n two\n";
  const called = ev("session.tool.called", { assistantMessageID: AID, id: "call-1", input: { path: "src/a.ts", oldString: "one\ntwo", newString: "one\n2\ntwo" } });
  const asked = ev("permission.asked", {
    id: "per_1",
    action: "edit",
    resources: ["src/a.ts"],
    source: { type: "tool", id: "call-1" },
    metadata: { files: [{ file: "src/a.ts", patch }] },
  });
  const started = ev("session.tool.input.started", { assistantMessageID: AID, id: "call-1", name: "edit" });

  it("numbers its lines from the patch once an ask brings one", () => {
    const next = play(book(), [started, called, asked]);
    expect(next.chapters[0].plates[0].lines).toEqual(parsePatch(patch));
    expect(next.chapters[0].plates[0].lines.find((l) => l.kind === "add")?.newNo).toBe(13);
  });

  it("keeps the patch's lines when the call frame lands after the ask", () => {
    const next = play(book(), [started, asked, called]);
    expect(next.chapters[0].plates[0]).toMatchObject({ patch, lines: parsePatch(patch) });
  });
});
