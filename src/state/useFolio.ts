import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEvent, appendPrompt, MODEL_GONE, renameBlock } from "../book/events";
import { paginateBook, type LaidPage } from "../book/paginate";
import { chapterRoman, displayTitle, isUntitled, type Book, type Chapter, type Plate } from "../book/model";
import { SAMPLE_BREAKS, SAMPLE_DRAFT, sampleBook, sampleNoteReply, sampleReply } from "../book/sample";
import { composeNote } from "../book/notes";
import { revealNextLine, type Measure } from "../book/wrap";
import type { EngineClient, FormAnswer, ModelInfo, ModelRef, ProviderInfo } from "../engine/client";
import { coalesce } from "../engine/coalesce";
import type { EventFrame } from "../engine/sse";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { followTail, initialNav, reduceNav, type Nav } from "./nav";
import { DEFAULT_SCALE_INDEX, SCALES, footChars, footFont, footReserve, inkFont, layoutScale, proseFont } from "../ui/scales";
import { useSettings } from "./useSettings";
import { keyProviders, pressSummary, type PressPhase } from "../welcome/copy";
import {
  DECLINE_MESSAGE,
  isTauri,
  loadBook,
  messageOf,
  offeredModels,
  openChapter,
  openPress,
  pressHost,
  reattachPress,
  refreshBook,
  revertPlate,
  turnDiff,
  type AttachTarget,
} from "./press";
import { ensureFirstPage, mergeResync } from "./resync";

export type EngineState = "off" | "connecting" | "ready" | "error";

