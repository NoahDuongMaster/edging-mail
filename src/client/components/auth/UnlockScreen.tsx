import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useLogout, useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { unlockWithPassword } from '../../lib/crypto/unlock';
import { sharedDeviceStart } from '../../lib/crypto/sharedDevice';
import { useT } from '../../lib/i18n';
import { pushForSignOut } from '../../lib/push';
import { useAction } from '../../lib/useAction';
import { AuthButton, AuthCard, CheckboxRow, ErrorLine, Field, TextButton, inputStyle } from './authUi';

/**
 * The session is valid but this browser holds no key: the page was reloaded after a "shared device" sign-in, the stored key was older than
 * seven days, or it was wiped. The password opens the keys here, in the browser; nothing is sent to the server except the request for the
 * (already public to this session) wrapped keys.
 */
export const UnlockScreen: React.FC<{ t: ThemeTokens; user: SessionUser }> = ({ t, user }) => {
  const tr = useT();
  const logout = useLogout({ push: pushForSignOut() });
  const action = useAction();
  const [password, setPassword] = React.useState('');
  const start = sharedDeviceStart(useSession().data?.shared);
  const [chosen, setChosen] = React.useState(start.shared);
  const shared = start.locked || chosen;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || password === '') {
      return;
    }
    await action.run(() => unlockWithPassword(user, password, { persist: !shared }));
    setPassword('');
  };

  return (
    <AuthCard
      t={t}
      picker
      title={tr('keys.unlock_title')}
      lead={tr('keys.unlock_lead', { address: user.email })}
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
      <Field t={t} id="unlock-password" label={tr('term.password')}>
        <input
          id="unlock-password"
          ref={inputRef}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={action.error !== null}
          aria-describedby={action.error === null ? undefined : 'unlock-error'}
          style={inputStyle(t)}
        />
      </Field>
      <ErrorLine t={t} id="unlock-error" text={action.error} />
      <CheckboxRow
        t={t}
        id="unlock-shared"
        label={tr('auth.shared_device')}
        hint={tr('auth.shared_device_hint')}
        checked={shared}
        onChange={setChosen}
        locked={start.locked}
      />
      <AuthButton t={t} busy={action.busy} disabled={password === ''} label={tr('keys.unlock')} />
    </AuthCard>
  );
};
