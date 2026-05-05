interface ActionGlyphProps {
  className?: string;
}

export function CheckGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

export function ChevronDownGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronUpGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

export function ClockGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  );
}

export function ExternalLinkGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function MoreGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

export function PinGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14 4l6 6" />
      <path d="M9 14 4 19" />
      <path d="M10 4h7l3 3-7 7v5l-2 1-7-7 1-2h5z" />
    </svg>
  );
}

export function PlusGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function RefreshGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 12a8 8 0 0 1-13.66 5.66" />
      <path d="M4 12A8 8 0 0 1 17.66 6.34" />
      <path d="M17 3v4h-4" />
      <path d="M7 21v-4h4" />
    </svg>
  );
}

export function RepositoryGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h14" />
      <path d="M8 4v4" />
      <path d="M8 10v4" />
      <path d="M8 16v4" />
    </svg>
  );
}

export function RetryGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}

export function SourceGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 5h9a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4 4z" />
      <path d="M9 10h5" />
      <path d="M9 14h4" />
    </svg>
  );
}

export function TrashGlyph({ className }: ActionGlyphProps) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
