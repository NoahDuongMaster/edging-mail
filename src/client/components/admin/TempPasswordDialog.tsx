import React from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT } from '../../lib/i18n';
import { TEMP_PASSWORD_HOURS } from '../../lib/admin/types';
import { ModalFrame, adminStyles } from './adminUi';

interface TempPasswordDialogProps {
  t: ThemeTokens;
  address: string;
  password: string;
  /** A new temporary password for an account that already exists (not a new account): the title says so. */
  reissued?: boolean;
  onDone: () => void;
}

/**
 * The temporary password of a new account, shown once. It is not stored anywhere in the app and cannot be shown again, so Escape, the
 * scrim and the close button do nothing: only "I have saved it" closes the dialog.
 */
export const TempPasswordDialog: React.FC<TempPasswordDialogProps> = ({ t, address, password, reissued = false, onDone }) => {
  const tr = useT();
  const s = adminStyles(t);
  const [copied, setCopied] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const codeRef = React.useRef<HTMLElement | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied('copied');
    } catch {
      // No clipboard permission (or an insecure page): select the text so Ctrl+C / long-press works.
      setCopied('failed');
      const range = document.createRange();
      if (codeRef.current) {
        range.selectNodeContents(codeRef.current);
        const selection = globalThis.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  return (
    <ModalFrame t={t} title={tr(reissued ? 'users.reissued_title' : 'users.created_title')} onClose={onDone} locked maxWidth={460}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px' }}>
        {tRich('users.created_give', { address: <strong style={{ overflowWrap: 'anywhere' }}>{address}</strong> })}
      </p>
      <div style={{ ...s.card, background: t.raised, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <code
          ref={codeRef}
          aria-label={tr('term.temporary_password')}
          style={{
            fontFamily: "'Geist Mono', ui-monospace, monospace",
            fontSize: 18,
            letterSpacing: '0.03em',
            userSelect: 'all',
            overflowWrap: 'anywhere'
          }}
        >
          {password}
        </code>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-autofocus
            className="nm-tap-h"
            onClick={() => {
              void copy();
            }}
            style={s.button}
          >
            {copied === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied === 'copied' ? tr('common.copied') : tr('common.copy')}
          </button>
          <span role="status" style={{ ...s.muted, color: copied === 'failed' ? s.danger : t.text2 }}>
            {copied === 'failed' ? tr('users.copy_failed') : ''}
          </span>
        </div>
      </div>
      <ul style={{ ...s.muted, margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>{tr('users.created_note_once')}</li>
        <li>{tr('users.created_note_expiry', { hours: TEMP_PASSWORD_HOURS })}</li>
        <li>{tr('users.created_note_send')}</li>
      </ul>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={s.primary}>
          {tr('users.password_saved')}
        </button>
      </div>
    </ModalFrame>
  );
};

/** A spinner line for a panel that is loading. */
export const Loading: React.FC<{ t: ThemeTokens; label: string }> = ({ t, label }) => (
  <p role="status" style={{ ...adminStyles(t).muted, display: 'flex', alignItems: 'center', gap: 8 }}>
    <Loader2 size={14} className="nm-spin" aria-hidden="true" /> {label}
  </p>
);
