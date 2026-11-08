import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { AuthButton } from '../auth/authUi';
import { CODE_LENGTH, CodeInput, Failure, PasswordInput, formStyle, leadStyle, mutedStyle } from './securityUi';

interface CredentialFormProps<T> {
  t: ThemeTokens;
  /** Prefix of the field ids, so two forms never share one. */
  id: string;
  lead: string;
  submitLabel: string;
  /** A plain line under the button. */
  note?: string;
  /** Also asks for the six-digit code of the authenticator app. */
  withCode: boolean;
  /** Runs with what was typed. The form keeps neither value once this has returned, whatever the answer. */
  work: (password: string, code: string) => Promise<T>;
  /** Only when `work` succeeded. */
  onResult: (result: T) => void;
}

/**
 * The password (and, where the action needs it, one code) for an action of the Security card. It is not a mutation of react-query: a password
 * and a code must not sit in a cache, so the screen runs `work` through `useAction` and empties both fields as soon as it returns.
 */
export function CredentialForm<T>({
  t,
  id,
  lead,
  submitLabel,
  note,
  withCode,
  work,
  onResult
}: CredentialFormProps<T>): React.ReactElement {
  const tr = useT();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const ready = password !== '' && (!withCode || code.length === CODE_LENGTH);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0 || !ready) {
      return;
    }
    const result = await action.run(() => work(password, code));
    // The password and the code have done their job: neither stays in this screen's state.
    setPassword('');
    setCode('');
    if (result !== undefined) {
      onResult(result);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      style={formStyle}
    >
      <p style={leadStyle(t)}>{lead}</p>
      <PasswordInput
        t={t}
        id={`${id}-password`}
        label={tr('term.password')}
        value={password}
        onChange={setPassword}
        invalid={action.error !== null}
      />
      {withCode ? <CodeInput t={t} id={`${id}-code`} value={code} onChange={setCode} invalid={action.error !== null} /> : null}
      <Failure t={t} id={`${id}-error`} error={action.error} wait={wait} />
      <div>
        <AuthButton t={t} busy={action.busy} disabled={!ready || wait > 0} label={submitLabel} />
      </div>
      {note === undefined ? null : <p style={mutedStyle(t)}>{note}</p>}
    </form>
  );
}
