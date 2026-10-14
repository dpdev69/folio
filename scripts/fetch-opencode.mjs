#!/usr/bin/env node
// Puts the pinned opencode CLI where Tauri expects an externalBin:
//   src-tauri/binaries/opencode-cli-<target-triple>[.exe]
//
// Usage: node scripts/fetch-opencode.mjs [--target <triple>] [--version <v>]
//                                        [--binary <path>] [--dest <dir>] [--download]
//
// --download skips the local app fast path and always fetches from the network.
// With no --target, TAURI_ENV_TARGET_TRIPLE (set by `tauri build --target`) is used,
// then this machine's triple. Downloaded archives are checked against
// scripts/opencode-checksums.json: an absent pin warns, a mismatch fails.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { assetFor, hostTriple, parseVersion, sources } from "./opencode-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAC_APP_BINARY = "/Applications/OpenCode.app/Contents/Resources/opencode-cli";
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Quote a string as a PowerShell single-quoted literal: nothing interpolates, quotes are doubled.
 * PowerShell also takes the typographic single quotes (U+2018 to U+201B) as quote marks, so they
 * are doubled too.
 */
export function psQuote(value) {
  return `'${String(value).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
}

/** The PowerShell command that unpacks a zip, with both paths quoted safely. */
export function expandArchiveCommand(archive, into) {
  return `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(into)} -Force`;
}

/** The target triple: --target, then TAURI_ENV_TARGET_TRIPLE, then the host's. */
export function resolveTriple(args, env, host) {
  return args.target || env.TAURI_ENV_TARGET_TRIPLE || host;
}

/** The per-OS file name an installed sidecar gets. */
export function sidecarName(triple, exe) {
  return `opencode-cli-${triple}${exe.endsWith(".exe") ? ".exe" : ""}`;
}

/**
 * Compare an archive's SHA-256 with the pins table ({ [version]: { [asset]: hex } }).
 * Returns { status: "ok" | "missing" | "mismatch", expected? }. Absent is not failure; mismatch is.
 */
export function checkChecksum(actual, version, assetName, table) {
  const expected = table?.[version]?.[assetName];
  if (!expected) return { status: "missing" };
  if (String(expected).toLowerCase() === String(actual).toLowerCase()) return { status: "ok", expected };
  return { status: "mismatch", expected };
}

function loadChecksums() {
  return JSON.parse(readFileSync(join(root, "scripts", "opencode-checksums.json"), "utf8"));
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      out.help = true;
      continue;
    }
    if (flag === "--download") {
      out.download = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--target", "--version", "--binary", "--dest"].includes(flag) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    out[flag.slice(2)] = value;
    i += 1;
  }
  return out;
}

export function pinnedVersion() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = pkg.opencode?.version;
  if (!version) throw new Error('package.json has no "opencode.version".');
  return version;
}

/** What `--version` said, on either stream and whatever the exit code, kept for the error message. */
let lastVersionOutput = "";

/** The version a binary reports, or null if it will not run or names none. */
function reportedVersion(path) {
  try {
    const out = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
    lastVersionOutput = String(out).trim();
    return parseVersion(out);
  } catch (error) {
    // A binary that prints its version and still exits non-zero (or on stderr) has still named it.
    const said = [error?.stdout, error?.stderr].map((s) => (s ? String(s) : "")).join("\n").trim();
    lastVersionOutput = said || String(error?.message ?? error);
    return parseVersion(said);
  }
}

/** "no version" with what the binary actually said, so a failure on another platform explains itself. */
function noVersion() {
  const said = lastVersionOutput.replace(/\s+/g, " ").slice(0, 300);
  return said ? `no version (it said: ${said})` : "no version";
}

async function install(source, destination, version) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  const found = reportedVersion(destination);
  if (found !== version) {
    await rm(destination, { force: true });
    throw new Error(`Expected opencode ${version} but ${source} reports ${found ?? noVersion()}.`);
  }
  console.error(`opencode ${version} ready at ${destination}`);
}

async function download(urls, file) {
  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status !== 200 || !response.body) {
        failures.push(`${url} answered ${response.status}`);
        continue;
      }
      const total = Number(response.headers.get("content-length")) || 0;
      let received = 0;
      let lastReport = 0;
      const body = Readable.fromWeb(response.body);
      body.on("data", (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastReport > 1000) {
          lastReport = now;
          const mb = (received / 1e6).toFixed(0);
          const of = total ? ` of ${(total / 1e6).toFixed(0)} MB` : " MB";
          process.stderr.write(`\rdownloading ${mb}${of}   `);
        }
      });
      console.error(`downloading ${url}`);
      await pipeline(body, createWriteStream(file));
      process.stderr.write("\n");
      return url;
    } catch (error) {
      failures.push(`${url} failed: ${error.message}`);
    }
  }
  throw new Error(`Could not download opencode.\n  ${failures.join("\n  ")}`);
}

function extract(kind, archive, into) {
  if (kind === "zip" && process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", expandArchiveCommand(archive, into)], { stdio: "inherit" });
  } else if (kind === "zip") {
    execFileSync("unzip", ["-q", "-o", archive, "-d", into], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", into], { stdio: "inherit" });
  }
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(path, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/fetch-opencode.mjs [--target <triple>] [--version <v>] [--binary <path>] [--dest <dir>] [--download]");
    return;
  }
  const version = args.version ?? pinnedVersion();
  const host = hostTriple();
  const triple = resolveTriple(args, process.env, host);
  const asset = assetFor(triple);
  const dir = args.dest ? resolve(args.dest) : join(root, "src-tauri", "binaries");
  const destination = join(dir, sidecarName(triple, asset.exe));
  const runnable = triple === host;

  if (existsSync(destination) && runnable && reportedVersion(destination) === version) {
    console.error(`opencode ${version} already at ${destination}`);
    return;
  }

  if (args.binary) {
    await install(resolve(args.binary), destination, version);
    return;
  }

  if (!args.download && runnable && triple.endsWith("apple-darwin") && existsSync(MAC_APP_BINARY) && reportedVersion(MAC_APP_BINARY) === version) {
    console.error(`using ${MAC_APP_BINARY}`);
    await install(MAC_APP_BINARY, destination, version);
    return;
  }

  const work = await mkdtemp(join(tmpdir(), "folio-opencode-"));
  try {
    const archive = join(work, asset.name);
    const unpacked = join(work, "unpacked");
    await mkdir(unpacked);
    await download(sources(version, asset.name), archive);
    const digest = await sha256(archive);
    const check = checkChecksum(digest, version, asset.name, loadChecksums());
    if (check.status === "mismatch") {
      throw new Error(`SHA-256 of ${asset.name} is ${digest} but scripts/opencode-checksums.json pins ${check.expected}. Refusing to use it.`);
    }
    if (check.status === "missing") {
      console.error(`warning: no SHA-256 pin for ${asset.name} ${version}; the download is unverified (sha256 ${digest}). Add it to scripts/opencode-checksums.json.`);
    } else {
      console.error(`sha256 verified for ${asset.name}`);
    }
    extract(asset.kind, archive, unpacked);
    const found = await findFile(unpacked, asset.exe);
    if (!found) throw new Error(`${asset.name} did not contain ${asset.exe}.`);
    await mkdir(dir, { recursive: true });
    const staged = join(work, "staged");
    await rename(found, staged);
    await chmod(staged, 0o755);
    if (runnable) {
      const reported = reportedVersion(staged);
      if (reported !== version) throw new Error(`Expected opencode ${version} but the download reports ${reported ?? noVersion()}.`);
    } else {
      console.error(`skipping the version check: ${triple} cannot run on ${host}`);
    }
    await copyFile(staged, destination);
    await chmod(destination, 0o755);
    console.error(`opencode ${version} ready at ${destination} (${((await stat(destination)).size / 1e6).toFixed(0)} MB)`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`fetch-opencode: ${error.message}`);
    process.exit(1);
  });
}
