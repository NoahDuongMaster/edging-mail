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
import { PasswordField, SecretField } from '../PasswordField';
import { AuthActions, AuthButton, AuthCard, CheckboxRow, ErrorLine, TextButton, useAuthPhone } from './authUi';
import type { AuthStep } from './authUi';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { TwoFactorEnrolment } from './TwoFactorEnrolment';

interface GateProps {
  t: ThemeTokens;
  user: SessionUser;
}

/**
 * The steps of a first sign-in, in the server's order (middleware GATES): the own password and the recovery key, then two-factor sign-in,
 * which is two steps for the person (add the account to the app and check a code, then save the recovery codes: J4-09).
 */
type GateStep = 'password' | 'key' | 'two_factor' | 'two_factor_codes';

/** The steps this account still has before the mailbox, judged from the session the way the server does. */
function gateSteps(user: SessionUser): GateStep[] {
  const steps: GateStep[] = [];
  if (user.must_change_password) {
    steps.push('password', 'key');
  } else if (!user.has_keys) {
    steps.push('key');
  }
  if (!user.totp_enabled && (user.role === 'admin' || user.require_2fa)) {
    steps.push('two_factor', 'two_factor_codes');
  }
  return steps;
}

/** The plan of the first sign-in in this page, made at its first gate, so the two-factor gate still says "Step 3 of 3" after the others closed. */
let journey: { user: string; steps: GateStep[] } | null = null;

/** "Step n of m" of a gate screen, or nothing when the whole way to the mailbox is this one step. */
function gateStep(user: SessionUser, step: GateStep): AuthStep | undefined {
  if (journey?.user !== user.id || !journey.steps.includes(step)) {
    journey = { user: user.id, steps: gateSteps(user) };
  }
  const index = journey.steps.indexOf(step);
  return index === -1 || journey.steps.length < 2 ? undefined : { current: index + 1, total: journey.steps.length };
}

/** Sign out, the one way out of a first sign-in: a quiet text button under the form; on a phone, the end of the top bar (`top`). */
const SignOutButton: React.FC<{ t: ThemeTokens; top?: boolean }> = ({ t, top = false }) => {
  const tr = useT();
  const logout = useLogout({ push: pushForSignOut() });
  const button = <TextButton t={t} label={tr('auth.sign_out')} disabled={logout.isPending} onClick={() => logout.mutate()} />;
  return top ? button : <div className="au-alt">{button}</div>;
};

/** Where Sign out goes on this layout: the top bar on a phone (AuthCard `topAction`), under the form elsewhere. */
function useSignOutPlace(t: ThemeTokens): { top: React.ReactNode; foot: React.ReactNode } {
  const phone = useAuthPhone();
  return phone ? { top: <SignOutButton t={t} top />, foot: null } : { top: undefined, foot: <SignOutButton t={t} /> };
}

interface CurrentPasswordProps extends GateProps {
  title: string;
  lead: string;
  /** The longer explanation of the step, behind an InfoTip after the title. */
  info?: string;
  label: string;
  step: AuthStep | undefined;
  onReady: (credentials: GateCredentials) => void;
}

