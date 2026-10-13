import { useRef } from "react";
import { highlightMap } from "../book/highlight";
import type { Chapter, PermissionAsk } from "../book/model";
import { displayTitle } from "../book/model";
import type { LaidPage } from "../book/paginate";
import { quillKey } from "../book/quill";
import { toRoman } from "../book/model";
import { LineView } from "./lines";
import { Ornament } from "./icons";

export function PageFace({
  page,
  chapter,
  roman,
  bookTitle,
  number,
  side,
  quill,
  draft,
  onDraft,
  onSubmit,
  onSelect,
  asks,
  onAsk,
  busy,
  onStop,
  askBeforeWrite,
}: {
  page: LaidPage;
  chapter?: Chapter;
  roman: string;
  bookTitle: string;
  number: number;
  side: "left" | "right";
  quill: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onSelect: (quote: string) => void;
  asks: PermissionAsk[];
  onAsk: (id: string, response: "once" | "always" | "reject") => void;
  busy: boolean;
  onStop: () => void;
  askBeforeWrite: boolean;
}) {
  const proseRef = useRef<HTMLDivElement>(null);
  const quotes = chapter?.notes.map((note) => note.quote) ?? [];
  const marks = highlightMap(page.lines, quotes);
  const empty = page.lines.every((line) => line.gap || !line.text);
  const heading = side === "left" ? `Chapter ${roman}  ·  ${displayTitle(chapter ?? fallbackChapter(page.chapterId))}` : bookTitle;

  return (
    <article className={`sheet ${side}`} data-side={side}>
      <header className="running">{heading}</header>
      <div
        className="prose"
        ref={proseRef}
        onMouseUp={() => {
          const text = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
          if (text.length > 1) onSelect(text);
        }}
      >
        {empty && side === "left" ? (
          <div className="opening">
            <p className="opening-kicker">Chapter {roman}</p>
            <h2>{chapter?.untitled ? "Untitled, in progress" : displayTitle(chapter ?? fallbackChapter(page.chapterId))}</h2>
            <Ornament />
          </div>
        ) : (
          page.lines.map((line, index) => <LineView key={index} line={line} marks={marks.get(index) ?? []} />)
        )}
      </div>
      <footer className="foot">
        {asks.map((ask) => (
          <p key={ask.id} className="ask">
            <span>{ask.title}</span>
            <button type="button" onClick={() => onAsk(ask.id, "once")}>
              Allow once
            </button>
            <span className="dot">·</span>
            <button type="button" onClick={() => onAsk(ask.id, "always")}>
              Always
            </button>
            <span className="dot">·</span>
            <button type="button" className="quiet" onClick={() => onAsk(ask.id, "reject")}>
              No
            </button>
          </p>
        ))}
        {page.footnotes.length > 0 && (
          <ol className="footnotes">
            {page.footnotes.map((note) => (
              <li key={note.id}>
                <span className="fn-num">{note.n}</span>
                <span>{note.text}</span>
              </li>
            ))}
          </ol>
        )}
        {quill && (
          <div className="quill-block">
            {page.footnotes.length === 0 && (quill || !empty) ? <Ornament /> : null}
            <textarea
              className="quill"
              aria-label="Write on the page"
              value={draft}
              rows={3}
              spellCheck
              autoFocus={chapter?.blocks.some((block) => block.id === "folio-first-page")}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const next = quillKey(draft, "Enter");
                if (next.submit) onSubmit(next.submit);
                else onDraft(next.value);
              }}
            />
            <p className="hint">
              {busy ? (
                <button type="button" className="hint-button" onClick={onStop}>
                  stop
                </button>
              ) : askBeforeWrite ? (
                "the press will ask before it writes  ·  return twice to send"
              ) : (
                "return twice to send  ·  or turn the page"
              )}
            </p>
          </div>
        )}
      </footer>
      <p className="folio-num">{number}</p>
    </article>
  );
}

function fallbackChapter(id: string): Chapter {
  return {
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
}

export function plateRoman(n: number): string {
  return toRoman(n);
}
