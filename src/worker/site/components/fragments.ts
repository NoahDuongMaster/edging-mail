import type { LandingUi, SampleSender } from '../copy.types';
import { esc } from '../html';
import { avatar } from './avatar';
import { badge } from './badge';
import { icon, type IconName } from './icons';

// Small pieces of the app built in HTML and CSS with the app's tokens (class prefix `fx-`), so the page shows the product even
// where no screenshot is. They are sample UI: every caller puts them in an `aria-hidden` box, and the tile or card around them
// keeps its real h3 and text. Product words come from the copy (the glossary's folder and button names); people's names and
// times are sample data, the same in every language. Each fragment shows its own people and its own mail, and none of them repeats
// the product screenshot of the hero.

interface Person {
  readonly initials: string;
  readonly name: string;
  readonly local: string;
  readonly time: string;
}

/** The sample senders (their subjects are `ui.sampleSubjects`, keyed the same way). */
const PEOPLE: Readonly<Record<SampleSender, Person>> = {
  lena: { initials: 'LF', name: 'Lena Fischer', local: 'lena', time: '10:02' },
  daniel: { initials: 'DO', name: 'Daniel Okafor', local: 'daniel', time: '10:24' },
  hana: { initials: 'HS', name: 'Hana Sato', local: 'hana', time: '09:47' },
  marco: { initials: 'MS', name: 'Marco Silva', local: 'marco', time: '09:15' },
  aisha: { initials: 'AK', name: 'Aisha Khan', local: 'aisha', time: '09:58' },
  omar: { initials: 'OH', name: 'Omar Haddad', local: 'omar', time: '10:31' },
  grace: { initials: 'GL', name: 'Grace Liu', local: 'grace', time: '10:05' },
  ben: { initials: 'BC', name: 'Ben Carter', local: 'ben', time: '09:20' },
  elena: { initials: 'EP', name: 'Elena Petrova', local: 'elena', time: '09:48' },
  lucas: { initials: 'LM', name: 'Lucas Moreau', local: 'lucas', time: '09:30' },
  jonas: { initials: 'JW', name: 'Jonas Weber', local: 'jonas', time: '09:12' },
  priya: { initials: 'PN', name: 'Priya Nair', local: 'priya', time: '08:55' },
  tom: { initials: 'TB', name: 'Tom Becker', local: 'tom', time: '08:30' }
};

/** Sam owns the mailbox the fragments show: the open message is addressed to Sam, and the key is Sam's. */
const OWNER = { local: 'sam' } as const;

/**
 * Staff who only appear as accounts (the admin table, the addresses on the domain), never as senders, so no person turns up in
 * two fragments.
 */
const STAFF = {
  ravi: { initials: 'RM', name: 'Ravi Menon', local: 'ravi', time: '' },
  chloe: { initials: 'CM', name: 'Chloe Martin', local: 'chloe', time: '' },
  yusuf: { initials: 'YD', name: 'Yusuf Demir', local: 'yusuf', time: '' },
  anna: { initials: 'AB', name: 'Anna Berg', local: 'anna', time: '' },
  felix: { initials: 'FW', name: 'Felix Wagner', local: 'felix', time: '' },
  mei: { initials: 'MT', name: 'Mei Tanaka', local: 'mei', time: '' }
} as const satisfies Record<string, Person>;

const address = (ui: LandingUi, local: string): string => `${local}@${ui.sampleDomain}`;

/**
 * A message row of a list: avatar, sender, time and the sample subject. `unread` adds the accent dot and the bold subject, `picked`
 * marks the open message (a tinted row and an accent avatar).
 */
function messageRow(ui: LandingUi, sender: SampleSender, options: { readonly unread?: boolean; readonly picked?: boolean } = {}): string {
  const who = PEOPLE[sender];
  const state = `${options.unread === true ? ' is-unread' : ''}${options.picked === true ? ' is-picked' : ''}`;
  return `<div class="fx-row${state}">${avatar(who.initials, options.picked === true)}<div class="fx-row-text"><span class="fx-row-top"><b>${esc(who.name)}</b><time>${who.time}</time></span><span class="fx-subject">${esc(ui.sampleSubjects[sender])}</span></div></div>`;
}

