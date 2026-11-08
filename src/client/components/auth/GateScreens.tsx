import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import { applySignedIn, useLogout, useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { completeFirstPassword, completeKeySetup, finishGates, gateCredentialsFromPassword } from '../../lib/crypto/gates';
import { readGateCredentials } from '../../lib/crypto/gateCredentials';
import type { GateCredentials } from '../../lib/crypto/gateCredentials';
import { sharedDeviceStart } from '../../lib/crypto/sharedDevice';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { pushForSignOut } from '../../lib/push';
import { useAction } from '../../lib/useAction';
import { PasswordField } from '../PasswordField';
import { TextField } from '../../ui';
import { AuthButton, AuthCard, CheckboxRow, ErrorLine, TextButton } from './authUi';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { TwoFactorEnrolment } from './TwoFactorEnrolment';

interface GateProps {
  t: ThemeTokens;
  user: SessionUser;
}

const SignOutButton: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const logout = useLogout({ push: pushForSignOut() });
  return (
    <div className="au-alt">
      <TextButton t={t} label={tr('auth.sign_out')} disabled={logout.isPending} onClick={() => logout.mutate()} />
    </div>
  );
};

interface CurrentPasswordProps extends GateProps {
  title: string;
  lead: string;
  label: string;
  onReady: (credentials: GateCredentials) => void;
}

/** Shown when the sign-in's own copy of the credentials is gone (the page was reloaded in the middle of a gate): the current password, once. */
const CurrentPasswordStep: React.FC<CurrentPasswordProps> = ({ t, user, title, lead, label, onReady }) => {
  const tr = useT();
  const action = useAction();
  const [password, setPassword] = React.useState('');
  const start = sharedDeviceStart(useSession().data?.shared);
  const [chosen, setChosen] = React.useState(start.shared);
  const shared = start.locked || chosen;
  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || password === '') {
      return;
    }
    const credentials = await action.run(() => gateCredentialsFromPassword(user.email, password, !shared));
    setPassword('');
    if (credentials !== undefined) {
      onReady(credentials);
    }
  };
  return (
    <AuthCard
      t={t}
      title={title}
      lead={lead}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <TextField
        id="gate-current"
        label={label}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
      />
      <ErrorLine t={t} id="gate-current-error" text={action.error} />
      <CheckboxRow
        t={t}
        id="gate-shared"
        label={tr('auth.shared_device')}
        hint={tr('auth.shared_device_hint')}
        checked={shared}
        onChange={setChosen}
        locked={start.locked}
      />
      <AuthButton t={t} busy={action.busy} disabled={password === ''} label={tr('gate.continue')} />
      <SignOutButton t={t} />
    </AuthCard>
  );
};

/** Keeps a recovery key draft for as long as its screen is mounted, and zeroes it afterwards. */
function useDraft(active: boolean): RecoveryKeyDraft | null {
  const [draft, setDraft] = React.useState<RecoveryKeyDraft | null>(null);
  React.useEffect(() => {
    if (!active) {
      return;
    }
    let made: RecoveryKeyDraft | null = null;
    let cancelled = false;
    void RecoveryKeyDraft.create().then((created) => {
      if (cancelled) {
        created.discard();
        return;
      }
      made = created;
      setDraft(created);
    });
    return () => {
      cancelled = true;
      made?.discard();
      setDraft(null);
    };
  }, [active]);
  return draft;
}

/**
 * Gate 1: the account is still on the temporary password an admin made. Choose a password, then see and confirm the recovery key; the
 * new password, the first keys and the recovery key's proof then go in ONE request, so there is never a state with a password but no way back.
 */
