// Design tokens: the one source of the look of the app (src/client/theme.ts, src/client/ui) and of the public site
// (src/worker/site/landing.css.ts). v3 "Airmail": white sheets that float on a soft sky-grey window ground, ink type, one airmail blue
// (the colour of the logo tile), few hairlines. Nothing here may import from src/client or src/worker, because both sides import this file.
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
  /** The rounded content sheets (the list, the reader, settings, the admin console) that float on the window ground. */
  sheetShadow: string;
  /**
   * Things that float above the sheets and move: the homing flight of a message (v3 signature), the compose window, the toast, the phone
   * Compose button and a docked bar. A ring plus two soft layers, so it still reads in dark where a shadow alone vanishes.
   */
  floatShadow: string;
  /**
   * The brand panel of the sign-in screens (v3): a deep airmail-blue night sky in BOTH themes. onBrandPanel: its text (16.5:1);
   * brandPanelText2: its quieter lines (9.6:1); brandPanelLine: its flight trail and hairlines (decoration, 6:1).
   */
  brandPanel: string;
  onBrandPanel: string;
  brandPanelText2: string;
  brandPanelLine: string;
  /**
   * The red of the airmail edge (v3 signature): with the accent blue and paper gaps it draws the classic par-avion stripes on the compose
   * window, the open letter, the sign-in panel and the undo-send countdown. Decoration only: never a state, never text, never an error.
   */
  airmailRed: string;
}

export const LIGHT: Palette = {
  bg: '#F5F6F9',
  surface: '#FFFFFF',
  raised: '#F2F4F8',
  border: '#E5E8EE',
  borderStrong: '#D2D7E0',
  control: '#7A808A',
  text: '#10131A',
  text2: '#454C5B',
  text3: '#5B6272',
  accent: '#2F5BEA',
  accentHover: '#2449C7',
  accentSoft: '#EBF0FE',
  accentText: '#2348C6',
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
  chrome: '#ECEFF4',
  btnTop: '#FFFFFF',
  btnBottom: '#F4F6F9',
  btnEdge: '#D2D7E0',
  insetHighlight: 'rgba(255, 255, 255, 0.85)',
  accentGlow: 'rgba(47, 91, 234, 0.32)',
  pressShadow: 'inset 0 1px 2px rgba(15, 17, 21, 0.14)',
  controlShadow: '0 1px 2px rgba(15, 17, 21, 0.08)',
  fieldShadow: 'inset 0 1px 2px rgba(15, 17, 21, 0.05)',
  popShadow: '0 12px 32px -6px rgba(15, 17, 21, 0.14), 0 2px 6px rgba(15, 17, 21, 0.06)',
  sheetShadow: '0 0 0 1px rgba(16, 24, 40, 0.04), 0 1px 2px rgba(16, 24, 40, 0.04), 0 16px 40px -18px rgba(16, 24, 40, 0.16)',
  floatShadow: '0 0 0 1px rgba(16, 24, 40, 0.05), 0 10px 24px -6px rgba(16, 24, 40, 0.18), 0 28px 56px -20px rgba(16, 24, 40, 0.22)',
  brandPanel: '#0F1A4B',
  onBrandPanel: '#FFFFFF',
  brandPanelText2: '#B9C5EE',
  brandPanelLine: '#7B98F5',
  airmailRed: '#E5484D'
};

