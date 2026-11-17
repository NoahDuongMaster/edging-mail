// The person's own allow and block lists. An entry is lower-case and is either `name@host` (that one address) or a bare `host` (that host and every subdomain of
// it). Matching is exact text on dots: `example.com` matches `example.com` and `mail.example.com`, never `notexample.com`.

import { isHostname } from '../addresses';
import type { FilterKind } from '../db/schema';
import { hostOfAddress } from './hosts';

/** The longest entry, and the most entries a person can have. */
export const MAX_ENTRY_CHARS = 255;
export const MAX_ENTRIES = 500;

// The local part of an address as the sender wrote it: dot-atom text (RFC 5322), so tags and bounce addresses (`news+tag`, `bounce=a@b`) are accepted. The
// hosting rules of addresses.ts are stricter (a local part for a mailbox here), so they do not apply to a sender.
const LOCAL = /^[\d!#$%&'*+/=?^_`a-z{|}~-]+(?:\.[\d!#$%&'*+/=?^_`a-z{|}~-]+)*$/;
const MAX_LOCAL_CHARS = 64;

/**
 * An entry as it is stored (trimmed, lower-case), or null when the text is neither a plain `name@host` nor a bare host. Hosts are ASCII names with at least
 * two labels (a punycode name is fine); no port, path, wildcard, quote or display name.
 */
export function normaliseEntry(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > MAX_ENTRY_CHARS) {
    return null;
  }
  const at = value.indexOf('@');
  if (at === -1) {
    return isHostname(value) ? value : null;
  }
  const local = value.slice(0, at);
  const host = value.slice(at + 1);
  return local.length <= MAX_LOCAL_CHARS && LOCAL.test(local) && isHostname(host) ? value : null;
}

/** Does this entry cover this address (lower-case)? An address entry is the address itself; a host entry is the host or any subdomain of it. */
export function entryMatches(entry: string, address: string): boolean {
  if (entry.includes('@')) {
    return address === entry;
  }
  const host = hostOfAddress(address);
  return host === entry || host.endsWith(`.${entry}`);
}

export interface ListEntry {
  kind: FilterKind;
  value: string;
  created_at: number;
}

// How specific an entry is: an address beats any host, a longer host (more labels) beats a shorter one.
const specificity = (entry: ListEntry): number => (entry.value.includes('@') ? 1000 : entry.value.split('.').length);

/**
 * What the person's lists say about a sender: 'allow', 'block' or null (no entry covers the address). When entries of both kinds cover it, the most specific one
 * wins (an allow for `friend@example.com` beats a block of `example.com`), then the newer one, then block.
 */
export function listDecision(entries: readonly ListEntry[], address: string): FilterKind | null {
  const covering = entries.filter((entry) => entryMatches(entry.value, address));
  const best = covering
    .toSorted(
      (a, b) =>
        specificity(b) - specificity(a) || b.created_at - a.created_at || (a.kind === 'block' ? -1 : 0) - (b.kind === 'block' ? -1 : 0)
    )
    .at(0);
  return best?.kind ?? null;
}
