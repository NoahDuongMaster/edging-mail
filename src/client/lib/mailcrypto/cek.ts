import { fromBase64Url, unwrapCek } from '../../../shared/crypto/client';
import type { Bytes } from '../../../shared/crypto/client';
import type { MailState, Message } from '../../types';
import { onKeysWiped } from '../crypto/keyStore';
import { nonEmpty } from '../mail';
import type { OpenKey } from './types';

/** The columns of a message row that say how its content is sealed. */
export type SealedFields = Pick<Message, 'id' | 'enc_fmt' | 'key_id' | 'wrap_kind' | 'wrapped_cek'>;

/** What the browser can do with a row before any decryption: it is legacy plaintext, it can be opened, or it is one of the unreadable states. */
export type SealState = 'plain' | 'open' | Exclude<MailState, 'ready'>;

export function sealState(row: SealedFields, key: OpenKey | null): SealState {
  if (row.enc_fmt === undefined || row.enc_fmt === 0) {
    return 'plain';
  }
  if (row.enc_fmt !== 1) {
    return 'failed';
  }
  if (key === null) {
    return 'locked';
  }
  if (row.wrap_kind === 'server') {
    return 'pending';
  }
  if (row.wrap_kind !== 'user' || nonEmpty(row.wrapped_cek) === undefined || nonEmpty(row.key_id) === undefined) {
    return 'failed';
  }
  return row.key_id === key.keyId ? 'open' : 'other_key';
}

// The content key of a row, kept for the session so a list row, the reader and a download open it once. Module memory only (never React
// state, never storage); the `wrapped_cek` it came from is kept with it, so a row that is sealed again gets a fresh unwrap.
interface Entry {
  wrapped: string;
  keyId: string;
  cek: Bytes;
}

const MAX_ENTRIES = 5000;
const ceks = new Map<string, Entry>();
let epoch = 0;

/** Changes every time the keys are wiped: work that started before a wipe checks it and drops its result. */
export const keyEpoch = (): number => epoch;

export function clearCeks(): void {
  for (const entry of ceks.values()) {
    entry.cek.fill(0);
  }
  ceks.clear();
  epoch += 1;
}

onKeysWiped(clearCeks);

/** How many content keys are held (tests). */
export const cachedCekCount = (): number => ceks.size;

/** The content key of a row whose `sealState` is 'open'. Throws when the key does not open it. */
export async function cekOf(row: SealedFields, key: OpenKey): Promise<Bytes> {
  const wrapped = row.wrapped_cek ?? '';
  const hit = ceks.get(row.id);
  if (hit?.wrapped === wrapped && hit.keyId === key.keyId) {
    return hit.cek;
  }
  const started = epoch;
  const cek = await unwrapCek(fromBase64Url(wrapped), row.id, row.key_id ?? '', key.pair);
  // Keys wiped while this was working: the result is not kept.
  if (started === epoch) {
    if (ceks.size >= MAX_ENTRIES) {
      const oldest = ceks.keys().next();
      if (oldest.done !== true) {
        // Not zeroed: that row's reader or download may be using these very bytes right now.
        ceks.delete(oldest.value);
      }
    }
    ceks.set(row.id, { wrapped, keyId: key.keyId, cek });
  }
  return cek;
}
