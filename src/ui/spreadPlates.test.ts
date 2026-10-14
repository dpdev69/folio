import { describe, expect, it } from "vitest";
import type { Chapter, Footnote, Plate } from "../book/model";
import type { LaidLine, LaidPage } from "../book/paginate";
import { platesOnPages } from "./spreadPlates";

const plate = (id: string, n: number): Plate => ({
  id,
  n,
  file: `${id}.ts`,
  title: id,
  caption: "",
  lines: [],
  additions: 0,
  deletions: 0,
  status: "open",
  folded: false,
});

const chapter = (id: string, plates: Plate[]): Chapter => ({
  id,
  title: id,
  untitled: false,
  blocks: [],
  footnotes: [],
  plates,
  notes: [],
  asks: [],
  forms: [],
  busy: false,
});

const note = (plateId: string): Footnote => ({ id: `fn-${plateId}`, n: 1, blockId: "b", offset: 0, text: "", plateId });
const line = (plates: string[]): LaidLine => ({ plates }) as unknown as LaidLine;
const page = (chapterId: string, footnotes: Footnote[], lines: LaidLine[] = []): LaidPage => ({ chapterId, footnotes, lines });

const one = chapter("one", [plate("a", 1), plate("b", 2), plate("c", 3)]);
const two = chapter("two", [plate("d", 4), plate("e", 5)]);

describe("platesOnPages", () => {
  it("finds a spread's plates in plate order within one chapter", () => {
    const plates = platesOnPages([one, two], page("one", [note("c")]), page("one", [note("a")]));
    expect(plates.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("finds the right page's plates in its own chapter when a spread straddles two", () => {
    const plates = platesOnPages([one, two], page("one", [note("b")]), page("two", [note("e"), note("d")]));
    expect(plates.map((p) => p.id)).toEqual(["b", "d", "e"]);
  });

  it("reads plates marked on lines as well as footnotes, and lists each once", () => {
    const plates = platesOnPages([one, two], page("one", [note("a")], [line(["a", "b"])]), page("one", [note("b")]));
    expect(plates.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("finds nothing for pages whose chapter is gone", () => {
    expect(platesOnPages([], page("one", [note("a")]), page("two", [note("d")]))).toEqual([]);
  });
});
