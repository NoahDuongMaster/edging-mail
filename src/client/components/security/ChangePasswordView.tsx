import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { SessionUser } from '../../lib/auth';
import { changePassword } from '../../lib/crypto/account';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { TextField } from '../../ui';
import { PasswordField } from '../PasswordField';
import { AuthButton, ErrorLine } from '../auth/authUi';
import { DoneNote, Failure, PasswordInput, ViewFrame } from './securityUi';

interface ChangePasswordViewProps {
  t: ThemeTokens;
  user: SessionUser;
  onBack: () => void;
}

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
  // The button can be pressed whenever no request runs and no wait is asked for: a press with something missing shows every field's error and
  // takes the keyboard to the first of them. A press that sends starts the errors over (the current password is emptied whatever the answer).
  const [submitted, setSubmitted] = React.useState(false);
  const focusLater = useFieldFocus();
  const currentError = submitted && current === '' ? tr('security.password_required') : null;
  const mismatch = (repeat !== '' || submitted) && repeat !== next;
  // The new password counts as missing while it is empty, refused or not judged yet (its check loading or failed): the line under it says which.
  const toFix = firstInvalid([
    ['security-current', current === ''],
    ['security-new', check.assessment?.ok !== true],
    ['security-repeat', repeat !== next]
  ]);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0) {
      return;
    }
    if (toFix !== undefined) {
      setSubmitted(true);
      focusLater(toFix);
      return;
    }
    setSubmitted(false);
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
        className="st-view-form"
      >
        {/* A visually hidden copy of the address, so a password manager updates the right entry. Not a secret. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="st-username"
        />
        <PasswordInput
          t={t}
          id="security-current"
          label={tr('security.current_password')}
          value={current}
          onChange={setCurrent}
          invalid={action.error !== null}
          error={currentError}
        />
        <PasswordField
          t={t}
          id="security-new"
          label={tr('gate.new_password')}
          value={next}
          onChange={setNext}
          check={check}
          offerPassphrase={user.role === 'admin'}
          submitted={submitted}
        />
        <div className="au-row">
          <TextField
            id="security-repeat"
            label={tr('gate.repeat_password')}
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'security-mismatch' : undefined}
          />
          <ErrorLine t={t} id="security-mismatch" text={mismatch ? tr('gate.passwords_differ') : null} />
        </div>
        <Failure t={t} id="security-password-error" error={action.error} wait={wait} />
        <div>
          <AuthButton t={t} busy={action.busy} disabled={wait > 0} label={tr('security.change_password')} />
        </div>
        <p className="st-muted">{tr('security.password_note')}</p>
      </form>
    </ViewFrame>
  );
};
