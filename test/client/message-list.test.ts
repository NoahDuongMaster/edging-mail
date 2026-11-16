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

  it('shows the avatar, the sender (or the bare address), the subject, the preview, the paperclip and the quiet label in one row', () => {
    expect(html).toContain('Dana Whitfield');
    expect(html).toContain('noreply@example.org');
    expect(html).toContain('Quarterly plan');
    expect(html).toContain('Meet at the harbour on Friday');
    expect(html).toContain(`aria-label="${tr('list.has_attachments')}"`);
    // Lead review 4: a label is a quiet dot of its hue and its name (no chip fill); its name is in the row's name.
    expect(html).toMatch(
      /<span class="ml-label"><span aria-hidden="true" class="ml-label-dot" style="background:[^"]+"><\/span><span class="ml-label-text">Work<\/span><\/span>/
    );
    expect(html).not.toContain('data-kind="label"');
    const three = render({ messages: [mail({ id: 'l', labels: JSON.stringify(['Work', 'Travel', 'Family']) })] });
    expect(three.match(/class="ml-label"/g)).toHaveLength(1);
    expect(three).toContain('<span aria-hidden="true" class="ml-more-labels">+2</span>');
    expect(three).toContain('<span class="ui-visually-hidden">Travel, Family</span>');
    // v3: the avatar is the library's initials tile on the person's own soft tint (ui Avatar `hue`: the sender's address through
    // labelHue), hidden from screen readers (the name is written beside it); the open row is told by its capsule, not by its avatar.
    const avatars = [...html.matchAll(/<span class="ui-avatar ml-avatar"[^>]*>([^<]*)<\/span>/g)];
    expect(avatars.map((match) => match[1])).toEqual(['DW', 'N']);
    expect(avatars[0][0]).toContain('aria-hidden="true"');
    expect(avatars[1][0]).not.toContain('data-selected');
    expect(html).not.toMatch(/border-radius:\s*50%/);
  });

  it('says only the clock time under a day heading (no second "Yesterday"), the day word where the group is another time', () => {
    const yesterday = NOW - 86_400_000;
    const listed = render({ messages: [mail({ id: 'y', created_at: yesterday, updated_at: yesterday })] });
    expect(listed).toContain(`<h2 class="ml-group-title">${tr('list.group_yesterday')}</h2>`);
    expect(listed).toMatch(/<span class="ml-time">[^<]*\d[^<]*<\/span>/);
    expect(listed).not.toMatch(new RegExp(`class="ml-time">${tr('time.yesterday')}</span>`));
  });

  it('puts a star button beside each row: pressed when starred, named after the sender', () => {
    const stars = [...html.matchAll(/<button[^>]*class="ml-star"[^>]*>/g)].map((match) => match[0]);
    expect(stars).toHaveLength(2);
    expect(stars[0]).toContain('aria-pressed="true"');
    expect(stars[0]).toContain(`aria-label="${tr('list.star_from', { sender: 'Dana Whitfield' })}"`);
    expect(stars[1]).toContain('aria-pressed="false"');
  });

  it('offers All, Unread, Starred and Attachments as one radio group (one Tab stop, the arrows choose; J1-10), the same four as a phone', () => {
    expect(html).toMatch(new RegExp(`<div role="radiogroup" aria-label="${tr('list.filter_label')}" class="ui-seg`));
    const filters = [
      ...html.matchAll(/<button[^>]*role="radio"[^>]*class="ui-seg-item"[^>]*aria-checked="(true|false)"[^>]*tabindex="(0|-1)"/g)
    ];
    expect(filters.map((match) => match[1])).toEqual(['true', 'false', 'false', 'false']);
    expect(filters.map((match) => match[2])).toEqual(['0', '-1', '-1', '-1']);
    expect(html).toContain(tr('list.filter_unread'));
    expect(html).toContain(`>${tr('folder.starred')}<`);
    expect(html).toContain(tr('term.attachments'));
    expect(html).not.toMatch(/aria-pressed="(true|false)"[^>]*class="ui-seg-item"|class="ui-seg-item"[^>]*aria-pressed/);
  });

  it('is not the phone board: no swipe wrapper, a heading, no compact mark', () => {
    expect(html).not.toContain('ml-swipe');
    expect(tagOf(html, 'ml-root')).not.toContain('data-compact');
  });
});

