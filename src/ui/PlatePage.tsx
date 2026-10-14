import type { PermissionAsk, Plate } from "../book/model";
import { plateRoman } from "./Page";

/**
 * A plate on the right page. An open plate can be accepted, revised, rejected
 * or folded back; one the press is still asking about is allowed once or
 * declined instead.
 */
export function PlatePage({
  plate,
  bookTitle,
  number,
  ask,
  onAsk,
  onAccept,
  onRevise,
  onReject,
  onFold,
  folded,
}: {
  plate: Plate;
  bookTitle: string;
  number: number;
  /** The permission ask that holds this plate's edit, while it waits. */
  ask?: PermissionAsk;
  onAsk?: (decision: "once" | "reject") => void;
  onAccept: () => void;
  onRevise: () => void;
  onReject: () => void;
  onFold: () => void;
  folded?: boolean;
}) {
  const roman = plateRoman(plate.n);
  return (
    <article className="sheet right plate-sheet">
      <header className="running">
        Plate {roman} · {plate.file} · +{plate.additions} −{plate.deletions}
      </header>
      <div className="plate">
        <p className="plate-kicker">{bookTitle}</p>
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
        ) : (
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
            {ask && onAsk ? (
              <>
                <p className="fig">{ask.title}</p>
                <p className="plate-actions">
                  <button type="button" onClick={() => onAsk("once")}>
                    Allow once
                  </button>
                  <span>·</span>
                  <button type="button" onClick={() => onAsk("reject")}>
                    No
                  </button>
                  <span>·</span>
                  <button type="button" onClick={onFold}>
                    Fold back
                  </button>
                </p>
              </>
            ) : (
              <>
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
                  <>
                    <p className="fig settled">{plate.status === "accepted" ? "Set in the repository." : "Reverted."}</p>
                    <p className="plate-actions">
                      <button type="button" onClick={onFold}>
                        Fold back
                      </button>
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      <p className="folio-num">{number}</p>
    </article>
  );
}
