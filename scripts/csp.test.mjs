import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("Content-Security-Policy", () => {
  it("allows exactly the inline script index.html carries", () => {
    const scripts = [...read("index.html").matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const hash = createHash("sha256").update(scripts[0]).digest("base64");
    const csp = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp;
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
  });
});
