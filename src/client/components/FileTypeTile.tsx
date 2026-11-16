import type React from 'react';
import type { ThemeTokens } from '../theme';
import { getFileChip } from '../theme';
import './fileTile.css';

interface FileTypeTileProps {
  /** The type word read from the file's name (`fileTypeOf`: PDF, DOCX, XLSX...). */
  type: string;
  t: ThemeTokens;
  /** md: 40 px (the reader's attachment cards); sm: 34 px (the compose's file chips). */
  size?: 'sm' | 'md';
}

/**
 * The type tile of a file: ONE look for the reader's attachment cards and the compose's file chips (J3-15). The hue of the type comes from
 * the theme (`getFileChip`); the light theme takes it as it is, the dark one mixes a quarter of it over --raised with a hairline of the same
 * hue (fileTile.css), so a PDF reads as the same red tile in both places and never as a muddy badge. Decoration: the file's name says the
 * type to a screen reader (aria-hidden).
 */
export function FileTypeTile({ type, t, size = 'md' }: FileTypeTileProps): React.ReactElement {
  const chip = getFileChip(type, t);
  return (
    <span
      aria-hidden="true"
      className="ft-tile"
      data-size={size}
      data-long={type.length > 3 ? '' : undefined}
      style={{ '--type-bg': chip.bg, '--type-fg': chip.fg } as React.CSSProperties}
    >
      {type}
    </span>
  );
}
