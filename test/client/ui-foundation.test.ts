import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  DisclosurePanel,
  EmptyState,
  IconButton,
  Section,
  Spinner,
  Tabs,
  TextField,
  Toolbar
} from '../../src/client/ui';
import { durationFor, exitDuration, motionReduced } from '../../src/client/ui/motion';
import { tabTarget } from '../../src/client/ui/Tabs';
import { toolbarTarget } from '../../src/client/ui/Toolbar';
import { DURATION } from '../../src/shared/design/tokens';

// The pieces of the redesign's foundation (wave 1): the motion helpers' rules, the Toolbar and the vertical Tabs keys, and the markup the
// stylesheet and screen readers rely on, rendered on the server side of React (no browser). The motion itself, the sliding indicators
// (added in the browser only) and the looks are checked in the UI lab gallery.

const noop = (): void => {
  // a callback the test does not look at
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);

describe('motion rules', () => {
  it('times a move by its distance: 150 ms at least, 400 ms at most, longer for a longer way', () => {
    expect(durationFor(0)).toBe(150);
    expect(durationFor(100)).toBe(180);
    expect(durationFor(400)).toBe(270);
    expect(durationFor(10_000)).toBe(400);
    expect(durationFor(-5)).toBe(150);
  });

  it('makes an exit 0.7 of its enter, to the nearest 10 ms', () => {
    expect(exitDuration(DURATION.slow)).toBe(210);
    expect(exitDuration(DURATION.gentle)).toBe(180);
    expect(exitDuration(DURATION.base)).toBe(140);
  });

  it('counts as reduced where there is no page (the server, a worker): nothing moves before the browser says it may', () => {
    expect(motionReduced()).toBe(true);
  });
});

describe('Toolbar', () => {
  it('moves with Left and Right (round), jumps with Home and End, ignores Up and Down and other keys', () => {
    expect(toolbarTarget(4, 0, 'ArrowRight', 'horizontal')).toBe(1);
    expect(toolbarTarget(4, 3, 'ArrowRight', 'horizontal')).toBe(0);
    expect(toolbarTarget(4, 0, 'ArrowLeft', 'horizontal')).toBe(3);
    expect(toolbarTarget(4, 2, 'Home', 'horizontal')).toBe(0);
    expect(toolbarTarget(4, 0, 'End', 'horizontal')).toBe(3);
    expect(toolbarTarget(4, 1, 'ArrowDown', 'horizontal')).toBe(-1);
    expect(toolbarTarget(4, 1, 'Enter', 'horizontal')).toBe(-1);
    expect(toolbarTarget(0, -1, 'ArrowRight', 'horizontal')).toBe(-1);
    expect(toolbarTarget(3, -1, 'ArrowRight', 'horizontal')).toBe(0);
  });

  it('moves with Up and Down when vertical, and leaves Left and Right alone', () => {
    expect(toolbarTarget(3, 0, 'ArrowDown', 'vertical')).toBe(1);
    expect(toolbarTarget(3, 0, 'ArrowUp', 'vertical')).toBe(2);
    expect(toolbarTarget(3, 0, 'ArrowRight', 'vertical')).toBe(-1);
  });

  it('is a named toolbar; the orientation is said only when it is vertical (horizontal is the default of the role)', () => {
    const child = h(IconButton, { label: 'Archive' }, 'A');
    const row = render(h(Toolbar, { 'aria-label': 'Message actions' }, child));
    expect(row).toMatch(/^<div role="toolbar" class="ui-toolbar" aria-label="Message actions">/);
    expect(row).not.toContain('aria-orientation');
    const column = render(h(Toolbar, { 'aria-label': 'Tools', orientation: 'vertical' }, child));
    expect(column).toContain('aria-orientation="vertical"');
  });
});

