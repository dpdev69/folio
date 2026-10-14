import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inside, readBookFile, writeBookFile } from "./host";

describe("the write guard", () => {
  let base: string;
  let book: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "folio-host-"));
    book = path.join(base, "book");
    outside = path.join(base, "outside");
    mkdirSync(path.join(book, "src"), { recursive: true });
    mkdirSync(outside);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("keeps ordinary paths inside the book", async () => {
    expect(inside(book, "src/greet.ts")).toBe(path.join(book, "src/greet.ts"));
    expect(() => inside(book, "new/deep/file.txt")).not.toThrow();
    expect(() => inside(book, "../outside.txt")).toThrow(/outside the book/);
    expect(() => inside(book, "/etc/passwd")).toThrow(/outside the book/);
    expect(() => inside("relative/book", "a.txt")).toThrow();
    expect(await writeBookFile(book, "src/greet.ts", "hello\n")).toEqual({ ok: true });
    expect(await readBookFile(book, "src/greet.ts")).toEqual({ ok: true, content: "hello\n" });
  });

  it("refuses a link that leaves the book", () => {
    symlinkSync(outside, path.join(book, "away"));
    expect(() => inside(book, "away/file.txt")).toThrow(/outside the book/);
  });

  it("refuses a link to a missing file outside the book, and does not create it", async () => {
    symlinkSync("../outside/planted.txt", path.join(book, "link.txt"));
    symlinkSync("../outside/missing-dir", path.join(book, "gone"));
    expect(() => inside(book, "link.txt")).toThrow(/outside the book/);
    expect(() => inside(book, "gone/file.txt")).toThrow(/outside the book/);
    expect((await writeBookFile(book, "link.txt", "planted\n")).ok).toBe(false);
    expect((await writeBookFile(book, "gone/file.txt", "planted\n")).ok).toBe(false);
    expect(existsSync(path.join(outside, "planted.txt"))).toBe(false);
    expect(existsSync(path.join(outside, "missing-dir"))).toBe(false);
  });

  it("still follows a link that stays inside the book", () => {
    writeFileSync(path.join(book, "real.txt"), "inside\n");
    symlinkSync("real.txt", path.join(book, "alias.txt"));
    expect(() => inside(book, "alias.txt")).not.toThrow();
  });
});
