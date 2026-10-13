import { describe, expect, it } from "vitest";
import { editDiff } from "../book/__fixtures__/load";
import { reversePatch } from "./revert";

const BEFORE = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";
const AFTER = `${BEFORE}\nexport function farewell(name: string): string {\n  return \`Goodbye, \${name}!\`;\n}\n`;

describe("reversePatch", () => {
  it("undoes the recorded edit", () => {
    expect(reversePatch(AFTER, editDiff[0].patch)).toBe(BEFORE);
  });

  it("undoes two hunks, the later one shifted by the first", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n") + "\n";
    const after = ["a", "B1", "B2", "c", "d", "e", "f", "g", "i", "j"].join("\n") + "\n";
    const patch = [
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
    expect(reversePatch(after, patch)).toBe(before);
  });

  it("removes a file's added lines and keeps a missing final newline", () => {
    const patch = "@@ -0,0 +1,2 @@\n+one\n+two\n";
    expect(reversePatch("one\ntwo\n", patch)).toBe("");
    const bare = "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n";
    expect(reversePatch("new\n", bare)).toBe("old");
  });

  it("refuses when the file no longer matches", () => {
    expect(reversePatch(BEFORE, editDiff[0].patch)).toBeNull();
    expect(reversePatch(AFTER.replace("Goodbye", "Bye"), editDiff[0].patch)).toBeNull();
    expect(reversePatch(AFTER, "not a patch")).toBeNull();
  });
});
