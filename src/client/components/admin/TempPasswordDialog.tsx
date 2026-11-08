import React from 'react';
import type { ThemeTokens } from '../../theme';
import { tRich, useT } from '../../lib/i18n';
import { TEMP_PASSWORD_HOURS } from '../../lib/admin/types';
import { Button, CopyButton, SecretBox, Spinner, type CopyResult } from '../../ui';
import { ModalFrame } from './adminUi';

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
  const [copyFailed, setCopyFailed] = React.useState(false);
  const codeRef = React.useRef<HTMLElement | null>(null);

  const onCopied = (result: CopyResult) => {
    setCopyFailed(result === 'failed');
    if (result === 'failed') {
      // No clipboard permission (or an insecure page): select the text so Ctrl+C / long-press works.
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
      <p className="ad-text">{tRich('users.created_give', { address: <strong className="ad-strong ad-wrap">{address}</strong> })}</p>
      <SecretBox label={tr('term.temporary_password')} value={password} valueRef={codeRef}>
        <CopyButton data-autofocus text={password} onResult={onCopied} />
        <span role="status" className="ad-muted" data-tone={copyFailed ? 'danger' : undefined}>
          {copyFailed ? tr('users.copy_failed') : ''}
        </span>
      </SecretBox>
      <ul className="ad-list">
        <li>{tr('users.created_note_once')}</li>
        <li>{tr('users.created_note_expiry', { hours: TEMP_PASSWORD_HOURS })}</li>
        <li>{tr('users.created_note_send')}</li>
      </ul>
      <div className="ad-dialog-foot">
        <Button variant="primary" onClick={onDone}>
          {tr('users.password_saved')}
        </Button>
      </div>
    </ModalFrame>
  );
};

/** A spinner line for a panel that is loading. */
export const Loading: React.FC<{ t: ThemeTokens; label: string }> = ({ label }) => (
  <p role="status" className="ad-loading">
    <Spinner size={14} decorative /> {label}
  </p>
);
