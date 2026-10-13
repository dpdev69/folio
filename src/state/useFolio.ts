import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEvent, appendPrompt } from "../book/events";
import { paginateBook, type LaidPage } from "../book/paginate";
import { chapterRoman, displayTitle, isUntitled, type Book, type Chapter, type Plate } from "../book/model";
import { SAMPLE_BREAKS, SAMPLE_DRAFT, sampleBook, sampleNoteReply, sampleReply } from "../book/sample";
import { revealNextLine, type Measure } from "../book/wrap";
import { EngineClient, PRESS_SYSTEM, type EngineAuth } from "../engine/client";
import { coalesce } from "../engine/coalesce";
import { licenseBlocks, uncheckedLicense } from "../license/check";
import { followTail, initialNav, reduceNav, type Nav } from "./nav";
import { DEFAULT_SCALE_INDEX, SCALES, inkFont, proseFont } from "../ui/scales";
import { FIRST_PAGE, FIRST_PAGE_ID, keyProviders, modelSummary, type PressPhase } from "../welcome/copy";

export type EngineState = "off" | "connecting" | "ready" | "error";

type AttachResult = { ok: true; proxyUrl: string; version?: string } | { ok: false; error: string };

const ASK_RULES = ["edit", "write", "apply_patch", "bash"].map((permission) => ({
  permission,
  pattern: "*",
  action: "ask" as const,
}));

