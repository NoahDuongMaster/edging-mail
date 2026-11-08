import type React from 'react';
import { ShieldQuestionMark } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { Badge } from '../ui';

// Its look is in reader.css (`.rd-*`), which MessageView imports.

/**
 * PX-12: a message that arrived by email from outside, with a From address on a domain this deployment hosts. Anyone can write such an address,
 * and nothing here checks it, so the reader says so once, quietly: a plain badge in the neutral colour, not an alarm, and no claim that the message
 * is fake. A message sent between people of this deployment (`origin: 'internal'`) never shows it.
 */
export const UnverifiedChip: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  return (
    <p data-unverified-sender="" className="rd-unverified">
      <Badge className="rd-badge">
        <ShieldQuestionMark size={12} strokeWidth={2} aria-hidden="true" />
        {tr('reader.arrived_by_email')}
      </Badge>
    </p>
  );
};
