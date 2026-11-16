import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SELBAR_SEP, SelectAllLine, SelectionBar, fittingActions } from '../../src/client/components/SelectionBar';
import { SELECTION_SUMMARY_TITLE_ID, SelectionSummary } from '../../src/client/components/SelectionSummary';
import { tr } from '../../src/client/lib/i18n';
import { folderName } from '../../src/client/lib/mail';
import { getTokens } from '../../src/client/theme';
import type { Message } from '../../src/client/types';

// The selection bar (multi-select, J6-26): the head of the list while messages are ticked. What a render can hold: the tri-state box, the
// count, the actions for the folder (Archive / Move to Trash, or Move to Inbox / Delete forever in Trash and Spam), one toolbar, Clear; the
// phone's bar (Close, count, Archive, Move to Trash, More). Menus, the More sheet and the keys were run in the lab.

const noop = (): void => {
  // a callback the test does not look at
};

type BarProps = ComponentProps<typeof SelectionBar>;
const base: BarProps = {
  t: getTokens(false),
  count: 3,
  state: 'some',
  onToggleAll: noop,
  onClear: noop,
  folder: 'inbox',
  anyUnread: true,
  anyUnstarred: true,
  labels: ['Work'],
  actions: {
    archive: noop,
    trash: noop,
    restore: noop,
    deleteForever: noop,
    read: noop,
    unread: noop,
    star: noop,
    unstar: noop,
    move: noop,
    snooze: noop,
    label: noop
  }
};
const render = (props: Partial<BarProps> = {}): string => renderToStaticMarkup(createElement(SelectionBar, { ...base, ...props }));
const named = (html: string, name: string): boolean => html.includes(`aria-label="${name}"`);

describe('the desktop selection bar', () => {
  const html = render();

  it('is one toolbar named for the selected messages, with the box for the whole page and the count', () => {
    expect(html).toMatch(
      new RegExp(
        `role="toolbar"[^>]*aria-label="${tr('list.selection_actions')}"|aria-label="${tr('list.selection_actions')}"[^>]*role="toolbar"`
      )
    );
    expect(html).toContain(tr('list.select_all'));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(tr('list.selected_count', { count: 3 }));
  });

  it('offers Archive, Move to Trash, Snooze, Mark as read, Star, Move to folder, Add label and Clear, each named', () => {
    for (const name of [
      tr('action.archive'),
      tr('action.move_to_trash'),
      tr('action.mark_read'),
      tr('action.star'),
      tr('action.move_to_folder'),
      tr('reader.add_label'),
      tr('list.clear_selection')
    ]) {
      expect(named(html, name), name).toBe(true);
    }
    expect(html).toContain('ml-snooze');
  });

  it('says Mark as unread and Unstar when nothing ticked is unread or unstarred', () => {
    const done = render({ anyUnread: false, anyUnstarred: false });
    expect(named(done, tr('action.mark_unread'))).toBe(true);
    expect(named(done, tr('action.unstar'))).toBe(true);
    expect(named(done, tr('action.mark_read'))).toBe(false);
  });

  it('in Trash and Spam: Move to Inbox and Delete forever instead of Archive and Move to Trash, no Snooze and no labels', () => {
    for (const folder of ['trash', 'spam']) {
      const bin = render({ folder });
      expect(named(bin, tr('action.move_to_inbox')), folder).toBe(true);
      expect(named(bin, tr('action.delete_forever')), folder).toBe(true);
      expect(named(bin, tr('action.archive')), folder).toBe(false);
      expect(named(bin, tr('reader.add_label')), folder).toBe(false);
      expect(bin, folder).not.toContain('ml-snooze');
    }
  });

  it('has no Add label without labels', () => {
    expect(named(render({ labels: [] }), tr('reader.add_label'))).toBe(false);
  });

  it('keeps the folder names of Move to folder in the catalogue', () => {
    expect(folderName('archive')).toBe(tr('folder.archive'));
  });

  it('shows every action until it is measured (the server, a first render): no More menu yet', () => {
    expect(named(html, tr('list.more_actions'))).toBe(false);
  });
});

// The count is never cut (F3, round-3 clerk: "3 select…" at 1440, nothing at the 1024 tablet): the bar measures its row and as many actions
// as fit beside the count stay buttons, in their order; the rest go into More. Numbers as measured in the lab: 7 actions in the Inbox,
// 32px buttons with a mouse and 44px on a touch screen, 2px gaps, the 9px hairline after the first two.
describe('fittingActions (how many actions of the desktop bar fit beside the count)', () => {
  it('keeps them all when they fit, More takes the place of the last ones otherwise', () => {
    // 7 x 32 + 6 gaps + the hairline and its gap = 247
    expect(fittingActions(247, 7, 32, 2, SELBAR_SEP)).toBe(7);
    // 6 and More are as wide as 7: one less is not enough, it takes two
    expect(fittingActions(246, 7, 32, 2, SELBAR_SEP)).toBe(5);
    expect(fittingActions(213, 7, 32, 2, SELBAR_SEP)).toBe(5);
    expect(fittingActions(212, 7, 32, 2, SELBAR_SEP)).toBe(4);
  });

  it('on a 1024px touch screen (a 300px bar) keeps Archive and More beside "100 selected"', () => {
    // the room beside the box, the count (at least 88px), Clear and the gaps: 134px with "3 selected", 117 with "100 selected"
    expect(fittingActions(134, 7, 44, 2, SELBAR_SEP)).toBe(1);
    expect(fittingActions(117, 7, 44, 2, SELBAR_SEP)).toBe(1);
    // with less room than one action and More, everything is in More
    expect(fittingActions(89, 7, 44, 2, SELBAR_SEP)).toBe(0);
  });

  it('draws no hairline when nothing follows the first two', () => {
    expect(fittingActions(66, 2, 32, 2, SELBAR_SEP)).toBe(2);
  });
});

