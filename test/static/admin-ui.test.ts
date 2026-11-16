// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The admin console (components/admin/*) is built from the ui/ primitives and the `ad-*` classes of admin.css. A class name that is spelled
// differently in the markup and in the stylesheet draws nothing and raises no error, so the two lists are held equal here; the browser controls
// the redesign replaced do not come back; and what the console promises (its sections, real tables that stack on a phone, a password shown once)
// is pinned where a file scan can see it. The focus rules of the person dialog are in admin-focus.test.ts.

const ADMIN = path.join(ROOT, 'src', 'client', 'components', 'admin');
const names = readdirSync(ADMIN).filter((name) => name.endsWith('.tsx'));
const read = (name: string): string => readFileSync(path.join(ADMIN, name), 'utf8');
const code = (name: string): string =>
  read(name)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, '');
const css = read('admin.css');
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));

describe('the admin console', () => {
  it('uses the ad-* classes that admin.css defines, and admin.css defines none that no component uses', () => {
    const used = words(names.map(read).join('\n'), /\b(ad-[a-z][a-z0-9-]*)/g);
    const defined = words(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''), /\.(ad-[a-z][a-z0-9-]*)/g);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });

  it('gives every stacked People row on a phone one shape: the last sign-in on a line of its own, whatever the badges say', () => {
    // An Admin badge and a Member badge are words of different lengths: inline after them, the date sat on the badges' line for one person
    // and on its own line for the next.
    expect(css).toMatch(/\.ad-table \.ad-cell-person,\s*\.ad-table \.ad-cell-when \{\s*flex: 1 1 100%;\s*\}/);
    expect(css).toMatch(/\.ad-people \.ad-cell-person,\s*\.ad-people \.ad-cell-when \{\s*flex: 1 1 100%;\s*\}/);
  });

  it('lays People out by the width its table has: columns that never overflow from 680px, one block per person below (J3-02, J5-08)', () => {
    // A tablet (a 706px box) cut the last column and scrolled on two axes: the layout follows the table's box, not the window.
    expect(css).toMatch(/\.ui-table-wrap:has\(> \.ad-people\) \{\s*container: ad-people \/ inline-size;\s*\}/);
    const wide = /@container ad-people \(min-width: 680px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    // The person gives way (an ellipsis), every other column is as wide as its words.
    expect(wide).toMatch(/\.ad-people :is\(\.ad-col-person, \.ad-cell-person\) \{\s*width: 100%;\s*max-width: 0;/);
    expect(wide).toMatch(/\.ad-people :is\(\.ad-col-tag, \.ad-cell-tag\) \{\s*width: 1%;\s*white-space: nowrap;/);
    const narrow = /@container ad-people \(max-width: 679px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(/\.ad-people > thead \{[^}]*clip-path: inset\(50%\);/);
    expect(narrow).toMatch(/\.ad-people > tbody > tr \{[^}]*display: flex;\s*flex-wrap: wrap;/);
    // One scroller: the People pane no longer fills the sheet with a box that scrolls inside it.
    expect(read('UsersPanel.tsx')).not.toContain('data-fill');
  });

  it('gives every value of a People column one shape: roles are pills, statuses and two-factor are words after an icon (J3-13)', () => {
    const ui = read('adminUi.tsx');
    expect(ui).toMatch(/<Badge className="ad-role-admin">\{tr\('term\.admin'\)\}<\/Badge>/);
    expect(ui).toMatch(/<Badge>\{tr\('term\.member'\)\}<\/Badge>/);
    // No status is a pill any more.
    const status = ui.slice(ui.indexOf('export const PersonStatus'), ui.indexOf('export const PersonTwoFactor'));
    expect(status).not.toContain('<Badge');
    expect(status.match(/<StateWord/g)).toHaveLength(3);
  });

  it('shows two-factor sign-in in a People column with a filter, and in the person dialog (J6-18, J4-14)', () => {
    const people = read('UsersPanel.tsx');
    expect(people).toMatch(/<th scope="col" className="ad-col-tag">\s*\{tr\('users\.col_two_factor'\)\}/);
    expect(people).toMatch(/<PersonTwoFactor user=\{user\} short \/>/);
    expect(people).toMatch(/id="users-two-factor"/);
    expect(people).toMatch(/twoFactorMatches\(user, twoFactor\)/);
    expect(read('PersonHeader.tsx')).toMatch(/<PersonTwoFactor user=\{user\} \/>/);
  });

  it('says what each account action does next to its button, and turns off Reset two-factor when there is none (J4-14)', () => {
    const dialog = read('UserDialog.tsx');
    for (const key of [
      'make_admin_desc',
      'make_member_desc',
      'disable_desc',
      'enable_desc',
      'reset_two_factor_desc',
      'reset_two_factor_none',
      'reissue_desc'
    ]) {
      expect(dialog, key).toContain(`'users.${key}'`);
    }
    expect(dialog.match(/aria-describedby="user-[a-z0-9]+-desc"/g)).toHaveLength(6);
    expect(dialog).toMatch(/disabled=\{action\.busy \|\| !user\.two_factor\}\s+onClick=\{\(\) => setConfirming\('reset2fa'\)\}/);
  });

  it('keeps every target of the console 44px high under a coarse pointer, at any width (J5-07, J5-11)', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(coarse).toMatch(/\.nm-admin button \{\s*min-height: 44px;/);
    expect(coarse).toMatch(/\.ui-tabs\.ad-tabs \.ui-tab \{\s*min-height: var\(--ui-h-md\);/);
    expect(coarse).toMatch(/\.ui-seg\.ad-filter\[data-size='md'\] \.ui-seg-item \{\s*height: var\(--ui-h-md\);/);
    expect(coarse).toMatch(/\.ad-sort \{\s*min-height: 44px;/);
    expect(css).toMatch(/@media \(max-width: 900px\), \(pointer: coarse\) \{\s*\.ad-ext \{\s*min-height: 44px;/);
  });

  it('never dims the initials of a disabled account with opacity (J1-05: they fell under 4.5:1)', () => {
    expect(css).not.toMatch(/\.ad-link-row\[data-state='disabled'\][^{]*\{[^}]*opacity/);
    expect(css).toMatch(/\.ad-link-row\[data-state='disabled'\] :is\([^{]*\.ui-avatar[^{]*\) \{\s*color: var\(--text3\);/);
  });

  it('filters the audit log by date, the last 7 days first (J6-23)', () => {
    const audit = read('AuditPanel.tsx');
    expect(audit).toMatch(/React\.useState<Range>\('7'\)/);
    expect(audit).toMatch(/id="audit-range"/);
    expect(audit).toMatch(/entry\.at >= since &&/);
  });

  it('marks each language of the default-language list with its own lang (J1-06)', () => {
    expect(read('LanguagePanel.tsx')).toMatch(
      /options=\{LOCALES\.map\(\(tag\) => \(\{ value: tag, label: LANGUAGE_NAMES\[tag\], lang: tag \}\)\)\}/
    );
  });

  it('has no browser <select>, checkbox, radio or text input, no window.confirm or alert, no native tooltip', () => {
    for (const name of names) {
      const source = code(name);
      expect(source, name).not.toMatch(/<select\b|<input\b|<textarea\b|window\.(confirm|alert|prompt)\b/);
      // A `title` on an element of the page (not the title prop of a dialog or an empty state) is the browser's tooltip.
      expect(source, name).not.toMatch(/<[a-z][a-z0-9]*\b[^>]*\stitle=/);
    }
  });

  it('has two bare <button>s (the name of a person, text that wraps; a column header that sorts) and no inline style (a dialog width is a ui Dialog prop)', () => {
    const buttons = names.flatMap((name) => [...code(name).matchAll(/<button\b[^>]*>/g)].map((match) => `${name}: ${match[0]}`));
    // Both are text that looks like the text around it (a name in a row, the words of a header), which no ui control draws.
    expect(buttons).toEqual([
      'UsersPanel.tsx: <button type="button" className="ad-sort" onClick={onSort}>',
      'UsersPanel.tsx: <button type="button" className="ad-person" onClick={onOpen}>'
    ]);
    const styles = names.flatMap((name) => [...code(name).matchAll(/\bstyle=\{/g)].map(() => name));
    expect(styles).toEqual([]);
    // The width of an admin dialog is ModalFrame's maxWidth, handed to the ui Dialog, which writes it as the panel's max-width.
    expect(read('adminUi.tsx')).toMatch(/width=\{maxWidth\}/);
  });

  it('keeps exactly its four sections, as ui Tabs with a panel each', () => {
    const frame = read('AdminConsole.tsx');
    expect(frame).toContain("const TABS: readonly Tab[] = ['users', 'domains', 'audit', 'settings'];");
    expect(frame).toMatch(/<Tabs\s+id="admin"/);
    // On a desktop the sections are a vertical list down the left side (Up and Down move); on a phone the four are one row of tabs that
    // scrolls sideways with its hidden side faded (ui/Tabs `phoneRow`, J3-05: the 2x2 grid took a quarter of the screen), and the row's
    // keys, aria-orientation and ink are a row's there.
    expect(frame).toMatch(/className="ad-tabs"\s+phoneRow\s+orientation="vertical"/);
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.ui-tabs\.ad-tabs \{\s*margin: 0;\s*padding: 0 calc\(var\(--ad-inset\) - 12px\);/);
    const tabs = readFileSync(path.join(ROOT, 'src', 'client', 'ui', 'Tabs.tsx'), 'utf8');
    expect(tabs).toMatch(/const row = useMediaMatch\(PHONE\) && phoneRow;\s*const shape = row \? 'horizontal' : orientation;/);
    expect(tabs).toMatch(/aria-orientation=\{shape === 'vertical' \? 'vertical' : undefined\}/);
    expect(tabs).toContain('useScrollEdges(listRef, row);');
    expect([...frame.matchAll(/<TabPanel tabsId="admin" value="(\w+)" selected=\{tab\}>/g)].map((match) => match[1])).toEqual([
      'users',
      'domains',
      'audit',
      'settings'
    ]);
    // No icon over the heading (the accent ShieldCheck tile is gone); the title is the h1 the dialog is named by.
    expect(frame).not.toMatch(/ShieldCheck/);
    expect(frame).toMatch(/<h1 id="admin-title" className="ad-title">/);
  });

  it('lists people and extra addresses in real tables with column headers, domains as cards and the audit log as a timeline by day', () => {
    const rows = {
      'UsersPanel.tsx': 'users',
      'AliasEditor.tsx': 'user.aliases'
    } as const;
    for (const [name, list] of Object.entries(rows)) {
      const source = read(name);
      expect(source, name).toMatch(/<Table label=\{tr\('[\w.]+'\)\} dense className="ad-table/);
      expect(source, name).toMatch(/<th scope="col"/);
      expect(source, name).toMatch(new RegExp(String.raw`<tbody>\s*\{${list.replaceAll('.', String.raw`\.`)}\.map\(`));
    }
    // Domains: a named list with one ui Card per domain, titled by the domain's name (its heading names the card's region).
    const domains = read('DomainsPanel.tsx');
    expect(domains).toMatch(/<ul aria-label=\{tr\('admin\.tab_domains'\)\} className="ad-domains">\s*\{domains\.data\.map\(/);
    expect(domains).toMatch(/<li className="ad-domain">\s*<Card\s+title=\{domain\.name\}/);
    // The audit log: a section per day under its heading, an ordered list of events in it, each with a machine-readable <time>.
    const audit = read('AuditPanel.tsx');
    expect(audit).toMatch(/<section key=\{day\.key\} aria-labelledby=\{`audit-day-\$\{day\.key\}`\} className="ad-day">/);
    expect(audit).toMatch(/<ol className="ad-events">\s*\{day\.entries\.map\(/);
    expect(audit).toMatch(/<time className="ad-event-time" dateTime=\{new Date\(entry\.at\)\.toISOString\(\)\}>/);
  });

  it('turns every table into a stacked list on a phone: no column headers on screen and nothing to scroll sideways', () => {
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.ad-table > thead \{[^}]*position: absolute;[^}]*clip-path: inset\(50%\);/);
    expect(phone).toMatch(/\.ad-table,\s*\.ad-table > tbody \{\s*display: block;/);
    expect(phone).toMatch(/\.ad-table > tbody > tr \{\s*display: flex;\s*flex-wrap: wrap;/);
    expect(phone).toMatch(/\.ui-table-wrap \.ui-table\.ad-table td \{\s*display: block;/);
  });

  it('names an audit action from audit.action.<code> through tDyn', () => {
    expect(read('AuditPanel.tsx')).toMatch(/tDyn\(`audit\.action\.\$\{action\}`\) \?\? tr\('audit\.action_unknown', \{ action \}\)/);
  });

  it('shows a temporary password once: its dialog is locked until Copy put it on the clipboard, and a locked frame ignores Escape, the scrim and its close button', () => {
    // J4-15: the X, Escape and the scrim stay off until the copy worked; "I have saved it" is the way out at any time.
    const temp = read('TempPasswordDialog.tsx');
    expect(temp).toMatch(/<ModalFrame[^>]*\bonClose=\{onDone\}\s+locked=\{!copied\}\s+maxWidth=\{460\}\s*>/);
    // J4-35: the X is not drawn until the copy worked (a disabled X looked live and said nothing); "I have saved it" is always there.
    expect(temp).toMatch(/<ModalFrame[^>]*\bcloseButton=\{copied\}/);
    expect(read('adminUi.tsx')).toMatch(/closeDisabled=\{locked\}\s+closeButton=\{closeButton\}/);
    expect(temp).toMatch(/const \[copied, setCopied\] = React\.useState\(false\);/);
    expect(temp).toMatch(/if \(result === 'copied'\) \{\s*setCopied\(true\);\s*\}/);
    expect(temp.match(/setCopied\(/g)).toHaveLength(1);
    // The frame is the ui Dialog; `locked` is its closeDisabled: the X is drawn disabled, and Escape and the scrim do nothing.
    const frame = read('adminUi.tsx');
    expect(frame).toMatch(/<Dialog\s+inline\s+open\s+onClose=\{onClose\}\s+closeDisabled=\{locked\}/);
    const dialog = readFileSync(path.join(ROOT, 'src', 'client', 'ui', 'Dialog.tsx'), 'utf8');
    expect(dialog).toMatch(
      /const canClose = dismissible && !closeDisabled;\s*const escape = \(\) => \{\s*if \(canClose\) \{\s*onClose\(\);/
    );
    expect(dialog).toMatch(/if \(canClose && pressedOnScrim\.current && event\.target === event\.currentTarget\) \{/);
    expect(dialog).toMatch(/<IconButton label=\{tr\('common\.close'\)\} size="sm" onClick=\{onClose\} disabled=\{closeDisabled\}>/);
  });

  it('keeps the Email Sending onboarding steps of the domain guide, with their names as slots', () => {
    const guide = read('DomainGuide.tsx');
    for (const key of ['guide_in1', 'guide_in3', 'guide_out1', 'guide_out2', 'guide_out3', 'guide_subdomain']) {
      expect(guide, key).toMatch(new RegExp(String.raw`tRich\(\s*'domains\.${key}'`));
    }
    expect(guide).toContain("tr('domains.guide_path_sending')");
  });

  it('chooses the default language with the ui Select, and saves only a language that differs from the one set', () => {
    const panel = read('LanguagePanel.tsx');
    expect(panel).toContain('<Select');
    expect(panel).toMatch(/if \(isLocale\(next\) && next !== current\) \{\s*save\.mutate\(next\);/);
  });

  it('sorts People by name or last sign-in from headers that say aria-sort, and closes the table with its count', () => {
    const people = read('UsersPanel.tsx');
    expect(people).toMatch(/<th scope="col" className=\{className\} aria-sort=\{ariaSort\}>/);
    expect(people).toMatch(/ariaSort = sort\.dir === 'asc' \? 'ascending' : 'descending';/);
    expect(people).toMatch(/column="name"/);
    expect(people).toMatch(/column="last"/);
    expect(people).toMatch(/<tfoot>\s*<tr>\s*<td colSpan=\{5\} className="ad-table-foot">\s*\{countText\}/);
    // The count is said through the shared live region, never by a node mounted with the table.
    expect(people).toMatch(/announce\(countText\)/);
    expect(people).not.toMatch(/role="status"/);
  });

  it('links to the Cloudflare dashboard in a new tab that says so, never through the opener', () => {
    const ui = read('adminUi.tsx');
    expect(ui).toMatch(/<a href=\{DASHBOARD_URL\} target="_blank" rel="noopener noreferrer" className="ad-ext">/);
    expect(ui).toContain("const DASHBOARD_URL = 'https://dash.cloudflare.com/';");
    expect(ui).toMatch(/<VisuallyHidden>\{tr\('domains\.new_tab'\)\}<\/VisuallyHidden>/);
  });
});