/** The mailbox: the eight folders of the glossary (Inbox selected, with counts), the message list and Lena's open message to Sam. */
export function mailboxFragment(ui: LandingUi): string {
  const { folders, words } = ui;
  const rows: readonly [IconName, string, string][] = [
    ['inbox', folders.inbox, '2'],
    ['star', folders.starred, ''],
    ['clock', folders.snoozed, ''],
    ['send', folders.sent, ''],
    ['file', folders.drafts, '1'],
    ['archive', folders.archive, ''],
    ['ban', folders.spam, ''],
    ['trash', folders.trash, '']
  ];
  const list = rows
    .map(
      ([name, label, count], index) =>
        `<li${index === 0 ? ' class="is-on"' : ''}>${icon(name)}<span>${esc(label)}</span>${count === '' ? '' : `<b>${count}</b>`}</li>`
    )
    .join('');
  const lena = PEOPLE.lena;
  const reader = `<div class="fx-reader"><b class="fx-reader-subject">${esc(ui.sampleSubjects.lena)}</b><span class="fx-reader-from">${avatar(lena.initials, true)}<span class="fx-reader-who"><b>${esc(lena.name)}</b><span class="addr">${esc(address(ui, lena.local))}</span></span><time>${lena.time}</time></span><span class="fx-reader-body">${esc(ui.sampleBody)}</span><span class="fx-file">${icon('paperclip')}<span class="addr">planning-day.pdf</span></span><span class="fx-reader-actions"><span class="fx-ghost">${icon('reply')}${esc(words.reply)}</span><span class="fx-ghost">${icon('send')}${esc(words.forward)}</span></span></div>`;
  return `<div class="fx fx-mailbox"><div class="fx-side"><span class="fx-compose">${icon('pencil')}${esc(words.compose)}</span><ul class="fx-folders">${list}</ul></div><div class="fx-list"><span class="fx-search">${icon('search')}<span>${esc(words.search)}</span><kbd>/</kbd></span>${messageRow(ui, 'daniel', { unread: true })}${messageRow(ui, 'lena', { picked: true })}${messageRow(ui, 'hana')}${messageRow(ui, 'marco')}</div>${reader}</div>`;
}

/** A small reply window: Sam answering Aisha, To with an address chip, the subject, the reply with a caret, an attachment and Send. */
export function composeFragment(ui: LandingUi): string {
  const { words } = ui;
  const to = PEOPLE.aisha;
  return `<div class="fx fx-compose-win"><div class="fx-bar"><span class="fx-bar-title">${icon('reply')}${esc(words.reply)}</span></div><div class="fx-field"><span class="fx-label">${esc(words.to)}</span><span class="chip">${avatar(to.initials)}<span class="addr">${esc(address(ui, to.local))}</span></span></div><div class="fx-field"><span class="fx-label">${esc(words.subject)}</span><span class="fx-subject">Re: ${esc(ui.sampleSubjects.aisha)}</span></div><div class="fx-body"><span class="fx-typing">${esc(ui.sampleReply)}</span></div><div class="fx-file">${icon('paperclip')}<span class="addr">interview-plan.pdf</span></div><div class="fx-foot"><span class="fx-send">${esc(words.send)}${icon('send')}</span></div></div>`;
}

/** A notification arriving above the message list (drawn still: nothing on the page moves). */
export function newMailFragment(ui: LandingUi): string {
  const from = PEOPLE.omar;
  return `<div class="fx-feedwrap"><div class="fx fx-toast">${icon('bell')}<span class="fx-toast-text"><b>${esc(ui.words.newMail)}</b><span>${esc(from.name)} · ${esc(ui.sampleSubjects.omar)}</span></span><span class="fx-dot"></span></div><div class="fx fx-feed">${messageRow(ui, 'omar', { unread: true })}${messageRow(ui, 'grace')}${messageRow(ui, 'ben', { unread: true })}</div></div>`;
}

/** The app installed on a phone: status bar, the Inbox heading, its messages and the compose button. */
export function phoneFragment(ui: LandingUi): string {
  return `<div class="fx-phone"><div class="fx-phone-screen"><div class="fx-phone-status"><time>09:52</time><span class="fx-island"></span><span class="fx-batt"></span></div><div class="fx-phone-head"><b>${esc(ui.folders.inbox)}</b>${icon('search')}</div>${messageRow(ui, 'elena', { unread: true })}${messageRow(ui, 'lucas')}${messageRow(ui, 'jonas', { unread: true })}${messageRow(ui, 'priya')}${messageRow(ui, 'tom')}<span class="fx-fab">${icon('pencil')}</span><span class="fx-home"></span></div></div>`;
}

