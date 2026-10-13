import { describe, expect, it } from "vitest";
import { FIRST_PAGE, keyProviders, modelSummary } from "./copy";

describe("first run", () => {
  it("offers api-key providers and prefers the familiar names", () => {
    const list = keyProviders({
      poe: [{ type: "api", label: "Manually enter API Key" }],
      openai: [
        { type: "oauth", label: "ChatGPT" },
        { type: "api", label: "Manually enter API Key" },
      ],
      gitlab: [{ type: "api", label: "Token", prompts: [{ key: "instanceUrl" }] }],
      xai: [{ type: "api", label: "Manually enter API Key" }],
    });
    expect(list.map((item) => item.id)).toEqual(["openai", "xai", "poe"]);
    const crowded = keyProviders({
      openai: [{ type: "api" }],
      zebra: [{ type: "api" }],
      amber: [{ type: "api" }],
    });
    expect(crowded.map((item) => item.id)).toEqual(["openai"]);
  });

  it("names the connected model without inventing one", () => {
    expect(modelSummary(["opencode"], { opencode: "big-pickle" })).toBe("opencode · big-pickle");
    expect(modelSummary([], {})).toBe("");
  });

  it("keeps the first page short enough to read at a glance", () => {
    expect(FIRST_PAGE.length).toBeLessThan(420);
    expect(FIRST_PAGE.toLowerCase()).toContain("return twice");
  });
});
