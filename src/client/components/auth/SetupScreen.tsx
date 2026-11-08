import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { canonicalAddress } from '../../../shared/crypto/client';
import { DEPLOY_GUIDE_URL } from '../../../worker/site/links';
import type { ThemeTokens } from '../../theme';
import { ApiError } from '../../lib/api';
import { adminClaimLimits } from '../../lib/admin/claims';
import { sessionKey } from '../../lib/auth';
import type { Session } from '../../lib/auth';
import { credentialErrorText, retryAfterOf } from '../../lib/crypto/errors';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import type { SetupFields } from '../../lib/crypto/requests';
import { completeSetup, DISPLAY_NAME_MAX, validateSetupFields } from '../../lib/crypto/setup';
import type { SetupProblems } from '../../lib/crypto/setup';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { LANGUAGE_NAMES, LOCALES, tRich, useLocale, useT } from '../../lib/i18n';
import type { Locale, MessageKey } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { PasswordField } from '../PasswordField';
import { Badge, Banner, Select, Step, Steps, TextField } from '../../ui';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { AuthButton, AuthCard, ErrorLine } from './authUi';

// First-run Setup: the first admin. Step 1 collects the setup key, the address, the name, the organisation language and the password
// (nothing is derived or sent yet); step 2 shows the recovery key and, once three of its groups were typed back, makes the key set and
// sends the whole request (completeSetup). The password and the setup key live in the inputs' state of step 1 only: they are cleared the
// moment step 2 opens and wait in a ref that Back, success and unmount empty.

const STEPS = 2;

/** What the request at the end of step 2 needs. Never in React state, never rendered. */
interface Held {
  fields: SetupFields;
  password: string;
}

/** The fields whose error shows: the ones left once, and all of them after a press of Continue (an empty password only then). */
interface Touched {
  setupKey: boolean;
  email: boolean;
  displayName: boolean;
  password: boolean;
  confirm: boolean;
}

const UNTOUCHED: Touched = { setupKey: false, email: false, displayName: false, password: false, confirm: false };
const ALL_TOUCHED: Touched = { setupKey: true, email: true, displayName: true, password: true, confirm: true };

/** An input is described by its error text while there is one (TextField adds the id of its hint itself). */
const errorId = (id: string, error: string | null): string | undefined => (error === null ? undefined : `${id}-error`);

// The organisation's language, each by its own name in its own script.
const LANGUAGE_OPTIONS = LOCALES.map((tag) => ({ value: tag, label: LANGUAGE_NAMES[tag] }));

/** The secret that is the setup key (a name, never translated). */
const SETUP_KEY_SECRET = 'APP_PASSWORD';

/**
 * The deployment lacks secrets: a blocked state, so it says which ones (names only) and what to do, in order, with Reload as the one action.
 * Step 1 links to the deployment guide; what APP_PASSWORD is (a fact, not a step) is a note under the steps.
 */
