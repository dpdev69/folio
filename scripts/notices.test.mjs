import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("THIRD_PARTY_NOTICES.md", () => {
  it("names the opencode version pinned in package.json", () => {
    const pinned = JSON.parse(read("package.json")).opencode.version;
    const named = /opencode CLI binary, version (\d+\.\d+\.\d+)/.exec(read("THIRD_PARTY_NOTICES.md"))?.[1];
    expect(named).toBe(pinned);
  });
});
