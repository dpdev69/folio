import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type RefObject } from "react";
import type { Appearance, Settings, SettingsAction } from "../state/useSettings";
import { IconAuto, IconBack, IconCheck, IconGear, IconMoon, IconSun } from "./icons";
import { SCALES, type LineSpacing, type Margins } from "./scales";
import { THEMES, type ResolvedAppearance } from "./themes";

const APPEARANCES: { value: Appearance; label: string; Icon: typeof IconSun }[] = [
  { value: "light", label: "Light", Icon: IconSun },
  { value: "dark", label: "Dark", Icon: IconMoon },
  { value: "auto", label: "Automatic", Icon: IconAuto },
];

const SPACINGS: { value: LineSpacing; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "loose", label: "Loose" },
];

const MARGINS: { value: Margins; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

type Props = {
  settings: Settings;
  dispatch: Dispatch<SettingsAction>;
  /** The appearance in effect, so the theme cards show what the page will look like. */
  appearance: ResolvedAppearance;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function SettingsPopover({ settings, dispatch, appearance, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [pane, setPane] = useState<"themes" | "customize">("themes");
  const [menuOpen, setMenuOpen] = useState(false);
  const current = APPEARANCES.find((item) => item.value === settings.appearance) ?? APPEARANCES[2];

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
        return;
      }
      anchor.current?.focus();
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, menuOpen, onClose]);

  // Arrow keys belong to the controls here, not to the page turner behind.
  const keepKeys = (event: KeyboardEvent) => {
    if (event.key.startsWith("Arrow")) event.stopPropagation();
  };

  return (
    <div
      className="settings-pop"
      role="dialog"
      aria-label="Themes & Settings"
      ref={ref}
      tabIndex={-1}
      onKeyDown={keepKeys}
      onPointerDown={(event) => {
        if (menuOpen && !(event.target as HTMLElement).closest(".appearance")) setMenuOpen(false);
      }}
    >
      <span className="settings-caret" aria-hidden="true" />
      <div className="settings-clip">
        <div className={`settings-track ${pane}`}>
          <section className="settings-pane" inert={pane !== "themes"}>
            <h2 className="settings-title">Themes &amp; Settings</h2>
            <div className="settings-row">
              <div className="size-seg" role="group" aria-label="Text size">
                <button
                  type="button"
                  aria-label="Smaller text"
                  disabled={settings.scaleIndex <= 0}
                  onClick={() => dispatch({ type: "step", by: -1 })}
                >
                  <span className="a-small">A</span>
                </button>
                <span className="seg-hair" aria-hidden="true" />
                <button
                  type="button"
                  aria-label="Larger text"
                  disabled={settings.scaleIndex >= SCALES.length - 1}
                  onClick={() => dispatch({ type: "step", by: 1 })}
                >
                  <span className="a-large">A</span>
                </button>
              </div>
              <div className="appearance">
                <button
                  type="button"
                  className="round-btn"
                  ref={menuButton}
                  aria-label={`Appearance: ${current.label}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <current.Icon />
                </button>
                {menuOpen ? (
                  <AppearanceMenu
                    value={settings.appearance}
                    onPick={(value) => {
                      dispatch({ type: "appearance", appearance: value });
                      setMenuOpen(false);
                      menuButton.current?.focus();
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="theme-grid" role="group" aria-label="Theme">
              {THEMES.map((theme) => {
                const palette = theme[appearance];
                const style: CSSProperties = { background: palette.page, color: palette.ink };
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className="theme-card"
                    style={style}
                    aria-pressed={settings.theme === theme.id}
                    onClick={() => dispatch({ type: "theme", theme: theme.id })}
                  >
                    <span className="theme-aa" style={{ fontFamily: theme.face, fontWeight: theme.weight }}>
                      Aa
                    </span>
                    <span className="theme-name">{theme.name}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="pill-btn" onClick={() => setPane("customize")}>
              <IconGear />
              Customize
            </button>
          </section>

          <section className="settings-pane" inert={pane !== "customize"}>
            <div className="settings-head">
              <button type="button" className="back-btn" aria-label="Back to themes" onClick={() => setPane("themes")}>
                <IconBack />
              </button>
              <h2 className="settings-title">Customize</h2>
            </div>
            <Choice
              label="Line spacing"
              options={SPACINGS}
              value={settings.lineSpacing}
              onPick={(lineSpacing) => dispatch({ type: "lineSpacing", lineSpacing })}
            />
            <Choice
              label="Margins"
              options={MARGINS}
              value={settings.margins}
              onPick={(margins) => dispatch({ type: "margins", margins })}
            />
            <div className="custom-row inline">
              <span id="justify-label">Justified text</span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-labelledby="justify-label"
                aria-checked={settings.justify}
                onClick={() => dispatch({ type: "justify", justify: !settings.justify })}
              >
                <span className="knob" />
              </button>
            </div>
            <button type="button" className="pill-btn" onClick={() => dispatch({ type: "reset" })}>
              Reset
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function AppearanceMenu({ value, onPick }: { value: Appearance; onPick: (value: Appearance) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, []);
  const move = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div className="appearance-menu" role="menu" aria-label="Appearance" ref={ref} onKeyDown={move}>
      {APPEARANCES.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          role="menuitemradio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          onClick={() => onPick(option)}
        >
          <span className="check">{value === option ? <IconCheck /> : null}</span>
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <div className="custom-row">
      <span>{label}</span>
      <div className="choice" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onPick(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
