import { describe, expect, it } from "vitest";
import { committedPrefix, paginateChapter, type LaidLine, type LaidPage } from "./paginate";
import { sampleBook, SAMPLE_BREAKS } from "./sample";
import { revealNextLine, wrapParagraph } from "./wrap";
import type { Book, Chapter, Footnote } from "./model";
import { applyEvent } from "./events";

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
    forms: [],
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

describe("room for the foot", () => {
  const footChars = 20;
  const footLines = (notes: Footnote[], extra: number) =>
    notes.reduce((sum, note) => sum + Math.ceil(note.text.length / footChars), 0) + extra;
  const opts = { measure, width: 40, linesPerPage: 8, dropLines: 3, dropWidth: 4, footLines };
  const words = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `word${i + from}`).join(" ");

  /** A slip names the plates of a spread on its right page. */
  function slipOn(pages: LaidPage[], index: number): number {
    if (index % 2 === 0) return 0;
    return [pages[index], pages[index - 1]].some((page) => page?.footnotes.some((note) => note.plateId)) ? 1 : 0;
  }

  function fits(pages: LaidPage[]) {
    pages.forEach((page, index) => {
      expect(page.lines.length + footLines(page.footnotes, slipOn(pages, index))).toBeLessThanOrEqual(opts.linesPerPage);
    });
  }

  it("gives each footnote's lines back to the page it hangs on", () => {
    const text = words(70);
    const note: Footnote = { id: "f", n: 1, blockId: "b", offset: 30, text: "x".repeat(50) };
    const plain = paginateChapter(chapter(text), opts);
    const noted = paginateChapter({ ...chapter(text), footnotes: [note] }, opts);
    expect(plain[0].lines).toHaveLength(8);
    expect(noted[0].footnotes.map((f) => f.id)).toEqual(["f"]);
    expect(noted[0].lines).toHaveLength(8 - 3);
    expect(noted[1].lines[0]).toEqual(plain[0].lines[5]);
    fits(noted);
  });

  it("counts the slip on the right page of a spread that shows a plate", () => {
    const text = words(120);
    const note: Footnote = { id: "f", n: 1, blockId: "b", offset: 10, text: "Edited a.", plateId: "plate-1" };
    const laid = paginateChapter({ ...chapter(text), footnotes: [note] }, opts);
    expect(laid[0].lines).toHaveLength(7);
    expect(laid[1].footnotes).toEqual([]);
    expect(laid[1].lines).toHaveLength(7);
    expect(laid[2].lines).toHaveLength(8);
    fits(laid);
  });

  it("moves a footnote added past the text to the next page with the line it hangs on", () => {
    const text = words(40);
    const plain = paginateChapter(chapter(text), opts);
    expect(plain).toHaveLength(1);
    expect(plain[0].lines).toHaveLength(8);
    const note: Footnote = { id: "f", n: 1, blockId: "b", offset: 9999, text: "x".repeat(60) };
    const laid = paginateChapter({ ...chapter(text), footnotes: [note] }, opts);
    expect(laid).toHaveLength(2);
    expect(laid[0].footnotes).toEqual([]);
    expect(laid[1].footnotes.map((f) => f.id)).toEqual(["f"]);
    expect(laid[1].lines.at(-1)?.notes).toContain(1);
    expect([...laid[0].lines, ...laid[1].lines].map((line) => line.text)).toEqual(plain[0].lines.map((line) => line.text));
    fits(laid);
  });

  it("never moves a line on an earlier page when a footnote lands on the page being written", () => {
    const lead = words(60);
    const deltas = Array.from({ length: 60 }, (_, i) => ` more${i}`);
    let tail = "";
    let before = paginateChapter(streamingNote(lead, tail, false), opts);
    for (const [i, delta] of deltas.entries()) {
      tail += delta;
      const landed = i >= 20;
      const after = paginateChapter(streamingNote(lead, tail, landed), opts);
      const page = after.findIndex((p) => p.footnotes.length > 0);
      const stable = landed && page >= 0 ? page : after.length - 1;
      for (let p = 0; p < Math.min(stable, before.length - 1); p++) expect(after[p]).toEqual(before[p]);
      fits(after);
      before = after;
    }
    expect(before.some((page) => page.footnotes.length > 0)).toBe(true);

    function streamingNote(a: string, b: string, withNote: boolean): Chapter {
      return {
        ...chapter(""),
        blocks: [
          { id: "a", voice: "prose", text: a },
          { id: "b", voice: "prose", text: b },
        ],
        footnotes: withNote ? [{ id: "t", n: 1, blockId: "b", offset: " more0".repeat(20).length, text: "Ran the whole suite again." }] : [],
      };
    }
  });

  it("keeps the streaming guarantee with the foot reserved", () => {
    const deltas = Array.from({ length: 300 }, (_, i) => (i === 0 ? "w0" : ` w${i}`));
    const shape = (tail: string): Chapter => ({
      ...chapter(""),
      blocks: [
        { id: "a", voice: "prose", text: "The test failed only on the build server, and nowhere else." },
        { id: "b", voice: "prose", text: tail },
      ],
      footnotes: [{ id: "f", n: 1, blockId: "a", offset: 20, text: "Ran the suite forty times, and three of them failed." }],
    });
    let tail = "";
    let before = paginateChapter(shape(tail), opts);
    for (const delta of deltas) {
      tail += delta;
      const after = paginateChapter(shape(tail), opts);
      expect(committedPrefix(before, after)).toBe(Math.max(0, before.length - 1));
      before = after;
    }
    expect(before.length).toBeGreaterThan(3);
    fits(before);
  });
});

describe("adopted footnotes", () => {
  const opts = { measure, width: 40, linesPerPage: 6, dropLines: 3, dropWidth: 4 };

  function pressed(lead: string): Chapter[] {
    const shell: Book = { id: "b", title: "b", directory: "/b", sample: false, chapters: [chapter("")] };
    shell.chapters[0] = { ...shell.chapters[0], blocks: [] };
    const frame = (type: string, data: Record<string, unknown>) => ({
      type,
      data: { sessionID: "c", assistantMessageID: "m", ...data },
    });
    let book = applyEvent(shell, frame("session.tool.input.started", { id: "t", name: "bash" }));
    book = applyEvent(book, frame("session.tool.called", { id: "t", input: {} }));
    const steps: Chapter[] = [];
    for (let i = 0; i < 60; i++) {
      const delta = i === 0 ? `${lead}word${i}` : ` word${i}`;
      book = applyEvent(book, frame("session.text.delta", { ordinal: 0, delta }));
      steps.push(book.chapters[0]);
    }
    return steps;
  }

  function where(chapterNow: Chapter): [number, number][] {
    const pages = paginateChapter(chapterNow, opts);
    return pages.flatMap((page, p) =>
      page.lines.flatMap((line, l) => (line.notes.includes(1) ? [[p, l] as [number, number]] : [])),
    );
  }

  it.each([
    ["under the drop cap", ""],
    ["after leading blank lines", "\n\n"],
  ])("stays on the first line %s while the text grows", (_name, lead) => {
    const steps = pressed(lead);
    expect(steps[0].footnotes[0]).toMatchObject({ blockId: "m:t0", offset: 0 });
    for (const step of steps) expect(where(step)).toEqual([[0, 0]]);
    expect(paginateChapter(steps[steps.length - 1], opts).length).toBeGreaterThan(1);
  });
});
