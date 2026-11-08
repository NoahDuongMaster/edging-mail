import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageList } from '../../src/client/components/MessageList';
import { SnoozeChip, SnoozeMenu } from '../../src/client/components/SnoozeMenu';
import { tr } from '../../src/client/lib/i18n';
import { getTokens } from '../../src/client/theme';
import type { Message } from '../../src/client/types';

// The message list and the snooze button as the browser first sees them (rendered on the server side of React, no browser). The
// interactions (swipe, scroll memory, the menu's keys) were run in a browser; what a render can hold is held here: the row anatomy, the
// states of the list (loading, empty, could-not-load, load more), what the phone board leaves out, and the closed snooze button.

const noop = (): void => {
  // a callback the test does not look at
};
const NOW = Date.now();

const mail = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  from_address: 'dana@example.com',
  from_name: 'Dana Whitfield',
  to_address: 'me@example.com',
  subject: 'Quarterly plan',
  snippet: 'Meet at the harbour on Friday',
  folder: 'inbox',
  labels: null,
  is_read: 1,
  is_starred: 0,
  has_attachments: 0,
  size: 100,
  created_at: NOW,
  updated_at: NOW,
  ...over
});

type ListProps = ComponentProps<typeof MessageList>;

const base: ListProps = {
  t: getTokens(false),
  messages: [],
  selectedId: null,
  onSelect: noop,
  onToggleStar: noop,
  title: 'Inbox',
  folder: 'inbox',
  subtitle: '3 unread',
  filter: 'all',
  onFilterChange: noop,
  onMarkAllRead: noop,
  onRefresh: noop,
  isLoading: false
};

const render = (props: Partial<ListProps> = {}): string => renderToStaticMarkup(createElement(MessageList, { ...base, ...props }));

/** The opening tag of the first element of a page whose class is exactly `name`. */
const tagOf = (html: string, name: string): string => new RegExp(`<[a-z0-9]+ [^>]*class="${name}"[^>]*>`).exec(html)?.[0] ?? '';

describe('the desktop list', () => {
  const html = render({
    messages: [
      mail({ id: 'a', is_read: 0, is_starred: 1, has_attachments: 1, labels: JSON.stringify(['Work']) }),
      mail({ id: 'b', from_name: null, from_address: 'noreply@example.org', subject: 'Receipt' })
    ],
    selectedId: 'b'
  });

  it('has the folder as the page heading with its count, the two actions, and the date group heading', () => {
    expect(html).toMatch(/<h1 id="list-title" class="ml-title">Inbox<\/h1>/);
    expect(html).toContain('3 unread');
    expect(html).toContain(`aria-label="${tr('list.mark_all_read')}"`);
    expect(html).toContain(`aria-label="${tr('list.refresh')}"`);
    expect(html).toMatch(new RegExp(`<h2 class="ml-group-title">${tr('list.group_today')}</h2>`));
  });

  it('marks an unread row with a dot AND with words, and the open row with aria-current', () => {
    const rows = html.split('<li ').filter((part) => part.includes('class="ml-row"'));
    expect(rows).toHaveLength(2);
    expect(tagOf(rows[0], 'ml-row')).toContain('data-unread="true"');
    expect(rows[0]).toContain(tr('list.unread_sr'));
    expect(tagOf(rows[1], 'ml-row')).not.toContain('data-unread');
    expect(rows[1]).not.toContain(tr('list.unread_sr'));
    expect(tagOf(rows[1], 'ml-row')).toContain('aria-current="true"');
    expect(tagOf(rows[0], 'ml-row')).not.toContain('aria-current');
  });

  it('shows the sender (or the bare address), the subject, the preview, the paperclip and the label chip in one row, with no avatar', () => {
    expect(html).toContain('Dana Whitfield');
    expect(html).toContain('noreply@example.org');
    expect(html).toContain('Quarterly plan');
    expect(html).toContain('Meet at the harbour on Friday');
    expect(html).toContain(`aria-label="${tr('list.has_attachments')}"`);
    expect(html).toMatch(
      /<span class="ui-chip" data-kind="label" style="[^"]*"><span aria-hidden="true" class="ui-chip-dot"[^>]*><\/span><span class="ui-chip-text">Work<\/span>/
    );
    expect(html).not.toMatch(/border-radius:\s*50%/);
  });

  it('puts a star button beside each row: pressed when starred, named after the sender', () => {
    const stars = [...html.matchAll(/<button[^>]*class="ml-star"[^>]*>/g)].map((match) => match[0]);
    expect(stars).toHaveLength(2);
    expect(stars[0]).toContain('aria-pressed="true"');
    expect(stars[0]).toContain(`aria-label="${tr('list.star_from', { sender: 'Dana Whitfield' })}"`);
    expect(stars[1]).toContain('aria-pressed="false"');
  });

  it('offers All, Unread and Attachments as toggle buttons (a ui SegmentedControl in toggle mode), the current one pressed', () => {
    expect(html).toMatch(new RegExp(`<div role="group" aria-label="${tr('list.filter_label')}" class="ui-seg"`));
    const filters = [...html.matchAll(/<button[^>]*class="ui-seg-item"[^>]*aria-pressed="(true|false)"[^>]*>/g)];
    expect(filters.map((match) => match[1])).toEqual(['true', 'false', 'false']);
    expect(html).toContain(tr('list.filter_unread'));
    expect(html).toContain(tr('term.attachments'));
    expect(html).not.toContain(`>${tr('folder.starred')}<`);
  });

  it('is not the phone board: no swipe wrapper, a heading, no compact mark', () => {
    expect(html).not.toContain('ml-swipe');
    expect(tagOf(html, 'ml-root')).not.toContain('data-compact');
  });
});

