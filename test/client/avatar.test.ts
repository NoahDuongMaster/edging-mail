import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageList } from '../../src/client/components/MessageList';
import { MessageView } from '../../src/client/components/MessageView';
import { sessionKey, type Session } from '../../src/client/lib/auth';
import { avatarUrl, ownPicture, senderPicture } from '../../src/client/lib/avatar';
import { getTokens } from '../../src/client/theme';
import { Avatar, pictureState } from '../../src/client/ui/Avatar';
import type { Message } from '../../src/client/types';

// Profile pictures on the screens that show them: the Avatar with a picture (markup, and what it does when the picture fails), the message
// rows and the reader header that show a sender's picture, and the folders that keep the initials.

const ID = '0b9a3d2e-5c61-4f0e-9d73-2c1f6a8e7b45';
const URL_OF = `/api/avatars/${ID}`;
const noop = (): void => undefined;

const mail = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  from_address: 'dana@example.com',
  from_name: 'Dana Whitfield',
  to_address: 'me@example.com',
  subject: 'Quarterly plan',
  snippet: 'Meet at the harbour on Friday',
  body_text: 'Hello.',
  folder: 'inbox',
  labels: null,
  is_read: 1,
  is_starred: 0,
  has_attachments: 0,
  size: 100,
  created_at: Date.UTC(2026, 10, 8, 9, 30),
  updated_at: Date.UTC(2026, 10, 8, 9, 30),
  mail_state: 'ready',
  ...over
});

/** The <img> of a picture, whole, or '' when there is none. */
const imgOf = (html: string): string => /<img\b[^>]*>/.exec(html)?.[0] ?? '';

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
const renderList = (props: Partial<ListProps>): string => renderToStaticMarkup(h(MessageList, { ...base, ...props }));

const renderReader = (open: Message, compact = false): string =>
  renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client: new QueryClient() },
      h(MessageView, {
        t: getTokens(false),
        message: open,
        attachments: [],
        isLoading: false,
        labels: [],
        onReply: noop,
        onReplyAll: noop,
        onForward: noop,
        onToggleStar: noop,
        onArchive: noop,
        onTrash: noop,
        onSpam: noop,
        onRestore: noop,
        onNotSpam: noop,
        onDeleteForever: noop,
        onMarkUnread: noop,
        onSnooze: noop,
        onUnsnooze: noop,
        onToggleLabel: noop,
        onPrev: noop,
        onNext: noop,
        hasPrev: false,
        hasNext: false,
        position: '1 of 1',
        compact,
        listEmpty: false,
        loadFailed: false,
        onRetry: noop,
        onBack: compact ? noop : undefined
      })
    )
  );
const stampOf = (html: string): string => /<span class="ui-avatar rd-stamp-tile"[^>]*>[\s\S]*?<\/span>/.exec(html)?.[0] ?? '';

const renderAvatar = (props: ComponentProps<typeof Avatar>): string => renderToStaticMarkup(h(Avatar, props));

describe('Avatar with a picture', () => {
  it('draws no picture without `src` (or with an empty one): the markup of every existing tile is unchanged', () => {
    expect(renderAvatar({ name: 'Ana Lima' })).toBe('<span class="ui-avatar" data-size="md" aria-hidden="true">AL</span>');
    expect(renderAvatar({ name: 'Ana Lima', src: '' })).toBe('<span class="ui-avatar" data-size="md" aria-hidden="true">AL</span>');
  });

  it('puts the picture over the initials: aria-hidden stays on the tile, the picture has no alt text, it loads lazily and cannot be dragged', () => {
    const html = renderAvatar({ name: 'Ana Lima', src: URL_OF });
    expect(html).toMatch(/^<span class="ui-avatar" data-size="md" data-image="loading" aria-hidden="true">AL<img /);
    const img = imgOf(html);
    expect(img).toContain('class="ui-avatar-img"');
    expect(img).toContain(`src="${URL_OF}"`);
    expect(img).toContain('alt=""');
    expect(img).toContain('loading="lazy"');
    expect(img).toContain('decoding="async"');
    expect(img).toContain('draggable="false"');
  });

  it('keeps size, hue, selected and the stamp shape beside the picture (the picture is the printed field of a stamp)', () => {
    const stamp = renderAvatar({ name: 'Ana Lima', src: URL_OF, shape: 'stamp', size: 40, hue: 'var(--label-1)', className: 'ml-avatar' });
    expect(stamp).toContain('class="ui-avatar ml-avatar"');
    expect(stamp).toContain('data-shape="stamp"');
    expect(stamp).toContain('data-hue="true"');
    expect(stamp).toContain('data-size="custom"');
    expect(stamp).toMatch(/style="--ui-hue:var\(--label-1\);--ui-avatar-size:40px;font-size:14px"/);
    expect(stamp).toContain('data-image="loading"');
    expect(imgOf(stamp)).toContain(`src="${URL_OF}"`);
    const own = renderAvatar({ name: 'Ana Lima', src: URL_OF, size: 'xl', selected: true });
    expect(own).toContain('data-size="xl"');
    expect(own).toContain('data-selected="true"');
  });

  it('says what it has learned about ONE address: loaded shows it, failed leaves only the initials (and is not asked again), another address starts over', () => {
    expect(pictureState(URL_OF, null)).toEqual({ picture: URL_OF, status: undefined });
    expect(pictureState(URL_OF, { src: URL_OF, status: 'loaded' })).toEqual({ picture: URL_OF, status: 'loaded' });
    expect(pictureState(URL_OF, { src: URL_OF, status: 'failed' })).toEqual({ picture: undefined, status: 'failed' });
    const other = '/api/avatars/other';
    expect(pictureState(other, { src: URL_OF, status: 'failed' })).toEqual({ picture: other, status: undefined });
    expect(pictureState(undefined, { src: URL_OF, status: 'loaded' })).toEqual({ picture: undefined, status: undefined });
    expect(pictureState('', null)).toEqual({ picture: undefined, status: undefined });
  });
});

