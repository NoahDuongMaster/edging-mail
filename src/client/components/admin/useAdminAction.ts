import React from 'react';
import { adminErrorText } from '../../lib/admin/types';
import { StepUpCancelled, useStepUp } from './StepUp';

export interface AdminAction {
  busy: boolean;
  error: string | null;
  /** Runs the action (asking for the authenticator code first when the server wants one). Resolves true when it succeeded. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  clearError: () => void;
}

/** Busy flag, error text and the step-up retry for one admin action, so each button only says what to call. */
export function useAdminAction(): AdminAction {
  const stepUp = useStepUp();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await stepUp.run(action);
        return true;
      } catch (error_) {
        // Dismissing the code prompt is a choice, not a failure.
        if (!(error_ instanceof StepUpCancelled)) {
          setError(adminErrorText(error_));
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [stepUp]
  );
  const clearError = React.useCallback(() => setError(null), []);
  return { busy, error, run, clearError };
}
