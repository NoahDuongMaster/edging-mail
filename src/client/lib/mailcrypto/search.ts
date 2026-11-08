import type { Message } from '../../types';

// Search over encrypted mail. The server can still match the addresses (it sees those); it cannot read a subject or a snippet. So the
// subjects and snippets are searched here, over the mail the browser has already loaded and opened, and nothing else: the text of a
// message body is not searchable.

const fold = (text: string): string => text.toLocaleLowerCase();

/** Does the opened subject or snippet of `message` contain `query` (case-insensitive)? A message that could not be opened never matches. */
export function matchesQuery(message: Message, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === '' || (message.mail_state !== undefined && message.mail_state !== 'ready')) {
    return false;
  }
  return fold(message.subject).includes(needle) || fold(message.snippet ?? '').includes(needle);
}

const lastEditedFirst = (a: Message, b: Message): number => b.updated_at - a.updated_at;
const wakingSoonestFirst = (a: Message, b: Message): number => (a.snoozed_until ?? 0) - (b.snoozed_until ?? 0);
const newestFirst = (a: Message, b: Message): number => b.created_at - a.created_at;

/** The same order the server gives a folder: drafts by last edit, snoozed by wake time, everything else newest first. */
function byFolderOrder(folder: string): (a: Message, b: Message) => number {
  if (folder === 'drafts') {
    return lastEditedFirst;
  }
  return folder === 'snoozed' ? wakingSoonestFirst : newestFirst;
}

/**
 * What a search shows: everything the server matched (addresses), plus the already loaded mail of the same view whose subject or
 * snippet matches. Each message once; the server's copy wins.
 */
export function withLoadedMatches(found: readonly Message[], loaded: readonly Message[], query: string, folder: string): Message[] {
  const seen = new Set(found.map((message) => message.id));
  const extra = loaded.filter((message) => {
    if (seen.has(message.id) || !matchesQuery(message, query)) {
      return false;
    }
    seen.add(message.id);
    return true;
  });
  return extra.length === 0 ? [...found] : [...found, ...extra].toSorted(byFolderOrder(folder));
}
