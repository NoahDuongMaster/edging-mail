import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tr } from '../../src/client/lib/i18n';
import {
  Chip,
  CodeBlock,
  CopyButton,
  Disclosure,
  ListSkeleton,
  SecretBox,
  SegmentedControl,
  Step,
  Steps,
  TableSkeleton
} from '../../src/client/ui';
import { copyText } from '../../src/client/ui/CopyButton';
import { segmentTarget } from '../../src/client/ui/SegmentedControl';
import { skeletonRows } from '../../src/client/ui/SkeletonRows';

// The shared primitives of wave 4 (SegmentedControl, CopyButton, SecretBox, CodeBlock, Disclosure, Steps, the skeleton rows, Chip): their pure
// logic, and the markup a screen reader and the stylesheet rely on, rendered on the server side of React (no browser). The keyboard paths,
// the clipboard of a real browser and the looks are for the browser check.

const noop = (): void => {
  // a callback the test does not look at
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);
/** The opening tags of the elements whose class attribute is exactly `name`. */
const tagsOf = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`<[a-z0-9]+ [^>]*class="${name}"[^>]*>`, 'g'))].map((m) => m[0]);

describe('SegmentedControl', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B', disabled: true },
    { value: 'c', label: 'C' },
    { value: 'd', label: 'D' }
  ] as const;

  it('moves with the arrows (round, over a disabled option), jumps with Home and End, and ignores other keys', () => {
    expect(segmentTarget(options, 0, 'ArrowRight')).toBe(2);
    expect(segmentTarget(options, 0, 'ArrowDown')).toBe(2);
    expect(segmentTarget(options, 3, 'ArrowRight')).toBe(0);
    expect(segmentTarget(options, 0, 'ArrowLeft')).toBe(3);
    expect(segmentTarget(options, 2, 'ArrowUp')).toBe(0);
    expect(segmentTarget(options, 2, 'Home')).toBe(0);
    expect(segmentTarget(options, 0, 'End')).toBe(3);
    expect(segmentTarget(options, 0, 'Enter')).toBe(-1);
    expect(segmentTarget(options, -1, 'ArrowRight')).toBe(0);
  });

  it('is a named radiogroup by default: aria-checked on each option and one Tab stop, the chosen one', () => {
    const html = render(h(SegmentedControl, { label: 'View', options, value: 'c', onChange: noop }));
    expect(html).toMatch(/^<div role="radiogroup" aria-label="View" class="ui-seg" data-size="sm">/);
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(4);
    expect(radios.map((tag) => /aria-checked="(\w+)"/.exec(tag)?.[1])).toEqual(['false', 'false', 'true', 'false']);
    expect(radios.map((tag) => /tabindex="(-?\d)"/.exec(tag)?.[1])).toEqual(['-1', '-1', '0', '-1']);
    expect(radios[1]).toContain('disabled=""');
  });

  it('gives the Tab stop to the first option that can be chosen when the value is none of them', () => {
    const html = render(h(SegmentedControl, { label: 'View', options, value: 'b', onChange: noop }));
    expect([...html.matchAll(/tabindex="0"/g)]).toHaveLength(1);
    expect(tagsOf(html, 'ui-seg-item')[0]).toContain('tabindex="0"');
  });

  it('is a group of toggle buttons in toggle mode: aria-pressed, every button its own Tab stop, and it can wrap', () => {
    const html = render(h(SegmentedControl, { label: 'Filter', mode: 'toggle', wrap: true, options, value: 'a', onChange: noop }));
    expect(html).toMatch(/^<div role="group" aria-label="Filter" class="ui-seg" data-size="sm" data-wrap="true">/);
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('tabindex');
    expect(tagsOf(html, 'ui-seg-item').map((tag) => /aria-pressed="(\w+)"/.exec(tag)?.[1])).toEqual(['true', 'false', 'false', 'false']);
  });

  it('wraps by pairs, so four segments are one row or two even rows (never three and one); a track that does not wrap has no pairs', () => {
    for (const mode of ['toggle', 'radio'] as const) {
      const html = render(h(SegmentedControl, { label: 'Filter', mode, wrap: true, options, value: 'a', onChange: noop }));
      const pairs = html.split('<div class="ui-seg-pair">').slice(1);
      expect(pairs, mode).toHaveLength(2);
      expect(pairs.map((pair) => (pair.match(/class="ui-seg-item"/g) ?? []).length)).toEqual([2, 2]);
      expect(render(h(SegmentedControl, { label: 'View', mode, options, value: 'a', onChange: noop }))).not.toContain('ui-seg-pair');
    }
    const three = render(h(SegmentedControl, { label: 'Filter', wrap: true, options: options.slice(0, 3), value: 'a', onChange: noop }));
    expect(three.split('<div class="ui-seg-pair">')).toHaveLength(3);
  });
});

