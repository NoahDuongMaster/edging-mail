import type { Finding } from './scan';

/**
 * Texts the hard-coded string scan accepts although they have letters: code, class names, identifiers and test-only strings,
 * never a sentence a person reads. Keep this list short and give every entry a reason.
 */
export const ALLOWED_LITERALS: readonly { readonly file: string; readonly text: string; readonly why: string }[] = [
  { file: 'src/client/theme.ts', text: '#ECEEF2', why: 'colour value of the dark theme token `text`, not text' },
  { file: 'src/client/theme.ts', text: '#15171C', why: 'colour value of the light theme token `text`, not text' },
  { file: 'src/client/components/Sidebar.tsx', text: 'C', why: 'the keycap of the Compose shortcut: the key is C in every language' },
  { file: 'src/client/lib/mail.ts', text: 'Today', why: 'internal id of a list date group; MessageList turns it into a heading' },
  { file: 'src/client/lib/mail.ts', text: 'Yesterday', why: 'internal id of a list date group; MessageList turns it into a heading' },
  { file: 'src/client/lib/mail.ts', text: 'This week', why: 'internal id of a list date group; MessageList turns it into a heading' },
  { file: 'src/client/lib/mail.ts', text: 'Earlier', why: 'internal id of a list date group; MessageList turns it into a heading' },
  ...['Edge', 'Opera', 'Firefox', 'Chrome', 'Safari', 'Android', 'Windows', 'Linux'].map((text) => ({
    file: 'src/client/lib/activity.ts',
    text,
    why: 'browser or operating system product name shown in a sign-in row; the same in every language'
  }))
];

export const allowed = (finding: Finding): boolean =>
  ALLOWED_LITERALS.some((entry) => entry.file === finding.file && entry.text === finding.text);
