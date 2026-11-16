import { describe, expect, it } from 'vitest';
import {
  DARK,
  DURATION,
  EASING,
  LIGHT,
  FONT_FACE_CSS,
  FONT_FILES,
  MOTION,
  RADIUS,
  paletteToCssVars,
  type Palette
} from '../../src/shared/design/tokens';
import { getTokens, mix, themeCss } from '../../src/client/theme';

// getTokens keeps its shape (about 100 components take it as the prop `t`) but its values now come from the palettes in
// src/shared/design/tokens.ts, the same ones that applyTheme writes as CSS variables.

const HEX = /^#[0-9A-F]{6}$/i;

/** The relative luminance of a #RRGGBB colour (WCAG 2.2). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two #RRGGBB colours. */
function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

type Hex = { [K in keyof Palette]: Palette[K] extends string ? K : never }[keyof Palette];

/** [what, on, minimum]: every pair the app draws, checked in both themes (DESIGN.md section 1). */
const PAIRS: [Hex, Hex[], number][] = [
  // Text: 4.5:1 on every ground it sits on.
  ['text', ['bg', 'surface', 'raised', 'chrome', 'btnTop', 'btnBottom', 'accentSoft'], 4.5],
  ['text2', ['bg', 'surface', 'raised', 'chrome'], 4.5],
  ['text3', ['bg', 'surface', 'raised', 'chrome'], 4.5],
  ['accentText', ['surface', 'accentSoft', 'bg'], 4.5],
  ['danger', ['surface', 'dangerSoft', 'btnTop', 'btnBottom'], 4.5],
  ['success', ['surface', 'successSoft'], 4.5],
  ['warning', ['surface', 'warningSoft'], 4.5],
  // White on the accent: 5.5:1 at the top of a primary button, 4.5:1 at least at the bottom (accentHover).
  ['onAccent', ['accent'], 5.5],
  ['onAccent', ['accentHover'], 4.5],
  // The edges a control is found by, the focus ring and the indicators: 3:1 on every surface they sit on.
  ['control', ['bg', 'surface', 'raised', 'chrome'], 3],
  ['focus', ['bg', 'surface', 'raised', 'accentSoft', 'chrome', 'btnTop', 'btnBottom'], 3],
  ['indicator', ['bg', 'surface', 'raised', 'accentSoft', 'chrome'], 3],
  ['accent', ['surface'], 3]
];

