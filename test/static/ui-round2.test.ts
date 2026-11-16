import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// Round-2 jury fixes of the ui library, Settings, Security, auth and the admin console that only a browser shows: pinned here as source
// facts so a later change keeps their intent.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const ui = (name: string): string => read('src', 'client', 'ui', name);
const component = (...parts: string[]): string => read('src', 'client', 'components', ...parts);
const withoutComments = (code: string): string => code.replaceAll(/\/\*[\s\S]*?\*\//g, '');
const css = withoutComments(ui('ui.css'));

describe('ui library', () => {
  it('hides the browser cancel cross of a search field: the labelled Clear of the app is the only one (J3-20, J4-28, J5-17, J6-27)', () => {
    expect(css).toMatch(
      /input\[type='search'\]::-webkit-search-cancel-button,\s*input\[type='search'\]::-webkit-search-decoration \{[^}]*display: none;[^}]*appearance: none;/
    );
    // The admin People search had only the browser's cross: it gets the app's Clear, which puts focus back in the field.
    expect(component('admin', 'UsersPanel.tsx')).toMatch(/<IconButton\s+label=\{tr\('app\.clear_search'\)\}/);
  });

  it('fades only the scrim of a dialog, on a layer of its own: the panel and a phone sheet stay opaque while they move (J2-13)', () => {
    const root = /\.ui-dialog-root \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(root).not.toMatch(/opacity|transition|background/);
    expect(css).toMatch(/\.ui-dialog-root::before \{[^}]*background: var\(--scrim\);[^}]*animation: ui-fade var\(--dur-base\) linear;/);
    expect(css).toMatch(/\.ui-dialog-root\[data-leaving='true'\]::before \{\s*animation: none;/);
    const starts = [...css.matchAll(/@starting-style \{([\s\S]*?)\n\s*\}\n\s*\}/g)].map((match) => match[1]).join('\n');
    expect(starts).not.toContain('.ui-dialog-root');
    // A phone sheet starts opaque below the edge (opacity follows --motion: under reduced motion, no slide, so it fades).
    expect(css).toMatch(/\.ui-dialog \{\s*opacity: var\(--motion, 1\);\s*scale: 1;\s*translate: 0 calc\(100% \* var\(--motion, 1\)\);/);
    const motion = ui('motion.ts');
    expect(motion).toContain("pseudoElement: '::before'");
    expect(motion).toMatch(/\? \[\{ transform: 'none' \}, \{ transform: 'translateY\(100%\)' \}\]/);
  });

  it('keeps a phone sheet above the on-screen keyboard: the visual viewport pads the scrim and caps the sheet (J5-22)', () => {
    const dialog = ui('Dialog.tsx');
    expect(dialog).toMatch(/const viewport = window\.visualViewport;/);
    expect(dialog).toMatch(/window\.innerHeight - viewport\.offsetTop - viewport\.height/);
    expect(dialog).toContain("root.style.setProperty('--ui-vv-bottom'");
    expect(css).toMatch(/\.ui-dialog-root \{\s*align-items: flex-end;\s*padding: 0 0 var\(--ui-vv-bottom, 0px\);/);
    expect(css).toMatch(/max-height: min\(92dvh, calc\(var\(--ui-vv-height, 100dvh\) - 8px\)\);/);
  });

  it('swaps tooltips without a ghost in a warm hand-off, and fades only the first open and the last close (J2-17)', () => {
    const tooltip = ui('Tooltip.tsx');
    expect(tooltip).toMatch(/const hide = \(\) => \{\s*replacedRef\.current = true;\s*setOpen\(false\);/);
    expect(tooltip).toMatch(/if \(warm\.hide !== null \|\| performance\.now\(\) < warm\.until\) \{\s*openNow\(true\);/);
    expect(tooltip).toContain("useExitMotion(bubbleRef, 'tooltip', replacedRef);");
    expect(tooltip).toContain('bubble: { onPointerEnter: cancelClose, onPointerLeave: leaveSoon, instant, replacedRef }');
    expect(css).toMatch(/\.ui-tooltip\[data-instant='true'\] \{\s*transition: none;/);
    expect(ui('motion.ts')).toMatch(/if \(!node\.isConnected && !skipped\(\)\) \{\s*leaveGhost/);
  });

  it('places the segment thumb and the tab ink from the chosen item again when an item or the web font changes its box (J3-22)', () => {
    const indicator = ui('indicator.ts');
    expect(indicator).toMatch(/boxKey\(measureRef\.current\(target, container\)\) === placedAt/);
    expect(indicator).toContain("container.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')");
    expect(indicator).toMatch(/fonts\?\.addEventListener\('loadingdone', replace\);/);
    // No first report to skip any more: a report that changes nothing does nothing.
    expect(indicator).not.toMatch(/let first = true/);
  });

  it('makes a scroll area a Tab stop only while it scrolls (J1-18)', () => {
    expect(ui('Table.tsx')).toMatch(/tabIndex=\{scrolls \? 0 : undefined\}/);
    expect(ui('Tabs.tsx')).toMatch(/const scrolls = useOverflows\(panelRef\);[\s\S]*tabIndex=\{scrolls \? 0 : undefined\}/);
    // True until measured (the default), so the server markup keeps the stop; a dialog's body asks for false (plain on the server).
    expect(ui('media.ts')).toMatch(/export function useOverflows\(ref: React\.RefObject<HTMLElement \| null>, assume = true\): boolean \{/);
    expect(ui('media.ts')).toMatch(/const \[overflows, setOverflows\] = React\.useState\(assume\);/);
  });

  it('exports no compose-only motion: the M10/M11 helpers live with compose (J2-10)', () => {
    expect(ui('index.ts')).not.toMatch(/containerTransform|\bflight\b,/);
    expect(ui('motion.ts')).not.toMatch(/export async function (containerTransform|flight)\b/);
    expect(css).not.toContain('.ui-flight');
    expect(withoutComments(component('admin', 'admin.css'))).not.toContain('--motion-base');
  });
});

describe('admin console', () => {
  it('lists the sections as one scrolling row of tabs on a phone, with the edge fade of the filter chips (J3-05)', () => {
    expect(css).toMatch(
      /\.ui-tabs\[data-more='end'\] \{\s*mask-image: linear-gradient\(to right, var\(--text\) calc\(100% - 48px\), transparent\);/
    );
    expect(ui('Tabs.tsx')).toMatch(/refs\.current\[value\]\?\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
  });

  it('never starts a wrapped line of a person card with the dot before the extra addresses (J3-32)', () => {
    const admin = withoutComments(component('admin', 'admin.css'));
    expect(admin).toMatch(/\.ad-people \.ad-sub \{\s*display: flex;\s*flex-wrap: wrap;\s*column-gap: 16px;\s*overflow: hidden;/);
    expect(admin).toMatch(/\.ad-people \.ad-sub > span \{\s*min-width: 0;\s*margin-inline-start: -16px;/);
  });

  it('offers no Remove on a domain that addresses use, says why on its card, and checks it once when the page opens (J4-31, J4-27)', () => {
    const domains = component('admin', 'DomainsPanel.tsx');
    expect(domains).toMatch(/const inUse = domain\.addresses_count > 0;/);
    // J3-38: the count is always in the meta line, and "In use" stands in Remove's place (same width) on a domain that addresses use.
    expect(domains).toMatch(/<span className="ad-domain-meta">\s*<span>\{addresses\}<\/span>/);
    expect(domains).toMatch(/\{inUse \? \(\s*<span className="ad-in-use">\{tr\('domains\.in_use'\)\}<\/span>/);
    expect(domains).toMatch(/if \(inUse && !autoChecked\.current\) \{\s*autoChecked\.current = true;\s*mutate\(domain\.id\);/);
    expect(domains).toContain("tr('domains.remove_failed', { name: domain.name, reason: removeError })");
    expect(domains).toMatch(/removeError=\{removeFailed === domain\.id \? removeAction\.error : null\}/);
  });

  it('leads the Make admin confirmation with its question and what follows, the admin claim on request (J4-36)', () => {
    const dialog = component('admin', 'UserDialog.tsx');
    expect(dialog).toMatch(/title: tr\('users\.confirm_promote_title', \{ name: personName\(user\) \}\),/);
    expect(dialog).toMatch(
      /paragraphs: \[tr\('users\.make_admin_desc'\), tr\('users\.confirm_promote_note'\)\],\s*details: adminClaim\(\)\.join\(' '\),/
    );
    expect(dialog).toMatch(/<MoreText label=\{tr\('users\.admin_claim_more'\)\} text=\{pending\.details\} \/>/);
  });

  it('starts the notes of a temporary password on the inner edge of the password box (J3-29)', () => {
    const admin = withoutComments(component('admin', 'admin.css'));
    expect(admin).toMatch(/\.ad-list \{[^}]*padding: 12px 16px;[^}]*list-style: none;/);
  });
});

describe('two-factor sign-in and recovery codes', () => {
  it('shows the ten codes as a numbered 2x5 grid, each code on one line, one column where two do not fit (J3-27, J5-18)', () => {
    expect(component('auth', 'RecoveryCodesPanel.tsx')).toContain('className="au-key au-codes"');
    const auth = withoutComments(component('auth', 'auth.css'));
    expect(auth).toMatch(/\.au-codes \.ui-secret-grid \{\s*grid-template-columns: repeat\(2, max-content\);/);
    expect(auth).toMatch(/\.au-codes \.ui-secret-part::before \{\s*content: counter\(au-code\);/);
    expect(auth).toMatch(/\.au-codes \.ui-secret-value \{[^}]*white-space: nowrap;/);
    expect(auth).toMatch(
      /@container au-codes \(max-width: \d+px\) \{\s*\.au-codes \.ui-secret-grid \{\s*grid-template-columns: max-content;/
    );
  });

  it('explains the six-digit code once on the scan step, and offers the otpauth link and the key first on a phone (J4-39, J5-21)', () => {
    const enrolment = component('auth', 'TwoFactorEnrolment.tsx');
    expect(enrolment).not.toContain("tr('twofa.intro')");
    expect(component('security', 'TwoFactorView.tsx')).toContain('<p className="st-lead">{tr(\'twofa.intro\')}</p>');
    expect(enrolment).toMatch(/const ON_THE_PHONE = '\(max-width: 640px\), \(pointer: coarse\)';/);
    const phone = enrolment.slice(enrolment.indexOf('{onThePhone ? ('), enrolment.indexOf(') : (', enrolment.indexOf('{onThePhone ? (')));
    expect(phone.indexOf('href={enrolment.otpauth_uri}')).toBeGreaterThan(0);
    expect(phone.indexOf('href={enrolment.otpauth_uri}')).toBeLessThan(phone.indexOf('<ManualKey'));
    expect(phone.indexOf('<ManualKey')).toBeLessThan(phone.indexOf('<QrCode'));
  });
});

describe('auth and status cards', () => {
  it('draws every tertiary action as the one accent text link (J3-31)', () => {
    const auth = withoutComments(component('auth', 'auth.css'));
    expect(auth).toMatch(
      /\.au-alt \.ui-btn\.au-text-btn\[data-variant='ghost'\],\s*\.au-crash-more \.ui-btn\.au-text-btn\[data-variant='ghost'\] \{\s*color: var\(--accent-text\);/
    );
    expect(auth).not.toMatch(/\.au-alt \.ui-btn\.au-text-btn\[data-variant='ghost'\] \{\s*color: var\(--text2\);/);
  });
});
