#!/usr/bin/env node
// Puts the pinned opencode CLI where Tauri expects an externalBin:
//   src-tauri/binaries/opencode-cli-<target-triple>[.exe]
//
// Usage: node scripts/fetch-opencode.mjs [--target <triple>] [--version <v>]
//                                        [--binary <path>] [--dest <dir>] [--download]
//
// --download skips the local app fast path and always fetches from the network.

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
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

function pinnedVersion() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = pkg.opencode?.version;
  if (!version) throw new Error('package.json has no "opencode.version".');
  return version;
}

/** The version a binary reports, or null if it will not run. */
function reportedVersion(path) {
  try {
    const out = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
    return parseVersion(out);
  } catch {
    return null;
  }
}

async function install(source, destination, version) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  const found = reportedVersion(destination);
  if (found !== version) {
    await rm(destination, { force: true });
    throw new Error(`Expected opencode ${version} but ${source} reports ${found ?? "no version"}.`);
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
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${into}' -Force`],
      { stdio: "inherit" },
    );
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
  const version = args.version ?? pinnedVersion();
  const host = hostTriple();
  const triple = args.target ?? host;
  const asset = assetFor(triple);
  const dir = args.dest ? resolve(args.dest) : join(root, "src-tauri", "binaries");
  const destination = join(dir, `opencode-cli-${triple}${asset.exe.endsWith(".exe") ? ".exe" : ""}`);
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
    extract(asset.kind, archive, unpacked);
    const found = await findFile(unpacked, asset.exe);
    if (!found) throw new Error(`${asset.name} did not contain ${asset.exe}.`);
    await mkdir(dir, { recursive: true });
    const staged = join(work, "staged");
    await rename(found, staged);
    await chmod(staged, 0o755);
    if (runnable) {
      const reported = reportedVersion(staged);
      if (reported !== version) throw new Error(`Expected opencode ${version} but the download reports ${reported ?? "no version"}.`);
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

main().catch((error) => {
  console.error(`fetch-opencode: ${error.message}`);
  process.exit(1);
});
