import {
  AVATAR_HUES,
  CONTROL_HEIGHT,
  DARK,
  DURATION,
  EASING,
  FONT_FACE_CSS,
  FONT_MONO,
  FONT_SANS,
  LIGHT,
  MOTION,
  RADIUS,
  paletteToCssVars,
  type Palette
} from '../shared/design/tokens';

export interface ThemeTokens {
  dark: boolean;
  accent: string;
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderStrong: string;
  track: string;
  text: string;
  text2: string;
  text3: string;
  selBg: string;
  selText: string;
  navSelBg: string;
  link: string;
  unreadDot: string;
  star: string;
  kbdBg: string;
  toastBg: string;
  toastText: string;
  toastAction: string;
  shadow: string;
  divider: string;
  hover: string;
}

const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

export function mix(a: string, b: string, w: number): string {
  const x = p(a);
  const y = p(b);
  return `#${x
    .map((v, i) =>
      Math.round(v * (1 - w) + y[i] * w)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** The palette with another accent: the colours that come from the accent follow it, the greys stay. (No caller passes one today.) */
function withAccent(base: Palette, dark: boolean, accent: string): Palette {
  if (accent.toUpperCase() === base.accent.toUpperCase()) {
    return base;
  }
  return {
    ...base,
    accent,
    accentHover: mix(accent, '#000000', 0.12),
    accentSoft: mix(accent, base.surface, dark ? 0.76 : 0.9),
    accentText: dark ? mix(accent, '#FFFFFF', 0.5) : mix(accent, '#000000', 0.18)
  };
}

/**
 * The colours of the app as real hex strings (the mail frame and the error screen need values, not `var(...)`), taken from the palettes
 * in src/shared/design/tokens.ts: the same values the CSS variables of `applyTheme` carry.
 */
export function getTokens(dark: boolean, accent?: string): ThemeTokens {
  const custom = accent !== undefined && /^#[0-9a-fA-F]{6}/.test(accent) ? accent.slice(0, 7) : undefined;
  const base = dark ? DARK : LIGHT;
  const c = custom === undefined ? base : withAccent(base, dark, custom);
  // The toast is the inverse of the theme (dark on light, light on dark), so its action is the accent of the other palette.
  const inverse = dark ? LIGHT : DARK;
  return {
    dark,
    accent: c.accent,
    bg: c.bg,
    surface: c.surface,
    raised: c.raised,
    border: c.border,
    borderStrong: c.borderStrong,
    track: c.border,
    text: c.text,
    text2: c.text2,
    text3: c.text3,
    selBg: c.accentSoft,
    selText: c.accentText,
    navSelBg: mix(c.bg, c.text, 0.08),
    link: c.accentText,
    unreadDot: c.accent,
    star: c.star,
    kbdBg: c.raised,
    toastBg: c.text,
    toastText: c.bg,
    toastAction: inverse.accentText,
    shadow: c.shadowSm,
    divider: c.border,
    hover: c.hover
  };
}

const THEME_STYLE_ID = 'nm-tokens';

/** The key under which the choice of theme is stored: 'light', 'dark' or 'system' (no value: 'system'). */
export const THEME_STORAGE_KEY = 'edging-mail-theme';

/** The theme a person chose on this device: a fixed one, or 'system', which follows `prefers-color-scheme` while the app is open. */
export type ThemeChoice = 'light' | 'dark' | 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored choice. Nothing stored (a new device), an unknown value or a browser that refuses storage: 'system'. */
export function storedThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Stores the choice (a browser that refuses storage keeps it for this visit only). */
export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // storage full or blocked
  }
}

/** True when the system asks for dark (false where there is no window or no media query). */
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Whether a choice shows the dark theme now: 'system' asks the system. */
export function resolveThemeChoice(choice: ThemeChoice): boolean {
  return choice === 'system' ? systemPrefersDark() : choice === 'dark';
}

/** Calls `onChange` when the system switches between light and dark (only 'system' follows it). Returns the unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {
      // Nothing was listened to.
    };
  }
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True when the stored choice shows the dark theme now (a 'system' choice follows the system). Read before the first render. */
export function storedThemeIsDark(): boolean {
  return resolveThemeChoice(storedThemeChoice());
}

/** `emphEnter` -> `emph-enter`: the CSS name of a token key. */
const cssName = (name: string): string => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * The CSS of the `nm-tokens` style: the font faces, the variables of the light palette (with `--focus`, `--indicator` and the material
 * of tactile controls), the radii, heights, durations (`--dur-*`) and easings (`--ease-*`), then the dark palette under
 * `[data-theme='dark']`. Reduced motion re-sets the durations in index.css (it out-ranks this rule).
 */
export function themeCss(): string {
  const shared = [
    `--font-sans:${FONT_SANS}`,
    `--font-mono:${FONT_MONO}`,
    `--radius-control:${RADIUS.control}px`,
    `--radius-card:${RADIUS.card}px`,
    `--radius-popup:${RADIUS.popup}px`,
    `--radius-sheet:${RADIUS.sheet}px`,
    `--radius-dialog:${RADIUS.dialog}px`,
    `--radius-pill:${RADIUS.pill}px`,
    `--control-sm:${CONTROL_HEIGHT.sm}px`,
    `--control-md:${CONTROL_HEIGHT.md}px`,
    `--control-touch:${CONTROL_HEIGHT.touch}px`,
    `--motion-fast:${MOTION.fast}ms`,
    `--motion-base:${MOTION.base}ms`,
    ...Object.entries(DURATION).map(([name, ms]) => `--dur-${name}:${ms}ms`),
    ...Object.entries(EASING).map(([name, curve]) => `--ease-${cssName(name)}:${curve}`)
  ].join(';');
  return `${FONT_FACE_CSS}\n:root{${paletteToCssVars(LIGHT)};${shared}}\n:root[data-theme='dark']{${paletteToCssVars(DARK)}}`;
}

/**
 * Makes the theme visible to CSS: `data-theme` and `color-scheme` on <html>, and (once) the `<style id="nm-tokens">` that holds the
 * variables (`--surface`, `--accent-text`, ...) and the font faces. Call it before the first render and whenever the theme changes.
 */
export function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const css = themeCss();
  const current = document.querySelector(`#${THEME_STYLE_ID}`);
  if (current === null) {
    const style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    style.textContent = css;
    // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
    document.head.appendChild(style);
  } else if (current.textContent !== css) {
    // A hot reload of the tokens in development: the variables follow without a page reload.
    current.textContent = css;
  }
}

