import { describe, expect, it } from "vitest";
import { applyEvent, appendPrompt } from "./events";
import { quillKey } from "./quill";
import type { Book } from "./model";
import { pushSse, unwrapEvent } from "../engine/sse";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { reduceNav, initialNav } from "../state/nav";

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
        busy: false,
      },
    ],
  };
}

describe("events", () => {
  it("streams text onto the page and names the chapter when the session title arrives", () => {
    let next = applyEvent(book(), {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "p1", type: "text", text: "The test failed only on the build server." },
      },
    });
    next = applyEvent(next, {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", partID: "p1", field: "text", delta: " That was the clue." },
    });
    expect(next.chapters[0].blocks[0].text).toBe("The test failed only on the build server. That was the clue.");
    next = applyEvent(next, {
      type: "session.updated",
      properties: { info: { id: "ses_1", directory: "/repos/api-server", title: "The flaky login test" } },
    });
    expect(next.chapters[0].untitled).toBe(false);
    expect(next.chapters[0].title).toBe("The flaky login test");
  });

  it("turns a tool part into a footnote and a file diff into a plate", () => {
    let next = applyEvent(book(), {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "t1", type: "text", text: "I reordered the setup." },
      },
    });
    next = applyEvent(next, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: {
          id: "tool1",
          type: "tool",
          tool: "edit",
          messageID: "msg_1",
          state: {
            status: "completed",
            title: "session.ts",
            input: {
              filePath: "tests/fixtures/session.ts",
              oldString: "const token = mint();",
              newString: "useFakeTimers();\nconst token = mint();",
            },
            time: { start: 0, end: 10 },
          },
        },
      },
    });
    expect(next.chapters[0].footnotes).toHaveLength(1);
    expect(next.chapters[0].footnotes[0].text).toContain("See Plate");
    expect(next.chapters[0].plates[0].file).toBe("tests/fixtures/session.ts");
    next = applyEvent(next, {
      type: "session.diff",
      properties: {
        sessionID: "ses_1",
        diff: [{ file: "tests/fixtures/session.ts", before: "a\n", after: "b\n", additions: 1, deletions: 1 }],
      },
    });
    expect(next.chapters[0].plates.some((p) => p.file === "tests/fixtures/session.ts")).toBe(true);
  });

  it("keeps a permission ask until it is answered", () => {
    let next = applyEvent(book(), {
      type: "permission.asked",
      properties: { id: "per_1", sessionID: "ses_1", permission: "edit", patterns: ["src/auth.ts"] },
    });
    expect(next.chapters[0].asks[0].title).toContain("src/auth.ts");
    next = applyEvent(next, {
      type: "permission.replied",
      properties: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
    });
    expect(next.chapters[0].asks).toHaveLength(0);
  });

  it("replaces an optimistic quill line when the same text is echoed", () => {
    const seeded = {
      ...book(),
      chapters: [appendPrompt(book().chapters[0], "Cap it at two seconds.")],
    };
    const next = applyEvent(seeded, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "usr_1", type: "text", text: "Cap it at two seconds." },
      },
    });
    expect(next.chapters[0].blocks).toHaveLength(1);
    expect(next.chapters[0].blocks[0].id).toBe("usr_1");
    expect(next.chapters[0].blocks[0].voice).toBe("ink");
  });

  it("drops deltas for reasoning parts that announced themselves", () => {
    let next = applyEvent(book(), {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "r1", type: "reasoning", text: "" },
      },
    });
    next = applyEvent(next, {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", messageID: "m1", partID: "r1", field: "text", delta: "The user wants" },
    });
    next = applyEvent(next, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "r1", type: "reasoning", text: "The user wants a sentence." },
      },
    });
    expect(next.chapters[0].blocks).toHaveLength(0);
    next = applyEvent(next, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "p1", type: "step-start", snapshot: "abc" },
      },
    });
    next = applyEvent(next, {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", partID: "t9", field: "text", delta: "Unknown part, kept as text." },
    });
    expect(next.chapters[0].blocks).toHaveLength(1);
  });

  it("keeps a margin note open through the empty echo and closes it with the full reply", () => {
    const seeded = {
      ...book(),
      chapters: [
        {
          ...book().chapters[0],
          notes: [{ id: "note_1", quote: "mirrors", prompt: "why?", pending: true }],
        },
      ],
    };
    // The reply block is announced empty before it streams.
    let next = applyEvent(seeded, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "ans_1", type: "text", text: "", messageID: "m2" },
      },
    });
    expect(next.chapters[0].notes[0].pending).toBe(true);
    expect(next.chapters[0].notes[0].reply).toBeUndefined();
    next = applyEvent(next, {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", partID: "ans_1", field: "text", delta: "It mirrors " },
    });
    expect(next.chapters[0].notes[0].reply).toBe("It mirrors ");
    expect(next.chapters[0].notes[0].pending).toBe(true);
    next = applyEvent(next, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "ans_1", type: "text", text: "It mirrors the shape of greet." },
      },
    });
    expect(next.chapters[0].notes[0].pending).toBe(false);
    expect(next.chapters[0].notes[0].reply).toBe("It mirrors the shape of greet.");
  });

  it("does not let reasoning deltas take a pending margin note", () => {
    const seeded = {
      ...book(),
      chapters: [
        {
          ...book().chapters[0],
          notes: [{ id: "note_1", quote: "mirrors", prompt: "why?", pending: true }],
        },
      ],
    };
    let next = applyEvent(seeded, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "r1", type: "reasoning", text: "" },
      },
    });
    next = applyEvent(next, {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", partID: "r1", field: "text", delta: "Thinking about the quote." },
    });
    expect(next.chapters[0].notes[0].reply).toBeUndefined();
    expect(next.chapters[0].blocks).toHaveLength(0);
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
    const first = pushSse("", 'data: {"type":"server.connected","properties":{}}\n\n');
    expect(first.events).toEqual([{ type: "server.connected", properties: {} }]);
    const partial = pushSse("", 'data: {"type":"session.idle"');
    expect(partial.events).toEqual([]);
    const done = pushSse(partial.rest, '}\n\n');
    expect(done.events).toEqual([{ type: "session.idle" }]);
  });

  it("unwraps the payload envelope used by opencode 1.19", () => {
    const frame = pushSse(
      "",
      'data: {"payload":{"id":"evt_1","type":"message.part.delta","properties":{"sessionID":"ses_1","delta":"Hi"}}}\n\n',
    );
    expect(unwrapEvent(frame.events[0])).toEqual({
      type: "message.part.delta",
      properties: { sessionID: "ses_1", delta: "Hi" },
    });
    expect(unwrapEvent({ type: "server.connected", properties: {} }).type).toBe("server.connected");
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
});

