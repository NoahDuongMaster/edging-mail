// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTH_FAILURE_CLOSE, SESSION_RENEWED_CLOSE } from '../../src/client/lib/sessionRenewal';
import { ROOT, clientFiles } from './helpers/scan';

// Two promises of the browser code that nothing else would notice breaking. Reads the sources, so it runs in Node.

describe('the client and the Worker agree', () => {
  it('on the close codes of the live socket: 4401 session ended, 4402 session renewed', () => {
    const worker = readFileSync(path.join(ROOT, 'src', 'worker', 'realtime.ts'), 'utf8');
    expect(Number(/CLOSE_SESSION_ENDED = (\d+)/.exec(worker)?.[1])).toBe(AUTH_FAILURE_CLOSE);
    expect(Number(/CLOSE_SESSION_RENEWED = (\d+)/.exec(worker)?.[1])).toBe(SESSION_RENEWED_CLOSE);
  });
});

describe('the client twin of PA-5 (CK-19)', () => {
  it('nothing under src/client imports shared/crypto/server: the client barrel (shared/crypto/client) re-exports what it may use', () => {
    const importers = clientFiles()
      .filter((file) => /from\s+['"][^'"]*shared\/crypto\/server['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(importers).toEqual([]);
  });
});

/** A file under `src/client`, from its path parts. */
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
/** A file under `src/client` from a slash path. */
const source = (name: string): string => read(...name.split('/'));

describe('screens that show a secret once (C-7)', () => {
  it('hold the Settings dialog open: the codes panel asks for the hold, and Settings closes only through the guarded `leave`', () => {
    expect(source('components/auth/RecoveryCodesPanel.tsx')).toMatch(/useSecretHold\(/);
    const settings = source('components/SettingsModal.tsx');
    expect(settings).toMatch(/useSecretHeld\(\)/);
    // Every way out goes through `leave`, which checks the hold: no button or key handler calls the prop itself.
    expect(settings).not.toMatch(/onClick=\{onClose\}/);
    expect([...settings.matchAll(/\bonClose\(\)/g)]).toHaveLength(1);
    // ... and that one call is the guard itself: nothing closes the dialog while a secret is held (Escape, the backdrop and both Close buttons use it).
    expect(settings).toMatch(/if \(!secretHeld\) \{\s*onClose\(\);/);
  });
});

describe('names a sender chose (PX-7)', () => {
  it('the reader shows an attachment name and offers it to the browser only through safeFileName: no raw att.filename', () => {
    const reader = readFileSync(path.join(ROOT, 'src', 'client', 'components', 'MessageView.tsx'), 'utf8');
    expect(reader).toMatch(/safeFileName\(att\.filename, tr\('list\.attachment'\)\)/);
    expect(reader).toMatch(/download=\{safeFileName\(att\.filename, ''\)\}/);
    // The only remaining use of the raw name is as the argument of safeFileName.
    const raw = [...reader.matchAll(/att\.filename/g)].length;
    const guarded = [...reader.matchAll(/safeFileName\(att\.filename/g)].length;
    expect(raw).toBe(guarded);
  });
});

describe('the screens before the mailbox (truong C-9, C-11, C-12)', () => {
  it('C-9: a new screen puts the keyboard on its title when nothing has focus', () => {
    const card = read('components', 'auth', 'authUi.tsx');
    expect(card).toMatch(/<h1\s+ref=\{heading\}\s+tabIndex=\{-1\}/);
    expect(card).toMatch(/activeElement/);
    expect(card).toMatch(/heading\.current\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it('C-9: after a sign-in, a gate or an unlock the mailbox opens with the keyboard on its title, and only then', () => {
    const gate = read('components', 'auth', 'AuthGate.tsx');
    expect(gate).toMatch(/focusFirstTitle\(\)/);
    // Only after the person met a screen: a sign-in, a gate or the unlock screen, never on a page that opens straight into the mailbox.
    expect(gate).toMatch(/screenShown = !session\.authenticated \|\| gate !== null \|\| restore === 'locked'/);
    expect(gate).toMatch(/metAScreen\.current/);
    expect(read('lib', 'screenFocus.ts')).toMatch(/getClientRects\(\)\.length > 0/);
  });

  it('C-11: under reduced motion the slide-in and the spinner do not move at all (no turning, no pulsing)', () => {
    const css = read('index.css');
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/\.nm-fade-in,\s*\.nm-spin \{\s*animation: none;/);
    expect(block).not.toMatch(/rotate|nm-pulse|infinite|opacity/);
    expect(css).not.toMatch(/@keyframes nm-pulse/);
  });

  it('C-9b: the panel of one-time codes takes the focus on its heading when it replaces a form, and so do the views of Security that change their title', () => {
    const panel = read('components', 'auth', 'RecoveryCodesPanel.tsx');
    expect(panel).toMatch(/<h2\s+ref=\{heading\}\s+tabIndex=\{-1\}/);
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*heading\.current\?\.focus\(\);\s*\}, \[\]\)/);
    const frame = read('components', 'security', 'securityUi.tsx');
    expect(frame).toMatch(/<h4\s+ref=\{heading\}\s+tabIndex=\{-1\}/);
    expect(frame).toMatch(/first\.current !== title/);
  });

  it('C-12: the text buttons of these screens are 44 px high, the checkbox row is one label of 44 px, the badge has no inline minHeight', () => {
    const ui = read('components', 'auth', 'authUi.tsx');
    expect(ui).not.toMatch(/minHeight: 36/);
    // A short label (vi "Hủy", zh "返回") is never under 44 px wide, and the locked-mail buttons have no inline minHeight (the scan of tap-targets.test.ts).
    expect(ui).toMatch(/minHeight: 44,\s*minWidth: 44,/);
    expect(read('components', 'LockedMailBanner.tsx')).not.toMatch(/minHeight:/);
    expect(ui).toMatch(/<label\s+className="nm-tap-h"/);
    // The admin console and its dialogs: every button 44 px high on a phone (min-height beats the inline height of 40).
    expect(read('index.css')).toMatch(/@media \(max-width: 900px\) \{\s*\.nm-admin button \{\s*min-height: 44px;/);
    expect(read('components', 'admin', 'AdminConsole.tsx')).toMatch(/className="nm-admin"/);
    expect(read('components', 'admin', 'adminUi.tsx')).toMatch(/className="nm-fade-in nm-admin"/);
    expect(read('components', 'E2eBadge.tsx')).not.toMatch(/minHeight:/);
  });
});

describe('the shared-device field of the session answer (C-5b)', () => {
  it('the Worker sends `shared` on the signed-in answer and the app reads that very name', () => {
    const worker = readFileSync(path.join(ROOT, 'src', 'worker', 'auth', 'login.ts'), 'utf8');
    expect(worker).toMatch(/shared: await sessionIsShared\(c\)/);
    expect(read('lib', 'auth.ts')).toMatch(/shared: data\.shared === true/);
    expect(read('lib', 'auth.ts')).toMatch(/shared\?: boolean/);
    // Both screens that ask the question start from the server's answer, and neither reads the tab flag alone.
    for (const screen of [
      ['components', 'auth', 'UnlockScreen.tsx'],
      ['components', 'auth', 'GateScreens.tsx']
    ]) {
      expect(read(...screen), screen.join('/')).toMatch(/sharedDeviceStart\(useSession\(\)\.data\?\.shared\)/);
      expect(read(...screen), screen.join('/')).not.toMatch(/useState\(sharedDeviceChosen\)/);
    }
  });
});
