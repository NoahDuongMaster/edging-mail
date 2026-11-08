import { stringHue } from './lib/mail';
import {
  CONTROL_HEIGHT,
  DARK,
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

/** The key under which the choice of theme is stored ('dark' or 'light'). The app does not follow `prefers-color-scheme`. */
export const THEME_STORAGE_KEY = 'edging-mail-theme';

/** True when the stored choice is dark. A browser that refuses storage gets the light theme. */
export function storedThemeIsDark(): boolean {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

/** The CSS of the `nm-tokens` style: the font faces, the variables of the light palette, then the dark ones under `[data-theme='dark']`. */
function themeCss(): string {
  const shared = [
    `--font-sans:${FONT_SANS}`,
    `--font-mono:${FONT_MONO}`,
    `--radius-control:${RADIUS.control}px`,
    `--radius-card:${RADIUS.card}px`,
    `--radius-dialog:${RADIUS.dialog}px`,
    `--control-sm:${CONTROL_HEIGHT.sm}px`,
    `--control-md:${CONTROL_HEIGHT.md}px`,
    `--control-touch:${CONTROL_HEIGHT.touch}px`,
    `--motion-fast:${MOTION.fast}ms`,
    `--motion-base:${MOTION.base}ms`
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
  if (document.querySelector(`#${THEME_STYLE_ID}`) === null) {
    const style = document.createElement('style');
    style.id = THEME_STYLE_ID;
    style.textContent = themeCss();
    // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
    // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
    document.head.appendChild(style);
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
  DOC: '#2F5BEA',
  DOCX: '#2F5BEA'
};

/** Labels are user-made, so a name picks its colour from the fixed palette by hash: the same name is always the same colour. */
export function getLabelChip(label: string, t: ThemeTokens): { name: string; bg: string; fg: string; dot: string } {
  return { name: label, ...getChip(stringHue(label), t) };
}

export function getFileChip(type: string, t: ThemeTokens): { bg: string; fg: string; dot: string } {
  const hue = FILE_HUES[type.toUpperCase()] || '#475569';
  return getChip(hue, t);
}
