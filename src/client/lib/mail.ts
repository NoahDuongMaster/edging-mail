import type { Message } from '../types';

const AVATAR_HUES = ['#2F5BEA', '#0F766E', '#C2410C', '#15803D', '#6D28D9', '#BE185D', '#475569'];

/** `value || fallback` for optional strings: '' falls through like null and undefined. */
export function nonEmpty(value: string | null | undefined): string | undefined {
  return value === null || value === '' ? undefined : value;
}

export function stringHue(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    // eslint-disable-next-line unicorn/prefer-code-point -- the hue hashes UTF-16 code units; codePointAt changes it for emoji
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    // eslint-disable-next-line unicorn/prefer-math-trunc -- `|= 0` wraps to int32 on every step; Math.trunc does not wrap
    hash |= 0;
  }
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
}

export function initialsOf(name?: string | null, address?: string): string {
  const source = (nonEmpty(name) ?? nonEmpty(address) ?? '?').trim();
  const words = source
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const last = words.at(-1);
  if (words.length >= 2 && last !== undefined) {
    return (words[0][0] + last[0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/** The sender's own display name when the mail has one. */
function senderName(m: Message): string | undefined {
  return m.from_name === null || m.from_name === undefined || m.from_name.trim() === '' ? undefined : m.from_name;
}

/** The name shown for a sender: the display name, else the address as it is (a guessed "Noreply" would be made up). */
export function displayName(m: Message): string {
  return senderName(m) ?? m.from_address;
}

/** `Name <address>` for a sender with a display name, the bare address otherwise. */
export function formatSender(m: Message): string {
  const name = senderName(m);
  return name === undefined ? m.from_address : `${name} <${m.from_address}>`;
}

export type DateGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupOf(ts: number): DateGroup {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) {
    return 'Today';
  }
  if (diff === 1) {
    return 'Yesterday';
  }
  if (diff <= 7) {
    return 'This week';
  }
  return 'Earlier';
}

export const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

/** The one clock format of the app ("9:31 AM"): the list rows and the snooze times both use it. */
export function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatRowTime(ts: number): string {
  const d = new Date(ts);
  const g = groupOf(ts);
  if (g === 'Today') {
    return formatClock(d);
  }
  if (g === 'Yesterday') {
    return 'Yesterday';
  }
  if (g === 'This week') {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function snippetOf(m: Message, limit = 160): string {
  const raw = (nonEmpty(m.snippet) ?? nonEmpty(m.body_text) ?? '').replaceAll(/\s+/g, ' ').trim();
  if (raw.length <= limit) {
    return raw;
  }
  return `${raw.slice(0, limit).trimEnd()}…`;
}

export function labelsOf(m: Message): string[] {
  const labels = nonEmpty(m.labels);
  if (labels === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

/** The server's rule for a label name (checked again there): letters, digits, space, `_` and `-`, 1 to 30 characters. */
export const LABEL_NAME_PATTERN = /^[\p{L}\p{N} _-]{1,30}$/u;
export const LABEL_NAME_MAX = 30;
export const MAX_LABELS_PER_MESSAGE = 20;
/** The longest search text; the server cuts anything longer. */
export const SEARCH_MAX = 200;

/** The badge text of a file name: its extension (up to 4 letters or digits), else the generic 'FILE'. The name is not a URL ("what?.pdf" is a PDF). */
export function fileTypeOf(value: string): string {
  const base = (value || '').split('/').pop() ?? '';
  // A leading dot (".bashrc") names a hidden file; it is not an extension.
  const ext = base.lastIndexOf('.') > 0 ? base.slice(base.lastIndexOf('.') + 1) : '';
  return /^[a-z0-9]{1,4}$/i.test(ext) ? ext.toUpperCase() : 'FILE';
}

/** The body as plain paragraphs. A mail with HTML has none (the frame shows it) unless `preferText` asks for its plain-text part. */
export function bodyParagraphs(m: Message | null, preferText = false): string[] {
  if (!m) {
    return [];
  }
  if (!preferText && nonEmpty(m.body_html) !== undefined) {
    return [];
  }
  const text = nonEmpty(m.body_text) ?? nonEmpty(m.snippet) ?? '';
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : ['(No content)'];
}
