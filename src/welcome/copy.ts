/** First-run copy and the small decisions that keep the title page honest. */

export const FIRST_PAGE_ID = "folio-first-page";

export const FIRST_PAGE =
  "This is the first page. Write in the ink below, and press Return twice when you want an answer. The press will set its reply on these pages. Commands settle into footnotes, and edits fold out as plates you can accept or reject.";

export const INSTALL_COMMAND = "curl -fsSL https://opencode.ai/install | bash";

/** Integrations offered on the key form, in this order (opencode ids). */
export const KEY_PROVIDERS = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "groq",
  "mistral",
  "xai",
  "deepseek",
  "togetherai",
  "fireworks-ai",
];

export type KeyProvider = { id: string; label: string };

type Integration = { id: string; name?: string; methods?: { type?: string; label?: string }[] };

/** The allow-listed integrations that take a pasted key, named as opencode names them. */
export function keyProviders(integrations: Integration[]): KeyProvider[] {
  return integrations
    .filter((item) => KEY_PROVIDERS.includes(item.id) && item.methods?.some((method) => method.type === "key"))
    .sort((a, b) => KEY_PROVIDERS.indexOf(a.id) - KEY_PROVIDERS.indexOf(b.id))
    .map((item) => ({ id: item.id, label: item.name || item.id }));
}

/** "opencode 2.0.28 · OpenCode Zen, cat-jam-free": the press, its provider, its model. */
export function pressSummary(
  version: string,
  providers: { id: string; name?: string }[],
  model: { providerID: string; id: string } | null,
): string {
  const press = `opencode ${version}`.trim();
  if (!model) return press;
  return `${press} · ${providerLabel(model.providerID, providers)}, ${shortModel(model.id)}`;
}

/** A provider as the reader knows it; the free `opencode` provider is OpenCode Zen. */
export function providerLabel(id: string, providers: { id: string; name?: string }[]): string {
  return id === "opencode" ? "OpenCode Zen" : providers.find((p) => p.id === id)?.name || id;
}

/** The menu's model list: one group per provider, the free provider first, models in the press's order. */
export function modelGroups<M extends { providerID: string; id: string; name?: string }>(
  models: M[],
  providers: { id: string; name?: string }[],
): { id: string; label: string; models: M[] }[] {
  const groups = new Map<string, M[]>();
  for (const model of models) groups.set(model.providerID, [...(groups.get(model.providerID) ?? []), model]);
  return [...groups.entries()]
    .sort(([a], [b]) => Number(b === "opencode") - Number(a === "opencode"))
    .map(([id, list]) => ({ id, label: providerLabel(id, providers), models: list }));
}

function shortModel(model: string): string {
  const piece = model.split("/").pop() ?? model;
  return piece.length > 42 ? `${piece.slice(0, 40)}…` : piece;
}

export type PressPhase =
  | { phase: "checking" }
  | { phase: "missing"; detail?: string }
  | { phase: "installing" }
  /** `providers` is set while the reader has the key form open. */
  | { phase: "ready"; version: string; summary: string; providers?: KeyProvider[]; note?: string }
  | { phase: "error"; message: string }
  | { phase: "needs-password"; detail?: string };
