import React from 'react';
import { Lock, LockOpen } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import type { Preview } from '../../lib/sealedmail';
import { InfoTip, Tooltip, useTooltip } from '../../ui';

/**
 * What this message will be (EC-4), at the end of the To row (v3 X1): a lock (or an open lock) whose sentence, "Encrypted in your browser for
 * every recipient." or "Not end-to-end: <reason>.", is its tooltip under the mouse and its text for screen readers (a status, so a change is
 * said); where there is no mouse to point with (a phone, a narrow window) it is a quiet line under the row, so the words stay within reach
 * everywhere (compose.css). There a message that is not end-to-end says only that in its line, and the whole sentence with its reason is in
 * an InfoTip after it (DESIGN-v4m R1); the status (the words alone, never the InfoTip's button) keeps the whole sentence. It says nothing
 * until the lookup has answered for every recipient, and it is information, not a warning: the send still asks whatever it has to ask.
 * `data-compose-state` is the hook for tests ("e2e" or "plain"). `t` is not read any more (the colours are the theme's variables); the
 * compose still passes it.
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
    <span ref={ref} data-compose-state={preview.state} className="cp-lock" {...tip.anchor}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span role="status" className="cp-lock-text">
        {text}
      </span>
      {preview.state === 'plain' ? (
        // Without a mouse: the short line (its words are already the status's) and the reason behind the InfoTip.
        <span className="cp-lock-short ui-tip-row">
          <span aria-hidden="true">{tr('compose.state_plain_short')}</span>
          <InfoTip label={tr('e2e.badge')} size="sm">
            {text}
          </InfoTip>
        </span>
      ) : null}
      <Tooltip open={tip.open} text={text} anchorRef={ref} {...tip.bubble} />
    </span>
  );
};
