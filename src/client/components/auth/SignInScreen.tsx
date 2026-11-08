import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import { applySignedIn } from '../../lib/auth';
import { finishSecondFactor, startSignIn, abandonSignIn } from '../../lib/crypto/signIn';
import type { SignInOutcome } from '../../lib/crypto/signIn';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { TextField } from '../../ui';
import { AuthButton, AuthCard, CheckboxRow, ErrorLine, TextButton } from './authUi';

interface SignInScreenProps {
  t: ThemeTokens;
  onForgot: () => void;
}

/**
 * Address and password, then the code of the authenticator app when the account has one. The password is turned into what the server checks
 * (and the key that opens the private key) in one derivation inside `startSignIn`; it is cleared from this screen's state as soon as the
 * request has been made. "Shared device" keeps the key in memory only (CK-13).
 */
export const SignInScreen: React.FC<SignInScreenProps> = ({ t, onForgot }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const action = useAction();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [shared, setShared] = React.useState(false);
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = React.useState(false);
  const [code, setCode] = React.useState('');
  const wait = useCountdown(action.retryAfter);
  const firstRef = React.useRef<HTMLInputElement | null>(null);
  const codeRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (challenge === null) {
      firstRef.current?.focus();
    } else {
      codeRef.current?.focus();
    }
  }, [challenge, recoveryMode]);

  // Leaving this screen (signed in, or to Forgot password) drops what a pending second step holds.
  React.useEffect(() => abandonSignIn, []);

  const done = (outcome: SignInOutcome) => {
    if (outcome.kind === 'second_factor') {
      setChallenge(outcome.challenge);
      return;
    }
    applySignedIn(queryClient, outcome.user, outcome.gate);
  };

  const submitCredentials = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0 || email.trim() === '' || password === '') {
      return;
    }
    const outcome = await action.run(() => startSignIn(email, password, { shared }));
    // Whatever the answer, the password has done its job: it does not stay in this screen's state.
    setPassword('');
    if (outcome !== undefined) {
      done(outcome);
    }
  };

  const submitCode = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || challenge === null || code.trim() === '') {
      return;
    }
    const typed = code.trim();
    const outcome = await action.run(() => finishSecondFactor(challenge, recoveryMode ? { recovery_code: typed } : { code: typed }));
    setCode('');
    if (outcome !== undefined) {
      done(outcome);
    }
  };

  const errorText = action.error !== null && wait > 0 ? `${action.error} ${tr('auth.try_again_in', { seconds: wait })}` : action.error;

  if (challenge !== null) {
    return (
      <AuthCard
        t={t}
        picker
        title={tr('auth.second_step_title')}
        lead={recoveryMode ? tr('auth.recovery_code_lead') : tr('auth.second_step_lead')}
        onSubmit={(event) => {
          void submitCode(event);
        }}
      >
        <TextField
          id="signin-code"
          ref={codeRef}
          label={recoveryMode ? tr('auth.recovery_code_label') : tr('auth.code_label')}
          hint={recoveryMode ? tr('auth.recovery_code_hint') : undefined}
          mono
          className={recoveryMode ? undefined : 'au-otp'}
          value={code}
          onChange={(event) => setCode(recoveryMode ? event.target.value : event.target.value.replaceAll(/\D/g, '').slice(0, 6))}
          autoComplete={recoveryMode ? 'off' : 'one-time-code'}
          inputMode={recoveryMode ? 'text' : 'numeric'}
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={errorText !== null}
          aria-describedby={errorText === null ? undefined : 'signin-error'}
        />
        <ErrorLine t={t} id="signin-error" text={errorText} />
        <AuthButton t={t} busy={action.busy} disabled={code.trim() === ''} label={tr('auth.verify')} />
        <div className="au-alt">
          <TextButton
            t={t}
            label={recoveryMode ? tr('auth.use_app_code') : tr('auth.use_recovery_code')}
            onClick={() => {
              setRecoveryMode((current) => !current);
              setCode('');
              action.clear();
            }}
          />
          <TextButton
            t={t}
            label={tr('common.back')}
            onClick={() => {
              abandonSignIn();
              setChallenge(null);
              setCode('');
              setRecoveryMode(false);
              action.clear();
            }}
          />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      t={t}
      picker
      title={tr('auth.sign_in')}
      onSubmit={(event) => {
        void submitCredentials(event);
      }}
    >
      <TextField
        id="signin-email"
        ref={firstRef}
        label={tr('auth.email_label')}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
      />
      <TextField
        id="signin-password"
        label={tr('term.password')}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        aria-invalid={errorText !== null}
        aria-describedby={errorText === null ? undefined : 'signin-error'}
      />
      <ErrorLine t={t} id="signin-error" text={errorText} />
      <CheckboxRow
        t={t}
        id="signin-shared"
        label={tr('auth.shared_device')}
        hint={tr('auth.shared_device_hint')}
        checked={shared}
        onChange={setShared}
      />
      <AuthButton
        t={t}
        busy={action.busy}
        disabled={wait > 0 || email.trim() === '' || password === ''}
        label={action.busy ? tr('login.signing_in') : tr('auth.sign_in')}
      />
      <div className="au-alt">
        <TextButton t={t} label={tr('auth.forgot_password')} onClick={onForgot} />
      </div>
    </AuthCard>
  );
};