export function getChip(hue: string, t: ThemeTokens): { bg: string; fg: string; dot: string } {
  return t.dark
    ? {
        bg: mix(hue, t.surface, 0.76),
        fg: mix(hue, '#FFFFFF', 0.6),
        dot: mix(hue, '#FFFFFF', 0.3)
      }
    : {
        bg: mix(hue, t.surface, 0.87),
        fg: mix(hue, '#000000', 0.28),
        dot: hue
      };
}

export const FILE_HUES: Record<string, string> = {
  PDF: '#C2410C',
  XLS: '#15803D',
  XLSX: '#15803D',
  PNG: '#6D28D9',
  JPG: '#6D28D9',
  JPEG: '#6D28D9',
  WEBP: '#6D28D9',
  GIF: '#6D28D9',
  HEIC: '#6D28D9',
  // Not the accent blue (it means selected, unread, focus): a cyan, 43 degrees away from it in perceived hue.
  DOC: '#0E7490',
  DOCX: '#0E7490'
};

/**
 * The hues of labels: ten that stand apart on the colour wheel (none grey, so no label looks disabled; no amber, the colour of the star beside
 * a row's chips; none within 20 degrees of the accent blue, which means selected, unread and focus), in an order where the sample labels of
 * each language (Family, Travel, Work and their translations) land 60 degrees or more apart and neighbours are far apart in perceived hue, so
 * the hash below, which spreads names over these slots, rarely gives two labels of one list look-alike colours. Through getChip each gives
 * chip text over 6.7:1 on its chip and a dot over 3.9:1 on the surface, the window ground and the raised fill, in both themes
 * (test/client/label-hues.test.ts).
 */
export const LABEL_HUES: readonly string[] = [
  '#6D28D9', // violet
  '#C81E1E', // red
  '#4D7C0F', // lime
  '#A21CAF', // fuchsia (was the accent blue: Family lands here)
  '#15803D', // green
  '#BE185D', // pink
  '#0E7490', // cyan
  '#A61E7A', // plum
  '#C2410C', // orange
  '#0F766E' // teal
];

/** The slot of a label name in LABEL_HUES: FNV-1a over its UTF-16 code units, so the same name is always the same colour, on every device. */
export function labelHue(label: string): string {
  return LABEL_HUES[fnv1a(label) % LABEL_HUES.length];
}

/** FNV-1a over the UTF-16 code units of a string (stable on every device). */
function fnv1a(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line unicorn/prefer-code-point -- the hash reads UTF-16 code units; codePointAt would change it for emoji
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash;
}

/** The tints of people's stamps (ui Avatar `hue`): AVATAR_HUES in src/shared/design/tokens.ts (the landing's sample people use them too). */
export { AVATAR_HUES } from '../shared/design/tokens';

/** The stamp tint of a person, from their address (or name when there is no address): the same person is the same colour everywhere. */
export function avatarHue(address: string): string {
  return AVATAR_HUES[fnv1a(address.trim().toLowerCase()) % AVATAR_HUES.length];
}

/** Labels are user-made, so a name picks its colour from the fixed palette by hash: the same name is always the same colour. */
export function getLabelChip(label: string, t: ThemeTokens): { name: string; bg: string; fg: string; dot: string } {
  return { name: label, ...getChip(labelHue(label), t) };
}

export function getFileChip(type: string, t: ThemeTokens): { bg: string; fg: string; dot: string } {
  const hue = FILE_HUES[type.toUpperCase()] || '#475569';
  return getChip(hue, t);
}
