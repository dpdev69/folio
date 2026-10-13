import type { LaidLine } from "../book/paginate";

type Range = [number, number];

export function LineView({ line, marks }: { line: LaidLine; marks: Range[] }) {
  if (line.gap) return <div className="line gap" />;
  const pieces = segments(line.text, line.italics, marks);
  const quoted = pieces
    .filter((piece) => piece.mark)
    .map((piece) => piece.text)
    .join("")
    .slice(0, 24);
  const body = (
    <span className="line-text">
      {pieces.map((piece, index) => (
        <span key={index} className={pieceClass(piece)}>
          {piece.text}
        </span>
      ))}
      {line.notes.map((n) => (
        <sup key={n} className="fn-mark">
          {n}
        </sup>
      ))}
    </span>
  );
  return (
    <div
      className={`line ${line.justify ? "justify" : "ragged"} ${line.voice} ${line.besideDrop ? "beside" : ""} ${line.drop ? "with-drop" : ""}`}
      data-quote={quoted || undefined}
    >
      {line.drop ? <span className="drop">{line.drop}</span> : null}
      {body}
    </div>
  );
}

function pieceClass(piece: { italic: boolean; mark: boolean }): string {
  return [piece.italic ? "em" : "", piece.mark ? "hl" : ""].filter(Boolean).join(" ");
}

function segments(text: string, italics: Range[], marks: Range[]): { text: string; italic: boolean; mark: boolean }[] {
  const cuts = new Set<number>([0, text.length]);
  for (const [from, to] of [...italics, ...marks]) {
    cuts.add(clamp(from, 0, text.length));
    cuts.add(clamp(to, 0, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; italic: boolean; mark: boolean }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    out.push({
      text: text.slice(from, to),
      italic: italics.some(([a, b]) => from >= a && to <= b),
      mark: marks.some(([a, b]) => from >= a && to <= b),
    });
  }
  return out.length ? out : [{ text, italic: false, mark: false }];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
