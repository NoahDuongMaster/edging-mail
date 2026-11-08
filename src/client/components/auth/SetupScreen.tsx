import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { canonicalAddress } from '../../../shared/crypto/client';
import type { ThemeTokens } from '../../theme';
import { ApiError } from '../../lib/api';
import { adminClaimLimits } from '../../lib/admin/claims';
import { sessionKey } from '../../lib/auth';
import type { Session } from '../../lib/auth';
import { credentialErrorText, retryAfterOf } from '../../lib/crypto/errors';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import type { SetupFields } from '../../lib/crypto/requests';
import { completeSetup, DISPLAY_NAME_MAX, hasProblems, validateSetupFields } from '../../lib/crypto/setup';
import type { SetupProblems } from '../../lib/crypto/setup';
import { LANGUAGE_NAMES, LOCALES, useLocale, useT } from '../../lib/i18n';
import type { Locale, MessageKey } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { PasswordField } from '../PasswordField';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';
import { AuthButton, AuthCard, ErrorLine, Field, inputStyle } from './authUi';

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

interface Touched {
  setupKey: boolean;
  email: boolean;
  displayName: boolean;
  confirm: boolean;
}

const UNTOUCHED: Touched = { setupKey: false, email: false, displayName: false, confirm: false };
const ALL_TOUCHED: Touched = { setupKey: true, email: true, displayName: true, confirm: true };

const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

/** An input is described by its hint, and by its error text while there is one. */
const describedBy = (id: string, error: string | null): string => (error === null ? `${id}-hint` : `${id}-hint ${id}-error`);

const stepLine = (t: ThemeTokens): React.CSSProperties => ({
  margin: 0,
  fontSize: 12.5,
  lineHeight: '17px',
  color: t.text3,
  textAlign: 'center'
});

const NotReady: React.FC<{ t: ThemeTokens; names: readonly string[] }> = ({ t, names }) => {
  const tr = useT();
  const quiet: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: '19px', color: t.text2 };
  return (
    <AuthCard t={t} title={tr('setup.not_ready_title')} lead={tr('setup.not_ready_lead')} picker wide>
      {names.length === 0 ? null : (
        <div style={rowStyle}>
          <p style={{ ...quiet, fontWeight: 500 }}>{tr('setup.not_ready_list')}</p>
          <ul data-setup-missing="" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {names.map((name) => (
              <li key={name}>
                <code
                  translate="no"
                  style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    border: `1px solid ${t.borderStrong}`,
                    borderRadius: 8,
                    background: t.raised,
                    color: t.text,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13,
                    overflowWrap: 'anywhere'
                  }}
                >
                  {name}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {names.includes('APP_PASSWORD') ? <p style={quiet}>{tr('setup.not_ready_app_password')}</p> : null}
      <p style={quiet}>{tr('setup.not_ready_next')}</p>
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
  const valid = !hasProblems(problems) && password !== '' && check.assessment?.ok === true;

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
    if (!valid || starting) {
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
      <AuthCard t={t} title={tr('recovery.title_first')} lead={adminClaimLimits().join(' ')} picker wide>
        <p style={stepLine(t)}>{tr('setup.step', { current: 2, total: STEPS })}</p>
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
          <p role="status" style={{ margin: 0, fontSize: 13, lineHeight: '18px', color: t.text2 }}>
            {tr('auth.try_again_in', { seconds: wait })}
          </p>
        ) : null}
        {keyWrong ? (
          <div style={rowStyle}>
            <Field t={t} id="setup-key-retry" label={tr('setup.key_label')} hint={tr('setup.wrong_key_retry')}>
              <input
                id="setup-key-retry"
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={retryKey}
                onChange={(event) => setRetryKey(event.target.value)}
                style={inputStyle(t)}
              />
            </Field>
          </div>
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
      title={tr('setup.title')}
      lead={tr('setup.lead')}
      picker
      wide
      onSubmit={(event) => {
        event.preventDefault();
        void begin();
      }}
    >
      <p style={stepLine(t)}>{tr('setup.step', { current: 1, total: STEPS })}</p>

      <div style={rowStyle}>
        <Field t={t} id="setup-key" label={tr('setup.key_label')} hint={tr('setup.key_hint')}>
          <input
            id="setup-key"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={setupKey}
            onChange={(event) => setSetupKey(event.target.value)}
            onBlur={touch('setupKey')}
            aria-invalid={keyError !== null}
            aria-describedby={describedBy('setup-key', keyError)}
            style={inputStyle(t)}
          />
        </Field>
        <ErrorLine t={t} id="setup-key-error" text={keyError} />
      </div>

      <div style={rowStyle}>
        <Field t={t} id="setup-email" label={tr('auth.email_label')} hint={tr('setup.address_hint')}>
          <input
            id="setup-email"
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
            aria-describedby={describedBy('setup-email', emailError)}
            style={inputStyle(t)}
          />
        </Field>
        <ErrorLine t={t} id="setup-email-error" text={emailError} />
      </div>

      <div style={rowStyle}>
        <Field t={t} id="setup-name" label={tr('term.display_name')} hint={tr('setup.name_hint')}>
          <input
            id="setup-name"
            type="text"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={touch('displayName')}
            aria-invalid={nameError !== null}
            aria-describedby={describedBy('setup-name', nameError)}
            style={inputStyle(t)}
          />
        </Field>
        <ErrorLine t={t} id="setup-name-error" text={nameError} />
      </div>

      <Field t={t} id="setup-language" label={tr('lang.org_default')} hint={tr('lang.org_default_hint')}>
        <select
          id="setup-language"
          value={language}
          onChange={(event) => {
            const next = LOCALES.find((tag) => tag === event.target.value);
            if (next !== undefined) {
              setChosenLanguage(next);
            }
          }}
          aria-describedby="setup-language-hint"
          style={inputStyle(t)}
        >
          {LOCALES.map((tag) => (
            <option key={tag} value={tag} lang={tag}>
              {LANGUAGE_NAMES[tag]}
            </option>
          ))}
        </select>
      </Field>

      <PasswordField
        t={t}
        id="setup-password"
        label={tr('term.password')}
        value={password}
        onChange={setPassword}
        check={check}
        offerPassphrase
      />

      <div style={rowStyle}>
        <Field t={t} id="setup-confirm" label={tr('gate.repeat_password')}>
          <input
            id="setup-confirm"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={touch('confirm')}
            aria-invalid={confirmError !== null}
            aria-describedby={confirmError === null ? undefined : 'setup-confirm-error'}
            style={inputStyle(t)}
          />
        </Field>
        <ErrorLine t={t} id="setup-confirm-error" text={confirmError} />
      </div>

      <ErrorLine t={t} id="setup-start-error" text={startError} />
      <AuthButton t={t} busy={starting} disabled={!valid} label={tr('gate.continue')} />
    </AuthCard>
  );
};

/**
 * Shown while nobody has set the app up yet. A deployment that lacks secrets gets an explanation instead of the form (the server would
 * refuse the request anyway); the session's `missing_secrets` holds the NAMES only.
 */
export const SetupScreen: React.FC<{ t: ThemeTokens; session: Session }> = ({ t, session }) =>
  session.configured === false ? <NotReady t={t} names={session.missing_secrets ?? []} /> : <SetupFlow t={t} session={session} />;
