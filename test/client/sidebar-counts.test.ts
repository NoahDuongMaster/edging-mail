import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar } from '../../src/client/components/Sidebar';
import { folderName } from '../../src/client/lib/mail';
import { getTokens } from '../../src/client/theme';
import type { FolderStats } from '../../src/client/types';

// The numbers beside the folders in the rail: the Inbox says how much is unread, every other folder how many messages it holds.

const noop = (): void => {
  // a callback the test does not look at
};

const stat = (total: number, unread: number) => ({ total, unread });
const stats: FolderStats = {
  inbox: stat(40, 3),
  starred: stat(5, 1),
  snoozed: stat(2, 0),
  sent: stat(128, 0),
  drafts: stat(4, 0),
  archive: stat(1234, 0),
  spam: stat(21, 21),
  trash: stat(7, 0)
};

const render = (value: FolderStats): string =>
  renderToStaticMarkup(
    createElement(Sidebar, { t: getTokens(false), folder: 'inbox', onSelectFolder: noop, stats: value, labels: [], onCompose: noop })
  );

/** The count shown inside the button of a folder ('' when there is none): its text after the folder's name, and whether it is the unread one. */
function countOf(html: string, id: string): { text: string; unread: boolean } | null {
  const button = html.split('<button').find((part) => part.includes(`>${folderName(id)}</span>`));
  const match =
    /class="ui-odometer[^"]*(mb-nav-count[^"]*)"[^>]*>(.*?)<\/span>/.exec(button ?? '') ??
    /class="([^"]*mb-nav-count[^"]*)"[^>]*>(.*?)<\/span>/.exec(button ?? '');
  return match === null ? null : { text: match[2].replaceAll(/<[^>]*>/g, ''), unread: match[1].includes('mb-nav-count-unread') };
}

describe('the counts of the folders in the rail', () => {
  it('shows the Inbox its unread mail, in the unread weight', () => {
    expect(countOf(render(stats), 'inbox')).toEqual({ text: '3', unread: true });
  });

  it('shows every other folder how many messages it holds, quietly: Sent, Starred, Archive, Spam and Trash too, not only the mail that is unread', () => {
    const html = render(stats);
    const shown = Object.fromEntries(
      ['starred', 'snoozed', 'sent', 'drafts', 'archive', 'spam', 'trash'].map((id) => [id, countOf(html, id)])
    );
    expect(shown).toEqual({
      starred: { text: '5', unread: false },
      snoozed: { text: '2', unread: false },
      sent: { text: '128', unread: false },
      drafts: { text: '4', unread: false },
      archive: { text: '1,234', unread: false },
      spam: { text: '21', unread: false },
      trash: { text: '7', unread: false }
    });
  });

  it('draws nothing for a folder that is empty, and for an Inbox with nothing unread', () => {
    const empty = Object.fromEntries(Object.keys(stats).map((id) => [id, stat(0, 0)]));
    const html = render({ ...empty, inbox: stat(40, 0) });
    for (const id of Object.keys(stats)) {
      expect(countOf(html, id), id).toBeNull();
    }
  });
});