describe("footnote anchors", () => {
  function tool(status: string) {
    return {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        part: { id: "tool1", type: "tool", tool: "bash", state: { status, input: { command: "npm test" } } },
      },
    };
  }
  function delta(partID: string, text: string) {
    return {
      type: "message.part.delta",
      properties: { sessionID: "ses_1", partID, field: "text", delta: text },
    };
  }

  it("anchors at the last finished sentence and stays there while the text grows", () => {
    let next = applyEvent(book(), delta("p1", "I reordered the setup. Then I ra"));
    next = applyEvent(next, tool("running"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "p1", offset: "I reordered the setup.".length });
    next = applyEvent(next, delta("p1", "n the suite again. It passed."));
    next = applyEvent(next, tool("completed"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({
      blockId: "p1",
      offset: "I reordered the setup.".length,
      pending: false,
    });
  });

  it("holds a tool that comes before any text until the next text part adopts it", () => {
    let next = applyEvent(book(), tool("running"));
    expect(next.chapters[0].footnotes[0].blockId).toBe("pending");
    next = applyEvent(next, delta("p2", "The suite ran clean."));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "p2", offset: 0 });
    next = applyEvent(next, delta("p2", " Twice."));
    next = applyEvent(next, tool("completed"));
    expect(next.chapters[0].footnotes[0]).toMatchObject({ blockId: "p2", offset: 0 });
  });
});