describe('CopyButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copyText says true when the text is on the clipboard and false when the browser refuses or has no clipboard, and logs nothing', async () => {
    const logged = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('s3cret')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('s3cret');
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    expect(await copyText('s3cret')).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await copyText('s3cret')).toBe(false);
    for (const spy of logged) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('is a button that says Copy with an icon, never shows the text, and has an empty polite status for "Copied"', () => {
    const html = render(h(CopyButton, { text: 's3cret', size: 'lg', className: 'au-btn' }));
    // Copied is in the button too, invisible and hidden from screen readers (ui.css `ui-copy-label`), so the button keeps one width.
    expect(html).toMatch(
      new RegExp(
        `^<button type="button" class="ui-btn au-btn" data-variant="secondary" data-size="lg"><svg[^>]*>.*</svg><span class="ui-copy-label">` +
          `<span data-shown="true">${tr('common.copy')}</span><span data-shown="false" aria-hidden="true">${tr('common.copied')}</span></span></button>`
      )
    );
    expect(html).not.toContain('s3cret');
    expect(html).toContain('<span role="status" class="ui-visually-hidden"></span>');
  });
});

describe('SecretBox', () => {
  it('lays the parts of a key in a named grid, with a caption over each part, never translated', () => {
    const html = render(
      h(SecretBox, {
        label: 'Recovery key',
        value: ['aaaaaa', 'bbbbbb', 'aaaaaa'],
        columns: 3,
        partLabel: (index: number) => `Group ${index + 1}`
      })
    );
    expect(html).toMatch(/^<div role="group" aria-label="Recovery key" class="ui-secret">/);
    expect(html).toContain(
      '<ol role="list" translate="no" class="ui-secret-grid" style="grid-template-columns:repeat(3, minmax(0, 1fr))">'
    );
    expect(tagsOf(html, 'ui-secret-part')).toHaveLength(3);
    expect(html).toContain('<span class="ui-secret-caption">Group 3</span><span class="ui-secret-value">aaaaaa</span>');
  });

  it('puts an app key on one line that breaks only between its groups', () => {
    const html = render(h(SecretBox, { label: 'Key', value: ['JBSW', 'Y3DP', 'EH'], layout: 'inline', 'data-testid': 'twofa-secret' }));
    expect(html).toContain('data-testid="twofa-secret"');
    expect(html).toContain(
      '<code translate="no" class="ui-secret-value"><span class="ui-secret-nowrap">JBSW</span> <span class="ui-secret-nowrap">Y3DP</span> <span class="ui-secret-nowrap">EH</span></code>'
    );
    expect(html.replaceAll(/<[^>]+>/g, '')).toBe('JBSW Y3DP EH');
  });

  it('shows one value with its buttons inside the box, under it', () => {
    const html = render(h(SecretBox, { label: 'Temporary password', value: 'pw-1234' }, h('button', { type: 'button' }, 'Copy')));
    expect(html).toBe(
      '<div role="group" aria-label="Temporary password" class="ui-secret"><code translate="no" class="ui-secret-value">pw-1234</code><div class="ui-secret-actions"><button type="button">Copy</button></div></div>'
    );
  });
});

describe('CodeBlock', () => {
  it('keeps the commands as they are typed, line breaks included, in a block that is never translated', () => {
    expect(render(h(CodeBlock, null, 'npm ci\nnpm run deploy'))).toBe('<pre translate="no" class="ui-code">npm ci\nnpm run deploy</pre>');
  });
});

