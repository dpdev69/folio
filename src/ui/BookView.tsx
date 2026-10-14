import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Chapter, PermissionAsk, Plate } from "../book/model";
import { findPlate, toRoman } from "../book/model";
import { opensChapter, type LaidPage } from "../book/paginate";
import { plateShown } from "../state/nav";
import type { useFolio } from "../state/useFolio";
import { CURL_MS, CURL_PERSPECTIVE, CURL_REDUCED_MS, EASE_PAPER, curlFrames } from "./curl";
import { MarginaliaPage } from "./Marginalia";
import { PageFace } from "./Page";
import { PlatePage } from "./PlatePage";

type Folio = ReturnType<typeof useFolio>;

/** A plate being folded back: drawn once more, lifting off the page, then gone. */
type Leaving = { plate: Plate; chapter?: Chapter; number: number };

export function BookView({ folio }: { folio: Folio }) {
  const spread = folio.nav.spread;
  const left = folio.pages[spread * 2];
  const right = folio.pages[spread * 2 + 1];
  const [drag, setDrag] = useState<number | null>(null);
  const draggedTurn = useRef(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const [ribbonDrop, setRibbonDrop] = useState(false);
  const placed = useRef(folio.place);
  // The turn finishes against the latest state, however often the page re-renders meanwhile.
  const latest = useRef(folio);
  latest.current = folio;
  const leafRef = useRef<HTMLDivElement>(null);
  const nearRef = useRef<HTMLSpanElement>(null);
  const farRef = useRef<HTMLSpanElement>(null);

  const curl = folio.nav.curl;
  const curlKey = curl ? `${curl.to}:${curl.forward ? "f" : "b"}` : null;
  const reduced = folio.reduced;

  useEffect(() => {
    if (!curlKey) return;
    const timer = window.setTimeout(() => latest.current.curlDone(), reduced ? CURL_REDUCED_MS : CURL_MS);
    return () => window.clearTimeout(timer);
  }, [curlKey, reduced]);

  // One timeline for the leaf, its light, and the shadows it casts on the pages beneath.
  useLayoutEffect(() => {
    const leaf = leafRef.current;
    if (!curlKey || reduced || !leaf || typeof leaf.animate !== "function") return;
    const frames = curlFrames(curlKey.endsWith("f"));
    const timing: KeyframeAnimationOptions = { duration: CURL_MS, easing: EASE_PAPER, fill: "both" };
    const running = [
      leaf.animate(frames.leaf, timing),
      leaf.querySelector(".leaf-face:not(.backface) .leaf-light")?.animate(frames.frontLight, timing),
      leaf.querySelector(".backface .leaf-light")?.animate(frames.backLight, timing),
      nearRef.current?.animate(frames.near, timing),
      farRef.current?.animate(frames.far, timing),
    ];
    return () => running.forEach((animation) => animation?.cancel());
  }, [curlKey, reduced]);

  // The ribbon drops in when the reader places it here, not every time the spread comes round.
  useEffect(() => {
    if (placed.current !== folio.place && folio.place === spread && !reduced) setRibbonDrop(true);
    placed.current = folio.place;
  }, [folio.place, spread, reduced]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 400);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (event.key === "ArrowRight") folio.turn(true);
      if (event.key === "ArrowLeft") folio.turn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [folio]);

  if (!folio.book || !left) {
    return null;
  }

  const destLeft = curl ? folio.pages[curl.to * 2] : undefined;
  const destRight = curl ? folio.pages[curl.to * 2 + 1] : undefined;
  const turning = Boolean(curl && destLeft);
  const fold = (plate: Plate, chapter: Chapter | undefined, number: number) => {
    if (!reduced) setLeaving({ plate, chapter, number });
    folio.foldOpenPlate();
  };

  let under: ReactNode;
  if (turning && curl && reduced) {
    // Reduced motion: the destination is set beneath and the spread above simply fades.
    under = <Spread folio={folio} left={destLeft} right={destRight} hiddenQuill onFold={fold} />;
  } else if (turning && curl?.forward) {
    // A forward turn uncovers the next right page; the left page stays until the leaf lands on it.
    under = (
      <Spread folio={folio} left={left} right={destRight} hiddenQuill platesFrom={[destLeft!, destRight]} onFold={fold} />
    );
  } else if (turning && curl) {
    under = <Spread folio={folio} left={destLeft} right={right} platesFrom={[left, right]} onFold={fold} />;
  } else {
    under = <Spread folio={folio} left={left} right={right} leaving={leaving} onLeft={() => setLeaving(null)} onFold={fold} />;
  }

  return (
    <div
      className="book"
      role="main"
      style={{ perspective: `${CURL_PERSPECTIVE}px` }}
      onPointerMove={(event) => {
        if (drag == null) return;
        const width = event.currentTarget.getBoundingClientRect().width / 2;
        const delta = drag - event.clientX;
        if (delta > width * 0.45) {
          draggedTurn.current = true;
          setDrag(null);
          folio.turn(true);
        }
      }}
      onPointerUp={() => setDrag(null)}
    >
      <span className="gutter" />
      {folio.place === spread ? (
        <span className={`ribbon ${ribbonDrop ? "dropping" : ""}`} onAnimationEnd={() => setRibbonDrop(false)} />
      ) : null}
      {under}
      {turning && curl && !reduced ? (
        <>
          <span className={`curl-shade near ${curl.forward ? "on-right" : "on-left"}`} aria-hidden="true">
            <span ref={nearRef} />
          </span>
          <span className={`curl-shade far ${curl.forward ? "on-left" : "on-right"}`} aria-hidden="true">
            <span ref={farRef} />
          </span>
          <div key={curlKey} ref={leafRef} className={`leaf ${curl.forward ? "forward" : "back"}`} aria-hidden="true" inert>
            <div className="leaf-face">
              <FaceOnly
                folio={folio}
                page={curl.forward ? right : left}
                side={curl.forward ? "right" : "left"}
                number={curl.forward ? spread * 2 + 2 : spread * 2 + 1}
              />
              <span className="leaf-light" />
            </div>
            <div className="leaf-face backface">
              <FaceOnly
                folio={folio}
                page={curl.forward ? destLeft : destRight}
                side={curl.forward ? "left" : "right"}
                number={curl.forward ? curl.to * 2 + 1 : curl.to * 2 + 2}
              />
              <span className="leaf-light" />
            </div>
          </div>
        </>
      ) : null}
      {turning && reduced ? (
        <div key={curlKey} className="leaf-fade" aria-hidden="true" inert>
          <FaceOnly folio={folio} page={left} side="left" number={spread * 2 + 1} />
          <FaceOnly folio={folio} page={right} side="right" number={spread * 2 + 2} />
        </div>
      ) : null}
      {!curl && (
        <>
          <button
            type="button"
            className="corner"
            aria-label="Turn forward"
            onPointerDown={(event) => setDrag(event.clientX)}
            onClick={() => {
              if (draggedTurn.current) {
                draggedTurn.current = false;
                return;
              }
              folio.turn(true);
            }}
          />
          {spread > 0 ? (
            <button type="button" className="corner back" aria-label="Turn back" onClick={() => folio.turn(false)} />
          ) : null}
        </>
      )}
    </div>
  );
}

