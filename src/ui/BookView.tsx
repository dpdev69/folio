import { useEffect, useRef, useState } from "react";
import type { Chapter, Plate } from "../book/model";
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
      <BoundPage folio={folio} page={left} side="left" quill={false} />
      {right ? (
        <BoundPage folio={folio} page={right} side="right" quill={!hiddenQuill && isQuillPage(folio, right)} />
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
}: {
  folio: Folio;
  page: LaidPage;
  side: "left" | "right";
  quill: boolean;
}) {
  const book = folio.book!;
  const chapter = book.chapters.find((item) => item.id === page.chapterId);
  const roman = romanFor(book.chapters, page.chapterId);
  const number = folio.pages.indexOf(page) + 1;
  const plate = side === "right" ? facingPlate(folio, page) : undefined;
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
  if (plate && side === "right") {
    return (
      <PlatePage
        plate={plate}
        bookTitle={book.title}
        number={number}
        onAccept={() => folio.acceptPlate(plate.id)}
        onRevise={() => folio.revisePlate(plate.id)}
        onReject={() => folio.rejectPlate(plate.id)}
        onFold={() => folio.foldPlate(plate.id)}
      />
    );
  }
  const folded = side === "right" ? foldedPlate(folio, page) : undefined;
  const bare = page.lines.every((line) => line.gap || !line.text);
  if (folded && bare) {
    return (
      <PlatePage
        plate={folded}
        bookTitle={book.title}
        number={number}
        folded
        onAccept={() => undefined}
        onRevise={() => undefined}
        onReject={() => undefined}
        onFold={() => folio.foldPlate(folded.id)}
      />
    );
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

function isQuillPage(folio: Folio, page: LaidPage): boolean {
  let last = 0;
  folio.pages.forEach((item, index) => {
    if (item.chapterId === page.chapterId) last = Math.floor(index / 2);
  });
  return folio.nav.spread === last && !folio.nav.margin;
}

function facingPlate(folio: Folio, right: LaidPage): Plate | undefined {
  return plateOnSpread(folio, right, false);
}

function foldedPlate(folio: Folio, right: LaidPage): Plate | undefined {
  return plateOnSpread(folio, right, true);
}

function plateOnSpread(folio: Folio, right: LaidPage, folded: boolean): Plate | undefined {
  const left = folio.pages[folio.nav.spread * 2];
  const ids = new Set<string>();
  for (const page of [left, right]) {
    if (!page) continue;
    for (const note of page.footnotes) if (note.plateId) ids.add(note.plateId);
    for (const line of page.lines) for (const id of line.plates) ids.add(id);
  }
  const chapter = folio.book?.chapters.find((item) => item.id === (left?.chapterId ?? right.chapterId));
  return chapter?.plates.find((plate) => ids.has(plate.id) && plate.folded === folded);
}

function pageQuotes(folio: Folio, page: LaidPage): string[] {
  const chapter = folio.book?.chapters.find((item) => item.id === page.chapterId);
  if (!chapter) return [];
  const text = page.lines.map((line) => line.text).join(" ");
  return chapter.notes.map((note) => note.quote).filter((quote) => text.toLowerCase().includes(quote.slice(0, 24).toLowerCase()));
}
