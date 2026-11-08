import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import type { SessionUser } from '../../lib/auth';
import { requestLockedDelete } from '../../lib/crypto/account';
import { useT } from '../../lib/i18n';
import { afterLockedChange, isOwnAddress } from '../../lib/lockedMail';
import type { LockedMail } from '../../lib/lockedMail';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { Button, Dialog, TextField } from '../../ui';
import { CODE_LENGTH, CodeInput, Failure, PasswordInput } from './securityUi';
import '../settings/settings.css';

interface LockedMailDialogProps {
  t: ThemeTokens;
  user: SessionUser;
  mail: LockedMail;
  onClose: () => void;
}

/**
 * Where focus goes when the dialog closes and the button that opened it is gone (the banner now shows the date and a Cancel): the account
 * button that is on screen, as for the dialogs opened from Settings. Looked up when the dialog closes, never earlier.
 */
const ACCOUNT_BUTTON: React.RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    const buttons = [...document.querySelectorAll<HTMLElement>('button[data-account-button]')];
    return buttons.find((button) => button.getClientRects().length > 0) ?? null;
  }
};

const FORM_ID = 'locked-delete-form';

/**
 * Deleting the locked old mail, asked in three steps of one form: the person types their own address (so a stray click cannot start it), the
 * password, and the six digits of the authenticator app when the account has two-factor sign-in. Nothing is deleted now; the server waits first and
 * the banner then shows the date and a Cancel. The password and the code are in this screen's state only until the request has answered.
 */
export const LockedMailDialog: React.FC<LockedMailDialogProps> = ({ t, user, mail, onClose }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
  const confirmRef = React.useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const ready = isOwnAddress(typed, user.email) && password !== '' && (!user.totp_enabled || code.length === CODE_LENGTH);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0 || !ready) {
      return;
    }
    const answer = await action.run(() => requestLockedDelete(user, password, code, mail.keyId));
    // The password and the code have done their job: neither stays in this screen's state, whatever the answer was.
    setPassword('');
    setCode('');
    if (answer !== undefined) {
      await afterLockedChange(queryClient);
      onClose();
    }
  };

  // While the request runs the dialog cannot be dismissed (Escape, the scrim and the X do nothing) until it answers.
  const dismiss = () => {
    if (!action.busy) {
      onClose();
    }
  };

  const blocked = !ready || wait > 0;
  return (
    <Dialog
      open
      onClose={dismiss}
      title={tr('locked.dialog_title')}
      description={tr('locked.dialog_body', { count: mail.locked })}
      role="alertdialog"
      initialFocusRef={confirmRef}
      returnFocusRef={ACCOUNT_BUTTON}
      footer={
        <>
          <Button onClick={onClose} disabled={action.busy}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" loading={action.busy} disabled={blocked}>
            {tr('locked.delete')}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        data-locked-dialog
        onSubmit={(event) => {
          void submit(event);
        }}
        className="st-dialog-form"
      >
        <p className="st-muted">{tr('locked.dialog_note')}</p>
        <TextField
          ref={confirmRef}
          id="locked-confirm"
          label={tr('locked.confirm_label', { address: user.email })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={user.email}
        />
        <PasswordInput
          t={t}
          id="locked-password"
          label={tr('term.password')}
          value={password}
          onChange={setPassword}
          invalid={action.error !== null}
        />
        {user.totp_enabled ? <CodeInput t={t} id="locked-code" value={code} onChange={setCode} invalid={action.error !== null} /> : null}
        <Failure t={t} id="locked-error" error={action.error} wait={wait} />
      </form>
    </Dialog>
  );
};
