import { describe, expect, it } from "vitest";
import { plateLines } from "./diff";
import { footnoteSentence } from "./tools";

describe("footnotes", () => {
  it("writes a shell call as a sentence with a duration", () => {
    const note = footnoteSentence({
      tool: "bash",
      title: "npm test — auth, repeated forty times",
      status: "completed",
      output: "3 of 40 failed",
      startedAt: 0,
      endedAt: 12400,
    });
    expect(note.text).toBe("Ran npm test — auth, repeated forty times. 3 of 40 failed · 12.4 s.");
    expect(note.opensPlate).toBe(false);
  });

  it("points an edit at a plate", () => {
    const note = footnoteSentence(
      {
        tool: "edit",
        input: {
          filePath: "tests/fixtures/session.ts",
          oldString: "const token = mint();\nuseFakeTimers();",
          newString: "useFakeTimers();\nsetSystemTime(T0);\nconst token = mint();",
        },
        status: "completed",
      },
      3,
    );
    expect(note.opensPlate).toBe(true);
    expect(note.text).toContain("See Plate III →");
    expect(note.text).toContain("tests/fixtures/session.ts");
  });

  it("reads a file with a line span", () => {
    const note = footnoteSentence({
      tool: "read",
      input: { filePath: "tests/fixtures/session.ts", offset: 1, limit: 40 },
      status: "completed",
    });
    expect(note.text).toBe("Read tests/fixtures/session.ts, lines 1–40.");
  });
});

describe("footnotes for opencode 2.0 tools", () => {
  const edit = {
    tool: "edit",
    input: { path: "src/greet.ts", oldString: "a", newString: "a\nb" },
  };

  it("counts an edit by its patch and points at the plate in Roman numerals", () => {
    const note = footnoteSentence({ ...edit, status: "completed", additions: 4, deletions: 0 }, 1);
    expect(note.text).toBe("Edited src/greet.ts, 4 lines added. See Plate I →");
    const both = footnoteSentence({ ...edit, status: "completed", additions: 1, deletions: 2 }, 2);
    expect(both.text).toBe("Edited src/greet.ts, 2 lines removed and 1 added. See Plate II →");
  });

  it("counts an edit from its strings when no patch has come back", () => {
    expect(footnoteSentence({ ...edit, status: "completed" }).text).toBe("Edited src/greet.ts, 1 line added.");
    expect(footnoteSentence({ ...edit, status: "running" }).text).toBe("Editing src/greet.ts…");
  });

  it("reads path as well as filePath", () => {
    expect(footnoteSentence({ tool: "read", input: { path: "src/greet.ts" }, status: "completed" }).text).toBe(
      "Read src/greet.ts.",
    );
    expect(
      footnoteSentence({ tool: "grep", input: { pattern: "farewell", path: "src" }, status: "completed" }).text,
    ).toBe("Looked for farewell in src.");
  });

  it("says declined, not failed, when the reader turned a tool down", () => {
    expect(footnoteSentence({ ...edit, status: "error", error: "Not now.", declined: true }).text).toBe(
      "The edit to src/greet.ts was declined.",
    );
    expect(
      footnoteSentence({ tool: "shell", input: { command: "rm -rf dist" }, status: "error", declined: true }).text,
    ).toBe("The request to run rm -rf dist was declined.");
    expect(footnoteSentence({ ...edit, status: "error", error: "File changed on disk." }).text).toBe(
      "The edit to src/greet.ts failed: File changed on disk.",
    );
  });

  it("words a shell command, a question, a fetch and a search", () => {
    expect(
      footnoteSentence({ tool: "shell", input: { command: "npm test" }, status: "completed", output: "\n 21 passed\n" })
        .text,
    ).toBe("Ran npm test. 21 passed.");
    const question = {
      tool: "question",
      input: { questions: [{ question: "Which language should greet() use?", header: "Greet language" }] },
    };
    expect(footnoteSentence({ ...question, status: "running" }).text).toBe("Waiting for an answer…");
    expect(footnoteSentence({ ...question, status: "completed" }).text).toBe(
      "Asked a question: Which language should greet() use?",
    );
    expect(footnoteSentence({ tool: "webfetch", input: { url: "https://example.com" }, status: "completed" }).text).toBe(
      "Fetched https://example.com.",
    );
    expect(footnoteSentence({ tool: "websearch", input: { query: "opencode" }, status: "running" }).text).toBe(
      "Searching the web for opencode…",
    );
  });
});

describe("plates", () => {
  it("sets the clock fixture as a before-and-after hunk starting at line 12", () => {
    const prefix = Array.from({ length: 11 }, (_, i) => `// context ${i + 1}`).join("\n");
    const before = `${prefix}\nbeforeEach(() => {\n  const token = mint();\n  useFakeTimers();\n});\n`;
    const after = `${prefix}\nbeforeEach(() => {\n  useFakeTimers();\n  setSystemTime(T₀);\n  const token = mint();\n});\n`;
    const lines = plateLines(before, after, { context: 1 });
    expect(lines.some((line) => line.kind === "del" && line.text.includes("const token = mint()"))).toBe(true);
    expect(lines.some((line) => line.kind === "add" && line.text.includes("setSystemTime"))).toBe(true);
    expect(lines.find((line) => line.text.includes("beforeEach"))?.oldNo).toBe(12);
  });
});