describe('contrast of the palettes (WCAG 2.2, computed here)', () => {
  for (const [name, palette] of [
    ['light', LIGHT],
    ['dark', DARK]
  ] as const) {
    for (const [fg, grounds, minimum] of PAIRS) {
      for (const bg of grounds) {
        it(`${name}: ${fg} on ${bg} is ${minimum}:1 or more`, () => {
          expect(palette[fg], fg).toMatch(HEX);
          expect(palette[bg], bg).toMatch(HEX);
          expect(ratio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(minimum);
        });
      }
    }
  }

  it('moved the light control edge on purpose: the old #8A909C was under 3:1 on bg, the new one is over it', () => {
    expect(ratio('#8A909C', LIGHT.bg)).toBeLessThan(3);
    expect(LIGHT.control).toBe('#7A808A');
    expect(ratio(LIGHT.control, LIGHT.bg)).toBeGreaterThan(3.5);
  });

  it('gives the dark focus ring its own blue: the dark accent alone is under 3:1 on dark accentSoft', () => {
    expect(ratio(DARK.accent, DARK.accentSoft)).toBeLessThan(3);
    expect(ratio(DARK.focus, DARK.accentSoft)).toBeGreaterThan(5);
  });
});

describe('getTokens', () => {
  it.each([false, true])('returns real hex colours (the mail frame and the error screen cannot use var(...)), dark = %s', (dark) => {
    const t = getTokens(dark);
    const colours = Object.entries(t).filter(([name]) => !['dark', 'shadow', 'hover'].includes(name));
    for (const [name, value] of colours) {
      expect(value, name).toMatch(HEX);
    }
    expect(t.dark).toBe(dark);
  });

  it('maps the palette: the surfaces, the text, the selection and the links', () => {
    for (const [dark, palette] of [
      [false, LIGHT],
      [true, DARK]
    ] as const) {
      const t = getTokens(dark);
      expect(t).toMatchObject({
        accent: palette.accent,
        bg: palette.bg,
        surface: palette.surface,
        raised: palette.raised,
        border: palette.border,
        borderStrong: palette.borderStrong,
        text: palette.text,
        text2: palette.text2,
        text3: palette.text3,
        selBg: palette.accentSoft,
        selText: palette.accentText,
        link: palette.accentText,
        unreadDot: palette.accent,
        kbdBg: palette.raised,
        divider: palette.border,
        hover: palette.hover,
        shadow: palette.shadowSm,
        star: palette.star
      });
    }
  });

  it('makes the toast the inverse of the theme, with an action that can be read on it', () => {
    expect(getTokens(false)).toMatchObject({ toastBg: LIGHT.text, toastText: LIGHT.bg, toastAction: DARK.accentText });
    expect(getTokens(true)).toMatchObject({ toastBg: DARK.text, toastText: DARK.bg, toastAction: LIGHT.accentText });
  });

  it('keeps the old behaviour of the accent argument: a six-digit hex replaces the accent and what follows it, anything else is ignored', () => {
    const custom = getTokens(false, '#0F766E');
    expect(custom.accent).toBe('#0F766E');
    expect(custom.unreadDot).toBe('#0F766E');
    expect(custom.selBg).not.toBe(LIGHT.accentSoft);
    expect(custom.selBg).toBe(mix('#0F766E', LIGHT.surface, 0.9));
    expect(custom.bg).toBe(LIGHT.bg);
    expect(getTokens(false, 'teal')).toEqual(getTokens(false));
    expect(getTokens(true, '#12')).toEqual(getTokens(true));
    // The accent of the palette itself changes nothing.
    expect(getTokens(true, DARK.accent.toLowerCase())).toEqual(getTokens(true));
  });
});

describe('the tokens as CSS', () => {
  it('writes the app-only variables: focus, indicator, the material, the radius and motion scales (light in :root, dark under data-theme)', () => {
    const css = themeCss();
    for (const name of [
      'focus',
      'indicator',
      'on-accent',
      'chrome',
      'btn-top',
      'btn-bottom',
      'btn-edge',
      'inset-highlight',
      'accent-glow'
    ]) {
      expect(css, name).toContain(`--${name}:`);
    }
    for (const name of ['press-shadow', 'control-shadow', 'field-shadow', 'pop-shadow', 'sheet-shadow']) {
      expect(css, name).toContain(`--${name}:`);
    }
    expect(css).toContain(`--radius-popup:${RADIUS.popup}px`);
    for (const [name, ms] of Object.entries(DURATION)) {
      expect(css).toContain(`--dur-${name}:${ms}ms`);
    }
    expect(css).toContain(`--ease-standard:${EASING.standard}`);
    expect(css).toContain(`--ease-emph-enter:${EASING.emphEnter}`);
    // The site's two durations stay as they were (the landing reads them).
    expect(MOTION).toEqual({ fast: 120, base: 160 });
    expect(css).toContain(`--focus:${LIGHT.focus}`);
    expect(css).toContain(`--focus:${DARK.focus}`);
    expect(css.indexOf(`--focus:${DARK.focus}`)).toBeGreaterThan(css.indexOf("[data-theme='dark']"));
  });

  it('writes one variable per palette colour, in kebab case, without braces', () => {
    const css = paletteToCssVars(LIGHT);
    expect(css).toContain('--surface:#FFFFFF');
    expect(css).toContain('--accent-text:');
    expect(css).toContain('--border-strong:');
    expect(css).toContain('--star:');
    expect(css).not.toMatch(/[{}]/);
    expect(css.split(';')).toHaveLength(Object.keys(LIGHT).length);
  });

  it('has both palettes with exactly the same names (a variable missing in one theme would fall through to the other)', () => {
    expect(Object.keys(DARK)).toEqual(Object.keys(LIGHT));
  });

  it('serves the fonts from this origin: every @font-face names a file under /fonts, one per face, swapping', () => {
    const rules = FONT_FACE_CSS.split('\n');
    expect(rules).toHaveLength(2);
    expect(FONT_FACE_CSS).toContain(`url('${FONT_FILES.sans}')`);
    expect(FONT_FACE_CSS).toContain(`url('${FONT_FILES.mono}')`);
    for (const rule of rules) {
      expect(rule).toMatch(
        /^@font-face\{font-family:'Geist( Mono)?';font-style:normal;font-weight:100 900;font-display:swap;src:url\('\/fonts\/[\w.-]+\.woff2'\) format\('woff2'\)\}$/
      );
    }
    expect(FONT_FACE_CSS).not.toMatch(/https?:/);
  });
});
