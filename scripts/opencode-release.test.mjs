import { describe, expect, it } from "vitest";
import {
  assetFor,
  hostTriple,
  parseVersion,
  sources,
  TRIPLES,
} from "./opencode-release.mjs";

describe("hostTriple", () => {
  it("maps each supported platform and arch", () => {
    expect(hostTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(hostTriple("darwin", "x64")).toBe("x86_64-apple-darwin");
    expect(hostTriple("win32", "x64")).toBe("x86_64-pc-windows-msvc");
    expect(hostTriple("win32", "arm64")).toBe("aarch64-pc-windows-msvc");
    expect(hostTriple("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
    expect(hostTriple("linux", "arm64")).toBe("aarch64-unknown-linux-gnu");
  });

  it("refuses a platform it has no build for", () => {
    expect(() => hostTriple("freebsd", "x64")).toThrow(/freebsd/);
    expect(() => hostTriple("linux", "ia32")).toThrow(/ia32/);
  });
});

describe("assetFor", () => {
  it("names the archive, its kind and the executable for every triple", () => {
    expect(assetFor("aarch64-apple-darwin")).toEqual({
      name: "opencode-darwin-arm64.zip",
      kind: "zip",
      exe: "opencode",
    });
    expect(assetFor("x86_64-apple-darwin")).toEqual({
      name: "opencode-darwin-x64.zip",
      kind: "zip",
      exe: "opencode",
    });
    expect(assetFor("x86_64-pc-windows-msvc")).toEqual({
      name: "opencode-windows-x64.zip",
      kind: "zip",
      exe: "opencode.exe",
    });
    expect(assetFor("aarch64-pc-windows-msvc")).toEqual({
      name: "opencode-windows-arm64.zip",
      kind: "zip",
      exe: "opencode.exe",
    });
    expect(assetFor("x86_64-unknown-linux-gnu")).toEqual({
      name: "opencode-linux-x64.tar.gz",
      kind: "tgz",
      exe: "opencode",
    });
    expect(assetFor("aarch64-unknown-linux-gnu")).toEqual({
      name: "opencode-linux-arm64.tar.gz",
      kind: "tgz",
      exe: "opencode",
    });
  });

  it("covers every triple the host lookup can return", () => {
    expect(TRIPLES).toHaveLength(6);
    for (const triple of TRIPLES) expect(() => assetFor(triple)).not.toThrow();
  });

  it("throws for an unknown triple", () => {
    expect(() => assetFor("riscv64-unknown-linux-gnu")).toThrow(/riscv64/);
  });
});

describe("sources", () => {
  it("tries opencode.ai first and GitHub second", () => {
    expect(sources("2.0.28", "opencode-darwin-arm64.zip")).toEqual([
      "https://opencode.ai/files/bin/2.0.28/opencode-darwin-arm64.zip",
      "https://github.com/anomalyco/opencode/releases/download/v2.0.28/opencode-darwin-arm64.zip",
    ]);
  });
});

describe("parseVersion", () => {
  it("normalizes the CLI banner", () => {
    expect(parseVersion("opencode v2.0.28\n")).toBe("2.0.28");
    expect(parseVersion("opencode 1.19.0")).toBe("1.19.0");
    expect(parseVersion("v2.0.28")).toBe("2.0.28");
    expect(parseVersion("2.0.28")).toBe("2.0.28");
  });

  it("returns null when there is no version", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("command not found")).toBeNull();
  });
});
