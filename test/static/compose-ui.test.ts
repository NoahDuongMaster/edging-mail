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
// The motion of the window (composeMotion.ts) draws its own layers (the flight, the button's look at the open): their classes count too.
const motion = path.join(COMPOSE, 'composeMotion.ts');
const read = (file: string): string => readFileSync(file, 'utf8');
const css = read(path.join(COMPOSE, 'compose.css'));
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));

describe('the compose window', () => {
  it('uses the cp-* classes that compose.css defines, and compose.css defines none that no component uses', () => {
    const used = words([...sources, motion].map(read).join('\n'), /\b(cp-[a-z][a-z0-9-]*)/g);
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
    // The one-line field left (the subject; From is read-only text since J6-30).
    expect(modal.match(/onKeyDown=\{enterToBody\}/g)).toHaveLength(1);
  });

  it('is one dialog with its own title and no second main landmark, and Discard asks in a ConfirmDialog (focus comes back to it)', () => {
    const modal = read(sources[0]);
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby="compose-title"');
    expect(modal).not.toMatch(/<main\b/);
    expect(modal.match(/ref=\{discardRef\}/g)).toHaveLength(1);
    expect(modal).toMatch(/<ConfirmDialog\s+isOpen=\{discardAsk\}/);
    expect(modal).toContain("title={tr('compose.discard_title')}");
  });

  it('closes at once when the message is sent (the flight and the announcement of the app follow), and keeps Send enabled', () => {
    const modal = read(sources[0]);
    // J6-02: the window closes as the message leaves (then it waits its Undo time, lib/outbox.ts), not after the send.
    expect(modal).toMatch(/const leave = async \(\): Promise<void> => \{[\s\S]*?exitRef\.current = 'sent';\s*onClose\(\);/);
    expect(modal).toMatch(/holdForUndo\(seconds\)/);
    expect(modal).toMatch(/readPrefs\(\)\.undoSend/);
    expect(modal).not.toMatch(/setTimeout\(onClose/);
    // Never disabled-until-valid: what is missing is said under its field.
    expect(/<Button\s+type="submit"[^>]*>/.exec(modal)?.[0]).not.toMatch(/disabled=/);
    expect(modal).toContain('data-send-icon=""');
  });

  it('shows the formatting toolbar as one row with the text style in a ui/Select: one Tab stop, pressed states, no browser prompt', () => {
    const toolbar = read(path.join(COMPOSE, 'FormatToolbar.tsx'));
    expect(toolbar).toContain('<Select');
    // J1-11: the list is in the toolbar's arrow keys and its single Tab stop (ui/Toolbar alone roves only buttons).
    expect(toolbar).toMatch(/const items = \[combo, \.\.\.toolbarItems\(toolbar\)\];/);
    expect(css).toMatch(/\.cp-fmt \{[^}]*flex-wrap: nowrap;[^}]*overflow: hidden;/);
    expect(toolbar).toMatch(/<Toolbar aria-label=\{tr\('compose\.format_group'\)\}/);
    for (const format of ['bold', 'italic', 'underline', 'bullets', 'numbers', 'quote']) {
      expect(toolbar).toContain(`${format}: formats.${format}`);
    }
    expect(toolbar).toContain('pressed={pressed[tool.id]}');
    // Link and image ask for their address in a small dialog under their button, not in window.prompt.
    expect(toolbar).not.toMatch(/window\.prompt|no-alert/);
    expect(toolbar).toMatch(/role="dialog"/);
  });

  it('never hides a tool in a sideways scroll: what does not fit goes into a More formatting menu at the end of the row (J1-12, J5-06)', () => {
    const toolbar = read(path.join(COMPOSE, 'FormatToolbar.tsx'));
    expect(css).not.toMatch(/\.cp-fmt \{[^}]*overflow-x: auto/);
    expect(toolbar).toMatch(/new ResizeObserver\(measure\)/);
    expect(toolbar).toMatch(/<Menu items=\{moreItems\} align="end" label=\{tr\('compose\.more_formatting'\)\}/);
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
    for (const name of ['cc', 'bcc']) {
      expect(modal).toContain(`error={badField === '${name}' ? tr('compose.invalid_address') : undefined}`);
    }
    // To says either problem under itself: not an address, or nobody at Send.
    expect(modal).toContain(
      "const toError = badField === 'to' ? tr('compose.invalid_address') : missing === 'to' ? missingText.to : undefined;"
    );
    expect(modal).toContain('error={toError}');
    // An empty To or subject is said under that field too, never in the notice at the top (the sender is read-only: J6-30).
    for (const key of ['need_recipient', 'need_subject']) {
      expect(modal).not.toMatch(new RegExp(String.raw`setStatus\(\{ text: tr\('compose\.${key}'\)`));
    }
    // So that it does not come and go with every key (each time moving the fields under it), it stays until its own field holds only
    // addresses: not cleared by the change of any field (formKey) nor by typing in the body.
    expect(modal).toMatch(
      /if \(\[\.\.\.list, \.\.\.splitRecipients\(typed\)\]\.every\(\(part\) => isAddress\(part\)\)\) \{\s*setBadField\(null\);/
    );
    expect(modal.match(/setBadField\(null\)/g)).toHaveLength(2);
  });
});

describe('round-2 fixes of the compose (R2)', () => {
  const modal = read(sources[0]);
  const flight = read(motion);

  it('shows From as read-only text, the account address the server sends with, with no field and no missing-sender check (J6-30)', () => {
    expect(modal).not.toMatch(/id="compose-from"/);
    expect(modal).not.toMatch(/compose\.missing_from|compose\.from_placeholder|setMissing\('from'\)/);
    expect(modal).toMatch(/<p className="cp-field cp-from">/);
    expect(modal).toMatch(/const sender = nonEmpty\(defaultFrom\) \?\? nonEmpty\(draft\.from\) \?\? '';/);
  });

  it('keeps the header X whole beside a long status (J5-20) and pads every phone row away from a landscape notch (J5-16)', () => {
    expect(modal).toMatch(/className="cp-close"/);
    expect(css).toMatch(/\.cp-head \.ui-icon-btn\.cp-close \{\s*flex: none;\s*min-width: var\(--ui-h-md\);/);
    for (const rule of ['.cp-row', '.cp-editor', '.cp-quote', '.cp-attach', '.cp-notice', '.cp-note']) {
      const block = new RegExp(String.raw`\n  ${rule.replace('.', String.raw`\.`)} \{[^}]*env\(safe-area-inset-left, 0px\)`);
      expect(css, rule).toMatch(block);
    }
    expect(css).toMatch(/\.cp-foot \{[^}]*max\(16px, env\(safe-area-inset-left, 0px\)\)/);
  });

  it('flies Send on a plain ease-out of DURATION.flight, its wings on DURATION tokens, and caps the veil under reduced motion (J2-14, J2-10)', () => {
    expect(flight).toMatch(/const duration = DURATION\.flight;/);
    expect(flight).toMatch(/\{ duration, easing: 'ease-out', fill: 'forwards' \}/);
    expect(flight).toMatch(/duration: DURATION\.slow, delay: index \* DURATION\.micro/);
    expect(flight).not.toMatch(/duration = 450|duration: 320/);
    expect(flight).toMatch(/duration: reduced \? DURATION\.quick : DURATION\.base/);
  });

  it('grows the upload bar by transform only (J2-11) and draws the file tile with the reader (J3-15)', () => {
    const list = read(path.join(COMPOSE, 'AttachmentList.tsx'));
    expect(list).toMatch(/role="progressbar"/);
    expect(list).toMatch(/style=\{\{ transform: `scaleX\(\$\{percent \/ 100\}\)` \}\}/);
    expect(css).not.toMatch(/transition: width/);
    expect(css).toMatch(/\.cp-progress-fill \{[^}]*transform-origin: left center;[^}]*transition: transform var\(--dur-quick\) linear;/);
    expect(list).toMatch(/<FileTypeTile type=\{type\} t=\{t\} size="sm" \/>/);
    expect(read(path.join(COMPONENTS, 'MessageView.tsx'))).toMatch(/<FileTypeTile type=\{type\} t=\{t\} \/>/);
  });
});

describe('round-3 fixes of the compose (R3)', () => {
  const modal = read(sources[0]);
  const field = read(path.join(COMPOSE, 'RecipientField.tsx'));
  const cssCode = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

  it('suggests recipients through an APG combobox whose listbox exists only while it is open (J6-44)', () => {
    expect(field).toContain('role="combobox"');
    expect(field).toContain('aria-autocomplete="list"');
    expect(field).toContain('aria-expanded={open}');
    // aria-controls points at the list only while there is one; the marked row is the active descendant (focus stays in the input).
    expect(field).toContain('aria-controls={open ? listId : undefined}');
    expect(field).toContain('aria-activedescendant={current >= 0 ? optionId(current) : undefined}');
    expect(field).toMatch(/\{open \? \(\s*<div\s+id=\{listId\}\s+role="listbox"/);
    expect(field).toMatch(/role="option"\s+tabIndex=\{-1\}\s+aria-selected=\{index === current\}/);
    // Name and address in each row; Escape closes the list and not the compose; an input method's keys are its own.
    expect(field).toContain('className="cp-option-name"');
    expect(field).toContain('className="cp-option-addr"');
    expect(field).toMatch(/e\.key === 'Escape'[\s\S]{0,200}e\.stopPropagation\(\);/);
    expect(field).toMatch(/event\.nativeEvent\.isComposing \|\| event\.key === 'Process'/);
    expect(field).toMatch(/if \(composing\(e\)\) \{\s*return;/);
    // A press on a row keeps focus in the input.
    expect(field).toMatch(/onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
    // Fed only from the mail in memory (lib/contacts.ts), read when the compose opens.
    expect(modal).toMatch(/knownContacts\(latest\.current\.queryClient, defaultFrom\)/);
    const contacts = readFileSync(path.join(ROOT, 'src', 'client', 'lib', 'contacts.ts'), 'utf8');
    expect(contacts).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|apiRequest/);
    // Phone: a list in the flow under the field, rows of the touch height.
    expect(cssCode).toMatch(/\.cp-suggest \{\s*position: static;/);
    expect(field).toMatch(/<\/div>\s*\{trailing\}\s*<\/div>\s*\{open \? \(/);
    expect(cssCode).toMatch(/\.ui-option\.cp-option \{\s*min-height: var\(--ui-h-md\);/);
  });

  it('moves focus to the next chip, the previous one or the input after a removal, and says what went (J1-24)', () => {
    expect(field).toContain("announce(tr('compose.recipient_removed', { address }))");
    expect(field).toContain("announce(tr('compose.recipient_armed', { address: last }))");
    expect(field).toMatch(
      /const target = pending\.toInput \? undefined : \(next \?\? previous\);\s*\(target \?\? inputRef\.current\)\?\.focus\(\);/
    );
    expect(field).toMatch(/event\.key === 'Backspace' \|\| event\.key === 'Delete'/);
    expect(modal).not.toMatch(/onBackspace=/);
  });

  it('keeps Cc/Bcc on the first line of the To row (J3-35) and room to write in a short landscape compose with the keyboard up (J5-25)', () => {
    // The toggle is the row's own last column, after the field, not inside it.
    expect(field).toMatch(/<\/div>\s*\{trailing\}/);
    expect(cssCode).toMatch(/\.cp-toggle \{[^}]*align-self: flex-start;/);
    expect(modal).toMatch(/root\.dataset\.keyboard = window\.innerHeight - viewport\.height > 80 \? 'true' : 'false';/);
    expect(cssCode).toMatch(
      /@media \(max-width: 900px\) and \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.cp-head \{\s*min-height: 52px;/
    );
    expect(cssCode).toMatch(/\.cp-root\[data-keyboard='true'\] \.cp-foot \{\s*display: none;/);
    // Writing in the body with the keyboard up brings the body to the top of the form (the caret stays in view).
    expect(modal).toMatch(/const resize = \(\) => \{\s*fit\(\);\s*window\.requestAnimationFrame\(\(\) => bodyToTop\(root\)\);/);
    expect(cssCode).toMatch(/\.cp-root\[data-keyboard='true'\] \.ui-btn\.cp-head-send \{\s*display: inline-flex;/);
    // J3-40: the X's glyph ends on the content edge in landscape too (the inset, less the button's own inset).
    expect(cssCode).toMatch(/calc\(max\(16px, env\(safe-area-inset-right, 0px\)\) - \(var\(--ui-h-md\) - 18px\) \/ 2\)/);
  });
});
