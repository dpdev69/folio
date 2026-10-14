# Live end-to-end run

Run on 2026-10-14 against opencode 2.0.28 (`/Applications/OpenCode.app/Contents/Resources/opencode-cli`,
isolated state under `<repo>/.folio/press`), the dev app at http://127.0.0.1:47321 driven through the
built-in browser at a 1280×820 viewport, and a scratch repository `greeter` (a small TypeScript program:
`src/greet.ts`, `src/shout.ts`, `src/index.ts`, `package.json`, `README.md`; one commit). Model: the
press's default (`cat-jam-free`) answered 410, so `Big Pickle` was chosen from the menu.

Screenshots are under
`/private/tmp/claude-501/-Users-me-folio/e9197d91-01d7-4355-b22f-541229eaf5c7/scratchpad/e2e/`
(`e2e/` below). Commits named in a row are the fixes made for that step during the run.

| # | Step | Expected | Observed | Screenshot | Verdict |
|---|------|----------|----------|------------|---------|
| 1 | Title page | Detects the press, names the model | "The press is ready. Using opencode 2.0.28 · OpenCode Zen, exo-free" (a later start named cat-jam-free; the press's default varies) | `e2e/01-title.jpg` | Pass |
| 2 | Open a folder | Path field in dev opens the book | Book `greeter` opens on Chapter I | `e2e/02-first-chapter.jpg` | Pass |
| 3 | First chapter | First-page note and quill | Note on the left page, quill on the right | `e2e/02-first-chapter.jpg` | Pass |
| 4 | Default model gone | 410 is said plainly and the menu offers models | Banner "That model is no longer offered. Choose another from the menu."; the banner opens the model list; Big Pickle chosen | `e2e/03-model-gone.jpg` | Pass |
| 4a | Model after reload | The chosen model is still in use | It was not: the title page and every new chapter went back to cat-jam-free (410). Fixed in `865e3a1`; after the fix a reload reads "set in Big Pickle" | `e2e/14-model-remembered.jpg` | Fixed |
| 5 | First prompt streams | "Add a farewell(name) function next to greet in src/greet.ts and explain briefly"; no line of an earlier page moves | A page recorder sampled every visible page's lines each 100 ms through the whole turn: page 1 had 4 versions, page 2 three, page 3 one; zero changes to any line but a page's last. Screenshots at three moments | `e2e/04a-stream-sent.jpg`, `e2e/04b-stream-tools.jpg`, `e2e/04c-stream-done.jpg` | Pass |
| 6 | Read and edit footnotes | Plain sentences, relative paths, prose never hidden by the foot | "Read src/greet.ts." and "Edited src/greet.ts, 5 lines added. See Plate I →"; the page with both footnotes and the slip held 10 prose lines (13 less 3) and nothing was cut off | `e2e/05-footnotes.jpg` | Pass |
| 7 | Plate | The real patch | Plate I shows `greet.ts` with the five added lines from the press's patch | `e2e/06-plate.jpg` | Pass |
| 8 | Accept | Plate settles | "Set in the repository."; `folio.plates.<session>` holds `{status: "accepted"}`; after a reload and reopening the folder the plate still reads "Set in the repository." | `e2e/07-accepted.jpg`, `e2e/08-reload-keeps-accept.jpg` | Pass |
| 9 | Prompt editing two files | Two plates, footnotes for each call | Plates II (`shout.ts`) and III (`index.ts`), six footnotes, one slip "Plates II and III face this page". Shell footnotes read "…ls. {." and "…Hello, Ada.." and one reprinted a 200-character inline script over four lines; fixed in `d060052` | `e2e/09-two-file-footnotes.jpg`, `e2e/10-two-file-done.jpg` | Pass (wording fixed) |
| 10 | Reject one plate | File restored on disk, model told | Plate III reads "Reverted."; `src/index.ts` is back to its committed text (`git diff --stat`: only greet.ts and shout.ts changed); `POST /api/session/…/synthetic` 200; the model's next reply begins "Understood. I've left src/index.ts exactly as the reader restored it" | `e2e/11-reject.jpg` | Pass |
| 11 | Margin note | Highlight, note, reply in the margin | Selecting a line opens the marginalia; the question and the reply appear there. The reply ran past the sheet and hid "Replace passage · keep both"; fixed in `d10bcfa` (the margin scrolls). Big Pickle sent its reasoning as a plain text part (the press stores it as `type: "text"`), so the reply begins with that reasoning | `e2e/12a-margin-reply-clipped.jpg`, `e2e/12b-margin-reply-scrolls.jpg` | Fixed |
| 12 | Turn past the end | A new chapter is created and opened | The session was created (Contents listed Chapter II) but the book did not turn, and the old last page lost its quill. The press's `session.created` frame laid the chapter out before the create call returned, so the jump (a ref) never ran. Fixed in `ea3838a`; Chapter III then opened on its own spread | `e2e/13a-new-chapter-no-turn.jpg`, `e2e/13b-new-chapter.jpg` | Fixed |
| 13 | Ask before the press writes | New chapter asks; the ask shows the patch; Allow once applies it | "May I edit src/shout.ts?" at the page foot and over the plate with the proposed patch; the file was unchanged until Allow once, then had the new comment. The menu stayed open over the page (fixed in `d4e34fa`) and the plate numbered added lines by the new file and kept lines by the old one (1, 2, 1, 2…; fixed in `a671459`) | `e2e/15-ask-with-patch.jpg`, `e2e/16-allowed.jpg`, `e2e/17-plate-numbers.jpg` | Pass (two fixes) |
| 14 | Question tool | "Ask me which language greet should use before changing it" gives a form; answering sends it | Form "Greeting language" with Keep English, Spanish, French, German and a line of one's own; French sent (`POST …/form/…/reply` 204); footnote "Asked a question: Which language should greet (and farewell) use?". The provider then failed the next step: "Provider request failed with HTTP 400: {"model":"big-pickle"}" (upstream; the banner shows the raw text) | `e2e/18-question-form.jpg`, `e2e/19-question-answered.jpg` | Pass (provider error after) |
| 15 | Stop | The run stops and what was set stays | Stopped once while the model was thinking and once mid-sentence ("…as though it too were listening. The lamp"); the press's history records `outcome: "interrupted"` both times. The stop link is remounted on every page turn while text streams quickly, so two clicks by reference went stale; the mid-prose stop was clicked from a page script the moment the link was present | `e2e/20a-stop-while-thinking.jpg`, `e2e/20b-stop-mid-prose.jpg` | Pass |
| 16 | Kill the press | Paused notice, the host starts a new press, the chapter resyncs | `kill` of the dev host's `opencode-cli serve --stdio` child: a banner recorder saw "The event stream paused. Folio will listen again." about 1 s later and cleared it about 3 s after that, when the hook's restart path had a new press (new pid, new port) and read every chapter again (messages, diff, permission, form). Done twice. A new prompt then got its reply. The banner was up too briefly for a screenshot; the recorder is the evidence | `e2e/21-after-restart.jpg` | Pass |
| 17 | Tauri shell: spawn | The app starts its own press | `npm run tauri dev` built and ran `target/debug/folio`; it spawned `src-tauri/target/debug/opencode-cli serve --stdio --hostname 127.0.0.1 --port 0` as its child (the sidecar copied by `npm run fetch-press`, not a machine binary), listening on 127.0.0.1 | none (native window) | Pass |
| 18 | Tauri shell: first prompt | Same as step 5 in the native window | Not verified: the native window cannot be driven or captured from this environment, and a browser tab on the dev URL would use the dev host, not the Tauri path | none | Not verified |
| 19 | Tauri shell: close | The press dies with Folio | `osascript -e 'quit app "Folio"'` (and `"folio"`) did nothing for the unbundled dev binary; `kill -TERM` of `folio` ended it, and within 4 s no `opencode-cli serve` from the worktree remained and its port was closed; `tauri dev` exited 0. Whether the press stopped through `RunEvent::Exit` or on its closed stdin was not distinguished | none | Pass (by signal, not window close) |

## Notes

- Defect fixes routed into this run: footnote paths from the book's root (`078ad9b`), room at the page foot
  for footnotes and the slip (`030d264`), plate decisions kept across a reload (`0e9fc5c`). Steps 6 and 8
  are their live checks.
- In the dev worktree Vite refuses the `@fontsource` files that live in the main checkout's `node_modules`
  (403, outside the serving allow list); the page falls back to Palatino. This is a worktree quirk.
- "Ask before the press writes" applies to chapters opened after it is turned on, but the quill's hint says
  "the press will ask before it writes" on the chapter already open too, and the setting is not kept across
  a reload. Not changed in this run.
- Big Pickle sometimes leaves `</think>` at the start of a reply ("</think>The press is back."); Folio sets
  what the press sends.
