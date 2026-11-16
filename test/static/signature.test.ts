// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, walk } from './helpers/scan';

// The v3 signature (DESIGN-v3 section 3, F2) as source facts: every motion of the signature files rests under reduced motion (a JS motion
// asks motionReduced() first, a CSS animation or transition has its rule in BOTH reduced blocks: the system setting and the in-app choice);
// only transform, opacity and stroke-dashoffset move (the 150 ms highlight that replaces the catch under reduced motion is the one colour
// change); stacking is --z-*; no colour literal; and the browser's datetime field is gone from the client (ui/DateTimePicker replaced it).

const UI = path.join(ROOT, 'src', 'client', 'ui');
const read = (name: string): string => readFileSync(path.join(UI, name), 'utf8');
const strip = (source: string): string => source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
const css = strip(read('signature.css'));
const SIGNATURE_TS = ['homing.ts', 'Odometer.tsx', 'glide.ts', 'FlightTrail.tsx', 'Spinner.tsx', 'DateTimePicker.tsx', 'calendar.ts'];

/** The text of the call that starts at `open` (an index of its "("), up to the matching ")". */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  return source.slice(open + 1);
}

/** The body of the function `name` (from its declaration to the next top-level declaration). */
function body(source: string, name: string): string {
  const start = source.search(new RegExp(String.raw`^(?:export )?(?:async )?function ${name}\b`, 'm'));
  expect(start, name).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:export |const |function |async function |interface |\/\*\*)/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The reduced-motion blocks of signature.css: the @media block and every `:root[data-motion='reduce']` rule. */
const mediaBlock = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const inAppRules = [...css.matchAll(/:root\[data-motion='reduce'\][^{]*\{[^}]*\}/g)].map((match) => match[0]).join('\n');
/** The CSS outside the reduced blocks. */
const normal = css.replace(mediaBlock, '').replaceAll(/:root\[data-motion='reduce'\][^{]*\{[^}]*\}/g, '');

describe('the motion of the signature rests under reduced motion', () => {
  it('asks motionReduced() before every JS motion (homing, odometer, glide)', () => {
    for (const name of ['homing.ts', 'Odometer.tsx', 'glide.ts']) {
      const source = strip(read(name));
      expect(source, name).toMatch(/import \{[^}]*\bmotionReduced\b[^}]*\} from '\.\/motion'/);
    }
    const homing = strip(read('homing.ts'));
    for (const entry of ['flyHome', 'flyFrom', 'foldAndFly']) {
      const code = body(homing, entry);
      const guard = code.search(/motionReduced\(\)|grounded\(\)/);
      expect(guard, entry).toBeGreaterThan(-1);
      expect(guard, entry).toBeLessThan(code.search(/launch\(|\.animate\(/));
    }
    expect(body(homing, 'beat')).toMatch(/!motionReduced\(\) && drawn\(el\)[\s\S]*ring\(el\)/);
    const odometer = strip(read('Odometer.tsx'));
    expect(odometer).toMatch(/motionReduced\(\)\) \{\s*return;\s*\}\s*roll\(/);
    const glide = strip(read('glide.ts'));
    expect(glide.indexOf('motionReduced()')).toBeLessThan(glide.indexOf('box.animate('));
    // The rest draw with CSS only.
    for (const name of ['FlightTrail.tsx', 'Spinner.tsx', 'DateTimePicker.tsx']) {
      expect(strip(read(name)), name).not.toMatch(/\.animate\(/);
    }
  });

  it('stops every CSS animation and transition of signature.css in both reduced blocks', () => {
    const rules = [...normal.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((rule) =>
      /(?:^|;|\s)(?:animation|transition):(?!\s*none)/.test(rule[2])
    );
    expect(rules.length).toBeGreaterThan(6);
    for (const [, selectors, declarations] of rules) {
      const kind = /(?:^|;|\s)animation:/.test(declarations) ? 'animation' : 'transition';
      for (const raw of selectors.split(',')) {
        const selector = raw.trim();
        if (selector.startsWith('@') || selector === '' || /^(?:from|to|\d+%)/.test(selector)) {
          continue;
        }
        for (const [where, block] of [
          ['@media', mediaBlock],
          ['data-motion', inAppRules]
        ] as const) {
          expect(block.includes(selector), `${selector} (${kind}) in ${where}`).toBe(true);
        }
      }
    }
    for (const block of [mediaBlock, inAppRules]) {
      expect(block).toMatch(/animation: none/);
      expect(block).toMatch(/\[data-catch\] \{\s*animation: ui-catch-wash 150ms linear;/);
      expect(block).toMatch(/transition: none/);
    }
  });

  it('moves only transform, opacity and stroke-dashoffset (CSS keyframes and WAAPI keyframes)', () => {
    const allowed = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity', 'stroke-dashoffset']);
    const keyframes = [...css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBeGreaterThan(5);
    for (const [, name, frames] of keyframes) {
      const properties = [...frames.matchAll(/([\w-]+):/g)].map((match) => match[1]);
      for (const property of properties) {
        // The reduced-motion stand-in for the catch is a colour wash of 150 ms (DESIGN-v3: "only a 150 ms highlight").
        const ok = allowed.has(property) || (name === 'ui-catch-wash' && property === 'background-color');
        expect(ok, `${name}: ${property}`).toBe(true);
      }
    }
    const timing = new Set(['offset', 'duration', 'delay', 'easing', 'fill', 'iterations', 'pseudoElement', 'subtree']);
    const moving = new Set(['transform', 'opacity', 'strokeDashoffset']);
    for (const name of ['homing.ts', 'Odometer.tsx', 'glide.ts']) {
      const source = strip(read(name));
      const parts = [...source.matchAll(/\.animate\(|Frames\.push\(/g)].map((match) => callArgs(source, match.index + match[0].length - 1));
      expect(parts.length, name).toBeGreaterThan(0);
      for (const part of parts) {
        for (const [, key] of part.matchAll(/(?:^|[\s{,])(\w+):/g)) {
          expect(moving.has(key) || timing.has(key), `${name}: ${key}`).toBe(true);
        }
      }
    }
  });
});

describe('the signature files keep the design rules', () => {
  it('stack with --z-* only and name no colour', () => {
    for (const [, value] of css.matchAll(/z-index:\s*([^;]+);/g)) {
      expect(value).toMatch(/var\(--z-[\w-]+\)/);
    }
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(?:white|black)(?![\w-])/i);
    for (const name of SIGNATURE_TS) {
      const source = strip(read(name));
      expect(source, name).not.toMatch(/#[\da-f]{3,8}\b(?!-)|\brgba?\(|\bhsla?\(/i);
      expect(source, name).not.toMatch(/zIndex\s*[:=]\s*['"]?\d/);
    }
  });

  it('has no browser datetime field anywhere in the client: ui/DateTimePicker replaced it', () => {
    const offenders = walk(path.join(ROOT, 'src', 'client'), ['.ts', '.tsx'])
      .filter((file) => /type=["']datetime-local["']|type:\s*["']datetime-local["']/.test(strip(readFileSync(file, 'utf8'))))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
    const picker = strip(read('DateTimePicker.tsx'));
    expect(picker).not.toMatch(/<input\b/);
    expect(picker).toMatch(/role="grid"/);
    expect(picker).toMatch(/aria-modal="true"/);
    expect(picker).toMatch(/useLayer\(/);
    expect(picker).toMatch(/trapTab\(/);
  });
});
