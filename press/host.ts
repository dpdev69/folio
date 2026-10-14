import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * The dev-server stand-in for the Tauri press host: it finds opencode, runs
 * `serve --stdio` with a random password and state under `<repo>/.folio/press`,
 * and reads or writes files in the open book. FOLIO_PRESS_URL and
 * FOLIO_PRESS_PASSWORD point it at a press that is already running instead.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, ".folio", "press");
const READY_MS = 10_000;

type Running = { child: ChildProcess; url: string; password: string };

let running: Running | null = null;
let starting: Promise<Running> | null = null;
const versions = new Map<string, string | undefined>();

export type PressProbe = {
  installed: boolean;
  running: boolean;
  binary?: string;
  version?: string;
};

export type Served = { ok: true; url: string; password: string; version?: string } | { ok: false; error: string };

/** FOLIO_OPENCODE_BIN, the fetched sidecar, `~/.opencode/bin/opencode`, then the PATH. */
export async function findOpencode(): Promise<string | null> {
  const fromEnv = process.env.FOLIO_OPENCODE_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const binaries = path.join(ROOT, "src-tauri", "binaries");
  const sidecar = existsSync(binaries) ? readdirSync(binaries).find((name) => name.startsWith("opencode-cli")) : undefined;
  if (sidecar) return path.join(binaries, sidecar);
  const homeBin = path.join(homedir(), ".opencode", "bin", "opencode");
  if (existsSync(homeBin)) return homeBin;
  return which("opencode");
}

export async function probePress(): Promise<PressProbe> {
  const external = process.env.FOLIO_PRESS_URL;
  if (external) return { installed: true, running: await reachable(external) };
  const binary = await findOpencode();
  return {
    installed: Boolean(binary),
    running: Boolean(running && running.child.exitCode == null),
    binary: binary ?? undefined,
    version: binary ? await versionOf(binary) : undefined,
  };
}

/** Start the press once and hand back its url and password; a live press is reused. */
export async function servePress(): Promise<Served> {
  const external = process.env.FOLIO_PRESS_URL;
  if (external) return { ok: true, url: external, password: process.env.FOLIO_PRESS_PASSWORD ?? "" };
  try {
    if (!running || running.child.exitCode != null || running.child.signalCode != null) {
      starting ??= start().finally(() => {
        starting = null;
      });
      running = await starting;
    }
    const binary = await findOpencode();
    return { ok: true, url: running.url, password: running.password, version: binary ? await versionOf(binary) : undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The press would not start." };
  }
}

/** Stop the press this host started. Vite calls it as it closes. */
export function stopPress(): void {
  const child = running?.child;
  running = null;
  if (child && child.exitCode == null) {
    child.stdin?.end();
    child.kill();
  }
}

async function start(): Promise<Running> {
  const binary = await findOpencode();
  if (!binary) throw new Error("opencode is not installed.");
  const password = randomBytes(32).toString("base64url");
  const xdg: Record<string, string> = {};
  for (const [key, dir] of [
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    xdg[key] = path.join(STATE, dir);
    await mkdir(xdg[key], { recursive: true });
  }
  const child = spawn(binary, ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], {
    env: { ...process.env, ...xdg, OPENCODE_SERVER_PASSWORD: password },
    // stdin stays open: `serve --stdio` exits when it closes, so the press dies with vite.
    stdio: ["pipe", "pipe", "pipe"],
  });
  let said = "";
  child.stderr?.on("data", (chunk) => {
    said = (said + String(chunk)).slice(-2000);
  });
  const lines = createInterface({ input: child.stdout! });
  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      const tail = said.trim();
      reject(new Error(tail ? `${why} It said: ${tail}` : why));
    };
    const timer = setTimeout(() => fail("The press did not say it was ready."), READY_MS);
    lines.on("line", (line) => {
      const ready = readyUrl(line);
      if (!ready || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    });
    child.once("error", (error) => fail(`The press would not start: ${error.message}.`));
    child.once("exit", () => fail("The press stopped before it was ready."));
  });
  child.on("exit", () => {
    if (running?.child === child) running = null;
  });
  return { child, url, password };
}

/** The readiness line of `serve --stdio`: `{"url":"http://127.0.0.1:59661"}`. */
export function readyUrl(line: string): string | null {
  try {
    const value = JSON.parse(line) as { url?: unknown };
    return typeof value.url === "string" && /^https?:\/\//.test(value.url) ? value.url : null;
  } catch {
    return null;
  }
}

export function installPress(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-lc", "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path"], {
      env: process.env,
    });
    let err = "";
    proc.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    proc.on("error", (error) => resolve({ ok: false, error: error.message }));
    proc.on("exit", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: err.trim() || `The installer exited with ${code}.` });
    });
  });
}

export async function writeBookFile(directory: string, file: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const target = inside(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The file was not written." };
  }
}

/** Remove a file in the book (never a folder), through the same guard as a write. */
export async function removeBookFile(directory: string, file: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const target = inside(directory, file);
    if ((await lstat(target)).isDirectory()) throw new Error(`${file} is a folder, not a file.`);
    await unlink(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The file was not removed." };
  }
}

export async function readBookFile(directory: string, file: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    return { ok: true, content: await readFile(inside(directory, file), "utf8") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The file was not read." };
  }
}

/** `file` inside the book at `directory`: relative, no `..`, and not through a link that leaves it. */
export function inside(directory: string, file: string): string {
  if (!path.isAbsolute(directory)) throw new Error("The book's folder must be an absolute path.");
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error(`${file} is outside the book.`);
  const root = realpathSync(directory);
  const target = path.join(directory, file);
  // lstat does not follow links, so a link to a missing target counts as
  // existing; realpath then fails on it, and it is refused.
  let existing = target;
  while (!lexists(existing)) existing = path.dirname(existing);
  let real: string;
  try {
    real = realpathSync(existing);
  } catch {
    throw new Error(`${file} is outside the book.`);
  }
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`${file} is outside the book.`);
  return target;
}

function lexists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/api/info`, { signal: AbortSignal.timeout(3000) });
    // 401 is a press that wants its password: it is there.
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

async function versionOf(binary: string): Promise<string | undefined> {
  if (versions.has(binary)) return versions.get(binary);
  const version = await new Promise<string | undefined>((resolve) => {
    execFile(binary, ["--version"], { timeout: 30_000 }, (error, stdout) => {
      resolve(error ? undefined : /\d+\.\d+\.\d+/.exec(stdout)?.[0]);
    });
  });
  versions.set(binary, version);
  return version;
}

function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.platform === "win32" ? "where" : "which", [command], (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout.split(/\r?\n/)[0]?.trim() || null);
    });
  });
}
