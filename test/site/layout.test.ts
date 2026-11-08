import { describe, expect, it } from 'vitest';
import { DARK, FONT_SANS, LIGHT, paletteToCssVars } from '../../src/shared/design/tokens';
import { LANDING_CSS } from '../../src/worker/site/landing.css';

const rule = (selector: string): string => LANDING_CSS.split('\n').find((line) => line.startsWith(`${selector}{`)) ?? '';

// Truong D2: with the text at 200 % on a 320 px phone (or 300 % at 390 px) a grid whose single implicit column is `auto` grew to the
// width of its longest line and pushed the page sideways. Every grid that holds running text has a column that may shrink to zero,
// and a word that does not fit breaks.
describe("the landing stylesheet's layout guards", () => {
  it.each(['.hero-grid', '.checks', '.faq'])('gives %s a column that can shrink (minmax(0,1fr))', (selector) => {
    expect(rule(selector)).toContain('grid-template-columns:minmax(0,1fr)');
  });

  it('lets the children of the hero grid shrink and breaks a word that does not fit', () => {
    expect(LANDING_CSS).toContain('.hero-grid>*{min-width:0}');
    expect(LANDING_CSS).toContain('h1,h2,h3,p,li{overflow-wrap:break-word;overflow-wrap:anywhere}');
  });

  // Truong D2 (open since round 1): at 200 % text on a 320 px phone the closing panel leaves 158 px for the buttons and the deploy row was 252 px wide, 13 px
  // past the screen. `.cta` is a column that still wraps, so its one line is as wide as the widest row's smallest width, which was the longest word of the
  // button plus its padding. A button whose text may break anywhere has a small smallest width, so the line is the width of the panel. Only in the phone block,
  // so no other width changes.
  it('lets a button in a call-to-action row break a word that does not fit, on a phone only', () => {
    const phone = LANDING_CSS.split('\n').find((line) => line.startsWith('@media (max-width:30rem)')) ?? '';
    expect(phone).toContain('.cta{flex-direction:column;align-items:stretch}');
    expect(phone).toContain('.cta .btn{width:100%;overflow-wrap:anywhere}');
    expect(rule('.btn')).not.toContain('overflow-wrap');
    expect(rule('.cta')).toContain('flex-wrap:wrap');
  });

  it('balances the Chinese headings and the lead so a short word is not left alone on a line', () => {
    expect(LANDING_CSS).toContain('html:lang(zh-CN) h1,html:lang(zh-CN) .band h2{letter-spacing:0;text-wrap:balance}');
    expect(LANDING_CSS).toContain('html:lang(zh-CN) .lead{text-wrap:pretty}');
  });
});

// The look of the page is the app's look: colours and fonts are the shared tokens (src/shared/design/tokens.ts), never a copy.
describe("the landing stylesheet's look", () => {
  it('declares the light palette in :root and the dark one under prefers-color-scheme, with the shared font stack', () => {
    expect(LANDING_CSS).toContain(`:root{${paletteToCssVars(LIGHT)};`);
    expect(LANDING_CSS).toContain(`@media (prefers-color-scheme:dark){:root{${paletteToCssVars(DARK)}}}`);
    expect(LANDING_CSS).toContain(`font:400 1rem/1.6 ${FONT_SANS}`);
  });

  it('has no colour of its own: every hex colour in it is a token', () => {
    // Every field of Palette is a string, but Object.values of an interface says `any`.
    const tokens = new Set(
      [...(Object.values(LIGHT) as string[]), ...(Object.values(DARK) as string[])].map((value) => value.toLowerCase())
    );
    const hexes = LANDING_CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect(tokens.has(hex.toLowerCase()), hex).toBe(true);
    }
  });

  // The landing brief allows depth, not ornament: a faint accent glow behind the product frame and the closing panel, hairline grids
  // and dots that fade out, and fades at the edge of a cropped fragment. Every gradient is drawn from the palette (no colour of its
  // own); text is never filled with a gradient, nothing is blurred and nothing moves on its own.
  it('decorates only with token gradients (no gradient text, blur or animation), and moves only when the visitor allows motion', () => {
    expect(LANDING_CSS).not.toMatch(/@keyframes|animation|blur\(|backdrop-filter|background-clip:text|text-fill-color/i);
    const gradients = LANDING_CSS.match(/(linear|radial)-gradient\([^;{}]*\)/g) ?? [];
    expect(gradients.length).toBeGreaterThan(0);
    for (const gradient of gradients) {
      expect(gradient, gradient).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    }
    for (const line of LANDING_CSS.split('\n').filter((candidate) => candidate.includes('transition'))) {
      expect(line.startsWith('@media (prefers-reduced-motion:no-preference)')).toBe(true);
    }
  });

  it('makes the buttons and the language links 44 px high on a phone and on a touch screen', () => {
    expect(LANDING_CSS).toContain('@media (pointer:coarse),(max-width:40rem){:root{--ctl:44px;--seg:44px}}');
    expect(rule('.btn')).toContain('min-height:44px');
    expect(rule('.btn-sm')).toContain('min-height:var(--ctl)');
    expect(LANDING_CSS).toContain('min-height:var(--seg)');
  });
});
