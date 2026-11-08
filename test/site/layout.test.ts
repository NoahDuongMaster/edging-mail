import { describe, expect, it } from 'vitest';
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
