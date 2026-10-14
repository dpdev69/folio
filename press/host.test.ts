import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inside, readBookFile, removeBookFile, servePress, stopPress, writeBookFile } from "./host";

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

  it("removes a file inside the book, and nothing else", async () => {
    writeFileSync(path.join(book, "src/new.ts"), "x\n");
    expect(await removeBookFile(book, "src/new.ts")).toEqual({ ok: true });
    expect(existsSync(path.join(book, "src/new.ts"))).toBe(false);
    expect((await removeBookFile(book, "src")).ok).toBe(false);
    expect(existsSync(path.join(book, "src"))).toBe(true);
    writeFileSync(path.join(outside, "keep.txt"), "keep\n");
    expect((await removeBookFile(book, "../outside/keep.txt")).ok).toBe(false);
    expect((await removeBookFile(book, path.join(outside, "keep.txt"))).ok).toBe(false);
    symlinkSync(outside, path.join(book, "away"));
    expect((await removeBookFile(book, "away/keep.txt")).ok).toBe(false);
    symlinkSync("../outside/keep.txt", path.join(book, "link.txt"));
    expect((await removeBookFile(book, "link.txt")).ok).toBe(false);
    symlinkSync("../outside/missing.txt", path.join(book, "dangling.txt"));
    expect((await removeBookFile(book, "dangling.txt")).ok).toBe(false);
    expect(existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("still follows a link that stays inside the book", () => {
    writeFileSync(path.join(book, "real.txt"), "inside\n");
    symlinkSync("real.txt", path.join(book, "alias.txt"));
    expect(() => inside(book, "alias.txt")).not.toThrow();
  });
});

describe("the dev press", () => {
  let dir: string;
  const saved = { bin: process.env.FOLIO_OPENCODE_BIN, url: process.env.FOLIO_PRESS_URL };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "folio-fake-press-"));
    // A stand-in for `opencode serve --stdio`: it names its pid in the url and lives until stdin closes.
    const fake = path.join(dir, "opencode");
    writeFileSync(
      fake,
      [
        "#!/usr/bin/env node",
        'if (process.argv.includes("--version")) { console.log("2.0.28"); process.exit(0); }',
        "console.log(JSON.stringify({ url: `http://127.0.0.1:1/?pid=${process.pid}&cwd=${encodeURIComponent(process.cwd())}` }));",
        'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));',
      ].join("\n"),
    );
    chmodSync(fake, 0o755);
    process.env.FOLIO_OPENCODE_BIN = fake;
    delete process.env.FOLIO_PRESS_URL;
  });

  afterEach(() => {
    stopPress();
    if (saved.bin === undefined) delete process.env.FOLIO_OPENCODE_BIN;
    else process.env.FOLIO_OPENCODE_BIN = saved.bin;
    if (saved.url !== undefined) process.env.FOLIO_PRESS_URL = saved.url;
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the press in its own state folder, never in whatever folder vite was started from", async () => {
    const served = await servePress();
    if (!served.ok) throw new Error(served.error);
    const cwd = new URL(served.url).searchParams.get("cwd")!;
    expect(realpathSync(cwd)).toBe(realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".folio", "press", "cwd")));
  });

  it("reuses a live press, and starts a new one with a new password once it has died", async () => {
    const first = await servePress();
    if (!first.ok) throw new Error(first.error);
    const again = await servePress();
    expect(again).toMatchObject({ ok: true, url: first.url, password: first.password });
    const pid = Number(new URL(first.url).searchParams.get("pid"));
    process.kill(pid, "SIGKILL");
    const end = Date.now() + 3000;
    while (isAlive(pid) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fresh = await servePress();
    if (!fresh.ok) throw new Error(fresh.error);
    expect(fresh.url).not.toBe(first.url);
    expect(fresh.password).not.toBe(first.password);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