export const DARK: Palette = {
  bg: '#0B0D12',
  surface: '#161A22',
  raised: '#1D222C',
  border: '#282E3B',
  borderStrong: '#3A4150',
  control: '#7A808C',
  text: '#EDF0F6',
  text2: '#A9B0BE',
  text3: '#8D95A5',
  accent: '#2F5BEA',
  accentHover: '#2749CE',
  accentSoft: '#1B2752',
  accentText: '#93ABFA',
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
  chrome: '#08090D',
  btnTop: '#2A2F3A',
  btnBottom: '#232832',
  btnEdge: '#555A63',
  insetHighlight: 'rgba(255, 255, 255, 0.1)',
  accentGlow: 'rgba(47, 91, 234, 0.3)',
  pressShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
  controlShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
  fieldShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.35)',
  popShadow: '0 16px 40px -8px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  sheetShadow: '0 0 0 1px rgba(255, 255, 255, 0.07), 0 16px 44px -16px rgba(0, 0, 0, 0.8)',
  floatShadow: '0 0 0 1px rgba(255, 255, 255, 0.07), 0 12px 28px -6px rgba(0, 0, 0, 0.6), 0 32px 64px -20px rgba(0, 0, 0, 0.7)',
  brandPanel: '#0F1A4B',
  onBrandPanel: '#FFFFFF',
  brandPanelText2: '#B9C5EE',
  brandPanelLine: '#7B98F5',
  airmailRed: '#E5484D'
};

/**
 * The tints of people's stamps (ui Avatar `hue`, v3): nine hues spread round the wheel in perceived hue (OKLCH 4-324 degrees, none within
 * 40 degrees of the accent blue at 266, which means selected and unread), in an order where neighbours are 55 degrees or more apart, so a
 * list of senders is not a column of pinks. Initials on their tint: 5.8:1 or more in both themes (v3/avatar_hues.py, the ui.css mix;
 * test/client/avatar-hues.test.ts). The app picks one per address (theme.ts avatarHue); the landing's sample people use them too.
 */
export const AVATAR_HUES: readonly string[] = [
  '#0F766E', // teal
  '#B45309', // amber
  '#7E22CE', // violet
  '#15803D', // green
  '#BE185D', // rose
  '#0E7490', // cyan
  '#8A6A00', // ochre
  '#A21CAF', // magenta
  '#4D7C0F' // olive
];

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

/**
 * Corner radii in px (v3 "Airmail": soft, concentric). control: buttons, fields, rows; card: cards, attachment tiles, the selected row;
 * popup: menus, popovers, select lists, tooltips; sheet: the floating content sheets of the mailbox, settings and the admin console;
 * dialog: dialogs and phone sheets. A pill (999) is for avatars, switches, badges, chips and the primary Compose button. Nested corners
 * are concentric: inner = outer - padding.
 */
export const RADIUS = { control: 10, card: 14, popup: 14, sheet: 18, dialog: 20, pill: 999 } as const;

/**
 * The type scale as [font-size px, line-height px]. Dense lists and tables use `sm`; fields are `md` (16 px on a phone so iOS does not
 * zoom). Vietnamese stacks two marks on one letter: a line height under 1.25 clips them, so no step goes below it. `display` is for the
 * heading of a full-page screen (sign in, status). Letters sit -0.01em closer from 16 px up and -0.02em from 22 px up.
 */
export const TYPE = {
  caption: [12, 16],
  sm: [13, 20],
  md: [14, 22],
  lg: [16, 26],
  h3: [18, 26],
  h2: [24, 32],
  h1: [30, 38],
  display: [40, 48]
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
export const DURATION = {
  micro: 70,
  fast: 110,
  quick: 150,
  base: 200,
  gentle: 250,
  slow: 300,
  slower: 400,
  flight: 480,
  /** v3 signature: a message flies home to its folder along an arc (decorative, never blocking). */
  homing: 620,
  /** v3: a count rolls to its new value (odometer digits). */
  roll: 280,
  /** v3: the selection capsule glides from one row or folder to the next. */
  glide: 240
} as const;

/**
 * The easing curves (Material 3's standard and emphasized sets). standard: moves that start and end on screen; enter: arrivals
 * (decelerate); exit: departures for good (accelerate); emphEnter / emphExit: the expressive moments (compose, drawer, sheet, send).
 */
export const EASING = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 1, 1)',
  emphEnter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  emphExit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  /** v3: the homing flight (eases in like a take-off and out like a landing). */
  homing: 'cubic-bezier(0.55, 0, 0.2, 1)',
  /** v3: a small overshoot for a catch or a landing (a folder catching a message, a new row settling). */
  settle: 'cubic-bezier(0.34, 1.45, 0.64, 1)'
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
