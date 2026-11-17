// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The default filter lists of ad blockers (EasyList and AdGuard Base, behind uBlock Origin, AdBlock, Adblock Plus and Brave) carry GENERIC cosmetic
// rules: `##.ad-main`, `##.ad-side`, `##.ad-bar`, `##.ad-tabs`, `##.ad-head`... They hide a matching element on every site. The admin console once
// used `ad-*` for "admin": with a blocker on, its sheet drew but the head, the nav, the tabs and the pages were `display: none`, so the console
// opened as two empty panels and nothing in the page said why. No class or id of ours may start the way an advertisement's does.

const SOURCE = path.join(ROOT, 'src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
const files = walk(SOURCE);

// ad, ads, adv, advert, advertisement, sponsor(ed), banner-ad, followed by a dash or an underscore: the shapes the lists hide.
const AD_LIKE = /^(?:ad|ads|adv|advert|advertisement|adsense|adslot|sponsor|sponsored|dfp|gpt)[-_]/i;

describe('class and id names against the generic rules of ad blockers', () => {
  it('no stylesheet defines a class whose name starts like an advertisement', () => {
    const found = new Set<string>();
    for (const file of files.filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(file, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
        if (AD_LIKE.test(match[1])) {
          found.add(`${path.relative(ROOT, file)}: .${match[1]}`);
        }
      }
    }
    expect([...found]).toEqual([]);
  });

  it('no component or page writes such a class or id in its markup', () => {
    const found = new Set<string>();
    for (const file of files.filter((name) => /\.(?:tsx|ts)$/.test(name))) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/\b(?:className|class|id)\s*[=:]\s*[{`"']+([^"'`}]*)/g)) {
        for (const token of match[1].split(/\s+/)) {
          if (AD_LIKE.test(token)) {
            found.add(`${path.relative(ROOT, file)}: ${token}`);
          }
        }
      }
    }
    expect([...found]).toEqual([]);
  });

  it('knows the shapes it guards against (a deliberate bad name is caught)', () => {
    for (const bad of ['ad-main', 'ad-side', 'ad-bar', 'ads-box', 'advert-left', 'sponsor_row', 'Ad-Head']) {
      expect(AD_LIKE.test(bad), bad).toBe(true);
    }
    for (const fine of ['adm-main', 'admin-title', 'address', 'ad', 'adapter-row', 'add-person', 'read-more']) {
      expect(AD_LIKE.test(fine), fine).toBe(false);
    }
  });
});
