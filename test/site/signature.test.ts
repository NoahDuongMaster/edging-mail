import { describe, expect, it } from 'vitest';
import { avatarHue } from '../../src/client/theme';
import { AVATAR_HUES, RADIUS } from '../../src/shared/design/tokens';
import { avatar, stampAvatar, stampHue } from '../../src/worker/site/components';
import { copyEn } from '../../src/worker/site/copy.en';
import { copyVi } from '../../src/worker/site/copy.vi';
import { copyZh } from '../../src/worker/site/copy.zh';
import { renderLanding } from '../../src/worker/site/landing';
import { LANDING_CSS } from '../../src/worker/site/landing.css';

const rule = (selector: string): string => LANDING_CSS.split('\n').find((line) => line.startsWith(`${selector}{`)) ?? '';
const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

// v3 "Airmail" (DESIGN-v3 section 3) on the public page: the page is static, so the signature is too. The people who write to you are
// postage stamps in their app tint, the product window has the airmail edge, one flight trail takes off from it; nothing moves.
describe.each([
  ['en', copyEn],
  ['vi', copyVi],
  ['zh', copyZh]
] as const)("the landing's v3 signature (%s)", (_name, copy) => {
  const html = renderLanding(copy, 'https://mail.example.com');

  it('draws every sender and recipient of the fragments as a stamp, and keeps accounts round', () => {
    // Mailbox list 4 + its open message 1 + the reply's recipient 1 + the new-mail list 3 + the phone 5.
    expect(count(html, /<span class="av stamp" data-hue="[0-8]">/g)).toBe(14);
    // The admin table (3 people and an alias) and the domain's addresses (3 people and an alias) are accounts: round, as in the app.
    expect(count(html, /<span class="av( av-a| av-ghost)?">/g)).toBe(8);
    // One person, one tint: Lena's row and her open message.
    const lena = [...html.matchAll(/data-hue="(\d)">LF</g)].map((match) => match[1]);
    expect(lena).toHaveLength(2);
    expect(new Set(lena).size).toBe(1);
  });

  it('draws one still flight trail, in the hero, hidden from screen readers', () => {
    const hero = /<section class="hero">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(count(html, /<svg class="trail /g)).toBe(1);
    expect(hero).toContain('<svg class="trail trail-hero" aria-hidden="true" focusable="false"');
  });
});

describe("the landing's stamps", () => {
  it("pick their tint with the app's rule (avatarHue) and are the app's slot classes", () => {
    for (const name of ['Lena Fischer', 'Daniel Okafor', 'Priya Nair']) {
      expect(AVATAR_HUES[stampHue(name)]).toBe(avatarHue(name.toLowerCase().replace(' ', '.')));
      expect(stampAvatar('XY', name)).toBe(`<span class="av stamp" data-hue="${stampHue(name)}">XY</span>`);
    }
    expect(avatar('RM')).toBe('<span class="av">RM</span>');
  });

  it('declare every tint from AVATAR_HUES and print the initials with the mixes that keep 4.5:1 at 11 px', () => {
    for (const [slot, hue] of AVATAR_HUES.entries()) {
      expect(LANDING_CSS).toContain(`.stamp[data-hue="${slot}"]{--hue:${hue}}`);
    }
    // The app's mixes (ui.css): light 18 % tint field / 72 % tint initials into --text; dark 28 % / 42 % (worst 4.93:1 on the dark mini UI).
    expect(rule('.stamp')).toContain('--hue-bg:18%;--hue-fg:72%');
    expect(LANDING_CSS).toContain('@media (prefers-color-scheme:dark){.stamp{');
    expect(LANDING_CSS).toMatch(/\.stamp\{[^}]*--hue-bg:28%;--hue-fg:42%/);
    expect(rule('.av')).toContain('font-size:.6875rem');
    expect(rule('.stamp')).not.toContain('font-size');
  });
});

describe("the landing's airmail edge, flight trail and material", () => {
  it('edges the product window, and only it, with the still par-avion band', () => {
    expect(rule('.frame-bar')).toContain(
      'repeating-linear-gradient(-45deg,var(--airmail-red) 0 8px,var(--surface) 8px 12px,var(--accent) 12px 20px,var(--surface) 20px 24px)'
    );
    expect(count(LANDING_CSS, /repeating-linear-gradient/g)).toBe(1);
  });

  it('shows the trail only where the hero has room beside its buttons', () => {
    expect(rule('.trail-hero')).toContain('display:none');
    expect(LANDING_CSS).toContain('@media (min-width:72rem){.trail-hero{display:block}}');
  });

  it("rounds its surfaces with the app's radii (tokens.ts RADIUS)", () => {
    for (const [name, value] of Object.entries(RADIUS).filter(([key]) => key !== 'pill')) {
      expect(rule(':root')).toContain(`--radius-${name}:${value}px`);
    }
    expect(rule('.btn')).toContain('border-radius:var(--radius-control)');
    expect(rule('.card')).toContain('border-radius:var(--radius-card)');
    expect(rule('.tile')).toContain('border-radius:var(--radius-card)');
    expect(rule('.qa')).toContain('border-radius:var(--radius-card)');
    expect(rule('.frame')).toContain('border-radius:var(--radius-sheet)');
    expect(rule('.pop')).toContain('border-radius:var(--radius-popup)');
  });

  it('draws a secondary button with a ring, not a border, and sinks a pressed one only when motion is allowed', () => {
    expect(rule('.btn')).toContain('border:1px solid transparent');
    expect(rule('.btn')).toContain('box-shadow:inset 0 0 0 1px var(--btn-ring)');
    expect(rule('.btn-primary')).toContain('background:var(--accent)');
    for (const line of LANDING_CSS.split('\n').filter((candidate) => candidate.includes('translate:'))) {
      expect(line.startsWith('@media (prefers-reduced-motion:no-preference)')).toBe(true);
    }
  });
});
