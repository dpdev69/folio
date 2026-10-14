import { describe, expect, it } from "vitest";
import { parsePatch, reversePatch } from "./diff";
import { editDiff } from "./__fixtures__/load";

const TOOL_PATCH =
  "Index: src/greet.ts\n===================================================================\n--- src/greet.ts\n+++ src/greet.ts\n@@ -1,3 +1,7 @@\n export function greet(name: string): string {\n   return `Hello, ${name}!`;\n }\n+\n+export function farewell(name: string): string {\n+  return `Goodbye, ${name}!`;\n+}\n";

describe("parsePatch", () => {
  it("reads the tool patch with its Index header and numbers both sides", () => {
    const lines = parsePatch(TOOL_PATCH);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({ kind: "context", text: "export function greet(name: string): string {", oldNo: 1, newNo: 1 });
    expect(lines[2]).toEqual({ kind: "context", text: "}", oldNo: 3, newNo: 3 });
    expect(lines[3]).toEqual({ kind: "add", text: "", newNo: 4 });
    expect(lines[4]).toEqual({ kind: "add", text: "export function farewell(name: string): string {", newNo: 5 });
    expect(lines[6]).toEqual({ kind: "add", text: "}", newNo: 7 });
  });

  it("reads the git patch from the session diff the same way", () => {
    expect(editDiff[0].patch.startsWith("diff --git")).toBe(true);
    expect(parsePatch(editDiff[0].patch)).toEqual(parsePatch(TOOL_PATCH));
  });

  it("separates two hunks with an ellipsis and keeps each hunk's numbering", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -2,3 +2,3 @@ function a() {",
      " one",
      "-two",
      "+deux",
      " three",
      "@@ -20,2 +20,3 @@",
      " twenty",
      "+twenty-and-a-half",
      " twenty-one",
      "",
    ].join("\n");
    const lines = parsePatch(patch);
    expect(lines.map((l) => [l.kind, l.text, l.oldNo, l.newNo])).toEqual([
      ["context", "one", 2, 2],
      ["del", "two", 3, undefined],
      ["add", "deux", undefined, 3],
      ["context", "three", 4, 4],
      ["context", "…", undefined, undefined],
      ["context", "twenty", 20, 20],
      ["add", "twenty-and-a-half", undefined, 21],
      ["context", "twenty-one", 21, 22],
    ]);
  });

  it("reads an added file and skips the no-newline marker", () => {
    const patch = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+export const a = 1;",
      "+export const b = 2;",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    expect(parsePatch(patch)).toEqual([
      { kind: "add", text: "export const a = 1;", newNo: 1 },
      { kind: "add", text: "export const b = 2;", newNo: 2 },
    ]);
  });

  it("reads a deleted file, including a removed line that starts with two dashes", () => {
    const patch = [
      "diff --git a/old.sql b/old.sql",
      "deleted file mode 100644",
      "--- a/old.sql",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "--- a comment",
      "-select 1;",
      "",
    ].join("\n");
    expect(parsePatch(patch)).toEqual([
      { kind: "del", text: "-- a comment", oldNo: 1 },
      { kind: "del", text: "select 1;", oldNo: 2 },
    ]);
  });

  it("caps a long patch at 42 lines, the last an ellipsis", () => {
    const body = Array.from({ length: 60 }, (_, i) => `+line ${i + 1}`);
    const lines = parsePatch(["--- /dev/null", "+++ b/long.txt", "@@ -0,0 +1,60 @@", ...body, ""].join("\n"));
    expect(lines).toHaveLength(42);
    expect(lines[40]).toEqual({ kind: "add", text: "line 41", newNo: 41 });
    expect(lines[41]).toEqual({ kind: "context", text: "…" });
  });

  it("returns nothing for text that is not a patch", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch("Binary files a/x.png and b/x.png differ")).toEqual([]);
  });
});

describe("reversePatch", () => {
  const BEFORE = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";
  const AFTER = `${BEFORE}\nexport function farewell(name: string): string {\n  return \`Goodbye, \${name}!\`;\n}\n`;
  const TWO_HUNKS = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1,3 +1,4 @@",
    " a",
    "-b",
    "+B1",
    "+B2",
    " c",
    "@@ -7,3 +8,2 @@",
    " g",
    "-h",
    " i",
  ].join("\n");
  const text = (...items: string[]) => items.join("\n") + "\n";
  const AFTER_TWO = ["a", "B1", "B2", "c", "d", "e", "f", "g", "i", "j"];

  it("undoes the recorded edit, from the session diff and from the tool's own patch", () => {
    expect(reversePatch(AFTER, editDiff[0].patch)).toBe(BEFORE);
    expect(reversePatch(AFTER, TOOL_PATCH)).toBe(BEFORE);
  });

  it("undoes two hunks, the later one shifted by the first", () => {
    expect(reversePatch(text(...AFTER_TWO), TWO_HUNKS)).toBe(text("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"));
  });

  it("finds a hunk up to three lines from where it says, as when a later edit moved it", () => {
    const below = text("x", "y", "z", ...AFTER_TWO);
    expect(reversePatch(below, TWO_HUNKS)).toBe(text("x", "y", "z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j"));
    const above = text(...AFTER_TWO.slice(1));
    expect(reversePatch(above, "@@ -4,3 +4,2 @@\n c\n-cc\n d\n")).toBe(text("B1", "B2", "c", "cc", "d", "e", "f", "g", "i", "j"));
  });

  it("refuses a hunk more than three lines from where it says", () => {
    expect(reversePatch(text("1", "2", "3", "4", ...AFTER_TWO), TWO_HUNKS)).toBeNull();
  });

  it("removes a file's added lines and keeps a missing final newline", () => {
    expect(reversePatch("one\ntwo\n", "@@ -0,0 +1,2 @@\n+one\n+two\n")).toBe("");
    const bare = "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n";
    expect(reversePatch("new\n", bare)).toBe("old");
  });

  it("refuses when the file no longer matches", () => {
    expect(reversePatch(BEFORE, editDiff[0].patch)).toBeNull();
    expect(reversePatch(AFTER.replace("Goodbye", "Bye"), editDiff[0].patch)).toBeNull();
    expect(reversePatch(AFTER, "not a patch")).toBeNull();
  });
});
