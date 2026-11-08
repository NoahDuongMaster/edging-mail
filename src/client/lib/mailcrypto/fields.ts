import { fromBase64Url, openField } from '../../../shared/crypto/client';
import type { Bytes } from '../../../shared/crypto/client';
import { nonEmpty } from '../mail';
import { MailOpenError } from './types';

// The JSON inside each content blob, read strictly: a blob that opens but is not the shape the Worker seals is a failure, not a guess.

const decoder = new TextDecoder('utf-8', { fatal: true });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const textOrEmpty = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new MailOpenError('unexpected field type');
  }
  return value;
};

async function openJson(cek: Bytes, purpose: string, rowId: string, blob: string | null | undefined): Promise<Record<string, unknown>> {
  const text = nonEmpty(blob);
  if (text === undefined) {
    throw new MailOpenError('missing blob');
  }
  const plain = await openField(cek, purpose, rowId, fromBase64Url(text));
  const value: unknown = JSON.parse(decoder.decode(plain));
  if (!isRecord(value)) {
    throw new MailOpenError('unexpected blob shape');
  }
  return value;
}

/** `{ subject, snippet }` of a row: absent fields are empty text. */
export async function readSummary(
  cek: Bytes,
  rowId: string,
  blob: string | null | undefined
): Promise<{ subject: string; snippet: string }> {
  const value = await openJson(cek, 'summary', rowId, blob);
  return { subject: textOrEmpty(value.subject), snippet: textOrEmpty(value.snippet) };
}

/** `{ text, html }` of a row. */
export async function readBody(cek: Bytes, rowId: string, blob: string | null | undefined): Promise<{ text: string; html: string }> {
  const value = await openJson(cek, 'body', rowId, blob);
  return { text: textOrEmpty(value.text), html: textOrEmpty(value.html) };
}

/** `{ text, html, from_e2e }` of a DRAFT: the flag says the mail it answers or forwards was end-to-end encrypted (it is inside the sealed body, never a column). */
export async function readDraftBody(
  cek: Bytes,
  rowId: string,
  blob: string | null | undefined
): Promise<{ text: string; html: string; from_e2e: boolean }> {
  const value = await openJson(cek, 'body', rowId, blob);
  return { text: textOrEmpty(value.text), html: textOrEmpty(value.html), from_e2e: value.from_e2e === true };
}

export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  content_id: string | null;
}

/** `{ filename, mime_type, content_id }` of one attachment (purpose `att-meta/<id>`, bound to the message row). */
export async function readAttachmentMeta(
  cek: Bytes,
  rowId: string,
  attachmentId: string,
  blob: string | null | undefined
): Promise<AttachmentMeta> {
  const value = await openJson(cek, `att-meta/${attachmentId}`, rowId, blob);
  const contentId = textOrEmpty(value.content_id);
  return {
    filename: textOrEmpty(value.filename),
    mime_type: textOrEmpty(value.mime_type),
    content_id: contentId === '' ? null : contentId
  };
}
