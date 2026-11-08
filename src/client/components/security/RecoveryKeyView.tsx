import React from 'react';
import type { ThemeTokens } from '../../theme';
import { ApiError } from '../../lib/api';
import type { SessionUser } from '../../lib/auth';
import { NewRecoveryKeyFlow, stepUp, testRecoveryKey } from '../../lib/crypto/account';
import { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { TextField } from '../../ui';
import { AuthButton, ErrorLine } from '../auth/authUi';
import { RecoveryKeyPanel } from '../auth/RecoveryKeyPanel';
import { CredentialForm } from './CredentialForm';
import { CODE_LENGTH, CodeInput, DoneNote, ViewFrame } from './securityUi';

export type RecoveryKeyMode = 'test' | 'new';

interface InnerProps {
  t: ThemeTokens;
  user: SessionUser;
  onBack: () => void;
}

/**
 * The typed key is read here (a typo is named before anything else), then tried against the stored recovery wrap in this browser: no request
 * carries the key and nothing on the server changes. The key leaves state as soon as a check has run.
 */
const TestKey: React.FC<InnerProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const action = useAction();
  const [typed, setTyped] = React.useState('');
  const [result, setResult] = React.useState<'ok' | 'wrong' | null>(null);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || typed.trim() === '') {
      return;
    }
    setResult(null);
    const correct = await action.run(() => testRecoveryKey(user, typed));
    // A typo is not a check: the text stays so it can be corrected. Once a check has run, the key is gone from the screen.
    if (correct !== undefined) {
      setTyped('');
      setResult(correct ? 'ok' : 'wrong');
    }
  };

  return (
    <ViewFrame t={t} title={tr('term.recovery_key')} onBack={onBack}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="st-view-form"
      >
        <p className="st-lead">{tr('security.key_test_lead')}</p>
        <TextField
          id="security-key-test"
          label={tr('term.recovery_key')}
          hint={tr('security.key_test_hint')}
          mono
          className="st-key"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setResult(null);
            if (action.error !== null) {
              action.clear();
            }
          }}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          aria-invalid={action.error !== null}
        />
        <ErrorLine t={t} id="security-key-test-error" text={action.error} />
        {result === null ? null : (
          <p role="status" className="st-result" data-tone={result === 'ok' ? 'success' : undefined}>
            {result === 'ok' ? tr('security.key_test_ok') : tr('security.key_test_wrong')}
          </p>
        )}
        <div>
          <AuthButton t={t} busy={action.busy} disabled={typed.trim() === ''} label={tr('security.key_test_button')} />
        </div>
      </form>
    </ViewFrame>
  );
};

/** Keeps a new recovery key (its bytes live in the draft object only) for as long as `active`, and zeroes it afterwards. */
function useDraft(active: boolean): RecoveryKeyDraft | null {
  const [draft, setDraft] = React.useState<RecoveryKeyDraft | null>(null);
  React.useEffect(() => {
    let made: RecoveryKeyDraft | null = null;
    let cancelled = false;
    if (active) {
      void RecoveryKeyDraft.create().then((created) => {
        if (cancelled) {
          created.discard();
          return;
        }
        made = created;
        setDraft(created);
      });
    }
    return () => {
      cancelled = true;
      made?.discard();
      setDraft(null);
    };
  }, [active]);
  return draft;
}

type Step = 'password' | 'key' | 'done';

/**
 * A new recovery key in three steps: the password (the private key is opened with it here, so a wrong password shows up at once), the new key
 * shown and confirmed, then ONE request that replaces the old one. With two-factor sign-in the server wants a recent code first: that is asked
 * above the key, and the same request is tried again once the code was accepted.
 */
const NewKey: React.FC<InnerProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const [step, setStep] = React.useState<Step>('password');
  const [needCode, setNeedCode] = React.useState(false);
  const [code, setCode] = React.useState('');
  // The opened private key lives inside this object, in a ref, and is dropped when the view goes (or the request has been made).
  const flow = React.useRef<NewRecoveryKeyFlow | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      flow.current?.discard();
      flow.current = null;
    };
  }, []);
  const draft = useDraft(step === 'key');

  const opened = (made: NewRecoveryKeyFlow) => {
    if (!alive.current) {
      // The person left while the password was being checked.
      made.discard();
      return;
    }
    flow.current = made;
    setStep('key');
  };

  const confirmed = async () => {
    const open = flow.current;
    if (open === null || draft === null) {
      throw new Error('unexpected state: no recovery key flow');
    }
    if (needCode) {
      const typed = code;
      if (typed.length !== CODE_LENGTH) {
        throw new ApiError(tr('security.step_up_retry'), 403, 'step_up_required');
      }
      try {
        await stepUp(typed);
      } finally {
        setCode('');
      }
    }
    try {
      await open.complete(draft);
    } catch (error) {
      if (user.totp_enabled && !needCode && error instanceof ApiError && error.code === 'step_up_required') {
        // The panel keeps its screen when this rejects, and shows this text: the code field above it is what to fill in.
        setNeedCode(true);
        throw new ApiError(tr('security.step_up_retry'), error.status, error.code);
      }
      throw error;
    }
    flow.current = null;
    setNeedCode(false);
    setStep('done');
  };

  if (step === 'done') {
    return (
      <ViewFrame t={t} title={tr('term.recovery_key')} onBack={null}>
        <DoneNote t={t} text={tr('security.key_new_done')} onBack={onBack} />
      </ViewFrame>
    );
  }

  if (step === 'key') {
    return (
      <ViewFrame t={t} title={tr('recovery.title_new')} onBack={null}>
        {needCode ? (
          <div className="st-view-form">
            <p className="st-lead">{tr('security.step_up_lead')}</p>
            <CodeInput t={t} id="security-step-up" value={code} onChange={setCode} />
          </div>
        ) : null}
        {draft === null ? null : (
          <RecoveryKeyPanel
            t={t}
            draft={draft}
            address={user.email}
            replaces
            cancelLabel={tr('common.cancel')}
            onCancel={onBack}
            onConfirmed={confirmed}
          />
        )}
      </ViewFrame>
    );
  }

  return (
    <ViewFrame t={t} title={tr('term.recovery_key')} onBack={onBack}>
      <CredentialForm
        t={t}
        id="security-key-new"
        lead={tr('security.key_new_lead')}
        submitLabel={tr('gate.continue')}
        withCode={false}
        work={(password) => NewRecoveryKeyFlow.start(user, password)}
        onResult={opened}
      />
    </ViewFrame>
  );
};

interface RecoveryKeyViewProps {
  t: ThemeTokens;
  user: SessionUser;
  mode: RecoveryKeyMode;
  onBack: () => void;
}

/** "Test my recovery key" and "Create a new recovery key": the two things a person does with the recovery key after setup. */
export const RecoveryKeyView: React.FC<RecoveryKeyViewProps> = ({ t, user, mode, onBack }) =>
  mode === 'test' ? <TestKey t={t} user={user} onBack={onBack} /> : <NewKey t={t} user={user} onBack={onBack} />;
