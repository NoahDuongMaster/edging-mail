// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// Truong D-6: in the person dialog, Enter on Make admin, Disable account or Reset two-factor sign-in swaps the buttons for an inline confirmation, and the keyboard
// focus fell to the page; Delete account opened its dialog with focus on Close instead of the field for the address. The repo has no DOM in its tests, so these read
// the sources, as the other focus promises of the client are pinned (client-contracts.test.ts).

const read = (name: string): string => readFileSync(path.join(ROOT, 'src', 'client', 'components', 'admin', name), 'utf8');
const dialog = read('UserDialog.tsx');
const remove = read('DeleteUserDialog.tsx');

/** The buttons of the row of actions and of the confirmation, as source text. */
const rowAndConfirmation = (): { row: string; confirmation: string } => {
  const start = dialog.indexOf('{pending === null ? (');
  const middle = dialog.indexOf('role="group"', start);
  const end = dialog.indexOf('{scheduledDue === null', middle);
  expect(start).toBeGreaterThan(0);
  expect(middle).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(middle);
  return { row: dialog.slice(start, middle), confirmation: dialog.slice(middle, end) };
};

describe('the person dialog keeps the keyboard where it was (D-6)', () => {
  it('moves focus to the Cancel button of a confirmation when one appears, and back to the button that asked when it goes away', () => {
    expect(dialog).toMatch(/React\.useEffect\(\(\) => \{[^]*?shownRef\.current = confirming;[^]*?\}, \[confirming\]\);/);
    // Appears: focus goes to the control marked data-autofocus, and that is the CANCEL button, never the action (ADM-1: a held Enter must not land on the action).
    expect(dialog).toMatch(
      /if \(confirming !== null\) \{\s*target = actionsRef\.current\?\.querySelector<HTMLElement>\('\[data-autofocus\]'\);/
    );
    const { confirmation } = rowAndConfirmation();
    expect(confirmation.match(/data-autofocus/g)).toHaveLength(1);
    expect(confirmation).toMatch(
      /<button type="button" data-autofocus disabled=\{action\.busy\} onClick=\{\(\) => setConfirming\(null\)\} style=\{s\.button\}>\s*\{tr\('common\.cancel'\)\}/
    );
    const action = confirmation.slice(confirmation.indexOf('void pending.run()'), confirmation.indexOf('{pending.action}'));
    expect(action).toContain('void pending.run()');
    expect(action).not.toContain('data-autofocus');
    expect(confirmation.indexOf('void pending.run()')).toBeLessThan(confirmation.indexOf('data-autofocus'));
    // Goes away (Cancel, Escape, done): back to the button at the place of the one that asked, if there was one.
    expect(dialog).toMatch(
      /\} else if \(before !== null\) \{\s*target = actionsRef\.current\?\.querySelectorAll<HTMLElement>\('button'\)\.item\(BUTTON_PLACE\[before\]\);/
    );
    expect(dialog).toMatch(/target\?\.focus\(\{ preventScroll: true \}\);/);
    expect(dialog).toMatch(/<section ref=\{actionsRef\} aria-labelledby="user-actions"/);
  });

  it('names the place of each asking button, and the places match the order of the buttons in the row', () => {
    const places = /BUTTON_PLACE[^=]*= \{ promote: (\d), demote: (\d), disable: (\d), reset2fa: (\d), reissue: (\d) \}/.exec(dialog);
    expect(places?.slice(1).map(Number)).toEqual([0, 0, 1, 2, 3]);
    const { row } = rowAndConfirmation();
    // The row, in source order: the role button (promote or demote), the status button (disable, or enable that asks nothing), two-factor, temporary password, delete.
    const asks = [...row.matchAll(/setConfirming\('(\w+)'\)/g)].map((match) => match[1]);
    expect(asks).toEqual(['promote', 'demote', 'disable', 'reset2fa', 'reissue']);
    expect(row.match(/<button\b/g)).toHaveLength(7);
    expect(row.indexOf("setConfirming('promote')")).toBeLessThan(row.indexOf("setConfirming('disable')"));
    expect(row.indexOf("setConfirming('reissue')")).toBeLessThan(row.indexOf('onClick={onDelete}'));
    // The role button is first in the row: nothing is rendered before the first <button.
    expect(row.indexOf('<button')).toBeLessThan(row.indexOf("setConfirming('promote')"));
    expect(row.slice(0, row.indexOf('<button'))).not.toMatch(/<(input|a)\b/);
  });

  it('lets Escape take a confirmation back before it closes the dialog, and not while a request runs', () => {
    expect(dialog).toMatch(
      /\} else if \(event\.key === 'Escape' && !action\.busy\) \{\s*event\.stopPropagation\(\);\s*setConfirming\(null\);/
    );
    expect(rowAndConfirmation().confirmation).toMatch(/role="group"\s+aria-label=\{tr\('common\.confirm'\)\}\s+onKeyDown=\{confirmKey\}/);
    // The confirmation's Cancel button still does the same, and the dialog's own Escape (the frame) is not touched.
    expect(rowAndConfirmation().confirmation).toMatch(/onClick=\{\(\) => setConfirming\(null\)\}/);
  });

  it('does not let a held Enter press a button of a confirmation again (ADM-1)', () => {
    // A repeat of the Enter key is stopped before it reaches the button (its default action would be a click), so even a held Enter cannot confirm.
    expect(dialog).toMatch(
      /const confirmKey = \(event: React\.KeyboardEvent\) => \{\s*if \(event\.key === 'Enter' && event\.repeat\) \{\s*event\.preventDefault\(\);\s*\}/
    );
  });

  it('keeps the file within 300 lines', () => {
    expect(dialog.split('\n').length).toBeLessThanOrEqual(300);
  });
});

describe('Delete account opens with the keyboard in the field for the address (D-6)', () => {
  it('focuses the field after the frame has put focus on its first control, the Close button of the title bar', () => {
    expect(remove).toMatch(/const field = React\.useRef<HTMLInputElement \| null>\(null\);/);
    expect(remove).toMatch(/React\.useEffect\(\(\) => \{\s*field\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[\]\);/);
    expect(remove).toMatch(/<input\s+ref=\{field\}\s+id="delete-user-confirm"/);
    // A held Enter that opened this dialog lands in the field and submits the form: the submit button is disabled and the handler returns until the typed address
    // matches the account's, so nothing destructive can happen from the keyboard repeat (ADM-1).
    expect(remove).toMatch(/if \(!matches \|\| action\.busy\) \{\s*return;\s*\}/);
    expect(remove).toMatch(/type="submit"\s+disabled=\{!matches \|\| action\.busy\}/);
    // The focus is the dialog's own effect, not a change of the shared frame (a child's effect runs first, so this one comes last).
    const frame = read('adminUi.tsx');
    expect(frame).toContain("'[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])'");
  });
});
