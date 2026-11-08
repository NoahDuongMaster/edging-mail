import { newCek, sealCek, sealField, toBase64Url, utf8 } from '../../../shared/crypto/client';
import type { Bytes, PublicKey } from '../../../shared/crypto/client';
import { describeFile, newRowId, snippetOf, subjectLine, toBase64 } from './helpers';
import type { MailContent, OutgoingAttachment, PlainCopy, Sealed, SealedAttachment } from './types';

export { checkLimits } from './limits';

// EM1 in the browser (crypto-design.md section 5, reports/e2e-contract.md section 2): ONE copy of the message for ONE person, with its own row id and
// its own content key, so that no two people hold anything in common and the server cannot tell the copies are the same message. The layout is
// what the Worker's own sealing writes (src/worker/mail/seal.ts) and what the reader opens (lib/mailcrypto): tests open these copies with it.

const json = (value: unknown): Bytes => utf8(JSON.stringify(value));

async function sealAttachment(cek: Bytes, rowId: string, file: OutgoingAttachment): Promise<SealedAttachment> {
  const id = newRowId();
  const { filename, mimeType, contentId } = describeFile(file);
  const [blob, meta] = await Promise.all([
    sealField(cek, `att/${id}`, rowId, file.bytes),
    sealField(cek, `att-meta/${id}`, rowId, json({ filename, mime_type: mimeType, content_id: contentId }))
  ]);
  return { id, blob: toBase64Url(blob), meta_blob: toBase64Url(meta) };
}

/** The sealed copy of a message for `recipient` (a person's public key; the sender's own key for the Sent copy). Plaintext in, blobs out. */
export async function sealCopy(content: MailContent, attachments: readonly OutgoingAttachment[], recipient: PublicKey): Promise<Sealed> {
  const rowId = newRowId();
  const cek = newCek();
  try {
    const wrapped = await sealCek(cek, rowId, recipient);
    const summary = await sealField(
      cek,
      'summary',
      rowId,
      json({ subject: content.subject, snippet: snippetOf(content.text, content.html) })
    );
    const body = await sealField(cek, 'body', rowId, json({ text: content.text, html: content.html }));
    const files = await Promise.all(attachments.map((file) => sealAttachment(cek, rowId, file)));
    return {
      id: rowId,
      key_id: recipient.keyId,
      wrapped_cek: toBase64Url(wrapped),
      summary_blob: toBase64Url(summary),
      body_blob: toBase64Url(body),
      ...(files.length > 0 ? { attachments: files } : {})
    };
  } finally {
    // Only the sealed key leaves this function.
    cek.fill(0);
  }
}

/**
 * The copy for a person WITHOUT keys: plaintext, over TLS, for the server to seal (so the message is not end-to-end). Only built after the
 * sender confirmed it. Limits of the format: the server keeps no `content_id` for it (an inline picture loses its place), and a line break in
 * the subject or a file name becomes a space (the server refuses it in a plain copy).
 */
export function plainCopy(address: string, content: MailContent, attachments: readonly OutgoingAttachment[]): PlainCopy {
  const files = attachments.map((file) => {
    const { filename, mimeType } = describeFile(file);
    return { filename, mime_type: mimeType, content_base64: toBase64(file.bytes) };
  });
  return {
    address,
    plain: {
      subject: subjectLine(content.subject),
      text: content.text,
      html: content.html,
      ...(files.length > 0 ? { attachments: files } : {})
    }
  };
}
