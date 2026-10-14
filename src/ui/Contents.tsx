import { displayTitle, toRoman, type Book } from "../book/model";
import { Ornament } from "./icons";

export function Contents({
  book,
  chapterStart,
  currentId,
  onJump,
}: {
  book: Book;
  chapterStart: Record<string, number>;
  currentId?: string;
  onJump: (spread: number) => void;
}) {
  return (
    <div className="book single" role="main">
      <article className="sheet left contents">
        <header className="running">{book.title}</header>
        <h2>Contents</h2>
        <Ornament />
        <ol className="toc">
          {book.chapters.map((chapter, index) => {
            const page = (chapterStart[chapter.id] ?? 0) + 1;
            const here = chapter.id === currentId;
            return (
              <li key={chapter.id} style={{ ["--i" as string]: Math.min(index, 12) }}>
                <button type="button" onClick={() => onJump(Math.floor((chapterStart[chapter.id] ?? 0) / 2))}>
                  <span>{toRoman(index + 1)}</span>
                  <span className={`toc-title ${here ? "here" : chapter.untitled ? "untitled" : ""}`}>
                    {displayTitle(chapter)}
                    <span className="lead" />
                  </span>
                  <span className="num">{page}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </article>
    </div>
  );
}
