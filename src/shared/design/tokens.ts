// Design tokens: the one source of the look of the app (src/client/theme.ts, src/client/ui) and of the public site
// (src/worker/site/landing.css.ts). Neutral and precise: graphite greys, hairline borders, one accent. Nothing here may import
// from src/client or src/worker, because both sides import this file.
//
// Contrast (WCAG 2.2, measured for every pair below; test/client/ui-theme.test.ts computes them again): text on surface 4.5:1 or
// more, control borders, the focus ring and the indicators 3:1 or more on every surface they sit on, white on the accent 5.5:1.
// `border` and `borderStrong` only draw hairlines and cards; a control that needs to be found by its edge (field, checkbox, switch)
// uses `control`.
//
// The public site reads every palette value, MOTION and the fonts: a value it reads changes only on purpose (`control` was 2.99:1 on
// `bg` in light and moved to 3.71:1). Looks that only the app needs are NEW fields (both palettes), never a re-tuned old one.

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
  /**
   * The keyboard focus ring (2 px, 2 px away). 3:1 or more on bg, surface, raised, accentSoft and chrome in both themes (light 4.93-5.52,
   * dark 5.80-7.26); the dark accent was 2.88:1 on dark accentSoft, so the ring has its own lighter blue there.
   */
  focus: string;
  /** Selection bars, the active tab line, the active folder bar, the unread dot, progress: 3:1 on accentSoft (4.93 / 4.36) and surface. */
  indicator: string;
  /** Text and icons on an accent fill (a primary button): 5.52:1 on accent, 7.2:1 or more on accentHover. */
  onAccent: string;
  /** The window ground of the app behind the rounded content sheet (the sidebar sits on it). text3 on it: 4.79 light, 6.21 dark. */
  chrome: string;
  /**
   * Top and bottom stops of a tactile secondary button (the landing's `.btn`): surface to raised in light; in dark a step ABOVE raised, so a
   * button still stands out of a dialog (raised) and never reads as a field well (surface). Dark: text 11.7 / 13.5, danger 4.9 / 5.6.
   */
  btnTop: string;
  btnBottom: string;
  /** The edge of a secondary button: decoration (its words name it), lighter than `control` in light, a step lifted in dark. */
  btnEdge: string;
  /** The 1 px inset highlight along the top edge of a tactile control, a card and a dialog. */
  insetHighlight: string;
  /** The soft accent shadow under a primary button (one restrained glow). */
  accentGlow: string;
  /** A pressed control sinks: the inset shadow it takes while held. */
  pressShadow: string;
  /** The small drop shadow under a tactile control at rest (a secondary button, a switch thumb). */
  controlShadow: string;
  /** The 1 px inset shade along the top inside edge of a field, a track or a well: it reads as recessed. */
  fieldShadow: string;
  /** Menus, popovers, the list of a Select and tooltips: a layered soft shadow (the landing's `.pop`). */
  popShadow: string;
  /** The rounded content sheet that holds the list and the reader on the window ground. */
  sheetShadow: string;
}

