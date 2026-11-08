import type React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';

/**
 * PX-12: a message that arrived by email from outside, with a From address on a domain this deployment hosts. Anyone can write such an address,
 * and nothing here checks it, so the reader says so once, quietly: a plain chip in the neutral colour, not an alarm, and no claim that the message
 * is fake. A message sent between people of this deployment (`origin: 'internal'`) never shows it.
 */
export const UnverifiedChip: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  return (
    <p
      data-unverified-sender=""
      style={{
        margin: '0 0 16px',
        display: 'flex',
        alignSelf: 'flex-start',
        width: 'fit-content',
        maxWidth: '100%',
        padding: '2px 10px',
        borderRadius: 14,
        border: `1px solid ${t.border}`,
        color: t.text2,
        fontSize: 13,
        lineHeight: '20px'
      }}
    >
      {tr('reader.arrived_by_email')}
    </p>
  );
};
