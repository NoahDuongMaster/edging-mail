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
 * scrim and the close button do nothing until the password was copied: "I have saved it" is the way out, and the X only appears once
 * Copy put the password on the clipboard (J4-35: a disabled X drawn like a live one said nothing).
 */
export const TempPasswordDialog: React.FC<TempPasswordDialogProps> = ({ t, address, password, reissued = false, onDone }) => {
  const tr = useT();
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const codeRef = React.useRef<HTMLElement | null>(null);

  const onCopied = (result: CopyResult) => {
    setCopyFailed(result === 'failed');
    if (result === 'copied') {
      setCopied(true);
    }
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

  const foot = (
    <Button variant="primary" onClick={onDone}>
      {tr('users.password_saved')}
    </Button>
  );

  return (
    // "I have saved it" is the dialog's foot: fixed at the bottom of a phone's sheet, the way out at any time.
    <ModalFrame
      t={t}
      title={tr(reissued ? 'users.reissued_title' : 'users.created_title')}
      closeButton={copied}
      footer={foot}
      onClose={onDone}
      locked={!copied}
      maxWidth={460}
    >
      <p className="adm-text">{tRich('users.created_give', { address: <strong className="adm-strong adm-wrap">{address}</strong> })}</p>
      <SecretBox label={tr('term.temporary_password')} value={password} valueRef={codeRef}>
        <CopyButton data-autofocus text={password} onResult={onCopied} />
        <span role="status" className="adm-muted" data-tone={copyFailed ? 'danger' : undefined}>
          {copyFailed ? tr('users.copy_failed') : ''}
        </span>
      </SecretBox>
      <ul className="adm-list">
        <li>{tr('users.created_note_once')}</li>
        <li>{tr('users.created_note_expiry', { hours: TEMP_PASSWORD_HOURS })}</li>
        <li>{tr('users.created_note_send')}</li>
      </ul>
    </ModalFrame>
  );
};

/** A spinner line for a panel that is loading. */
export const Loading: React.FC<{ t: ThemeTokens; label: string }> = ({ label }) => (
  <p role="status" className="adm-loading">
    <Spinner size={14} decorative /> {label}
  </p>
);
