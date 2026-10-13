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
  const provider = model.providerID === "opencode" ? "OpenCode Zen" : providers.find((p) => p.id === model.providerID)?.name || model.providerID;
  return `${press} · ${provider}, ${shortModel(model.id)}`;
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
  | { phase: "ready"; version: string; summary: string; providers?: KeyProvider[] }
  | { phase: "error"; message: string }
  | { phase: "needs-password"; detail?: string };
