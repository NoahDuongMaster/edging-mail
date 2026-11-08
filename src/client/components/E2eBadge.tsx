import React from 'react';
import { Lock } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { Badge, Disclosure } from '../ui';

// Its look is in reader.css (`.rd-*`), which MessageView imports.

/**
 * The badge of a message that was encrypted in the sender's browser to every recipient's key (`is_e2e`), shown only when the server says
 * no plaintext copy ever reached it. It never claims more than the design does: the note says where the keys come from and what the
 * badge does not cover. One line by default; the person opens the note when they want it.
 */
export const E2eBadge: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <div data-e2e-badge="" className="rd-e2e">
      {/* The button is the touch target (44 px high on a phone through `nm-tap-h`); the badge inside it is the look. */}
      <Disclosure className="nm-tap-h rd-badge-btn" open={open} onOpenChange={setOpen} controls="e2e-badge-note">
        <Badge tone="success" className="rd-badge">
          <Lock size={12} strokeWidth={2} aria-hidden="true" />
          {tr('e2e.badge')}
        </Badge>
      </Disclosure>
      {/* The note is always in the page (hidden while closed), so the button's aria-controls names an element that exists. */}
      <p id="e2e-badge-note" className="rd-e2e-note" hidden={!open}>
        {tr('e2e.badge_note')}
      </p>
    </div>
  );
};
