import type React from 'react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import type { Preview } from '../../lib/sealedmail';

/**
 * The quiet line under the recipient fields (EC-4): what this message will be. "Encrypted in your browser for every recipient." or "Not
 * end-to-end: <reason>." It says nothing until the lookup has answered for every recipient, and it is information, not a warning: the send
 * still asks whatever it has to ask. `data-compose-state` is the hook for tests ("e2e" or "plain").
 */
export const ComposeState: React.FC<{ t: ThemeTokens; preview: Preview }> = ({ t, preview }) => {
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
  return (
    <p
      role="status"
      data-compose-state={preview.state}
      style={{
        margin: 0,
        padding: '8px 24px',
        borderBottom: `1px solid ${t.divider}`,
        color: t.text2,
        fontSize: 12.5,
        lineHeight: '18px'
      }}
    >
      {text}
    </p>
  );
};
