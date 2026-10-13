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

export function Ornament() {
  return (
    <svg className="ornament" viewBox="0 0 64 16" aria-hidden="true">
      <path d="M32 8c-2-4-6-4-8 0 2 4 6 4 8 0Zm0 0c2-4 6-4 8 0-2 4-6 4-8 0Z" />
      <path d="M8 8h14M42 8h14" />
    </svg>
  );
}
