import { describe, expect, it } from "vitest";
import { FIRST_PAGE, keyProviders, modelGroups, pressSummary } from "./copy";

describe("first run", () => {
  it("offers key integrations from a short list, by their own names", () => {
    const list = keyProviders([
      { id: "302ai", name: "302.AI", methods: [{ type: "key" }] },
      { id: "openai", name: "OpenAI", methods: [{ type: "key" }, { type: "oauth", label: "Sign in with ChatGPT" }] },
      { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }, { type: "env" }] },
      { id: "github-copilot", name: "GitHub Copilot", methods: [{ type: "oauth" }] },
      { id: "google", name: "Google", methods: [{ type: "env" }] },
      { id: "togetherai", name: "Together AI", methods: [{ type: "key" }] },
    ]);
    expect(list).toEqual([
      { id: "anthropic", label: "Anthropic" },
      { id: "openai", label: "OpenAI" },
      { id: "togetherai", label: "Together AI" },
    ]);
  });

  it("names the press and its model; the free provider counts", () => {
    expect(
      pressSummary("2.0.28", [{ id: "opencode", name: "OpenCode" }], { providerID: "opencode", id: "cat-jam-free" }),
    ).toBe("opencode 2.0.28 · OpenCode Zen, cat-jam-free");
    expect(pressSummary("2.0.28", [{ id: "anthropic", name: "Anthropic" }], { providerID: "anthropic", id: "claude-x" })).toBe(
      "opencode 2.0.28 · Anthropic, claude-x",
    );
    expect(pressSummary("2.0.28", [], null)).toBe("opencode 2.0.28");
  });

  it("groups the models by provider, the free one first, each named as the menu names it", () => {
    const models = [
      { providerID: "anthropic", id: "claude-x", name: "Claude X" },
      { providerID: "opencode", id: "cat-jam-free", name: "Cat Jam Free" },
      { providerID: "anthropic", id: "claude-y" },
      { providerID: "opencode", id: "big-pickle", name: "Big Pickle" },
    ];
    const groups = modelGroups(models, [{ id: "anthropic", name: "Anthropic" }]);
    expect(groups.map((g) => [g.label, g.models.map((m) => m.id)])).toEqual([
      ["OpenCode Zen", ["cat-jam-free", "big-pickle"]],
      ["Anthropic", ["claude-x", "claude-y"]],
    ]);
    expect(modelGroups([{ providerID: "groq", id: "llama" }], [])[0].label).toBe("groq");
  });

  it("keeps the first page short enough to read at a glance", () => {
    expect(FIRST_PAGE.length).toBeLessThan(420);
    expect(FIRST_PAGE.toLowerCase()).toContain("return twice");
  });
});
