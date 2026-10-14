/** Small readers for the untyped JSON the press sends. One of each, shared by the book. */

export type Data = Record<string, unknown>;

/** A plain object, or undefined for anything else (arrays included). */
export function recordOf(value: unknown): Data | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : undefined;
}

export function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The first of `keys` that holds a string with something in it, trimmed. */
export function firstString(input: Data | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
