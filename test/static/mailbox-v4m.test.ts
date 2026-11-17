// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// v4m wave 2, the mailbox (DESIGN-v4m R1-R4) as source facts: the mailbox's stylesheets write no font size or line height as a number (the
// type variables, or calc from them), a phone reads a list row at 16/15/15/13, the phone's search stays under the app bar while the filters
// scroll away, the long banner and reader texts are one short line with the rest behind See why or an InfoTip, the inline text buttons have
// their touch box, and a sheet's choices are 48 px rows. The looks and the measured behaviour were checked in the lab.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const strip = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
const PHONE = '@media (max-width: 640px), (pointer: coarse) {';

/** The body of the first block opened by `opening` (a media query), to its matching brace. */
function block(css: string, opening: string): string {
  const at = css.indexOf(opening);
  if (at === -1) {
    return '';
  }
  let depth = 0;
  for (let end = at + opening.length - 1; end < css.length; end += 1) {
    if (css[end] === '{') {
      depth += 1;
    } else if (css[end] === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(at + opening.length, end);
      }
    }
  }
  return '';
}

const SHEETS = [
  'components/mailbox.css',
  'components/messagelist.css',
  'components/reader.css',
  'components/compose/compose.css',
  'components/toast.css',
  'components/shortcuts.css',
  'components/rowmenu.css'
];