describe("shell footnotes from a live run", () => {
  const shell = (command: string, output: string) => ({ tool: "bash", input: { command }, status: "completed" as const, output });

  it("does not double the full stop after output that ends a sentence", () => {
    expect(footnoteSentence(shell("node -e 'greet()'", "Hello, Ada.\n")).text).toBe("Ran node -e 'greet()'. Hello, Ada.");
  });

  it("skips output lines that are only punctuation", () => {
    expect(footnoteSentence(shell("cat package.json", "{\n  \"name\": \"greeter\",\n}")).text).toBe(
      'Ran cat package.json. "name": "greeter",.',
    );
    expect(footnoteSentence(shell("cat empty.json", "{\n}\n")).text).toBe("Ran cat empty.json.");
  });

  it("clips a long command so the footnote stays a line or two", () => {
    const command = `node --input-type=module -e '${"const x = 1; ".repeat(20)}'`;
    const text = footnoteSentence(shell(command, "")).text;
    expect(text.startsWith("Ran node --input-type=module -e 'const x = 1;")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain("….");
    expect(text.length).toBeLessThanOrEqual(80);
  });

  it("never doubles the stop after a clipped command or reason", () => {
    const command = `node -e '${"let y = 2; ".repeat(20)}'`;
    const running = footnoteSentence({ tool: "bash", input: { command }, status: "running" }).text;
    expect(running.endsWith("…")).toBe(true);
    expect(running).not.toContain("……");
    const failed = footnoteSentence({ tool: "bash", input: { command: "npm test" }, status: "error", error: "x".repeat(300) }).text;
    expect(failed.startsWith("npm test failed: xxx")).toBe(true);
    expect(failed.endsWith("…")).toBe(true);
    expect(failed).not.toContain("….");
    const said = footnoteSentence(shell(command, "All good.")).text;
    expect(said).not.toMatch(/…\./);
    expect(said.endsWith("All good.")).toBe(true);
  });
});

describe("a tool Folio has no words for", () => {
  it("is named in a sentence, never as a bare tool…", () => {
    const todo = (status: "running" | "completed" | "error") => footnoteSentence({ tool: "todowrite", input: {}, status }).text;
    expect(todo("running")).toBe("Using the todowrite tool…");
    expect(todo("completed")).toBe("Used the todowrite tool.");
    expect(todo("error")).toBe("The todowrite tool failed.");
    expect(footnoteSentence({ tool: "tool", input: {}, status: "running" }).text).toBe("Using a tool…");
    expect(footnoteSentence({ tool: "tool", input: {}, status: "completed" }).text).toBe("Used a tool.");
    expect(footnoteSentence({ tool: "tool", input: {}, status: "error", declined: true }).text).toBe("A tool call was declined.");
  });
});

describe("footnote paths", () => {
  const options = { directory: "/Users/me/repos/greeter" };
  const read = (filePath: string) => ({ tool: "read", input: { filePath }, status: "completed" as const });

  it("names a file inside the book by its path from the book's root", () => {
    const edit = {
      tool: "edit",
      input: { filePath: "/Users/me/repos/greeter/src/greet.ts", oldString: "a", newString: "a\nb" },
      status: "completed" as const,
      additions: 4,
      deletions: 0,
    };
    expect(footnoteSentence(edit, 1, options).text).toBe("Edited src/greet.ts, 4 lines added. See Plate I →");
    expect(footnoteSentence(read("/Users/me/repos/greeter/README.md"), undefined, { directory: "/Users/me/repos/greeter/" }).text).toBe(
      "Read README.md.",
    );
  });

  it("names a file outside the book by its basename, and leaves relative paths alone", () => {
    expect(footnoteSentence(read("/etc/hosts"), undefined, options).text).toBe("Read hosts.");
    expect(footnoteSentence(read("/Users/me/repos/greeter-old/a.ts"), undefined, options).text).toBe("Read a.ts.");
    expect(footnoteSentence(read("src/greet.ts"), undefined, options).text).toBe("Read src/greet.ts.");
  });

  it("calls the book's own root the tree, and words a declined edit the same way", () => {
    const list = { tool: "list", input: { path: "/Users/me/repos/greeter" }, status: "completed" as const };
    expect(footnoteSentence(list, undefined, options).text).toBe("Looked through the tree.");
    const declined = {
      tool: "edit",
      input: { filePath: "/Users/me/repos/greeter/src/greet.ts" },
      status: "error" as const,
      declined: true,
    };
    expect(footnoteSentence(declined, undefined, options).text).toBe("The edit to src/greet.ts was declined.");
  });

  it("keeps an absolute path when no book directory is known", () => {
    expect(footnoteSentence(read("/etc/hosts")).text).toBe("Read /etc/hosts.");
  });
});
