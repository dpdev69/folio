import type { Plate } from "../book/model";
import { plateRoman } from "./Page";

export function PlatePage({
  plate,
  bookTitle,
  number,
  onAccept,
  onRevise,
  onReject,
  onFold,
  folded,
}: {
  plate: Plate;
  bookTitle: string;
  number: number;
  onAccept: () => void;
  onRevise: () => void;
  onReject: () => void;
  onFold: () => void;
  folded?: boolean;
}) {
  return (
    <article className="sheet right plate-sheet">
      <header className="running">Plates</header>
      <div className="plate">
        <p className="plate-kicker">
          {bookTitle} · Plate {plateRoman(plate.n)}
        </p>
        <h2 className="plate-title">{plate.title}</h2>
        {folded ? (
          <>
            <p className="fig">Folded back into the chapter.</p>
            <p className="plate-actions">
              <button type="button" onClick={onFold}>
                Open the plate
              </button>
            </p>
          </>
        ) : null}
        {folded ? null : (
        <>
        <div className="plate-frame">
          {plate.lines.length === 0 ? (
            <p className="plate-empty">The plate is still being set.</p>
          ) : (
            <ol className="diff">
              {plate.lines.map((line, index) => (
                <li key={index} className={`diff-line ${line.kind}`}>
                  <span className="ln">{line.kind === "add" ? line.newNo : line.oldNo}</span>
                  <code>{line.text || " "}</code>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="fig">{plate.caption}</p>
        {plate.status === "open" ? (
          <p className="plate-actions">
            <button type="button" onClick={onAccept}>
              Accept
            </button>
            <span>·</span>
            <button type="button" onClick={onRevise}>
              Revise
            </button>
            <span>·</span>
            <button type="button" onClick={onReject}>
              Reject
            </button>
            <span>·</span>
            <button type="button" onClick={onFold}>
              Fold back
            </button>
          </p>
        ) : (
          <p className="fig settled">{plate.status === "accepted" ? "Set in the repository." : "Reverted."}</p>
        )}
        </>
        )}
      </div>
      <p className="folio-num">{number}</p>
    </article>
  );
}