/** The encryption fragment: Sam's key with the address and a fingerprint in mono, then a subject and attachments as ciphertext. */
export function keyFragment(ui: LandingUi): string {
  const { words } = ui;
  const sealed = (label: string, cipher: string): string =>
    `<span class="fx-sealed-row"><span>${esc(label)}</span><code>${icon('lock')}${cipher}</code></span>`;
  return `<div class="fx fx-key"><div class="fx-key-head"><span class="fx-lock">${icon('key')}</span><span class="fx-key-name"><b>${esc(words.yourKey)}</b><span class="addr">${esc(address(ui, OWNER.local))}</span></span></div><code class="fx-fp">9F3A 1C07 B2E4 5D90<br>77AE 03C1 E8F2 4B6D</code><span class="fx-sealed"><span class="fx-sealed-title">${esc(words.encryptedWithKey)}</span>${sealed(words.subject, 'k7Qx…9fL2')}${sealed(words.attachments, 'Zr41…pA0w')}</span></div>`;
}

/** The admin console: a small accounts table (name, address, role badge, one alias) and the last line of the audit log. */
export function adminFragment(ui: LandingUi): string {
  const { words } = ui;
  const alias = address(ui, 'support');
  const row = (who: Person, role: string, tone: 'accent' | 'neutral'): string =>
    `<span class="fx-tr"><span class="fx-person">${avatar(who.initials, tone === 'accent')}<span>${esc(who.name)}</span></span><span class="addr">${esc(address(ui, who.local))}</span><span>${badge(role, tone)}</span></span>`;
  const aliasRow = `<span class="fx-tr"><span class="fx-person">${avatar('@', 'ghost')}<span>support</span></span><span class="addr">${esc(alias)}</span><span>${badge(words.alias)}</span></span>`;
  return `<div class="fx fx-admin"><div class="fx-bar"><span class="fx-bar-title">${icon('users')}${esc(words.adminConsole)}</span></div><span class="fx-tr fx-th"><span>${esc(words.name)}</span><span>${esc(words.address)}</span><span>${esc(words.role)}</span></span>${row(STAFF.ravi, words.admin, 'accent')}${row(STAFF.chloe, words.member, 'neutral')}${row(STAFF.yusuf, words.member, 'neutral')}${aliasRow}<span class="fx-audit"><span class="fx-audit-label">${icon('clock')}${esc(words.auditLog)}</span><span class="fx-audit-text"><b>${esc(STAFF.ravi.name)}</b> ${esc(words.aliasAdded)} <span class="addr">${esc(alias)}</span></span><time>09:41</time></span></div>`;
}

/** Benefit 1: the company's domain with a passed DNS check and the addresses on it (one of them an alias). */
export function domainFragment(ui: LandingUi): string {
  const { sampleDomain, words } = ui;
  const line = (who: Person, accent: boolean): string =>
    `<li>${avatar(who.initials, accent)}<span class="addr">${esc(address(ui, who.local))}</span></li>`;
  return `<div class="fx fx-domain"><div class="fx-domain-head">${icon('globe')}<span class="addr">${esc(sampleDomain)}</span>${badge('DNS', 'accent', 'check')}</div><ul class="fx-addrs">${line(STAFF.anna, true)}${line(STAFF.felix, false)}${line(STAFF.mei, false)}<li>${avatar('@', 'ghost')}<span class="addr">${esc(address(ui, 'hello'))}</span>${badge(words.alias)}</li></ul></div>`;
}

/** Benefit 2: the company's Cloudflare account holding Workers, D1 and R2, and the things nobody has to run, struck through. */
export function stackFragment(ui: LandingUi): string {
  const { words } = ui;
  return `<div class="fx fx-account"><span class="fx-account-label">${icon('cloud')}${esc(words.cloudflareAccount)}</span><span class="fx-stack"><span class="fx-node fx-node-main">${icon('hexagon')}Workers</span><span class="fx-node">${icon('database')}D1</span><span class="fx-node">${icon('bucket')}R2</span></span><span class="fx-none">${icon('ban')}${words.notNeeded.map((word) => `<s>${esc(word)}</s>`).join('')}</span></div>`;
}

/**
 * Benefit 3: the repository's LICENSE file as an editor shows it with soft wrap, scrolled to the start of the MIT text: lines 5 to 7
 * exactly as they are in the file, each under its line number, the grant itself (lines 5 and 6) highlighted.
 */
export function licenceFragment(): string {
  const lines: readonly [string, string][] = [
    ['5', 'Permission is hereby granted, free of charge, to any person obtaining a copy'],
    ['6', 'of this software and associated documentation files (the "Software"), to deal'],
    ['7', 'in the Software without restriction, including without limitation the rights']
  ];
  const body = lines.map(([number, line]) => `<span data-n="${number}"${number === '7' ? '' : ' class="hl"'}>${esc(line)}</span>`).join('');
  return `<div class="fx fx-licence"><div class="fx-bar"><span class="fx-bar-title">${icon('file')}<span class="addr">LICENSE</span></span>${badge('MIT', 'accent')}</div><span class="fx-code">${body}</span></div>`;
}
