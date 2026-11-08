import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsModal } from '../../src/client/components/SettingsModal';
import { popAction } from '../../src/client/lib/backStack';
import { holdSecret, isSecretHeld } from '../../src/client/lib/secretHold';
import { getTokens } from '../../src/client/theme';

// C-7: the recovery codes of two-factor sign-in are shown once. While the person has not said they saved them, nothing may take the screen away:
// not Escape, not the backdrop, not the Close buttons of Settings, and (on a phone) not the system Back button.

const released: (() => void)[] = [];
const hold = (): void => {
  released.push(holdSecret());
};

afterEach(() => {
  for (const release of released.splice(0)) {
    release();
  }
});

describe('the hold on a secret that is shown once', () => {
  it('is held while any screen holds it, and let go when the last one does, once each', () => {
    expect(isSecretHeld()).toBe(false);
    const first = holdSecret();
    const second = holdSecret();
    expect(isSecretHeld()).toBe(true);
    first();
    first();
    expect(isSecretHeld(), 'a second release of the same hold must not free the other one').toBe(true);
    second();
    expect(isSecretHeld()).toBe(false);
  });
});

describe('the system Back button (useBackStack)', () => {
  it('closes the topmost layer: the history entry went back by one and one layer is open', () => {
    expect(popAction(0, 1, false)).toEqual({ kind: 'close', count: 1, depth: 0 });
    expect(popAction(1, 3, false)).toEqual({ kind: 'close', count: 2, depth: 1 });
  });

  it('does nothing when the entry is the one of the open layers', () => {
    expect(popAction(2, 2, false)).toEqual({ kind: 'none', depth: 2 });
    expect(popAction(0, 0, false)).toEqual({ kind: 'none', depth: 0 });
  });

  it('steps back when Forward lands on an entry whose layer is gone', () => {
    expect(popAction(3, 1, false)).toEqual({ kind: 'go', go: -2, depth: 1 });
  });

  it('is undone while a secret is held: it goes forward again to the entry of the open layers, and no layer closes', () => {
    expect(popAction(0, 1, true)).toEqual({ kind: 'go', go: 1, depth: 1 });
    expect(popAction(1, 3, true)).toEqual({ kind: 'go', go: 2, depth: 3 });
    // Held or not, an entry that is right changes nothing.
    expect(popAction(2, 2, true)).toEqual({ kind: 'none', depth: 2 });
  });
});

function nothing(): void {
  // A handler the test never calls.
}

function render(): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SettingsModal, { isOpen: true, t: getTokens(false), onClose: nothing, onToggleDark: nothing, onOpenAdmin: nothing })
    )
  );
}

/** The opening tags of every button of the page. */
const buttons = (html: string): string[] => html.match(/<button\b[^>]*>/g) ?? [];

describe('the Settings dialog while a secret is held', () => {
  it('has Close and Sign out available as usual', () => {
    const open = buttons(render()).filter((tag) => !tag.includes('disabled=""'));
    expect(open.length).toBeGreaterThan(2);
  });

  it('disables the Close buttons, Sign out and every other way out while it is held', () => {
    const before = buttons(render()).filter((tag) => tag.includes('disabled=""')).length;
    hold();
    const html = render();
    const shut = buttons(html).filter((tag) => tag.includes('disabled=""'));
    // The top X, the footer Close and Sign out; no way out of the dialog is left enabled.
    expect(shut.length - before).toBeGreaterThanOrEqual(3);
  });
});
