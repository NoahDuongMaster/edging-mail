import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog, type DialogProps } from '../../src/client/ui/Dialog';
import { escapeRoute } from '../../src/client/ui/layers';

// ui/Dialog as the server renders it (no browser, no `document` here): an inline dialog renders in place, and what its options draw. Focus,
// Tab and the scrim need a real browser; the order in which Escape is handled is the pure decision of layers.ts, tested at the end.

function nothing(): void {
  // A handler the test never calls.
}

function render(props: Partial<DialogProps> = {}, children: ReactNode = createElement('p', null, 'Content')): string {
  return renderToStaticMarkup(createElement(Dialog, { open: true, inline: true, onClose: nothing, title: 'Title', ...props }, children));
}

/** The opening tag of the first element with this class. */
const tagWith = (html: string, name: string): string =>
  new RegExp(String.raw`<[a-z0-9]+\b[^>]*\bclass="${name}"[^>]*>`).exec(html)?.[0] ?? '';
/** The opening tag of the close button in the heading. */
const closeButton = (html: string): string => /<div class="ui-dialog-head">[\s\S]*?(<button\b[^>]*>)/.exec(html)?.[1] ?? '';

describe('an inline ui Dialog', () => {
  it('renders in place, on the server too: the scrim, then the panel with the role, named by its title', () => {
    const html = render();
    expect(html).toMatch(/^<div role="presentation" class="ui-dialog-root">/);
    const panel = /<div\b[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('tabindex="-1"');
    expect(panel).toContain('class="ui-dialog" data-size="md"');
    const titleId = /aria-labelledby="([^"]+)"/.exec(panel)?.[1] ?? '';
    expect(html).toContain(`<h2 id="${titleId}" class="ui-dialog-title">Title</h2>`);
    expect(html).toContain('<div class="ui-dialog-body"><p>Content</p></div>');
  });

  it('renders nothing while it is closed', () => {
    expect(render({ open: false })).toBe('');
  });

  it('is an alertdialog when asked, and points at its description', () => {
    const html = render({ role: 'alertdialog', description: 'Why' });
    const panel = /<div\b[^>]*role="alertdialog"[^>]*>/.exec(html)?.[0] ?? '';
    const describedBy = /aria-describedby="([^"]+)"/.exec(panel)?.[1] ?? '';
    expect(describedBy).not.toBe('');
    expect(html).toContain(`<p id="${describedBy}" class="ui-dialog-description">Why</p>`);
  });

  it('closeDisabled keeps the X in its place, disabled; without it the X is usable; not dismissible or closeButton false: no X', () => {
    const open = closeButton(render());
    expect(open).toContain('aria-label="Close"');
    expect(open).not.toContain('disabled');
    const held = closeButton(render({ closeDisabled: true }));
    expect(held).toContain('aria-label="Close"');
    expect(held).toContain('disabled=""');
    for (const props of [{ dismissible: false }, { closeButton: false }]) {
      expect(render(props)).not.toMatch(/<div class="ui-dialog-head">[\s\S]*?<button/);
    }
  });

  it('draws the toolbar row between the heading (and its description) and the content, and the footer after the content', () => {
    const html = render({
      description: 'Why',
      toolbar: createElement('div', { role: 'tablist', 'aria-label': 'Sections' }),
      footer: createElement('span', null, 'Buttons')
    });
    const order = ['ui-dialog-head', 'ui-dialog-description', 'ui-dialog-toolbar', 'ui-dialog-body', 'ui-dialog-foot'].map((name) =>
      html.indexOf(`class="${name}"`)
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<div class="ui-dialog-toolbar"><div role="tablist" aria-label="Sections"></div></div>');
    expect(render()).not.toContain('ui-dialog-toolbar');
  });

  it('takes an exact width and the classes of its panel and scrim', () => {
    const html = render({ width: 460, className: 'nm-admin ad-dialog', rootClassName: 'st-root', size: 'lg' });
    expect(html).toMatch(/^<div role="presentation" class="ui-dialog-root st-root">/);
    const panel = tagWith(html, 'ui-dialog nm-admin ad-dialog');
    expect(panel).toContain('data-size="lg"');
    expect(panel).toContain('style="max-width:460px"');
    expect(tagWith(render(), 'ui-dialog')).not.toContain('style=');
  });
});

describe('who answers Escape (layers.ts)', () => {
  // Stand-ins for DOM nodes: only `contains` is used.
  const inside = {} as unknown as Node;
  const outside = {} as unknown as Node;
  const panel = { contains: (node: Node | null) => node === inside } as unknown as HTMLElement;
  const dialog = { element: { current: panel } };
  const popup = { element: undefined };

  it('nobody when no layer is open, or when the key ends an IME composition', () => {
    expect(escapeRoute(undefined, inside, false)).toBe('none');
    expect(escapeRoute(dialog, inside, true)).toBe('none');
    expect(escapeRoute(popup, outside, true)).toBe('none');
  });

  it('the controls inside a dialog first, when it was pressed among them (the dialog then closes unless one of them used it)', () => {
    expect(escapeRoute(dialog, inside, false)).toBe('content');
  });

  it('the top layer at once: a popup (it has no element), or a dialog while focus is outside it (on the page behind)', () => {
    expect(escapeRoute(popup, inside, false)).toBe('close');
    expect(escapeRoute(dialog, outside, false)).toBe('close');
    expect(escapeRoute(dialog, null, false)).toBe('close');
    expect(escapeRoute({ element: { current: null } }, inside, false)).toBe('close');
  });
});
