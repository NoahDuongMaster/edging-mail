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
const ui = (name: string): string => readFileSync(path.join(ROOT, 'src', 'client', 'ui', name), 'utf8');

// The buttons are the ui Button and the field the ui TextField since the redesign. Both draw ONE native element and hand it every other prop, so the
// data-autofocus that the focus code looks for, the ref and the disabled state land on the real <button> and <input>, and the DOM order of the buttons
// in the row is the source order of the <Button> elements.
it('the ui Button and TextField give their props to one native element', () => {
  const button = ui('Button.tsx');
  expect(button.match(/<button\b/g)).toHaveLength(1);
  expect(button).toMatch(/<button[^>]*\{\.\.\.rest\}\s*>/);
  const field = ui('TextField.tsx');
  expect(field).toMatch(/<input\s[^>]*\{\.\.\.input\}/);
});

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
      /<Button data-autofocus disabled=\{action\.busy\} onClick=\{\(\) => setConfirming\(null\)\}>\s*\{tr\('common\.cancel'\)\}/
    );
    // The two buttons of the confirmation, element by element: Cancel first, as in every other confirmation ([Cancel] [action], ConfirmDialog), and
    // the marker on Cancel, never anywhere in the element of the action. What keeps a held Enter off the action is that marker and the repeat
    // guard (ADM-1 below), whatever the order of the two buttons.
    const buttons = confirmation.split('<Button').slice(1);
    expect(buttons).toHaveLength(2);
    const [cancel, action] = buttons;
    expect(cancel).toContain('data-autofocus');
    expect(cancel).toContain("tr('common.cancel')");
    expect(action).toContain('void pending.run()');
    expect(action).toContain('{pending.action}');
    expect(action).not.toContain('data-autofocus');
    expect(confirmation).toMatch(/<div className="ad-confirm-foot">\s*<Button data-autofocus/);
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
    expect(row.match(/<Button\b/g)).toHaveLength(7);
    // Nothing else in the row draws a button that the places would count (an icon button, a menu, a bare <button>).
    expect(row).not.toMatch(/<(button|IconButton|Menu)\b/);
    expect(row.indexOf("setConfirming('promote')")).toBeLessThan(row.indexOf("setConfirming('disable')"));
    expect(row.indexOf("setConfirming('reissue')")).toBeLessThan(row.indexOf('onClick={onDelete}'));
    // The role button is first in the row: nothing is rendered before the first <Button.
    expect(row.indexOf('<Button')).toBeLessThan(row.indexOf("setConfirming('promote')"));
    expect(row.slice(0, row.indexOf('<Button'))).not.toMatch(/<(input|a|TextField|Select)\b/);
  });

  it('lets Escape take a confirmation back before it closes the dialog, and not while a request runs', () => {
    expect(dialog).toMatch(
      /\} else if \(event\.key === 'Escape' && !action\.busy\) \{\s*event\.stopPropagation\(\);\s*setConfirming\(null\);/
    );
    expect(rowAndConfirmation().confirmation).toMatch(/role="group"\s+aria-label=\{tr\('common\.confirm'\)\}\s+onKeyDown=\{confirmKey\}/);
    // The confirmation's Cancel button still does the same, and the dialog's own Escape (the frame) is not touched.
    expect(rowAndConfirmation().confirmation).toMatch(/onClick=\{\(\) => setConfirming\(null\)\}/);
    // The frame is a ui Dialog, which lets the controls inside answer Escape first: layers.ts leaves an Escape pressed inside a dialog to the
    // dialog's own keydown, which React runs after the confirmation's, and which closes nothing once the confirmation stopped the key.
    expect(read('adminUi.tsx')).toMatch(/<Dialog\s+inline\b/);
    expect(ui('layers.ts')).toMatch(/\? 'content' : 'close'/);
    expect(ui('Dialog.tsx')).toMatch(/useLayer\(true, escape, rootRef\)/);
    expect(ui('Dialog.tsx')).toMatch(/onKeyDown=\{onKeyDown\}/);
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

  it('puts the keyboard back on Delete account when its dialog is cancelled, not on the close button of the remounted person dialog', () => {
    // Cancel (and Escape, and the X) of Delete account opens the person dialog again, marked `back`; the dialog then moves the focus, after the
    // frame's own effect gave it to the X (a child's effect runs first), to the button that asked.
    const panel = read('UsersPanel.tsx');
    expect(panel).toMatch(/onClose=\{\(\) => setDialog\(\{ kind: 'manage', id: deleting\.id, back: true \}\)\}/);
    expect(panel).toMatch(/focusDelete=\{dialog\?\.kind === 'manage' && dialog\.back === true\}/);
    expect(dialog).toMatch(
      /React\.useEffect\(\(\) => \{\s*if \(focusDelete\) \{\s*deleteRef\.current\?\.focus\(\{ preventScroll: true \}\);/
    );
    expect(dialog).toMatch(/<Button ref=\{deleteRef\} variant="danger" disabled=\{action\.busy\} onClick=\{onDelete\}>/);
  });
});

describe('Delete account opens with the keyboard in the field for the address (D-6)', () => {
  it('focuses the field after the frame has put focus on its first control, the Close button of the title bar', () => {
    expect(remove).toMatch(/const field = React\.useRef<HTMLInputElement \| null>\(null\);/);
    expect(remove).toMatch(/React\.useEffect\(\(\) => \{\s*field\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[\]\);/);
    expect(remove).toMatch(/<TextField\s+ref=\{field\}\s+id="delete-user-confirm"/);
    // A held Enter that opened this dialog lands in the field and submits the form: the submit button is disabled and the handler returns until the typed address
    // matches the account's, so nothing destructive can happen from the keyboard repeat (ADM-1).
    expect(remove).toMatch(/if \(!matches \|\| action\.busy\) \{\s*return;\s*\}/);
    expect(remove).toMatch(/type="submit"\s+disabled=\{!matches \|\| action\.busy\}/);
    // The focus is the dialog's own effect, not a change of the shared frame (a child's effect runs first, so this one comes last): the frame is a ui
    // Dialog, whose effect (inside the frame, so a child of this dialog) gives the focus to the frame's first control and, on close, back to the opener
    // or, when the opener is gone, to the account avatar.
    const frame = read('adminUi.tsx');
    expect(frame).toContain("'[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])'");
    expect(frame).toMatch(/firstRef\.current = panel\?\.querySelector<HTMLElement>\(FIRST_CONTROL\) \?\? null;/);
    expect(frame).toMatch(/ref=\{findFirst\}\s+initialFocusRef=\{firstRef\}\s+returnFocusRef=\{ACCOUNT_BUTTON\}/);
  });
});
