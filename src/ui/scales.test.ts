import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCALE_INDEX,
  DESK_OVERHEAD,
  FOOT_OVERHEAD,
  GAP_LINE,
  INK_LEADING,
  PAGE_OVERHEAD,
  QUILL_HEIGHT,
  SCALES,
  SLIP_AFTER_NOTES,
  SLIP_ALONE,
  bookHeight,
  footChars,
  footReserve,
  wrappedLines,
  layoutScale,
  proseFont,
  proseHeight,
} from "./scales";
import { themeById } from "./themes";

const original = themeById("original");
const normal = { lineSpacing: "normal", margins: "normal" } as const;

describe("scales", () => {
  it("has five steps, growing, with the old middle size as the default", () => {
    expect(SCALES).toHaveLength(5);
    for (let i = 1; i < SCALES.length; i++) expect(SCALES[i].fontSize).toBeGreaterThan(SCALES[i - 1].fontSize);
    expect(SCALES[DEFAULT_SCALE_INDEX].fontSize).toBe(19);
  });

  const desk = { width: 1280, height: 840 };

  it("leaves the type alone at normal spacing and margins", () => {
    for (const base of SCALES) {
      const laid = layoutScale(base, { ...normal, viewport: desk }, original);
      expect(laid).toMatchObject({ ...base, lines: laid.lines });
      expect(laid.marginX).toBe(48);
    }
  });

  it("opens and closes the leading inside the same page height", () => {
    const room = proseHeight(bookHeight(desk)!);
    for (const base of SCALES) {
      const plain = layoutScale(base, { ...normal, viewport: desk }, original);
      const loose = layoutScale(base, { ...normal, lineSpacing: "loose", viewport: desk }, original);
      const tight = layoutScale(base, { ...normal, lineSpacing: "tight", viewport: desk }, original);
      expect(loose.lineHeight).toBeGreaterThan(base.lineHeight);
      expect(tight.lineHeight).toBeLessThan(base.lineHeight);
      expect(loose.lines).toBeLessThan(plain.lines);
      expect(tight.lines).toBeGreaterThan(plain.lines);
      for (const laid of [plain, loose, tight]) expect(laid.lines * laid.lineHeight).toBeLessThanOrEqual(room);
    }
  });

  it("keeps the measure inside a narrow window's sheet", () => {
    for (const s of SCALES) {
      for (const margins of ["narrow", "normal", "wide"] as const) {
        for (const width of [1000, 1012, 1280]) {
          const laid = layoutScale(s, { ...normal, margins, viewport: { width, height: 800 } }, original);
          const sheet = Math.min(1080, width - 48) / 2;
          expect(laid.width + 2 * laid.marginX).toBeLessThanOrEqual(sheet);
        }
      }
    }
    // At 1000 px wide the default measure (386) gives way to the sheet's content box (476 - 96).
    expect(layoutScale(SCALES[DEFAULT_SCALE_INDEX], { ...normal, viewport: { width: 1000, height: 665 } }, original).width).toBe(380);
    // Stacked sheets keep the scale's measure.
    expect(layoutScale(SCALES[DEFAULT_SCALE_INDEX], { ...normal, viewport: { width: 800, height: 665 } }, original).width).toBe(386);
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

  it("fills the page the window gives it", () => {
    const base = SCALES[DEFAULT_SCALE_INDEX];
    const laid = (height: number, width = 1280) => layoutScale(base, { ...normal, viewport: { width, height } }, original);
    const at = (height: number, width = 1280) => laid(height, width).lines;
    // The book takes the window's height less the chrome, until a sheet is 1.55 times its width.
    expect(bookHeight({ width: 1280, height: 840 })).toBe(840 - DESK_OVERHEAD);
    expect(bookHeight({ width: 1600, height: 1400 })).toBe(540 * 1.55);
    expect(bookHeight({ width: 1000, height: 1400 })).toBe(((1000 - 48) / 2) * 1.55);
    // Lines are the sheet's prose room in whole lines.
    expect(at(840)).toBe(Math.floor((840 - DESK_OVERHEAD - PAGE_OVERHEAD) / base.lineHeight));
    expect(at(665, 1000)).toBeGreaterThan(base.lines);
    // A taller window gives more lines, a shorter one fewer, until the sheet's cap.
    expect(at(1000)).toBeGreaterThan(at(840));
    expect(at(640)).toBeLessThan(at(840));
    expect(at(1400)).toBe(at(2000));
    expect(at(300)).toBe(6);
    // Stacked sheets grow to fit, so a narrow window keeps the scale's own count and no quill reserve.
    expect(at(640, 800)).toBe(base.lines);
    expect(laid(640, 800).quillLines).toBe(0);
    expect(laid(640, 800).pageRoom).toBe(base.lines);
    for (const s of SCALES) {
      for (const lineSpacing of ["tight", "normal", "loose"] as const) {
        for (const viewport of [desk, { width: 1000, height: 665 }, { width: 1600, height: 1000 }, { width: 1100, height: 560 }]) {
          const page = layoutScale(s, { lineSpacing, margins: "normal", viewport }, original);
          expect(page.lines * page.lineHeight).toBeLessThanOrEqual(proseHeight(bookHeight(viewport)!));
          if (page.lines > 6) expect((page.lines + 1) * page.lineHeight).toBeGreaterThan(proseHeight(bookHeight(viewport)!));
          expect(page.quillLines * page.lineHeight).toBeCloseTo(QUILL_HEIGHT);
          expect(page.gapWeight).toBe(GAP_LINE);
          expect(page.pageRoom).toBeGreaterThanOrEqual(page.lines);
          expect(page.pageRoom).toBeLessThan(page.lines + 1);
          expect(page.inkWeight * page.lineHeight).toBeCloseTo(s.inkSize * INK_LEADING);
        }
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
    // Only nine tenths of the foot's width is counted, for word breaks and the number column.
    expect(footChars(base)).toBe(Math.floor((386 * 0.9) / (15 * 0.46)));
    expect(footChars(base, 6.4)).toBe(54);
    expect(footChars(base, 1000)).toBe(24);
  });

  it("wraps a footnote at word breaks, a word longer than a line on lines of its own", () => {
    const note = "1  Edited /Users/someone/projects/a-long-name/src/greet.ts, 4 lines added. See Plate I →";
    // At 49 characters the path will not join "Edited": "1 Edited" / the path / the rest.
    expect(wrappedLines(note, 49)).toBe(3);
    expect(Math.ceil(note.length / 49)).toBe(2);
    expect(wrappedLines(note, 60)).toBe(2);
    expect(wrappedLines("", 30)).toBe(1);
    expect(wrappedLines("short words only", 30)).toBe(1);
    // 70 characters in one word over 30-character lines: three lines, then the next word fits after it.
    expect(wrappedLines(`a ${"x".repeat(70)} b`, 30)).toBe(4);
    expect(wrappedLines(`${"x".repeat(70)} b`, 30)).toBe(3);
  });

  it("costs the footnotes' rule and each footnote's lines, and a line for each slip or ask", () => {
    const reserve = footReserve(60, 29);
    expect(reserve([], 0)).toBe(0);
    // A slip alone has its own rule above it; below footnotes it has only a little margin.
    expect(reserve([], 2)).toBeCloseTo((2 * SLIP_ALONE) / 29);
    expect(SLIP_ALONE).toBeCloseTo(35.25);
    expect(SLIP_AFTER_NOTES).toBeCloseTo(23.25);
    // 17 px of rule and spacing, then 15 px type at 1.35 with 3 px between notes: 43.25 px, in lines of 29 px.
    const line = 15 * 1.35;
    const short = reserve([{ n: 1, text: "Read src/greet.ts." }], 0);
    expect(short).toBeCloseTo((FOOT_OVERHEAD + 3 + line + 3) / 29);
    const long = { n: 2, text: "Edited /Users/someone/projects/a-long-name/src/greet.ts, 4 lines added. See Plate I →" };
    // Two lines of footnote type.
    expect(reserve([long], 0)).toBeCloseTo((FOOT_OVERHEAD + 3 + 2 * line + 3) / 29);
    expect(reserve([long], 0)).toBeGreaterThan(short);
    expect(reserve([{ n: 1, text: "Read a." }, long], 1)).toBeCloseTo((FOOT_OVERHEAD + 3 + 3 * line + 6 + SLIP_AFTER_NOTES) / 29);
    expect(reserve([{ n: 1, text: "Read a." }, long], 0)).toBeGreaterThan(reserve([long], 0));
    // Three short notes need more than three prose lines once the rule is counted.
    const three = [1, 2, 3].map((n) => ({ n, text: "Read a." }));
    expect(reserve(three, 0) * 29).toBeGreaterThanOrEqual(FOOT_OVERHEAD + 3 * (15 * 1.35 + 3));
    // A larger leading needs fewer of its lines for the same foot.
    expect(footReserve(60, 36)([long], 0)).toBeLessThan(reserve([long], 0));
  });
});
