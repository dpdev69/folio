# Follow-ups

Collected from the per-task and final reviews. None blocks a session; each is a deferred improvement. The list from the 0.2.0 MVP pass (2026-10-14) was worked through the same day in six commits (`1c51c34` press host, `3db2ab0` fetch and release, `9ed8721` book, `07fb6b1` state, `b157fb9` motion, `e6fb044` wiring); what remains of it is below, with what those passes turned up.

## Before the first signed public release

Closed on 2026-10-14: all six 2.0.28 archives are pinned since `1c9b681` (the README "Bundled press" section says so), and the CSP was confirmed in the packaged app (`docs/e2e.md` row 20). A new opencode version still needs its pins.

- The on-demand Intel job in `build.yml` (`workflow_dispatch`, `intel`) has not been run.
- The PowerShell unzip quoting is covered by unit tests only; run `npm run fetch-press` once on Windows.

## Book

- Multi-edit turns: when a turn has two plates for one file and a plate holds no patch of its own, it still shows the combined turn lines (Reject already refuses it). A `diff-<file>` plate's patch is frozen at the first scoped diff.
- A delta missed during a stream reconnect leaves a hole until `session.text.ended` heals it (the reducer now sets early parts in order; the gap is the stream's).
- `shownProse` hides a streaming part only while it is inside an unclosed `<think>`; a reply that begins with another tag is shown as sent.

## State and engine

- A Reject in flight can stick: if the prompt reply renames `diff-<file>@local-…` while that Reject is running, the status write misses and the plate reads "Restoring the file…" until a reload. The window is a few hundred milliseconds.
- If `restartPress` is in flight while `preparePress` switches presses, the old restart's client can still be adopted.
- A press whose stream holds longer than 2 s and then drops resets the backoff every cycle and is restarted each time; the rule that a held stream opens the gate is kept on purpose.
- Plate store: the old `@local-…` key of a renamed plate stays in storage until the cap clears it.
- Two paragraphs with the same text but different marks evict each other in the wrap cache (time only, not correctness).
- `calls` and `turns` on a chapter grow without bound; the transitional `Frame` index signature and `EventFrame.properties` remain.
- The restart backoff (3 s doubling to 60 s) resets on a steady stream; a press that answers `/api/info` but never holds a stream is retried at the cap forever, by design.

## Press host

- A live press that does not answer `/api/info` within 2 s to connect and 4 s to read is killed and replaced on attach; a press blocked that long on heavy work would be restarted.
- Quit waits up to 1.5 s for the press to leave on its stdin before killing it; that wait is on the main thread.
- `press::stop` can return while a concurrent attach is still starting a child (up to 30 s); that press is shut down once the attach returns, or dies when stdin closes on exit.

## Interface

- The ask toggle's "the press will ask before it writes" hint reads the chapter's own rules; ask titles keep raw paths; forms are not counted in the page foot (the foot scrolls instead).
- `platesOnSpread` uses only the left page's chapter; option descriptions in forms appear only in the title attribute.
- The search card stays open after a jump to a hit; the appearance menu covers the Quiet and Paper swatches while it is open.
- Reduced motion was checked by reading the CSS, not in a browser (the tools cannot emulate it).

## Docs

- `docs/e2e.md` and `docs/plans/2026-10-14-mvp.md` name the scratchpad folders of the runs that made them; they are history and are left as they are.
