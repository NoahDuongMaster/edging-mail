import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import { MessageView } from '../../src/client/components/MessageView';
import { SpamBanner } from '../../src/client/components/reader/SpamBanner';
import { getTokens } from '../../src/client/theme';
import type { Message } from '../../src/client/types';

// The banner above a message in the Spam folder, as the HTML it renders: why the message is there (the reasons, at most three, "See all reasons"
// only when there are more), and Not spam, the one way back. Clicks, the opened disclosure and the Undo of Not spam need a real browser.

const noop = (): void => undefined;

const banner = (message: Pick<Message, 'spam_reasons' | 'spam_score'>): string =>
  renderToStaticMarkup(createElement(SpamBanner, { message, onNotSpam: noop }));
const ids = (...list: string[]): string => JSON.stringify(list);

/** The items of every list of the banner, in order (the folded panel's too). */
const items = (html: string): string[] => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((match) => match[1].replaceAll('&#x27;', "'"));

describe('the Spam banner', () => {
  it('names the reasons in a short plain list under "Why is this in Spam?", with a primary Not spam button', () => {
    const html = banner({ spam_reasons: ids('spam_phrases', 'auth_failed'), spam_score: 8 });
    expect(html).toContain('class="ui-banner rd-spam"');
    expect(html).toContain(`<p class="ui-banner-title">${en['spam.why_title']}</p>`);
    expect(items(html)).toEqual([en['spam.reason.spam_phrases'], en['spam.reason.auth_failed']]);
    expect(html).toMatch(/<button[^>]*data-variant="primary"[^>]*>(<svg[^>]*>.*?<\/svg>)?Not spam<\/button>/);
    // Up to three reasons there is nothing more to open.
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain(en['spam.see_all']);
  });

  it('shows three reasons and folds the rest behind a "See all reasons" disclosure that names the region it opens', () => {
    const html = banner({ spam_reasons: ids('block_listed', 'auth_failed', 'spam_phrases', 'many_links', 'image_only'), spam_score: 12 });
    const [shown, rest = ''] = html.split(/<div id="[^"]*" class="ui-collapse"/);
    expect(items(shown)).toEqual([en['spam.reason.block_listed'], en['spam.reason.auth_failed'], en['spam.reason.spam_phrases']]);
    expect(items(rest)).toEqual([en['spam.reason.many_links'], en['spam.reason.image_only']]);
    const trigger = /<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>/.exec(html);
    expect(trigger).not.toBeNull();
    expect(html).toContain(`id="${trigger?.[1] ?? ''}"`);
    expect(html).toContain(en['spam.see_all']);
    expect(html).not.toContain(en['spam.see_fewer']);
  });

  it('says an id it does not know as one general sentence, however many unknown ids there are', () => {
    const html = banner({ spam_reasons: ids('from_the_future', 'another_new_one'), spam_score: 5 });
    expect(items(html)).toEqual([en['spam.reason.other']]);
  });

  it('says the general sentence when the reasons are malformed but the filter scored the message', () => {
    for (const spam_reasons of ['not json', '{"a":1}', '[]', null]) {
      const html = banner({ spam_reasons, spam_score: 7 });
      expect(items(html), String(spam_reasons)).toEqual([en['spam.reason.other']]);
      expect(html).toContain(en['spam.why_title']);
    }
  });

  it('is one quiet line with the same button when no reason was recorded (the person moved it there, or it is older than the filter)', () => {
    const none: Pick<Message, 'spam_reasons' | 'spam_score'>[] = [
      {},
      { spam_reasons: null, spam_score: null },
      { spam_reasons: '[]', spam_score: null },
      { spam_reasons: 'broken', spam_score: null }
    ];
    for (const message of none) {
      const html = banner(message);
      expect(html, JSON.stringify(message)).toContain(en['spam.moved_by_you']);
      expect(html).not.toContain('<ul');
      expect(html).not.toContain(en['spam.why_title']);
      expect(html).toContain('Not spam');
    }
  });

  it('is read in its place with its letter: not a live region, and an odd column never turns it into an error', () => {
    for (const html of [banner({ spam_reasons: ids('no_date'), spam_score: 1 }), banner({})]) {
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain('role="status"');
      expect(html).not.toContain('data-tone="danger"');
    }
  });
});

const t = getTokens(false);
const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  from_address: 'promo@example.net',
  from_name: 'Great Deals',
  to_address: 'me@example.com',
  subject: 'You won',
  body_text: 'Click here.',
  folder: 'spam',
  is_read: 0,
  is_starred: 0,
  has_attachments: 0,
  size: 900,
  created_at: Date.UTC(2026, 10, 8, 9, 30),
  updated_at: Date.UTC(2026, 10, 8, 9, 30),
  mail_state: 'ready',
  ...over
});

function reader(open: Message): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MessageView, {
        t,
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
        position: '1 of 1'
      })
    )
  );
}

describe('the reader of a message in Spam', () => {
  it('has the banner above the letter, between the header and the text, exactly once', () => {
    const html = reader(message({ spam_reasons: ids('link_text_mismatch', 'phishing_phrases'), spam_score: 11 }));
    expect(html.match(/class="ui-banner rd-spam"/g)).toHaveLength(1);
    expect(html.indexOf('</header>')).toBeLessThan(html.indexOf('rd-spam'));
    expect(html.indexOf('rd-spam')).toBeLessThan(html.indexOf('class="rd-text"'));
    expect(html).toContain(en['spam.reason.link_text_mismatch']);
    expect(html).toContain(en['spam.reason.phishing_phrases']);
  });

  it('has Not spam in the banner and the toolbar, never a plain Move to Inbox, and no older "In Spam" notice', () => {
    const html = reader(message());
    expect(html).not.toContain(`aria-label="${en['action.move_to_inbox']}"`);
    expect(html).not.toContain(`>${en['action.move_to_inbox']}<`);
    expect(html.match(/Not spam/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain(en['spam.moved_by_you']);
  });

  it('has no banner in any other folder, and Trash keeps its plain Move to Inbox', () => {
    for (const folder of ['inbox', 'trash', 'archive', 'sent', 'drafts', 'snoozed'] as const) {
      const html = reader(message({ folder, spam_reasons: ids('spam_phrases'), spam_score: 9 }));
      expect(html, folder).not.toContain('rd-spam');
      expect(html, folder).not.toContain(en['spam.why_title']);
      expect(html, folder).not.toContain('Not spam');
    }
    expect(reader(message({ folder: 'trash' }))).toContain(`aria-label="${en['action.move_to_inbox']}"`);
  });
});
