import { useEffect, useRef, useState } from "react";
import type { Book, Chapter, PermissionAsk, Plate } from "../book/model";
import { toRoman } from "../book/model";
import type { LaidPage } from "../book/paginate";
import type { useFolio } from "../state/useFolio";
import { MarginaliaPage } from "./Marginalia";
import { PageFace } from "./Page";
import { PlatePage } from "./PlatePage";

type Folio = ReturnType<typeof useFolio>;

export function BookView({ folio }: { folio: Folio }) {
  const spread = folio.nav.spread;
  const left = folio.pages[spread * 2];
  const right = folio.pages[spread * 2 + 1];
  const [drag, setDrag] = useState<number | null>(null);
  const draggedTurn = useRef(false);

  useEffect(() => {
    if (!folio.nav.curl) return;
    const ms = folio.reduced ? 180 : 450;
    const timer = window.setTimeout(() => folio.curlDone(), ms);
    return () => window.clearTimeout(timer);
    // curlDone is read from the render that started the turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio.nav.curl, folio.reduced]);

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

  const curl = folio.nav.curl;
  const destination = curl ? folio.pages[curl.to * 2] : undefined;
  const showUnder = Boolean(curl && destination);

  return (
    <div
      className="book"
      role="main"
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
      {folio.place === spread ? <span className="ribbon" /> : null}
      {showUnder && curl?.forward ? (
        <Spread folio={folio} left={folio.pages[curl.to * 2]} right={folio.pages[curl.to * 2 + 1]} hiddenQuill />
      ) : (
        <Spread folio={folio} left={left} right={right} />
      )}
      {curl ? (
        <div className={`leaf ${curl.forward ? "forward" : "back"}`}>
          <div className="leaf-face">
            <FaceOnly
              folio={folio}
              page={curl.forward ? right : left}
              side={curl.forward ? "right" : "left"}
              number={(curl.forward ? spread * 2 + 2 : spread * 2 + 1)}
            />
          </div>
          <div className="leaf-face backface" />
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
}: {
  folio: Folio;
  left?: LaidPage;
  right?: LaidPage;
  hiddenQuill?: boolean;
}) {
  if (!left || !folio.book) return null;
  return (
    <>
      <BoundPage folio={folio} page={left} side="left" quill={false} plates={[]} />
      {right ? (
        <BoundPage
          folio={folio}
          page={right}
          side="right"
          quill={!hiddenQuill && isQuillPage(folio, right)}
          plates={platesOnSpread(folio, left, right)}
        />
      ) : (
        <article className="sheet right" />
      )}
    </>
  );
}

function BoundPage({
  folio,
  page,
  side,
  quill,
  plates,
}: {
  folio: Folio;
  page: LaidPage;
  side: "left" | "right";
  quill: boolean;
  /** The plates footnoted on this spread; only the right page shows them. */
  plates: Plate[];
}) {
  const book = folio.book!;
  const chapter = book.chapters.find((item) => item.id === page.chapterId);
  const roman = romanFor(book.chapters, page.chapterId);
  const number = folio.pages.indexOf(page) + 1;
  const notes = chapter?.notes.filter((note) => pageQuotes(folio, page).some((quote) => quote && note.quote.includes(quote.slice(0, 24)))) ?? chapter?.notes ?? [];
  if (side === "right" && folio.nav.margin && chapter) {
    return (
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
    );
  }
  const plateView = (plate: Plate, owner: Chapter | undefined, onFold: () => void, folded = false) => {
    const ask = owner ? askFor(owner, plate) : undefined;
    return (
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
        onFold={onFold}
      />
    );
  };
  let slips: Plate[] = [];
  if (side === "right") {
    // A plate the reader opened lies over the page until it is folded back or the page turns.
    const opened = folio.nav.plateOpen ? findPlate(book, folio.nav.plateOpen) : null;
    if (opened) return plateView(opened.plate, opened.chapter, folio.foldOpenPlate);
    // Prose never hides behind a plate: a page with lines keeps them and names its plates at the foot.
    // A bare page takes the plate, but the quill's page only for a change the press is asking about.
    const bare = page.lines.every((line) => line.gap || !line.text);
    const asking = plates.find((plate) => !plate.folded && chapter && askFor(chapter, plate));
    const facing = isQuillPage(folio, page) ? asking : plates.find((plate) => !plate.folded);
    const folded = isQuillPage(folio, page) ? undefined : plates.find((plate) => plate.folded);
    if (bare && facing) return plateView(facing, chapter, () => folio.foldPlate(facing.id));
    if (bare && folded) return plateView(folded, chapter, () => folio.foldPlate(folded.id), true);
    slips = plates;
  }
  return (
    <PageFace
      page={page}
      chapter={chapter}
      roman={roman}
      bookTitle={book.title}
      number={Math.max(1, number)}
      side={side}
      quill={quill}
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
      askBeforeWrite={folio.askBeforeWrite}
    />
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

function findPlate(book: Book, id: string): { chapter: Chapter; plate: Plate } | null {
  for (const chapter of book.chapters) {
    const plate = chapter.plates.find((item) => item.id === id);
    if (plate) return { chapter, plate };
  }
  return null;
}

function pageQuotes(folio: Folio, page: LaidPage): string[] {
  const chapter = folio.book?.chapters.find((item) => item.id === page.chapterId);
  if (!chapter) return [];
  const text = page.lines.map((line) => line.text).join(" ");
  return chapter.notes.map((note) => note.quote).filter((quote) => text.toLowerCase().includes(quote.slice(0, 24).toLowerCase()));
}
