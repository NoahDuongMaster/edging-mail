import type { OutgoingAttachment } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `crypto.randomUUID` only exists on https and localhost (not on a phone testing over http): the same v4 fallback as `newDraftId`. */
export function newRowId(): string {
  if ((crypto as Partial<Crypto>).randomUUID !== undefined) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Characters of a snippet: what the Worker keeps (services/email-parser.ts, mail/internal-store.ts), so a copy the server seals reads the same. */
const SNIPPET_CHARS = 180;

/** The preview line of a message: the text (else the html without its tags), white space collapsed, cut like the Worker does. */
export function snippetOf(text: string | null, html: string | null): string {
  const source = text !== null && text.trim() !== '' ? text : (html ?? '').replaceAll(/<[^>]+>/g, ' ');
  const flat = source.trim().replaceAll(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
  // Never end on half of a surrogate pair.
  const last = flat.codePointAt(flat.length - 1) ?? 0;
  return last >= 0xd8_00 && last <= 0xdb_ff ? flat.slice(0, -1) : flat;
}

/** Standard base64 (what `content_base64` of a plain copy is). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x80_00) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + 0x80_00));
  }
  return btoa(binary);
}

const MAX_FIELD_CHARS = 255;

const oneLine = (value: string): string =>
  value
    .replaceAll(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_CHARS);

/** A subject on one line: the server refuses a line break in the subject of a plain copy. */
export const subjectLine = (subject: string): string => subject.replaceAll(/[\r\n]+/g, ' ');

/** The description of a file as every copy states it (the same in sealed and plain copies): one line, within the server's caps. */
export function describeFile(file: OutgoingAttachment): { filename: string; mimeType: string; contentId: string | null } {
  const contentId = file.contentId === null ? '' : oneLine(file.contentId);
  return {
    filename: oneLine(file.filename) || 'attachment',
    mimeType: oneLine(file.mimeType) || 'application/octet-stream',
    contentId: contentId === '' ? null : contentId
  };
}