export function useFolio() {
  const [book, setBook] = useState<Book | null>(null);
  const [nav, setNav] = useState<Nav>({ view: "desk", spread: 0, margin: false, curl: null });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [press, setPress] = useState<PressPhase>({ phase: "checking" });
  const [providerId, setProviderId] = useState("openai");
  const [providerKey, setProviderKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX);
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
  const [showPath, setShowPath] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const clientRef = useRef<EngineClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<number | null>(null);
  const jumpRef = useRef<string | null>(null);
  const scale = SCALES[scaleIndex] ?? SCALES[DEFAULT_SCALE_INDEX];

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
      ctx.font = voice === "ink" ? inkFont(scale) : proseFont(scale);
      return ctx.measureText(text).width;
    },
    [fontsReady, scale],
  );

  // Stable per font and scale, so wrapped lines are found again on the next layout.
  const measures = useMemo(() => {
    const prose: Measure = (text) => measure(text, "prose");
    const ink: Measure = (text) => measure(text, "ink");
    return { prose, ink };
  }, [measure]);

  const layout = useMemo(() => {
    if (!book) return { pages: [] as LaidPage[], chapterStart: {} as Record<string, number> };
    return paginateBook(book.chapters, {
      measure: measures.prose,
      inkMeasure: measures.ink,
      width: scale.width,
      linesPerPage: scale.lines,
      dropLines: scale.dropLines,
      dropWidth: scale.dropWidth,
      breaks: book.sample ? SAMPLE_BREAKS : undefined,
    });
  }, [book, measures, scale]);

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

  function stopStream() {
    if (streamRef.current != null) window.clearTimeout(streamRef.current);
    streamRef.current = null;
  }

  function openSample(spread?: number) {
    abortRef.current?.abort();
    clientRef.current = null;
    stopStream();
    const next = sampleBook();
    setBook(next);
    setDrafts({ "ch-iv": SAMPLE_DRAFT });
    setEngineState("off");
    setEngineVersion(null);
    setNotice(null);
    setShowPath(false);
    setMenuOpen(false);
    if (spread != null && Number.isFinite(spread)) {
      setNav({ view: "reading", spread, margin: false, curl: null });
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
      let baseUrl = "/engine";
      let auth: EngineAuth | undefined;
      if (passwordDraft.trim()) auth = { username: "opencode", password: passwordDraft.trim() };
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const attached = await invoke<AttachResult>("engine_attach", {
          directory: folder,
          password: passwordDraft.trim() || null,
        });
        if (!attached.ok) throw new Error(attached.error);
        baseUrl = attached.proxyUrl;
        auth = undefined;
      }
      const client = new EngineClient(baseUrl, { directory: folder, auth });
      const health = await client.health();
      let sessions = await client.sessions();
      if (sessions.length === 0) {
        const created = await client.createSession({
          title: "Untitled",
          permission: askBeforeWrite ? ASK_RULES : undefined,
        });
        sessions = [created];
      }
      let next = bookFromSessions(folder, sessions);
      for (const session of sessions) {
        const transcript = await client.messages(session.id);
        for (const message of transcript) {
          for (const part of message.parts ?? []) {
            next = applyEvent(next, {
              type: "message.part.updated",
              properties: { sessionID: session.id, role: message.info?.role, part },
            });
          }
        }
        try {
          const diff = await client.diff(session.id);
          next = applyEvent(next, { type: "session.diff", properties: { sessionID: session.id, diff } });
        } catch {
          // Diffs are optional while a session is still empty.
        }
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Many deltas arrive per frame; set them in type together, in order.
      const events = coalesce<Parameters<typeof applyEvent>[1]>((batch) =>
        setBook((current) => {
          if (!current || current.sample) return current;
          return batch.reduce((next, event) => applyEvent(next, event), current);
        }),
      );
      ctrl.signal.addEventListener("abort", () => events.cancel());
      client.subscribe((event) => {
        if (event.type === "folio.stream-paused") {
          setNotice("The event stream paused. Folio will listen again.");
          return;
        }
        events.push(event);
      }, ctrl.signal);
      clientRef.current = client;
      setBook(ensureFirstPage(next));
      setDrafts({});
      setEngineState("ready");
      setEngineVersion(health.version);
      setShowPath(false);
      const last = next.chapters[next.chapters.length - 1];
      jumpRef.current = last?.id ?? null;
      setNav(initialNav(0));
      setNotice(null);
    } catch (error) {
      setEngineState("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Folio could not reach opencode. Start it with opencode serve, or read the sample.",
      );
    }
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
    updateChapter(chapter.id, (current) => appendPrompt(current, text.trim()));
    void clientRef.current?.prompt(chapter.id, text.trim(), PRESS_SYSTEM).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "The prompt was not accepted.");
      updateChapter(chapter.id, (current) => ({ ...current, busy: false }));
    });
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
    const composed = `About this passage:\n\n> ${quote.trim()}\n\n${prompt.trim()}`;
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
    void clientRef.current?.prompt(chapter.id, composed, PRESS_SYSTEM).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "The margin note was not sent.");
    });
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
        busy: false,
      };
      setBook({ ...book, chapters: [...book.chapters, chapter] });
      jumpRef.current = id;
      return;
    }
    try {
      const created = await clientRef.current?.createSession({
        title: "Untitled",
        permission: askBeforeWrite ? ASK_RULES : undefined,
      });
      if (!created) return;
      setBook((current) =>
        current
          ? applyEvent(current, {
              type: "session.created",
              properties: { info: { ...created, directory: current.directory } },
            })
          : current,
      );
      jumpRef.current = created.id;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A new chapter could not be opened.");
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
    if (!book?.sample) {
      if (!found.plate.messageId || !clientRef.current) {
        setNotice("This plate has no message to revert. Opencode applies edits as it goes, so Reject needs that message id.");
        return;
      }
      try {
        await clientRef.current.revert(found.chapter.id, found.plate.messageId);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The press could not revert the edit.");
        return;
      }
    }
    mutatePlate(id, (plate) => ({ ...plate, status: "reverted", folded: true }));
  }

  async function answerAsk(chapterId: string, id: string, response: "once" | "always" | "reject") {
    if (book && !book.sample) {
      try {
        await clientRef.current?.permission(chapterId, id, response);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The permission was not answered.");
        return;
      }
    }
    updateChapter(chapterId, (chapter) => ({ ...chapter, asks: chapter.asks.filter((ask) => ask.id !== id) }));
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

  async function preparePress() {
    setPress({ phase: "checking" });
    try {
      const license = await uncheckedLicense.check();
      if (licenseBlocks(license)) {
        setPress({ phase: "error", message: "This copy of Folio is not licensed." });
        return;
      }
      let base = "/engine";
      const auth = passwordDraft.trim() ? { username: "opencode", password: passwordDraft.trim() } : undefined;
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const detected = await invoke<{ found: boolean }>("engine_detect");
        if (!detected.found) {
          setPress({ phase: "missing" });
          return;
        }
        const attached = await invoke<AttachResult>("engine_attach", {
          directory: null,
          password: passwordDraft.trim() || null,
        });
        if (!attached.ok) {
          setPress({ phase: "missing", detail: attached.error });
          return;
        }
        base = attached.proxyUrl;
      } else {
        const probe = (await fetch("/folio/press").then((response) => response.json())) as {
          installed: boolean;
          running: boolean;
        };
        if (!probe.installed && !probe.running) {
          setPress({ phase: "missing" });
          return;
        }
        if (!probe.running) {
          const started = (await fetch("/folio/serve", { method: "POST" }).then((response) => response.json())) as {
            ok: boolean;
            error?: string;
          };
          if (!started.ok) {
            setPress({ phase: "missing", detail: started.error });
            return;
          }
        }
      }
      const client = new EngineClient(base, { auth });
      clientRef.current = client;
      const health = await client.health();
      const providers = await client.providers().catch(() => ({ connected: [] as string[], default: {} as Record<string, string> }));
      setEngineState("ready");
      setEngineVersion(health.version);
      if (!providers.connected.length) {
        const methods = await client.providerAuth().catch(() => ({}));
        const list = keyProviders(methods);
        setPress({
          phase: "needs-provider",
          providers: list.length ? list : [{ id: "openai", label: "OpenAI" }],
        });
        return;
      }
      setPress({
        phase: "ready",
        version: health.version,
        summary: modelSummary(providers.connected, providers.default),
      });
    } catch (error) {
      setEngineState("error");
      setPress({
        phase: "error",
        message: error instanceof Error ? error.message : "The press could not be reached.",
      });
    }
  }

  async function installPress() {
    setPress({ phase: "installing" });
    try {
      const result = isTauri()
        ? await (async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            return invoke<{ ok: boolean; error?: string }>("engine_install");
          })()
        : ((await fetch("/folio/install", { method: "POST" }).then((response) => response.json())) as {
            ok: boolean;
            error?: string;
          });
      if (!result.ok) {
        setPress({ phase: "missing", detail: result.error ?? "The installer did not finish." });
        return;
      }
      await preparePress();
    } catch (error) {
      setPress({ phase: "missing", detail: error instanceof Error ? error.message : "Install failed." });
    }
  }

  async function saveProviderKey() {
    if (!providerKey.trim() || !clientRef.current) return;
    setSavingKey(true);
    try {
      await clientRef.current.setApiKey(providerId, providerKey.trim());
      setProviderKey("");
      await preparePress();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The key was not accepted. You can run opencode auth login instead.");
    } finally {
      setSavingKey(false);
    }
  }

  async function showProviderForm() {
    const methods = (await clientRef.current?.providerAuth().catch(() => ({}))) ?? {};
    const list = keyProviders(methods);
    setPress({ phase: "needs-provider", providers: list.length ? list : [{ id: "openai", label: "OpenAI" }] });
    setNav((current) => ({ ...current, view: "desk" }));
    setMenuOpen(false);
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

  const engineLabel =
    engineState === "ready"
      ? `opencode ${engineVersion ?? ""}`.trim()
      : engineState === "connecting"
        ? "Looking for the press…"
        : engineState === "error"
          ? "opencode is not attached"
          : book?.sample
            ? "Sample press"
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
    cycleScale: () => setScaleIndex((index) => (index + 1) % SCALES.length),
    askBeforeWrite,
    toggleAsk: () => setAskBeforeWrite((value) => !value),
    engineState,
    engineLabel,
    notice,
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
    showPath,
    reduced,
    openSample: () => openSample(),
    preparePress,
    installPress,
    saveProviderKey,
    showProviderForm,
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
      if (chapter && book && !book.sample) void clientRef.current?.abort(chapter.id);
      if (chapter) updateChapter(chapter.id, (current) => ({ ...current, busy: false }));
    },
    chapterRoman,
    displayTitle,
    isUntitled,
  };
}

