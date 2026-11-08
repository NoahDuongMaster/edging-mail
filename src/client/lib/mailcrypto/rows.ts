import type { Bytes } from '../../../shared/crypto/client';
import type { Attachment, MailState, Message } from '../../types';
import { cekOf, keyEpoch, sealState } from './cek';
import type { SealState } from './cek';
import { nonEmpty } from '../mail';
import { readAttachmentMeta, readBody, readSummary } from './fields';
import type { OpenKey } from './types';

// Rows of the list and of the reader, as the components want them: `subject`, `snippet`, `body_text` and `body_html` filled in and
// `mail_state` saying whether that worked. Nothing here throws for a row that cannot be opened (that is a state, not an error), and
// nothing keeps the text: the caller owns what comes back.

/** A message row as the detail route sends it: the row plus the body blob. */
export type DetailRow = Message & { body_blob?: string | null };

export interface OpenedDetail {
  message: Message;
  attachments: Attachment[];
}

/** The row without the ciphertext of its body: the reader keeps the decrypted text, not the blob. */
const withoutBlob = (row: DetailRow): Message => {
  const rest = { ...row };
  delete rest.body_blob;
  return rest;
};

const unreadable = (row: DetailRow, state: Exclude<MailState, 'ready'>): Message => ({
  ...withoutBlob(row),
  subject: '',
  snippet: null,
  body_text: null,
  body_html: null,
  mail_state: state
});

const stateOfUnopened = (state: SealState): Exclude<MailState, 'ready'> => (state === 'plain' || state === 'open' ? 'failed' : state);

/** One list row. Legacy rows pass through as they are. */
export async function openListRow(row: Message, key: OpenKey | null): Promise<Message> {
  const state = sealState(row, key);
  if (state === 'plain') {
    return { ...row, mail_state: 'ready' };
  }
  if (state !== 'open' || key === null) {
    return unreadable(row, stateOfUnopened(state));
  }
  const started = keyEpoch();
  try {
    const { subject, snippet } = await readSummary(await cekOf(row, key), row.id, row.summary_blob);
    // The keys were wiped while this worked: what was opened is not handed on.
    return started === keyEpoch() ? { ...row, subject, snippet, mail_state: 'ready' } : unreadable(row, 'locked');
  } catch {
    return unreadable(row, 'failed');
  }
}

export const openListRows = (rows: readonly Message[], key: OpenKey | null): Promise<Message[]> =>
  Promise.all(rows.map((row) => openListRow(row, key)));

async function openAttachment(cek: Bytes, rowId: string, attachment: Attachment): Promise<Attachment> {
  const blob = nonEmpty(attachment.meta_blob);
  if (blob === undefined) {
    return attachment;
  }
  try {
    return { ...attachment, ...(await readAttachmentMeta(cek, rowId, attachment.id, blob)) };
  } catch {
    return { ...attachment, filename: '', mime_type: '', content_id: null, meta_failed: true };
  }
}

/** The reader's message with its attachments. A message that cannot be opened has no attachments to show. */
export async function openDetail(row: DetailRow, attachments: readonly Attachment[], key: OpenKey | null): Promise<OpenedDetail> {
  const state = sealState(row, key);
  if (state === 'plain') {
    return { message: { ...withoutBlob(row), mail_state: 'ready' }, attachments: [...attachments] };
  }
  if (state !== 'open' || key === null) {
    return { message: unreadable(row, stateOfUnopened(state)), attachments: [] };
  }
  const started = keyEpoch();
  try {
    const cek = await cekOf(row, key);
    const [summary, body, opened] = await Promise.all([
      readSummary(cek, row.id, row.summary_blob),
      readBody(cek, row.id, row.body_blob),
      Promise.all(attachments.map((attachment) => openAttachment(cek, row.id, attachment)))
    ]);
    if (started !== keyEpoch()) {
      return { message: unreadable(row, 'locked'), attachments: [] };
    }
    return {
      message: {
        ...withoutBlob(row),
        subject: summary.subject,
        snippet: summary.snippet,
        body_text: body.text,
        body_html: body.html,
        mail_state: 'ready'
      },
      attachments: opened
    };
  } catch {
    return { message: unreadable(row, 'failed'), attachments: [] };
  }
}
