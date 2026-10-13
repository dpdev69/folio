/**
 * The six reading themes. Each is a typeface plus a palette for the light and
 * the dark appearance; every colour in the app is drawn from these variables.
 */

export const PALETTE_KEYS = [
  "desk-0",
  "desk-1",
  "desk-2",
  "page",
  "page-2",
  "ink",
  "soft",
  "faint",
  "rule",
  "terra",
  "terra-deep",
  "ribbon",
  "quill",
  "highlight",
  "add",
  "plate",
  "plate-rule",
  "hint",
  "title",
  "chip",
  "grain",
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;
export type ThemeId = "original" | "quiet" | "paper" | "bold" | "calm" | "focus";
export type ResolvedAppearance = "light" | "dark";

export type Theme = {
  id: ThemeId;
  name: string;
  /** CSS font-family stack for prose. */
  face: string;
  weight: number;
  /** Line-height multiplier the theme asks for on top of the scale. */
  leading: number;
  light: Palette;
  dark: Palette;
};

export const SERIF = '"EB Garamond", Palatino, "Palatino Linotype", serif';
export const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';

const NO_GRAIN = "transparent";

export const THEMES: Theme[] = [
  {
    id: "original",
    name: "Original",
    face: SERIF,
    weight: 500,
    leading: 1,
    light: {
      "desk-0": "#ebe4d8", "desk-1": "#e3dbcf", "desk-2": "#d8cfc2",
      page: "#f4efe6", "page-2": "#f7f3ea",
      ink: "#2c261f", soft: "#5c5348", faint: "#9a8e80", rule: "#e4d9c8",
      terra: "#c45c38", "terra-deep": "#9a452c", ribbon: "#c44732", quill: "#1c3d72",
      highlight: "#f3c3ae", add: "#f8ebe4", plate: "#fbf8f2", "plate-rule": "#e7dccb",
      hint: "#c4b8a8", title: "#6e655c", chip: "#8ea0c0", grain: NO_GRAIN,
    },
    dark: {
      "desk-0": "#1a1816", "desk-1": "#111111", "desk-2": "#0b0a09",
      page: "#1c1a17", "page-2": "#211e1a",
      ink: "#e8e2d6", soft: "#b3a999", faint: "#7d7468", rule: "#39332b",
      terra: "#e0835f", "terra-deep": "#e89a7b", ribbon: "#b8442f", quill: "#9db8e8",
      highlight: "#6b3a26", add: "#33261f", plate: "#191714", "plate-rule": "#3a332b",
      hint: "#6f665a", title: "#a0968a", chip: "#6f84a8", grain: NO_GRAIN,
    },
  },
  {
    id: "quiet",
    name: "Quiet",
    face: SERIF,
    weight: 400,
    leading: 1,
    light: {
      "desk-0": "#dcdbd8", "desk-1": "#d3d2cf", "desk-2": "#c8c7c4",
      page: "#e9e8e5", "page-2": "#edecea",
      ink: "#45433f", soft: "#5f5c57", faint: "#9a9792", rule: "#d6d4d0",
      terra: "#a8664d", "terra-deep": "#8a4f3a", ribbon: "#a85a48", quill: "#3d5577",
      highlight: "#e3cfc4", add: "#e2e0dc", plate: "#f0efed", "plate-rule": "#d6d4d0",
      hint: "#aeaba6", title: "#77746f", chip: "#8d99ab", grain: NO_GRAIN,
    },
    dark: {
      "desk-0": "#1b1b1c", "desk-1": "#141415", "desk-2": "#0e0e0f",
      page: "#252527", "page-2": "#29292b",
      ink: "#bdbbb6", soft: "#9a9791", faint: "#6c6a66", rule: "#3a3a3c",
      terra: "#c98c74", "terra-deep": "#d4a08b", ribbon: "#9a5444", quill: "#9aaccb",
      highlight: "#4d3d36", add: "#2f302f", plate: "#222224", "plate-rule": "#3a3a3c",
      hint: "#5f5d5a", title: "#8d8a85", chip: "#6d7a90", grain: NO_GRAIN,
    },
  },
  {
    id: "paper",
    name: "Paper",
    face: SERIF,
    weight: 500,
    leading: 1,
    light: {
      "desk-0": "#efebe3", "desk-1": "#e7e2d8", "desk-2": "#dcd6cb",
      page: "#fbf9f4", "page-2": "#fdfcf8",
      ink: "#1a1714", soft: "#4e4842", faint: "#958d83", rule: "#e7e1d6",
      terra: "#b8552f", "terra-deep": "#8f3f22", ribbon: "#b9402c", quill: "#1a3768",
      highlight: "#f4cdb8", add: "#f6ece4", plate: "#fffefb", "plate-rule": "#e7e1d6",
      hint: "#bdb4a7", title: "#6a625a", chip: "#8b9cbc", grain: "rgba(96, 72, 40, 0.22)",
    },
    dark: {
      "desk-0": "#171513", "desk-1": "#100f0e", "desk-2": "#0a0909",
      page: "#201e1b", "page-2": "#24221e",
      ink: "#ebe6dc", soft: "#b6ad9f", faint: "#807769", rule: "#3b362f",
      terra: "#e08a65", "terra-deep": "#eaa184", ribbon: "#b5462f", quill: "#a3bce6",
      highlight: "#6a3f2b", add: "#322a22", plate: "#1c1a17", "plate-rule": "#3b362f",
      hint: "#6e665b", title: "#a59c8f", chip: "#7286aa", grain: "rgba(255, 240, 220, 0.1)",
    },
  },
  {
    id: "bold",
    name: "Bold",
    face: SERIF,
    weight: 600,
    leading: 1,
    light: {
      "desk-0": "#ebe8e3", "desk-1": "#e2ded8", "desk-2": "#d6d1ca",
      page: "#fdfcfa", "page-2": "#ffffff",
      ink: "#000000", soft: "#3a3530", faint: "#7a7269", rule: "#ddd6cb",
      terra: "#b2471f", "terra-deep": "#8a3412", ribbon: "#b8311c", quill: "#102d63",
      highlight: "#f2b89f", add: "#f7e6dc", plate: "#ffffff", "plate-rule": "#d9d0c3",
      hint: "#9c9287", title: "#4e4740", chip: "#6d82ab", grain: NO_GRAIN,
    },
    dark: {
      "desk-0": "#0c0b0b", "desk-1": "#060606", "desk-2": "#000000",
      page: "#121110", "page-2": "#161514",
      ink: "#ffffff", soft: "#d2cbc0", faint: "#8f877c", rule: "#3a352f",
      terra: "#f0916a", "terra-deep": "#f5a98a", ribbon: "#c64a33", quill: "#b5cbf2",
      highlight: "#7a3a22", add: "#2e231c", plate: "#0f0e0d", "plate-rule": "#3a352f",
      hint: "#7d756a", title: "#c3bbaf", chip: "#8399c2", grain: NO_GRAIN,
    },
  },
  {
    id: "calm",
    name: "Calm",
    face: SERIF,
    weight: 500,
    leading: 1,
    light: {
      "desk-0": "#e2d6bd", "desk-1": "#d9ccb1", "desk-2": "#ccbea2",
      page: "#efe6d2", "page-2": "#f2eadb",
      ink: "#4a3a2a", soft: "#6a5844", faint: "#a08c72", rule: "#dccfb5",
      terra: "#b0603a", "terra-deep": "#8c4a2a", ribbon: "#b5503a", quill: "#2d4470",
      highlight: "#eec3a5", add: "#e9dcc3", plate: "#f5eee0", "plate-rule": "#dccfb5",
      hint: "#b9a78d", title: "#7a6650", chip: "#8a96b0", grain: NO_GRAIN,
    },
    dark: {
      "desk-0": "#2c2620", "desk-1": "#241f1a", "desk-2": "#1b1713",
      page: "#3a332b", "page-2": "#3e372e",
      ink: "#e6d7bf", soft: "#c9b89f", faint: "#8e7d66", rule: "#4d443a",
      terra: "#e39a72", "terra-deep": "#ebb08f", ribbon: "#b9583e", quill: "#aac0e0",
      highlight: "#6e4a33", add: "#463c31", plate: "#352f28", "plate-rule": "#4d443a",
      hint: "#7d6e5b", title: "#b7a68e", chip: "#8496b5", grain: NO_GRAIN,
    },
  },
  {
    id: "focus",
    name: "Focus",
    face: SANS,
    weight: 500,
    leading: 1.06,
    light: {
      "desk-0": "#ece6d8", "desk-1": "#e4ddcd", "desk-2": "#d8d0be",
      page: "#fbf7ec", "page-2": "#fdfaf2",
      ink: "#26231e", soft: "#57514a", faint: "#978f83", rule: "#e8e1d1",
      terra: "#bf5a36", "terra-deep": "#94432a", ribbon: "#c1462f", quill: "#1d3c70",
      highlight: "#f3cab3", add: "#f6ece0", plate: "#fffcf5", "plate-rule": "#e6dece",
      hint: "#bfb6a6", title: "#6a6259", chip: "#8a9cbd", grain: NO_GRAIN,
    },
    dark: {
      "desk-0": "#1e1b17", "desk-1": "#171411", "desk-2": "#100e0c",
      page: "#2a2621", "page-2": "#2e2a24",
      ink: "#ece4d4", soft: "#bdb2a0", faint: "#847a6c", rule: "#433d35",
      terra: "#e28d68", "terra-deep": "#eba487", ribbon: "#b9492f", quill: "#a6bde4",
      highlight: "#6b432d", add: "#3a3129", plate: "#26221e", "plate-rule": "#433d35",
      hint: "#756c60", title: "#b0a594", chip: "#7d90b2", grain: NO_GRAIN,
    },
  },
];

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** The theme as CSS custom properties, ready for `style.setProperty`. */
export function themeVars(theme: Theme, appearance: ResolvedAppearance): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of PALETTE_KEYS) vars[`--${key}`] = theme[appearance][key];
  vars["--face"] = theme.face;
  vars["--weight"] = String(theme.weight);
  return vars;
}