describe('mailbox type (DESIGN-v4m R2)', () => {
  it('writes no literal font size or line height in the mailbox stylesheets (the aria-hidden postmark letters excepted)', () => {
    for (const file of SHEETS) {
      const css = strip(read(...file.split('/')));
      const literal = [...css.matchAll(/([^{};]+)\{[^}]*?(?:font-size|line-height):\s*[\d.]+px/g)].map((m) => m[1].trim());
      const allowed = file.endsWith('reader.css') ? ['.ui-postmark.rd-postmark :is(.ui-postmark-day, .ui-postmark-time)'] : [];
      expect(literal, file).toEqual(allowed);
    }
  });

  it('reads a phone row at 16 (sender) / 15 (subject, preview) / 13 (time, day heading), each line 22 px, and keeps the v3 half steps on a desktop', () => {
    const css = strip(read('components', 'messagelist.css'));
    expect(css).toMatch(/\.ml-sender \{[^}]*font-size: calc\(var\(--fs-body\) \+ 0\.5px\);\s*line-height: var\(--ml-line\);/);
    expect(css).toMatch(/\.ml-time \{[^}]*font-size: calc\(var\(--fs-meta\) \+ 0\.5px\);/);
    expect(css).toMatch(/\.ml-preview \{[^}]*font-size: var\(--fs-secondary\);\s*line-height: var\(--ml-line\);/);
    const phone = block(css, PHONE);
    expect(phone).toMatch(/\.ml-sender \{\s*font-size: var\(--fs-body\);/);
    expect(phone).toMatch(/\.ml-subject \{\s*font-size: var\(--fs-secondary\);/);
    expect(phone).toMatch(/\.ml-time \{\s*font-size: var\(--fs-meta\);/);
    expect(phone).toMatch(/\.ml-group-title \{\s*font-size: var\(--fs-meta\);/);
    // The unread weight is unchanged (650 against 500 read).
    expect(css).toMatch(/\.ml-row\[data-unread='true'\] \.ml-sender \{\s*font-weight: 650;/);
  });

  it('sets the reader body at 16/26 and the compose From, Subject and body at 16 on a phone', () => {
    const reader = strip(read('components', 'reader.css'));
    expect(reader).toMatch(
      /\.rd-text\[data-compact='true'\] \{\s*font-size: calc\(var\(--fs-secondary\) \+ 1px\);\s*line-height: calc\(var\(--lh-secondary\) \+ 4px\);/
    );
    const compose = strip(read('components', 'compose', 'compose.css'));
    expect(block(compose, '@media (max-width: 900px) {')).toMatch(
      /\.cp-field\.cp-from,\s*\.cp-subject \{\s*font-size: var\(--fs-body\);\s*line-height: var\(--lh-body\);/
    );
  });
});

describe('mailbox chrome on a phone (DESIGN-v4m R3, R4)', () => {
  const list = read('components', 'MessageList.tsx');
  const app = read('App.tsx');

  it('keeps the search under the app bar (outside the scroller) while the scope, the Trash line and the filters scroll away', () => {
    expect(list).toContain(`{compact && searchSlot !== undefined ? <div className="ml-search">{searchSlot}</div> : null}`);
    const tools = list.slice(list.indexOf('<div className="ml-tools"'), list.indexOf('</div>', list.indexOf('<div className="ml-tools"')));
    expect(tools).not.toContain('{searchSlot}');
    expect(list.indexOf('compact && searchSlot !== undefined')).toBeLessThan(list.indexOf('<div className="ml-scroll-wrap">'));
    // A hairline under it only once rows pass under it.
    expect(list).toContain("scroller.closest('.ml-root')?.toggleAttribute('data-scrolled', scroller.scrollTop > 0);");
    const css = strip(read('components', 'messagelist.css'));
    expect(css).toMatch(/\.ml-root\[data-compact='true'\]\[data-scrolled\] > \.ml-search \{\s*box-shadow: 0 1px 0 var\(--border\);/);
  });

  it("puts the notices at the top of the list's scroller on a phone (they scroll away; the app bar and the search stay)", () => {
    expect(app).toContain('notices={banners}');
    expect(app).not.toContain("{mobilePane === 'list' ? banners : null}");
    const tools = list.slice(list.indexOf('<div className="ml-tools"'), list.indexOf('</div>', list.indexOf('<div className="ml-tools"')));
    expect(tools).toMatch(/^<div className="ml-tools"[^>]*>\s*\{notices\}/);
  });

  it('gives a phone the app bar title at the title size, and the sheets 48 px rows', () => {
    const mailbox = strip(read('components', 'mailbox.css'));
    expect(mailbox).toMatch(/\.mb-phone-title h1 \{[^}]*font-size: var\(--fs-title\);\s*line-height: var\(--lh-title\);/);
    const reader = strip(read('components', 'reader.css'));
    expect(reader).toMatch(/\.ui-menu-item\.rd-sheet-item \{[^}]*min-height: calc\(var\(--control-touch\) \+ 4px\);/);
    expect(reader).toMatch(/\.rd-label-sheet \.ui-menu-item\.rd-menu-item \{\s*min-height: calc\(var\(--control-touch\) \+ 4px\);/);
    expect(block(strip(read('components', 'messagelist.css')), PHONE)).toMatch(
      /\.ml-menu-item \{\s*min-height: calc\(var\(--control-touch\) \+ 4px\);/
    );
  });
});

describe('mailbox copy (DESIGN-v4m R1)', () => {
  it('says the locked mail in one line with See why after it (an inline text button), and opens the more notices with one too', () => {
    const locked = read('components', 'LockedMailBanner.tsx');
    expect(locked).toContain("tr('locked.banner_short', { count: row.mail.locked })");
    expect(locked).not.toContain("tr('locked.banner',");
    expect(locked).toMatch(/<Disclosure open=\{why\} onOpenChange=\{setWhy\} controls=\{whyId\} inline>/);
    expect(read('components', 'NoticesBanner.tsx')).toMatch(
      /<Disclosure open=\{open\} onOpenChange=\{setOpen\} controls=\{panelId\} inline>/
    );
  });

  it('puts the why of hidden images, of a message locked with an older key and of a plain message into InfoTips', () => {
    const frame = read('components', 'MailFrame.tsx');
    expect(frame).toMatch(
      /\{tr\('frame\.images_blocked_short'\)\}<\/span>\s*<InfoTip label=\{tr\('frame\.images_tip_label'\)\}>\{tr\('frame\.images_blocked'\)\}<\/InfoTip>/
    );
    const view = read('components', 'MessageView.tsx');
    expect(view).toMatch(
      /\{tr\('mailcrypto\.note_other_key_short'\)\}<\/span>\s*<InfoTip label=\{tr\('mailcrypto\.subject_locked'\)\}>\{tr\(NOTE_KEYS\.other_key\)\}<\/InfoTip>/
    );
    // A notice whose why is in an InfoTip draws no second circled i of its own.
    expect(strip(read('components', 'reader.css'))).toMatch(
      /:is\(\.rd-note, \.rd-mail\) \.ui-banner\[data-tone='info'\]:has\(\.ui-infotip\) > \.ui-banner-icon \{\s*display: none;/
    );
  });

  it('shows the Trash and Spam line only while the folder holds mail (the empty folder says it already)', () => {
    expect(read('components', 'MessageList.tsx')).toMatch(/const binLine =\s*bin && messages\.length > 0 \?/);
  });
});
