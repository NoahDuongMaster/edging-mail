// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The accessibility plumbing of the mailbox shell, read from the source (W1-G): one main landmark and a skip link first in the Tab order
// (WCAG 1.3.1, 2.4.1), the tab title per view (2.4.2), single-key shortcuts that can be turned off (2.1.4), the motion choice applied before
// the first render, and status messages through the one persistent live region (4.1.3).

const source = (name: string): string => readFileSync(path.join(ROOT, 'src', 'client', ...name.split('/')), 'utf8');
const app = source('App.tsx');
/** The mailbox shell: from `function Mailbox(` to the end of the file. */
const mailbox = app.slice(app.indexOf('function Mailbox('));

describe('the mailbox shell (App.tsx Mailbox)', () => {
  it('has exactly one main landmark in each layout, around the list and the reader', () => {
    expect(app.indexOf('function Mailbox(')).toBeGreaterThan(0);
    const mains = [...mailbox.matchAll(/<main\b[^>]*>/g)].map((match) => match[0]);
    // The phone tree and the desktop tree are the two branches of one `isMobile ? ... : ...`: one main each, never both.
    expect(mains).toEqual(['<main className="mb-phone-panes">', '<main className="mb-panes">']);
    const desktop = mailbox.slice(
      mailbox.indexOf('<main className="mb-panes">'),
      mailbox.indexOf('</main>', mailbox.indexOf('<main className="mb-panes">'))
    );
    expect(desktop).toContain('data-pane="list"');
    expect(desktop).toContain('data-pane="reader"');
    expect(mailbox.match(/<\/main>/g)).toHaveLength(2);
  });

  it('starts with a skip link to the messages, the first thing Tab reaches', () => {
    expect(mailbox).toMatch(
      /<div className="mb-root" data-layout=\{isMobile \? 'phone' : 'desktop'\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<a\s+href=\{`#\$\{MESSAGES_ID\}`\}\s+className="nm-skip-link"/
    );
    expect(mailbox).toContain("{tr('app.skip_to_messages')}");
    // Its target is the list pane in both layouts (and the reader pane while a phone shows a message), focusable by script only.
    expect(mailbox.match(/data-pane="list"\s+id=\{MESSAGES_ID\}\s+tabIndex=\{-1\}/g)).toHaveLength(2);
    expect(mailbox).toContain('data-pane="reader" id={MESSAGES_ID} tabIndex={-1}');
  });

  it('names the browser tab after the open folder and its unread count', () => {
    expect(mailbox).toMatch(
      /useDocumentTitle\(\[folderUnread > 0 \? tr\('app\.title_unread', \{ folder: title, count: folderUnread \}\) : title\]\)/
    );
  });

  it('passes the device preference to the single-key shortcuts, and hides the / keycap while they are off', () => {
    expect(mailbox).toContain('const singleKeys = usePrefs().shortcuts;');
    expect(mailbox).toContain('shortcutOf(event, target, singleKeys)');
    expect(mailbox).toContain('mobile || !singleKeys ? undefined');
  });

  it('announces search results, new mail and a sent message through the live region', () => {
    // The count of a search is said with the same words its head shows (resultsText).
    expect(mailbox).toContain("const resultsText = tr('app.search_results'");
    expect(mailbox).toContain('announce(resultsText)');
    expect(mailbox).toContain("announce(tr('app.new_messages'");
    expect(mailbox).toContain("announce(tr('compose.sent'))");
  });

  it('gives every Undo toast its focus target and every failure toast the error flag (no auto-dismiss of errors)', () => {
    // Snooze and Unsnooze set theirs after the answer; a move (Archive, Move to Trash/Spam/Inbox) sets its toast with the row's exit and its
    // Undo waits for the request (J2-19): once the row has left the list (J2-20, rowsGone), and only while the request has not failed.
    const undoToasts = [
      ...mailbox.matchAll(
        /undo: (?:typeof [^?]+\? )?undoFor\(message\)[^}]*\}|undo: async \(\) => \{\s*if \(\(await request\) === true\) \{\s*await undo\(\);\s*\}\s*\},\s*returnFocus: undoFocus/g
      )
    ].map((match) => match[0]);
    expect(undoToasts).toHaveLength(3);
    expect(mailbox).toMatch(
      /const request = leaveMessage\(message, \(\) => batch\('move', \[message\.id\], \{ folder: target \}\)\);\s*const undo = undoFor\(message\);\s*let failed = false;\s*void rowsGone\(\[message\.id\]\)\.then\(\(\) => \{\s*if \(failed\) \{\s*return;\s*\}\s*setToast\(/
    );
    for (const toast of undoToasts) {
      expect(toast).toContain('returnFocus: undoFocus');
    }
    expect(mailbox).toContain('const undoFocus = isMobile ? messagesRegion : restoredRow;');
    // Not spam (Spam's way back) has its own Undo toast, shown once the answer names who was allowed: it too hands focus back to the row.
    expect(mailbox).toMatch(/setToast\(\{ text: notSpamText\(tr, 1, allowed\), undo, returnFocus: undoFocus \}\)/);
    // Every failure (a request that failed, the reader's and the compose's problems, Empty Trash, Select all's pages, an Undo of Not spam that
    // could not take the allowed senders away again) is an error toast; none is a plain timed one.
    expect(mailbox.match(/error: true/g)).toHaveLength(14);
    expect(mailbox).not.toMatch(/setToast\(\{ text \}\)/);
    expect(mailbox).toContain('fallbackFocus={messagesRegion}');
  });
});

describe('the toast (components/Toast.tsx)', () => {
  const toast = source('components/Toast.tsx');

  it('makes no live region of its own: it announces through lib/announce', () => {
    expect(toast).not.toMatch(/aria-live|<output|role="status"|role="alert"/);
    expect(toast).toContain('announce(spokenText(toast), { assertive: toast.error === true });');
  });

  it('pauses its timer and its bar on hover, focus and a hidden tab, and runs Undo on Ctrl/Cmd+Z', () => {
    expect(toast).toContain("const onEnter = () => setPaused('hover', true);");
    expect(toast).toContain("const onLeave = () => setPaused('hover', false);");
    expect(toast).toContain("const onFocusIn = () => setPaused('focus', true);");
    expect(toast).toMatch(/root\?\.addEventListener\('pointerenter', onEnter\);\s*root\?\.addEventListener\('pointerleave', onLeave\);/);
    expect(toast).toMatch(/root\?\.addEventListener\('focusin', onFocusIn\);\s*root\?\.addEventListener\('focusout', onFocusOut\);/);
    expect(toast).toContain("setPaused('hidden', document.visibilityState === 'hidden')");
    expect(toast).toMatch(/timerRef\.current\?\.pause\(\);\s*barMotion\.current\?\.pause\(\);/);
    expect(toast).toMatch(/if \(isUndoShortcut\(event, [^)]+\)\) \{\s*event\.preventDefault\(\);\s*runUndo\(true\);/);
  });
});

describe('the app entry (main.tsx)', () => {
  const main = source('main.tsx');

  it('applies the motion choice before the first render, next to the theme', () => {
    expect(main).toMatch(/applyTheme\(storedThemeIsDark\(\)\);\s*applyMotionPref\(\);/);
    expect(main.indexOf('applyMotionPref();')).toBeLessThan(main.indexOf('reactRoot.render('));
  });

  it('mounts the live regions once, outside the error boundary, and keeps the hot-reload root', () => {
    expect(main.match(/<LiveRegion \/>/g)).toHaveLength(1);
    expect(main.indexOf('<LiveRegion />')).toBeGreaterThan(main.indexOf('</ErrorBoundary>'));
    expect(main).toContain('const reactRoot = hot?.root ?? ReactDOM.createRoot(root);');
  });
});
