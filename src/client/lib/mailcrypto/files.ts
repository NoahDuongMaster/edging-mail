import { openField } from '../../../shared/crypto/client';
import type { Bytes } from '../../../shared/crypto/client';
import type { Attachment, Message } from '../../types';
import { tr } from '../i18n';
import { UnauthorizedError } from '../api';
import { cekOf, keyEpoch, sealState } from './cek';
import { MailOpenError, sameOriginFetch } from './types';
import type { Fetcher, OpenKey } from './types';

// The bytes of an attachment or of the raw message: fetched from the Worker (encrypted for an EM1 row) and opened here.

/** The body of a 200 answer. A 401 is the signed-out case the app handles everywhere else; any other failure is one fixed error. */
async function fetchBytes(url: string, fetcher: Fetcher): Promise<Bytes> {
  const response = await fetcher(url);
  if (response.status === 401) {
    throw new UnauthorizedError(tr('common.something_wrong'));
  }
  if (!response.ok) {
    throw new MailOpenError('download failed');
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Fetches `url` and, for an encrypted row, opens it with `purpose`. A legacy row's bytes are already plain. */
async function fetchOpened(message: Message, purpose: string, url: string, key: OpenKey | null, fetcher: Fetcher): Promise<Bytes> {
  const state = sealState(message, key);
  if (state === 'plain') {
    return fetchBytes(url, fetcher);
  }
  if (state !== 'open' || key === null) {
    throw new MailOpenError('message is not open');
  }
  const started = keyEpoch();
  const cek = await cekOf(message, key);
  const blob = await fetchBytes(url, fetcher);
  const plain = await openField(cek, purpose, message.id, blob);
  if (started !== keyEpoch()) {
    throw new MailOpenError('keys were wiped');
  }
  return plain;
}

export const openAttachmentBytes = (
  message: Message,
  attachment: Pick<Attachment, 'id'>,
  key: OpenKey | null,
  fetcher: Fetcher = sameOriginFetch
): Promise<Bytes> => fetchOpened(message, `att/${attachment.id}`, `/api/attachments/${encodeURIComponent(attachment.id)}`, key, fetcher);

export const openRawBytes = (message: Message, key: OpenKey | null, fetcher: Fetcher = sameOriginFetch): Promise<Bytes> =>
  fetchOpened(message, 'raw', `/api/raw/${encodeURIComponent(message.id)}`, key, fetcher);

// A file name chosen by the sender must not be able to say where the file goes, hide its type or look like another one.
const BAD_NAME_CHARS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
// Right-to-left and other direction controls: "photo\u202Egpj.exe" would show as "photoexe.jpg".
const DIRECTION_CONTROLS = new Set([0x20_0e, 0x20_0f, 0x20_2a, 0x20_2b, 0x20_2c, 0x20_2d, 0x20_2e, 0x20_66, 0x20_67, 0x20_68, 0x20_69]);
const MAX_NAME_CHARS = 120;

export function safeFileName(name: string, fallback: string): string {
  let cleaned = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || (code >= 127 && code < 160) || DIRECTION_CONTROLS.has(code)) {
      continue;
    }
    cleaned += BAD_NAME_CHARS.has(char) ? '_' : char;
  }
  cleaned = cleaned.replaceAll(/\s+/g, ' ').trim();
  // No hidden files and no "." or ".." (a leading dot is not an extension).
  while (cleaned.startsWith('.')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned === '') {
    return fallback;
  }
  if (cleaned.length <= MAX_NAME_CHARS) {
    return cleaned;
  }
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, MAX_NAME_CHARS - extension.length)}${extension}`;
}
