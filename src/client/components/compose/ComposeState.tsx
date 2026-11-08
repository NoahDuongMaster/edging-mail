import type React from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import type { Preview } from '../../lib/sealedmail';

/**
 * The quiet line under the recipient fields (EC-4): what this message will be. "Encrypted in your browser for every recipient." or "Not
 * end-to-end: <reason>." It says nothing until the lookup has answered for every recipient, and it is information, not a warning: the send
 * still asks whatever it has to ask. `data-compose-state` is the hook for tests ("e2e" or "plain"). The lock beside the words is a second
 * cue only; the sentence says it. `t` is not read any more (the colours are the theme's variables); the compose still passes it.
 */
export const ComposeState: React.FC<{ t: ThemeTokens; preview: Preview }> = ({ preview }) => {
  const tr = useT();
  if (preview.state === 'unknown') {
    return null;
  }
  let text: string;
  if (preview.state === 'e2e') {
    text = tr('compose.state_e2e');
  } else {
    switch (preview.reason) {
      case 'outside': {
        text = tr('compose.state_plain', { reason: tr('compose.reason_outside') });
        break;
      }
      case 'no_keys': {
        text = tr('compose.state_plain', { reason: tr('compose.reason_no_keys') });
        break;
      }
      case 'big': {
        text = tr('compose.state_plain', { reason: tr('compose.reason_big') });
        break;
      }
    }
  }
  const Icon = preview.state === 'e2e' ? Lock : LockOpen;
  return (
    <p role="status" data-compose-state={preview.state} className="cp-note">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
};
