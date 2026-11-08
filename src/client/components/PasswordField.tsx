import React from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { levelLabel, meterValueText, problemMessages, rulesText } from '../lib/password/messages';
import { PASSPHRASE_WORDS, generatePassphrase } from '../lib/password/random';
import type { PasswordCheck } from '../lib/password/usePasswordCheck';
import { Button, IconButton, Spinner, TextField } from '../ui';
import './auth/auth.css';

interface PasswordFieldProps {
  t: ThemeTokens;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** From usePasswordCheck(value, role, accountWords): the parent also needs it to know when the form may be sent. */
  check: PasswordCheck;
  /** Admin screens offer a generated passphrase. */
  offerPassphrase?: boolean;
  disabled?: boolean;
  describedBy?: string;
  /** The form was sent while the field was empty: the line under it then says, in red, that a password is needed, before the rules. */
  submitted?: boolean;
}

type Tone = 'danger' | 'warning' | 'success' | undefined;

/** The colour of the filled segments: weak is red, fair is amber, good and strong are green. The words under the bar say the same. */
const meterTone = (level: number): Tone => (level <= 1 ? 'danger' : level === 2 ? 'warning' : 'success');

/** A password input with a show/hide button, a strength bar and the reason a password is refused. Used on every screen that sets one. */
export const PasswordField: React.FC<PasswordFieldProps> = ({
  id,
  label,
  value,
  onChange,
  check,
  offerPassphrase = false,
  disabled = false,
  describedBy,
  submitted = false
}) => {
  const tr = useT();
  const [shown, setShown] = React.useState(false);
  const [suggested, setSuggested] = React.useState(false);
  const { assessment } = check;
  const level = assessment?.level ?? 0;
  const refused = assessment !== null && value !== '' && !assessment.ok;
  // Known without the check's data, so it is said even while that data loads.
  const missing = submitted && value === '';

  const suggest = () => {
    if (check.data === undefined) {
      return;
    }
    onChange(generatePassphrase(check.data.words));
    // Shown, so the person can copy or write it down: a password they never saw is one they cannot use.
    setShown(true);
    setSuggested(true);
  };

  let status: React.ReactNode;
  let statusTone: Tone;
  if (check.failed) {
    statusTone = 'danger';
    status = (
      <>
        <span role="alert">{tr('password.check_failed')}</span>
        <Button variant="ghost" size="sm" onClick={check.retry}>
          {tr('common.retry')}
        </Button>
      </>
    );
  } else if (missing) {
    statusTone = 'danger';
    status = `${tr('password.required')} ${rulesText()}`;
  } else if (assessment === null) {
    status = (
      <>
        <Spinner size={13} decorative /> {tr('password.check_loading')}
      </>
    );
  } else if (refused || value === '') {
    statusTone = refused ? 'danger' : undefined;
    status = problemMessages(assessment.problems, assessment.length, assessment.min);
  } else {
    statusTone = level >= 3 ? 'success' : undefined;
    status = levelLabel(level);
  }

  return (
    <div className="au-pw">
      <TextField
        id={id}
        label={label}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setSuggested(false);
        }}
        aria-invalid={refused || missing}
        aria-describedby={`${id}-status${describedBy === undefined ? '' : ` ${describedBy}`}`}
        trailing={
          <IconButton
            label={shown ? tr('password.hide') : tr('password.show')}
            size="sm"
            pressed={shown}
            disabled={disabled}
            onClick={() => setShown((on) => !on)}
          >
            {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </IconButton>
        }
      />
      <div
        role="meter"
        aria-label={tr('password.meter_label')}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={level}
        aria-valuetext={meterValueText(level)}
        className="au-meter"
        data-tone={meterTone(level)}
      >
        {[1, 2, 3, 4].map((segment) => (
          <span key={segment} aria-hidden="true" className="au-meter-seg" data-on={segment <= level ? 'true' : undefined} />
        ))}
      </div>
      <p id={`${id}-status`} aria-live="polite" className="au-status" data-tone={statusTone}>
        {status}
      </p>
      {offerPassphrase ? (
        <>
          <Button
            size="sm"
            className="au-suggest"
            leadingIcon={<Wand2 size={15} aria-hidden="true" />}
            onClick={suggest}
            disabled={disabled || !check.ready}
          >
            {suggested ? tr('password.suggest_another') : tr('password.suggest')}
          </Button>
          {suggested ? <p className="ui-hint">{tr('password.suggest_hint', { words: PASSPHRASE_WORDS })}</p> : null}
        </>
      ) : null}
    </div>
  );
};
