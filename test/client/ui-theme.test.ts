import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, FONT_FACE_CSS, FONT_FILES, paletteToCssVars } from '../../src/shared/design/tokens';
import { getTokens, mix } from '../../src/client/theme';

// getTokens keeps its shape (about 100 components take it as the prop `t`) but its values now come from the palettes in
// src/shared/design/tokens.ts, the same ones that applyTheme writes as CSS variables.

const HEX = /^#[0-9A-F]{6}$/i;

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