describe('Drafts', () => {
  const html = render({
    isDrafts: true,
    folder: 'drafts',
    title: 'Drafts',
    messages: [mail({ id: 'd', to_address: 'kim@example.com', is_read: 1 })]
  });

  it('names the recipients, has no mark-all-read, no filters and no star', () => {
    expect(html).toContain(tr('list.draft_to', { recipients: 'kim@example.com' }));
    expect(html).not.toContain(tr('list.mark_all_read'));
    expect(html).not.toContain('ml-filters');
    expect(html).not.toContain('ml-star');
    // The head closes itself with a hairline in every folder (messagelist.css), so Drafts needs no marker of its own.
    expect(tagOf(html, 'ml-head')).not.toContain('data-last');
  });

  it('says "No recipient" when none is set yet', () => {
    expect(render({ isDrafts: true, folder: 'drafts', messages: [mail({ to_address: '  ' })] })).toContain(tr('list.no_recipient'));
  });
});

describe('the phone board', () => {
  const html = render({
    compact: true,
    onSwipeArchive: noop,
    messages: [
      mail({ id: 'a', is_starred: 1, labels: JSON.stringify(['Work']), has_attachments: 1 }),
      mail({ id: 'b', subject: 'Other', is_starred: 0 })
    ],
    selectedId: 'a'
  });

  it('has no heading of its own (the page header has it), four filters including Starred, and wraps the rows for swiping', () => {
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('ml-head');
    expect(html).toContain(tr('folder.starred'));
    expect(tagOf(html, 'ml-root')).toContain('data-compact="true"');
    expect((html.match(/data-swipeable="true"/g) ?? []).length).toBe(2);
  });

  it('shows a star only on a starred row, leaves the labels out, never marks an open row, and has no archive label at rest', () => {
    expect((html.match(/class="ml-star"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('ui-chip-text');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('ml-swipe-reveal');
    expect(html).not.toContain('transform');
  });

  it('keeps the clearance for the floating Compose button under the last group, unless Load more carries it', () => {
    expect(html).toContain('data-clear="true"');
    expect(render({ compact: true, hasMore: true, messages: [mail()] })).not.toContain('data-clear');
  });

  it('turns the swipe off when the folder cannot archive', () => {
    expect(render({ compact: true, messages: [mail()] })).not.toContain('data-swipeable');
  });
});

describe('the states of an empty list', () => {
  it('shows the loading rows with a status for screen readers, and neither the empty text nor an error', () => {
    const html = render({ isLoading: true });
    expect(html).toContain('role="status"');
    expect(html).toContain(tr('list.loading'));
    expect(html).not.toContain(tr('list.empty_in', { folder: 'Inbox' }));
    expect(html).not.toContain(tr('list.load_failed'));
  });

  it('says "all caught up" with Edgar for an empty Inbox, and nothing about search', () => {
    const html = render();
    expect(html).toContain(tr('list.empty_in', { folder: 'Inbox' }));
    expect(html).toContain(tr('list.hint_inbox'));
    expect(html).toContain('/edgar.svg');
  });

  it('says the folder is empty without Edgar for another folder, with its own hint', () => {
    const html = render({ folder: 'trash', title: 'Trash' });
    expect(html).toContain(tr('list.hint_trash'));
    expect(html).not.toContain('/edgar.svg');
  });

  it('says the search or the filter found nothing, without Edgar', () => {
    const searched = render({ searchQuery: 'zebra' });
    expect(searched).toContain(tr('list.no_results', { query: 'zebra' }));
    expect(searched).toContain(tr('list.try_other_search'));
    expect(searched).not.toContain('/edgar.svg');
    const filtered = render({ filter: 'unread' });
    expect(filtered).toContain(tr('list.no_match'));
    expect(filtered).toContain(tr('list.hint_switch_all'));
  });

  it('says "Could not load mail" with a Try again button, never the empty-folder text', () => {
    const html = render({ loadFailed: true, onRetry: noop });
    expect(html).toContain(tr('list.load_failed'));
    expect(html).toContain(tr('list.load_failed_hint'));
    expect(html).toMatch(new RegExp(`<button[^>]*>${tr('common.retry')}</button>`));
    expect(html).not.toContain(tr('list.empty_in', { folder: 'Inbox' }));
    expect(html).toContain('/edgar.svg');
  });
});

describe('Load more', () => {
  it('ends the list with a button, which says it is busy but keeps its place while loading', () => {
    const idle = render({ hasMore: true, messages: [mail()] });
    expect(idle).toContain(tr('list.load_more'));
    expect(idle).not.toContain('aria-disabled');
    const busy = render({ hasMore: true, loadingMore: true, messages: [mail()] });
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain(tr('common.loading'));
    expect(busy).not.toMatch(/<button[^>]*\sdisabled/);
  });

  it('is absent when everything is loaded', () => {
    expect(render({ messages: [mail()] })).not.toContain(tr('list.load_more'));
  });
});

describe('the Snoozed folder', () => {
  const until = NOW + 3 * 3_600_000;
  const snoozed = mail({ id: 's', folder: 'snoozed', snoozed_until: until });

  it('groups by the day the mail comes back and shows its wake time as a chip in the row', () => {
    const html = render({ isSnoozed: true, folder: 'snoozed', title: 'Snoozed', messages: [snoozed] });
    expect(html).toContain(`<h2 class="ml-group-title">${tr('list.group_today')}</h2>`);
    expect(html).toContain('data-kind="plain"');
    expect(html).not.toContain('data-bare');
  });

  it('shows the wake time in place of the date on the phone board', () => {
    const html = render({ compact: true, isSnoozed: true, folder: 'snoozed', title: 'Snoozed', messages: [snoozed] });
    expect(html).toContain('ml-time-slot');
    expect(html).toContain('data-bare="true"');
    expect(html).not.toContain('class="ml-time"');
  });
});

describe('SnoozeMenu and SnoozeChip', () => {
  const props = { t: getTokens(false), buttonStyle: { width: 40 }, onSnooze: noop, onUnsnooze: noop };

  it('renders a closed menu button named Snooze, that says it opens a menu and is not expanded', () => {
    const html = renderToStaticMarkup(createElement(SnoozeMenu, { ...props, snoozed: false }));
    expect(html).toContain(`aria-label="${tr('action.snooze')}"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('width:40px');
    expect(html).not.toContain('role="menu"');
    expect(html).toContain('class="ml-snooze"');
  });

  it('is an Unsnooze button, with no menu, for mail that is snoozed already', () => {
    const html = renderToStaticMarkup(createElement(SnoozeMenu, { ...props, snoozed: true }));
    expect(html).toContain(`aria-label="${tr('action.unsnooze')}"`);
    expect(html).not.toContain('aria-haspopup');
    expect(html).not.toContain('aria-expanded');
  });

  it('draws the chip with a clock and "Until ...", with or without its border', () => {
    const chip = renderToStaticMarkup(createElement(SnoozeChip, { t: getTokens(false), until: NOW + 86_400_000 }));
    expect(chip).toContain('ui-chip-icon');
    expect(chip).toMatch(/class="ui-chip-text">[^<]+</);
    expect(chip).not.toContain('data-bare');
    const bare = renderToStaticMarkup(
      createElement(SnoozeChip, { t: getTokens(false), until: NOW + 86_400_000, bare: true, selected: true })
    );
    expect(bare).toContain('data-bare="true"');
    expect(bare).toContain('data-selected="true"');
  });
});
