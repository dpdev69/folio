import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEvent, appendPrompt, MODEL_GONE, noteSent, renameBlock } from "../book/events";
import { paginateBook, type LaidPage } from "../book/paginate";
import { chapterRoman, displayTitle, findPlate, isUntitled, type Book, type Chapter, type Plate } from "../book/model";
import { SAMPLE_BREAKS, SAMPLE_DRAFT, sampleBook, sampleNoteReply, sampleReply } from "../book/sample";
import { composeNote } from "../book/notes";
import { revealNextLine, type Measure } from "../book/wrap";
import type { EngineClient, FormAnswer, ModelRef } from "../engine/client";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { followTail, initialNav, reduceNav, relocate, type Nav } from "./nav";
import { save as savePlates, withKeptPlates } from "./plateStore";
import { DEFAULT_SCALE_INDEX, SCALES, footChars, footFont, footReserve, inkFont, layoutScale, proseFont } from "../ui/scales";
import { useViewport } from "../ui/useViewport";
import { useSettings } from "./useSettings";
import {
  applyAskRules,
  ASK_RULES,
  DECLINE_MESSAGE,
  loadAskBeforeWrite,
  saveAskBeforeWrite,
  isTauri,
  isLocalId,
  lastInkId,
  loadBook,
  messageOf,
  openChapter,
  revertPlate,
  createsFile,
  turnDiff,
} from "./press";
import { ensureFirstPage } from "./resync";
import { usePress } from "./usePress";
import { useStream } from "./useStream";

export type { EngineState } from "./usePress";

/** Said when a question cannot reach the press; it stays where it is. */
export const NOT_ANSWERING = "The press is not answering, so the question waits here until it does.";
/** How often, and how many times, a stale diff waits for its turn to be named. */
const DIFF_WAIT_MS = 300;
const DIFF_WAIT_TRIES = 20;

