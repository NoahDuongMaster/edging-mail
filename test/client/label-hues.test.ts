import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../../src/shared/design/tokens';
import { FILE_HUES, LABEL_HUES, getLabelChip, getTokens, labelHue } from '../../src/client/theme';

// Label colours (theme.ts LABEL_HUES through getChip): user-made labels pick a hue by a hash of their name. Ten hues that stand apart on the
// wheel, none grey (a grey label read as disabled), every chip readable and every dot visible in both themes, the same name always the same
// colour.

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

/** The hue of a #RRGGBB colour in degrees (HSL). */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) {
    return 0;
  }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const wheel = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** The perceived hue of a #RRGGBB colour in degrees (OKLCH, Björn Ottosson's matrices). */
function oklchHue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

describe('label and file hues stay off the accent', () => {
  it('none is within 20 degrees of the accent blue in perceived hue (the accent means selected, unread and focus)', () => {
    for (const accent of [LIGHT.accent, DARK.accent]) {
      for (const hue of [...LABEL_HUES, ...Object.values(FILE_HUES)]) {
        expect(wheel(oklchHue(hue), oklchHue(accent)), `${hue} vs ${accent}`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe('label hues', () => {
  it('are ten to twelve distinct hues spread on the wheel, none of them grey', () => {
    expect(LABEL_HUES.length).toBeGreaterThanOrEqual(10);
    expect(LABEL_HUES.length).toBeLessThanOrEqual(12);
    const hues = LABEL_HUES.map(hueOf).toSorted((a, b) => a - b);
    for (let i = 0; i < hues.length; i++) {
      expect(wheel(hues[i], hues[(i + 1) % hues.length]), LABEL_HUES.join(', ')).toBeGreaterThanOrEqual(15);
    }
    for (const hex of LABEL_HUES) {
      const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
      // Saturated: the strongest channel is well above the weakest (slate #475569 was 34 apart and read as disabled).
      expect(Math.max(r, g, b) - Math.min(r, g, b), hex).toBeGreaterThan(80);
    }
  });

  it('give chip text 4.5:1 on its chip and a dot 3:1 on every ground a label sits on, in both themes', () => {
    for (const dark of [false, true]) {
      const palette = dark ? DARK : LIGHT;
      const t = getTokens(dark);
      for (const hue of LABEL_HUES) {
        // A name that lands on this hue.
        const name = Array.from({ length: 400 }, (_, i) => `label ${i}`).find((n) => labelHue(n) === hue) ?? '';
        const chip = getLabelChip(name, t);
        expect(ratio(chip.fg, chip.bg), `${hue} text ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(4.5);
        for (const ground of [palette.surface, palette.chrome, palette.raised, palette.accentSoft]) {
          expect(ratio(chip.dot, ground), `${hue} dot on ${ground}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('give the same name the same colour, and every hue is reachable', () => {
    expect(labelHue('Work')).toBe(labelHue('Work'));
    expect(getLabelChip('Family', getTokens(false))).toEqual(getLabelChip('Family', getTokens(false)));
    const used = new Set(Array.from({ length: 400 }, (_, i) => labelHue(`label ${i}`)));
    expect(used.size).toBe(LABEL_HUES.length);
  });

  it('keeps the sample labels of each language apart on the wheel (Family and Work no longer both green)', () => {
    for (const set of [
      ['Family', 'Travel', 'Work'],
      ['Gia đình', 'Du lịch', 'Công việc'],
      ['家庭', '旅行', '工作']
    ]) {
      const hues = set.map((name) => hueOf(labelHue(name)));
      for (let i = 0; i < hues.length; i++) {
        for (let j = i + 1; j < hues.length; j++) {
          expect(wheel(hues[i], hues[j]), `${set[i]} / ${set[j]}`).toBeGreaterThanOrEqual(60);
        }
      }
    }
  });
});