export function useFolio() {
  const [book, setBook] = useState<Book | null>(null);
  const [nav, setNav] = useState<Nav>({ ...initialNav(), view: "desk" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [press, setPress] = useState<PressPhase>({ phase: "checking" });
  const [providerId, setProviderId] = useState("openai");
  const [providerKey, setProviderKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [askBeforeWrite, setAskBeforeWrite] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>("off");
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<number | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [pressUrlDraft, setPressUrlDraft] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [showPath, setShowPath] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const clientRef = useRef<EngineClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<number | null>(null);
  const jumpRef = useRef<string | null>(null);
  const diffTimers = useRef(new Map<string, number>());
  const providersRef = useRef<ProviderInfo[]>([]);
  const bookRef = useRef<Book | null>(null);
  bookRef.current = book;
  const seenErrors = useRef(new Map<string, string>());
  // The stream and the press behind it: whether the stream is in an outage, the
  // press being started again, the attach target to reach it with, and the
  // frames that reached the page while a resync read the history.
  const pausedRef = useRef(false);
  const restartingRef = useRef(false);
  const targetRef = useRef<AttachTarget | undefined>(undefined);
  const resyncRef = useRef<{ frames: EventFrame[]; again: boolean; signal: AbortSignal } | null>(null);
  const { settings, dispatch: setSettings, theme, appearance } = useSettings();
  const { scaleIndex, lineSpacing, margins } = settings;
  const scale = useMemo(
    () => layoutScale(SCALES[scaleIndex] ?? SCALES[DEFAULT_SCALE_INDEX], { lineSpacing, margins }, theme),
    [scaleIndex, lineSpacing, margins, theme],
  );
  const [faceEpoch, setFaceEpoch] = useState(0);

  useEffect(() => {
    // A weight or face the page has not used yet is not loaded; fetch it, then measure again.
    let live = true;
    document.fonts
      .load(proseFont(scale, theme))
      .then(() => live && setFaceEpoch((n) => n + 1))
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
      void preparePress();
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
    return footReserve(footChars(scale, average));
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
      dropLines: scale.dropLines,
      dropWidth: scale.dropWidth,
      footLines,
      breaks: book.sample ? SAMPLE_BREAKS : undefined,
    });
  }, [book, measures, scale, footLines]);

  const spreadCount = Math.max(1, Math.ceil(layout.pages.length / 2));

  useEffect(() => {
    const id = jumpRef.current;
    if (!fontsReady || !id || layout.chapterStart[id] == null) return;
    jumpRef.current = null;
    const spread = Math.floor(layout.chapterStart[id] / 2);
    setNav((current) => {
      if (current.view === "reading" && current.spread === spread && !current.curl) return current;
      return { ...current, view: "reading", margin: false, curl: { to: spread, forward: spread >= current.spread } };
    });
  }, [layout.chapterStart, fontsReady]);

  const prevPages = useRef<string[]>([]);
  useEffect(() => {
    const before = prevPages.current;
    const after = layout.pages.map((page) => page.chapterId);
    prevPages.current = after;
    if (!book || before.length === 0) return;
    setNav((current) => {
      if (current.curl || current.view !== "reading") return current;
      const to = followTail(before, after, current.spread);
      return to == null ? current : { ...current, curl: { to, forward: true } };
    });
  }, [layout.pages, book]);

  useEffect(() => {
    const client = clientRef.current;
    if (!book || book.sample || !client) return;
    for (const chapter of book.chapters) {
      if (!chapter.diffStale || diffTimers.current.has(chapter.id)) continue;
      const timer = window.setTimeout(() => {
        const latest = bookRef.current?.chapters.find((item) => item.id === chapter.id);
        if (!latest) {
          diffTimers.current.delete(chapter.id);
          return;
        }
        turnDiff(client, latest)
          // An empty diff still marks the chapter fresh, so a failure is not retried in a loop.
          .catch(() => ({ type: "folio.diff", data: { sessionID: chapter.id, diff: [] } }))
          .then((frame) => {
            diffTimers.current.delete(chapter.id);
            setBook((current) => (current && !current.sample ? applyEvent(current, frame) : current));
          });
      }, 300);
      diffTimers.current.set(chapter.id, timer);
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
    abortRef.current?.abort();
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
    jumpRef.current = "ch-iv";
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
    abortRef.current?.abort();
    stopStream();
    try {
      const next = await loadBook(client, folder, { askBeforeWrite, model });
      // Errors already in the history are old news.
      seenErrors.current = new Map(next.chapters.flatMap((c) => (c.error ? [[c.id, c.error] as const] : [])));
      listen(client);
      setBook(ensureFirstPage(next));
      setDrafts({});
      setEngineState("ready");
      setShowPath(false);
      const last = next.chapters[next.chapters.length - 1];
      jumpRef.current = last?.id ?? null;
      setNav(initialNav(0));
      setNotice(null);
    } catch (error) {
      setEngineState("error");
      setNotice(messageOf(error, "Folio could not open that folder with the press."));
    }
  }

  /** Listen to the press's stream for the open book, in place of any earlier stream. */
  function listen(client: EngineClient): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pausedRef.current = false;
    // Many deltas arrive per frame; set them in type together, in order.
    const events = coalesce<EventFrame>((batch) => {
      // A resync reading the history applies these again to the chapters it brings back.
      if (resyncRef.current?.signal === ctrl.signal) resyncRef.current.frames.push(...batch);
      setBook((current) => {
        if (!current || current.sample) return current;
        return batch.reduce((book, frame) => applyEvent(book, frame), current);
      });
    });
    ctrl.signal.addEventListener("abort", () => events.cancel());
    client.subscribe((frame) => {
      if (frame.type === "folio.stream-paused") {
        pausedRef.current = true;
        setNotice("The event stream paused. Folio will listen again.");
      } else if (frame.type === "folio.stream-resumed") {
        pausedRef.current = false;
        setNotice(null);
        void resync(client, ctrl.signal);
      } else if (frame.type === "folio.stream-failing") {
        void restartPress();
      } else {
        events.push(frame);
      }
    }, ctrl.signal);
    return ctrl.signal;
  }

  /** The stream has no replay; after an outage, set the chapters again from history. */
  async function resync(client: EngineClient, signal: AbortSignal) {
    const running = resyncRef.current;
    if (running && !running.signal.aborted) {
      running.again = true;
      return;
    }
    const run = { frames: [] as EventFrame[], again: false, signal };
    resyncRef.current = run;
    try {
      const snapshot = bookRef.current;
      if (!snapshot || snapshot.sample) return;
      const fresh = await refreshBook(client, snapshot);
      if (signal.aborted) return;
      const frames = run.frames.slice();
      setBook((current) => (current && !current.sample && current.id === fresh.id ? mergeResync(current, fresh, frames) : current));
    } catch {
      // The next outage or turn will try again.
    } finally {
      if (resyncRef.current === run) resyncRef.current = null;
      if (run.again && !signal.aborted) void resync(client, signal);
    }
  }

  /**
   * The stream keeps failing, or a call found nothing answering while it was
   * paused: the press may have died. Reach it again (the host starts a new one,
   * with a new port and password), listen with the new client, and resync.
   * If that fails, the old stream goes on trying and asks again later.
   */
  async function restartPress() {
    if (restartingRef.current) return;
    restartingRef.current = true;
    try {
      const client = await reattachPress(pressHost(), targetRef.current);
      client.onUnreachable = whenUnreachable;
      clientRef.current = client;
      const current = bookRef.current;
      if (current && !current.sample) {
        const signal = listen(client);
        void resync(client, signal);
      }
      setNotice(null);
    } catch {
      setNotice("The press is not answering. Folio will keep trying.");
    } finally {
      restartingRef.current = false;
    }
  }

  function whenUnreachable() {
    if (pausedRef.current) void restartPress();
  }

  function updateChapter(id: string, edit: (chapter: Chapter) => Chapter) {
    setBook((current) => {
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
  async function sendPrompt(chapterId: string, text: string, localId: string | null, failure: string) {
    const client = clientRef.current;
    if (!client) return;
    try {
      const id = await client.prompt(chapterId, text);
      if (localId) updateChapter(chapterId, (current) => renameBlock(current, localId, id));
    } catch (error) {
      setNotice(messageOf(error, failure));
      updateChapter(chapterId, (current) => ({ ...current, busy: false }));
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
    void sendPrompt(chapter.id, composed, null, "The margin note was not sent.");
  }

  function turn(forward: boolean) {
    const result = reduceNav(nav, { type: "turn", forward, spreadCount });
    setNav(result.nav);
    if (result.effect === "new-chapter") void createChapter();
  }

  async function createChapter() {
    if (!book) return;
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
      setBook({ ...book, chapters: [...book.chapters, chapter] });
      jumpRef.current = id;
      return;
    }
    const client = clientRef.current;
    if (!client) return;
    try {
      const created = await openChapter(client, book.directory, { askBeforeWrite, model });
      setBook((current) =>
        current
          ? applyEvent(current, {
              type: "session.created",
              data: { sessionID: created.id, title: created.title, location: { directory: current.directory } },
            })
          : current,
      );
      jumpRef.current = created.id;
    } catch (error) {
      setNotice(messageOf(error, "A new chapter could not be opened."));
    }
  }

  function mutatePlate(id: string, edit: (plate: Plate) => Plate) {
    setBook((current) => {
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

  async function rejectPlate(id: string) {
    const found = findPlate(book, id);
    if (!found) return;
    if (book && !book.sample) {
      const client = clientRef.current;
      if (!client) return;
      try {
        const frame = await revertPlate(client, book, found.chapter, found.plate);
        mutatePlate(id, (plate) => ({ ...plate, status: "reverted", folded: true }));
        setBook((current) => (current ? applyEvent(current, frame) : current));
        setNotice("The file was restored.");
      } catch (error) {
        setNotice(messageOf(error, "The press could not undo the change."));
      }
      return;
    }
    mutatePlate(id, (plate) => ({ ...plate, status: "reverted", folded: true }));
  }

  /** "Allow once", or "No" with a message so the turn goes on without the change. */
  async function answerAsk(chapterId: string, id: string, decision: "once" | "reject") {
    if (book && !book.sample) {
      try {
        await clientRef.current?.permissionReply(chapterId, id, decision, decision === "reject" ? DECLINE_MESSAGE : undefined);
      } catch (error) {
        setNotice(messageOf(error, "The question was not answered."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, asks: chapter.asks.filter((ask) => ask.id !== id) }));
  }

  async function answerForm(chapterId: string, formId: string, answer: FormAnswer) {
    if (book && !book.sample) {
      try {
        await clientRef.current?.formReply(chapterId, formId, answer);
      } catch (error) {
        setNotice(messageOf(error, "The answer was not sent."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, forms: chapter.forms.filter((form) => form.id !== formId) }));
  }

  async function dismissForm(chapterId: string, formId: string) {
    if (book && !book.sample) {
      try {
        await clientRef.current?.formCancel(chapterId, formId, "The reader skipped this question.");
      } catch (error) {
        setNotice(messageOf(error, "The question was not set aside."));
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, forms: chapter.forms.filter((form) => form.id !== formId) }));
  }

  /** Use this model for the chapter in view, and for chapters opened from now on. */
  async function chooseModel(choice: ModelRef) {
    setModel(choice);
    setMenuOpen(false);
    if (notice === MODEL_GONE) setNotice(null);
    setPress((current) =>
      current.phase === "ready"
        ? { ...current, summary: pressSummary(current.version, providersRef.current, choice), note: undefined }
        : current,
    );
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

  /** Find the press, start or attach to it, and say on the title page what it will write with. */
  async function preparePress(target?: AttachTarget) {
    setPress({ phase: "checking" });
    try {
      const license = await uncheckedLicense.check();
      if (licenseBlocks(license)) {
        setPress({ phase: "error", message: "This copy of Folio is not licensed." });
        return;
      }
      const opened = await openPress(pressHost(), target);
      targetRef.current = target;
      if (opened.client) opened.client.onUnreachable = whenUnreachable;
      clientRef.current = opened.client;
      providersRef.current = opened.providers;
      setProviders(opened.providers);
      setModels(opened.models);
      setModel(opened.model);
      setEngineState(opened.client ? "ready" : "off");
      setEngineVersion(opened.version ?? null);
      setPress(opened.phase);
    } catch (error) {
      clientRef.current = null;
      setEngineState("error");
      setPress({ phase: "error", message: messageOf(error, "The press could not be reached.") });
    }
  }

  async function installPress() {
    setPress({ phase: "installing" });
    try {
      const result = await pressHost().install();
      if (!result.ok) {
        setPress({ phase: "missing", detail: result.error ?? "The installer did not finish." });
        return;
      }
      await preparePress();
    } catch (error) {
      setPress({ phase: "missing", detail: messageOf(error, "The installer did not finish.") });
    }
  }

  /** Store a provider key with the press, then name the press's model again. */
  async function saveProviderKey() {
    const client = clientRef.current;
    if (!providerKey.trim() || !client) return;
    setSavingKey(true);
    try {
      await client.connectKey(providerId, providerKey.trim(), "Folio");
      setProviderKey("");
      const [providers, list, fallback] = await Promise.all([
        client.providers().catch(() => providersRef.current),
        client.models().catch(() => [] as ModelInfo[]),
        client.defaultModel().catch(() => null),
      ]);
      providersRef.current = providers;
      setProviders(providers);
      setModels(offeredModels(list));
      const chosen = model ?? (fallback ? { providerID: fallback.providerID, id: fallback.id } : null);
      setPress((current) =>
        current.phase === "ready"
          ? { phase: "ready", version: current.version, summary: pressSummary(current.version, providers, chosen) }
          : current,
      );
    } catch (error) {
      setNotice(messageOf(error, "The key was not accepted."));
    } finally {
      setSavingKey(false);
    }
  }

  /** Open the key form on the title page. It is never required; the free provider works without one. */
  async function showProviderForm() {
    setMenuOpen(false);
    setNav((current) => ({ ...current, view: "desk" }));
    const client = clientRef.current;
    if (!client) {
      setNotice("The press is not ready yet.");
      return;
    }
    const list = keyProviders(await client.integrations().catch(() => []));
    if (!list.length) {
      setNotice("The press offers no providers that take a key.");
      return;
    }
    if (!list.some((item) => item.id === providerId)) setProviderId(list[0].id);
    setPress((current) => (current.phase === "ready" ? { ...current, providers: list } : current));
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
    toggleAsk: () => setAskBeforeWrite((value) => !value),
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
    passwordDraft,
    setPasswordDraft,
    pressUrlDraft,
    setPressUrlDraft,
    attachPress: () => void preparePress({ url: pressUrlDraft.trim(), password: passwordDraft }),
    showPath,
    reduced,
    openSample: () => openSample(),
    preparePress: () => void preparePress(),
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
    installPress,
    saveProviderKey,
    showProviderForm,
    hideProviderForm: () => setPress((current) => (current.phase === "ready" ? { ...current, providers: undefined } : current)),
    press,
    providerId,
    setProviderId,
    providerKey,
    setProviderKey,
    savingKey,
    beginOpenFolder,
    connectPath: () => void connect(pathDraft),
    sendQuill,
    sendNote,
    selectQuote: (quote: string) => {
      setSelection(quote);
      setNav((current) => ({ ...current, margin: true }));
    },
    turn,
    jump: (spread: number) => setNav(reduceNav(nav, { type: "jump", spread }).nav),
    showContents: () => {
      setMenuOpen(false);
      setSearchOpen(false);
      if (!book) return;
      setNav(reduceNav(nav, { type: "contents" }).nav);
    },
    closeContents: () => setNav(reduceNav(nav, { type: "close-contents" }).nav),
    setNavDesk: () => {
      setMenuOpen(false);
      setNav(reduceNav(nav, { type: "desk" }).nav);
    },
    showColophon: () => {
      setMenuOpen(false);
      setSearchOpen(false);
      setNav(reduceNav(nav, { type: "colophon" }).nav);
    },
    closeColophon: () => setNav(reduceNav(nav, { type: "close-colophon", hadBook: Boolean(book) }).nav),
    searchHits,
    curlDone: () => setNav(reduceNav(nav, { type: "curl-done" }).nav),
    closeMargin: () => setNav(reduceNav(nav, { type: "margin", open: false }).nav),
    openPlate: (id: string) => setNav(reduceNav(nav, { type: "open-plate", id }).nav),
    foldOpenPlate: () => setNav(reduceNav(nav, { type: "fold-plate" }).nav),
    foldPlate: (id: string) => mutatePlate(id, (plate) => ({ ...plate, folded: !plate.folded })),
    acceptPlate: (id: string) => mutatePlate(id, (plate) => ({ ...plate, status: "accepted" })),
    rejectPlate: (id: string) => void rejectPlate(id),
    revisePlate: (id: string) => {
      const found = findPlate(book, id);
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
      setNav(reduceNav(nav, { type: "jump", spread: place }).nav);
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

function findPlate(book: Book | null, id: string): { chapter: Chapter; plate: Plate } | null {
  if (!book) return null;
  for (const chapter of book.chapters) {
    const plate = chapter.plates.find((item) => item.id === id);
    if (plate) return { chapter, plate };
  }
  return null;
}

let canvas: HTMLCanvasElement | null = null;
function measureCanvas(): HTMLCanvasElement {
  if (!canvas) canvas = document.createElement("canvas");
  return canvas;
}
