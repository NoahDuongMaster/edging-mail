import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecoveryCodesPanel } from '../../src/client/components/auth/RecoveryCodesPanel';
import { AuthButton, TextButton } from '../../src/client/components/auth/authUi';
import { getTokens } from '../../src/client/theme';

// Small pieces of the screens before the mailbox that truong's walker measures (C-9b, C-11, C-12), rendered on the server side of React.

const t = getTokens(false);

function nothing(): void {
  // A handler the test never calls.
}

describe('AuthButton', () => {
  it('says that it is busy to a screen reader, whatever the animation does (C-11: no animation under reduced motion)', () => {
    const busy = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Continue', busy: true }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('nm-spin');
    const idle = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Continue' }));
    expect(idle).toContain('aria-busy="false"');
    expect(idle).not.toContain('nm-spin');
  });
});

describe('TextButton', () => {
  it('is at least 44 px high and 44 px wide, so a short label (vi "Hủy", zh "返回") is still a tap target (C-12)', () => {
    for (const label of ['Hủy', '返回', 'Back']) {
      const html = renderToStaticMarkup(createElement(TextButton, { t, label, onClick: nothing }));
      expect(html, label).toContain('min-height:44px');
      expect(html, label).toContain('min-width:44px');
    }
  });
});

describe('RecoveryCodesPanel', () => {
  it('has a heading that script can focus without making it a stop of the Tab key (C-9b)', () => {
    const html = renderToStaticMarkup(createElement(RecoveryCodesPanel, { t, codes: ['aaaa-bbbb', 'cccc-dddd'], onDone: nothing }));
    expect(html).toMatch(/<h2[^>]*tabindex="-1"/);
    expect(html).toContain('aaaa-bbbb');
    // Nothing else in the panel has a positive tab index, and the heading is the first thing in it.
    expect(html).not.toMatch(/tabindex="[1-9]/);
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('<ol'));
  });
});
