// Design tokens: the one source of the look of the app (src/client/theme.ts, src/client/ui) and of the public site
// (src/worker/site/landing.css.ts). Neutral and precise: graphite greys, hairline borders, one accent. Nothing here may import
// from src/client or src/worker, because both sides import this file.
//
// Contrast (WCAG 2.2, measured for every pair below): text on surface 4.5:1 or more, control borders and the focus ring 3:1 or
// more, white on the accent 5.5:1. `border` and `borderStrong` only draw hairlines and cards; a control that needs to be found
// by its edge (field, checkbox, switch) uses `control`.

export interface Palette {
  /** The page behind the cards. */
  bg: string;
  /** Cards, panes, dialogs, menus. */
  surface: string;
  /** A fill inside a surface: table header, quiet button, hovered row. */
  raised: string;
  /** Hairlines between rows and around cards. */
  border: string;
  /** A hovered card, a secondary button edge. */
  borderStrong: string;
  /** The edge of a field, checkbox, radio and an off switch (3:1 on `surface`). */
  control: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  /** The accent when pressed or hovered as a button fill (white text stays above 4.5:1). */
  accentHover: string;
  /** A selected row, a quiet badge, an info banner. */
  accentSoft: string;
  /** The accent as text or an icon on `surface` and on `accentSoft` (4.5:1). */
  accentText: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  /** The starred-message star: a warm yellow that stays 3:1 on `surface` and on `accentSoft`. */
  star: string;
  /** Veil behind a modal. */
  scrim: string;
  /** Hover tint over any surface. */
  hover: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export const LIGHT: Palette = {
  bg: '#F7F7F8',
  surface: '#FFFFFF',
  raised: '#F3F4F6',
  border: '#E4E6EA',
  borderStrong: '#CBCFD6',
  control: '#8A909C',
  text: '#0F1115',
  text2: '#484E59',
  text3: '#646B77',
  accent: '#2F5BEA',
  accentHover: '#2449C7',
  accentSoft: '#EEF2FE',
  accentText: '#2349C9',
  danger: '#B42318',
  dangerSoft: '#FEF3F2',
  success: '#067647',
  successSoft: '#ECFDF3',
  warning: '#B54708',
  warningSoft: '#FFFAEB',
  star: '#B97800',
  scrim: 'rgba(15, 17, 21, 0.45)',
  hover: 'rgba(15, 17, 21, 0.05)',
  shadowSm: '0 1px 2px rgba(16, 24, 40, 0.05)',
  shadowMd: '0 4px 12px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.06)',
  shadowLg: '0 16px 40px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.08)'
};

export const DARK: Palette = {
  bg: '#0B0C0E',
  surface: '#121316',
  raised: '#1A1C20',
  border: '#25272D',
  borderStrong: '#363A42',
  control: '#7A808C',
  text: '#EDEEF0',
  text2: '#A9AEB8',
  text3: '#8A909B',
  accent: '#2F5BEA',
  accentHover: '#2749CE',
  accentSoft: '#172041',
  accentText: '#8DA7F8',
  danger: '#F97066',
  dangerSoft: '#2A1412',
  success: '#47CD89',
  successSoft: '#0F2A1E',
  warning: '#FEC84B',
  warningSoft: '#2E2310',
  star: '#F2B636',
  scrim: 'rgba(0, 0, 0, 0.6)',
  hover: 'rgba(255, 255, 255, 0.06)',
  shadowSm: '0 1px 0 rgba(255, 255, 255, 0.02)',
  shadowMd: '0 4px 16px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  shadowLg: '0 20px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)'
};

/**
 * Geist is the face of the product, served from this origin (public/fonts), never from a third party. The tail of the stack covers
 * what Geist does not: the system face of each platform (and its CJK faces for the Chinese pages).
 */
export const FONT_SANS =
  "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
export const FONT_MONO = "'Geist Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * Where the font files are (public/fonts, the SIL OFL 1.1 licence is beside them). One variable file per face covers weights 100-900 and
 * every Latin, Latin Extended and Vietnamese letter of the app and the site (measured: 163 of 163 non-CJK characters, the whole
 * U+00C0-U+1EF9 Vietnamese set). The version is in the file name, so a new release is a new URL and /fonts/* can be cached for a year.
 */
export const FONT_FILES = { sans: '/fonts/geist-sans-1.9.2.woff2', mono: '/fonts/geist-mono-1.9.2.woff2' } as const;

const fontFace = (family: string, url: string): string =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url('${url}') format('woff2')}`;

/** The `@font-face` rules of both faces, one per line. The app (the nm-tokens style) and the public site put this string in their own CSS. */
export const FONT_FACE_CSS = `${fontFace('Geist', FONT_FILES.sans)}\n${fontFace('Geist Mono', FONT_FILES.mono)}`;

/** Corner radii in px. A pill (999) is for avatars, switches and badges only. */
export const RADIUS = { control: 6, card: 8, dialog: 12, pill: 999 } as const;

/**
 * The type scale as [font-size px, line-height px]. Dense lists and tables use `sm`; fields are `md` (16 px on a phone so iOS does not
 * zoom). Vietnamese stacks two marks on one letter: a line height under 1.25 clips them, so no step goes below it.
 */
export const TYPE = {
  caption: [12, 16],
  sm: [13, 20],
  md: [14, 20],
  lg: [16, 24],
  h3: [18, 26],
  h2: [22, 30],
  h1: [28, 36]
} as const;

/** Control heights in px: dense desktop, default desktop, touch (phones, coarse pointers). */
export const CONTROL_HEIGHT = { sm: 32, md: 36, touch: 44 } as const;

/** Motion in ms. Under `prefers-reduced-motion` nothing moves (the app and the site both honour it). */
export const MOTION = { fast: 120, base: 160 } as const;

const kebab = (name: string): string => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The palette as CSS custom properties (`--surface`, `--border-strong`, `--accent-text`, ...), one declaration per line without braces,
 * so the caller puts them in the rule it needs (`:root`, `[data-theme='dark']`, a media query).
 */
export function paletteToCssVars(palette: Palette): string {
  // Every field of Palette is a string, but Object.entries of an interface says `any`.
  return (Object.entries(palette) as [string, string][]).map(([name, value]) => `--${kebab(name)}:${value}`).join(';');
}
