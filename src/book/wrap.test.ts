import { describe, expect, it } from "vitest";
import { wrapCacheSize, wrapParagraphCached, type Measure } from "./wrap";

/** A fresh measure per test, so each has a cache of its own; it counts its calls. */
function counter(): { measure: Measure; calls: () => number } {
  let n = 0;
  return {
    measure: (text: string) => {
      n += 1;
      return text.length;
    },
    calls: () => n,
  };
}

describe("the wrap cache", () => {
  const text = "The same words set twice in one chapter.";

  it("keeps two paragraphs with the same text but different marks", () => {
    const { measure, calls } = counter();
    const first = { text, measure, width: 20, marks: [{ offset: 3, n: 1 }] };
    const second = { text, measure, width: 20, marks: [{ offset: 3, n: 2 }] };
    wrapParagraphCached(first);
    wrapParagraphCached(second);
    expect(wrapCacheSize(measure)).toBe(2);
    const before = calls();
    expect(wrapParagraphCached(first)[0].notes).toEqual([1]);
    expect(wrapParagraphCached(second)[0].notes).toEqual([2]);
    expect(calls()).toBe(before);
  });

  it("keeps two paragraphs with the same text but different italics", () => {
    const { measure, calls } = counter();
    wrapParagraphCached({ text, measure, width: 20, italics: [[0, 3]] });
    wrapParagraphCached({ text, measure, width: 20, italics: [[4, 8]] });
    expect(wrapCacheSize(measure)).toBe(2);
    const before = calls();
    wrapParagraphCached({ text, measure, width: 20, italics: [[0, 3]] });
    expect(calls()).toBe(before);
  });

  it("still lets a growing paragraph replace its shorter self, with its marks kept and an open italic run grown", () => {
    const { measure } = counter();
    wrapParagraphCached({ text: "The same", measure, width: 20, italics: [[4, 8]], marks: [{ offset: 3, n: 1 }] });
    wrapParagraphCached({ text: "The same words", measure, width: 20, italics: [[4, 14]], marks: [{ offset: 3, n: 1 }] });
    wrapParagraphCached({
      text: "The same words set",
      measure,
      width: 20,
      italics: [[4, 14]],
      marks: [
        { offset: 3, n: 1 },
        { offset: 18, n: 2 },
      ],
    });
    expect(wrapCacheSize(measure)).toBe(1);
  });

  it("does not take a longer text for the same paragraph when an earlier mark is gone", () => {
    const { measure } = counter();
    wrapParagraphCached({ text: "The same", measure, width: 20, marks: [{ offset: 3, n: 1 }] });
    wrapParagraphCached({ text: "The same words", measure, width: 20, marks: [{ offset: 3, n: 4 }] });
    expect(wrapCacheSize(measure)).toBe(2);
  });
});
