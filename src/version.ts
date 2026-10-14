import pkg from "../package.json";

/** Folio's own version, read from package.json so the colophon cannot drift from it. */
export const FOLIO_VERSION: string = pkg.version;

/** The opencode release this edition bundles and was exercised against (package.json, `opencode.version`). */
export const BUNDLED_PRESS_VERSION: string = pkg.opencode.version;
