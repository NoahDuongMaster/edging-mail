import React from 'react';
import type { ThemeTokens } from '../../theme';
import { breakGlass } from '../../lib/crypto/breakGlass';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { useT } from '../../lib/i18n';
import { contextWords } from '../../lib/password/policy';
import { usePasswordCheck } from '../../lib/password/usePasswordCheck';
import { useAction } from '../../lib/useAction';
import { PasswordField } from '../PasswordField';
import { AuthButton, AuthCard, ErrorLine, Field, TextButton, inputStyle } from './authUi';
import { RecoveryKeyPanel } from './RecoveryKeyPanel';

type Step = 'details' | 'key' | 'done';

/**
 * Break-glass (crypto-design.md 15.7), reached from the forgot-password page: an admin who lost both password and recovery key restores their
 * console access with the deployment's setup key. A new password, a new key pair and a new recovery key. Old mail stays locked and
 * two-factor sign-in is not cleared; the screens say both plainly.
 */
export const BreakGlassScreen: React.FC<{ t: ThemeTokens; onBack: () => void }> = ({ t, onBack }) => {
  const tr = useT();
  const action = useAction();
  const [step, setStep] = React.useState<Step>('details');
  const [setupKey, setSetupKey] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [repeat, setRepeat] = React.useState('');
  const [draft, setDraft] = React.useState<RecoveryKeyDraft | null>(null);
  const secrets = React.useRef<{ setupKey: string; password: string } | null>(null);
  const check = usePasswordCheck(password, 'admin', contextWords(email));
  // The new recovery key is zeroed when a newer draft replaces it and when this screen goes; the typed details are dropped with the screen.
  React.useEffect(
    () => () => {
      draft?.discard();
    },
    [draft]
  );
  React.useEffect(
    () => () => {
      secrets.current = null;
    },
    []
  );

  const mismatch = repeat !== '' && repeat !== password;
  const ready = setupKey.trim() !== '' && email.trim() !== '' && check.assessment?.ok === true && repeat === password;
  const next = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!ready || action.busy) {
      return;
    }
    const made = await action.run(() => RecoveryKeyDraft.create());
    if (made !== undefined) {
      setDraft(made);
      secrets.current = { setupKey: setupKey.trim(), password };
      setSetupKey('');
      setPassword('');
      setRepeat('');
      setStep('key');
    }
  };

  if (step === 'done') {
    return (
      <AuthCard t={t} title={tr('breakglass.done_title')} lead={tr('breakglass.done_lead')}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>{tr('breakglass.old_mail')}</p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>{tr('breakglass.two_factor')}</p>
        <AuthButton t={t} type="button" label={tr('forgot.done_button')} onClick={onBack} />
      </AuthCard>
    );
  }

  if (step === 'key' && draft !== null) {
    return (
      <AuthCard t={t} wide title={tr('recovery.title_new')} lead={tr('breakglass.key_lead')}>
        <RecoveryKeyPanel
          t={t}
          draft={draft}
          address={email}
          replaces
          cancelLabel={tr('common.cancel')}
          onCancel={onBack}
          onConfirmed={async () => {
            const held = secrets.current;
            if (held === null) {
              throw new Error('the break-glass details are gone');
            }
            await breakGlass(held.setupKey, email, held.password, draft);
            secrets.current = null;
            setStep('done');
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      t={t}
      picker
      title={tr('breakglass.title')}
      lead={tr('breakglass.lead')}
      onSubmit={(event) => {
        void next(event);
      }}
    >
      <Field t={t} id="glass-key" label={tr('breakglass.setup_key')} hint={tr('breakglass.setup_key_hint')}>
        <input
          id="glass-key"
          type="password"
          value={setupKey}
          onChange={(event) => setSetupKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          style={inputStyle(t)}
        />
      </Field>
      <Field t={t} id="glass-email" label={tr('breakglass.address')}>
        <input
          id="glass-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          style={inputStyle(t)}
        />
      </Field>
      <PasswordField
        t={t}
        id="glass-new"
        label={tr('gate.new_password')}
        value={password}
        onChange={setPassword}
        check={check}
        offerPassphrase
      />
      <Field t={t} id="glass-repeat" label={tr('gate.repeat_password')}>
        <input
          id="glass-repeat"
          type="password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch}
          style={inputStyle(t)}
        />
      </Field>
      <ErrorLine t={t} id="glass-mismatch" text={mismatch ? tr('gate.passwords_differ') : null} />
      <ErrorLine t={t} id="glass-error" text={action.error} />
      <AuthButton t={t} busy={action.busy} disabled={!ready} label={tr('gate.continue')} />
      <TextButton t={t} label={tr('common.back')} onClick={onBack} />
    </AuthCard>
  );
};
