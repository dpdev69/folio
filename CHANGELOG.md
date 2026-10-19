# Changelog

## 0.3.0 (2026-10-20)

The first public release. Folio is now open source under the MIT license.

- Bundles opencode 2.0.32 (was 2.0.28), with the six release archives pinned by SHA-256. The 2.0.28 to 2.0.32 API change is additive; a live run against 2.0.32 passed.
- Chapters are named by opencode from what you asked. Folio used to create sessions titled "Untitled", which stopped opencode from naming them.
- A drop cap opens a chapter only when the paragraph starts with a letter or digit and runs at least as many lines as the cap is tall.
- Footnote marks read as marks: runs collapse to "3–7", and the numbers no longer stretch the line they sit on.
- Your words in ink are set ragged right, even when the theme justifies text.
- Questions from opencode show their Markdown (italics, code) instead of the raw asterisks.
- A code-mode script reads "Ran a script." in its footnote.
- Reject in flight: rejecting a plate while opencode is still finishing the turn no longer loses the plate when its id changes.
- The drop cap is whole. It hung below its one-line box and was cut off, so an "I" could read as a "T".
- Reject on a plate whose turn opencode hasn't named yet says to try again in a moment, instead of reading as final.

### Install

Download from the assets below. The builds are not code-signed yet.

- **macOS 12 or later** (`Folio_0.3.0_aarch64.dmg` for Apple silicon, `Folio_0.3.0_x64.dmg` for Intel): drag Folio to Applications and open it. When macOS says it can't check the app, open System Settings → Privacy & Security and click **Open Anyway**. If macOS says Folio is damaged, run `xattr -dr com.apple.quarantine /Applications/Folio.app` in Terminal and open it again.
- **Windows 10 or later** (`Folio_0.3.0_x64-setup.exe` or `Folio_0.3.0_x64_en-US.msi`): run the installer. If SmartScreen stops it, click **More info**, then **Run anyway**.
- **Linux x86_64** (`Folio_0.3.0_amd64.deb` or `Folio_0.3.0_amd64.AppImage`): `sudo apt install ./Folio_0.3.0_amd64.deb`, or make the AppImage executable and run it.

`SHA256SUMS.txt` lists a digest for every file.

## 0.2.0 (2026-10-14)

The first complete build: the book, chapters, footnotes, plates with Accept, Revise, Reject and Fold back, margin notes, ask before the press writes, questions as forms, six themes, the bundled press (opencode 2.0.28), and desktop bundles for macOS, Windows and Linux.
