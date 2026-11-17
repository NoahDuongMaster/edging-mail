import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from '../../src/client/components/LiveRegion';
import { Toast, TOAST_EXIT_MS, TOAST_MS, TOAST_UNDO_MS, type ToastState } from '../../src/client/components/Toast';
import { announce, ANNOUNCE_GAP_MS, announcement, resetAnnouncements } from '../../src/client/lib/announce';
import { currentViewTitle, documentTitle, setViewTitle } from '../../src/client/lib/documentTitle';
import { createPausableTimer, type TimerClock } from '../../src/client/lib/pausableTimer';
import { getTokens } from '../../src/client/theme';

// The status plumbing of the mailbox: the toast's timer that pauses on hover/focus (WCAG 2.2.1) and its markup, the two live regions that
// are on the page from the first render (4.1.3), and the tab titles per view (2.4.2). Rendered on the server side of React (no DOM): the
// pointer, focus and Ctrl+Z paths and the animations are for the browser check.

const noop = (): void => {
  // a callback the test does not look at
};

/** A clock the test moves by hand. */
function manualClock(): TimerClock & { advance: (ms: number) => void } {
  let now = 0;
  let pending: { at: number; callback: () => void; handle: number }[] = [];
  let handles = 0;
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      handles += 1;
      pending.push({ at: now + ms, callback, handle: handles });
      return handles;
    },
    clearTimeout: (handle) => {
      pending = pending.filter((entry) => entry.handle !== handle);
    },
    advance: (ms) => {
      now += ms;
      const due = pending.filter((entry) => entry.at <= now);
      pending = pending.filter((entry) => entry.at > now);
      for (const entry of due) {
        entry.callback();
      }
    }
  };
}

describe('the toast timer (createPausableTimer)', () => {
  it('runs out after its time when nothing pauses it', () => {
    const clock = manualClock();
    const done = vi.fn();
    createPausableTimer(TOAST_MS, done, clock);
    clock.advance(TOAST_MS - 1);
    expect(done).not.toHaveBeenCalled();
    clock.advance(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('stops while paused (pointer over it, focus in it) and goes on from where it stopped when resumed', () => {
    const clock = manualClock();
    const done = vi.fn();
    const timer = createPausableTimer(TOAST_MS, done, clock);
    clock.advance(2000);
    timer.pause();
    expect(timer.paused()).toBe(true);
    expect(timer.remaining()).toBe(4000);
    clock.advance(60_000);
    expect(done).not.toHaveBeenCalled();
    expect(timer.remaining()).toBe(4000);
    timer.resume();
    clock.advance(3999);
    expect(done).not.toHaveBeenCalled();
    timer.pause();
    timer.pause();
    clock.advance(10_000);
    timer.resume();
    timer.resume();
    clock.advance(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('never fires once cancelled (dismissed, replaced, Undo)', () => {
    const clock = manualClock();
    const done = vi.fn();
    const timer = createPausableTimer(TOAST_MS, done, clock);
    timer.cancel();
    timer.resume();
    clock.advance(TOAST_MS * 2);
    expect(done).not.toHaveBeenCalled();
  });

  it('lasts 6 s, 8 s with an Undo (the Undo window, research/02 M3), and leaves in 140 ms (0.7 of its 200 ms entrance)', () => {
    expect(TOAST_MS).toBe(6000);
    expect(TOAST_UNDO_MS).toBe(8000);
    expect(TOAST_EXIT_MS).toBe(140);
  });
});

describe('the Toast markup', () => {
  const t = getTokens(false);
  const render = (toast: ToastState | null, desktop = true): string =>
    renderToStaticMarkup(h(Toast, { t, toast, onDismiss: noop, desktop }));

  it('renders nothing without a toast', () => {
    expect(render(null)).toBe('');
  });

  it('is not a live region itself: its text is announced through the persistent region (no element made with the message)', () => {
    const html = render({ text: 'Archived', undo: noop });
    expect(html).not.toMatch(/aria-live|role="(status|alert)"|<output/);
    expect(html).toContain('<span class="ui-toast-text">Archived</span>');
  });

  it('has an Undo with its keyboard shortcut, a Dismiss X and a countdown bar hidden from screen readers', () => {
    const html = render({ text: 'Archived', undo: noop });
    // v3: 16px inside the list sheet's bottom-left corner (the rail's width + 16px).
    expect(html).toMatch(/<div class="ui-toast tst-root"[^>]*style="[^"]*left:calc\(var\(--mb-rail-w, 264px\) \+ 16px\)/);
    expect(html).toMatch(
      /<button type="button" class="ui-toast-action tst-undo nm-tap-h" aria-keyshortcuts="Control\+Z Meta\+Z"[^>]*>Undo<\/button>/
    );
    expect(html).toMatch(/<button type="button" class="tst-dismiss nm-tap" aria-label="Dismiss"><svg[^>]*aria-hidden="true"/);
    expect(html).toContain('<span aria-hidden="true" class="tst-bar"></span>');
    // Undo, then Dismiss: the order Tab follows.
    expect(html.indexOf('ui-toast-action')).toBeLessThan(html.indexOf('tst-dismiss'));
  });

  it('stacks the Undo and the X under the words (data-stacked, a phone row in toast.css) only for a long text with an Undo', () => {
    const long = 'Moved to Inbox. Mail from someone@example.com will not go to Spam.';
    expect(render({ text: long, undo: noop })).toContain('data-stacked="true"');
    expect(render({ text: 'Archived', undo: noop })).not.toContain('data-stacked');
    // nothing to put on a row of its own: the words beside the X stay one row
    expect(render({ text: long })).not.toContain('data-stacked');
    expect(render({ text: long, error: true })).not.toContain('data-stacked');
  });

  it('keeps a failure until it is dismissed: no countdown bar, no Undo, marked as an error', () => {
    const html = render({ text: 'Could not refresh', error: true });
    expect(html).toContain('data-error="true"');
    expect(html).not.toContain('tst-bar');
    expect(html).not.toContain('ui-toast-action');
    expect(html).toContain('aria-label="Dismiss"');
  });

  it('centres on a phone; it is a card of the theme (toast.css), with no colour set inline, and an icon that says success or failure', () => {
    const html = render({ text: 'Archived' }, false);
    expect(html).toMatch(/style="[^"]*left:0;right:0;margin-inline:auto/);
    expect(html).not.toMatch(/style="[^"]*(background|color):/);
    expect(html).toMatch(/<svg(?=[^>]*aria-hidden="true")(?=[^>]*class="[^"]*tst-icon)/);
  });

  it('marks "Sending..." (a held send) with the neutral Send glyph, not the check, and keeps its Undo (J6-35)', () => {
    const hold = { pause: noop, resume: noop, done: new Promise<unknown>(noop) };
    const sending = render({ text: 'Sending…', undo: noop, hold, duration: 10_000 });
    expect(sending).toContain('data-held="true"');
    expect(sending).toMatch(/<svg(?=[^>]*lucide-send)(?=[^>]*tst-icon)/);
    expect(sending).not.toMatch(/lucide-circle-check/);
    expect(sending).toMatch(/class="ui-toast-action tst-undo nm-tap-h"[^>]*>Undo<\/button>/);
    const sent = render({ text: 'Message sent.' });
    expect(sent).not.toContain('data-held');
    expect(sent).toMatch(/<svg(?=[^>]*lucide-circle-check)(?=[^>]*tst-icon)/);
  });

  it('holds one width for the common words, never wider than the screen (J2-16: a replaced toast keeps its Undo and X in place)', () => {
    expect(render({ text: 'Archived', undo: noop })).toMatch(
      /style="[^"]*min-width:min\(20rem, calc\(100vw - var\(--mb-rail-w, 264px\) - 48px\)\)/
    );
    expect(render({ text: 'Archived', undo: noop }, false)).toMatch(/style="[^"]*min-width:min\(20rem, calc\(100vw - 32px\)\)/);
  });
});

