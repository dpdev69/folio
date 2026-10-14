/**
 * A folder or file path as a key, so the same place written two ways is found
 * again: separators made forward, repeated and trailing slashes dropped, a
 * Windows drive letter and the whole of a Windows path lowered (its file
 * systems ignore case), and macOS's `/private/tmp`, `/private/var` and
 * `/private/etc` read as the `/tmp`, `/var` and `/etc` they are linked from.
 * The webview cannot resolve links itself, so only these known ones are
 * folded. A macOS path keeps its case: a case-sensitive volume is possible.
 */
export function pathKey(path: string): string {
  let key = path.trim().replace(/\\/g, "/");
  const windows = /^[A-Za-z]:(\/|$)/.test(key) || key.startsWith("//");
  key = key.replace(/(?<!^)\/{2,}/g, "/");
  if (key.length > 1) key = key.replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(key)) key += "/";
  key = key.replace(/^\/private\/(tmp|var|etc)(?=\/|$)/, "/$1");
  return windows ? key.toLowerCase() : key;
}

/** Whether two paths name the same place, by `pathKey`. */
export function samePath(a: string | undefined, b: string | undefined): boolean {
  return a != null && b != null && pathKey(a) === pathKey(b);
}

/**
 * `file` from the book's root when it lies inside `root`, by `pathKey`;
 * undefined when it lies outside or is the root itself. The relative part
 * keeps the file's own spelling.
 */
export function insideRoot(file: string, root: string): string | undefined {
  const fileKey = pathKey(file);
  const rootKey = pathKey(root);
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  if (fileKey === rootKey || !fileKey.startsWith(prefix)) return undefined;
  const rest = file.trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const depth = fileKey.slice(prefix.length).split("/").length;
  return rest.slice(rest.length - depth).join("/");
}
