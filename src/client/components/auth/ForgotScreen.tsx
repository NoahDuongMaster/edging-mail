import React from 'react';
import { RecoveryKeyError, decodeRecoveryKey } from '../../../shared/crypto/client';
import type { ThemeTokens } from '../../theme';
import { ForgotFlow } from '../../lib/crypto/forgot';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { recoveryKeyProblemText } from '../../lib/crypto/errors';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { PasswordField } from '../PasswordField';
import { TextField } from '../../ui';
import { AuthButton, AuthCard, ErrorLine, TextButton } from './authUi';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';

interface ForgotScreenProps {
  t: ThemeTokens;
  initialEmail: string;
  onBack: () => void;
  onBreakGlass: () => void;
}

type Step = 'details' | 'password' | 'key' | 'done';

/** The typed key is read (length, alphabet, check characters) as soon as it is long enough: a typo is shown here, before any request. */
function useKeyProblem(text: string): string | null {
  // The verdict is kept with the text it is about, so a verdict on an older text is never shown for a newer one.
  const [verdict, setVerdict] = React.useState<{ text: string; problem: string | null } | null>(null);
  // A key is 54 symbols; anything shorter is not judged while the person is still typing it.
  const judged = text.replaceAll(/[\s-]/g, '').length >= 54;
  React.useEffect(() => {
    if (!judged) {
      return;
    }
    const run = { cancelled: false };
    void decodeRecoveryKey(text).then(
      (key) => {
        key.fill(0);
        if (!run.cancelled) {
          setVerdict({ text, problem: null });
        }
      },
      (error: unknown) => {
        if (!run.cancelled) {
          setVerdict({ text, problem: error instanceof RecoveryKeyError ? recoveryKeyProblemText(error) : null });
        }
      }
    );
    return () => {
      run.cancelled = true;
    };
  }, [text, judged]);
  return judged && verdict?.text === text ? verdict.problem : null;
}

/**
 * Forgot password, three steps (crypto-design.md 15.3): the recovery key (and a code when the account has two-factor sign-in), a new password,
 * then a NEW recovery key that must be shown and confirmed BEFORE the one request that changes anything. An abandoned flow changes nothing.
 */