describe('Tabs', () => {
  const tabs = [
    { value: 'a', label: 'Profile' },
    { value: 'b', label: 'Security' },
    { value: 'c', label: 'Appearance' }
  ];

  it('moves with Up and Down in a vertical list (round), Left and Right in a row, Home and End in both', () => {
    const values = tabs.map((tab) => tab.value);
    expect(tabTarget(values, 0, 'ArrowDown', 'vertical')).toBe('b');
    expect(tabTarget(values, 0, 'ArrowUp', 'vertical')).toBe('c');
    expect(tabTarget(values, 0, 'ArrowRight', 'vertical')).toBeUndefined();
    expect(tabTarget(values, 2, 'ArrowRight', 'horizontal')).toBe('a');
    expect(tabTarget(values, 1, 'ArrowDown', 'horizontal')).toBeUndefined();
    expect(tabTarget(values, 1, 'Home', 'vertical')).toBe('a');
    expect(tabTarget(values, 1, 'End', 'horizontal')).toBe('c');
  });

  it('says a vertical list is vertical, and draws no sliding indicator on the server (it is added in the browser)', () => {
    const html = render(h(Tabs, { id: 's', label: 'Sections', tabs, value: 'b', onChange: noop, orientation: 'vertical' }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).not.toContain('ui-ink');
    const selected = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(selected.map((tag) => /aria-selected="(\w+)"/.exec(tag)?.[1])).toEqual(['false', 'true', 'false']);
    expect(selected.map((tag) => /tabindex="(-?\d)"/.exec(tag)?.[1])).toEqual(['-1', '0', '-1']);
    const row = render(h(Tabs, { id: 's', label: 'Sections', tabs, value: 'a', onChange: noop }));
    expect(row).not.toContain('aria-orientation');
  });
});

describe('the restyled primitives (markup the stylesheet relies on)', () => {
  it('Checkbox: the native box inside a wrapper with the tick drawn over it, hidden from screen readers', () => {
    const html = render(h(Checkbox, { label: 'Remember me', checked: true, onChange: noop }));
    expect(html).toMatch(/<span class="ui-check-box"><input[^>]*type="checkbox"[^>]*class="ui-check-input"/);
    expect(html).toMatch(/<svg[^>]*class="ui-check-mark"[^>]*aria-hidden="true"/);
  });

  it('Avatar: one neutral tile for everybody, the accent tint only when selected, never read out', () => {
    expect(render(h(Avatar, { name: 'Ana Lima' }))).toBe('<span class="ui-avatar" data-size="md" aria-hidden="true">AL</span>');
    expect(render(h(Avatar, { name: 'Ana Lima', size: 'lg', selected: true }))).toContain('data-selected="true"');
  });

  it('DisclosurePanel: the region with the id its Disclosure names, open or not by data-open, its content in one inner box', () => {
    expect(render(h(DisclosurePanel, { id: 'more', open: true, children: 'Body' }))).toBe(
      '<div id="more" class="ui-collapse" data-open="true"><div class="ui-collapse-inner">Body</div></div>'
    );
    expect(render(h(DisclosurePanel, { id: 'more', open: false, children: 'Body' }))).not.toContain('data-open');
  });

  it('Spinner: a status with its words (shown beside it under reduced motion), or silent inside a busy control', () => {
    const own = render(h(Spinner, { label: 'Checking the records…' }));
    expect(own).toMatch(/^<span class="ui-spinner" role="status">/);
    expect(own).toContain('<span class="ui-spinner-label">Checking the records…</span>');
    const decorative = render(h(Spinner, { decorative: true }));
    expect(decorative).not.toContain('role=');
    expect(decorative).not.toContain('ui-spinner-label');
  });

  it('Card: lifts on hover only when it is interactive', () => {
    expect(render(h(Card, { interactive: true }, 'x'))).toContain('data-interactive="true"');
    expect(render(h(Card, null, 'x'))).not.toContain('data-interactive');
  });

  it('EmptyState: Edgar only when asked, decorative; the idle beat is set in the browser, never in the server markup', () => {
    const html = render(h(EmptyState, { title: 'Nothing here', illustration: true, idle: true }));
    expect(html).toContain('ui-empty-art');
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).not.toContain('data-idle');
    expect(render(h(EmptyState, { title: 'Nothing here' }))).not.toContain('<img');
  });
});

describe('the v3 additions (props only: every existing call renders as before)', () => {
  it('Avatar: a person hue is a tint set inline (data-hue + --ui-hue), any px size goes through --ui-avatar-size, the neutral tile is unchanged', () => {
    const tinted = render(h(Avatar, { name: 'Ana Lima', hue: '#0E7490' }));
    expect(tinted).toContain('data-hue="true"');
    expect(tinted).toMatch(/style="--ui-hue:#0E7490"/);
    const sized = render(h(Avatar, { name: 'Ana Lima', size: 36 }));
    expect(sized).toContain('data-size="custom"');
    expect(sized).toMatch(/style="--ui-avatar-size:36px;font-size:14px"/);
    expect(render(h(Avatar, { name: 'Ana Lima', size: 'xl' }))).toBe('<span class="ui-avatar" data-size="xl" aria-hidden="true">AL</span>');
    expect(render(h(Avatar, { name: 'Ana Lima', hue: '' }))).not.toContain('data-hue');
  });

  it('Button: shape="pill" is a data attribute (no shape: no attribute), the label and the variant stay', () => {
    expect(render(h(Button, { variant: 'primary', shape: 'pill' }, 'Compose'))).toMatch(
      /^<button type="button" class="ui-btn" data-variant="primary" data-size="md" data-shape="pill">Compose<\/button>$/
    );
    expect(render(h(Button, null, 'Save'))).not.toContain('data-shape');
  });

  it('TextField variant="search": the filled pill with a magnifier inside its left edge unless a leading adornment replaces it', () => {
    const html = render(h(TextField, { label: 'Search mail', hideLabel: true, variant: 'search', type: 'search' }));
    expect(html).toMatch(/<div class="ui-input" data-variant="search"><span class="ui-adorn"><svg[^>]*lucide-search/);
    expect(html).toMatch(/<input[^>]*type="search"/);
    const own = render(h(TextField, { label: 'Search', variant: 'search', leading: h('i', null, 'q') }));
    expect(own).toContain('<span class="ui-adorn"><i>q</i></span>');
    expect(render(h(TextField, { label: 'Name' }))).toMatch(/<div class="ui-input"><input/);
  });

  it('EmptyState art: a decorative slot above the title; without it the title comes first', () => {
    const html = render(h(EmptyState, { title: 'No messages', art: h('svg', { 'aria-hidden': 'true' }) }));
    expect(html).toMatch(
      /^<div class="ui-empty"><div class="ui-empty-slot" aria-hidden="true"><svg[^>]*><\/svg><\/div><h2 class="ui-empty-title">/
    );
    expect(render(h(EmptyState, { title: 'No messages' }))).toMatch(/^<div class="ui-empty"><h2 class="ui-empty-title">/);
  });

  it('Section grouped: the rows sit in one .ui-group card under the heading; a plain Section has no wrapper', () => {
    const grouped = render(h(Section, { title: 'Notifications', grouped: true }, h('div', null, 'a'), h('div', null, 'b')));
    expect(grouped).toMatch(/<\/div><div class="ui-group"><div>a<\/div><div>b<\/div><\/div><\/section>$/);
    expect(render(h(Section, { title: 'Plain' }, h('p', null, 'x')))).not.toContain('ui-group');
  });
});
