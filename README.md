# Folio

Folio is a commercial, closed-source desktop reading room for [opencode](https://opencode.ai). A repository is a book. Each opencode session is a chapter. You write on the page.

The shell is Tauri 2. The pages are React, TypeScript, and Vite. opencode is not forked: Folio runs `opencode serve` as a separate process, which this document calls the press, and speaks its HTTP API. opencode is MIT licensed; the notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## What the first launch does

Folio brings its own press. The installer carries opencode 2.0.28 as a sidecar next to the Folio executable, so there is nothing to install first.

- Folio starts the sidecar with `serve --stdio` on a random local port and a password made for that launch. The window talks to it directly over HTTP. Folio holds the child's standard input open, so the press stops when Folio does.
- The press keeps its sessions, keys, and cache under Folio's own app data folder (a `press` folder inside it; on macOS, `~/Library/Application Support/app.folio.desktop/press`). It never opens your own opencode database. Your opencode config folder stays yours.
- The free OpenCode Zen provider counts as connected, so no key is needed to begin. The title page says which press and model it will use, for example `opencode 2.0.28 · OpenCode Zen, cat-jam-free`.
- A key is optional. **A provider key…** in the menu (and **Use a provider key** on the title page) lists the providers that take a pasted key and stores it in the press with `POST /api/integration/{id}/connect/key`. Opencode keeps it on this machine; Folio does not keep a copy.
- **Attach to a running press** takes an address and a password, for a server you started yourself. The title page offers it when the press is missing, wants a password, or did not answer.
- **Open a folder** binds that repository as the book. The first empty chapter opens with a short note and the quill, so you can write immediately. Press Return twice to send.

When there is no sidecar, as in a plain dev checkout, Folio looks for the binary in this order: `FOLIO_OPENCODE_BIN`, `~/.opencode/bin/opencode`, then `opencode` on the `PATH`. If none is found, **Install opencode** runs the official installer (`https://opencode.ai/install`), and the same command is printed if you would rather run it yourself.

About, in the menu, is the colophon. It says **Powered by opencode**, names the opencode release this edition carries and the press in use, credits the MIT license, and shows Folio's own version.

## Develop

You need Node 22, Rust stable, and a C toolchain. On Linux the Tauri shell also needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`), GTK 3, and `patchelf`.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

The dev server is [http://127.0.0.1:47321](http://127.0.0.1:47321). In the browser the dev server stands in for the desktop shell: it exposes `/folio/press`, `/folio/serve`, `/folio/install`, `/folio/read`, and `/folio/write`, so the title page can find, start, and install opencode on this machine and the book can read and write files. The press it starts uses the same `serve --stdio` flags, a random password, and state under `.folio/press` in the repository, and stops when the dev server does.

- `FOLIO_OPENCODE_BIN=/path/to/opencode` picks the binary the dev host runs.
- `FOLIO_PRESS_URL` and `FOLIO_PRESS_PASSWORD` make `npm run dev` attach to a press that is already running instead of starting one.
- `npm run dev` followed by `?sample=1` opens the sample book (the flaky-login chapter) without a model.

Open the desktop shell with:

```bash
npm run fetch-press
npm run tauri dev
```

Run `npm run fetch-press` once first (see Bundled press), because the Tauri build step checks that the sidecar file exists, which `cargo check` needs as well.

### The replay press

`scripts/replay-press.mjs` is a small stand-in for `opencode serve` 2.0.28 that needs no model and no dependencies. It answers the routes Folio calls and replays recorded event streams from `src/book/__fixtures__/`.

```bash
node scripts/replay-press.mjs --port 4096 --password replay
node scripts/replay-press.mjs --flaky      # drops the first event stream, so the client must reconnect
node scripts/replay-press.mjs --pending    # starts with one ask and one question waiting
```

`src/engine/client.test.ts` starts it in-process and drives the real engine client against it: authentication, cursor paging, the prompt and its event stream, reconnecting, the silence watchdog, asks and forms, and error wording. The Rust side has its own tests (`cargo test` in `src-tauri`) for the path guard and the readiness line, and one ignored test that starts a real press when `FOLIO_OPENCODE_BIN` is set.

### Bundled press

The installer carries a pinned opencode CLI so the first launch needs no download. The version lives in `package.json` under `opencode.version`. Tauri expects the sidecar at `src-tauri/binaries/opencode-cli-<target-triple>` (with `.exe` on Windows), and `npm run fetch-press` puts it there. It runs before `tauri build` on its own, and in CI. Run it once by hand before `npm run tauri dev` or `cargo check`.

```bash
npm run fetch-press
npm run fetch-press -- --target x86_64-apple-darwin
npm run fetch-press -- --binary /path/to/opencode
```

- If the file is already there and reports the pinned version, nothing happens.
- `--binary <path>` copies a binary you already have. On macOS the script also reuses `/Applications/OpenCode.app` when it reports the pinned version, which saves a download of about 85 MB (the unpacked binary is about 186 MB). Pass `--download` to skip that and fetch from the network.
- Otherwise it downloads the release archive from `opencode.ai/files/bin/<version>/`, then from the GitHub release if that fails, unpacks it, and checks `--version`. A target that cannot run on this machine is downloaded without the check.

## Book

- Turning inside a chapter moves through its pages. Turning forward past the last page of the last chapter starts a new chapter. Streaming that fills a page turns forward on its own.
- The curl is about 450ms. Reduced motion uses a short fade.
- The quill is the lined field at the foot of the page. Press Return twice to send; a single Return makes a new line.
- Highlight a passage to write in the margin. The highlighted text is the context. The reply sits next to the note, and can replace the passage.
- Tool calls are footnotes. A footnote that made a change ends with a link, "See Plate N", which opens that plate.
- Changes are plates. A plate is the diff for one file, set on the right-hand page. Its running header reads, for example, "Plate I · src/greet.ts · +4 −1". When prose already fills the facing page, the plate does not cover it: a slip at the foot of the page reads "Plate I faces this page", and the plate opens when you click it or the footnote's link.
- **Accept** marks the plate as set. The edit is already in your files, so this changes only the plate's caption.
- **Revise** puts "Revise the change in <file>." in the quill so you can say what you want instead.
- **Reject** reverse-applies that plate's own patch to the file, writes it back through Folio, and tells the press, with a note that the change was declined on purpose, so it does not make it again. A later edit to the same file is left alone; if the file has changed since the plate was set, Folio leaves it as it is and says so. Folio does not use the press's session revert, because that would delete the chapter's history.
- **Fold back** puts the plate away; it can be opened again.
- Edits are applied as the press makes them unless you turn on **Ask before the press writes** in the menu. That gives chapters Folio creates from then on an `ask` rule for edits and for shell commands. The press then pauses on each one: the left page foot says, for example, "May I edit src/greet.ts?", the proposed change faces it as a plate, and the choices are **Allow once** and **No**. **No** tells the press the change was declined and the turn goes on without it.
- There is no "Always". In opencode 2.0.28 it saves a rule for the whole project that overrides every later session's ask, so a single click would quietly turn the setting off. Folio offers only the two answers that stay within the chapter.
- When the press asks a question of its own, it appears as a small form at the foot of the page: a choice, a line to write on, a number, a yes or no, or boxes to tick. **Send** answers, **Skip** sets the question aside. The quill hint reads "the press is waiting for your answer" meanwhile.
- **Stop**, in the quill hint while the press is working, interrupts the turn.
- **Model…** in the menu lists the press's models grouped by provider, the free OpenCode Zen ones first. The choice applies to the chapter in view and to chapters opened afterward. If the press's default model is no longer offered, Folio picks the first free model and says so on the title page. If a turn fails because the model is gone, a banner reads "That model is no longer offered. Choose another from the menu." and a click on it opens the list.
- Contents lists chapters. The ribbon marks a spread. Search looks through the book.

### Themes and settings

The type button at the right of the title bar opens Themes & Settings.

- Text size steps through six sizes.
- Light, Dark, or Automatic, which follows the system.
- Six themes: Original, Quiet, Paper, Bold, Calm, and Focus. Each is a typeface and a palette in both appearances.
- **Customize** sets line spacing, margins, and justified text. **Reset** puts those three back.

The choices are remembered in the window's `localStorage` under `folio.settings`.

## Staying with the press

The press can stall, restart, or go away, and the book should not lose its place.

- Folio listens to the press's event stream. If it drops, Folio opens it again after a wait that starts at 400 ms and doubles to 8 s, with some jitter.
- At the start of an outage the page says "The event stream paused. Folio will listen again." and the notice clears when the stream returns.
- The stream has no replay, so on return Folio reads each chapter's history, the latest diff, which chapters are running, and the asks and questions still waiting, and sets the book from that. Events that arrived during the read are applied on top.
- The press sends a heartbeat. If the stream is silent for 45 seconds, Folio treats it as dropped and opens another.
- If three reconnects in a row fail, Folio asks the host for the press again. If the press had died, the host starts a new one on a new port with a new password and the book resyncs; a press you attached is tried again at the same address. If that fails the page says "The press is not answering. Folio will keep trying."
- Requests to the press time out after 15 seconds and report in plain words: "The press could not be reached", a wrong password, a page the press does not know (with its version).
- Event types and tool shapes Folio does not know are ignored, so a newer press does not break the page.

## License seam

`src/license/check.ts` and the Tauri command `license_check` are the only gate in front of the press. This edition returns `unchecked` and does not block. `invalid` and `expired` would.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

## What is stubbed

- Signing: the package is shaped for it, but no Apple identity is configured, so builds are unsigned and notarization is wired but not run. See Release.
- The license check is a seam only; it never blocks.
- The library shelf, dog-ears, the Previously recap, other agents, and payments are not built.
- Plate status (accepted, reverted, folded) is kept in memory for the open book and is not saved. After a reload the plates come back from the press's diff without it.
- Approve-first is the permission toggle, not a separate editor.
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

Set `FOLIO_DMG_PLAIN=1` to skip the Finder styling of the dmg window, which is the icon positions and window size and nothing else. The styling drives Finder with AppleScript, so on a headless machine, or one where Finder automation is not allowed, the dmg step stops with `AppleEvent timed out (-1712)`. The flag sets `CI=true` for the `tauri build` command only. GitHub runners already set `CI`, so dmgs built in CI are unstyled. The plain dmg still holds `Folio.app` and the Applications link.

At the end the script checks that the app and dmg exist, prints their paths, and says whether the build was signed. When it was not, it says that setting the signing and notarization variables and running the script again is the supported path, and prints the manual sequence: sign the sidecar and the app, notarize the app from a `ditto` zip and staple it, then rebuild, sign, notarize, and staple the dmg.

### Signed-ready

With no Apple identity configured the build is unsigned (linker-signed only): the app runs on the machine that built it, and Gatekeeper warns elsewhere. Signed-ready means the package is already shaped for signing, so adding credentials is the only step left:

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

`.github/workflows/build.yml` runs the unit tests and the web build, then fetches the bundled press and runs `tauri build` on Linux (deb, AppImage), macOS (app, dmg), and Windows (nsis, msi).
