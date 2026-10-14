type IconProps = { className?: string };

export function IconBook({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h5.2A2.8 2.8 0 0 1 13 8.3V19a2.2 2.2 0 0 0-2.2-2.2H5z" />
      <path d="M19 5.5h-5.2A2.8 2.8 0 0 0 11 8.3V19a2.2 2.2 0 0 1 2.2-2.2H19z" />
    </svg>
  );
}

export function IconContents({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  );
}

export function IconType({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 12 6l5 11" />
      <path d="M8.6 13.5h6.8" />
    </svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12M6 12h12M6 16h12" />
    </svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="5.2" />
      <path d="M15.2 15.2 19 19" />
    </svg>
  );
}

export function IconRibbon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v16l-4-2.4L8 20z" />
    </svg>
  );
}

/** The fleuron between parts of a page. `draw` lets the pen trace it once, on the title page. */
export function Ornament({ draw = false }: { draw?: boolean }) {
  return (
    <svg className={`ornament ${draw ? "draw" : ""}`} viewBox="0 0 64 16" aria-hidden="true">
      <path pathLength={1} d="M32 8c-2-4-6-4-8 0 2 4 6 4 8 0Zm0 0c2-4 6-4 8 0-2 4-6 4-8 0Z" />
      <path pathLength={1} d="M8 8h14M42 8h14" />
    </svg>
  );
}

export function IconSun({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </svg>
  );
}

export function IconMoon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.5 15.2A7 7 0 0 1 9.3 5a7 7 0 1 0 8.2 10.2Z" />
      <path d="M17 4.5v3M15.5 6h3" />
    </svg>
  );
}

export function IconAuto({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path className="filled" d="M12 5a7 7 0 0 1 0 14Z" />
    </svg>
  );
}

export function IconGear({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.8v2.4M12 17.8v2.4M3.8 12h2.4M17.8 12h2.4M6.2 6.2l1.7 1.7M16.1 16.1l1.7 1.7M6.2 17.8l1.7-1.7M16.1 7.9l1.7-1.7" />
      <circle cx="12" cy="12" r="5.6" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 12.5 4 4 8-9" />
    </svg>
  );
}

export function IconBack({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14.5 6-6 6 6 6" />
    </svg>
  );
}
