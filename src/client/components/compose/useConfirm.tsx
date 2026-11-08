import React from 'react';
import type { ThemeTokens } from '../../theme';
import { ConfirmDialog } from '../ConfirmDialog';

export interface ConfirmSpec {
  title: string;
  body: string;
  confirmLabel: string;
}

interface Pending {
  spec: ConfirmSpec;
  settle: (confirmed: boolean) => void;
}

/**
 * `ask(spec)` shows the confirmation dialog and resolves with the person's answer: true for the confirm button, false for Cancel, Escape, a tap
 * outside, or the screen going away. Used where a send must wait for a decision (a recipient without keys, a changed key, an outside address).
 */
export function useConfirm(t: ThemeTokens): { ask: (spec: ConfirmSpec) => Promise<boolean>; dialog: React.ReactElement } {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const live = React.useRef<Pending | null>(null);

  const ask = React.useCallback(
    (spec: ConfirmSpec) =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open cancels the first.
        live.current?.settle(false);
        const next: Pending = {
          spec,
          settle: (confirmed) => {
            if (live.current === next) {
              live.current = null;
              setPending(null);
            }
            resolve(confirmed);
          }
        };
        live.current = next;
        setPending(next);
      }),
    []
  );

  React.useEffect(
    () => () => {
      live.current?.settle(false);
    },
    []
  );

  const dialog = (
    <ConfirmDialog
      isOpen={pending !== null}
      t={t}
      title={pending?.spec.title ?? ''}
      body={pending?.spec.body ?? ''}
      confirmLabel={pending?.spec.confirmLabel ?? ''}
      onConfirm={() => pending?.settle(true)}
      onCancel={() => pending?.settle(false)}
    />
  );
  return { ask, dialog };
}