describe('where a picture is shown', () => {
  it('builds the address from the id and nothing else', () => {
    expect(avatarUrl(ID)).toBe(URL_OF);
    expect(senderPicture({ from_avatar: ID, folder: 'inbox' })).toBe(URL_OF);
    expect(ownPicture({ avatar: ID })).toBe(URL_OF);
  });

  it('shows none for no id (null, absent or empty), and none in Sent and Drafts (the initials stay there)', () => {
    expect(senderPicture({ from_avatar: null, folder: 'inbox' })).toBeUndefined();
    expect(senderPicture({ folder: 'inbox' })).toBeUndefined();
    expect(senderPicture({ from_avatar: '', folder: 'inbox' })).toBeUndefined();
    expect(senderPicture({ from_avatar: ID, folder: 'sent' })).toBeUndefined();
    expect(senderPicture({ from_avatar: ID, folder: 'drafts' })).toBeUndefined();
    for (const folder of ['inbox', 'archive', 'trash', 'spam', 'starred', 'snoozed'] as const) {
      expect(senderPicture({ from_avatar: ID, folder }), folder).toBe(URL_OF);
    }
    expect(ownPicture(new QueryClient().getQueryData<Session>(sessionKey)?.user)).toBeUndefined();
    expect(ownPicture({ avatar: null })).toBeUndefined();
  });

  describe('the message list', () => {
    it('draws the sender picture inside the stamp over the initials when the row has from_avatar', () => {
      const html = renderList({ messages: [mail({ from_avatar: ID })] });
      expect(html).toMatch(
        /<span class="ui-avatar ml-avatar" data-size="md" data-shape="stamp" data-hue="true"[^>]*data-image="loading"[^>]*aria-hidden="true">DW<img /
      );
      expect(imgOf(html)).toContain(`src="${URL_OF}"`);
    });

    it('keeps the initials alone for a row without from_avatar (null or absent): the markup of today', () => {
      for (const over of [{ from_avatar: null }, {}]) {
        const html = renderList({ messages: [mail(over)] });
        expect(html).not.toContain('<img');
        expect(html).not.toContain('data-image');
        expect(html).toMatch(/<span class="ui-avatar ml-avatar"[^>]*>DW<\/span>/);
      }
    });

    it('keeps the initials in Sent and in Drafts even when the row carries an id', () => {
      expect(renderList({ folder: 'sent', title: 'Sent', messages: [mail({ folder: 'sent', from_avatar: ID })] })).not.toContain('<img');
      const drafts = renderList({
        folder: 'drafts',
        isDrafts: true,
        title: 'Drafts',
        messages: [mail({ folder: 'drafts', from_avatar: ID })]
      });
      expect(drafts).not.toContain('<img');
      // The draft's tile is the recipient's.
      expect(drafts).toMatch(/<span class="ui-avatar ml-avatar"[^>]*>M<\/span>/);
    });

    it("gives each row its own picture in All mail and search results (the folder is the row's own)", () => {
      const html = renderList({
        folder: 'all',
        messages: [
          mail({ id: 'a', from_avatar: ID }),
          mail({ id: 'b', folder: 'sent', from_avatar: ID }),
          mail({ id: 'c', from_avatar: null })
        ]
      });
      expect(html.match(/<img\b/g)).toHaveLength(1);
    });

    it('works on the phone board and in the compact density, and a phone selection turns the avatar into the tick (no picture)', () => {
      const phone = renderList({ compact: true, messages: [mail({ from_avatar: ID })] });
      expect(phone).toContain('data-size="lg"');
      expect(imgOf(phone)).toContain(`src="${URL_OF}"`);
      const selecting = renderList({
        compact: true,
        messages: [mail({ from_avatar: ID })],
        onSelectionChange: noop,
        selection: new Set(['m1'])
      });
      expect(selecting).toContain('ml-pick');
      expect(selecting).not.toContain('<img');
    });
  });

  describe('the reader header', () => {
    it('puts the sender picture in the 56 px stamp (40 px on a phone) when the message carries from_avatar', () => {
      const desktop = stampOf(renderReader(mail({ from_avatar: ID })));
      expect(desktop).toContain('data-size="xl"');
      expect(desktop).toContain('data-shape="stamp"');
      expect(imgOf(desktop)).toContain(`src="${URL_OF}"`);
      const phone = stampOf(renderReader(mail({ from_avatar: ID }), true));
      expect(phone).toContain('data-size="custom"');
      expect(imgOf(phone)).toContain(`src="${URL_OF}"`);
    });

    it('keeps the initials when there is no from_avatar, and in Sent', () => {
      expect(stampOf(renderReader(mail()))).not.toContain('<img');
      expect(stampOf(renderReader(mail({ from_avatar: null })))).toMatch(/>DW<\/span>$/);
      expect(stampOf(renderReader(mail({ folder: 'sent', from_avatar: ID })))).not.toContain('<img');
    });
  });
});