const NotReady: React.FC<{ t: ThemeTokens; names: readonly string[] }> = ({ t, names }) => {
  const tr = useT();
  // One secret reads "Missing secret" / "Add it"; an empty list (names unknown) reads as several.
  const count = names.length === 0 ? 2 : names.length;
  const guide = (
    <a href={DEPLOY_GUIDE_URL} target="_blank" rel="noreferrer" className="au-link">
      {tr('setup.deploy_guide')}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
  return (
    <AuthCard t={t} title={tr('setup.not_ready_title')} lead={tr('setup.not_ready_lead', { count })} picker wide illustration>
      {names.length === 0 ? null : (
        <Banner tone="warning" title={tr('setup.not_ready_list', { count })}>
          <ul data-setup-missing="" className="au-secrets">
            {names.map((name) => (
              <li key={name}>
                <Badge>
                  <code translate="no" className="nm-mono au-secret">
                    {name}
                  </code>
                </Badge>
              </li>
            ))}
          </ul>
        </Banner>
      )}
      <Steps>
        <Step>{tRich('setup.not_ready_step_add', { guide }, { count })}</Step>
        <Step>{tr('setup.not_ready_step_reload')}</Step>
      </Steps>
      {names.includes(SETUP_KEY_SECRET) ? (
        <p className="au-muted">
          {tRich('setup.not_ready_app_password', {
            name: (
              <code translate="no" className="nm-mono au-code">
                {SETUP_KEY_SECRET}
              </code>
            )
          })}
        </p>
      ) : null}
      <AuthButton
        t={t}
        type="button"
        label={tr('setup.reload')}
        onClick={() => {
          window.location.reload();
        }}
      />
    </AuthCard>
  );
};

const SetupFlow: React.FC<{ t: ThemeTokens; session: Session }> = ({ t, session }) => {
  const tr = useT();
  const uiLocale = useLocale();
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<'form' | 'recovery'>('form');
  const [setupKey, setSetupKey] = React.useState('');
  const [email, setEmail] = React.useState(session.default_from ?? '');
  const [displayName, setDisplayName] = React.useState(session.default_display_name ?? '');
  // Follows the language of the screen until the person picks one for the organisation.
  const [chosenLanguage, setChosenLanguage] = React.useState<Locale | null>(null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [touched, setTouched] = React.useState<Touched>(UNTOUCHED);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<RecoveryKeyDraft | null>(null);
  const [address, setAddress] = React.useState('');
  const [keyWrong, setKeyWrong] = React.useState(false);
  // The setup key typed again after the server refused the first one: only this field is redone, the recovery key stays the one to write down.
  const [retryKey, setRetryKey] = React.useState('');
  const [wait, setWait] = React.useState<number | null>(null);
  const held = React.useRef<Held | null>(null);
  const draftRef = React.useRef<RecoveryKeyDraft | null>(null);
  const alive = React.useRef(true);

  const language = chosenLanguage ?? uiLocale;
  const words = React.useMemo(() => contextWords(email, displayName), [email, displayName]);
  const check = usePasswordCheck(password, 'admin', words);
  const fields: SetupFields = { setupKey, email, displayName, language };
  const problems = validateSetupFields(fields, password, confirm);
  // Continue can always be pressed: a press with something missing shows every field's error and takes the keyboard to the first of them. The
  // password counts as missing while it is empty, refused or not judged yet (its check still loading or failed to load): its line says which.
  const toFix = firstInvalid([
    ['setup-key', problems.setupKey !== undefined],
    ['setup-email', problems.email !== undefined],
    ['setup-name', problems.displayName !== undefined],
    ['setup-password', check.assessment?.ok !== true || password === ''],
    ['setup-confirm', problems.confirm !== undefined]
  ]);
  const focusLater = useFieldFocus();

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Whatever step the person was on: the recovery key's bytes are zeroed and the password is let go.
      draftRef.current?.discard();
      draftRef.current = null;
      held.current = null;
    };
  }, []);

  // The seconds a throttled answer asked for, counted down so the line does not go stale.
  React.useEffect(() => {
    if (wait === null || wait <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setWait((left) => (left === null ? null : left - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const refreshSession = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: sessionKey });
  };

  const begin = async (): Promise<void> => {
    setTouched(ALL_TOUCHED);
    if (starting) {
      return;
    }
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const canonical = canonicalAddress(email);
      const created = await RecoveryKeyDraft.create();
      if (!alive.current) {
        created.discard();
        return;
      }
      held.current = { fields: { setupKey, email: canonical, displayName: displayName.trim(), language }, password };
      draftRef.current = created;
      // The secrets leave the inputs' state now; the request at the end of step 2 reads them from `held`.
      setSetupKey('');
      setPassword('');
      setConfirm('');
      setTouched(UNTOUCHED);
      setAddress(canonical);
      setDraft(created);
      setStep('recovery');
    } catch (error) {
      if (alive.current) {
        setStartError(credentialErrorText(error));
      }
    } finally {
      if (alive.current) {
        setStarting(false);
      }
    }
  };

  /** Back to step 1 before anything was sent: the unconfirmed recovery key is thrown away, and the secrets are typed again. */
  const goBack = (): void => {
    draftRef.current?.discard();
    draftRef.current = null;
    held.current = null;
    setDraft(null);
    setKeyWrong(false);
    setRetryKey('');
    setWait(null);
    setStep('form');
  };

  /** The recovery key panel's request: runs after the three groups were typed back. Rejecting keeps the panel and shows the error there. */
  const confirmed = async (): Promise<void> => {
    const pending = held.current;
    const current = draftRef.current;
    if (pending === null || current === null) {
      throw new Error('unexpected state: nothing to set up');
    }
    setWait(null);
    setKeyWrong(false);
    const retyped = retryKey.trim();
    const toSend = retyped === '' ? pending.fields : { ...pending.fields, setupKey: retyped };
    try {
      await completeSetup(toSend, pending.password, current);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'already_set_up' || error.code === 'not_configured')) {
        // Somebody else finished Setup, or a secret went missing meanwhile: the session says which screen is next.
        held.current = null;
        await refreshSession();
        return;
      }
      if (alive.current) {
        setWait(retryAfterOf(error));
        setKeyWrong(error instanceof ApiError && error.code === 'wrong_setup_key');
      }
      throw error;
    }
    held.current = null;
    setRetryKey('');
    await refreshSession();
  };

  const problemText = (key: MessageKey): string => tr(key, { max: DISPLAY_NAME_MAX });
  const shown = (field: keyof SetupProblems): string | null => {
    const key = problems[field];
    return touched[field] && key !== undefined ? problemText(key) : null;
  };
  const touch = (field: keyof Touched) => () => setTouched((current) => ({ ...current, [field]: true }));

  if (step === 'recovery' && draft !== null) {
    return (
      <AuthCard
        t={t}
        eyebrow={tr('setup.step', { current: 2, total: STEPS })}
        title={tr('recovery.title_first')}
        lead={adminClaimLimits().join(' ')}
        picker
        wide
      >
        <RecoveryKeyPanel
          t={t}
          draft={draft}
          address={address}
          replaces={false}
          onConfirmed={confirmed}
          onCancel={goBack}
          cancelLabel={tr('common.back')}
        />
        {wait !== null && wait > 0 ? (
          <p role="status" className="au-muted">
            {tr('auth.try_again_in', { seconds: wait })}
          </p>
        ) : null}
        {keyWrong ? (
          <TextField
            id="setup-key-retry"
            label={tr('setup.key_label')}
            hint={tr('setup.wrong_key_retry')}
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={retryKey}
            onChange={(event) => setRetryKey(event.target.value)}
          />
        ) : null}
      </AuthCard>
    );
  }

  const keyError = shown('setupKey');
  const emailError = shown('email');
  const nameError = shown('displayName');
  const confirmError = shown('confirm');

  return (
    <AuthCard
      t={t}
      eyebrow={tr('setup.step', { current: 1, total: STEPS })}
      title={tr('setup.title')}
      lead={tr('setup.lead')}
      picker
      wide
      onSubmit={(event) => {
        event.preventDefault();
        void begin();
      }}
    >
      <div className="au-row">
        <TextField
          id="setup-key"
          label={tr('setup.key_label')}
          hint={tr('setup.key_hint')}
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={setupKey}
          onChange={(event) => setSetupKey(event.target.value)}
          onBlur={touch('setupKey')}
          aria-invalid={keyError !== null}
          aria-describedby={errorId('setup-key', keyError)}
        />
        <ErrorLine t={t} id="setup-key-error" text={keyError} />
      </div>

      {/* The address and the name side by side from 641px (one row instead of two; both labels are one line in every language), stacked on a
          phone. Their hints differ in length, so the pair is aligned at the top: labels and boxes share one line. */}
      <div className="au-pair">
        <div className="au-row">
          <TextField
            id="setup-email"
            label={tr('auth.email_label')}
            hint={tr('setup.address_hint')}
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={touch('email')}
            aria-invalid={emailError !== null}
            aria-describedby={errorId('setup-email', emailError)}
          />
          <ErrorLine t={t} id="setup-email-error" text={emailError} />
        </div>

        <div className="au-row">
          <TextField
            id="setup-name"
            label={tr('term.display_name')}
            hint={tr('setup.name_hint')}
            type="text"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={touch('displayName')}
            aria-invalid={nameError !== null}
            aria-describedby={errorId('setup-name', nameError)}
          />
          <ErrorLine t={t} id="setup-name-error" text={nameError} />
        </div>
      </div>

      <Select
        id="setup-language"
        label={tr('lang.org_default')}
        hint={tr('lang.org_default_hint')}
        options={LANGUAGE_OPTIONS}
        value={language}
        onChange={(value) => {
          const next = LOCALES.find((tag) => tag === value);
          // Only a real change: choosing the language already shown keeps the organisation's language following the screen's (as the
          // browser's own list, which fires on a change only, did).
          if (next !== undefined && next !== language) {
            setChosenLanguage(next);
          }
        }}
      />

      <PasswordField
        t={t}
        id="setup-password"
        label={tr('term.password')}
        value={password}
        onChange={setPassword}
        check={check}
        offerPassphrase
        submitted={touched.password}
      />

      <div className="au-row">
        <TextField
          id="setup-confirm"
          label={tr('gate.repeat_password')}
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          onBlur={touch('confirm')}
          aria-invalid={confirmError !== null}
          aria-describedby={errorId('setup-confirm', confirmError)}
        />
        <ErrorLine t={t} id="setup-confirm-error" text={confirmError} />
      </div>

      {/* The longest form of these screens: from 641px its last row (an error about the whole form, and Continue) stays docked at the bottom
          edge of the window while the fields scroll under it, so the next step is always in sight (at a 670px-high laptop window Continue was
          about 400px below the fold). */}
      <div className="au-sticky">
        <ErrorLine t={t} id="setup-start-error" text={startError} />
        <AuthButton t={t} busy={starting} label={tr('gate.continue')} />
      </div>
    </AuthCard>
  );
};

/**
 * Shown while nobody has set the app up yet. A deployment that lacks secrets gets an explanation instead of the form (the server would
 * refuse the request anyway); the session's `missing_secrets` holds the NAMES only.
 */
export const SetupScreen: React.FC<{ t: ThemeTokens; session: Session }> = ({ t, session }) =>
  session.configured === false ? <NotReady t={t} names={session.missing_secrets ?? []} /> : <SetupFlow t={t} session={session} />;
