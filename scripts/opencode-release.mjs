// Pure helpers for locating an opencode release build. No I/O lives here.

const ASSETS = {
  "aarch64-apple-darwin": { name: "opencode-darwin-arm64.zip", kind: "zip", exe: "opencode" },
  "x86_64-apple-darwin": { name: "opencode-darwin-x64.zip", kind: "zip", exe: "opencode" },
  "x86_64-pc-windows-msvc": { name: "opencode-windows-x64.zip", kind: "zip", exe: "opencode.exe" },
  "aarch64-pc-windows-msvc": { name: "opencode-windows-arm64.zip", kind: "zip", exe: "opencode.exe" },
  "x86_64-unknown-linux-gnu": { name: "opencode-linux-x64.tar.gz", kind: "tgz", exe: "opencode" },
  "aarch64-unknown-linux-gnu": { name: "opencode-linux-arm64.tar.gz", kind: "tgz", exe: "opencode" },
};

export const TRIPLES = Object.keys(ASSETS);

const OS = { darwin: "apple-darwin", win32: "pc-windows-msvc", linux: "unknown-linux-gnu" };
const CPU = { arm64: "aarch64", x64: "x86_64" };

/** The Rust target triple for a Node platform and arch (defaults to this machine). */
export function hostTriple(platform = process.platform, arch = process.arch) {
  const os = OS[platform];
  const cpu = CPU[arch];
  if (!os) throw new Error(`No opencode build for platform "${platform}".`);
  if (!cpu) throw new Error(`No opencode build for architecture "${arch}".`);
  return `${cpu}-${os}`;
}

/** Archive name, archive kind and executable name for a target triple. */
export function assetFor(triple) {
  const asset = ASSETS[triple];
  if (!asset) throw new Error(`No opencode build for target "${triple}".`);
  return { ...asset };
}

/** Download URLs in the order they should be tried. */
export function sources(version, name) {
  return [
    `https://opencode.ai/files/bin/${version}/${name}`,
    `https://github.com/anomalyco/opencode/releases/download/v${version}/${name}`,
  ];
}

/** Pull "2.0.28" out of output such as "opencode v2.0.28". */
export function parseVersion(output) {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(output));
  return match ? match[1] : null;
}
