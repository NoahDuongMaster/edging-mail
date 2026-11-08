import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { SessionUser } from '../../lib/auth';
import { changePassword } from '../../lib/crypto/account';
import { useT } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { PasswordField } from '../PasswordField';
import { AuthButton, ErrorLine, Field } from '../auth/authUi';
import { DoneNote, Failure, PasswordInput, ViewFrame, controlStyle, formStyle, mutedStyle } from './securityUi';

interface ChangePasswordViewProps {
  t: ThemeTokens;
  user: SessionUser;
  onBack: () => void;
}

// A visually hidden copy of the address, so a password manager updates the right entry. Not a secret.
const HIDDEN: React.CSSProperties = { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' };

/**
 * Change password (crypto-design.md 15.3): the current password, a new one chosen the way every new password is, and a repeat. The lib opens
 * the private key with the current password and wraps it again under the new one, so the mail stays readable; the recovery key stays.
 */
export const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [repeat, setRepeat] = React.useState('');
  const [done, setDone] = React.useState(false);
  const check = usePasswordCheck(next, user.role, contextWords(user.email, user.display_name));
  const mismatch = repeat !== '' && repeat !== next;
  const ready = current !== '' && check.assessment?.ok === true && repeat === next;

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0 || !ready) {
      return;
    }
    const changed = await action.run(async () => {
      await changePassword(user, current, next);
      return true;
    });
    // The current password has done its job whatever the answer. The new one stays only when the request failed, so a retry needs no retyping.
    setCurrent('');
    if (changed === true) {
      setNext('');
      setRepeat('');
      setDone(true);
    }
  };

  if (done) {
    return (
      <ViewFrame t={t} title={tr('term.password')} onBack={null}>
        <DoneNote t={t} text={tr('security.password_changed')} onBack={onBack} />
      </ViewFrame>
    );
  }

  return (
    <ViewFrame t={t} title={tr('term.password')} onBack={onBack}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        style={formStyle}
      >
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={HIDDEN}
        />
        <PasswordInput
          t={t}
          id="security-current"
          label={tr('security.current_password')}
          value={current}
          onChange={setCurrent}
          invalid={action.error !== null}
        />
        <PasswordField
          t={t}
          id="security-new"
          label={tr('gate.new_password')}
          value={next}
          onChange={setNext}
          check={check}
          offerPassphrase={user.role === 'admin'}
        />
        <Field t={t} id="security-repeat" label={tr('gate.repeat_password')}>
          <input
            id="security-repeat"
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={mismatch}
            style={controlStyle(t)}
          />
        </Field>
        <ErrorLine t={t} id="security-mismatch" text={mismatch ? tr('gate.passwords_differ') : null} />
        <Failure t={t} id="security-password-error" error={action.error} wait={wait} />
        <div>
          <AuthButton t={t} busy={action.busy} disabled={!ready || wait > 0} label={tr('security.change_password')} />
        </div>
        <p style={mutedStyle(t)}>{tr('security.password_note')}</p>
      </form>
    </ViewFrame>
  );
};
