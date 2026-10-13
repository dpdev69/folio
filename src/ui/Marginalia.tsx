import { useEffect, useState } from "react";
import type { MarginNote } from "../book/model";
import { quillKey } from "../book/quill";

const CHIPS = ["why", "shorter", "another way", "yes"];

export function MarginaliaPage({
  notes,
  draft,
  onDraft,
  onSubmit,
  onChip,
  onReplace,
  onKeep,
  onClose,
  number,
}: {
  notes: MarginNote[];
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (prompt: string) => void;
  onChip: (prompt: string) => void;
  onReplace: (id: string) => void;
  onKeep: (id: string) => void;
  onClose: () => void;
  number: number;
}) {
  const [tops, setTops] = useState<number[]>([]);
  useEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".sheet.left");
    const spread = document.querySelector<HTMLElement>(".book");
    if (!sheet || !spread) return;
    const root = spread.getBoundingClientRect();
    const next = notes.map((note) => {
      const mark = sheet.querySelector<HTMLElement>(`[data-quote="${cssEscape(note.quote.slice(0, 24))}"]`);
      if (!mark) return 120;
      return mark.getBoundingClientRect().top - root.top;
    });
    setTops(next);
  }, [notes]);

  return (
    <article className="sheet right margin-sheet">
      <header className="running">
        Marginalia
        <button type="button" className="textish close-margin" onClick={onClose}>
          close
        </button>
      </header>
      <div className="margin-notes">
        {notes.map((note, index) => (
          <section key={note.id} className="margin-note" style={{ marginTop: index === 0 ? Math.max(8, (tops[index] ?? 90) - 88) : 28 }}>
            <p className="ink-line">{note.prompt}</p>
            {note.reply ? <p className="margin-reply">{note.reply}</p> : <p className="margin-reply pending">The margin is listening…</p>}
            {note.reply && !note.kept && !note.replaced ? (
              <p className="plate-actions">
                <button type="button" onClick={() => onReplace(note.id)}>
                  Replace passage
                </button>
                <span>·</span>
                <button type="button" onClick={() => onKeep(note.id)}>
                  keep both
                </button>
              </p>
            ) : null}
          </section>
        ))}
        <label className="margin-draft">
          <textarea
            className="quill"
            aria-label="Note in the margin"
            value={draft}
            rows={2}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const next = quillKey(draft, "Enter");
              if (next.submit) onSubmit(next.submit);
              else onDraft(next.value);
            }}
          />
        </label>
      </div>
      <p className="chips">
        {CHIPS.map((chip, index) => (
          <span key={chip}>
            {index > 0 ? <span className="chip-gap"> </span> : null}
            <button type="button" className="chip" onClick={() => onChip(chip)}>
              {chip === "why" ? "?why" : chip}
            </button>
          </span>
        ))}
      </p>
      <p className="folio-num">{number}</p>
    </article>
  );
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