function ensureFirstPage(book: Book): Book {
  if (book.chapters.some((chapter) => chapter.blocks.some((block) => block.id !== FIRST_PAGE_ID && block.text.trim()))) return book;
  const last = book.chapters[book.chapters.length - 1];
  if (!last || last.blocks.some((block) => block.id === FIRST_PAGE_ID)) return book;
  return {
    ...book,
    chapters: book.chapters.map((chapter) =>
      chapter.id === last.id
        ? { ...chapter, blocks: [{ id: FIRST_PAGE_ID, voice: "prose", text: FIRST_PAGE }, ...chapter.blocks] }
        : chapter,
    ),
  };
}

function bookFromSessions(directory: string, sessions: { id: string; title?: string; time?: { created?: number } }[]): Book {
  const title = directory.split(/[\\/]/).filter(Boolean).pop() || "Book";
  return {
    id: directory,
    title,
    directory,
    sample: false,
    chapters: sessions
      .slice()
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      .map((session) => ({
        id: session.id,
        title: isUntitled(session.title) ? "Untitled" : (session.title ?? "Untitled"),
        untitled: isUntitled(session.title),
        blocks: [],
        footnotes: [],
        plates: [],
        notes: [],
        asks: [],
        busy: false,
      })),
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

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let canvas: HTMLCanvasElement | null = null;
function measureCanvas(): HTMLCanvasElement {
  if (!canvas) canvas = document.createElement("canvas");
  return canvas;
}