export function useFolio() {
  const [book, setBook] = useState<Book | null>(null);
  const [nav, setNav] = useState<Nav>({ ...initialNav(), view: "desk" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [askBeforeWrite, setAskBeforeWrite] = useState(() => loadAskBeforeWrite());
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<number | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [showPath, setShowPath] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const streamRef = useRef<number | null>(null);
  // The chapter to turn to once it is laid out. State, not a ref: the chapter may be laid out
  // before the jump is asked for (its session.created frame can beat the create call's reply).
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const diffTimers = useRef(new Map<string, number>());
  // A chapter being opened; a second turn past the last spread meanwhile must not open another.
  const creatingRef = useRef(false);
  const bookRef = useRef<Book | null>(null);
  bookRef.current = book;
  const seenErrors = useRef(new Map<string, string>());
  // The open book's stream, and the press behind it.
  const stream = useStream({ setBook, bookRef, setNotice, onFailing: () => void pressing.restartPress() });
  const pressing = usePress({
    setNotice,
    isPaused: () => stream.isPaused(),
    onDetach: () => stream.stop(),
    onAttached: (client) => {
      const current = bookRef.current;
      if (!current || current.sample) return;
      client.useDirectory(current.directory);
      const signal = stream.listen(client);
      void stream.resync(client, signal);
    },
  });
  const { clientRef, press, engineState, setEngineState, engineVersion, models, model, providers } = pressing;
  const editBook = stream.editBook;
  const { settings, dispatch: setSettings, theme, appearance } = useSettings();
  const { scaleIndex, lineSpacing, margins } = settings;
  const viewport = useViewport();
  const scale = useMemo(
    () => layoutScale(SCALES[scaleIndex] ?? SCALES[DEFAULT_SCALE_INDEX], { lineSpacing, margins, viewport }, theme),
    [scaleIndex, lineSpacing, margins, theme, viewport],
  );
  const [faceEpoch, setFaceEpoch] = useState(0);

  useEffect(() => {
    // A weight or face the page has not used yet is not loaded; fetch it, then measure again.
    // A face already loaded measures the same; only a newly loaded one re-wraps the book.
    let live = true;
    const font = proseFont(scale, theme);
    let loaded = false;
    try {
      loaded = document.fonts.check(font);
    } catch {
      loaded = false;
    }
    document.fonts
      .load(font)
      .then(() => {
        if (live && !loaded) setFaceEpoch((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // The font string only changes with the theme; size steps share the loaded face.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    document.fonts.ready.then(() => setFontsReady(true)).catch(() => setFontsReady(true));
    const params = new URLSearchParams(window.location.search);
    if (params.get("sample") === "1") {
      const spread = params.get("spread");
      openSample(spread == null ? undefined : Number(spread));
    } else {
      void pressing.preparePress();
    }
    return () => media.removeEventListener("change", apply);
    // The query param is read once, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measure = useCallback(
    (text: string, voice: "prose" | "ink" = "prose"): number => {
      if (!fontsReady) return text.length * (voice === "ink" ? scale.inkSize * 0.45 : scale.fontSize * 0.46);
      const canvas = measureCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) return text.length * 8;
      ctx.font = voice === "ink" ? inkFont(scale) : proseFont(scale, theme);
      return ctx.measureText(text).width;
    },
    // faceEpoch re-creates the measurer once a newly chosen face has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontsReady, scale, theme, faceEpoch],
  );

  // Stable per font and scale, so wrapped lines are found again on the next layout.
  const measures = useMemo(() => {
    const prose: Measure = (text) => measure(text, "prose");
    const ink: Measure = (text) => measure(text, "ink");
    return { prose, ink };
  }, [measure]);

  // The foot's own type, measured once per face, sets how many characters a footnote line holds.
  const footLines = useMemo(() => {
    const sample = "Edited src/greet.ts, 4 lines added. See Plate I.";
    const ctx = fontsReady ? measureCanvas().getContext("2d") : null;
    let average: number | undefined;
    if (ctx) {
      ctx.font = footFont(theme);
      average = ctx.measureText(sample).width / sample.length;
    }
    return footReserve(footChars(scale, average), scale.lineHeight);
    // faceEpoch measures again once a newly chosen face has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, scale, theme, faceEpoch]);

  const layout = useMemo(() => {
    if (!book) return { pages: [] as LaidPage[], chapterStart: {} as Record<string, number> };
    return paginateBook(book.chapters, {
      measure: measures.prose,
      inkMeasure: measures.ink,
      width: scale.width,
      linesPerPage: scale.lines,
      quillLines: scale.quillLines,
      pageRoom: scale.pageRoom,
      inkWeight: scale.inkWeight,
      gapWeight: scale.gapWeight,
      dropLines: scale.dropLines,
      dropWidth: scale.dropWidth,
      footLines,
      breaks: book.sample ? SAMPLE_BREAKS : undefined,
    });
  }, [book, measures, scale, footLines]);

  const spreadCount = Math.max(1, Math.ceil(layout.pages.length / 2));

  useEffect(() => {
    const id = jumpTo;
    if (!fontsReady || !id || layout.chapterStart[id] == null) return;
    setJumpTo(null);
    const spread = Math.floor(layout.chapterStart[id] / 2);
    setNav((current) => {
      if (current.view === "reading" && current.spread === spread && !current.curl) return current;
      return { ...current, view: "reading", margin: false, curl: { to: spread, forward: spread >= current.spread } };
    });
  }, [layout.chapterStart, fontsReady, jumpTo]);

  // The last layout, and what it was laid with: a change of type or window lays every page again.
  const prevLayout = useRef<{ pages: LaidPage[]; measures: typeof measures; scale: typeof scale; footLines: typeof footLines } | null>(null);
  useEffect(() => {
    const before = prevLayout.current;
    prevLayout.current = { pages: layout.pages, measures, scale, footLines };
    if (!book || !before || before.pages.length === 0) return;
    const relaid = before.measures !== measures || before.scale !== scale || before.footLines !== footLines;
    const filled = (pages: LaidPage[]) => pages.map((page) => page.lines.length > 0 || page.footnotes.length > 0);
    const ids = (pages: LaidPage[]) => pages.map((page) => page.chapterId);
    const last = Math.max(0, Math.ceil(layout.pages.length / 2) - 1);
    setNav((current) => {
      if (relaid) {
        // Keep the reader on the line they were reading, not on a spread number the new layout gave other lines.
        if (current.curl) {
          // A turn under way lands where its own spread's lines went.
          const to = relocate(before.pages, layout.pages, current.curl.to);
          return to === current.curl.to ? current : { ...current, curl: { ...current.curl, to } };
        }
        const to = relocate(before.pages, layout.pages, current.spread);
        return to === current.spread ? current : { ...current, spread: to };
      }
      if (current.curl) return current;
      if (current.spread > last) return { ...current, spread: last };
      if (current.view !== "reading") return current;
      const to = followTail(ids(before.pages), ids(layout.pages), current.spread, filled(before.pages), filled(layout.pages));
      return to == null ? current : { ...current, curl: { to, forward: true } };
    });
  }, [layout.pages, book, measures, scale, footLines]);

  useEffect(() => {
    const client = clientRef.current;
    if (!book || book.sample || !client) return;
    for (const chapter of book.chapters) {
      if (!chapter.diffStale || diffTimers.current.has(chapter.id)) continue;
      const fetchDiff = (tries: number) => {
        const latest = bookRef.current?.chapters.find((item) => item.id === chapter.id);
        if (!latest) {
          diffTimers.current.delete(chapter.id);
          return;
        }
        // The turn whose finished step made the diff stale, else the chapter's latest.
        const turn = stream.staleTurn(latest) ?? lastInkId(latest);
        // A turn the press has not named yet cannot be asked about; wait for its name a while.
        if (isLocalId(turn) && tries < DIFF_WAIT_TRIES) {
          diffTimers.current.set(chapter.id, window.setTimeout(() => fetchDiff(tries + 1), DIFF_WAIT_MS));
          return;
        }
        stream.clearStaleTurn(chapter.id);
        turnDiff(client, latest, turn)
          // An empty diff still marks the chapter fresh, so a failure is not retried in a loop.
          .catch(() => ({ type: "folio.diff", data: { sessionID: chapter.id, diff: [] } }))
          .then((frame) => {
            diffTimers.current.delete(chapter.id);
            editBook((current) => (current && !current.sample ? applyEvent(current, frame) : current));
          });
      };
      diffTimers.current.set(chapter.id, window.setTimeout(() => fetchDiff(0), DIFF_WAIT_MS));
    }
  }, [book]);

  // Keep what the reader decided about each plate, so a reload finds it as it was left.
  const savedPlates = useRef(new Map<string, string>());
  useEffect(() => {
    if (!book || book.sample) return;
    for (const chapter of book.chapters) {
      if (!chapter.plates.length) continue;
      const signature = chapter.plates.map((plate) => `${plate.id}:${plate.status}:${plate.folded}`).join("|");
      if (savedPlates.current.get(chapter.id) === signature) continue;
      savedPlates.current.set(chapter.id, signature);
      savePlates(chapter.id, chapter.plates);
    }
  }, [book]);

  // The model list lives in the menu; it closes with it.
  useEffect(() => {
    if (!menuOpen) setModelsOpen(false);
  }, [menuOpen]);

  // chapter.error is not set on the page; say it once in the banner.
  useEffect(() => {
    if (!book || book.sample) return;
    for (const chapter of book.chapters) {
      if (!chapter.error) {
        seenErrors.current.delete(chapter.id);
      } else if (seenErrors.current.get(chapter.id) !== chapter.error) {
        seenErrors.current.set(chapter.id, chapter.error);
        const plain = chapter.error === MODEL_GONE || chapter.error.startsWith("The press");
        setNotice(plain ? chapter.error : `The press stopped: ${chapter.error}`);
      }
    }
  }, [book]);

  function stopStream() {
    if (streamRef.current != null) window.clearTimeout(streamRef.current);
    streamRef.current = null;
  }

  function openSample(spread?: number) {
    // The press stays attached; only the book's stream stops.
    stream.stop();
    stopStream();
    const next = sampleBook();
    setBook(next);
    setDrafts({ "ch-iv": SAMPLE_DRAFT });
    setNotice(null);
    setShowPath(false);
    setMenuOpen(false);
    if (spread != null && Number.isFinite(spread)) {
      setNav(initialNav(spread));
      return;
    }
    setJumpTo("ch-iv");
    setNav(initialNav(0));
  }

  async function beginOpenFolder() {
    setMenuOpen(false);
    if (isTauri()) {
      try {
        const dialog = await import("@tauri-apps/plugin-dialog");
        const picked = await dialog.open({ directory: true, multiple: false, title: "Open a repository" });
        if (typeof picked === "string") void connect(picked);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The folder dialog could not open.");
        setShowPath(true);
      }
      return;
    }
    setShowPath(true);
    setNav((current) => ({ ...current, view: "desk" }));
  }

  async function connect(directory: string) {
    const folder = directory.trim();
    if (!folder) return;
    const client = clientRef.current;
    if (!client) {
      setNotice("The press is not ready yet. Wait for the title page to say so, then open the folder.");
      return;
    }
    setEngineState("connecting");
    setNotice(null);
    const license = await uncheckedLicense.check();
    if (licenseBlocks(license)) {
      setEngineState("error");
      setNotice("This copy of Folio is not licensed.");
      return;
    }
    stream.stop();
    stopStream();
    try {
      const said: string[] = [];
      const next = withKeptPlates(await loadBook(client, folder, { askBeforeWrite, model, onNotice: (n) => said.push(n) }));
      // Providers, models and keys are asked about for this book from now on.
      client.useDirectory(folder);
      // Errors already in the history are old news.
      seenErrors.current = new Map(next.chapters.flatMap((c) => (c.error ? [[c.id, c.error] as const] : [])));
      stream.listen(client);
      setBook(ensureFirstPage(next));
      setDrafts({});
      setEngineState("ready");
      setShowPath(false);
      const last = next.chapters[next.chapters.length - 1];
      setJumpTo(last?.id ?? null);
      setNav(initialNav(0));
      setNotice(said[said.length - 1] ?? null);
    } catch (error) {
      setEngineState("error");
      setNotice(messageOf(error, "Folio could not open that folder with the press."));
    }
  }

  function updateChapter(id: string, edit: (chapter: Chapter) => Chapter) {
    editBook((current) => {
      if (!current) return current;
      return { ...current, chapters: current.chapters.map((chapter) => (chapter.id === id ? edit(chapter) : chapter)) };
    });
  }

  const chapterForSpread = useCallback(
    (spread: number): Chapter | undefined => {
      const page = layout.pages[spread * 2];
      return book?.chapters.find((chapter) => chapter.id === page?.chapterId);
    },
    [book, layout.pages],
  );

  function sendQuill(text: string) {
    const chapter = chapterForSpread(nav.spread);
    if (!book || !chapter || !text.trim()) return;
    if (chapter.busy) {
      setNotice("The press is still writing this chapter.");
      return;
    }
    clearDraft(chapter.id);
    setNotice(null);
    if (book.sample) {
      const userId = `ink-${Date.now()}`;
      const replyId = `reply-${Date.now()}`;
      const full = sampleReply(text);
      updateChapter(chapter.id, (current) => ({
        ...current,
        busy: true,
        blocks: [
          ...current.blocks,
          { id: userId, voice: "ink", text: text.trim() },
          { id: replyId, voice: "prose", text: "" },
        ],
      }));
      streamInto(chapter.id, replyId, full);
      return;
    }
    const localId = `local-${Date.now()}`;
    updateChapter(chapter.id, (current) => appendPrompt(current, text.trim(), localId));
    void sendPrompt(chapter.id, text.trim(), localId, "The prompt was not accepted.");
  }

  /**
   * Send a prompt. The press answers with the user message id; the ink line
   * set as `local-…` takes that name (the stream usually renames it first).
   */
  async function sendPrompt(chapterId: string, text: string, localId: string | null, failure: string): Promise<string | null> {
    const client = clientRef.current;
    if (!client) {
      setNotice("The press is not attached.");
      updateChapter(chapterId, (current) => ({ ...current, busy: false }));
      return null;
    }
    try {
      const id = await client.prompt(chapterId, text);
      if (localId) {
        // renameBlock also renames the turn's diff plates (diff-<file>@local-… → @<id>); the plate store
        // saves them under the new id on the next book change, and an open plate follows its new id.
        updateChapter(chapterId, (current) => renameBlock(current, localId, id));
        setNav((current) => {
          const open = current.plateOpen;
          return open?.endsWith(`@${localId}`) ? { ...current, plateOpen: `${open.slice(0, -localId.length)}${id}` } : current;
        });
      }
      return id;
    } catch (error) {
      setNotice(messageOf(error, failure));
      updateChapter(chapterId, (current) => ({ ...current, busy: false }));
      return null;
    }
  }

  function streamInto(chapterId: string, blockId: string, full: string, marginal = false) {
    let shown = "";
    const step = () => {
      shown = revealNextLine(full, shown, (text) => measure(text, "prose"), scale.width);
      const done = shown.length >= full.length;
      updateChapter(chapterId, (current) => ({
        ...current,
        busy: !done,
        blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, text: shown.trim() } : block)),
        notes: marginal
          ? current.notes.map((note) => (note.pending ? { ...note, reply: shown.trim(), pending: !done } : note))
          : current.notes,
      }));
      if (!done) streamRef.current = window.setTimeout(step, reduced ? 0 : 42);
    };
    step();
  }

  function sendNote(quote: string, prompt: string) {
    const chapter = chapterForSpread(nav.spread);
    if (!book || !chapter || !quote.trim() || !prompt.trim()) return;
    // A note sent mid-turn would be steered into the turn and take its next words as a reply.
    if (chapter.busy) {
      setNotice("The press is still writing this chapter.");
      return;
    }
    const noteId = `note-${Date.now()}`;
    const composed = composeNote(quote, prompt);
    updateChapter(chapter.id, (current) => ({
      ...current,
      notes: [...current.notes, { id: noteId, quote: quote.trim(), prompt: prompt.trim(), pending: true }],
    }));
    setNav((current) => ({ ...current, margin: true }));
    setSelection(null);
    setNoteDraft("");
    if (book.sample) {
      const replyId = `margin-${noteId}`;
      updateChapter(chapter.id, (current) => ({
        ...current,
        blocks: [...current.blocks, { id: replyId, voice: "prose", text: "", marginal: true }],
      }));
      streamInto(chapter.id, replyId, sampleNoteReply(prompt), true);
      return;
    }
    void sendPrompt(chapter.id, composed, null, "The margin note was not sent.").then((id) => {
      // Only the turn this message begins writes the note's reply.
      if (id) updateChapter(chapter.id, (current) => noteSent(current, noteId, id));
      else updateChapter(chapter.id, (current) => ({ ...current, notes: current.notes.map((n) => (n.id === noteId ? { ...n, pending: false } : n)) }));
    });
  }

  function turn(forward: boolean) {
    // The nav itself is reduced against the latest state: a curl that finished (or began) since this
    // render must not be written back over. Only the new-chapter decision reads the rendered nav.
    const result = reduceNav(nav, { type: "turn", forward, spreadCount });
    setNav((current) => reduceNav(current, { type: "turn", forward, spreadCount }).nav);
    if (result.effect === "new-chapter") void createChapter();
  }

  async function createChapter() {
    if (!book || creatingRef.current) return;
    creatingRef.current = true;
    try {
      await openNewChapter(book);
    } finally {
      creatingRef.current = false;
    }
  }

  async function openNewChapter(book: Book) {
    if (book.sample) {
      const id = `local-${book.chapters.length + 1}`;
      const chapter: Chapter = {
        id,
        title: "Untitled",
        untitled: true,
        blocks: [],
        footnotes: [],
        plates: [],
        notes: [],
        asks: [],
        forms: [],
        busy: false,
      };
      // A second quick turn sees the book this one already grew, and adds nothing.
      editBook((current) =>
        current && current.chapters.length === book.chapters.length ? { ...current, chapters: [...current.chapters, chapter] } : current,
      );
      setJumpTo(id);
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    try {
      const created = await openChapter(client, book.directory, { askBeforeWrite, model, onNotice: setNotice });
      editBook((current) =>
        current
          ? applyEvent(current, {
              type: "session.created",
              data: {
                sessionID: created.id,
                title: created.title,
                location: { directory: current.directory },
                permissions: created.permissions ?? (askBeforeWrite ? ASK_RULES : []),
              },
            })
          : current,
      );
      setJumpTo(created.id);
    } catch (error) {
      setNotice(messageOf(error, "A new chapter could not be opened."));
    }
  }

  function mutatePlate(id: string, edit: (plate: Plate) => Plate) {
    editBook((current) => {
      if (!current) return current;
      return {
        ...current,
        chapters: current.chapters.map((chapter) => ({
          ...chapter,
          plates: chapter.plates.map((plate) => (plate.id === id ? edit(plate) : plate)),
        })),
      };
    });
  }

  /**
   * Undo a plate's change. The plate is "reverting" while the write is in
   * flight, and takes no other answer; it lands "reverted", or "open" again
   * with a sentence saying why not.
   */
  async function rejectPlate(id: string) {
    const found = book ? findPlate(book, id) : null;
    if (!found || found.plate.status === "reverting") return;
    if (book && !book.sample) {
      const client = clientRef.current;
      if (!client) {
        setNotice("The press is not answering, so the change was left as it is.");
        return;
      }
      const was = found.plate.status;
      mutatePlate(id, (plate) => ({ ...plate, status: "reverting" }));
      try {
        const said: string[] = [];
        const frame = await revertPlate(client, book, found.chapter, found.plate, { onNotice: (n) => said.push(n) });
        mutatePlate(id, (plate) => ({ ...plate, status: "reverted", folded: true }));
        editBook((current) => (current ? applyEvent(current, frame) : current));
        setNotice(said[0] ?? (createsFile(found.plate) ? "The new file was taken away." : "The file was restored."));
      } catch (error) {
        mutatePlate(id, (plate) => (plate.status === "reverting" ? { ...plate, status: was === "accepted" ? "accepted" : "open" } : plate));
        setNotice(messageOf(error, "The press could not undo the change."));
      }
      return;
    }
    mutatePlate(id, (plate) => ({ ...plate, status: "reverted", folded: true }));
  }

  /**
   * Ask before the press writes, or stop asking: remembered for the next
   * launch, and set on every chapter of the open book (new chapters get it
   * when they are made). Each chapter's hint reads the rules it really holds.
   */
  async function toggleAsk() {
    const on = !askBeforeWrite;
    setAskBeforeWrite(on);
    saveAskBeforeWrite(on);
    const client = clientRef.current;
    const current = bookRef.current;
    if (!client || !current || current.sample) return;
    const { done, failed } = await applyAskRules(client, current.chapters.map((c) => c.id), on);
    editBook((latest) =>
      latest && latest.id === current.id
        ? { ...latest, chapters: latest.chapters.map((c) => (done.includes(c.id) ? { ...c, askRules: on } : c)) }
        : latest,
    );
    if (failed.length) setNotice("The press did not take the new rule for every chapter; those chapters keep their old one.");
  }

  /** The press's client, or a notice saying it is not attached (the question stays where it is). */
  function attached(): EngineClient | null {
    const client = clientRef.current;
    if (!client) setNotice(NOT_ANSWERING);
    return client;
  }

  /** "Allow once", or "No" with a message so the turn goes on without the change. */
  async function answerAsk(chapterId: string, id: string, decision: "once" | "reject") {
    if (book && !book.sample) {
      const client = attached();
      if (!client) return;
      try {
        await client.permissionReply(chapterId, id, decision, decision === "reject" ? DECLINE_MESSAGE : undefined);
      } catch (error) {
        setNotice(messageOf(error, "The question was not answered."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, asks: chapter.asks.filter((ask) => ask.id !== id) }));
  }

  async function answerForm(chapterId: string, formId: string, answer: FormAnswer) {
    if (book && !book.sample) {
      const client = attached();
      if (!client) return;
      try {
        await client.formReply(chapterId, formId, answer);
      } catch (error) {
        setNotice(messageOf(error, "The answer was not sent."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, forms: chapter.forms.filter((form) => form.id !== formId) }));
  }

  async function dismissForm(chapterId: string, formId: string) {
    if (book && !book.sample) {
      const client = attached();
      if (!client) return;
      try {
        await client.formCancel(chapterId, formId, "The reader skipped this question.");
      } catch (error) {
        setNotice(messageOf(error, "The question was not set aside."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, forms: chapter.forms.filter((form) => form.id !== formId) }));
  }

  /** Use this model for the chapter in view, and for chapters opened from now on. */
  async function chooseModel(choice: ModelRef) {
    pressing.pickModel(choice);
    setMenuOpen(false);
    if (notice === MODEL_GONE) setNotice(null);
    const chapter = chapterForSpread(nav.spread);
    if (!chapter || !book || book.sample) return;
    try {
      await clientRef.current?.setSessionModel(chapter.id, choice);
    } catch (error) {
      setNotice(messageOf(error, "The press kept its model."));
    }
  }

  function replacePassage(noteId: string) {
    updateChapter(chapterForSpread(nav.spread)?.id ?? "", (chapter) => {
      const note = chapter.notes.find((item) => item.id === noteId);
      if (!note?.reply) return chapter;
      return {
        ...chapter,
        blocks: chapter.blocks.map((block) =>
          block.text.includes(note.quote) ? { ...block, text: block.text.replace(note.quote, note.reply!) } : block,
        ),
        notes: chapter.notes.map((item) => (item.id === noteId ? { ...item, replaced: true } : item)),
      };
    });
  }

  function clearDraft(id: string) {
    setDrafts((prev) => ({ ...prev, [id]: "" }));
  }
  function putDraft(id: string, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  }

  /** Open the key form on the title page. It is never required; the free provider works without one. */
  async function showProviderForm() {
    setMenuOpen(false);
    setNav((current) => ({ ...current, view: "desk" }));
    await pressing.showProviderForm();
  }

  const activeId = chapterForSpread(nav.spread)?.id;
  const draft = activeId ? (drafts[activeId] ?? "") : "";
  const setDraft = (value: string) => {
    if (!activeId) return;
    putDraft(activeId, value);
  };

  const searchHits = book
    ? book.chapters.flatMap((chapter) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return [];
        const spread = Math.floor((layout.chapterStart[chapter.id] ?? 0) / 2);
        const titleHit = chapter.title.toLowerCase().includes(needle);
        const bodyHit = chapter.blocks.find((block) => block.text.toLowerCase().includes(needle));
        if (!titleHit && !bodyHit) return [];
        return [{ id: chapter.id, label: displayTitle(chapter), spread }];
      })
    : [];

  const engineLabel = book?.sample
    ? "Sample press"
    : engineState === "ready"
      ? `opencode ${engineVersion ?? ""}`.trim()
      : engineState === "connecting"
        ? "Looking for the press…"
        : "opencode is not attached";

  return {
    book,
    nav,
    pages: layout.pages,
    chapterStart: layout.chapterStart,
    spreadCount,
    draft,
    setDraft,
    noteDraft,
    setNoteDraft,
    selection,
    scaleIndex,
    scale,
    settings,
    setSettings,
    theme,
    appearance,
    askBeforeWrite,
    toggleAsk: () => void toggleAsk(),
    engineState,
    engineLabel,
    notice,
    /** A notice the reader can act on: a gone model opens the model list. */
    noticeAction: notice === MODEL_GONE ? ("choose-model" as const) : null,
    dismissNotice: () => setNotice(null),
    menuOpen,
    setMenuOpen,
    searchOpen,
    setSearchOpen,
    query,
    setQuery,
    place,
    pathDraft,
    setPathDraft,
    passwordDraft: pressing.passwordDraft,
    setPasswordDraft: pressing.setPasswordDraft,
    pressUrlDraft: pressing.pressUrlDraft,
    setPressUrlDraft: pressing.setPressUrlDraft,
    attachPress: () => void pressing.preparePress({ url: pressing.pressUrlDraft.trim(), password: pressing.passwordDraft }),
    showPath,
    reduced,
    openSample: () => openSample(),
    preparePress: () => void pressing.preparePress(),
    models,
    model,
    modelLabel: model ? (models.find((m) => m.providerID === model.providerID && m.id === model.id)?.name ?? model.id) : null,
    providers,
    modelsOpen,
    setModelsOpen,
    openModels: () => {
      setMenuOpen(true);
      setModelsOpen(true);
    },
    chooseModel: (choice: ModelRef) => void chooseModel(choice),
    installPress: pressing.installPress,
    saveProviderKey: pressing.saveProviderKey,
    showProviderForm,
    hideProviderForm: pressing.hideProviderForm,
    press,
    providerId: pressing.providerId,
    setProviderId: pressing.setProviderId,
    providerKey: pressing.providerKey,
    setProviderKey: pressing.setProviderKey,
    savingKey: pressing.savingKey,
    beginOpenFolder,
    connectPath: () => void connect(pathDraft),
    sendQuill,
    sendNote,
    selectQuote: (quote: string) => {
      setSelection(quote);
      setNav((current) => ({ ...current, margin: true }));
    },
    turn,
    jump: (spread: number) => setNav((current) => reduceNav(current, { type: "jump", spread }).nav),
    showContents: () => {
      setMenuOpen(false);
      setSearchOpen(false);
      if (!book) return;
      setNav((current) => reduceNav(current, { type: "contents" }).nav);
    },
    closeContents: () => setNav((current) => reduceNav(current, { type: "close-contents" }).nav),
    setNavDesk: () => {
      setMenuOpen(false);
      setNav((current) => reduceNav(current, { type: "desk" }).nav);
    },
    showColophon: () => {
      setMenuOpen(false);
      setSearchOpen(false);
      setNav((current) => reduceNav(current, { type: "colophon" }).nav);
    },
    closeColophon: () => setNav((current) => reduceNav(current, { type: "close-colophon", hadBook: Boolean(book) }).nav),
    searchHits,
    curlDone: () => setNav((current) => reduceNav(current, { type: "curl-done" }).nav),
    closeMargin: () => setNav((current) => reduceNav(current, { type: "margin", open: false }).nav),
    openPlate: (id: string) => setNav((current) => reduceNav(current, { type: "open-plate", id }).nav),
    foldOpenPlate: () => setNav((current) => reduceNav(current, { type: "fold-plate" }).nav),
    foldPlate: (id: string) => mutatePlate(id, (plate) => ({ ...plate, folded: !plate.folded })),
    acceptPlate: (id: string) => mutatePlate(id, (plate) => (plate.status === "reverting" ? plate : { ...plate, status: "accepted" })),
    rejectPlate: (id: string) => void rejectPlate(id),
    revisePlate: (id: string) => {
      const found = book ? findPlate(book, id) : null;
      if (!found) return;
      putDraft(found.chapter.id, `Revise the change in ${found.plate.file}. `);
      setNav((current) => ({ ...current, margin: false }));
    },
    answerAsk,
    answerForm,
    dismissForm,
    replacePassage,
    keepBoth: (noteId: string) =>
      updateChapter(chapterForSpread(nav.spread)?.id ?? "", (chapter) => ({
        ...chapter,
        notes: chapter.notes.map((note) => (note.id === noteId ? { ...note, kept: true } : note)),
      })),
    togglePlace: () => setPlace((current) => (current === nav.spread ? null : nav.spread)),
    goToPlace: () => {
      if (place == null) return;
      setNav((current) => reduceNav(current, { type: "jump", spread: place }).nav);
    },
    stop: () => {
      const chapter = chapterForSpread(nav.spread);
      stopStream();
      if (chapter && book && !book.sample) {
        void clientRef.current?.interrupt(chapter.id).catch((error: unknown) => setNotice(messageOf(error, "The press did not stop.")));
      }
      if (chapter) updateChapter(chapter.id, (current) => ({ ...current, busy: false }));
    },
    chapterRoman,
    displayTitle,
    isUntitled,
  };
}


let canvas: HTMLCanvasElement | null = null;
function measureCanvas(): HTMLCanvasElement {
  if (!canvas) canvas = document.createElement("canvas");
  return canvas;
}
