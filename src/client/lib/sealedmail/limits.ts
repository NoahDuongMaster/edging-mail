import { GCM_TAG_BYTES, IV_BYTES, utf8 } from '../../../shared/crypto/client';
import { snippetOf } from './helpers';
import type { MailContent, OutgoingAttachment } from './types';

// The caps of `POST /api/messages/internal`, mirrored from src/worker/mail/internal-limits.ts (a test compares them). Every recipient gets its
// OWN sealed copy of every file, and the Sent copy is one more, so the totals are files x (people + 1).

export const LIMITS = {
  requestBytes: 16 * 1024 * 1024,
  recipients: 50,
  summaryBlobBytes: 8 * 1024,
  bodyBlobBytes: 1024 * 1024,
  attachmentsPerCopy: 32,
  attachmentObjects: 100,
  attachmentBytes: 10 * 1024 * 1024,
  subjectChars: 998,
  plainBodyBytes: 1024 * 1024 - 1024
} as const;

/** What a sealed blob adds to its plaintext: version byte, IV and tag. */
export const BLOB_OVERHEAD = 1 + IV_BYTES + GCM_TAG_BYTES;

export type LimitKind =
  'body_too_big' | 'subject_too_long' | 'too_many_attachments' | 'attachments_too_big' | 'too_many_recipients' | 'request_too_big';

/** One cap the message is over: the UI offers the normal send route (no end-to-end badge) instead. `limit` and `actual` are bytes, characters or counts. */
export interface LimitProblem {
  kind: LimitKind;
  limit: number;
  actual: number;
}

const base64Chars = (bytes: number): number => Math.ceil(bytes / 3) * 4;
const byteLength = (value: string | null): number => (value === null ? 0 : utf8(value).length);
/** Room for ids, key ids and the wrapped key of a copy, and for the field names around them. */
const COPY_ENVELOPE_CHARS = 700;

/** The size of the whole request once every copy is sealed (base64url text), a little on the high side. */
function requestEstimate(content: MailContent, files: readonly OutgoingAttachment[], recipientCount: number, copies: number): number {
  const summary = utf8(JSON.stringify({ subject: content.subject, snippet: snippetOf(content.text, content.html) })).length + BLOB_OVERHEAD;
  const body = utf8(JSON.stringify({ text: content.text, html: content.html })).length + BLOB_OVERHEAD;
  const attachments = files.reduce(
    (total, file) =>
      total +
      base64Chars(file.bytes.length + BLOB_OVERHEAD) +
      base64Chars(byteLength(file.filename) + byteLength(file.mimeType) + byteLength(file.contentId) + 80 + BLOB_OVERHEAD),
    0
  );
  return copies * (base64Chars(summary) + base64Chars(body) + attachments + COPY_ENVELOPE_CHARS) + recipientCount * 128 + 2048;
}

/**
 * What is over a cap, as data. `recipientCount` is the number of distinct recipient addresses; `copyCount` the number of recipient copies the
 * send will make (people, not addresses; defaults to `recipientCount`, which is the safe side). Empty list: the message fits the internal route.
 */
export function checkLimits(
  content: MailContent,
  attachments: readonly OutgoingAttachment[],
  recipientCount: number,
  copyCount: number = recipientCount
): LimitProblem[] {
  const problems: LimitProblem[] = [];
  if (recipientCount > LIMITS.recipients) {
    problems.push({ kind: 'too_many_recipients', limit: LIMITS.recipients, actual: recipientCount });
  }
  if (content.subject.length > LIMITS.subjectChars) {
    problems.push({ kind: 'subject_too_long', limit: LIMITS.subjectChars, actual: content.subject.length });
  }
  const bodyBlob = utf8(JSON.stringify({ text: content.text, html: content.html })).length + BLOB_OVERHEAD;
  const plainBytes = byteLength(content.text) + byteLength(content.html);
  if (bodyBlob > LIMITS.bodyBlobBytes) {
    problems.push({ kind: 'body_too_big', limit: LIMITS.bodyBlobBytes, actual: bodyBlob });
  } else if (plainBytes > LIMITS.plainBodyBytes) {
    problems.push({ kind: 'body_too_big', limit: LIMITS.plainBodyBytes, actual: plainBytes });
  }

  const copies = copyCount + 1;
  if (attachments.length > LIMITS.attachmentsPerCopy) {
    problems.push({ kind: 'too_many_attachments', limit: LIMITS.attachmentsPerCopy, actual: attachments.length });
  } else if (copies * attachments.length > LIMITS.attachmentObjects) {
    problems.push({ kind: 'too_many_attachments', limit: Math.floor(LIMITS.attachmentObjects / copies), actual: attachments.length });
  }
  const sealedBytes = copies * attachments.reduce((total, file) => total + file.bytes.length + BLOB_OVERHEAD, 0);
  if (sealedBytes > LIMITS.attachmentBytes) {
    problems.push({ kind: 'attachments_too_big', limit: LIMITS.attachmentBytes, actual: sealedBytes });
  }

  // The caps above can all hold and the request still be over its own cap (base64 is a third larger, and the body is sealed once per copy).
  if (!problems.some((problem) => problem.kind === 'body_too_big' || problem.kind === 'attachments_too_big')) {
    const estimate = requestEstimate(content, attachments, recipientCount, copies);
    if (estimate > LIMITS.requestBytes) {
      problems.push({ kind: 'request_too_big', limit: LIMITS.requestBytes, actual: estimate });
    }
  }
  return problems;
}
