import { describe, expect, it } from "vitest";
import { BOOK_HEIGHT, DEFAULT_SCALE_INDEX, FOOT_OVERHEAD, SCALES, bookHeight, footChars, footReserve, layoutScale, proseFont } from "./scales";
import { themeById } from "./themes";

const original = themeById("original");
const normal = { lineSpacing: "normal", margins: "normal" } as const;

describe("scales", () => {
  it("has five steps, growing, with the old middle size as the default", () => {
    expect(SCALES).toHaveLength(5);
    for (let i = 1; i < SCALES.length; i++) expect(SCALES[i].fontSize).toBeGreaterThan(SCALES[i - 1].fontSize);
    expect(SCALES[DEFAULT_SCALE_INDEX].fontSize).toBe(19);
  });

  it("leaves the scale alone at normal spacing and margins", () => {
    for (const base of SCALES) {
      const laid = layoutScale(base, normal, original);
      expect(laid).toMatchObject(base);
      expect(laid.marginX).toBe(48);
    }
  });

  it("opens and closes the leading inside the same page height", () => {
    for (const base of SCALES) {
      const budget = base.lines * base.lineHeight;
      const loose = layoutScale(base, { ...normal, lineSpacing: "loose" }, original);
      const tight = layoutScale(base, { ...normal, lineSpacing: "tight" }, original);
      expect(loose.lineHeight).toBeGreaterThan(base.lineHeight);
      expect(tight.lineHeight).toBeLessThan(base.lineHeight);
      expect(loose.lines).toBeLessThan(base.lines);
      expect(tight.lines).toBeGreaterThanOrEqual(base.lines);
      expect(loose.lines * loose.lineHeight).toBeLessThanOrEqual(budget);
      expect(tight.lines * tight.lineHeight).toBeLessThanOrEqual(budget);
    }
  });

  it("trades page margin for measure", () => {
    const base = SCALES[DEFAULT_SCALE_INDEX];
    const narrow = layoutScale(base, { ...normal, margins: "narrow" }, original);
    const wide = layoutScale(base, { ...normal, margins: "wide" }, original);
    expect(narrow.width).toBeGreaterThan(base.width);
    expect(narrow.marginX).toBeLessThan(48);
    expect(wide.width).toBeLessThan(base.width);
    expect(wide.marginX).toBeGreaterThan(48);
    // Every measure still fits a 540 px sheet inside its margins.
    for (const s of SCALES) {
      for (const margins of ["narrow", "normal", "wide"] as const) {
        const laid = layoutScale(s, { ...normal, margins }, original);
        expect(laid.width + 2 * laid.marginX).toBeLessThanOrEqual(540);
      }
    }
  });

  it("gives a short window fewer lines, and a tall one no more than the full page", () => {
    const base = SCALES[DEFAULT_SCALE_INDEX];
    const at = (height: number, width = 1280) => layoutScale(base, { ...normal, viewport: { width, height } }, original).lines;
    expect(at(820)).toBe(base.lines);
    expect(at(1400)).toBe(base.lines);
    expect(at(640)).toBeLessThan(base.lines);
    // Every pixel the book lacks comes out of the prose.
    const short = bookHeight({ width: 1280, height: 640 })!;
    expect(at(640)).toBe(Math.floor((base.lines * base.lineHeight - (BOOK_HEIGHT - short)) / base.lineHeight));
    expect(at(700)).toBeLessThan(base.lines);
    expect(at(300)).toBe(6);
    // Stacked sheets grow to fit, so a narrow window keeps the full page.
    expect(at(640, 800)).toBe(base.lines);
    for (const s of SCALES) {
      for (const lineSpacing of ["tight", "normal", "loose"] as const) {
        const laid = layoutScale(s, { lineSpacing, margins: "normal", viewport: { width: 1280, height: 700 } }, original);
        expect(laid.lines * laid.lineHeight).toBeLessThanOrEqual(s.lines * s.lineHeight - (BOOK_HEIGHT - 590));
      }
    }
  });

  it("gives Focus a little more leading", () => {
    const base = SCALES[DEFAULT_SCALE_INDEX];
    expect(layoutScale(base, normal, themeById("focus")).lineHeight).toBeGreaterThan(base.lineHeight);
  });

  it("measures prose in the theme's face and weight", () => {
    const base = SCALES[DEFAULT_SCALE_INDEX];
    expect(proseFont(base)).toBe('500 19px "EB Garamond", Palatino, "Palatino Linotype", serif');
    expect(proseFont(base, themeById("quiet"))).toMatch(/^400 19px "EB Garamond"/);
    expect(proseFont(base, themeById("bold"))).toMatch(/^600 19px "EB Garamond"/);
    expect(proseFont(base, themeById("focus"))).toMatch(/^500 19px -apple-system/);
  });
});

describe("the page foot", () => {
  const base = SCALES[DEFAULT_SCALE_INDEX];

  it("fits about sixty characters of footnote type to a line of the default measure", () => {
    expect(footChars(base)).toBe(Math.floor(386 / (15 * 0.46)));
    expect(footChars(base, 6.4)).toBe(60);
    expect(footChars(base, 1000)).toBe(24);
  });

  it("costs the footnotes' rule and each footnote's lines, and a line for each slip or ask", () => {
    const reserve = footReserve(60, 29);
    expect(reserve([], 0)).toBe(0);
    expect(reserve([], 2)).toBe(2);
    // 17 px of rule and spacing, then 15 px type at 1.35 with 3 px between notes: 43.25 px.
    expect(reserve([{ n: 1, text: "Read src/greet.ts." }], 0)).toBe(2);
    const long = { n: 2, text: "Edited /Users/someone/projects/a-long-name/src/greet.ts, 4 lines added. See Plate I →" };
    expect(reserve([long], 0)).toBe(3);
    expect(reserve([{ n: 1, text: "Read a." }, long], 1)).toBe(4);
    // Three short notes need more than three prose lines once the rule is counted.
    const three = [1, 2, 3].map((n) => ({ n, text: "Read a." }));
    expect(reserve(three, 0) * 29).toBeGreaterThanOrEqual(FOOT_OVERHEAD + 3 * (15 * 1.35 + 3));
    // A larger leading needs fewer of its lines for the same foot.
    expect(footReserve(60, 36)([long], 0)).toBeLessThanOrEqual(reserve([long], 0));
  });
});