describe('Disclosure', () => {
  it('says whether it is open and what it opens, with the chevron after its words', () => {
    const closed = render(
      h(Disclosure, { open: false, onOpenChange: noop, controls: 'note', className: 'rd-badge-btn', children: 'More' })
    );
    expect(closed).toMatch(
      /^<button type="button" class="ui-disclosure rd-badge-btn" data-look="text" aria-expanded="false" aria-controls="note">More<svg[^>]*class="[^"]*ui-disclosure-chevron/
    );
    const open = render(h(Disclosure, { open: true, onOpenChange: noop, children: 'More' }));
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).not.toContain('aria-controls');
  });

  it('has the look of a ghost button when asked', () => {
    const html = render(h(Disclosure, { open: false, onOpenChange: noop, controls: 'steps', look: 'button', children: 'Show the steps' }));
    expect(html).toMatch(
      /^<button type="button" class="ui-btn ui-disclosure" data-variant="ghost" data-size="sm" aria-expanded="false" aria-controls="steps">/
    );
    expect(html).toMatch(/Show the steps<svg[^>]*ui-disclosure-chevron/);
  });
});

describe('Steps', () => {
  it('is an ordered list (the role is kept where the numbers are drawn by CSS), one sentence per step or a title with blocks under it', () => {
    const html = render(
      h(Steps, null, h(Step, null, 'Open the dashboard.'), h(Step, { title: 'Deploy' }, h('p', null, 'It builds the app.')))
    );
    expect(html).toBe(
      '<ol role="list" class="ui-steps"><li class="ui-step">Open the dashboard.</li><li class="ui-step"><h3 class="ui-step-title">Deploy</h3><div class="ui-step-body"><p>It builds the app.</p></div></li></ol>'
    );
    expect(render(h(Step, { title: 'Deploy', headingLevel: 4 }))).toBe('<li class="ui-step"><h4 class="ui-step-title">Deploy</h4></li>');
  });
});

describe('ListSkeleton and TableSkeleton', () => {
  it('draw between 1 and 6 rows', () => {
    expect(skeletonRows(0)).toHaveLength(1);
    expect(skeletonRows(3.7)).toHaveLength(3);
    expect(skeletonRows(99)).toHaveLength(6);
  });

  it('say they are busy and what loads, and hide the bars from screen readers', () => {
    const list = render(h(ListSkeleton, { label: 'Loading mail', rows: 6, lines: 3 }));
    expect(list).toMatch(/^<div role="status" aria-busy="true"><span class="ui-visually-hidden">Loading mail<\/span>/);
    expect(tagsOf(list, 'ui-skel-row')).toHaveLength(6);
    expect(tagsOf(list, 'ui-skel-row').every((tag) => tag.includes('aria-hidden="true"'))).toBe(true);
    expect((list.match(/class="ui-skeleton"/g) ?? []).length).toBe(18);
    // The third line stands for the quieter preview of a mail: it is shorter.
    expect((list.match(/height:12px/g) ?? []).length).toBe(6);

    const table = render(h(TableSkeleton, { label: 'Loading people' }));
    expect(table).toMatch(/^<div role="status" aria-busy="true" class="ui-skel-table">/);
    expect(tagsOf(table, 'ui-skel-row')).toHaveLength(4);
    expect((table.match(/class="ui-skeleton"/g) ?? []).length).toBe(8);
  });
});

describe('Chip', () => {
  it('draws a label in its colours with a dot, and a chip without colours as a quiet outline', () => {
    const label = render(h(Chip, { colors: { bg: 'rgb(1, 2, 3)', fg: 'rgb(4, 5, 6)', dot: 'rgb(7, 8, 9)' }, children: 'Work' }));
    expect(label).toBe(
      '<span class="ui-chip" data-kind="label" style="background:rgb(1, 2, 3);color:rgb(4, 5, 6)"><span aria-hidden="true" class="ui-chip-dot" style="background:rgb(7, 8, 9)"></span><span class="ui-chip-text">Work</span></span>'
    );
    const plain = render(h(Chip, { icon: h('svg'), className: 'x', children: 'Until 8:00' }));
    expect(plain).toBe(
      '<span class="ui-chip x" data-kind="plain"><span aria-hidden="true" class="ui-chip-icon"><svg></svg></span><span class="ui-chip-text">Until 8:00</span></span>'
    );
  });

  it('is a removable token with an X button named by removeLabel', () => {
    const html = render(h(Chip, { onRemove: noop, removeLabel: 'Remove ana@example.com', children: 'ana@example.com' }));
    expect(html).toMatch(
      /^<span class="ui-chip" data-kind="plain" data-removable="true"><span class="ui-chip-text">ana@example.com<\/span>/
    );
    expect(html).toMatch(
      /<button type="button" class="ui-btn ui-icon-btn ui-chip-x" data-variant="ghost" data-size="sm" aria-label="Remove ana@example.com"/
    );
  });
});