/** The accessible names of the quick actions of every row, in order. */
const quickNames = (html: string): string[] =>
  [...html.matchAll(/<div class="ml-quick">([\s\S]*?)<\/div><\/div><\/li>/g)].flatMap((match) =>
    [...match[1].matchAll(/aria-label="([^"]+)"/g)].map((label) => label[1])
  );

describe('the quick actions of a desktop row', () => {
  const actions = { archive: noop, trash: noop, restore: noop, deleteForever: noop, toggleRead: noop, snooze: noop, unsnooze: noop };
  const names = quickNames;

  it('offers Archive, Move to Trash, Mark as read/unread and Snooze, labelled, in every Inbox row', () => {
    const html = render({ rowActions: actions, messages: [mail({ id: 'u', is_read: 0 }), mail({ id: 'r', is_read: 1 })] });
    expect((html.match(/class="ml-quick"/g) ?? []).length).toBe(2);
    const labels = names(html);
    expect(labels.slice(0, 4)).toEqual([tr('action.archive'), tr('action.move_to_trash'), tr('action.mark_read'), tr('action.snooze')]);
    expect(labels.slice(4)).toEqual([tr('action.archive'), tr('action.move_to_trash'), tr('action.mark_unread'), tr('action.snooze')]);
  });

  it('offers Move to Inbox and Delete forever in Trash (no Snooze), and nothing without actions or in Drafts', () => {
    const trash = render({ rowActions: actions, folder: 'trash', title: 'Trash', messages: [mail({ folder: 'trash' })] });
    expect(names(trash)).toEqual([tr('action.move_to_inbox'), tr('action.delete_forever'), tr('action.mark_unread')]);
    expect(render({ messages: [mail()] })).not.toContain('ml-quick');
    expect(render({ rowActions: actions, isDrafts: true, folder: 'drafts', messages: [mail()] })).not.toContain('ml-quick');
  });

  it('is never on the phone board (rows swipe there)', () => {
    expect(render({ rowActions: actions, compact: true, messages: [mail()] })).not.toContain('ml-quick');
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
    expect(html).not.toContain('ml-label');
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

  it('swipes when either way is open (a folder that can only move to Trash still swipes)', () => {
    expect(render({ compact: true, onSwipeTrash: noop, messages: [mail()] })).toContain('data-swipeable="true"');
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

  it('says the search or the filter found nothing, without Edgar, and offers to clear the search', () => {
    const searched = render({ searchQuery: 'zebra' });
    expect(searched).toContain(tr('list.no_results', { query: 'zebra' }));
    expect(searched).toContain(tr('list.try_other_search'));
    expect(searched).not.toContain('/edgar.svg');
    expect(searched).not.toContain(tr('app.clear_search'));
    // ONE Clear control (J6-37): the search field's own X (App's search, which the list sheet's head holds now, DESIGN-v3 4.1); the list
    // adds none of its own, and the empty state only offers to look in all mail.
    const cleared = render({ searchQuery: 'zebra', onClearSearch: noop, onScopeChange: noop });
    expect(cleared).not.toContain(tr('app.clear_search'));
    expect(cleared).toMatch(new RegExp(`<button[^>]*>${tr('list.search_all')}</button>`));
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
  // Late in the evening, three hours from now is tomorrow: the heading follows the calendar day of the wake time.
  const wakesToday = new Date(until).toDateString() === new Date(NOW).toDateString();

  it('groups by the day the mail comes back and shows its wake time as a chip in the row', () => {
    const html = render({ isSnoozed: true, folder: 'snoozed', title: 'Snoozed', messages: [snoozed] });
    expect(html).toContain(`<h2 class="ml-group-title">${tr(wakesToday ? 'list.group_today' : 'list.group_tomorrow')}</h2>`);
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

  it('renders a closed Snooze button that says it opens a small dialog (the choices hold a date field) and is not expanded', () => {
    const html = renderToStaticMarkup(createElement(SnoozeMenu, { ...props, snoozed: false }));
    expect(html).toContain(`aria-label="${tr('action.snooze')}"`);
    expect(html).toContain('aria-haspopup="dialog"');
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

describe('multi-select and the row names (J6-26, J1-20)', () => {
  const rows = [mail({ id: 'a', is_read: 0, has_attachments: 1, labels: '["Work"]' }), mail({ id: 'b', from_name: 'Lee Park' })];

  it('names a row by its summary (its content without the preview: 2.5.3 holds) and describes it by its preview', () => {
    const html = render({ messages: rows });
    const button = /<button type="button" class="ml-row"[^>]*>/.exec(html)?.[0] ?? '';
    // No aria-label(ledby): the name comes from the content, in the order it is seen; the preview is hidden from it.
    expect(button).not.toMatch(/aria-label/);
    const described = /aria-describedby="([^"]+)"/.exec(button)?.[1] ?? '';
    expect(html).toMatch(new RegExp(`<span id="${described}" aria-hidden="true" class="ml-preview">Meet at the harbour on Friday</span>`));
    expect(html).toContain(`<span class="ui-visually-hidden">${tr('list.unread_sr')}</span>`);
  });

  it('puts a labelled box in every desktop row (not a Tab stop) once the list can select, and none in Drafts', () => {
    const html = render({ messages: rows, onSelectionChange: noop });
    expect(html.match(/class="ui-check ml-check"/g)).toHaveLength(2);
    expect(html).toContain(tr('list.select_message', { sender: 'Lee Park' }));
    expect(html).toMatch(/<input[^>]*tabindex="-1"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*tabindex="-1"/);
    expect(render({ messages: rows })).not.toContain('ml-check');
    expect(render({ messages: rows, onSelectionChange: noop, isDrafts: true, folder: 'drafts' })).not.toContain('ml-check');
  });

  it('marks the ticked rows, says "Selected" in their name, and floats the selection bar at the bottom of the sheet (the head stays)', () => {
    const html = render({ messages: rows, onSelectionChange: noop, selection: new Set(['b']), selectionBar: '<BAR>' });
    expect(html).toContain('data-selecting="true"');
    expect(html.match(/data-checked="true"/g)).toHaveLength(1);
    expect(html).toContain(tr('list.selected_sr'));
    expect(html).toMatch(/<div class="ml-dock"><span aria-hidden="true" class="ml-dock-anchor"><\/span>&lt;BAR&gt;<\/div>/);
    expect(html).toMatch(/<h1 id="list-title" class="ml-title">Inbox<\/h1>/);
    // Nothing ticked: the dock is empty (its anchor only).
    expect(render({ messages: rows, onSelectionChange: noop, selectionBar: '<BAR>' })).not.toContain('&lt;BAR&gt;');
  });

  it('on the phone board: the avatar becomes a round tick, the row a toggle (aria-pressed), and no swipe while selecting', () => {
    const html = render({ messages: rows, compact: true, onSwipeArchive: noop, onSelectionChange: noop, selection: new Set(['a']) });
    expect(html.match(/class="ml-pick"/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('data-swipeable');
    expect(html).not.toContain('ml-avatar');
  });

  it("starts a search result's preview a few words before the match, marked (J6-32)", () => {
    const long = mail({
      snippet: 'The quarterly numbers are in and the plan is ready, so we can meet with Maya on Friday to go through it.'
    });
    const html = render({ messages: [long], searchQuery: 'maya' });
    expect(html).toMatch(/…[^<]*with <mark class="ml-hit">Maya<\/mark>/);
  });
});
