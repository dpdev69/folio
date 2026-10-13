import { describe, expect, it } from "vitest";
import { PALETTE_KEYS, THEMES, themeById, themeVars, type Palette } from "./themes";

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme table", () => {
  it("has the six themes in card order", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["original", "quiet", "paper", "bold", "calm", "focus"]);
    expect(THEMES.map((theme) => theme.name)).toEqual(["Original", "Quiet", "Paper", "Bold", "Calm", "Focus"]);
  });

  it("gives every theme a full light and dark palette", () => {
    for (const theme of THEMES) {
      for (const palette of [theme.light, theme.dark] as Palette[]) {
        expect(Object.keys(palette).sort()).toEqual([...PALETTE_KEYS].sort());
        for (const key of PALETTE_KEYS) expect(palette[key], `${theme.id}.${key}`).toMatch(/\S/);
      }
    }
  });

  it("keeps the values the brief names", () => {
    expect(themeById("original").dark).toMatchObject({ page: "#1c1a17", "desk-1": "#111111", ink: "#e8e2d6" });
    expect(themeById("original").light).toMatchObject({ page: "#f4efe6", ink: "#2c261f" });
    expect(themeById("calm").light.page).toBe("#efe6d2");
    expect(themeById("calm").dark.page).toBe("#3a332b");
    expect(themeById("focus").light.page).toBe("#fbf7ec");
    expect(themeById("focus").dark.page).toBe("#2a2621");
    expect(themeById("focus").face).toContain("system-ui");
    expect(themeById("focus").leading).toBeGreaterThan(1);
    expect(themeById("quiet").weight).toBe(400);
    expect(themeById("bold").weight).toBe(600);
    expect(themeById("bold").light.ink).toBe("#000000");
    expect(themeById("bold").dark.ink).toBe("#ffffff");
    expect(themeById("paper").light.grain).not.toBe("transparent");
  });

  it("sets ink and soft text at 4.5:1 or better on every surface they sit on", () => {
    for (const theme of THEMES) {
      for (const appearance of ["light", "dark"] as const) {
        const p = theme[appearance];
        for (const surface of ["page", "page-2", "plate"] as const) {
          expect(contrast(p.ink, p[surface]), `${theme.id} ${appearance} ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.soft, p[surface]), `${theme.id} ${appearance} soft on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(p.ink, p.highlight), `${theme.id} ${appearance} ink on highlight`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.ink, p.add), `${theme.id} ${appearance} ink on add`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("falls back to Original for an unknown id", () => {
    expect(themeById("nope" as never).id).toBe("original");
  });

  it("turns a theme into CSS custom properties", () => {
    const vars = themeVars(themeById("focus"), "dark");
    expect(vars["--page"]).toBe("#2a2621");
    expect(vars["--face"]).toContain("system-ui");
    expect(vars["--weight"]).toBe("500");
  });
});