describe("the phone's selection bar", () => {
  it('is the app bar: Close, the count, Archive, Move to Trash and More (a sheet with the rest)', () => {
    const html = render({ phone: true });
    expect(html).toContain('mb-phone-bar ml-selbar-phone');
    for (const name of [tr('list.clear_selection'), tr('action.archive'), tr('action.move_to_trash'), tr('list.more_actions')]) {
      expect(named(html, name), name).toBe(true);
    }
    expect(html).toContain(tr('list.selected_count', { count: 3 }));
    expect(html).not.toContain('role="toolbar"');
  });
});

// J6-38 / J4-41: while messages are ticked the reading pane is the selection's summary, never the open message's toolbar.
const mail = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  from_address: `${id}@example.com`,
  from_name: `Sender ${id}`,
  to_address: 'me@example.com',
  subject: `Subject ${id}`,
  snippet: '',
  folder: 'inbox',
  labels: null,
  is_read: 1,
  is_starred: 0,
  has_attachments: 0,
  size: 100,
  created_at: 0,
  updated_at: 0,
  ...over
});
type SummaryProps = ComponentProps<typeof SelectionSummary>;
const summary = (props: Partial<SummaryProps> = {}): string =>
  renderToStaticMarkup(
    createElement(SelectionSummary, {
      rows: ['a', 'b', 'c'].map((id) => mail(id)),
      folder: 'inbox',
      anyUnread: true,
      anyUnstarred: true,
      labels: ['Work'],
      actions: base.actions,
      onClear: noop,
      ...props
    })
  );
const words = (html: string): string[] => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replaceAll(/<[^>]+>/g, ''));

describe('the selection summary in the reading pane', () => {
  it('names the pane with N selected, lists the first ticked senders and subjects, and counts the rest', () => {
    const html = summary({ rows: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => mail(id)) });
    expect(html).toContain(`id="${SELECTION_SUMMARY_TITLE_ID}"`);
    expect(html).toContain(tr('list.selected_count', { count: 6 }));
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(html, id).toContain(`Subject ${id}`);
    }
    expect(html).not.toContain('Subject e');
    expect(html).toContain(tr('list.summary_more', { count: 2 }));
  });

  it('offers the bar actions as labelled buttons in one group, and Clear selection', () => {
    const html = summary();
    expect(html).toContain(`role="group" aria-label="${tr('list.selection_actions')}"`);
    const names = words(html);
    for (const name of [
      tr('action.archive'),
      tr('action.move_to_trash'),
      tr('action.snooze'),
      tr('action.mark_read'),
      tr('action.star'),
      tr('action.move_to_folder'),
      tr('reader.add_label'),
      tr('list.clear_selection')
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it('in Trash: Move to Inbox and Delete forever, no Snooze, no labels; Mark as unread and Unstar when nothing is unread or unstarred', () => {
    const names = words(summary({ folder: 'trash', anyUnread: false, anyUnstarred: false }));
    expect(names).toContain(tr('action.move_to_inbox'));
    expect(names).toContain(tr('action.delete_forever'));
    expect(names).toContain(tr('action.mark_unread'));
    expect(names).toContain(tr('action.unstar'));
    for (const gone of [tr('action.archive'), tr('action.snooze'), tr('reader.add_label')]) {
      expect(names, gone).not.toContain(gone);
    }
  });
});

const selectAllLine = (props: Partial<ComponentProps<typeof SelectAllLine>>): string =>
  renderToStaticMarkup(createElement(SelectAllLine, { phase: 'offer', count: 50, folder: 'Inbox', onSelectAll: noop, ...props }));

describe('Select all in the folder (J6-39)', () => {
  const line = selectAllLine;

  it('says the page is ticked and offers the folder (or the results of a search)', () => {
    expect(line({})).toContain(tr('list.page_all_selected', { count: 50 }));
    expect(line({})).toContain(tr('list.select_all_in', { folder: 'Inbox' }));
    expect(line({ folder: null })).toContain(tr('list.select_all_results'));
  });

  it('says what is ticked once done: every one, or the most recent up to the cap', () => {
    expect(line({ phase: 'all', count: 90 })).toContain(tr('list.all_in_selected', { count: 90, folder: 'Inbox' }));
    expect(line({ phase: 'all', count: 90 })).toContain('All 90 messages in Inbox are selected.');
    expect(line({ phase: 'all', count: 12, folder: null })).toContain(tr('list.all_results_selected', { count: 12 }));
    expect(line({ phase: 'capped', count: 500 })).toContain(tr('list.all_selected_capped', { count: 500 }));
    expect(line({ phase: 'capped', count: 500 })).not.toContain('<button');
    // With a way out given, the done line offers Clear selection in place (and no Select all any more).
    const done = line({ phase: 'all', onClear: noop });
    expect(done).toContain(tr('list.clear_selection'));
    expect(done).not.toContain(tr('list.select_all_in', { folder: 'Inbox' }));
  });
});
