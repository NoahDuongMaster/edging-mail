import { newCek, sealCek, sealData, sealField, toBase64Url, utf8 } from '../../shared/crypto/server';
import type { Bytes, DataKeys, PublicKey } from '../../shared/crypto/server';

// EM1 on the Worker side: turns the content of one message into what is stored (crypto-design.md section 5). Plaintext goes in, only blobs come
// out; nothing here writes or logs anything. Row ids and R2 keys are UUIDs only: an object's name says nothing about its content.

/** Who can open the content key: the owner (HPKE to their public key), or, while they have no key yet, the server (pending, under DATA_KEY). */
export type Recipient = { kind: 'user'; key: PublicKey } | { kind: 'server'; keys: DataKeys };

export interface MessageContent {
  subject: string | null;
  snippet: string | null;
  text: string | null;
  html: string | null;
}

export interface AttachmentContent {
  id: string;
  filename: string;
  mime_type: string;
  content_id: string | null;
  bytes: Bytes;
}

/** `em1/<owner>/<row>/<purpose>`; mail that has no owner yet (it arrived before Setup) lives under `em1/pending/`. */
export const em1Key = (ownerId: string | null, rowId: string, purpose: string): string => `em1/${ownerId ?? 'pending'}/${rowId}/${purpose}`;

export interface SealedMessage {
  /** The message row's encrypted columns, plaintext columns nulled. */
  columns: {
    enc_fmt: 1;
    key_id: string | null;
    wrapped_cek: string;
    wrap_kind: 'user' | 'server';
    summary_blob: string;
    body_blob: string;
    subject: null;
    snippet: null;
    body_text: null;
    body_html: null;
    r2_key: string | null;
  };
  /** R2 objects to write BEFORE the row is stored. */
  objects: { key: string; body: Bytes }[];
  attachments: { id: string; meta_blob: string; r2_key: string }[];
}

const json = (value: unknown): Bytes => utf8(JSON.stringify(value));

/** The content key of one row, sealed to its recipient: the value of `wrapped_cek` (base64url) and the `key_id` column. */
export async function wrapCek(
  recipient: Recipient,
  rowId: string,
  cek: Bytes
): Promise<{ wrapped_cek: string; key_id: string | null; wrap_kind: 'user' | 'server' }> {
  if (recipient.kind === 'user') {
    return { wrapped_cek: toBase64Url(await sealCek(cek, rowId, recipient.key)), key_id: recipient.key.keyId, wrap_kind: 'user' };
  }
  return { wrapped_cek: toBase64Url(await sealData(recipient.keys, 'pendingCek', rowId, cek)), key_id: null, wrap_kind: 'server' };
}

/** Seals a message: summary and body blobs, the raw mail and every attachment as R2 objects, attachment metadata blobs. */
export async function sealMessage(
  recipient: Recipient,
  ownerId: string | null,
  rowId: string,
  content: MessageContent,
  raw: Bytes | null,
  attachments: AttachmentContent[]
): Promise<SealedMessage> {
  const cek = newCek();
  const wrap = await wrapCek(recipient, rowId, cek);
  const objects: SealedMessage['objects'] = [];
  const rawKey = raw === null ? null : em1Key(ownerId, rowId, 'raw');
  if (raw !== null && rawKey !== null) {
    objects.push({ key: rawKey, body: await sealField(cek, 'raw', rowId, raw) });
  }
  const sealedAttachments: SealedMessage['attachments'] = [];
  for (const attachment of attachments) {
    const purpose = `att/${attachment.id}`;
    const key = em1Key(ownerId, rowId, purpose);
    objects.push({ key, body: await sealField(cek, purpose, rowId, attachment.bytes) });
    const meta = await sealField(
      cek,
      `att-meta/${attachment.id}`,
      rowId,
      json({ filename: attachment.filename, mime_type: attachment.mime_type, content_id: attachment.content_id })
    );
    sealedAttachments.push({ id: attachment.id, meta_blob: toBase64Url(meta), r2_key: key });
  }
  return {
    columns: {
      enc_fmt: 1,
      ...wrap,
      summary_blob: toBase64Url(await sealField(cek, 'summary', rowId, json({ subject: content.subject, snippet: content.snippet }))),
      body_blob: toBase64Url(await sealField(cek, 'body', rowId, json({ text: content.text, html: content.html }))),
      subject: null,
      snippet: null,
      body_text: null,
      body_html: null,
      r2_key: rawKey
    },
    objects,
    attachments: sealedAttachments
  };
}
