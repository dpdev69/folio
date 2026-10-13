import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE_INDEX, SCALES, layoutScale, proseFont } from "./scales";
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
