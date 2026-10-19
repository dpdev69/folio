# Follow-ups

Collected from the per-task and final reviews. None blocks a session; each is a deferred improvement. The list from the 0.2.0 MVP pass (2026-10-14) was worked through the same day in six commits (`1c51c34` press host, `3db2ab0` fetch and release, `9ed8721` book, `07fb6b1` state, `b157fb9` motion, `e6fb044` wiring); what remains of it is below, with what those passes turned up.

## Where things stand and what comes next (handoff, 2026-10-15)

`main` is at `cc89351` on the private remote (https://github.com/dpdev69/folio); CI builds the web app and the macOS, Linux and Windows desktop bundles on every push, and the on-demand Intel job passes. 359 vitest tests, typecheck and `cargo test` are green. Done since the 0.2.0 MVP: the whole first follow-ups list, the motion pass (paper curl, plates laid over a mounted page, settling ink, pre-mount theme), the release pins, the packaged-app checks (`docs/e2e.md` rows 20 to 23), the window-following page layout, and the interface follow-ups. Parallel agents work this repository by the file-ownership split in the memory note "folio-agent-ownership" (book / state+engine / ui / infra / rust), committing per area.

Next, in order of value:

1. A live end-to-end run against a real press with the current build, recorded as new rows in `docs/e2e.md`: a streamed turn with the settling lines and the auto turn, a plate laid from its slip, Reject with "Restoring the file…", an ask and a question form at the page foot (the foot overlays the page above 900 px since `ceaba2d`), the margin note, and a window resized mid-chapter. The layout since `ceaba2d` was verified in the dev app at three sizes, not in the packaged app.
2. ~~The Reject-in-flight race~~: closed on 2026-10-19; a renamed diff plate keeps its old id as `formerId`, and `mutatePlate` matches either.
3. A signed release: run `scripts/release-macos.sh` with the Apple secrets, bump `package.json` to 0.3.0, tag it, and write a short changelog from `git log d5e9d0f..`. Pins for the next opencode version go in `scripts/opencode-checksums.json` when the sidecar is bumped.
4. Interface edges below: a lighter appearance menu, the 6-line floor on very short windows, the three line-height estimates the CSS does not state.
5. Housekeeping: `calls` and `turns` growth, the transitional `Frame` index signature, the plate store's old `@local-…` keys.

## Before the first signed public release

Closed on 2026-10-14: all six 2.0.28 archives are pinned since `1c9b681` (the README "Bundled press" section says so), and the CSP was confirmed in the packaged app (`docs/e2e.md` row 20). A new opencode version still needs its pins.

- The first CI runs on the private remote (2026-10-14) found and fixed two Windows faults in `fetch-opencode.mjs` (`70f0878`, `b2caae1`: the staged binary had no `.exe`); all three desktop bundles now build. The on-demand Intel job was run the same day and passed: the x86_64 archive verified against its pin and the Intel app and dmg bundled.

## Book

- A delta missed during a stream reconnect leaves a hole until `session.text.ended` heals it (the reducer now sets early parts in order; the gap is the stream's).
- `shownProse` hides a streaming part only while it is inside an unclosed `<think>`; a reply that begins with another tag is shown as sent.

## State and engine

- A held stream opens the restart gate, except after more than five restarts in two minutes, when restarts stay at least ten seconds apart.
- Plate store: the old `@local-…` key of a renamed plate stays in storage until the cap clears it.
- `calls` and `turns` on a chapter grow without bound; the transitional `Frame` index signature and `EventFrame.properties` remain.
- A press that answers `/api/info` but never holds a stream is retried at the 60 s cap forever, by design.

## Press host

- A live press that does not answer `/api/info` within 2 s to connect and 4 s to read is killed and replaced on attach; a press blocked that long on heavy work would be restarted.
- Quit waits up to 1.5 s for the press to leave on its stdin before killing it; that wait is on the main thread.
- `press::stop` can return while a concurrent attach is still starting a child (up to 30 s); that press is shut down once the attach returns, or dies when stdin closes on exit.

## Interface

- The ask toggle's "the press will ask before it writes" hint reads the chapter's own rules; forms are not counted in the page foot (the foot scrolls instead).
- A page always gets at least 6 prose lines, so on a very short window (under about 410px tall) the page counts room the sheet does not have, and a quill page there cannot fit its quill.
- The CSS mirror test (`scripts/page-css.test.mjs`) does not cover `.line`'s height, and `RUNNING_LINE`, `FOLIO_LINE` and `HINT_LINE` are estimates of the face's normal line height that no CSS states.
- Reduced motion was verified in the browser on 2026-10-15 with Playwright emulation: turns fade without a curl, plates lay and fold without travel, the menu pops at once, and the curl is unchanged without it.
- The appearance menu now opens in the pane above the themes and lengthens the card while open; a lighter way to keep every swatch in sight may be wanted.

## Docs

- `docs/e2e.md` and `docs/plans/2026-10-14-mvp.md` name the scratchpad folders of the runs that made them; they are history and are left as they are.
