// Caps of `POST /api/messages/internal` (docs/api.md, reports/e2e-contract.md). The Worker holds the whole request in memory (128 MB per
// request), and every recipient gets its OWN sealed copy of every attachment, so the totals are over all copies, not per message.

export const MAX_INTERNAL_BODY_BYTES = 16 * 1024 * 1024;
/** Distinct addresses over To, Cc and Bcc (the same as one key lookup). */
export const MAX_INTERNAL_RECIPIENTS = 50;
export const MAX_ADDRESS_CHARS = 320;
export const MAX_REFERENCE_IDS = 100;

/** Decoded sizes of the sealed parts. A D1 row must stay under 2 MB and base64 adds a third: the body blob is capped at 1 MiB. */
export const MAX_SUMMARY_BLOB_BYTES = 8 * 1024;
export const MAX_BODY_BLOB_BYTES = 1024 * 1024;
export const MAX_META_BLOB_BYTES = 4 * 1024;

export const MAX_ATTACHMENTS_PER_COPY = 32;
/** Attachment objects over all copies: every one is an R2 write and a D1 statement, and a request may make about a thousand subrequests. */
export const MAX_ATTACHMENT_OBJECTS = 100;
/** Attachment bytes over all copies (sealed bytes for a sealed copy, decoded bytes for a plain one). Base64 adds a third, so this stays under the body cap. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** What one person may send end to end in a day (EC-6): request bytes over all sends, in a fixed 24 hour window that starts with the first send. */
export const INTERNAL_DAILY_BYTES = 256 * 1024 * 1024;
export const INTERNAL_DAILY_WINDOW_MS = 24 * 60 * 60_000;

export const MAX_SUBJECT_CHARS = 998;
export const MAX_FIELD_CHARS = 255;
/** Text plus html of a plain copy, UTF-8 (it is sealed into one body blob). */
export const MAX_PLAIN_BODY_BYTES = 1024 * 1024 - 1024;
