import React from 'react';
import type { ThemeTokens } from '../../theme';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { useCountdown } from '../../lib/useCountdown';
import { Button } from '../../ui';
import { AuthButton } from '../auth/authUi';
import { CODE_LENGTH, CodeInput, Failure, PasswordInput } from './securityUi';

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
  /** The action takes a protection away (turning two-factor sign-in off): the button is a danger button. */
  danger?: boolean;
  /** Runs with what was typed. The form keeps neither value once this has returned, whatever the answer. */
  work: (password: string, code: string) => Promise<T>;
  /** Only when `work` succeeded. */
  onResult: (result: T) => void;
}

/**
 * The password (and, where the action needs it, one code) for an action of the Security section. It is not a mutation of react-query: a password
 * and a code must not sit in a cache, so the screen runs `work` through `useAction` and empties both fields as soon as it returns.
 */
export function CredentialForm<T>({
  t,
  id,
  lead,
  submitLabel,
  note,
  withCode,
  danger = false,
  work,
  onResult
}: CredentialFormProps<T>): React.ReactElement {
  const tr = useT();
  const action = useAction();
  const wait = useCountdown(action.retryAfter);
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  // The button can be pressed whenever no request runs and no wait is asked for: a press with something missing shows each field's error and
  // takes the keyboard to the first of them. A press that sends starts the errors over (both fields are emptied whatever the answer).
  const [submitted, setSubmitted] = React.useState(false);
  const focusLater = useFieldFocus();
  const codeMissing = withCode && code.length !== CODE_LENGTH;
  const toFix = firstInvalid([
    [`${id}-password`, password === ''],
    [`${id}-code`, codeMissing]
  ]);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy || wait > 0) {
      return;
    }
    if (toFix !== undefined) {
      setSubmitted(true);
      focusLater(toFix);
      return;
    }
    setSubmitted(false);
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
      className="st-view-form"
    >
      <p className="st-lead">{lead}</p>
      <PasswordInput
        t={t}
        id={`${id}-password`}
        label={tr('term.password')}
        value={password}
        onChange={setPassword}
        invalid={action.error !== null}
        error={submitted && password === '' ? tr('security.password_required') : null}
      />
      {withCode ? (
        <CodeInput
          t={t}
          id={`${id}-code`}
          value={code}
          onChange={setCode}
          invalid={action.error !== null}
          error={submitted && codeMissing ? tr('twofa.code_required') : null}
        />
      ) : null}
      <Failure t={t} id={`${id}-error`} error={action.error} wait={wait} />
      <div>
        {danger ? (
          // The same rules as AuthButton (busy: a spinner, aria-busy, no clicks), in the danger colour.
          <Button
            type="submit"
            variant="danger"
            size="lg"
            className="st-btn"
            loading={action.busy}
            disabled={action.busy || wait > 0}
            aria-busy={action.busy}
          >
            {submitLabel}
          </Button>
        ) : (
          <AuthButton t={t} busy={action.busy} disabled={wait > 0} label={submitLabel} />
        )}
      </div>
      {note === undefined ? null : <p className="st-muted">{note}</p>}
    </form>
  );
}
