import React from 'react';
import type { ThemeTokens } from '../../theme';
import { apiPost } from '../../lib/api';
import { adminErrorText, isStepUpRequired } from '../../lib/admin/types';
import { useT } from '../../lib/i18n';
import { Button, TextField } from '../../ui';
import { ErrorText, ModalFrame } from './adminUi';

/** The admin closed the code prompt instead of answering it: the action is simply not done, and that is not an error to show. */
export class StepUpCancelled extends Error {
  constructor() {
    super('step-up prompt dismissed');
    this.name = 'StepUpCancelled';
  }
}

interface StepUpApi {
  /**
   * Runs an admin action. When the server answers that it wants a fresh second factor (`step_up_required`), asks for the authenticator code,
   * and tries the action once more when the code was accepted. Rejects with StepUpCancelled when the prompt is dismissed.
   */
  run: <T>(action: () => Promise<T>) => Promise<T>;
}

const StepUpContext = React.createContext<StepUpApi | null>(null);

export function useStepUp(): StepUpApi {
  const api = React.useContext(StepUpContext);
  if (api === null) {
    throw new Error('useStepUp needs a StepUpProvider above it');
  }
  return api;
}

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** The form of the code prompt; its Confirm is in the dialog's foot, outside it. */
const FORM_ID = 'step-up-form';

const StepUpDialog: React.FC<{ t: ThemeTokens; onDone: () => void; onCancel: () => void }> = ({ t, onDone, onCancel }) => {
  const tr = useT();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    // The button stays pressable: a code that is not six digits is said under the field, not hidden behind a disabled button.
    if (!/^\d{6}$/.test(code)) {
      setError(tr('twofa.code_required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/auth/step-up', { code }, 'fail.admin_step_up');
      onDone();
    } catch (error_) {
      setError(adminErrorText(error_));
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      t={t}
      title={tr('admin.step_up_title')}
      onClose={onCancel}
      locked={busy}
      maxWidth={400}
      // Cancel and Confirm in the dialog's foot (fixed at the bottom of a phone's sheet); Confirm sends the form it names.
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" disabled={busy} loading={busy}>
            {busy ? tr('admin.checking') : tr('common.confirm')}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(event) => {
          void submit(event);
        }}
        className="ad-form"
      >
        <p className="ad-muted">{tr('admin.step_up_body_short')}</p>
        <div className="ad-field-group">
          <TextField
            id="step-up-code"
            label={tr('admin.step_up_code')}
            data-autofocus
            mono
            className="ad-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            // No maxLength: it would cut a pasted "123 456" before the spaces are dropped.
            onChange={(e) => {
              setCode(e.target.value.replaceAll(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'step-up-error'}
          />
          {error === null ? null : <ErrorText id="step-up-error">{error}</ErrorText>}
        </div>
      </form>
    </ModalFrame>
  );
};

export const StepUpProvider: React.FC<{ t: ThemeTokens; children: React.ReactNode }> = ({ t, children }) => {
  const [pending, setPending] = React.useState<Pending | null>(null);

  const api = React.useMemo<StepUpApi>(
    () => ({
      run: async <T,>(action: () => Promise<T>): Promise<T> => {
        try {
          return await action();
        } catch (error) {
          if (!isStepUpRequired(error)) {
            throw error;
          }
        }
        await new Promise<void>((resolve, reject) => {
          setPending({ resolve, reject });
        });
        return action();
      }
    }),
    []
  );

  const finish = (outcome: 'done' | 'cancelled') => {
    if (pending === null) {
      return;
    }
    setPending(null);
    if (outcome === 'done') {
      pending.resolve();
    } else {
      pending.reject(new StepUpCancelled());
    }
  };

  return (
    <StepUpContext.Provider value={api}>
      {children}
      {pending === null ? null : <StepUpDialog t={t} onDone={() => finish('done')} onCancel={() => finish('cancelled')} />}
    </StepUpContext.Provider>
  );
};
