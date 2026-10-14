# Follow-ups

Collected from the per-task and final reviews. None blocks a session; each is a deferred improvement. The list from the 0.2.0 MVP pass (2026-10-14) was worked through the same day in six commits (`1c51c34` press host, `3db2ab0` fetch and release, `9ed8721` book, `07fb6b1` state, `b157fb9` motion, `e6fb044` wiring); what remains of it is below, with what those passes turned up.

## Before the first signed public release

Closed on 2026-10-14: all six 2.0.28 archives are pinned since `1c9b681` (the README "Bundled press" section says so), and the CSP was confirmed in the packaged app (`docs/e2e.md` row 20). A new opencode version still needs its pins.

- The first CI runs on the private remote (2026-10-14) found and fixed two Windows faults in `fetch-opencode.mjs` (`70f0878`, `b2caae1`: the staged binary had no `.exe`); all three desktop bundles now build. The on-demand Intel job was run the same day; see its run for the result.

## Book

- A delta missed during a stream reconnect leaves a hole until `session.text.ended` heals it (the reducer now sets early parts in order; the gap is the stream's).
- `shownProse` hides a streaming part only while it is inside an unclosed `<think>`; a reply that begins with another tag is shown as sent.

## State and engine

- A Reject in flight can stick: if the prompt reply renames `diff-<file>@local-…` while that Reject is running, the status write misses and the plate reads "Restoring the file…" until a reload. The window is a few hundred milliseconds.
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
- Reduced motion was verified in the browser on 2026-10-15 with Playwright emulation: turns fade without a curl, plates lay and fold without travel, the menu pops at once, and the curl is unchanged without it.
- The appearance menu now opens in the pane above the themes and lengthens the card while open; a lighter way to keep every swatch in sight may be wanted.

## Docs

- `docs/e2e.md` and `docs/plans/2026-10-14-mvp.md` name the scratchpad folders of the runs that made them; they are history and are left as they are.
