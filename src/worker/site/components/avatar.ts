import { esc } from '../html';

/** Tone for avatar initials: default muted, accent for selected user/thread, ghost for alias/service. */
export type AvatarTone = 'default' | 'accent' | 'ghost';

/**
 * A compact initials avatar for mockups and UI fragments.
 * Supports tone strings ('default', 'accent', 'ghost') or boolean (true = accent).
 */
export const avatar = (initials: string, tone: AvatarTone | boolean = 'default'): string => {
  const isAccent = tone === true || tone === 'accent';
  const isGhost = tone === 'ghost';
  const toneClass = isAccent ? ' av-a' : isGhost ? ' av-ghost' : '';
  return `<span class="av${toneClass}">${esc(initials)}</span>`;
};