/** Shown when the sign-in's own copy of the credentials is gone (the page was reloaded in the middle of a gate): the current password, once. */
const CurrentPasswordStep: React.FC<CurrentPasswordProps> = ({ t, user, title, lead, info, label, step, onReady }) => {
  const tr = useT();
  const action = useAction();
  const [password, setPassword] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const start = sharedDeviceStart(useSession().data?.shared);
  const [chosen, setChosen] = React.useState(start.shared);
  const shared = start.locked || chosen;
  const focusLater = useFieldFocus();
  const signOut = useSignOutPlace(t);
  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy) {
      return;
    }
    setSubmitted(true);
    // Continue can always be pressed: an empty password is said under the field, and the keyboard goes there.
    const toFix = firstInvalid([['gate-current', password === '']]);
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    const credentials = await action.run(() => gateCredentialsFromPassword(user.email, password, !shared));
    setPassword('');
    setSubmitted(false);
    if (credentials !== undefined) {
      onReady(credentials);
    }
  };
  const passwordError = submitted && password === '' ? tr('auth.password_required') : undefined;
  return (
    <AuthCard
      t={t}
      step={step}
      title={title}
      lead={lead}
      info={info}
      topAction={signOut.top}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <SecretField
        id="gate-current"
        label={label}
        error={passwordError}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        aria-invalid={passwordError !== undefined || action.error !== null}
        aria-describedby={action.error === null ? undefined : 'gate-current-error'}
      />
      <ErrorLine t={t} id="gate-current-error" text={action.error} />
      <CheckboxRow
        t={t}
        id="gate-shared"
        label={tr('auth.shared_device')}
        hint={shared ? tr('auth.shared_device_hint') : tr('auth.shared_device_short')}
        note={shared ? tr('auth.shared_device_hint_short') : undefined}
        checked={shared}
        onChange={setChosen}
        locked={start.locked}
      />
      <AuthActions after={signOut.foot}>
        <AuthButton t={t} busy={action.busy} label={tr('gate.continue')} />
      </AuthActions>
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
  const signOut = useSignOutPlace(t);

  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        step={gateStep(user, 'password')}
        title={tr('gate.password_title')}
        lead={tr('gate.current_password_lead')}
        label={tr('term.temporary_password')}
        onReady={setCredentials}
      />
    );
  }
  if (step === 'key') {
    return (
      <AuthCard
        t={t}
        wide
        step={gateStep(user, 'key')}
        title={tr('recovery.title_first')}
        back={{ label: tr('common.back'), onClick: () => setStep('password') }}
      >
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
      step={gateStep(user, 'password')}
      title={tr('gate.password_title')}
      lead={tr('gate.password_lead_short')}
      info={tr('gate.password_lead')}
      topAction={signOut.top}
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
      <SecretField
        id="gate-repeat"
        label={tr('gate.repeat_password')}
        showLabel={tr('password.show_repeat')}
        error={mismatch ? tr('gate.passwords_differ') : undefined}
        value={repeat}
        onChange={(event) => setRepeat(event.target.value)}
        autoComplete="new-password"
      />
      <AuthActions after={signOut.foot}>
        <AuthButton t={t} label={tr('gate.continue')} />
      </AuthActions>
    </AuthCard>
  );
};

/** Gate 2: the account chose its own password but has no keys yet. The recovery key is shown and confirmed, then keys and proof go in one request. */
export const KeySetupScreen: React.FC<GateProps> = ({ t, user }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(readGateCredentials);
  const draft = useDraft(credentials !== null);
  const step = gateStep(user, 'key');
  const signOut = useSignOutPlace(t);
  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        step={step}
        title={tr('gate.keys_title')}
        lead={tr('gate.keys_lead_short')}
        info={tr('gate.keys_lead')}
        label={tr('term.password')}
        onReady={setCredentials}
      />
    );
  }
  return (
    <AuthCard
      t={t}
      wide
      step={step}
      title={tr('gate.keys_title')}
      lead={tr('gate.keys_lead_short')}
      info={tr('gate.keys_lead')}
      topAction={signOut.top}
    >
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
      {signOut.foot}
    </AuthCard>
  );
};

/** Gate 3: two-factor enrolment (an admin always, a member when the organisation requires it). */
export const TwoFactorGateScreen: React.FC<GateProps> = ({ t, user }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(readGateCredentials);
  const [phase, setPhase] = React.useState<'two_factor' | 'two_factor_codes'>('two_factor');
  const step = gateStep(user, phase);
  const signOut = useSignOutPlace(t);
  if (credentials === null) {
    return (
      <CurrentPasswordStep
        t={t}
        user={user}
        step={step}
        title={tr('gate.two_factor_title')}
        lead={tr('gate.two_factor_lead_short')}
        label={tr('term.password')}
        onReady={setCredentials}
      />
    );
  }
  return (
    <AuthCard t={t} wide step={step} title={tr('gate.two_factor_title')} lead={tr('gate.two_factor_lead_short')} topAction={signOut.top}>
      <TwoFactorEnrolment
        t={t}
        credentials={credentials}
        onPhase={(next) => setPhase(next === 'codes' ? 'two_factor_codes' : 'two_factor')}
        onDone={() => {
          finishGates();
          applySignedIn(queryClient, { ...user, totp_enabled: true });
        }}
      />
      {signOut.foot}
    </AuthCard>
  );
};
