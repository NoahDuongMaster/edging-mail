import type React from 'react';
import { Lock } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../i18n';
import { NOTE_KEYS } from './texts';
import type { Unreadable } from './texts';

/** The reader's body for a message the browser could not open: says why, in calm words. */
export const MailNote: React.FC<{ t: ThemeTokens; state: Unreadable }> = ({ t, state }) => {
  const tr = useT();
  return (
    <div
      role="status"
      data-mail-state={state}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        maxWidth: '68ch',
        padding: '14px 16px',
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: t.raised,
        color: t.text2,
        fontSize: 14,
        lineHeight: '22px'
      }}
    >
      <Lock size={18} strokeWidth={1.8} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      <span>{tr(NOTE_KEYS[state])}</span>
    </div>
  );
};
