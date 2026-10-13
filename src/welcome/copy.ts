/** First-run copy and the small decisions that keep the title page honest. */

export const FIRST_PAGE_ID = "folio-first-page";

export const FIRST_PAGE =
  "This is the first page. Write in the ink below, and press Return twice when you want an answer. The press will set its reply on these pages. Commands settle into footnotes, and edits fold out as plates you can accept or reject.";

export const INSTALL_COMMAND = "curl -fsSL https://opencode.ai/install | bash";

export const PREFERRED_PROVIDERS = ["openai", "anthropic", "google", "openrouter", "groq", "xai", "poe"];

export type KeyProvider = { id: string; label: string };

export function keyProviders(auth: Record<string, { type?: string; label?: string; prompts?: unknown[] }[]>): KeyProvider[] {
  const found: KeyProvider[] = [];
  for (const [id, methods] of Object.entries(auth)) {
    const api = methods.find((method) => method.type === "api" && !(method.prompts && method.prompts.length));
    if (!api) continue;
    found.push({ id, label: labelFor(id) });
  }
  found.sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
  const preferred = found.filter((item) => PREFERRED_PROVIDERS.includes(item.id));
  return preferred.length ? preferred : found.slice(0, 6);
}

export function modelSummary(connected: string[], defaults: Record<string, string>): string {
  if (!connected.length) return "";
  const id = connected[0];
  const model = defaults[id];
  return model ? `${labelFor(id)} · ${shortModel(model)}` : labelFor(id);
}

export function labelFor(id: string): string {
  const known: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    openrouter: "OpenRouter",
    groq: "Groq",
    xai: "xAI",
    poe: "Poe",
    opencode: "opencode",
    digitalocean: "DigitalOcean",
  };
  return known[id] ?? id;
}

function shortModel(model: string): string {
  const piece = model.split("/").pop() ?? model;
  return piece.length > 42 ? `${piece.slice(0, 40)}…` : piece;
}

function rank(id: string): number {
  const index = PREFERRED_PROVIDERS.indexOf(id);
  return index === -1 ? PREFERRED_PROVIDERS.length : index;
}

export type PressPhase =
  | { phase: "checking" }
  | { phase: "missing"; detail?: string }
  | { phase: "installing" }
  | { phase: "needs-provider"; providers: KeyProvider[] }
  | { phase: "ready"; version: string; summary: string }
  | { phase: "error"; message: string };
