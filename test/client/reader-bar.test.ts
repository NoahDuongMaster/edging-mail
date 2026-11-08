import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import { MessageView } from '../../src/client/components/MessageView';
import { getTokens } from '../../src/client/theme';
import type { Attachment, Message } from '../../src/client/types';

// The reader toolbar, as the HTML it renders: which buttons each folder has, in which order, and what they are called. This is the part of the reader
// that was settled in the browser (Trash and Spam have Move to Inbox and Delete forever and no Snooze, so the toolbar stays at the 8 buttons the width
// arithmetic of reader/barDensity.ts allows; a phone has 7), so a restyle must not change it.

const t = getTokens(false);
const noop = (): void => undefined;

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  from_address: 'alice@example.com',
  from_name: 'Alice Admin',
  to_address: 'me@example.com',
  subject: 'Quarterly numbers',
  body_text: 'Hello there.\n\nSecond paragraph.',
  folder: 'inbox',
  is_read: 1,
  is_starred: 0,
  has_attachments: 0,
  size: 1200,
  created_at: Date.UTC(2026, 10, 8, 9, 30),
  updated_at: Date.UTC(2026, 10, 8, 9, 30),
  mail_state: 'ready',
  ...over
});

const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  message_id: 'm1',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size: 2048,
  r2_key: 'k',
  is_inline: 0,
  created_at: 0,
  ...over
});

function render(
  open: Message | null,
  props: { attachments?: Attachment[]; compact?: boolean; isLoading?: boolean; listEmpty?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MessageView, {
        t,
        message: open,
        attachments: props.attachments ?? [],
        isLoading: props.isLoading ?? false,
        labels: ['Work', 'Home'],
        onReply: noop,
        onReplyAll: noop,
        onForward: noop,
        onToggleStar: noop,
        onArchive: noop,
        onTrash: noop,
        onSpam: noop,
        onRestore: noop,
        onDeleteForever: noop,
        onMarkUnread: noop,
        onSnooze: noop,
        onUnsnooze: noop,
        onToggleLabel: noop,
        onPrev: noop,
        onNext: noop,
        hasPrev: true,
        hasNext: true,
        position: '1 of 7',
        compact: props.compact ?? false,
        listEmpty: props.listEmpty ?? false,
        onBack: props.compact === true ? noop : undefined
      })
    )
  );
}

