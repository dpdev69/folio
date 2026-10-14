import { describe, expect, it } from "vitest";
import { followTail, relocate } from "./nav";

describe("following the tail across several spreads", () => {
  // One chapter id per laid page; two pages make a spread.
  const before = ["i", "i", "ii", "ii", "ii", "ii"];

  it("goes to the chapter's last spread when it grew by more than one spread in one layout", () => {
    const after = [...before, "ii", "ii", "ii", "ii", "ii", "ii"];
    expect(followTail(before, after, 2)).toBe(5);
  });

  it("still turns one spread when the chapter grew by one", () => {
    expect(followTail(before, [...before, "ii", "ii"], 2)).toBe(3);
  });

  it("goes to the chapter's last spread, not past it into the next chapter", () => {
    const middle = ["i", "i", "i", "ii", "ii", "ii"];
    const grown = ["i", "i", "i", "i", "i", "i", "i", "ii", "ii", "ii"];
    expect(followTail(middle, grown, 1)).toBe(3);
  });

  it("stays when the reader was not on the chapter's last spread", () => {
    expect(followTail(before, [...before, "ii", "ii", "ii", "ii"], 1)).toBeNull();
  });
});

describe("following the tail past a full right page", () => {
  it("does not turn to the quill's blank spread until lines land on its left page", () => {
    const before = ["c", "c"];
    const after = ["c", "c", "c", "c"];
    expect(followTail(before, after, 0, [true, true], [true, true, false, false])).toBeNull();
    expect(followTail(before, after, 0, [true, true], [true, true, true, false])).toBe(1);
  });

  it("still follows when the reader is on the last spread with lines and a blank spread follows it", () => {
    const before = ["c", "c", "c", "c"];
    const after = ["c", "c", "c", "c", "c", "c"];
    expect(followTail(before, after, 0, [true, true, false, false], [true, true, true, true, true, false])).toBe(2);
  });
});

describe("keeping the reader's place when the book is laid again", () => {
  const line = (blockId: string, plainStart: number) => ({ blockId, plainStart });
  const page = (...lines: { blockId: string; plainStart: number }[]) => ({ chapterId: "i", lines });
  const pageIn = (chapterId: string, ...lines: { blockId: string; plainStart: number }[]) => ({ chapterId, lines });
  const blank = (chapterId: string) => ({ chapterId, lines: [] });

  it("finds the spread that now holds the first line the reader had in front of them", () => {
    // Short pages: the reader is on spread 2, which begins at offset 80 of block b.
    const before = [page(line("a", 0)), page(line("a", 40)), page(line("b", 0)), page(line("b", 40)), page(line("b", 80)), page(line("b", 120))];
    // Long pages: offset 80 now falls on page 1 (which runs from 60).
    const after = [page(line("a", 0), line("a", 40)), page(line("b", 0), line("b", 60)), page(line("b", 120))];
    expect(relocate(before, after, 2)).toBe(0);
    expect(relocate(after, before, 0)).toBe(0);
    expect(relocate(after, before, 1)).toBe(2);
  });

  it("keeps a spread with no lines inside the book", () => {
    const before = Array.from({ length: 8 }, () => blank("i"));
    expect(relocate(before, [blank("i"), blank("i")], 3)).toBe(0);
    expect(relocate(before, before, 3)).toBe(3);
  });

  it("keeps a spread with no lines in its own chapter, at the same offset from the chapter's start", () => {
    // Chapter i fills two spreads and its quill waits on a blank third; chapter ii follows.
    const before = [page(line("a", 0)), page(line("a", 40)), page(line("a", 80)), page(line("a", 120)), blank("i"), blank("i"), pageIn("ii", line("z", 0)), pageIn("ii", line("z", 40))];
    // Taller pages: chapter i now takes one spread plus its blank one, and chapter ii starts on spread 2.
    const after = [page(line("a", 0), line("a", 40)), page(line("a", 80), line("a", 120)), blank("i"), blank("i"), pageIn("ii", line("z", 0), line("z", 40)), blank("ii")];
    // The blank spread was chapter i's third (offset 2); chapter i now ends on spread 1, so it lands there, not in chapter ii.
    expect(relocate(before, after, 2)).toBe(1);
    // An empty chapter keeps its own first spread.
    const empty = [page(line("a", 0)), page(line("a", 40)), blank("ii"), blank("ii"), pageIn("iii", line("z", 0)), blank("iii")];
    const emptyAfter = [page(line("a", 0), line("a", 40)), blank("i"), blank("ii"), blank("ii"), pageIn("iii", line("z", 0)), blank("iii")];
    expect(relocate(empty, emptyAfter, 1)).toBe(1);
  });
});
