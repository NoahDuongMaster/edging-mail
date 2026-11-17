import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import { MessageView } from '../../src/client/components/MessageView';
import { phoneBar } from '../../src/client/components/reader/actions';
import { getTokens } from '../../src/client/theme';
import type { Attachment, Message } from '../../src/client/types';

// The reader toolbars, as the HTML they render: which buttons each folder has, in which order, and what they are called. This is the part of the
// reader that was settled in the browser (Trash and Spam have Move to Inbox and Delete forever and no Snooze, so the desktop toolbar stays at the 8
// buttons the width arithmetic of reader/barDensity.ts allows; on a phone no action is lost: Back and Newer / Older on top, five buttons at the
// bottom and the rest in More), so a restyle must not change it. Every toolbar is one ARIA toolbar (one Tab stop) with a name.

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
  props: {
    attachments?: Attachment[];
    compact?: boolean;
    isLoading?: boolean;
    listEmpty?: boolean;
    loadFailed?: boolean;
    self?: string;
  } = {}
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
        onNotSpam: noop,
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
        loadFailed: props.loadFailed ?? false,
        onRetry: noop,
        selfAddress: props.self,
        onBack: props.compact === true ? noop : undefined
      })
    )
  );
}

/** Each toolbar of the reader, in page order: its own name, and the accessible names of its buttons, left to right. */
function toolbars(html: string): { name: string; buttons: string[] }[] {
  return html
    .split('role="toolbar"')
    .slice(1)
    .map((part) => {
      const ends = ['class="rd-scroll"', '</article>'].map((mark) => part.indexOf(mark)).filter((index) => index !== -1);
      const names = [...part.slice(0, Math.min(...ends)).matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
      return { name: names[0], buttons: names.slice(1) };
    });
}

/** The buttons of the desktop action toolbar (the only toolbar on a desktop). */
function toolbar(html: string): string[] {
  const bars = toolbars(html);
  expect(bars).toHaveLength(1);
  expect(bars[0].name).toBe(en['reader.actions_label']);
  return bars[0].buttons;
}

const ARCHIVE = en['action.archive'];
const SPAM = en['action.move_to_spam'];
const TRASH = en['action.move_to_trash'];
const INBOX = en['action.move_to_inbox'];
const NOT_SPAM = en['action.not_spam'];
const DELETE = en['action.delete_forever'];
const UNREAD = en['action.mark_unread'];
const SNOOZE = en['action.snooze'];
const LABEL = en['reader.labels'];
const NEWER = en['reader.newer_message'];
const OLDER = en['reader.older_message'];
const BACK = en['reader.back_to_list'];
const REPLY = en['action.reply'];
const MORE = en['reader.more_actions'];
const STAR = en['action.star'];

/** The counter of a toolbar ("1 of 7"): its number is a ui Odometer (one hidden text node; the drawn digits are aria-hidden), the words plain. */
const count = (className: string, number: string, rest: string): RegExp =>
  new RegExp(
    `<span class="${className}"><span class="ui-odo"><span class="ui-visually-hidden">${number}</span><span class="ui-odo-face" aria-hidden="true">.*?</span></span>${rest}</span>`
  );

/** The tools of the reader's header (Reply, its menu, Star). */
const tools = (html: string): string => html.slice(html.indexOf('class="rd-tools"'), html.indexOf('</header>'));

describe('the desktop toolbar', () => {
  // Groups: Archive | the moves (the folder's main one first, Delete forever, the other bin) | Mark as unread, Snooze, Label | the counter, Newer, Older.
  it('has 8 buttons in the Inbox, and each folder hides only its own move button', () => {
    expect(toolbar(render(message()))).toEqual([ARCHIVE, TRASH, SPAM, UNREAD, SNOOZE, LABEL, NEWER, OLDER]);
  });

  it('has Move to Inbox first and Delete forever last, in a group of its own, in Trash, and no Snooze: still 8 buttons', () => {
    // J4-03: the way back leads; the one move that cannot be undone stands apart at the end, after a divider.
    expect(toolbar(render(message({ folder: 'trash' })))).toEqual([INBOX, ARCHIVE, SPAM, UNREAD, LABEL, DELETE, NEWER, OLDER]);
    const html = render(message({ folder: 'trash' }));
    const bar = html.slice(html.indexOf('role="toolbar"'), html.indexOf('class="rd-scroll"'));
    expect(bar.lastIndexOf('role="separator"')).toBeLessThan(bar.indexOf(`aria-label="${DELETE}"`));
    expect(bar.match(/role="separator"/g)).toHaveLength(2);
  });

  it('has them in Spam too, without the Spam button; Move to Trash only with its words (J4-32); there Not spam takes the place of Move to Inbox', () => {
    // The server render has no width to measure: no words, so no bare trash can beside the red one of Delete forever. Not spam is the way back
    // (the Inbox, and the sender is allowed): the same place, so the bar is the same 7 buttons; only Trash keeps the plain Move to Inbox.
    expect(toolbar(render(message({ folder: 'spam' })))).toEqual([NOT_SPAM, ARCHIVE, UNREAD, LABEL, DELETE, NEWER, OLDER]);
    expect(toolbar(render(message({ folder: 'spam' })))).not.toContain(INBOX);
    expect(toolbar(render(message({ folder: 'trash' })))).toContain(INBOX);
    expect(toolbar(render(message({ folder: 'trash' })))).not.toContain(NOT_SPAM);
  });

  it('has no Snooze for a draft or sent mail', () => {
    expect(toolbar(render(message({ folder: 'drafts' })))).toEqual([ARCHIVE, TRASH, SPAM, UNREAD, LABEL, NEWER, OLDER]);
    expect(toolbar(render(message({ folder: 'sent' })))).not.toContain(SNOOZE);
  });

  it('opens Snooze and Label as small dialogs (they hold a field), not as ARIA menus', () => {
    const html = render(message());
    const bar = html.slice(html.indexOf('role="toolbar"'), html.indexOf('class="rd-scroll"'));
    expect(bar.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(bar).not.toContain('aria-haspopup="menu"');
  });

  it('says where the message is among the others, its number rolling as an odometer (v3 H2)', () => {
    expect(render(message())).toMatch(count('rd-count', '1', ' of 7'));
  });

  it('is one plain row of buttons (an ARIA toolbar): the dividers, the label button and the counter are not extra buttons', () => {
    const html = render(message());
    expect(html).toContain('class="ui-toolbar rd-bar nm-bar-d"');
    expect(html).toContain('data-density="full"');
    expect(html.match(/role="separator"/g)).toHaveLength(2);
  });
});

describe('the phone toolbars', () => {
  it('has one bar on top (Back, the place in the list, Newer, Older, the star) and Archive, Move to Trash, Reply, Snooze and More in the bottom bar', () => {
    const html = render(message(), { compact: true });
    const [top, bottom] = toolbars(html);
    expect(top).toEqual({ name: en['reader.nav_label'], buttons: [BACK, NEWER, OLDER, STAR] });
    expect(bottom).toEqual({ name: en['reader.actions_label'], buttons: [ARCHIVE, TRASH, REPLY, SNOOZE, MORE] });
    expect(html).toContain('class="ui-toolbar rd-bar nm-bar"');
    expect(html).toContain('data-density="phone"');
    // The app's own bar is gone while a message is open (App.tsx), so the top bar says where the message is; the desktop counter is not there.
    expect(html).toMatch(count('rd-pos', '1', ' of 7'));
    expect(html).not.toContain('rd-count');
    // The bottom bar comes after the message in the page (and in Tab order): within reach of the thumb.
    expect(html.indexOf('class="rd-scroll"')).toBeLessThan(html.indexOf('class="ui-toolbar rd-bar nm-bar"'));
  });

  it('keeps the top bar, and so Back, while the message loads and when it could not be opened', () => {
    for (const html of [render(null, { compact: true, isLoading: true }), render(null, { compact: true, loadFailed: true })]) {
      expect(toolbars(html)[0]).toEqual({ name: en['reader.nav_label'], buttons: [BACK, NEWER, OLDER] });
    }
    expect(render(null, { compact: true, loadFailed: true })).toContain(en['reader.load_failed']);
  });

  it('has Move to Inbox (Not spam in Spam) and Delete forever in Trash and Spam (no Snooze), and Mark as unread where nothing can be snoozed', () => {
    expect(toolbars(render(message({ folder: 'trash' }), { compact: true }))[1].buttons).toEqual([ARCHIVE, INBOX, REPLY, DELETE, MORE]);
    expect(toolbars(render(message({ folder: 'spam' }), { compact: true }))[1].buttons).toEqual([ARCHIVE, NOT_SPAM, REPLY, DELETE, MORE]);
    expect(toolbars(render(message({ folder: 'sent' }), { compact: true }))[1].buttons).toEqual([ARCHIVE, TRASH, REPLY, UNREAD, MORE]);
  });

  it('loses no action of the desktop bar: what the bottom bar does not show is in its More menu', () => {
    for (const folder of ['inbox', 'snoozed', 'archive', 'trash', 'spam', 'drafts', 'sent']) {
      const { fourth, more } = phoneBar(folder);
      // Archive, the main move and Reply are always on the bar; the other move and Label are always in More.
      expect(more, folder).toContain('other-move');
      expect(more, folder).toContain('label');
      // Mark as unread is on the bar or in More, never in neither and never in both.
      expect([fourth === 'unread', more.includes('unread')].filter(Boolean), folder).toHaveLength(1);
      expect(fourth, folder).toBe(
        folder === 'trash' || folder === 'spam' ? 'delete' : folder === 'drafts' || folder === 'sent' ? 'unread' : 'snooze'
      );
    }
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
    // The name starts with the card's visible text, in its order (J1-09, 2.5.3): the type tile, the file, its size (a space between the two
    // spans, or the text reads 'photogpj.exe2 KB'), then the action.
    expect(html).toMatch(/aria-label="[A-Z]+, photogpj\.exe, 2 KB, download"/);
    expect(html).toMatch(/<span class="rd-file-name">photogpj\.exe<\/span> <span class="rd-file-size">2 KB<\/span>/);
  });

  it('opens an encrypted attachment with a button, not a link (a link would save the encrypted bytes)', () => {
    const html = render(message({ enc_fmt: 1, has_attachments: 1 }), { attachments: [attachment()] });
    expect(html).not.toContain('/api/attachments/');
    expect(html).toContain('aria-label="PDF, report.pdf, 2 KB, download"');
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
    // The chip is a button that opens its explanation in a small dialog; it names the explanation (aria-controls) only while it is open, so the
    // reference never dangles.
    const sealed = render(message({ is_e2e: 1 }));
    expect(sealed).toMatch(/<button type="button" class="nm-tap-h rd-badge-btn" aria-haspopup="dialog" aria-expanded="false">/);
    expect(sealed).not.toContain('aria-controls="e2e-badge-note"');
    expect(sealed).toContain(en['e2e.badge']);
    expect(render(message({ origin: 'smtp', from_hosted: true }))).toContain('data-unverified-sender');
    expect(render(message({ origin: 'internal', from_hosted: true }))).not.toContain('data-unverified-sender');
  });

  it('has Reply, Reply all and Forward under the message: Reply is the one primary button, the other two secondary', () => {
    const html = render(message());
    for (const label of [en['action.reply'], en['action.reply_all'], en['action.forward']]) {
      expect(html).toContain(`>${label}</button>`);
    }
    const row = html.slice(html.indexOf('class="rd-reply"'));
    expect([...row.matchAll(/data-variant="(\w+)"/g)].slice(0, 3).map((match) => match[1])).toEqual(['primary', 'secondary', 'secondary']);
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

  it('says it is loading (a skeleton of the message, named for screen readers), and what to do when nothing is selected', () => {
    expect(render(null, { isLoading: true })).toContain(en['reader.loading_message']);
    expect(render(null, { isLoading: true })).toContain('ui-skeleton');
    expect(render(null)).toContain(en['reader.none_selected']);
    expect(render(null)).toContain('/edgar.svg');
  });

  it('names itself with the heading and line of the list empty state when that list is empty, over a small flight trail: no second Edgar, no pointer at it', () => {
    const html = render(null, { listEmpty: true });
    expect(html).toContain('data-state="empty"');
    // J3-17: heading and line as the list's empty state (no quiet one-line label), under a blank band of the toolbar's height.
    expect(html).toMatch(
      /<div class="ui-empty"><div class="ui-empty-slot" aria-hidden="true"><svg[^>]*class="ui-trail"[\s\S]*?<\/div><h2 class="ui-empty-title">/
    );
    expect(html).toContain(en['reader.none_selected']);
    expect(html).toContain(en['reader.none_selected_empty_hint']);
    expect(html).toContain('class="rd-bar rd-bar-skel" data-blank="true"');
    expect(html).not.toContain(en['reader.none_selected_hint']);
    expect(html).not.toContain('/edgar.svg');
    // An open message is shown whatever the list holds (a notification link opens one that is not in it).
    expect(render(message(), { listEmpty: true })).toContain('Quarterly numbers');
  });

  it('opens the recipients line in place (a ui Disclosure) and shows the labels of the message as ui Chips in their hue', () => {
    const html = render(message({ cc: 'bob@example.com', labels: JSON.stringify(['Work']) }));
    expect(html).toContain('<button type="button" class="ui-disclosure rd-rcpt" data-look="text" aria-expanded="false">');
    expect(html).toMatch(
      /<span class="ui-chip rd-tag" data-kind="label" data-removable="true" style="[^"]*">.*?<span class="ui-chip-text">Work<\/span>/
    );
    // J4-42: the chip takes the label off with its X, named after the label.
    expect(html).toContain('aria-label="Remove label Work"');
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

  it("says 'to me' when the signed-in address is the only recipient, with the address in the disclosure", () => {
    const html = render(message(), { self: 'Me <ME@example.com>' });
    expect(html).toContain(`<span class="rd-rcpt-text">${en['reader.to_me']}</span>`);
    expect(html).toContain('ui-disclosure rd-rcpt');
    // Someone else's address, or another recipient beside it, is shown as it is.
    const toMe = `<span class="rd-rcpt-text">${en['reader.to_me']}</span>`;
    expect(render(message(), { self: 'other@example.com' })).not.toContain(toMe);
    expect(render(message({ to_address: 'me@example.com, ann@example.com' }), { self: 'me@example.com' })).not.toContain(toMe);
  });

  it('gives a single attachment no caption (its card says it all: v3 R5), and several their count and total', () => {
    const one = render(message({ has_attachments: 1 }), { attachments: [attachment()] });
    expect(one).not.toContain('rd-files-title');
    expect(one).not.toContain('aria-labelledby="rd-files-title"');
    // Seen once (the card); the card's accessible name also says it (J1-09), which is not text on screen.
    expect(one.replaceAll(/aria-label="[^"]*"/g, '').match(/2 KB/g)).toHaveLength(1);
    const two = render(message({ has_attachments: 1 }), { attachments: [attachment(), attachment({ id: 'a2', filename: 'b.pdf' })] });
    expect(two).toContain(en['reader.attachments_summary#other'].replace('{count}', '2').replace('{size}', '4 KB'));
  });

  it('puts the trust chips on line 2 of the sender block, after the date and the recipients: the sealed one neutral, an unverified sender in the caution tone, no chevron (J3-08, J4-01, J6-01, v3 R3)', () => {
    const html = render(message({ is_e2e: 1 }));
    // Not on the name's line.
    expect(html.slice(html.indexOf('class="rd-line"'), html.indexOf('class="rd-when"'))).not.toContain('data-e2e-badge');
    const after = html.slice(html.indexOf('class="rd-when"'), html.indexOf('</header>'));
    expect(after.indexOf('class="rd-date"')).toBeLessThan(after.indexOf('data-e2e-badge'));
    expect(after).toContain('data-tone="neutral"');
    // One disclosure in the block (the recipients): the chip says it opens with aria-haspopup, not with a chevron of its own.
    expect(after).not.toContain('rd-badge-more');
    const outside = render(message({ origin: 'smtp', from_hosted: true }));
    const line = outside.slice(outside.indexOf('class="rd-when"'), outside.indexOf('</header>'));
    expect(line).toContain('data-unverified-sender');
    expect(line).toContain('data-tone="warning"');
  });

  it('gives the date one place in every state: first on the line under the sender, never on the sender line (J3-21)', () => {
    for (const html of [
      render(message()),
      render(message({ is_e2e: 1 })),
      render(message({ origin: 'smtp', from_hosted: true })),
      render(message({ to_address: 'me@example.com, ann@example.com' }))
    ]) {
      const line = html.slice(html.indexOf('class="rd-line"'), html.indexOf('class="rd-meta"'));
      expect(line).not.toContain('rd-date');
      expect(html).toMatch(/<div class="rd-meta"><span class="rd-date">[^<]+<\/span><(p|button)[^>]*class="[^"]*rd-rcpt/);
    }
  });

  it('has one Reply path: the dock at the end of the letter (and its key); the header keeps only the star, which a phone has in its top bar (v3 R2)', () => {
    const desktop = tools(render(message()));
    expect(desktop).toContain(`aria-label="${STAR}"`);
    expect(desktop).not.toContain(`aria-label="${REPLY}"`);
    expect(desktop).not.toContain('aria-haspopup="menu"');
    const html = render(message());
    expect(html.slice(html.indexOf('<header'), html.indexOf('</header>'))).not.toContain(`>${REPLY}<`);
    const phone = render(message(), { compact: true });
    expect(phone).not.toContain('class="rd-tools"');
    expect(toolbars(phone)[0].buttons).toContain(STAR);
  });

  it('gives each button of the phone bottom bar a short word under its icon that is part of its name (J5-15, 2.5.3)', () => {
    const html = render(message(), { compact: true });
    const bar = html.slice(html.indexOf('class="ui-toolbar rd-bar nm-bar"'));
    const words = [...bar.matchAll(/class="rd-tab-text">([^<]*)</g)].map((match) => match[1]);
    expect(words).toEqual([ARCHIVE, en['reader.bar_trash'], REPLY, SNOOZE, en['reader.bar_more']]);
    for (const [word, name] of [
      [en['reader.bar_trash'], TRASH],
      [en['reader.bar_more'], MORE],
      [en['reader.bar_inbox'], INBOX],
      [en['reader.bar_delete'], DELETE],
      [en['reader.bar_unread'], UNREAD]
    ]) {
      expect(name.toLowerCase()).toContain(word.toLowerCase());
    }
  });
});
