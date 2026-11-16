// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The round-3 fixes of the ui library, the row menu, Settings, Security and the admin console (U3), pinned from the source; each was
// measured in the UI lab with a browser (Tab order and Page Down, frame-by-frame sheet tops, focus after a tap, boxes under safe-area
// insets, the accessibility tree), which a render test cannot do.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const dialog = read('ui', 'Dialog.tsx');
const media = read('ui', 'media.ts');
const motion = read('ui', 'motion.ts');
const menu = read('ui', 'Menu.tsx');
const uiCss = read('ui', 'ui.css');
const rowMenu = read('components', 'RowMenu.tsx');
const rowMenuCss = read('components', 'rowmenu.css');
const settings = read('components', 'SettingsModal.tsx');
const twoFactor = read('components', 'security', 'TwoFactorView.tsx');
const codes = read('components', 'auth', 'RecoveryCodesPanel.tsx');
const authCss = read('components', 'auth', 'auth.css');
const adminCss = read('components', 'admin', 'admin.css');
const deleteUser = read('components', 'admin', 'DeleteUserDialog.tsx');
const users = read('components', 'admin', 'UsersPanel.tsx');

describe('a dialog whose content scrolls can be read with the keyboard (J1-22)', () => {
  it('measures the element that scrolls (the body), and makes it a named region and a Tab stop only while it does', () => {
    expect(dialog).toContain('const bodyScrolls = useOverflows(bodyRef, false);');
    expect(dialog).toMatch(/role=\{bodyScrolls \? 'region' : undefined\}/);
    expect(dialog).toMatch(/aria-labelledby=\{bodyScrolls \? \(bodyLabelledBy \?\? titleId\) : undefined\}/);
    expect(dialog).toMatch(/tabIndex=\{bodyScrolls \? 0 : undefined\}/);
    expect(settings).toMatch(/bodyLabelledBy=\{`\$\{TABS_ID\}-tab-\$\{current\.id\}`\}/);
    expect(uiCss).toMatch(/\.ui-dialog-body:focus-visible \{\s*outline-offset: -2px;/);
  });

  it('measures again when a motion inside ends: an entrance that slides overflows while it moves (no empty stop, J1-18)', () => {
    expect(media).toContain("element.addEventListener('animationend', update);");
    expect(media).toContain("element.addEventListener('transitionend', update);");
  });
});

describe('a sheet that shows another list in place of the one tapped', () => {
  it('moves its top edge to the new height instead of jumping, from one place for every sheet (J2-21)', () => {
    expect(dialog).toContain('useSheetResize(panelRef, bodyRef, isSheet);');
    expect(motion).toMatch(/export function useSheetResize\(/);
    // A taller sheet slides up from its old top (transform), a shorter one closes its height, both 200ms standard; the new list fades in.
    expect(motion).toMatch(/panel\.animate\(\[\{ transform: `translateY\(\$\{delta\}px\)` \}, \{ transform: 'none' \}\], timing\)/);
    expect(motion).toMatch(/panel\.animate\(\[\{ height: `\$\{drawn\}px` \}, \{ height: `\$\{after\}px` \}\], timing\)/);
    expect(motion).toContain('const timing = { duration: DURATION.base, easing: EASING.standard };');
    expect(motion).toContain("node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.quick, easing: 'linear' });");
    // Reduced motion: the height is instant, only the fade plays.
    expect(motion).toMatch(/if \(motionReduced\(\)\) \{\s*return;\s*\}\s*const timing/);
  });

  it('gives focus to the first item of the new list; Back still returns to the item that opened it (J1-23, F4)', () => {
    expect(rowMenu).toContain("const first = popup || view !== 'actions' ? list?.querySelector<HTMLElement>('.ml-menu-item') : null;");
    expect(rowMenu).toContain('(opener ?? first)?.focus({ preventScroll: true });');
    // Any dialog: focus that fell to the page with a change of its content goes to its first control, a frame later.
    expect(dialog).toMatch(
      /if \(\(now === document\.body \|\| now === null\) && panel\.isConnected && isTop\(\)\) \{\s*\(firstControl\(panel\) \?\? panel\)\.focus/
    );
  });
});

describe('the row menu', () => {
  it('heads a list opened from an item with Back and the list name, not a Back at its foot; the folders have the sidebar glyphs (J3-37)', () => {
    expect(rowMenu).not.toMatch(/const back: Item = \{/);
    expect(rowMenu).toContain('className="ml-menu-item ml-menu-back"');
    expect(rowMenu).toContain("? tr('action.move_to_folder')");
    expect(rowMenu).toMatch(/inbox: Inbox,\s*archive: Archive,\s*spam: Ban,\s*trash: Trash2/);
    expect(rowMenu).toContain('icon: <FolderIcon folder={target} {...icon} />');
    expect(menu).toMatch(/\{\s*id: backId,\s*label: backLabel,[\s\S]*?\},\s*\.\.\.parent\.items\s*\]/);
    expect(menu).toContain('className="ui-menu-item ui-menu-back"');
  });

  it('offers Reply all with its key after Reply when the list passes it, and opens on any list it is asked for (J6-40)', () => {
    expect(rowMenu).toMatch(/id: 'replyAll',\s*label: tr\('action\.reply_all'\),\s*\.\.\.keyed\('replyAll'\)/);
    expect(rowMenu).toContain("export type RowMenuView = 'actions' | 'snooze' | 'label' | 'move';");
    expect(rowMenu).toContain('initialView?: RowMenuView;');
  });

  it('lays a long list out in two columns on a short landscape screen, so nothing is cut at the bottom (J5-27)', () => {
    expect(rowMenu).toContain("import './rowmenu.css';");
    expect(rowMenuCss).toMatch(/@media \(min-width: 641px\) and \(max-height: 500px\) \{/);
    expect(rowMenuCss).toMatch(/\.ui-dialog\.ml-menu \.ml-menu-list:has\(> li:nth-child\(6\)\) \{\s*display: block;\s*columns: 2;/);
  });
});

describe('Settings and the admin console on a phone on its side (J5-23)', () => {
  it('keep every control out of the bands of the notch and the corners', () => {
    expect(uiCss).toMatch(
      /padding: max\(16px, env\(safe-area-inset-top\)\) max\(16px, env\(safe-area-inset-right\)\) max\(16px, env\(safe-area-inset-bottom\)\)\s+max\(16px, env\(safe-area-inset-left\)\);/
    );
    expect(adminCss).toMatch(/padding-inline: env\(safe-area-inset-left\) env\(safe-area-inset-right\);/);
  });
});

describe('deleting an account and new recovery codes', () => {
  it('reads the warning of a deletion when its alert dialog opens (J1-26)', () => {
    expect(deleteUser).toContain('describedBy={WARNING_ID}');
    expect(deleteUser).toContain('<p id={WARNING_ID} className="ad-text ad-warn">');
    expect(dialog).toContain('aria-describedby={describedBy ?? (description === undefined ? undefined : descriptionId)}');
  });

  it('says why the ways out of Settings are off while new codes are on screen (J1-27)', () => {
    expect(settings).toMatch(/\{secretHeld \? \(\s*<p id=\{HELD_REASON_ID\} className="st-held-note">/);
    expect([...settings.matchAll(/aria-describedby=\{secretHeld \? HELD_REASON_ID : undefined\}/g)]).toHaveLength(2);
  });

  it('has one heading over new codes and the replaced-codes fact as a quiet notice (J3-41); two columns from a 360px box (J5-26)', () => {
    expect(twoFactor).toMatch(
      /<ViewFrame t=\{t\} title=\{tr\('security\.codes_new_title'\)\} onBack=\{null\}>\s*<Banner tone="info" live=\{false\}>/
    );
    expect(twoFactor).toContain('showHeading={false}');
    expect(codes).toMatch(/\{showHeading \? \(\s*<Heading ref=\{heading\}/);
    expect(authCss).toMatch(/\.au-codes \{\s*container: au-codes \/ inline-size;\s*padding-inline: 12px;/);
    expect(authCss).toMatch(
      /@container au-codes \(max-width: 326px\) \{\s*\.au-codes \.ui-secret-grid \{\s*grid-template-columns: max-content;/
    );
  });
});

describe('the People page (J4-44)', () => {
  it('shows when the temporary password stops working in the Last sign-in cell of a person who never signed in', () => {
    expect(users).toContain('<TempExpiry at={user.temp_password_expires_at} />');
    expect(users).toContain("tr('users.temp_password_expires', { when })");
  });
});
