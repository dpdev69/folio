/** The part of Web Storage Folio uses; tests hand in a Map-backed one. */
export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>;

/**
 * The window's localStorage, or null where it cannot be had (a private
 * window, a webview that refuses it, tests without a DOM). Reading the
 * property can itself throw, so it is asked for inside a try.
 */
export function browserStorage(): KeyStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