describe('the live regions (LiveRegion + announce)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetAnnouncements();
  });
  afterEach(() => {
    resetAnnouncements();
    vi.useRealTimers();
  });

  it('are on the page from the first render, empty: a polite status and a separate alert', () => {
    const html = renderToStaticMarkup(h(LiveRegion));
    expect(html).toBe(
      '<div role="status" aria-live="polite" aria-atomic="true" class="ui-visually-hidden" data-live-region="polite"></div>' +
        '<div role="alert" aria-live="assertive" aria-atomic="true" class="ui-visually-hidden" data-live-region="assertive"></div>'
    );
  });

  it('take the text a moment after it is announced, polite by default, assertive into the alert', () => {
    announce('Archived');
    expect(announcement('polite').text).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(announcement('polite').text).toBe('Archived');
    announce('Could not refresh', { assertive: true });
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(announcement('assertive').text).toBe('Could not refresh');
    expect(announcement('polite').text).toBe('Archived');
  });

  it('say the same text twice as two announcements (the region is emptied in between) and ignore empty text', () => {
    announce('Archived');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    const first = announcement('polite');
    announce('Archived');
    expect(announcement('polite').text).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    expect(announcement('polite').text).toBe('Archived');
    expect(announcement('polite').id).not.toBe(first.id);
    announce(' '.repeat(3));
    expect(announcement('polite').text).toBe('Archived');
  });

  it('empty themselves again later, so a reader walking the page does not find an old status', () => {
    announce('Archived');
    vi.advanceTimersByTime(ANNOUNCE_GAP_MS);
    vi.advanceTimersByTime(60_000);
    expect(announcement('polite').text).toBe('');
  });
});

describe('the tab title per view (documentTitle)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { title: 'Edging Mail — Serverless Edge Webmail' });
  });
  afterEach(() => {
    setViewTitle('mailbox', null);
    setViewTitle('settings', null);
    vi.unstubAllGlobals();
  });

  it('names the view, then the app', () => {
    expect(documentTitle(['Inbox (2)'])).toBe('Inbox (2) - Edging Mail');
    expect(documentTitle(['Security', 'Settings'])).toBe('Security - Settings - Edging Mail');
    expect(documentTitle([null, '', undefined, false, ' Inbox '])).toBe('Inbox - Edging Mail');
    expect(documentTitle([])).toBe('Edging Mail');
  });

  it('shows the view opened last, keeps its place when only its text changes, and gives the tab back when it closes', () => {
    setViewTitle('mailbox', 'Inbox (2) - Edging Mail');
    expect(document.title).toBe('Inbox (2) - Edging Mail');
    setViewTitle('settings', 'Settings - Edging Mail');
    expect(document.title).toBe('Settings - Edging Mail');
    // New mail while Settings is open: the mailbox's count changes, Settings stays the title.
    setViewTitle('mailbox', 'Inbox (3) - Edging Mail');
    expect(document.title).toBe('Settings - Edging Mail');
    setViewTitle('settings', null);
    expect(document.title).toBe('Inbox (3) - Edging Mail');
    setViewTitle('mailbox', null);
    expect(currentViewTitle()).toBeNull();
    expect(document.title).toBe('Edging Mail — Serverless Edge Webmail');
  });
});