/** The accessible names of the buttons of the toolbar, left to right. */
function toolbar(html: string): string[] {
  const start = html.indexOf('class="rd-bar');
  const end = html.indexOf('class="rd-scroll"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...html.slice(start, end).matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
}

const ARCHIVE = en['action.archive'];
const SPAM = en['action.move_to_spam'];
const TRASH = en['action.move_to_trash'];
const INBOX = en['action.move_to_inbox'];
const DELETE = en['action.delete_forever'];
const UNREAD = en['action.mark_unread'];
const SNOOZE = en['action.snooze'];
const LABEL = en['reader.add_label'];
const NEWER = en['reader.newer_message'];
const OLDER = en['reader.older_message'];
const BACK = en['reader.back_to_list'];

describe('the desktop toolbar', () => {
  it('has 8 buttons in the Inbox, and each folder hides only its own move button', () => {
    expect(toolbar(render(message()))).toEqual([ARCHIVE, SPAM, TRASH, UNREAD, SNOOZE, LABEL, NEWER, OLDER]);
  });

  it('has Move to Inbox and Delete forever in Trash, and no Snooze: still 8 buttons', () => {
    expect(toolbar(render(message({ folder: 'trash' })))).toEqual([ARCHIVE, SPAM, INBOX, DELETE, UNREAD, LABEL, NEWER, OLDER]);
  });

  it('has them in Spam too, without the Spam button', () => {
    expect(toolbar(render(message({ folder: 'spam' })))).toEqual([ARCHIVE, TRASH, INBOX, DELETE, UNREAD, LABEL, NEWER, OLDER]);
  });

  it('has no Snooze for a draft or sent mail', () => {
    expect(toolbar(render(message({ folder: 'drafts' })))).toEqual([ARCHIVE, SPAM, TRASH, UNREAD, LABEL, NEWER, OLDER]);
    expect(toolbar(render(message({ folder: 'sent' })))).not.toContain(SNOOZE);
  });

  it('says where the message is among the others', () => {
    expect(render(message())).toContain('<span class="rd-count">1 of 7</span>');
  });

  it('is one plain row of buttons: the divider, the label menu and the counter are not extra buttons', () => {
    const html = render(message());
    expect(html).toContain('class="rd-bar nm-bar-d"');
    expect(html).toContain('data-density="full"');
    expect(html).toContain('role="separator"');
  });
});

describe('the phone toolbar', () => {
  it('has 7 buttons in the Inbox: back, three moves, and Mark as unread, Snooze, Label; no counter and no Newer / Older', () => {
    const html = render(message(), { compact: true });
    expect(toolbar(html)).toEqual([BACK, ARCHIVE, SPAM, TRASH, UNREAD, SNOOZE, LABEL]);
    expect(html).toContain('class="rd-bar nm-bar"');
    expect(html).toContain('data-density="phone"');
    expect(html).toContain('nm-bar-sep');
    expect(html).not.toContain('rd-count');
  });

  it('has 7 buttons in Trash as well: Snooze is the one that goes', () => {
    expect(toolbar(render(message({ folder: 'trash' }), { compact: true }))).toEqual([BACK, ARCHIVE, SPAM, INBOX, DELETE, UNREAD, LABEL]);
  });
});

describe('the rest of the reader', () => {
  it('shows the subject as the heading the article is named by, and the sender with the address beside the name', () => {
    const html = render(message());
    expect(html).toContain('<article aria-labelledby="msg-subject"');
    expect(html).toMatch(/<h2 id="msg-subject" class="rd-subject">Quarterly numbers<\/h2>/);
    expect(html).toContain('Alice Admin');
    expect(html).toContain('alice@example.com');
  });

  it('puts an attachment name only through safeFileName: a direction override is gone, a plain file is a link that saves under that name', () => {
    const html = render(message({ has_attachments: 1 }), { attachments: [attachment({ filename: 'photo\u202Egpj.exe' })] });
    expect(html).not.toContain('\u202E');
    expect(html).toContain('photogpj.exe');
    expect(html).toContain('href="/api/attachments/a1"');
    expect(html).toContain('download="photogpj.exe"');
    expect(html).toContain('aria-label="Download photogpj.exe"');
  });

  it('opens an encrypted attachment with a button, not a link (a link would save the encrypted bytes)', () => {
    const html = render(message({ enc_fmt: 1, has_attachments: 1 }), { attachments: [attachment()] });
    expect(html).not.toContain('/api/attachments/');
    expect(html).toContain('aria-label="Download report.pdf"');
  });

  it('says why a locked message is not shown, and offers neither Forward nor the sealed badge', () => {
    const html = render(message({ mail_state: 'locked', is_e2e: 1, body_text: null }));
    expect(html).toContain('data-mail-state="locked"');
    expect(html).toContain(en['mailcrypto.note_locked']);
    expect(html).not.toContain('data-e2e-badge');
    expect(html).not.toContain(`>${en['action.forward']}<`);
  });

  it('shows the sealed badge only for a sealed message that was opened, and the unverified chip only for mail from outside that claims a hosted address', () => {
    expect(render(message({ is_e2e: 1 }))).toContain('data-e2e-badge');
    expect(render(message())).not.toContain('data-e2e-badge');
    // The badge's button names its note with aria-controls, and the note is there while it is closed (hidden), so the reference never dangles.
    const sealed = render(message({ is_e2e: 1 }));
    expect(sealed).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="e2e-badge-note"/);
    expect(sealed).toMatch(/<p id="e2e-badge-note" class="rd-e2e-note" hidden="">/);
    expect(render(message({ origin: 'smtp', from_hosted: true }))).toContain('data-unverified-sender');
    expect(render(message({ origin: 'internal', from_hosted: true }))).not.toContain('data-unverified-sender');
  });

  it('has Reply, Reply all and Forward under the message', () => {
    const html = render(message());
    for (const label of [en['action.reply'], en['action.reply_all'], en['action.forward']]) {
      expect(html).toContain(`>${label}</button>`);
    }
  });

  it('draws the reply row in its full size until the row is measured (reader/barDensity.ts replyDensity picks a smaller one), and on a phone', () => {
    for (const compact of [false, true]) {
      const html = render(message(), { compact });
      const row = html.slice(html.indexOf('class="rd-reply"'), html.indexOf('</div>', html.indexOf('class="rd-reply"')));
      const buttons = [...row.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
      expect(buttons, String(compact)).toHaveLength(3);
      for (const button of buttons) {
        expect(button).toContain('data-size="md"');
      }
      // Each with its icon.
      expect(row.match(/<svg/g), String(compact)).toHaveLength(3);
    }
  });

  it('offers Download original message as a quiet ghost button with its icon (it fetches and opens the message: a button, not a link)', () => {
    const html = render(message({ r2_key: 'raw/m1' }));
    const start = html.indexOf('class="ui-btn rd-raw"');
    expect(start).toBeGreaterThan(-1);
    const button = html.slice(html.lastIndexOf('<button', start), html.indexOf('</button>', start));
    expect(button).toContain('data-variant="ghost"');
    expect(button).toContain('data-size="sm"');
    expect(button).toContain('<svg');
    expect(button).toContain(en['mailcrypto.download_raw']);
    expect(html).not.toContain('rd-link');
  });

  it('says it is loading, and what to do when nothing is selected', () => {
    expect(render(null, { isLoading: true })).toContain(en['reader.loading_message']);
    expect(render(null)).toContain(en['reader.none_selected']);
    expect(render(null)).toContain('/edgar.svg');
  });

  it('only names itself, quietly, when the list beside it is empty: no second Edgar, no pointer at a list with nothing to choose', () => {
    const html = render(null, { listEmpty: true });
    expect(html).toContain('data-state="empty"');
    expect(html).toContain('class="ui-empty rd-idle"');
    expect(html).toContain(en['reader.none_selected']);
    expect(html).not.toContain(en['reader.none_selected_hint']);
    expect(html).not.toContain('/edgar.svg');
    // An open message is shown whatever the list holds (a notification link opens one that is not in it).
    expect(render(message(), { listEmpty: true })).toContain('Quarterly numbers');
  });

  it('opens the recipients line in place (a ui Disclosure) and shows the labels of the message as ui Chips in their hue', () => {
    const html = render(message({ cc: 'bob@example.com', labels: JSON.stringify(['Work']) }));
    expect(html).toContain('<button type="button" class="ui-disclosure rd-rcpt" data-look="text" aria-expanded="false">');
    expect(html).toMatch(/<span class="ui-chip" data-kind="label" style="[^"]*">.*?<span class="ui-chip-text">Work<\/span>/);
  });

  it('shows one recipient as plain text: nothing is hidden, so there is nothing to open (until a measure finds the line cut)', () => {
    const html = render(message());
    expect(html).toContain(
      `<p class="rd-rcpt"><span class="rd-rcpt-text">${en['reader.to_line'].replace('{to}', 'me@example.com')}</span></p>`
    );
    expect(html).not.toContain('ui-disclosure rd-rcpt');
    // Two recipients in the To line count as more than one, as a Cc does.
    expect(render(message({ to_address: 'me@example.com, ann@example.com' }))).toContain('ui-disclosure rd-rcpt');
  });
});
