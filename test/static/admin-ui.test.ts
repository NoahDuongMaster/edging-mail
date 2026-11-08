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
  });

  it('has no browser <select>, checkbox, radio or text input, no window.confirm or alert, no native tooltip', () => {
    for (const name of names) {
      const source = code(name);
      expect(source, name).not.toMatch(/<select\b|<input\b|<textarea\b|window\.(confirm|alert|prompt)\b/);
      // A `title` on an element of the page (not the title prop of a dialog or an empty state) is the browser's tooltip.
      expect(source, name).not.toMatch(/<[a-z][a-z0-9]*\b[^>]*\stitle=/);
    }
  });

  it('has one bare <button> (the name of a person in the People table, text that wraps) and no inline style (a dialog width is a ui Dialog prop)', () => {
    const buttons = names.flatMap((name) => [...code(name).matchAll(/<button\b[^>]*>/g)].map((match) => `${name}: ${match[0]}`));
    expect(buttons).toEqual(['UsersPanel.tsx: <button type="button" className="ad-person" onClick={onOpen}>']);
    const styles = names.flatMap((name) => [...code(name).matchAll(/\bstyle=\{/g)].map(() => name));
    expect(styles).toEqual([]);
    // The width of an admin dialog is ModalFrame's maxWidth, handed to the ui Dialog, which writes it as the panel's max-width.
    expect(read('adminUi.tsx')).toMatch(/width=\{maxWidth\}/);
  });

  it('keeps exactly its four sections, as ui Tabs with a panel each', () => {
    const frame = read('AdminConsole.tsx');
    expect(frame).toContain("const TABS: readonly Tab[] = ['users', 'domains', 'audit', 'settings'];");
    expect(frame).toMatch(/<Tabs\s+id="admin"/);
    // On a phone the four tabs are a 2x2 grid (ui/Tabs `grid`, as in Settings): no tab is cut off or hidden behind a sideways scroll.
    expect(frame).toMatch(/className="ad-tabs"\s+grid\s/);
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.ui-tabs\.ad-tabs \{\s*margin: 8px var\(--ad-inset\) 0;\s*padding: 4px;/);
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

  it('lists people, domains, extra addresses and the audit log in real tables with column headers', () => {
    const rows = {
      'UsersPanel.tsx': 'users',
      'DomainsPanel.tsx': 'domains.data',
      'AliasEditor.tsx': 'user.aliases',
      'AuditPanel.tsx': 'entries'
    } as const;
    for (const [name, list] of Object.entries(rows)) {
      const source = read(name);
      expect(source, name).toMatch(/<Table label=\{tr\('[\w.]+'\)\} dense className="ad-table/);
      expect(source, name).toMatch(/<th scope="col"/);
      expect(source, name).toMatch(new RegExp(String.raw`<tbody>\s*\{${list.replaceAll('.', String.raw`\.`)}\.map\(`));
    }
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

  it('shows a temporary password once: its dialog is locked, and a locked frame ignores Escape, the scrim and its close button', () => {
    expect(read('TempPasswordDialog.tsx')).toMatch(/<ModalFrame[^>]*\bonClose=\{onDone\} locked maxWidth=\{460\}>/);
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
});
