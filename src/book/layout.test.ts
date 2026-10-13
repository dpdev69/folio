import { describe, expect, it } from "vitest";
import { committedPrefix, paginateChapter, type LaidLine, type LaidPage } from "./paginate";
import { sampleBook, SAMPLE_BREAKS } from "./sample";
import { revealNextLine, wrapParagraph } from "./wrap";
import type { Chapter } from "./model";

const measure = (text: string) => text.length;

function chapter(text: string): Chapter {
  return {
    id: "c",
    title: "A chapter",
    untitled: false,
    blocks: [{ id: "b", voice: "prose", text }],
    footnotes: [],
    plates: [],
    notes: [],
    asks: [],
    busy: false,
  };
}

describe("pagination", () => {
  it("gives the first paragraph a drop cap and keeps earlier pages when the tail grows", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const short = paginateChapter(chapter(words), {
      measure,
      width: 40,
      linesPerPage: 6,
      dropLines: 3,
      dropWidth: 4,
    });
    const longer = paginateChapter(chapter(`${words} extra words that continue the paragraph`), {
      measure,
      width: 40,
      linesPerPage: 6,
      dropLines: 3,
      dropWidth: 4,
    });
    expect(short.length).toBeGreaterThan(1);
    expect(short[0].lines[0].drop).toBe("w");
    expect(short[0].lines[0].besideDrop).toBe(true);
    expect(JSON.stringify(short[0])).toBe(JSON.stringify(longer[0]));
    expect(longer.length).toBeGreaterThanOrEqual(short.length);
  });

  it("hangs a footnote on the line that contains its mark", () => {
    const text = "Alpha beta gamma delta epsilon zeta eta theta.";
    const laid = paginateChapter(
      {
        ...chapter(text),
        footnotes: [{ id: "f", n: 1, blockId: "b", offset: text.length, text: "Ran the suite." }],
      },
      { measure, width: 20, linesPerPage: 8, dropLines: 2, dropWidth: 3 },
    );
    const page = laid.find((p) => p.footnotes.length);
    expect(page?.footnotes[0].text).toBe("Ran the suite.");
    expect(page?.lines.some((line) => line.notes.includes(1))).toBe(true);
  });

  it("starts the sample's tool scene on its own spread", () => {
    const book = sampleBook();
    const iv = book.chapters.find((c) => c.id === "ch-iv")!;
    const pages = paginateChapter(iv, {
      measure,
      width: 48,
      linesPerPage: 10,
      dropLines: 3,
      dropWidth: 4,
      breaksBefore: SAMPLE_BREAKS["ch-iv"],
    });
    const toolPage = pages.find((p) => p.footnotes.length > 0);
    expect(toolPage?.footnotes.map((f) => f.n)).toEqual([1, 2, 3, 4]);
    expect(toolPage?.lines.some((line) => line.plates.includes("plate-3"))).toBe(true);
  });
});

describe("reveal", () => {
  it("advances by a line and then stops at the end", () => {
    const full = "one two three four five six seven eight nine ten";
    const next = revealNextLine(full, "", measure, 12);
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThan(full.length);
    expect(revealNextLine(full, full, measure, 12)).toBe(full);
  });
});

describe("wrap", () => {
  it("does not justify a one-word last line", () => {
    const lines = wrapParagraph({ text: "Hello there friend", measure, width: 12 });
    expect(lines[lines.length - 1].justify).toBe(false);
    expect(lines.slice(0, -1).every((line) => line.justify)).toBe(true);
  });
});

describe("streaming stability", () => {
  const opts = { measure, width: 40, linesPerPage: 6, dropLines: 3, dropWidth: 4 };
  const words = Array.from({ length: 120 }, (_, i) => `word${i}${i % 9 === 8 ? "." : ""}`);

  function streaming(tail: string): Chapter {
    return {
      ...chapter(""),
      blocks: [
        { id: "a", voice: "prose", text: "The test failed only on the build server, and nowhere else." },
        { id: "q", voice: "ink", text: "Why only there?" },
        { id: "b", voice: "prose", text: tail },
      ],
      footnotes: [{ id: "f", n: 1, blockId: "a", offset: 20, text: "Ran the suite." }],
    };
  }

  function flat(pages: LaidPage[]): LaidLine[] {
    return pages.flatMap((page) => page.lines);
  }

  it("never moves a laid line or page while the last block grows word by word", () => {
    // Deltas split words, as the press does: "wor" then "d12".
    const deltas: string[] = [];
    words.forEach((word, i) => {
      const lead = i === 0 ? "" : i === 60 ? "\n\n" : " ";
      deltas.push(lead + word.slice(0, 3), word.slice(3));
    });
    let text = "";
    let before = paginateChapter(streaming(text), opts);
    for (const delta of deltas) {
      text += delta;
      const after = paginateChapter(streaming(text), opts);
      expect(after.length).toBeGreaterThanOrEqual(before.length);
      expect(committedPrefix(before, after)).toBe(Math.max(0, before.length - 1));
      const old = flat(before);
      const now = flat(after);
      old.slice(0, -1).forEach((line, i) => expect(now[i]).toEqual(line));
      before = after;
    }
    expect(before.length).toBeGreaterThan(3);
  });

  it("does not wrap earlier blocks again when only the tail grows", () => {
    const seen: string[] = [];
    const counting = (text: string) => {
      seen.push(text);
      return text.length;
    };
    const tail = words.slice(0, 30).join(" ");
    paginateChapter(streaming(tail), { ...opts, measure: counting });
    seen.length = 0;
    paginateChapter(streaming(`${tail} ${words[30]}`), { ...opts, measure: counting });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((text) => text.includes("build server") || text.includes("only there"))).toBe(false);
  });

  it("keeps cached lines clean when a footnote hangs on them", () => {
    const text = "Alpha beta gamma delta epsilon zeta eta theta.";
    const withNote = {
      ...chapter(text),
      footnotes: [{ id: "f", n: 1, blockId: "b", offset: 9999, text: "Ran the suite." }],
    };
    const noted = paginateChapter(withNote, opts);
    expect(noted.flatMap((p) => p.lines).some((line) => line.notes.includes(1))).toBe(true);
    const plain = paginateChapter(chapter(text), opts);
    expect(plain.flatMap((p) => p.lines).every((line) => line.notes.length === 0)).toBe(true);
  });
});
