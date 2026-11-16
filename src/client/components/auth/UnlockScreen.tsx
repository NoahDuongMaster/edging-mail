import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useLogout, useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { unlockWithPassword } from '../../lib/crypto/unlock';
import { sharedDeviceStart } from '../../lib/crypto/sharedDevice';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { pushForSignOut } from '../../lib/push';
import { useAction } from '../../lib/useAction';
import { SecretField } from '../PasswordField';
import { AuthButton, AuthCard, CheckboxRow, ErrorLine, HintedLink, TextButton, TrustLine } from './authUi';
import { openForgotNext } from './nextScreen';

/**
 * The session is valid but this browser holds no key: the page was reloaded after a "shared device" sign-in, the stored key was older than
 * seven days, or it was wiped. The password opens the keys here, in the browser; nothing is sent to the server except the request for the
 * (already public to this session) wrapped keys. Unlock can always be pressed: an empty password is said under the field. 'Forgot password'
 * signs out and opens the forgotten-password flow (it needs the recovery key), as on the sign-in screen.
 */
export const UnlockScreen: React.FC<{ t: ThemeTokens; user: SessionUser }> = ({ t, user }) => {
  const tr = useT();
  const logout = useLogout({ push: pushForSignOut() });
  const action = useAction();
  const [password, setPassword] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const start = sharedDeviceStart(useSession().data?.shared);
  const [chosen, setChosen] = React.useState(start.shared);
  const shared = start.locked || chosen;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const focusLater = useFieldFocus();
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy) {
      return;
    }
    setSubmitted(true);
    const toFix = firstInvalid([['unlock-password', password === '']]);
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    await action.run(() => unlockWithPassword(user, password, { persist: !shared }));
    setPassword('');
    setSubmitted(false);
  };

  const passwordError = submitted && password === '' ? tr('auth.password_required') : undefined;

  return (
    <AuthCard
      t={t}
      picker
      title={tr('keys.unlock_title')}
      lead={tr('keys.unlock_lead', { address: user.email })}
      server="unlock"
      // CK-17: on a shared computer the next person to see this screen is not the owner, so Sign out is the first action on it, before the password.
      topAction={
        <TextButton
          t={t}
          action="unlock-sign-out"
          label={tr('auth.sign_out')}
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        />
      }
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="au-secret-row">
        <SecretField
          id="unlock-password"
          ref={inputRef}
          label={tr('term.password')}
          error={passwordError}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={passwordError !== undefined || action.error !== null}
          aria-describedby={action.error === null ? undefined : 'unlock-error'}
        />
        <ErrorLine t={t} id="unlock-error" text={action.error} />
        {/* The same way out as on sign-in (J4-16): it signs out here and opens the forgotten-password flow with this address. */}
        <HintedLink
          id="unlock-forgot"
          label={tr('auth.forgot_password')}
          hint={tr('keys.unlock_forgot_hint')}
          onClick={() => {
            if (!logout.isPending) {
              openForgotNext(user.email);
              logout.mutate();
            }
          }}
        />
      </div>
      <CheckboxRow
        t={t}
        id="unlock-shared"
        label={tr('auth.shared_device')}
        hint={shared ? tr('auth.shared_device_hint') : tr('auth.shared_device_short')}
        checked={shared}
        onChange={setChosen}
        locked={start.locked}
      />
      <AuthButton t={t} busy={action.busy} label={tr('keys.unlock')} />
      <TrustLine />
    </AuthCard>
  );
};
