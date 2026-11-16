// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_BUTTON_WIDTH, LABELLED_CHROME } from '../../src/client/components/reader/barDensity';
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
    // A labelled button is its words plus the chrome barDensity.ts counts: 10 px padding each side, a 16 px icon, a 6 px gap, 1 px borders.
    const labelled = /\.rd-bar \.ui-btn\.rd-lbl \{\s*gap: (\d+)px;\s*padding: 0 (\d+)px;/.exec(cssCode);
    expect(labelled).not.toBeNull();
    expect(2 * Number(labelled?.[2]) + 16 + Number(labelled?.[1]) + 2).toBe(LABELLED_CHROME);
  });

  it('is an ARIA toolbar (one Tab stop, arrow keys) built on ui/Toolbar, with a name, on desktop and on a phone', () => {
    expect(view).toMatch(/<Toolbar\s+aria-label=\{tr\('reader\.actions_label'\)\}/);
    expect(view).toMatch(/<Toolbar aria-label=\{tr\('reader\.nav_label'\)\} className="rd-top">/);
  });

  it('keeps the phone arithmetic of index.css (.nm-bar: the buttons share the row down to 320 px) and the desktop class (.nm-bar-d)', () => {
    expect(view).toMatch(/compact \? 'nm-bar' : 'nm-bar-d'/);
    // The phone bar never wraps, and stays above the home indicator.
    expect(cssCode).toMatch(/\.rd-bar\[data-density='phone'\] \{\s*flex-wrap: nowrap;/);
    expect(cssCode).toMatch(/\.rd-bar\[data-density='phone'\] \{[^}]*env\(safe-area-inset-bottom, 0px\)/);
  });

  it('names every button by its label (the tooltip comes from the IconButton): no native title tooltip in the reader', () => {
    for (const name of [
      'MessageView.tsx',
      path.join('reader', 'LabelMenu.tsx'),
      path.join('reader', 'TrustChip.tsx'),
      'E2eBadge.tsx',
      'UnverifiedChip.tsx'
    ]) {
      // The `title` of EmptyState and of a Dialog (the phone's label sheet) is its heading, not a tooltip.
      const code = components(name)
        .replaceAll(/<EmptyState\b[\s\S]*?\/>/g, '')
        .replaceAll(/<Dialog\b[^>]*>/g, '');
      expect(code, name).not.toMatch(/\btitle=\{/);
    }
  });

  it('puts the colour of a state in the theme variables, not in the code', () => {
    for (const name of [
      'MessageView.tsx',
      path.join('reader', 'LabelMenu.tsx'),
      path.join('reader', 'TrustChip.tsx'),
      'E2eBadge.tsx',
      'UnverifiedChip.tsx'
    ]) {
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
    // The recipients line opens through the ui Disclosure; the turn of its chevron is stopped in ui.css. The trust chips open a Popover (its
    // motion is ui.css's, reduced there too); the chip is the 44 px target on a phone.
    expect(view).toMatch(/<Disclosure className="rd-rcpt"/);
    expect(components('reader', 'TrustChip.tsx')).toMatch(/className="nm-tap-h rd-badge-btn"\s+aria-haspopup="dialog"/);
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
    // The 44 px stamp stands beside two lines (name and address on 22 px; then the date, the recipients and the trust chips, J3-21); the star
    // is centred on the first.
    expect(cssCode).toMatch(/\.rd-line \{[^}]*align-content: center;[^}]*min-height: 22px;/);
    // J3-21: "date · to me" is one unit that never breaks at its dot; a column too narrow for both puts the recipients under the date, without it.
    expect(cssCode).toMatch(/\n\.rd-meta \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/);
    expect(cssCode).toMatch(/\.rd-who \{[^}]*container: rd-who \/ inline-size;/);
    expect(cssCode).toMatch(
      /@container rd-who \(max-width: 320px\) \{\s*\.rd-meta \{\s*flex-direction: column;[\s\S]*?\.rd-meta > \.rd-date::after \{\s*content: none;/
    );
    // The date and the recipients are two facts: a quiet dot between them, with empty alternative text (not read out).
    expect(cssCode).toMatch(/\.rd-meta > \.rd-date::after \{\s*content: '\\00B7' \/ '';/);
    // v3 R3, X1: the sender is a stamp in their own tint (avatarHue: the list row's tint), 56 px (40 on a phone), cancelled by the postmark.
    expect(view).toMatch(
      /<Avatar\s+name=\{sender\}\s+size=\{compact \? 40 : 'xl'\}\s+shape="stamp"\s+hue=\{avatarHue\(message\.from_address\)\}\s+className="rd-stamp-tile"\s+\/>/
    );
    expect(cssCode).toMatch(/\.rd-tools \{[^}]*min-height: 56px;\s*margin: 0 calc\(\(16px - var\(--ui-h-sm\)\) \/ 2\) 0 0;/);
    // The trust chips go to a line of their own when line 2 is short, so the date never moves for them (J3-21).
    expect(cssCode).toMatch(/\n\.rd-when \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
  });

  it('starts every phone bar slot at its top, so the icons share a row when a word takes two lines (J4-33)', () => {
    expect(cssCode).toMatch(/\.rd-bar\.nm-bar \.rd-tab \{\s*justify-content: flex-start;\s*align-self: stretch;/);
    expect(cssCode).toMatch(/\.rd-tab-text \{[^}]*-webkit-line-clamp: 2;[^}]*\}/);
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
    // In the flex column the view switch would stretch across the page (the reply dock is as wide as its buttons, Download original sits in
    // its own row).
    expect(cssCode).toMatch(/\.rd-page:has\(> \.rd-mail\) > \.rd-view \{\s*align-self: flex-start;/);
    expect(cssCode).toMatch(/\n\.rd-reply \{[^}]*width: fit-content;/);
    expect(cssCode).toMatch(/\n\.rd-end \{\s*display: flex;/);
    expect(frame).toMatch(/<div className="rd-frame" data-tall=\{tall\}>/);
    expect(frame).toMatch(/const tall = React\.useMemo\(\(\) => looksLong\(html\), \[html\]\);/);
    // The guess reads the text only: no DOMParser, no element, nothing that could load what the mail points at.
    expect(/function looksLong[\s\S]*?\n\}/.exec(frame)?.[0]).not.toMatch(/DOMParser|createElement|innerHTML|new Image/);
    // The sandbox is untouched.
    expect(frame).toMatch(/sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  });
});

describe('round-3 fixes of the reader (R3)', () => {
  const menu = components('reader', 'LabelMenu.tsx');
  const snooze = components('SnoozeMenu.tsx');

  it('names the label control Labels and draws each label as a checkbox that says what it did (J4-42)', () => {
    expect(view).toMatch(/const LABELS: MessageKey = 'reader\.labels';/);
    expect(menu).toMatch(/label=\{tr\('reader\.labels'\)\}/);
    expect(menu).toMatch(/role="checkbox"[\s\S]{0,120}aria-checked=\{on\}/);
    expect(menu).toContain("announce(tr(on ? 'reader.label_removed' : 'reader.label_applied', { label }));");
    expect(menu).not.toContain('reader.label_added');
    // The chips of the header take themselves off with an X named after the label, and say so.
    expect(view).toMatch(/removeLabel=\{tr\('reader\.remove_label', \{ label \}\)\}/);
    expect(view).toContain("announce(tr('reader.label_removed', { label }));");
  });

  it('labels Mark unread before Labels, and puts the toolbar glyphs on the reading column where the bar has room (J4-18, J3-36)', () => {
    expect(view).toContain(
      "return canSnooze ? ['archive', 'main', 'snooze', 'unread', 'label', 'other'] : ['archive', 'main', 'unread', 'label', 'other'];"
    );
    expect(view).toMatch(/style=\{align === null \? undefined : \{ paddingInlineStart: align\.start, paddingInlineEnd: align\.end \}\}/);
    // The column barDensity aligns to is the one reader.css draws (v3: 800 px centred over 880, else 784 from the left with 32 px margins;
    // X1: 40 px over it, 8 px more air under the toolbar).
    expect(cssCode).toMatch(/\n\.rd-page \{\s*max-width: 800px;\s*margin: 0 auto;\s*padding: 40px 40px 48px;/);
    expect(cssCode).toMatch(
      /@container \(max-width: 880px\) \{\s*\.rd-page:not\(\[data-compact='true'\]\) \{\s*max-width: 784px;\s*margin-inline: 0;\s*padding-inline: 32px;/
    );
    expect(cssCode).toMatch(/@container \(max-width: 480px\) \{\s*\.rd-page:not\(\[data-compact='true'\]\) \{\s*padding-inline: 24px;/);
    expect(view).toMatch(/const layout = compact \? null : alignedLayout\(pane\.width, pane\.coarse, widths\);/);
  });

  it('says a message is in Spam, with Move to Inbox, and makes Reply secondary there and for an unverified sender (J6-42)', () => {
    expect(view).toMatch(/\{inSpam \? \(\s*<div className="rd-spam">/);
    expect(view).toContain("tr('reader.spam_notice')");
    expect(view).toContain("variant={index === 0 && !inSpam && !unverified ? 'primary' : 'secondary'}");
  });

  it('offers Download all on the count line of two files or more, saved one after the other (J6-43)', () => {
    // The count line (and Download all at its end) exists from two files on (v3 R5).
    expect(view).toMatch(/\{attachments\.length > 1 \? \(\s*<div className="rd-files-head">[\s\S]{0,600}className="rd-dl-all"/);
    expect(view).toMatch(/downloads\.saveAll\(attachments\)/);
    expect(view).toMatch(/window\.setTimeout\(resolve, DOWNLOAD_GAP_MS\)/);
  });

  it("keeps one calendar glyph in the Snooze picker and says the picked time in the app's words (J3-39)", () => {
    expect(snooze.match(/\{picking \? null : <CalendarClock/g)).toHaveLength(2);
    expect(snooze.match(/<PickedTime id=\{`\$\{pickId\}-when`\} value=\{pick\} \/>/g)).toHaveLength(2);
    // v3 H9: the time is picked in the ui DateTimePicker (no browser date field left to restyle), which takes focus when the form opens.
    expect(snooze.match(/<DateTimePicker\b/g)).toHaveLength(2);
    expect(snooze).not.toMatch(/datetime-local/);
    expect(snooze.match(/querySelector<HTMLElement>\('\.ui-dtp-trigger'\)\?\.focus\(\)/g)).toHaveLength(2);
    expect(cssCode).not.toMatch(/webkit-calendar-picker-indicator/);
  });

  it('puts the phone top bar glyphs on the content column, in landscape too (J3-40)', () => {
    expect(cssCode).toMatch(
      /\.rd-top \{[^}]*padding: 2px calc\(max\(16px, env\(safe-area-inset-right, 0px\)\) - 12px\) 2px calc\(max\(16px, env\(safe-area-inset-left, 0px\)\) - 11px\);/
    );
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

describe('the signature of the open letter (v3 X1)', () => {
  it('gives only an open letter the airmail edge and a decorative postmark, and ends the letter with the dock (no trail since W5)', () => {
    // One airmail edge, in the open letter's own return (not the empty reader, the first load or a late skeleton), drawn and not read.
    expect(view.match(/rd-airmail/g)).toHaveLength(1);
    expect(view).toMatch(/\{waiting \? null : <span aria-hidden="true" className="ui-airmail rd-airmail" \/>\}/);
    expect(cssCode).toMatch(/\.ui-airmail\.rd-airmail \{[^}]*position: absolute;[^}]*z-index: var\(--z-raise\);/);
    // v3 P1: the postmark (ui/Postmark, aria-hidden) is the letter's corner ornament, top right: the ring alone with the year, apart from
    // the sender's stamp (which stands alone); the date written in words stays the one date a screen reader hears.
    expect(view).toMatch(
      /<header className="rd-head">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<Postmark date=\{message\.created_at\} size=\{64\} waves="none" lower="year" className="rd-postmark" \/>\s*<h2 id="msg-subject"/
    );
    expect(view).toMatch(/<span className="rd-date">\{formatFullDate\(message\.created_at\)\}<\/span>/);
    expect(cssCode).toMatch(/\.ui-avatar\.rd-stamp-tile \{\s*rotate: -2deg;/);
    // W5 lead review 7: its middle on the middle of the subject's first line (40 / 2 - 64 / 2; 32 / 2 - 64 / 2 in a compact column), its
    // date printed at 10 px (64 px = the drawing's own units), its right edge on the column's; the subject and the labels keep 80 px clear
    // of it while it shows, and a column under 480 px drops it (the subject is never squeezed or covered).
    expect(cssCode).toMatch(/\.ui-postmark\.rd-postmark \{\s*float: right;\s*margin: -12px 0 20px 16px;/);
    expect(cssCode).toMatch(/\.rd-page\[data-compact='true'\] \.ui-postmark\.rd-postmark \{\s*margin-top: -16px;/);
    expect(cssCode).toMatch(/\.ui-postmark\.rd-postmark :is\(\.ui-postmark-day, \.ui-postmark-time\) \{[^}]*font-size: 10px;/);
    expect(cssCode).toMatch(/\.rd-head > :is\(\.rd-subject, \.rd-tags\) \{\s*margin-inline-end: 80px;/);
    // W5 lead review 4: the label row stands on the subject's ink edge with a relative shift (a negative margin is dropped beside the float).
    expect(cssCode).toMatch(/\.rd-tags \{\s*position: relative;\s*left: -8px;[^}]*margin: 10px 0 0;/);
    expect(cssCode).toMatch(/\.rd-head > \.rd-sender \{\s*clear: right;/);
    expect(cssCode).toMatch(
      /@container rd-head \(max-width: 479px\) \{\s*\.ui-postmark\.rd-postmark \{\s*display: none;\s*\}\s*\.rd-head > :is\(\.rd-subject, \.rd-tags\) \{\s*margin-inline-end: 0;/
    );
    // The typographic peak: the subject 32/40 650.
    expect(cssCode).toMatch(/\n\.rd-subject \{[^}]*font-size: 32px;\s*line-height: 40px;\s*font-weight: 650;\s*letter-spacing: -0\.022em;/);
    // W5 lead review 6: no trail leaves the dock (it read as a stray connector); the empty reader keeps its trail; no end mark either.
    expect(view).not.toContain('rd-reply-trail');
    expect(css).not.toContain('rd-reply-trail');
    expect(view).toContain('const trailArt = <FlightTrail size="sm" />;');
    expect(view).not.toContain('rd-end-mark');
    // W5 lead review 5: the files and the dock close the letter in one column, the dock's width; the full-width block is what the reply
    // row's density is measured on (never the fit-content dock: a feedback loop).
    expect(view).toMatch(
      /<div ref=\{replyRef\} className="rd-close" data-compact=\{compact\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?\{attachments\.length > 0 \? \(/
    );
    expect(view).toMatch(/<div className="rd-reply-row" data-compact=\{compact\}>/);
    expect(cssCode).toMatch(/\.rd-close:not\(\[data-compact='true'\]\) \{\s*display: grid;\s*grid-template-columns: fit-content\(100%\);/);
    expect(cssCode).toMatch(/\.rd-close:not\(\[data-compact='true'\]\) > \.rd-files \{\s*contain: inline-size;/);
  });
});
