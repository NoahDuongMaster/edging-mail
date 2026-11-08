// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_BUTTON_WIDTH } from '../../src/client/components/reader/barDensity';
import { ROOT } from './helpers/scan';

// The reader (MessageView and its parts), as files: what a source scan can hold. How it looks and behaves was run in a browser.

const components = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', 'components', ...parts), 'utf8');
const css = components('reader.css');
const cssCode = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
const view = components('MessageView.tsx');

describe('the reader toolbar', () => {
  it('has the button width that reader/barDensity.ts counts with, for a mouse and for a touch screen', () => {
    expect(/\.rd-bar \{\s*--rd-btn: (\d+)px;/.exec(cssCode)?.[1]).toBe(String(BAR_BUTTON_WIDTH.fine));
    expect(/@media \(pointer: coarse\) \{\s*\.rd-bar\[data-compact='false'\] \{\s*--rd-btn: (\d+)px;/.exec(cssCode)?.[1]).toBe(
      String(BAR_BUTTON_WIDTH.coarse)
    );
    expect(cssCode).toMatch(/\.rd-bar\[data-compact='false'\] \.ui-icon-btn\[data-size\] \{\s*width: var\(--rd-btn\);/);
  });

  it('keeps the phone arithmetic of index.css (.nm-bar, .nm-bar-sep) and the desktop class (.nm-bar-d)', () => {
    expect(view).toMatch(/compact \? 'nm-bar' : 'nm-bar-d'/);
    expect(view).toMatch(/compact && 'nm-bar-sep'/);
    // The phone bar never wraps.
    expect(cssCode).toMatch(/\.rd-bar\[data-density='phone'\] \{\s*flex-wrap: nowrap;/);
  });

  it('names every button by its label (the tooltip comes from the IconButton): no native title tooltip in the reader', () => {
    for (const name of ['MessageView.tsx', path.join('reader', 'LabelMenu.tsx'), 'E2eBadge.tsx', 'UnverifiedChip.tsx']) {
      // The `title` of EmptyState is its heading, not a tooltip.
      const code = components(name).replaceAll(/<EmptyState\b[^>]*\/>/g, '');
      expect(code, name).not.toMatch(/\btitle=\{/);
    }
  });

  it('puts the colour of a state in the theme variables, not in the code', () => {
    for (const name of ['MessageView.tsx', path.join('reader', 'LabelMenu.tsx'), 'E2eBadge.tsx', 'UnverifiedChip.tsx']) {
      expect(components(name), name).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });

  it('switches HTML and plain text with a radio SegmentedControl named for screen readers (with an HTML body the mail frame renders, which needs a browser)', () => {
    expect(view).toMatch(/<SegmentedControl\s+className="rd-view"\s+label=\{tr\('reader\.view_label'\)\}/);
    expect(view).not.toMatch(/mode="toggle"/);
    expect(view).toMatch(/value=\{showHtml \? 'html' : 'plain'\}/);
  });
});

describe('the reader stylesheet', () => {
  it('stops every transition under reduced motion: the chevrons turn in ui/Disclosure, which rests there, and reader.css stops whatever it moves itself', () => {
    // The recipients line and the end-to-end badge open through the ui Disclosure; the turn of its chevron is stopped in ui.css.
    expect(view).toMatch(/<Disclosure className="rd-rcpt"/);
    expect(components('E2eBadge.tsx')).toMatch(/<Disclosure className="nm-tap-h rd-badge-btn"/);
    const ui = readFileSync(path.join(ROOT, 'src', 'client', 'ui', 'ui.css'), 'utf8');
    expect(ui).toMatch(/\.ui-disclosure-chevron \{[^}]*transition: transform/);
    expect(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(ui)?.[1]).toContain('.ui-disclosure-chevron');
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    const moving = [...cssCode.matchAll(/^([^{}@]+)\{[^}]*\btransition:/gm)].flatMap((rule) =>
      rule[1].split(',').map((part) => part.trim())
    );
    for (const selector of moving) {
      expect(block, selector).toContain(selector);
    }
  });

  it('names no colour of its own (everything is a variable) except the white canvas of a mail', () => {
    const colours = [...cssCode.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0].toLowerCase());
    expect(colours).toEqual(['#fff']);
  });

  it('makes the recipients line a 44 px box on touch that covers no other text, and keeps the sender address to one line', () => {
    // 12 px above and under the 20 px line; the 12 px under it go back to what follows the head. Only the disclosure (a button: something is
    // cut and it opens) is a target; the plain line of text keeps its own height, or it would leave a dead band of 12 px under the head.
    expect(cssCode).toMatch(
      /@media \(max-width: 900px\), \(pointer: coarse\) \{\s*button\.rd-rcpt \{\s*padding-block: 12px;\s*margin-bottom: -12px;\s*\}/
    );
    expect(cssCode).not.toMatch(/(^|[\s,}])\.rd-rcpt \{[^}]*padding-block/);
    expect(cssCode).toMatch(/\n\.rd-addr \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(cssCode).not.toMatch(/\n\.rd-addr \{[^}]*overflow-wrap: anywhere/);
    // Opening the recipients shows the whole address: it wraps only after its @ and before a dot (MessageView puts a <wbr> there while it is
    // open), never inside a name, as `overflow-wrap: anywhere` did ('jordan.lee@example.c' / 'om' at 320 px).
    expect(cssCode).toMatch(/\.rd-head:has\(\.rd-rcpt\[aria-expanded='true'\]\) \.rd-addr \{[^}]*white-space: normal;/);
    expect(cssCode).toMatch(/\.rd-head:has\(\.rd-rcpt\[aria-expanded='true'\]\) \.rd-addr \{[^}]*overflow-wrap: normal;/);
    expect(cssCode).not.toMatch(/\.rd-addr \{[^}]*overflow-wrap: anywhere/);
    expect(view).toMatch(/\{recipientsOpen \? wrappableAddress\(message\.from_address\) : message\.from_address\}/);
    expect(view).toMatch(/replaceAll\('@', '@\\n'\)\.replaceAll\('\.', '\\n\.'\)/);
    // A hyphen inside a name is a break of its own ('notifications.riverside-' / 'clinic.example'): each piece is a nowrap span.
    expect(view).toMatch(/<span key=\{nodes\.length\} className="rd-addr-part">/);
    expect(cssCode).toMatch(/\.rd-addr-part \{\s*white-space: nowrap;\s*\}/);
    // The address is who the mail is from, in the face of the interface: not mono, which reads as code.
    expect(/\n\.rd-addr \{([^}]*)\}/.exec(cssCode)?.[1]).not.toMatch(/font-family/);
    // The date and the Star / Reply buttons share one centre: the line is as high as the 32 px avatar.
    expect(cssCode).toMatch(/\.rd-line \{[^}]*align-content: center;[^}]*min-height: 32px;/);
  });
});

describe('the mail frame', () => {
  // Nothing can measure the mail inside the sandbox. A short mail must still end, with its files and Reply, in the first view (a frame as
  // tall as the column pushed Reply under the fold for three lines of text); a mail guessed long keeps a frame as tall as the column.
  const frame = components('MailFrame.tsx');

  it('fills what the page of an HTML mail leaves, and gives a mail guessed long the height of the column', () => {
    expect(cssCode).toMatch(/\.rd-page:has\(> \.rd-mail\) \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100cqh;/);
    expect(cssCode).toMatch(/\.rd-mail,\s*\.rd-frame \{\s*flex: 1 0 auto;\s*\}/);
    expect(cssCode).toMatch(/\.rd-frame > iframe \{\s*flex: 1 0 auto;\s*min-height: 240px;\s*\}/);
    expect(cssCode).toMatch(/\.rd-frame\[data-tall='true'\] > iframe \{\s*height: max\(240px, 100cqh - 48px\);\s*\}/);
    // In the flex column the view switch and the Download button would stretch across the page.
    expect(cssCode).toMatch(
      /\.rd-page:has\(> \.rd-mail\) > \.rd-view,\s*\.rd-page:has\(> \.rd-mail\) > \.rd-raw \{\s*align-self: flex-start;/
    );
    expect(frame).toMatch(/<div className="rd-frame" data-tall=\{tall\}>/);
    expect(frame).toMatch(/const tall = React\.useMemo\(\(\) => looksLong\(html\), \[html\]\);/);
    // The guess reads the text only: no DOMParser, no element, nothing that could load what the mail points at.
    expect(/function looksLong[\s\S]*?\n\}/.exec(frame)?.[0]).not.toMatch(/DOMParser|createElement|innerHTML|new Image/);
    // The sandbox is untouched.
    expect(frame).toMatch(/sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  });
});

describe('the label menu', () => {
  it('moves with Up and Down, and jumps with Home and End, between the labels (as ui/Menu), leaving those keys to the field of a new label', () => {
    const menu = components('reader', 'LabelMenu.tsx');
    expect(menu).toMatch(/case 'Home':\s*case 'End': \{/);
    expect(menu).toMatch(/list\.includes\(document\.activeElement as HTMLElement\)/);
    expect(menu).toMatch(/list\.at\(event\.key === 'Home' \? 0 : -1\)\?\.focus\(\)/);
  });
});
