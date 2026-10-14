import { useRef } from "react";
import { highlightMap } from "../book/highlight";
import type { FormReply } from "../book/forms";
import type { Chapter, Footnote, Form, PermissionAsk, Plate } from "../book/model";
import { displayTitle } from "../book/model";
import type { LaidPage } from "../book/paginate";
import { quillKey } from "../book/quill";
import { toRoman } from "../book/model";
import { FormView } from "./Forms";
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
  forms = [],
  onFormSend = () => undefined,
  onFormSkip = () => undefined,
  slips = [],
  onOpenPlate = () => undefined,
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
  onAsk: (id: string, response: "once" | "reject") => void;
  /** Questions from the press, on the left page above the asks. */
  forms?: Form[];
  onFormSend?: (formId: string, answer: FormReply) => void;
  onFormSkip?: (formId: string) => void;
  /** Plates that face this page while its prose keeps it; each opens over the page. */
  slips?: Plate[];
  onOpenPlate?: (plateId: string) => void;
  busy: boolean;
  onStop: () => void;
  /** The chapter's own rules make the press ask before it writes. */
  askBeforeWrite: boolean;
}) {
  const proseRef = useRef<HTMLDivElement>(null);
  const quotes = chapter?.notes.map((note) => note.quote) ?? [];
  const marks = highlightMap(page.lines, quotes);
  const empty = page.lines.every((line) => line.gap || !line.text);
  const heading = side === "left" ? `Chapter ${roman}  ·  ${displayTitle(chapter ?? fallbackChapter(page.chapterId))}` : bookTitle;
  // A question from the press, or a passing remark such as a retry, takes the hint's place.
  const waiting = chapter?.forms.length ? "the press is waiting for your answer" : chapter?.notice;

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
        {forms.map((form) => (
          <FormView key={form.id} form={form} onSend={(answer) => onFormSend(form.id, answer)} onSkip={() => onFormSkip(form.id)} />
        ))}
        {asks.map((ask) => (
          <p key={ask.id} className="ask">
            <span>{ask.title}</span>
            <button type="button" onClick={() => onAsk(ask.id, "once")}>
              Allow once
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
                <FootnoteText note={note} onOpenPlate={onOpenPlate} />
              </li>
            ))}
          </ol>
        )}
        {slips.length === 1 ? (
          <p className="slip">
            <button type="button" onClick={() => onOpenPlate(slips[0].id)}>
              Plate {plateRoman(slips[0].n)} faces this page — open it
            </button>
          </p>
        ) : slips.length > 1 ? (
          <p className="slip">
            Plates {listed(slips.map((plate) => plateRoman(plate.n)))} face this page — open{" "}
            {slips.map((plate, index) => (
              <span key={plate.id}>
                {index ? " · " : null}
                <button type="button" aria-label={`Open Plate ${plateRoman(plate.n)}`} onClick={() => onOpenPlate(plate.id)}>
                  {plateRoman(plate.n)}
                </button>
              </span>
            ))}
          </p>
        ) : null}
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
                <>
                  {waiting ? `${waiting}  ·  ` : null}
                  <button type="button" className="hint-button" onClick={onStop}>
                    stop
                  </button>
                </>
              ) : waiting ? (
                waiting
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

/** "I and II", "I, II and III". */
function listed(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A footnote's "See Plate N →" opens that plate over the right page. */
function FootnoteText({ note, onOpenPlate }: { note: Footnote; onOpenPlate: (plateId: string) => void }) {
  const mark = note.plateId ? /See Plate [IVXLCDM]+ →$/.exec(note.text) : null;
  if (!mark || !note.plateId) return <span>{note.text}</span>;
  const plateId = note.plateId;
  return (
    <span>
      {note.text.slice(0, mark.index)}
      <button type="button" className="fn-plate" onClick={() => onOpenPlate(plateId)}>
        {mark[0]}
      </button>
    </span>
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
    forms: [],
    busy: false,
  };
}

export function plateRoman(n: number): string {
  return toRoman(n);
}
