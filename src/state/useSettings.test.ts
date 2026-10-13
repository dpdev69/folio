import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE_INDEX, SCALES } from "../ui/scales";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  reduceSettings,
  resolveAppearance,
  saveSettings,
  type Settings,
} from "./useSettings";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

describe("settings reducer", () => {
  it("starts on Original, automatic appearance, the default size", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: "original",
      appearance: "auto",
      scaleIndex: DEFAULT_SCALE_INDEX,
      lineSpacing: "normal",
      margins: "normal",
      justify: true,
    });
  });

  it("steps the text size one notch at a time and stops at both ends", () => {
    let s: Settings = DEFAULT_SETTINGS;
    s = reduceSettings(s, { type: "step", by: 1 });
    expect(s.scaleIndex).toBe(DEFAULT_SCALE_INDEX + 1);
    for (let i = 0; i < 10; i++) s = reduceSettings(s, { type: "step", by: 1 });
    expect(s.scaleIndex).toBe(SCALES.length - 1);
    const top = s;
    expect(reduceSettings(top, { type: "step", by: 1 })).toBe(top);
    for (let i = 0; i < 10; i++) s = reduceSettings(s, { type: "step", by: -1 });
    expect(s.scaleIndex).toBe(0);
    expect(reduceSettings(s, { type: "step", by: -1 })).toBe(s);
  });

  it("sets theme, appearance and the customize options", () => {
    let s = reduceSettings(DEFAULT_SETTINGS, { type: "theme", theme: "calm" });
    s = reduceSettings(s, { type: "appearance", appearance: "dark" });
    s = reduceSettings(s, { type: "lineSpacing", lineSpacing: "loose" });
    s = reduceSettings(s, { type: "margins", margins: "wide" });
    s = reduceSettings(s, { type: "justify", justify: false });
    expect(s).toEqual({
      theme: "calm",
      appearance: "dark",
      scaleIndex: DEFAULT_SCALE_INDEX,
      lineSpacing: "loose",
      margins: "wide",
      justify: false,
    });
  });

  it("resets the customize options and keeps theme, appearance and size", () => {
    const custom: Settings = {
      theme: "focus",
      appearance: "light",
      scaleIndex: 4,
      lineSpacing: "tight",
      margins: "narrow",
      justify: false,
    };
    expect(reduceSettings(custom, { type: "reset" })).toEqual({
      ...custom,
      lineSpacing: "normal",
      margins: "normal",
      justify: true,
    });
  });
});

describe("settings persistence", () => {
  it("round-trips through storage under folio.settings", () => {
    const storage = fakeStorage();
    const s: Settings = { theme: "paper", appearance: "dark", scaleIndex: 0, lineSpacing: "loose", margins: "wide", justify: false };
    saveSettings(storage, s);
    expect(storage.data.has(SETTINGS_KEY)).toBe(true);
    expect(SETTINGS_KEY).toBe("folio.settings");
    expect(loadSettings(storage)).toEqual(s);
  });

  it("falls back to defaults when storage is missing, empty, unreadable or garbled", () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: "{not json" }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: "null" }))).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps the good fields of a partly bad record", () => {
    const stored = JSON.stringify({ theme: "calm", appearance: "sepia", scaleIndex: 99, lineSpacing: "loose", margins: 3, justify: "yes" });
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: stored }))).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "calm",
      lineSpacing: "loose",
    });
    const fractional = JSON.stringify({ scaleIndex: 1.5 });
    expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: fractional })).scaleIndex).toBe(DEFAULT_SCALE_INDEX);
  });

  it("does not throw when storage refuses a write", () => {
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
    expect(() => saveSettings(null, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe("appearance", () => {
  it("follows the system only when set to automatic", () => {
    expect(resolveAppearance("auto", true)).toBe("dark");
    expect(resolveAppearance("auto", false)).toBe("light");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });
});
