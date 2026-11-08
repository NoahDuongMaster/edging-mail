import type { MailState } from '../../types';
import type { MessageKey } from '../i18n';

// What the screens say about a message the browser could not open. Keys, not text: the language can change while a row is on screen.

export type Unreadable = Exclude<MailState, 'ready'>;

/** Instead of the subject (list row and reader heading). A message sealed to another key and one that waits for no key at all read alike here. */
export const SUBJECT_KEYS: Record<Unreadable, MessageKey> = {
  locked: 'mailcrypto.subject_locked',
  pending: 'mailcrypto.subject_pending',
  other_key: 'mailcrypto.subject_locked',
  failed: 'mailcrypto.subject_failed'
};

/** Instead of the body (the reader). */
export const NOTE_KEYS: Record<Unreadable, MessageKey> = {
  locked: 'mailcrypto.note_locked',
  pending: 'mailcrypto.note_pending',
  other_key: 'mailcrypto.note_other_key',
  failed: 'mailcrypto.note_failed'
};

/** True for every state but 'ready'. A message that never went through lib/mailcrypto (no state) counts as readable. */
export const isUnreadable = (state: MailState | undefined): state is Unreadable => state !== undefined && state !== 'ready';
