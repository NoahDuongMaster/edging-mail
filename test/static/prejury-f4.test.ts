// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The last pre-jury fixes (F4), pinned from the source; each was measured in the UI lab with a browser (arrow keys, boxes in px, hit tests,
// animation timings, axe), which a render test cannot do.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const toolbar = read('ui', 'Toolbar.tsx');
const menu = read('ui', 'Menu.tsx');
const rowMenu = read('components', 'RowMenu.tsx');
const snooze = read('components', 'SnoozeMenu.tsx');
const selectionBar = read('components', 'SelectionBar.tsx');
const shell = read('lib', 'shellMotion.ts');
const listCss = read('components', 'messagelist.css');
const mailboxCss = read('components', 'mailbox.css');
const settingsCss = read('components', 'settings', 'settings.css');

describe('the selection bar is a toolbar the arrows move through', () => {
  it('a checkbox in a toolbar does not keep Left and Right (Select all was a dead end); a text field and a radio still do', () => {
    expect(toolbar).toContain("const ARROWLESS_INPUTS = new Set(['checkbox', 'button', 'submit', 'reset', 'image']);");
    expect(toolbar).toMatch(
      /if \(keepsArrows\(event\.target\) && \(event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'\)\) \{\s*return;/
    );
    expect(toolbar).not.toContain('event.target instanceof HTMLInputElement && (event.key');
  });
});

describe('the phone Settings sheet keeps its X on the screen', () => {
  it('the head pads 6px on the right and the X has no negative margin there (it ended 1px past a 390px screen)', () => {
    const phone = settingsCss.slice(settingsCss.indexOf('/* ---------- A phone: list, then section ---------- */'));
    expect(phone).toMatch(/\.st-dialog > \.ui-dialog-head \{\s*align-items: center;\s*padding: 18px 6px 10px 16px;\s*\}/);
    expect(phone).toMatch(/\.st-dialog > \.ui-dialog-head > \.ui-btn \{\s*margin-right: 0;\s*\}/);
  });
});

describe('the landscape Compose button is the box it looks like', () => {
  it('a 48px square with no slide and no clip; its name is visually hidden, not cut away', () => {
    const land = mailboxCss.slice(mailboxCss.indexOf('@media (orientation: landscape) and (max-height: 500px)'));
    expect(land).toMatch(
      /\.mb-fab\.ui-btn\[data-size\] \{[^}]*width: var\(--mb-fab-h\);[^}]*padding: 0;[^}]*transform: none;\s*clip-path: none;/
    );
    expect(land).toMatch(
      /\.mb-fab-label \{\s*position: absolute;\s*width: 1px;\s*height: 1px;\s*overflow: hidden;\s*clip-path: inset\(50%\);/
    );
  });
});

describe('phone multi-select can snooze', () => {
  it('the More sheet has Snooze where it is offered, and it opens the Snooze choices IN the same sheet (J2-22: never a second sheet)', () => {
    expect(selectionBar).toContain("const snoozable = !(bin || folder === 'sent' || folder === 'snoozed' || folder === 'all');");
    expect(selectionBar).toMatch(
      /id: 'snooze', label: tr\('action\.snooze'\), icon: <Clock \{\.\.\.SHEET_ICON\} \/>, run: \(\) => open\('snooze'\)/
    );
    expect(selectionBar).not.toContain('<SnoozeSheet');
    const view = selectionBar.slice(selectionBar.indexOf("case 'snooze': {\n      title = tr('snooze.menu_label');"));
    expect(view).toContain('snoozePresets(snoozeFrom)');
    expect(selectionBar).toContain("label: tr('snooze.pick_date_time')");
    expect(selectionBar).toMatch(/<Button type="submit" form=\{formId\} variant="primary" fullWidth>/);
  });

  it('the reader and the bar share one Snooze sheet: the quick times, Pick date & time, Snooze in the footer', () => {
    expect(snooze).toMatch(/export function SnoozeSheet\(\{ opened, \.\.\.rest \}: SnoozeSheetProps\)/);
    expect(snooze).toMatch(/<SnoozeSheet\s+opened=\{menu\?\.now \?\? null\}/);
    const sheet = snooze.slice(snooze.indexOf('function OpenSnoozeSheet('));
    expect(sheet).toContain('snoozePresets(opened)');
    expect(sheet).toContain("tr('snooze.pick_date_time')");
    expect(sheet).toMatch(/<Button type="submit" form=\{formId\} variant="primary" fullWidth>/);
  });
});

describe('the row menu goes back to the item it came from', () => {
  it('Back and Left remember the list they leave; the item that opened it takes focus (b, Left: Snooze)', () => {
    expect(rowMenu).toMatch(/const goBack = \(\) => \{\s*setCameFrom\(view\);\s*setView\('actions'\);/);
    expect(rowMenu).toMatch(/event\.key === 'ArrowLeft' && view !== 'actions'\) \{\s*event\.preventDefault\(\);\s*goBack\(\);/);
    expect(rowMenu).toContain("data-opens={view === 'actions' && OPENS_LIST.has(item.id) ? item.id : undefined}");
  });
});

describe('the selection bar enters and leaves', () => {
  it('enters with the standard fade and 8px move on the tokens, after the head has mostly faded (J2-23: 60ms)', () => {
    expect(listCss).toMatch(
      /\.ml-selbar,\s*\.ml-selbar-phone \{\s*animation: nm-slide-down var\(--dur-base\) var\(--ease-enter\) 60ms both;/
    );
  });

  it('leaves by a fade-through on an inert copy laid over its place (90 ms, 8px up; a fade only under reduced motion)', () => {
    expect(selectionBar.match(/useLeaveInPlace\(countRef, '/g)?.length).toBe(2);
    expect(selectionBar).toContain('fadeOutInPlace(bar, { lift: true, replacedBy });');
    const leave = shell.slice(shell.indexOf('export function fadeOutInPlace('));
    expect(shell).toContain('export const HEAD_FADE_OUT_MS = 90;');
    expect(leave).toContain("position: 'absolute'");
    expect(leave).toContain('const lift = options.lift && !motionReduced();');
    expect(leave).toContain('duration: HEAD_FADE_OUT_MS');
  });
});

describe('a menu button names no popup id that axe cannot check', () => {
  it('the trigger has aria-haspopup and aria-expanded, no aria-controls', () => {
    expect(menu).not.toContain("'aria-controls'");
    expect(menu).toContain("'aria-haspopup': 'menu',");
    expect(menu).toContain("'aria-expanded': open,");
  });
});
