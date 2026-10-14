import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  checkChecksum,
  expandArchiveCommand,
  parseArgs,
  psQuote,
  resolveTriple,
  sidecarName,
} from "./fetch-opencode.mjs";
import { assetFor, hostTriple, sources, TRIPLES } from "./opencode-release.mjs";

describe("importing fetch-opencode.mjs", () => {
  it("has no side effects and exposes its helpers", () => {
    expect(typeof parseArgs).toBe("function");
  });
});

describe("hostTriple on this machine", () => {
  it("returns a supported triple", () => {
    expect(TRIPLES).toContain(hostTriple());
  });
});

describe("parseArgs", () => {
  it("reads flags and values", () => {
    expect(parseArgs(["--target", "x86_64-apple-darwin", "--download", "--dest", "out"])).toEqual({
      target: "x86_64-apple-darwin",
      download: true,
      dest: "out",
    });
  });
  it("rejects unknown or incomplete flags", () => {
    expect(() => parseArgs(["--nope", "x"])).toThrow(/--nope/);
    expect(() => parseArgs(["--target"])).toThrow(/--target/);
  });
});

describe("resolveTriple", () => {
  it("prefers --target, then TAURI_ENV_TARGET_TRIPLE, then the host", () => {
    const env = { TAURI_ENV_TARGET_TRIPLE: "x86_64-apple-darwin" };
    expect(resolveTriple({ target: "aarch64-apple-darwin" }, env, "host")).toBe("aarch64-apple-darwin");
    expect(resolveTriple({}, env, "host")).toBe("x86_64-apple-darwin");
    expect(resolveTriple({}, {}, "host")).toBe("host");
    expect(resolveTriple({}, { TAURI_ENV_TARGET_TRIPLE: "" }, "host")).toBe("host");
  });
});

describe("sidecarName and urls", () => {
  it("adds .exe on Windows only", () => {
    expect(sidecarName("x86_64-pc-windows-msvc", assetFor("x86_64-pc-windows-msvc").exe)).toBe("opencode-cli-x86_64-pc-windows-msvc.exe");
    expect(sidecarName("aarch64-apple-darwin", "opencode")).toBe("opencode-cli-aarch64-apple-darwin");
  });
  it("builds the url from the asset name", () => {
    const [first] = sources("2.0.28", assetFor("aarch64-apple-darwin").name);
    expect(first).toBe("https://opencode.ai/files/bin/2.0.28/opencode-darwin-arm64.zip");
  });
});

describe("PowerShell command", () => {
  it("single-quotes and doubles embedded quotes", () => {
    expect(psQuote("C:\\Users\\O'Brien\\a.zip")).toBe("'C:\\Users\\O''Brien\\a.zip'");
    expect(psQuote("$env:TEMP `x`")).toBe("'$env:TEMP `x`'");
    // PowerShell ends a single-quoted string at a typographic quote too.
    expect(psQuote("C:\\Users\\O\u2019Brien")).toBe("'C:\\Users\\O\u2019\u2019Brien'");
  });
  it("builds Expand-Archive with both paths quoted", () => {
    expect(expandArchiveCommand("C:\\t m\\o'c.zip", "C:\\out")).toBe(
      "Expand-Archive -LiteralPath 'C:\\t m\\o''c.zip' -DestinationPath 'C:\\out' -Force",
    );
  });
});

describe("checkChecksum", () => {
  const hex = createHash("sha256").update("x").digest("hex");
  const table = { "1.0.0": { "a.zip": hex } };
  it("accepts a match, case-insensitively", () => {
    expect(checkChecksum(hex.toUpperCase(), "1.0.0", "a.zip", table).status).toBe("ok");
  });
  it("fails a mismatch", () => {
    expect(checkChecksum("00", "1.0.0", "a.zip", table).status).toBe("mismatch");
  });
  it("calls an absent pin missing", () => {
    expect(checkChecksum(hex, "1.0.0", "b.zip", table).status).toBe("missing");
    expect(checkChecksum(hex, "9.9.9", "a.zip", table).status).toBe("missing");
  });
  it("ships a pins table of 64-hex digests", () => {
    const real = JSON.parse(readFileSync(new URL("./opencode-checksums.json", import.meta.url), "utf8"));
    for (const assets of Object.values(real)) for (const digest of Object.values(assets)) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
