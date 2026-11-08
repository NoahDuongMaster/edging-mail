import React from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import type { SessionUser } from '../../lib/auth';
import { requestLockedDelete } from '../../lib/crypto/account';
import { useT } from '../../lib/i18n';
import { afterLockedChange, isOwnAddress } from '../../lib/lockedMail';
import type { LockedMail } from '../../lib/lockedMail';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { ModalFrame, adminStyles } from '../admin/adminUi';
import { Field } from '../auth/authUi';
import { CODE_LENGTH, CodeInput, Failure, PasswordInput, controlStyle } from './securityUi';

interface LockedMailDialogProps {
  t: ThemeTokens;
  user: SessionUser;
  mail: LockedMail;
  onClose: () => void;
}

/**
 * Deleting the locked old mail, asked in three steps of one form: the person types their own address (so a stray click cannot start it), the
 * password, and the six digits of the authenticator app when the account has two-factor sign-in. Nothing is deleted now; the server waits first and
 * the banner then shows the date and a Cancel. The password and the code are in this screen's state only until the request has answered.
 */
export const LockedMailDialog: React.FC<LockedMailDialogProps> = ({ t, user, mail, onClose }) => {
  const tr = useT();
  const s = adminStyles(t);
  const queryClient = useQueryClient();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
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

  const blocked = !ready || wait > 0;
  return (
    <ModalFrame t={t} title={tr('locked.dialog_title')} onClose={onClose} locked={action.busy} alert>
      <form
        noValidate
        data-locked-dialog
        onSubmit={(event) => {
          void submit(event);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px' }}>{tr('locked.dialog_body', { count: mail.locked })}</p>
        <p style={s.muted}>{tr('locked.dialog_note')}</p>
        <Field t={t} id="locked-confirm" label={tr('locked.confirm_label', { address: user.email })}>
          <input
            id="locked-confirm"
            data-autofocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={user.email}
            style={controlStyle(t)}
          />
        </Field>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={action.busy} style={s.button}>
            {tr('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={blocked || action.busy}
            style={{
              ...s.dangerButton,
              cursor: action.busy ? 'progress' : blocked ? 'not-allowed' : 'pointer',
              opacity: blocked || action.busy ? 0.5 : 1
            }}
          >
            {action.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
            {tr('locked.delete')}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
};