export const FirstPasswordScreen: React.FC<GateProps> = ({ t, user }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(readGateCredentials);
  const [password, setPassword] = React.useState('');
  const [repeat, setRepeat] = React.useState('');
  const [step, setStep] = React.useState<'password' | 'key'>('password');
  // The chosen password waits here between the two steps (not in state) and is dropped when the request has gone or the screen goes.
  const chosen = React.useRef<string | null>(null);
  React.useEffect(
    () => () => {
      chosen.current = null;
    },
    []
  );
  const check = usePasswordCheck(password, user.role, contextWords(user.email, user.display_name));
  const draft = useDraft(step === 'key');
  // Continue can always be pressed: a press with something missing shows both fields' errors and takes the keyboard to the first of them.
  const [submitted, setSubmitted] = React.useState(false);
  const focusLater = useFieldFocus();

  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        title={tr('gate.password_title')}
        lead={tr('gate.current_password_lead')}
        label={tr('term.temporary_password')}
        onReady={setCredentials}
      />
    );
  }
  if (step === 'key') {
    return (
      <AuthCard t={t} wide title={tr('recovery.title_first')}>
        {draft === null ? null : (
          <RecoveryKeyPanel
            t={t}
            draft={draft}
            address={user.email}
            replaces={false}
            cancelLabel={tr('common.back')}
            onCancel={() => setStep('password')}
            onConfirmed={async () => {
              const chosenPassword = chosen.current;
              if (chosenPassword === null) {
                throw new Error('the chosen password is gone');
              }
              const signedIn = await completeFirstPassword(credentials, chosenPassword, draft);
              chosen.current = null;
              applySignedIn(queryClient, signedIn);
            }}
          />
        )}
      </AuthCard>
    );
  }
  const mismatch = (repeat !== '' || submitted) && repeat !== password;
  // The new password counts as missing while it is empty, refused or not judged yet (its check loading or failed): the line under it says which.
  const toFix = firstInvalid([
    ['gate-new', check.assessment?.ok !== true],
    ['gate-repeat', repeat !== password]
  ]);
  return (
    <AuthCard
      t={t}
      title={tr('gate.password_title')}
      lead={tr('gate.password_lead')}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (toFix !== undefined) {
          focusLater(toFix);
          return;
        }
        chosen.current = password;
        setPassword('');
        setRepeat('');
        // Back from the recovery key starts the step over: no error before the next press.
        setSubmitted(false);
        setStep('key');
      }}
    >
      <PasswordField
        t={t}
        id="gate-new"
        label={tr('gate.new_password')}
        value={password}
        onChange={setPassword}
        check={check}
        offerPassphrase={user.role === 'admin'}
        submitted={submitted}
      />
      <div className="au-row">
        <TextField
          id="gate-repeat"
          label={tr('gate.repeat_password')}
          type="password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'gate-mismatch' : undefined}
        />
        <ErrorLine t={t} id="gate-mismatch" text={mismatch ? tr('gate.passwords_differ') : null} />
      </div>
      <AuthButton t={t} label={tr('gate.continue')} />
      <SignOutButton t={t} />
    </AuthCard>
  );
};

/** Gate 2: the account chose its own password but has no keys yet. The recovery key is shown and confirmed, then keys and proof go in one request. */
export const KeySetupScreen: React.FC<GateProps> = ({ t, user }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(readGateCredentials);
  const draft = useDraft(credentials !== null);
  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        title={tr('gate.keys_title')}
        lead={tr('gate.keys_lead')}
        label={tr('term.password')}
        onReady={setCredentials}
      />
    );
  }
  return (
    <AuthCard t={t} wide title={tr('gate.keys_title')} lead={tr('gate.keys_lead')}>
      {draft === null ? null : (
        <RecoveryKeyPanel
          t={t}
          draft={draft}
          address={user.email}
          replaces={false}
          onConfirmed={async () => {
            await completeKeySetup(credentials, user.id, draft);
            applySignedIn(queryClient, { ...user, has_keys: true });
          }}
        />
      )}
      <SignOutButton t={t} />
    </AuthCard>
  );
};

/** Gate 3: two-factor enrolment (an admin always, a member when the organisation requires it). */
export const TwoFactorGateScreen: React.FC<GateProps> = ({ t, user }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(readGateCredentials);
  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        title={tr('gate.two_factor_title')}
        lead={tr('gate.two_factor_lead')}
        label={tr('term.password')}
        onReady={setCredentials}
      />
    );
  }
  return (
    <AuthCard t={t} wide title={tr('gate.two_factor_title')} lead={tr('gate.two_factor_lead')}>
      <TwoFactorEnrolment
        t={t}
        credentials={credentials}
        onDone={() => {
          finishGates();
          applySignedIn(queryClient, { ...user, totp_enabled: true });
        }}
      />
      <SignOutButton t={t} />
    </AuthCard>
  );
};
