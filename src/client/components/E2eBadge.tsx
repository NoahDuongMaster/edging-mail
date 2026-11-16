import type React from 'react';
import { Lock } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { TrustChip } from './reader/TrustChip';

// Its look is in reader.css (`.rd-*`), which MessageView imports.

/**
 * The trust chip of a message that was encrypted in the sender's browser to every recipient's key (`is_e2e`), shown only when the server
 * says no plaintext copy ever reached it. A neutral chip with a lock on the sender's line (a coloured one read as a label): its words and
 * its icon say what it is. It never claims more than the design does: its explanation (a popover) says where the keys come from and what
 * the chip does not cover.
 */
export const E2eBadge: React.FC<{ t: ThemeTokens; sheet?: boolean }> = ({ sheet = false }) => {
  const tr = useT();
  return (
    <TrustChip
      tone="neutral"
      icon={<Lock size={12} strokeWidth={2} aria-hidden="true" />}
      label={tr('e2e.badge')}
      heading={tr('e2e.badge')}
      note={tr('e2e.badge_note')}
      noteId="e2e-badge-note"
      data={{ 'data-e2e-badge': '' }}
      sheet={sheet}
    />
  );
};
