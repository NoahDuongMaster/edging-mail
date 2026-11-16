import { describe, expect, it } from 'vitest';
import { AVATAR_HUES, avatarHue, LABEL_HUES } from '../../src/client/theme';
import { DARK, LIGHT } from '../../src/shared/design/tokens';

// v3: the people who write to you are stamps tinted with their own hue (ui Avatar shape="stamp" hue={avatarHue(address)}). The tint and
// the initials are mixed in ui.css (color-mix in srgb): the field takes --ui-hue-bg of the hue into the surface, the initials --ui-hue-fg
// of the hue into the ink. The same mix is computed here so every slot keeps its initials readable in both themes.

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function mix(a: string, b: string, share: number): number[] {
  const x = rgb(a);
  const y = rgb(b);
  return x.map((v, i) => v * share + y[i] * (1 - share));
}

function luminance(c: number[]): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('avatar hues (stamps)', () => {
  it('gives the same person the same hue, whatever the case or spaces of the address', () => {
    expect(avatarHue('maya.chen@example.org')).toBe(avatarHue(' Maya.Chen@Example.org '));
    expect(AVATAR_HUES).toContain(avatarHue('someone@example.com'));
  });

  it('spreads a small list of senders over several hues', () => {
    const people = ['maya.chen@example.org', 'jonas.weber@example.org', 'priya.nair@example.org', 'library@example.org', 'tom@example.com'];
    expect(new Set(people.map((p) => avatarHue(p))).size).toBeGreaterThanOrEqual(3);
  });

  it('is its own palette, separate from the label hues', () => {
    expect(AVATAR_HUES).not.toEqual(LABEL_HUES);
    expect(AVATAR_HUES.length).toBeGreaterThanOrEqual(8);
  });

  for (const [name, palette, bg, fg] of [
    ['light', LIGHT, 0.18, 0.72],
    ['dark', DARK, 0.28, 0.42]
  ] as const) {
    it(`keeps the initials 4.5:1 or more on their printed field (${name})`, () => {
      for (const hue of AVATAR_HUES) {
        expect(ratio(mix(hue, palette.text, fg), mix(hue, palette.surface, bg)), hue).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
