import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import { applySignedIn } from '../../lib/auth';
import { finishSecondFactor, startSignIn, abandonSignIn } from '../../lib/crypto/signIn';
import type { SignInOutcome } from '../../lib/crypto/signIn';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { SecretField } from '../PasswordField';
import { TextField } from '../../ui';
import { AuthActions, AuthButton, AuthCard, CheckboxRow, ErrorLine, HintedLink, TextButton, TrustLine, useAuthPhone } from './authUi';

interface SignInScreenProps {
  t: ThemeTokens;
  onForgot: () => void;
}

/** An address the server can look up: something, an @, something (the server judges the rest). */
const looksLikeAddress = (text: string): boolean => /^[^\s@]+@[^\s@]+$/.test(text.trim());

const CODE_LENGTH = 6;

/**
 * Address and password, then the code of the authenticator app when the account has one. The password is turned into what the server checks
 * (and the key that opens the private key) in one derivation inside `startSignIn`; it is cleared from this screen's state as soon as the
 * request has been made. "Shared device" keeps the key in memory only (CK-13). Sign in and Verify can always be pressed: a press with a
 * field missing says so under that field and moves the keyboard there; only a running request or a wait the server asked for disables them.
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
  const [submitted, setSubmitted] = React.useState(false);
  const wait = useCountdown(action.retryAfter);
  const firstRef = React.useRef<HTMLInputElement | null>(null);
  const codeRef = React.useRef<HTMLInputElement | null>(null);
  const focusLater = useFieldFocus();
  const phone = useAuthPhone();

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
      setSubmitted(false);
      setChallenge(outcome.challenge);
      return;
    }
    applySignedIn(queryClient, outcome.user, outcome.gate);
  };

  const emailError = submitted && !looksLikeAddress(email) ? tr('auth.address_invalid') : undefined;
  const passwordError = submitted && password === '' ? tr('auth.password_required') : undefined;
  const codeMissing = recoveryMode ? code.trim() === '' : code.length !== CODE_LENGTH;
  const codeError = submitted && codeMissing ? tr(recoveryMode ? 'auth.recovery_code_required' : 'twofa.code_required') : undefined;

  const submitCredentials = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0) {
      return;
    }
    setSubmitted(true);
    const toFix = firstInvalid([
      ['signin-email', !looksLikeAddress(email)],
      ['signin-password', password === '']
    ]);
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    const outcome = await action.run(() => startSignIn(email, password, { shared }));
    // Whatever the answer, the password has done its job: it does not stay in this screen's state.
    setPassword('');
    setSubmitted(false);
    if (outcome !== undefined) {
      done(outcome);
    }
  };

  const submitCode = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || challenge === null) {
      return;
    }
    setSubmitted(true);
    const toFix = firstInvalid([['signin-code', codeMissing]]);
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    const typed = code.trim();
    const outcome = await action.run(() => finishSecondFactor(challenge, recoveryMode ? { recovery_code: typed } : { code: typed }));
    setCode('');
    setSubmitted(false);
    if (outcome !== undefined) {
      done(outcome);
    }
  };

  const errorText = action.error !== null && wait > 0 ? `${action.error} ${tr('auth.try_again_in', { seconds: wait })}` : action.error;

  if (challenge !== null) {
    const back = () => {
      abandonSignIn();
      setChallenge(null);
      setCode('');
      setRecoveryMode(false);
      setSubmitted(false);
      action.clear();
    };
    return (
      <AuthCard
        t={t}
        picker
        // The password was step 1: the code is the last step of this sign-in (J4-09).
        step={{ current: 2, total: 2 }}
        title={tr('auth.second_step_title')}
        lead={recoveryMode ? tr('auth.recovery_code_lead') : tr('auth.second_step_lead')}
        back={{ label: tr('common.back'), onClick: back }}
        onSubmit={(event) => {
          void submitCode(event);
        }}
      >
        <TextField
          id="signin-code"
          ref={codeRef}
          label={recoveryMode ? tr('auth.recovery_code_label') : tr('auth.code_label')}
          hint={recoveryMode ? tr('auth.recovery_code_hint') : undefined}
          error={codeError}
          mono
          className={recoveryMode ? 'au-key-input' : 'au-otp'}
          value={code}
          onChange={(event) => setCode(recoveryMode ? event.target.value : event.target.value.replaceAll(/\D/g, '').slice(0, CODE_LENGTH))}
          autoComplete={recoveryMode ? 'off' : 'one-time-code'}
          inputMode={recoveryMode ? 'text' : 'numeric'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={codeError !== undefined || errorText !== null}
          aria-describedby={errorText === null ? undefined : 'signin-error'}
        />
        <ErrorLine t={t} id="signin-error" text={errorText} />
        <AuthActions
          after={
            <div className="au-alt">
              <TextButton
                t={t}
                label={recoveryMode ? tr('auth.use_app_code') : tr('auth.use_recovery_code')}
                onClick={() => {
                  setRecoveryMode((current) => !current);
                  setCode('');
                  setSubmitted(false);
                  action.clear();
                }}
              />
              {/* On a phone Back is the arrow at the start of the top bar (AuthCard `back`). */}
              {phone ? null : <TextButton t={t} label={tr('common.back')} onClick={back} />}
            </div>
          }
        >
          <AuthButton t={t} busy={action.busy} label={tr('auth.verify')} />
        </AuthActions>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      t={t}
      picker
      title={tr('auth.sign_in_title')}
      pageTitle={tr('auth.sign_in')}
      server="sign-in"
      onSubmit={(event) => {
        void submitCredentials(event);
      }}
    >
      <TextField
        id="signin-email"
        ref={firstRef}
        label={tr('auth.email_label')}
        type="email"
        error={emailError}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="username"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {/* The password, the form's error under it, then Forgot password (on the label row with a mouse) and what a reset needs. */}
      <div className="au-secret-row">
        <SecretField
          id="signin-password"
          label={tr('term.password')}
          error={passwordError}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={passwordError !== undefined || errorText !== null}
          aria-describedby={errorText === null ? undefined : 'signin-error'}
        />
        <ErrorLine t={t} id="signin-error" text={errorText} />
        <HintedLink id="signin-forgot" label={tr('auth.forgot_password')} hint={tr('auth.forgot_hint')} onClick={onForgot} />
      </div>
      <CheckboxRow
        t={t}
        id="signin-shared"
        label={tr('auth.shared_device')}
        hint={shared ? tr('auth.shared_device_hint') : tr('auth.shared_device_short')}
        note={shared ? tr('auth.shared_device_hint_short') : undefined}
        checked={shared}
        onChange={setShared}
      />
      <AuthActions after={<TrustLine />}>
        <AuthButton t={t} busy={action.busy} disabled={wait > 0} label={action.busy ? tr('login.signing_in') : tr('auth.sign_in')} />
      </AuthActions>
    </AuthCard>
  );
};