export const LIGHT: Palette = {
  bg: '#F7F7F8',
  surface: '#FFFFFF',
  raised: '#F3F4F6',
  border: '#E4E6EA',
  borderStrong: '#CBCFD6',
  control: '#7A808A',
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
  shadowLg: '0 16px 40px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.08)',
  focus: '#2F5BEA',
  indicator: '#2F5BEA',
  onAccent: '#FFFFFF',
  chrome: '#F1F2F4',
  btnTop: '#FFFFFF',
  btnBottom: '#F3F4F6',
  btnEdge: '#CBCFD6',
  insetHighlight: 'rgba(255, 255, 255, 0.85)',
  accentGlow: 'rgba(47, 91, 234, 0.32)',
  pressShadow: 'inset 0 1px 2px rgba(15, 17, 21, 0.14)',
  controlShadow: '0 1px 2px rgba(15, 17, 21, 0.08)',
  fieldShadow: 'inset 0 1px 2px rgba(15, 17, 21, 0.05)',
  popShadow: '0 12px 32px -6px rgba(15, 17, 21, 0.14), 0 2px 6px rgba(15, 17, 21, 0.06)',
  sheetShadow: '0 1px 2px rgba(15, 17, 21, 0.04), 0 12px 32px -12px rgba(15, 17, 21, 0.1)'
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
  shadowLg: '0 20px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
  focus: '#7B98F5',
  indicator: '#5A7FF2',
  onAccent: '#FFFFFF',
  chrome: '#08090B',
  btnTop: '#2B2E35',
  btnBottom: '#212328',
  btnEdge: '#555A63',
  insetHighlight: 'rgba(255, 255, 255, 0.1)',
  accentGlow: 'rgba(47, 91, 234, 0.3)',
  pressShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
  controlShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
  fieldShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.35)',
  popShadow: '0 16px 40px -8px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  sheetShadow: '0 0 0 1px rgba(255, 255, 255, 0.03), 0 12px 40px -12px rgba(0, 0, 0, 0.7)'
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

/** Corner radii in px. A pill (999) is for avatars, switches and badges only; `popup` (10) for menus, popovers and select lists. */
export const RADIUS = { control: 6, card: 8, popup: 10, dialog: 12, pill: 999 } as const;

/**
 * The type scale as [font-size px, line-height px]. Dense lists and tables use `sm`; fields are `md` (16 px on a phone so iOS does not
 * zoom). Vietnamese stacks two marks on one letter: a line height under 1.25 clips them, so no step goes below it. `display` is for the
 * heading of a full-page screen (sign in, status). Letters sit -0.01em closer from 16 px up and -0.02em from 22 px up.
 */
export const TYPE = {
  caption: [12, 16],
  sm: [13, 20],
  md: [14, 20],
  lg: [16, 24],
  h3: [18, 26],
  h2: [22, 30],
  h1: [28, 36],
  display: [32, 40]
} as const;

/** Control heights in px: dense desktop, default desktop, touch (phones, coarse pointers). */
export const CONTROL_HEIGHT = { sm: 32, md: 36, touch: 44 } as const;

/** Motion in ms of the public site (its hover transitions). Under `prefers-reduced-motion` nothing moves there. The app uses DURATION. */
export const MOTION = { fast: 120, base: 160 } as const;

/**
 * The durations of the app's motion in ms (research/02-motion-system: Carbon, Fluent, Material 3). micro: press feedback; fast: hover and
 * focus fades, tooltips; quick: small moves (switch thumb, star, menu exit); base: menus, tabs indicator, row collapse, toast; gentle:
 * dialog enter, list fade-in; slow: drawer, sheet, compose; slower: the phone's full-screen compose (the ceiling); flight: the send flight
 * (decorative, never blocking). An exit takes 0.7 of its enter (`exitDuration`). Reduced motion caps every one at `quick` and keeps only
 * fades (index.css).
 */
export const DURATION = { micro: 70, fast: 110, quick: 150, base: 200, gentle: 250, slow: 300, slower: 400, flight: 480 } as const;

/**
 * The easing curves (Material 3's standard and emphasized sets). standard: moves that start and end on screen; enter: arrivals
 * (decelerate); exit: departures for good (accelerate); emphEnter / emphExit: the expressive moments (compose, drawer, sheet, send).
 */
export const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 1, 1)',
  emphEnter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  emphExit: 'cubic-bezier(0.3, 0, 0.8, 0.15)'
} as const;

const kebab = (name: string): string => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The palette as CSS custom properties (`--surface`, `--border-strong`, `--accent-text`, ...), one declaration per line without braces,
 * so the caller puts them in the rule it needs (`:root`, `[data-theme='dark']`, a media query).
 */
export function paletteToCssVars(palette: Palette): string {
  // Every field of Palette is a string, but Object.entries of an interface says `any`.
  return (Object.entries(palette) as [string, string][]).map(([name, value]) => `--${kebab(name)}:${value}`).join(';');
}
