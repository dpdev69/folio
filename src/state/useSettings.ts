import { useEffect, useLayoutEffect, useReducer, useState } from "react";
import { DEFAULT_SCALE_INDEX, SCALES, type LineSpacing, type Margins } from "../ui/scales";
import { isThemeId, themeById, themeVars, type ResolvedAppearance, type ThemeId } from "../ui/themes";

export type Appearance = "light" | "dark" | "auto";

export type Settings = {
  theme: ThemeId;
  appearance: Appearance;
  scaleIndex: number;
  lineSpacing: LineSpacing;
  margins: Margins;
  justify: boolean;
};

export type SettingsAction =
  | { type: "theme"; theme: ThemeId }
  | { type: "appearance"; appearance: Appearance }
  | { type: "step"; by: 1 | -1 }
  | { type: "lineSpacing"; lineSpacing: LineSpacing }
  | { type: "margins"; margins: Margins }
  | { type: "justify"; justify: boolean }
  | { type: "reset" };

export const SETTINGS_KEY = "folio.settings";

const CUSTOM_DEFAULTS = { lineSpacing: "normal", margins: "normal", justify: true } as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "original",
  appearance: "auto",
  scaleIndex: DEFAULT_SCALE_INDEX,
  ...CUSTOM_DEFAULTS,
};

export function reduceSettings(state: Settings, action: SettingsAction): Settings {
  switch (action.type) {
    case "theme":
      return { ...state, theme: action.theme };
    case "appearance":
      return { ...state, appearance: action.appearance };
    case "step": {
      const scaleIndex = Math.max(0, Math.min(SCALES.length - 1, state.scaleIndex + action.by));
      return scaleIndex === state.scaleIndex ? state : { ...state, scaleIndex };
    }
    case "lineSpacing":
      return { ...state, lineSpacing: action.lineSpacing };
    case "margins":
      return { ...state, margins: action.margins };
    case "justify":
      return { ...state, justify: action.justify };
    case "reset":
      return { ...state, ...CUSTOM_DEFAULTS };
  }
}

export function resolveAppearance(appearance: Appearance, prefersDark: boolean): ResolvedAppearance {
  if (appearance === "auto") return prefersDark ? "dark" : "light";
  return appearance;
}

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadSettings(storage: Store | null): Settings {
  let raw: unknown;
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    if (!text) return DEFAULT_SETTINGS;
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const index = r.scaleIndex;
  return {
    theme: isThemeId(r.theme) ? r.theme : DEFAULT_SETTINGS.theme,
    appearance: pick(r.appearance, ["light", "dark", "auto"] as const, DEFAULT_SETTINGS.appearance),
    scaleIndex:
      typeof index === "number" && Number.isInteger(index) && index >= 0 && index < SCALES.length
        ? index
        : DEFAULT_SETTINGS.scaleIndex,
    lineSpacing: pick(r.lineSpacing, ["tight", "normal", "loose"] as const, DEFAULT_SETTINGS.lineSpacing),
    margins: pick(r.margins, ["narrow", "normal", "wide"] as const, DEFAULT_SETTINGS.margins),
    justify: typeof r.justify === "boolean" ? r.justify : DEFAULT_SETTINGS.justify,
  };
}

export function saveSettings(storage: Store | null, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A full or private store only costs us remembering; the page still reads.
  }
}

function browserStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const apply = () => setDark(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return dark;
}

/** Reading settings: read once from storage, saved on change, painted onto <html>. */
export function useSettings() {
  const [settings, dispatch] = useReducer(reduceSettings, null, () => loadSettings(browserStorage()));
  const prefersDark = usePrefersDark();
  const appearance = resolveAppearance(settings.appearance, prefersDark);
  const theme = themeById(settings.theme);

  useEffect(() => saveSettings(browserStorage(), settings), [settings]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.dataset.appearance = appearance;
    root.style.colorScheme = appearance;
    for (const [name, value] of Object.entries(themeVars(theme, appearance))) root.style.setProperty(name, value);
  }, [theme, appearance]);

  return { settings, dispatch, theme, appearance };
}