function Spread({
  folio,
  left,
  right,
  hiddenQuill,
  platesFrom,
  leaving,
  onLeft,
  onFold,
}: {
  folio: Folio;
  left?: LaidPage;
  right?: LaidPage;
  hiddenQuill?: boolean;
  /** The spread whose footnotes name the right page's plates; the right page's own by default. */
  platesFrom?: [LaidPage, LaidPage | undefined];
  leaving?: Leaving | null;
  onLeft?: () => void;
  onFold: (plate: Plate, chapter: Chapter | undefined, number: number) => void;
}) {
  if (!folio.book) return null;
  const [plateLeft, plateRight] = platesFrom ?? [left, right];
  return (
    <>
      {left ? (
        <BoundPage folio={folio} page={left} side="left" quill={false} plates={[]} onFold={onFold} />
      ) : (
        <article className="sheet left" />
      )}
      <div className="page-stack">
        {right ? (
          <BoundPage
            folio={folio}
            page={right}
            side="right"
            quill={!hiddenQuill && isQuillPage(folio, right)}
            plates={plateLeft && plateRight ? platesOnSpread(folio, plateLeft, plateRight) : []}
            onFold={onFold}
          />
        ) : (
          <article className="sheet right" />
        )}
        {leaving ? (
          <div className="page-over leaving" inert aria-hidden="true" onAnimationEnd={onLeft}>
            <PlatePage
              plate={leaving.plate}
              bookTitle={folio.book.title}
              number={leaving.number}
              onAccept={() => undefined}
              onRevise={() => undefined}
              onReject={() => undefined}
              onFold={() => undefined}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function BoundPage({
  folio,
  page,
  side,
  quill,
  plates,
  onFold,
}: {
  folio: Folio;
  page: LaidPage;
  side: "left" | "right";
  quill: boolean;
  /** The plates footnoted on this spread; only the right page shows them. */
  plates: Plate[];
  onFold: (plate: Plate, chapter: Chapter | undefined, number: number) => void;
}) {
  const book = folio.book!;
  const chapter = book.chapters.find((item) => item.id === page.chapterId);
  const roman = romanFor(book.chapters, page.chapterId);
  const number = folio.pages.indexOf(page) + 1;
  const notes = chapter?.notes.filter((note) => pageQuotes(folio, page).some((quote) => quote && note.quote.includes(quote.slice(0, 24)))) ?? chapter?.notes ?? [];

  // Whatever lies over the right page: the margin, or a plate. The page stays mounted beneath it,
  // so a plate is laid on the page and lifted off it, and the quill underneath keeps its place.
  let over: ReactNode = null;
  let slips: Plate[] = [];
  if (side === "right" && folio.nav.margin && chapter) {
    over = (
      <div className="page-over" key="margin">
        <MarginaliaPage
          notes={notes.length ? notes : chapter.notes}
          draft={folio.noteDraft}
          onDraft={folio.setNoteDraft}
          onSubmit={(prompt) => {
            const quote = folio.selection || chapter.notes.at(-1)?.quote || "";
            if (quote) folio.sendNote(quote, prompt);
          }}
          onChip={(prompt) => {
            const quote = folio.selection || chapter.notes.at(-1)?.quote || "";
            if (quote) folio.sendNote(quote, prompt);
          }}
          onReplace={folio.replacePassage}
          onKeep={folio.keepBoth}
          onClose={folio.closeMargin}
          number={number}
        />
      </div>
    );
  } else if (side === "right") {
    const plateView = (plate: Plate, owner: Chapter | undefined, fold: () => void, folded = false) => {
      const ask = owner ? askFor(owner, plate) : undefined;
      return (
        <div className="page-over" key={`plate-${plate.id}`}>
          <PlatePage
            plate={plate}
            bookTitle={book.title}
            number={number}
            folded={folded}
            ask={ask}
            onAsk={ask && owner ? (decision) => void folio.answerAsk(owner.id, ask.id, decision) : undefined}
            onAccept={() => folio.acceptPlate(plate.id)}
            onRevise={() => folio.revisePlate(plate.id)}
            onReject={() => folio.rejectPlate(plate.id)}
            onFold={fold}
          />
        </div>
      );
    };
    // A plate the reader opened lies over the page until it is folded back or the page turns,
    // and only over the spread that footnotes it.
    const shown = plateShown(folio.nav, plates.map((plate) => plate.id));
    const opened = shown ? findPlate(book, shown) : null;
    // Prose never hides behind a plate: a page with lines keeps them and names its plates at the foot.
    // A bare page takes the plate, but the quill's page only for a change the press is asking about.
    const bare = page.lines.every((line) => line.gap || !line.text);
    const asking = plates.find((plate) => !plate.folded && chapter && askFor(chapter, plate));
    const facing = isQuillPage(folio, page) ? asking : plates.find((plate) => !plate.folded);
    const folded = isQuillPage(folio, page) ? undefined : plates.find((plate) => plate.folded);
    if (opened) {
      over = plateView(opened.plate, opened.chapter, () => onFold(opened.plate, opened.chapter, number));
    } else if (bare && facing) {
      over = plateView(facing, chapter, () => folio.foldPlate(facing.id));
    } else if (bare && folded) {
      over = plateView(folded, chapter, () => folio.foldPlate(folded.id), true);
    } else {
      slips = plates;
    }
  }
  const face = (
    <PageFace
      page={page}
      chapter={chapter}
      roman={roman}
      bookTitle={book.title}
      number={Math.max(1, number)}
      side={side}
      quill={quill}
      opening={opensChapter(folio.pages.indexOf(page), page.chapterId, folio.chapterStart)}
      covered={Boolean(over)}
      draft={quill ? folio.draft : ""}
      onDraft={folio.setDraft}
      onSubmit={folio.sendQuill}
      onSelect={folio.selectQuote}
      asks={side === "left" ? (chapter?.asks ?? []) : []}
      onAsk={(id, response) => chapter && folio.answerAsk(chapter.id, id, response)}
      forms={side === "left" ? (chapter?.forms ?? []) : []}
      onFormSend={(formId, answer) => chapter && void folio.answerForm(chapter.id, formId, answer)}
      onFormSkip={(formId) => chapter && void folio.dismissForm(chapter.id, formId)}
      slips={slips}
      onOpenPlate={folio.openPlate}
      busy={Boolean(chapter?.busy)}
      onStop={folio.stop}
      askBeforeWrite={Boolean(chapter?.askRules)}
    />
  );
  if (side === "left") return face;
  return (
    <>
      {face}
      {over}
    </>
  );
}

function FaceOnly({ folio, page, side, number }: { folio: Folio; page?: LaidPage; side: "left" | "right"; number: number }) {
  if (!page || !folio.book) return <article className={`sheet ${side}`} />;
  const chapter = folio.book.chapters.find((item) => item.id === page.chapterId);
  return (
    <PageFace
      page={page}
      chapter={chapter}
      roman={romanFor(folio.book.chapters, page.chapterId)}
      bookTitle={folio.book.title}
      number={number}
      side={side}
      quill={false}
      opening={opensChapter(folio.pages.indexOf(page), page.chapterId, folio.chapterStart)}
      draft=""
      onDraft={() => undefined}
      onSubmit={() => undefined}
      onSelect={() => undefined}
      asks={[]}
      onAsk={() => undefined}
      busy={false}
      onStop={() => undefined}
      askBeforeWrite={false}
    />
  );
}

function romanFor(chapters: Chapter[], id: string): string {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  return toRoman(Math.max(1, index + 1));
}

/** The right page of its chapter's last spread carries the quill. */
function isQuillPage(folio: Folio, page: LaidPage): boolean {
  let last = 0;
  folio.pages.forEach((item, index) => {
    if (item.chapterId === page.chapterId) last = Math.floor(index / 2);
  });
  return Math.floor(folio.pages.indexOf(page) / 2) === last && !folio.nav.margin;
}

/** The plates footnoted on a spread, in plate order. */
function platesOnSpread(folio: Folio, left: LaidPage, right: LaidPage): Plate[] {
  const ids = new Set<string>();
  for (const page of [left, right]) {
    for (const note of page.footnotes) if (note.plateId) ids.add(note.plateId);
    for (const line of page.lines) for (const id of line.plates) ids.add(id);
  }
  const chapter = folio.book?.chapters.find((item) => item.id === left.chapterId);
  return chapter?.plates.filter((plate) => ids.has(plate.id)) ?? [];
}

/** The permission ask holding this plate's edit; the reducer names an edit's plate `plate-<callId>`. */
function askFor(chapter: Chapter, plate: Plate): PermissionAsk | undefined {
  return chapter.asks.find((ask) => ask.callId && `plate-${ask.callId}` === plate.id);
}

function pageQuotes(folio: Folio, page: LaidPage): string[] {
  const chapter = folio.book?.chapters.find((item) => item.id === page.chapterId);
  if (!chapter) return [];
  const text = page.lines.map((line) => line.text).join(" ");
  return chapter.notes.map((note) => note.quote).filter((quote) => text.toLowerCase().includes(quote.slice(0, 24).toLowerCase()));
}
