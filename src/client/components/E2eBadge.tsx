import React from 'react';
import { Lock } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';

/**
 * The badge of a message that was encrypted in the sender's browser to every recipient's key (`is_e2e`), shown only when the server says
 * no plaintext copy ever reached it. It never claims more than the design does: the note says where the keys come from and what the
 * badge does not cover. One line by default; the person opens the note when they want it.
 */
export const E2eBadge: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  const green = t.dark ? '#4ADE80' : '#15803D';
  return (
    <div data-e2e-badge="" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <button
        type="button"
        className="nm-tap-h"
        aria-expanded={open}
        aria-controls="e2e-badge-note"
        onClick={() => setOpen((current) => !current)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          // 28 px high on a desktop; on a phone the class `nm-tap-h` makes it 44 (an inline minHeight would beat the class).
          lineHeight: '18px',
          padding: '5px 10px',
          borderRadius: 14,
          border: `1px solid ${t.border}`,
          background: 'transparent',
          color: green,
          fontSize: 13,
          cursor: 'pointer'
        }}
      >
        <Lock size={14} strokeWidth={2} aria-hidden="true" />
        {tr('e2e.badge')}
      </button>
      {open ? (
        <p id="e2e-badge-note" style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: t.text2, maxWidth: 560 }}>
          {tr('e2e.badge_note')}
        </p>
      ) : null}
    </div>
  );
};
