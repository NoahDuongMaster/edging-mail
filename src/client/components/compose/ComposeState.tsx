import React from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import type { Preview } from '../../lib/sealedmail';
import { Tooltip, useTooltip } from '../../ui';

/**
 * What this message will be (EC-4), at the end of the To row (v3 X1): a lock (or an open lock) whose sentence, "Encrypted in your browser for
 * every recipient." or "Not end-to-end: <reason>.", is its tooltip under the mouse and its text for screen readers (a status, so a change is
 * said); where there is no mouse to point with (a phone, a narrow window) the same sentence is a quiet 12 px line under the row, so the words
 * stay within reach everywhere (compose.css). It says nothing until the lookup has answered for every recipient, and it is information, not
 * a warning: the send still asks whatever it has to ask. `data-compose-state` is the hook for tests ("e2e" or "plain"). `t` is not read any
 * more (the colours are the theme's variables); the compose still passes it.
 */
export const ComposeState: React.FC<{ t: ThemeTokens; preview: Preview }> = ({ preview }) => {
  const tr = useT();
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const tip = useTooltip();
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
    <span ref={ref} role="status" data-compose-state={preview.state} className="cp-lock" {...tip.anchor}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="cp-lock-text">{text}</span>
      <Tooltip open={tip.open} text={text} anchorRef={ref} {...tip.bubble} />
    </span>
  );
};
