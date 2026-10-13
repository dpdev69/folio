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
    expect(note.text).toContain("See Plate 3");
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
