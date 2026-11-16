import type React from 'react';
import { Ban, TriangleAlert } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { TrustChip } from './reader/TrustChip';

// Its look is in reader.css (`.rd-*`), which MessageView imports.

interface UnverifiedChipProps {
  t: ThemeTokens;
  /** Moves the message to Spam (J4-34: offered in the explanation); not given in Spam itself. */
  onSpam?: () => void;
  /** A phone: the explanation is a bottom sheet (J3-26). */
  sheet?: boolean;
}

/**
 * PX-12: a message that arrived by email from outside, with a From address on a domain this deployment hosts. Anyone can write such an address,
 * and nothing here checks it, so the reader says so once, as a caution, not an alarm: a chip in the warning tone (warning-soft fill, warning
 * text and icon, 4.5:1 and more) beside the sender ("Unverified sender"), visibly unlike the neutral chip of a sealed message, and no
 * claim that the message is fake; the chip opens the explanation in plain words (J4-34: who it may not be from, why, what to be careful
 * with) and a quiet "Move to Spam". A message sent between people of this deployment (`origin: 'internal'`) never shows it.
 */
export const UnverifiedChip: React.FC<UnverifiedChipProps> = ({ onSpam, sheet = false }) => {
  const tr = useT();
  return (
    <TrustChip
      tone="warning"
      icon={<TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />}
      label={tr('reader.unverified_sender')}
      heading={tr('reader.arrived_by_email')}
      note={tr('reader.unverified_note')}
      noteId="unverified-sender-note"
      data={{ 'data-unverified-sender': '' }}
      sheet={sheet}
      action={
        onSpam === undefined
          ? undefined
          : { label: tr('action.move_to_spam'), icon: <Ban size={16} strokeWidth={1.75} aria-hidden="true" />, run: onSpam }
      }
    />
  );
};
