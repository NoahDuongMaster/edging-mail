import type { QueryClient } from '@tanstack/react-query';
import type { Message } from '../types';
import { bareAddress, splitAddressList } from './mail';
import { queryKeys, type MessageDetail, type MessagesPage } from './queries';

// The people the compose suggests in To, Cc and Bcc (J6-44). They come ONLY from mail this browser has already opened in this session (the
// senders of the mail it received, the recipients of the mail it sent), read from the query cache in memory each time the compose opens. They
// are never written to storage and never sent anywhere: the server keeps no address book, and an end-to-end product keeps it that way.

/** One person this browser has seen in its mail. */
export interface Contact {
  /** The bare, lower-case address. */
  address: string;
  /** Their display name, or '' when no mail named them. */
  name: string;
  /** When they were last seen: the newest message they appear in (epoch ms). */
  seen: number;
}

/** The most suggestions shown under a field. */
export const MAX_SUGGESTIONS = 6;

// The worker's rule (isEmail in src/worker/utils.ts): one plain address, no name part.
export const isAddress = (value: string): boolean => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(value);

/** One entry of an address header (`"Maya Chen" <maya@example.com>`, `maya@example.com`) as a name and a bare address; null if no address. */
export function parseMailbox(entry: string): { name: string; address: string } | null {
  const address = bareAddress(entry);
  if (!isAddress(address)) {
    return null;
  }
  const angle = entry.lastIndexOf('<');
  const name =
    angle > 0
      ? entry
          .slice(0, angle)
          .trim()
          .replace(/^"(.*)"$/s, '$1')
          .replaceAll(/\\(.)/g, '$1')
          .trim()
      : '';
  return { name: name.toLowerCase() === address ? '' : name, address };
}

/** The people one message names: the sender of mail that came in, the recipients of mail that was sent. Spam and drafts name nobody. */
function peopleOf(message: Message): { name: string; address: string }[] {
  if (message.folder === 'spam' || message.folder === 'drafts') {
    return [];
  }
  if (message.folder === 'sent') {
    return [message.to_address, message.cc ?? '', message.bcc ?? '']
      .flatMap((list) => splitAddressList(list))
      .map((entry) => parseMailbox(entry))
      .filter((person) => person !== null);
  }
  const sender = parseMailbox(message.from_address);
  return sender === null ? [] : [{ ...sender, name: message.from_name?.trim() ?? '' }];
}

/**
 * The people of these messages, newest first, each once (by address), without `self` (the signed-in account): their newest name wins, and a
 * mail that names them is preferred to one that does not.
 */
export function contactsOf(messages: Iterable<Message>, self = ''): Contact[] {
  const own = bareAddress(self);
  const book = new Map<string, Contact & { named: number }>();
  for (const message of messages) {
    const seen = message.created_at;
    for (const person of peopleOf(message)) {
      if (person.address === own) {
        continue;
      }
      const known = book.get(person.address);
      const named = person.name === '' ? -1 : seen;
      if (known === undefined) {
        book.set(person.address, { ...person, seen, named });
        continue;
      }
      known.seen = Math.max(known.seen, seen);
      if (named > known.named) {
        known.name = person.name;
        known.named = named;
      }
    }
  }
  return [...book.values()]
    .map(({ address, name, seen }) => ({ address, name, seen }))
    .toSorted((a, b) => b.seen - a.seen || a.address.localeCompare(b.address));
}

/** Every message held in this browser's query cache right now: the loaded pages of every list and every opened message. */
function* cachedMessages(queryClient: QueryClient): Generator<Message> {
  for (const [, data] of queryClient.getQueriesData<{ pages?: MessagesPage[] }>({ queryKey: queryKeys.messages })) {
    for (const page of data?.pages ?? []) {
      yield* page.messages;
    }
  }
  for (const [, detail] of queryClient.getQueriesData<MessageDetail>({ queryKey: queryKeys.messageDetails })) {
    if (detail !== undefined) {
      yield detail.message;
    }
  }
}

/** The people of the mail this browser holds in memory now (see the top of this file), newest first, without the account itself. */
export function knownContacts(queryClient: QueryClient, self = ''): Contact[] {
  return contactsOf(cachedMessages(queryClient), self);
}

/** Lower case, without the marks of letters ("Nguyễn" is found by "nguyen", "Đức" by "duc"). */
export function foldText(value: string): string {
  return value.normalize('NFD').replaceAll(/\p{M}/gu, '').replaceAll('đ', 'd').replaceAll('Đ', 'D').toLowerCase();
}

/**
 * Where `typed` matches the start of a word of `text` (the start of the text, or after a space or one of `.@_+-`), as the [start, end) of
 * the characters of `text` to mark, marks of letters and case ignored; null when it does not. The suggestions show what matched in bold.
 */
export function matchRange(text: string, typed: string): [number, number] | null {
  const query = foldText(typed.trim());
  // Letters as people see them (a letter and its marks are one), so a mark is never cut from its letter.
  const chars = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  if (query === '') {
    return null;
  }
  // Each letter folded on its own (a Vietnamese letter folds to one letter), so a place in the folded text is a place in the text.
  const folded = chars.map((char) => foldText(char));
  for (let start = 0; start < chars.length; start += 1) {
    if (start > 0 && !/[\s.@_+-]/.test(chars[start - 1])) {
      continue;
    }
    let taken = '';
    let end = start;
    while (end < chars.length && taken.length < query.length) {
      taken += folded[end];
      end += 1;
    }
    if (taken.startsWith(query)) {
      const before = chars.slice(0, start).join('').length;
      return [before, before + chars.slice(start, end).join('').length];
    }
  }
  return null;
}

/**
 * Where a typed text may start in a contact, in two tiers: the person (the whole name, each of its words, the address, each part of the
 * part before the @: `chen` in `maya.chen@`), then their domain (`example.org`, `library` in `notices@library.example.org`), which many
 * people share and which only comes after every match on a person.
 */
function startsOf(contact: Contact): [string[], string[]] {
  const name = foldText(contact.name);
  const at = contact.address.indexOf('@');
  const local = contact.address.slice(0, at);
  const domain = contact.address.slice(at + 1);
  const person = [name, ...name.split(/\s+/), contact.address, ...local.split(/[._+-]/)];
  return [person.filter((part) => part !== ''), [domain, ...domain.split(/[.-]/)].filter((part) => part !== '')];
}

/**
 * The contacts to suggest for what is typed in a recipient field: those whose name, a word of the name, the address or a part of it starts
 * with it (letter marks and case ignored), newest first, at most `max`, without the addresses already in the message (`taken`, lower case);
 * a match on the domain alone comes after the matches on a person (one letter would otherwise list everybody of example.com). Nothing while
 * nothing is typed.
 */
export function suggestContacts(
  contacts: readonly Contact[],
  typed: string,
  taken: ReadonlySet<string> = new Set(),
  max = MAX_SUGGESTIONS
): Contact[] {
  const query = foldText(typed.trim());
  if (query === '' || /[,;]/.test(query)) {
    return [];
  }
  const people: Contact[] = [];
  const domains: Contact[] = [];
  for (const contact of contacts) {
    if (people.length >= max) {
      break;
    }
    if (taken.has(contact.address)) {
      continue;
    }
    const [person, domain] = startsOf(contact);
    if (person.some((start) => start.startsWith(query))) {
      people.push(contact);
    } else if (domain.some((start) => start.startsWith(query))) {
      domains.push(contact);
    }
  }
  return [...people, ...domains].slice(0, max);
}