export const ForgotScreen: React.FC<ForgotScreenProps> = ({ t, initialEmail, onBack, onBreakGlass }) => {
  const tr = useT();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
  const [step, setStep] = React.useState<Step>('details');
  const [email, setEmail] = React.useState(initialEmail);
  const [recoveryText, setRecoveryText] = React.useState('');
  const [factor, setFactor] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [repeat, setRepeat] = React.useState('');
  // The opened private key with its ticket, and the new recovery key: held only by this screen, zeroed when replaced and when it goes.
  const [flow, setFlow] = React.useState<ForgotFlow | null>(null);
  const [draft, setDraft] = React.useState<RecoveryKeyDraft | null>(null);
  const chosen = React.useRef<string | null>(null);
  const keyProblem = useKeyProblem(recoveryText);
  const role = (flow?.minPasswordLength ?? 12) >= 16 ? 'admin' : 'member';
  const check = usePasswordCheck(password, role, contextWords(email));

  React.useEffect(
    () => () => {
      flow?.discard();
    },
    [flow]
  );
  React.useEffect(
    () => () => {
      draft?.discard();
    },
    [draft]
  );
  React.useEffect(
    () => () => {
      chosen.current = null;
    },
    []
  );

  const verify = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0 || keyProblem !== null || email.trim() === '' || recoveryText.trim() === '') {
      return;
    }
    const verified = await action.run(() => ForgotFlow.verify(email, recoveryText, factor));
    // The recovery key has done its job: it does not stay in this screen's state.
    setRecoveryText('');
    setFactor('');
    if (verified !== undefined) {
      setFlow(verified);
      setStep('password');
    }
  };

  // The password step's Continue can always be pressed: a press with something missing shows both fields' errors and takes the keyboard to the first.
  const [submitted, setSubmitted] = React.useState(false);
  const focusLater = useFieldFocus();
  const mismatch = (repeat !== '' || submitted) && repeat !== password;
  // The new password counts as missing while it is empty, refused or not judged yet (its check loading or failed): the line under it says which.
  const toFix = firstInvalid([
    ['forgot-new', check.assessment?.ok !== true],
    ['forgot-repeat', repeat !== password]
  ]);
  const toKey = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy) {
      return;
    }
    setSubmitted(true);
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    const made = await action.run(() => RecoveryKeyDraft.create());
    if (made !== undefined) {
      chosen.current = password;
      setPassword('');
      setRepeat('');
      setDraft(made);
      setStep('key');
    }
  };

  if (step === 'done') {
    return (
      <AuthCard t={t} title={tr('forgot.done_title')} lead={tr('forgot.done_lead')}>
        <AuthButton t={t} type="button" label={tr('forgot.done_button')} onClick={onBack} />
      </AuthCard>
    );
  }

  if (step === 'key' && flow !== null && draft !== null) {
    return (
      <AuthCard t={t} wide title={tr('recovery.title_new')} lead={tr('forgot.key_lead')}>
        <RecoveryKeyPanel
          t={t}
          draft={draft}
          address={email}
          replaces
          cancelLabel={tr('common.cancel')}
          onCancel={onBack}
          onConfirmed={async () => {
            const chosenPassword = chosen.current;
            if (chosenPassword === null) {
              throw new Error('the chosen password is gone');
            }
            await flow.complete(chosenPassword, draft);
            chosen.current = null;
            setStep('done');
          }}
        />
        <p className="au-note">{tr('forgot.nothing_changed')}</p>
      </AuthCard>
    );
  }

  if (step === 'password' && flow !== null) {
    return (
      <AuthCard
        t={t}
        title={tr('forgot.password_title')}
        lead={tr('forgot.password_lead')}
        onSubmit={(event) => {
          void toKey(event);
        }}
      >
        <PasswordField
          t={t}
          id="forgot-new"
          label={tr('gate.new_password')}
          value={password}
          onChange={setPassword}
          check={check}
          offerPassphrase={role === 'admin'}
          submitted={submitted}
        />
        <div className="au-row">
          <TextField
            id="forgot-repeat"
            label={tr('gate.repeat_password')}
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'forgot-mismatch' : undefined}
          />
          <ErrorLine t={t} id="forgot-mismatch" text={mismatch ? tr('gate.passwords_differ') : null} />
        </div>
        <ErrorLine t={t} id="forgot-error" text={action.error} />
        <AuthButton t={t} busy={action.busy} label={tr('gate.continue')} />
        <div className="au-alt">
          <TextButton t={t} label={tr('common.cancel')} onClick={onBack} />
        </div>
      </AuthCard>
    );
  }

  const errorText =
    keyProblem ?? (action.error !== null && wait > 0 ? `${action.error} ${tr('auth.try_again_in', { seconds: wait })}` : action.error);
  return (
    <AuthCard
      t={t}
      picker
      title={tr('forgot.title')}
      lead={tr('forgot.lead')}
      onSubmit={(event) => {
        void verify(event);
      }}
    >
      <TextField
        id="forgot-email"
        label={tr('auth.email_label')}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
      />
      <TextField
        id="forgot-key"
        label={tr('term.recovery_key')}
        hint={tr('forgot.key_hint')}
        mono
        className="au-key-input"
        value={recoveryText}
        onChange={(event) => setRecoveryText(event.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        translate="no"
        aria-invalid={keyProblem !== null}
        aria-describedby={errorText === null ? undefined : 'forgot-error'}
      />
      <TextField
        id="forgot-code"
        label={tr('forgot.code_label')}
        hint={tr('forgot.code_hint')}
        mono
        value={factor}
        onChange={(event) => setFactor(event.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <ErrorLine t={t} id="forgot-error" text={errorText} />
      <AuthButton
        t={t}
        busy={action.busy}
        disabled={wait > 0 || keyProblem !== null || email.trim() === '' || recoveryText.trim() === ''}
        label={tr('gate.continue')}
      />
      <div className="au-alt">
        <TextButton t={t} label={tr('forgot.admin_link')} onClick={onBreakGlass} />
        <TextButton t={t} label={tr('common.back')} onClick={onBack} />
      </div>
    </AuthCard>
  );
};
