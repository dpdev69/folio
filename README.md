# Folio

Folio is a commercial, closed-source desktop reading room for [opencode](https://opencode.ai). A repository is a book. Each opencode session is a chapter. You write on the page.

The shell is Tauri 2. The pages are React, TypeScript, and Vite. opencode is not forked: Folio starts or attaches to `opencode serve` and speaks its HTTP API. opencode is MIT licensed; the notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## What the first launch does

The title page looks for opencode.

- If the binary is missing, **Install opencode** runs the official installer (`https://opencode.ai/install`). The same command is printed if you would rather install it yourself.
- If the press is up and no provider is connected, Folio asks for one API key and stores it with `PUT /auth/:id`. Folio does not create an account and does not keep the key.
- **Open a folder** binds that repository as the book. The first empty chapter opens with a short note and the quill, so you can write immediately. Press Return twice to send.

About, in the menu, is the colophon. It says **Powered by opencode**.

## Develop

You need Node 22, Rust stable, and a C toolchain. On Linux the Tauri shell also needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`), GTK 3, and `patchelf`.

```bash
npm install
npm test
npm run dev
```

The dev server is [http://127.0.0.1:47321](http://127.0.0.1:47321). It proxies `/engine` to `127.0.0.1:4096` and exposes `/folio/press`, `/folio/serve`, and `/folio/install` so the title page can find, start, and install opencode on this machine.

Open the desktop shell with:

```bash
npm run tauri dev
```

Folio looks for the binary next to its own executable (the bundled sidecar, named `opencode-cli`), then in `FOLIO_OPENCODE_BIN`, then `~/.opencode/bin/opencode`, then `PATH`. `opencode` 2.0.28 is the server this client was exercised against. The API moves quickly; event shapes we do not know are ignored.

If the server was started with `OPENCODE_SERVER_PASSWORD`, type that password on the title page before opening a folder. The username is `opencode`.

`npm run dev` followed by `?sample=1` opens the sample book (the flaky-login chapter) without a model.

### Bundled press

The installer carries a pinned opencode CLI so the first launch needs no download. The version lives in `package.json` under `opencode.version`. Tauri expects the sidecar at `src-tauri/binaries/opencode-cli-<target-triple>` (with `.exe` on Windows), and `npm run fetch-press` puts it there. It runs before `tauri build` on its own, and in CI. Run it once by hand before `npm run tauri dev`, because the Tauri build step checks that the file exists.

```bash
npm run fetch-press
npm run fetch-press -- --target x86_64-apple-darwin
npm run fetch-press -- --binary /path/to/opencode
```

- If the file is already there and reports the pinned version, nothing happens.
- `--binary <path>` copies a binary you already have. On macOS the script also reuses `/Applications/OpenCode.app` when it reports the pinned version, so there is no 145 MB download. Pass `--download` to skip that and fetch from the network.
- Otherwise it downloads the release archive from `opencode.ai/files/bin/<version>/`, then from the GitHub release if that fails, unpacks it, and checks `--version`. A target that cannot run on this machine is downloaded without the check.

When the sidecar is missing, as in a plain dev checkout, the title page falls back to the lookup order above: `FOLIO_OPENCODE_BIN`, `~/.opencode/bin/opencode`, then `PATH`, and offers the installer.

## Book

- A page turn past the end starts a new chapter. Turning inside a chapter moves through its pages. Streaming that fills a page turns forward on its own.
- The curl is about 450ms. Reduced motion uses a short fade.
- Tool calls are footnotes. Diffs are plates with Accept, Revise, Reject, and Fold back. Reject calls opencode revert. Edits are already applied unless you turn on **Ask before the press writes**, which sets the session permission to `ask`.
- Highlight a passage to write in the margin. The highlighted text is the context. The reply sits next to the note.
- Contents lists chapters. The ribbon marks a spread.

## License seam

`src/license/check.ts` and the Tauri command `license_check` are the only gate in front of the press. This edition returns `unchecked` and does not block. `invalid` and `expired` would.

## Tests

```bash
npm test
npm run build
```

## What is stubbed

- Notarization is wired but not run here, and the license check is a seam. See Release.
- The library shelf, dog-ears, the Previously recap, themes, and other agents.
- Approve-first is the permission toggle, not a separate editor. Reject means revert.
- Page curl is a 3D turn with a lifted corner, not a full cylindrical mesh.

## Release

`scripts/release-macos.sh` builds the macOS app and dmg for Apple silicon.

```bash
scripts/release-macos.sh
FOLIO_TARGET=x86_64-apple-darwin scripts/release-macos.sh
```

It runs `npm ci` if `node_modules` is missing, fetches the bundled press, then runs `tauri build --bundles app,dmg`. The outputs land in `src-tauri/target/<target>/release/bundle/`:

- `macos/Folio.app`
- `dmg/Folio_<version>_aarch64.dmg` (`_x64` for Intel)

At the end the script prints those paths and says whether the build was signed. When it was not, it prints the `codesign` and `xcrun notarytool` commands a release engineer would run.

### Signed-ready

With no Apple identity configured the build is unsigned: Tauri applies an ad-hoc signature, the app runs on the machine that built it, and Gatekeeper warns elsewhere. Signed-ready means the package is already shaped for signing, so adding credentials is the only step left:

- `src-tauri/Entitlements.plist` is wired into `bundle.macOS.entitlements`. It grants the hardened-runtime exceptions the Bun-built `opencode-cli` sidecar needs (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) and `network.client` for the local press.
- `signingIdentity` is deliberately unset in `tauri.conf.json`. Tauri reads it from the environment.
- The sidecar sits in `Contents/MacOS` beside the Folio executable, where Tauri signs it with the app.
- The minimum system version is macOS 12.

Environment variables Tauri reads:

| Purpose | Variables |
| --- | --- |
| Sign with a keychain identity | `APPLE_SIGNING_IDENTITY` |
| Sign in CI from a certificate | `APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` |
| Notarize with an Apple ID | `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID` |
| Notarize with an API key | `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` |

The CI macOS job passes the certificate, identity, and Apple ID variables through from repository secrets of the same names. If the secrets do not exist the build stays unsigned. To check a result:

```bash
codesign -dv --verbose=2 src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Folio.app
```

## CI

`.github/workflows/build.yml` runs the unit tests and the web build, then `tauri build` on Linux (deb, AppImage), macOS (app, dmg), and Windows (nsis, msi).
