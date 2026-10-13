import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PORT = 4096;
let child: ChildProcess | null = null;

export type PressProbe = {
  installed: boolean;
  running: boolean;
  binary?: string;
  version?: string;
};

export function findOpencode(): string | null {
  const fromEnv = process.env.FOLIO_OPENCODE_BIN;
  const homeBin = path.join(homedir(), ".opencode", "bin", "opencode");
  for (const candidate of [fromEnv, homeBin]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export async function probePress(): Promise<PressProbe> {
  const binary = findOpencode() ?? (await which("opencode"));
  const health = await healthcheck();
  return {
    installed: Boolean(binary) || Boolean(health),
    running: Boolean(health),
    binary: binary ?? undefined,
    version: health?.version,
  };
}

export async function servePress(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const existing = await healthcheck();
  if (existing) return { ok: true, version: existing.version };
  const binary = findOpencode() ?? (await which("opencode"));
  if (!binary) return { ok: false, error: "opencode is not installed." };
  if (!child || child.exitCode != null) {
    child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(PORT), "--cors", "http://127.0.0.1:47321"], {
      detached: false,
      stdio: "ignore",
      env: process.env,
    });
    child.on("exit", () => {
      child = null;
    });
  }
  const ready = await waitForHealth();
  if (!ready) return { ok: false, error: "opencode did not start listening on port 4096." };
  return { ok: true, version: ready.version };
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

async function healthcheck(): Promise<{ version: string } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/global/health`);
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return { version: data.version ?? "" };
  } catch {
    return null;
  }
}

async function waitForHealth(): Promise<{ version: string } | null> {
  for (let i = 0; i < 40; i++) {
    const health = await healthcheck();
    if (health) return health;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [command], (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout.trim() || null);
    });
  });
}
