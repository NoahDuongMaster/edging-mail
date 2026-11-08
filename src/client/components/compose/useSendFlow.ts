import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { runSend } from '../../lib/sealedmail';
import type { FlowInput, FlowResult } from '../../lib/sealedmail';
import { specOf } from './sendQuestions';
import { useConfirm } from './useConfirm';

/**
 * The send of a compose: `run` looks the recipients up, asks what has to be asked (a recipient without keys, a changed key, an end-to-end
 * message going outside, a message too big) in a dialog, and either sends it end to end or tells the compose to use the usual route.
 * Render `dialog` inside the compose root; the compose's own key handler skips keys that come from it.
 */
export function useSendFlow(t: ThemeTokens): {
  run: (input: Omit<FlowInput, 'primary'>) => Promise<FlowResult>;
  dialog: React.ReactElement;
} {
  const tr = useT();
  const { ask, dialog } = useConfirm(t);
  const primary = useSession().data?.user?.email ?? '';
  const run = React.useCallback(
    (input: Omit<FlowInput, 'primary'>) => runSend({ ...input, primary }, (question) => ask(specOf(question, tr))),
    [ask, primary, tr]
  );
  return { run, dialog };
}
