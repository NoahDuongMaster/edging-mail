// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The compose window (ComposeModal and components/compose/*) is built from the ui/ primitives and the `cp-*` classes of compose.css. A class name
// that is spelled differently in the markup and in the stylesheet draws nothing and raises no error, so the two lists are held equal here; and
// the controls the redesign replaced do not come back.

const COMPONENTS = path.join(ROOT, 'src', 'client', 'components');
const COMPOSE = path.join(COMPONENTS, 'compose');
const sources = [
  path.join(COMPONENTS, 'ComposeModal.tsx'),
  ...readdirSync(COMPOSE)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(COMPOSE, name))
];
const read = (file: string): string => readFileSync(file, 'utf8');
const css = read(path.join(COMPOSE, 'compose.css'));
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));

describe('the compose window', () => {
  it('uses the cp-* classes that compose.css defines, and compose.css defines none that no component uses', () => {
    const used = words(sources.map(read).join('\n'), /\b(cp-[a-z][a-z0-9-]*)/g);
    const defined = words(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''), /\.(cp-[a-z][a-z0-9-]*)/g);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });

  it('has no browser <select>, no bare <button>, no window.confirm or alert', () => {
    for (const file of sources) {
      const code = read(file)
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/^\s*\/\/.*$/gm, '');
      expect(code, path.basename(file)).not.toMatch(/<select\b|<button\b|window\.(confirm|alert)\b/);
    }
  });

  it('keeps its keys on the root of the window: Escape closes, Ctrl+Enter sends once, Tab stays inside, and Enter in a one-line field goes to the body', () => {
    const modal = read(sources[0]);
    expect(modal).toMatch(/trapTab\(e, dialogRef\.current\)/);
    expect(modal).toMatch(/e\.key === 'Escape'[\s\S]{0,40}requestClose\(\)/);
    expect(modal).toMatch(/e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)[\s\S]{0,80}handleSend\(\)/);
    expect(modal).toMatch(/closest\('\[role="alertdialog"\]'\)/);
    expect(modal).toMatch(/if \(sendingRef\.current\) \{\s*return;/);
    expect(modal.match(/onKeyDown=\{enterToBody\}/g)).toHaveLength(2);
  });

  it('is one dialog with its own title, and the discard button stays one element between its two presses', () => {
    const modal = read(sources[0]);
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby="compose-title"');
    expect(modal.match(/ref=\{discardRef\}/g)).toHaveLength(1);
    expect(modal).toContain("data-confirming={confirmingDiscard ? 'true' : undefined}");
  });

  it('shows the formatting toolbar as one scrolling row with the text style in a ui/Select', () => {
    const toolbar = read(path.join(COMPOSE, 'FormatToolbar.tsx'));
    expect(toolbar).toContain('<Select');
    expect(css).toMatch(/\.cp-fmt \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  });

  it('says that the row scrolls: the edge with buttons beyond it fades (a mask tied to the scroll position), nothing moves the layout', () => {
    const block = /@supports \(animation-timeline: scroll\(\)\) \{\s*\.cp-fmt \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/mask-image: linear-gradient\(/);
    expect(block).toMatch(/animation: cp-fmt-fade linear both;\s*animation-timeline: scroll\(self inline\);/);
    expect(block).toMatch(/scroll-padding-inline: 24px;/);
    expect(block).not.toMatch(/\b(?:padding|margin|width|height):/);
    // Not scrolled, the start has no fade; scrolled to the end, the end has none.
    expect(css).toMatch(/@keyframes cp-fmt-fade \{\s*0% \{\s*--cp-fade-start: 0px;\s*--cp-fade-end: 24px;/);
    expect(css).toMatch(/100% \{\s*--cp-fade-start: 24px;\s*--cp-fade-end: 0px;/);
  });

  it('says an address that is not one under its own field (an alert that describes the field), not in the notice at the top that pushed the form down', () => {
    const field = read(path.join(COMPOSE, 'RecipientField.tsx'));
    expect(field).toMatch(/aria-invalid=\{error === undefined \? undefined : true\}/);
    expect(field).toMatch(/aria-describedby=\{error === undefined \? undefined : `\$\{id\}-error`\}/);
    expect(field).toMatch(/<p id=\{`\$\{id\}-error`\} role="alert" className="cp-error">/);
    // A line of its own under the field, in the flow. It used to be drawn over the row below (position: absolute) so that nothing moved, but
    // then it covered the Subject field, also while the person typed in it; in the flow it covers nothing, and the rows under it move once
    // when it comes and once when it goes.
    const rule = /\n\.cp-error \{([^}]*)\}/.exec(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
    expect(rule).toMatch(/flex: 1 0 100%;/);
    expect(rule).not.toMatch(/position: absolute/);
    const modal = read(sources[0]);
    expect(modal).not.toMatch(/setStatus\(\{ text: tr\('compose\.invalid_address'\)/);
    for (const name of ['to', 'cc', 'bcc']) {
      expect(modal).toContain(`error={badField === '${name}' ? tr('compose.invalid_address') : undefined}`);
    }
    // So that it does not come and go with every key (each time moving the fields under it), it stays until its own field holds only
    // addresses: not cleared by the change of any field (formKey) nor by typing in the body.
    expect(modal).toMatch(
      /if \(\[\.\.\.list, \.\.\.splitRecipients\(typed\)\]\.every\(\(part\) => isAddress\(part\)\)\) \{\s*setBadField\(null\);/
    );
    expect(modal.match(/setBadField\(null\)/g)).toHaveLength(2);
  });
});
