import React from 'react';
import { Eye, EyeOff, Loader2, Wand2 } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { levelLabel, meterValueText, problemMessages } from '../lib/password/messages';
import { PASSPHRASE_WORDS, generatePassphrase } from '../lib/password/random';
import type { PasswordCheck } from '../lib/password/usePasswordCheck';

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
}

/** A password input with a show/hide button, a strength bar and the reason a password is refused. Used on every screen that sets one. */
export const PasswordField: React.FC<PasswordFieldProps> = ({
  t,
  id,
  label,
  value,
  onChange,
  check,
  offerPassphrase = false,
  disabled = false,
  describedBy
}) => {
  const tr = useT();
  const [shown, setShown] = React.useState(false);
  const [suggested, setSuggested] = React.useState(false);
  const { assessment } = check;
  const danger = t.dark ? '#F97066' : '#B42318';
  const good = t.dark ? '#4ADE80' : '#15803D';
  const level = assessment?.level ?? 0;
  const refused = assessment !== null && value !== '' && !assessment.ok;
  const barColor = level <= 1 ? danger : level === 2 ? (t.dark ? '#FBBF24' : '#B45309') : good;

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
  if (check.failed) {
    status = (
      <span role="alert" style={{ color: danger }}>
        {tr('password.check_failed')}{' '}
        <button
          type="button"
          onClick={check.retry}
          style={{
            border: 0,
            padding: 0,
            background: 'none',
            color: t.link,
            font: 'inherit',
            textDecoration: 'underline',
            cursor: 'pointer'
          }}
        >
          {tr('common.retry')}
        </button>
      </span>
    );
  } else if (assessment === null) {
    status = (
      <span style={{ color: t.text2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Loader2 size={13} className="nm-spin" aria-hidden="true" /> {tr('password.check_loading')}
      </span>
    );
  } else if (refused || value === '') {
    status = (
      <span style={{ color: refused ? danger : t.text2 }}>{problemMessages(assessment.problems, assessment.length, assessment.min)}</span>
    );
  } else {
    status = <span style={{ color: level >= 3 ? good : t.text2 }}>{levelLabel(level)}</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
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
          aria-invalid={refused}
          aria-describedby={`${id}-status${describedBy === undefined ? '' : ` ${describedBy}`}`}
          style={{
            width: '100%',
            height: 44,
            padding: '0 48px 0 12px',
            border: `1px solid ${refused ? danger : t.borderStrong}`,
            borderRadius: 10,
            background: t.raised,
            color: t.text,
            font: 'inherit',
            fontSize: 16
          }}
        />
        <button
          type="button"
          className="nm-tap"
          onClick={() => setShown((on) => !on)}
          aria-label={shown ? tr('password.hide') : tr('password.show')}
          aria-pressed={shown}
          disabled={disabled}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 44,
            height: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            background: 'transparent',
            color: t.text2,
            cursor: 'pointer'
          }}
        >
          {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      <div
        role="meter"
        aria-label={tr('password.meter_label')}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={level}
        aria-valuetext={meterValueText(level)}
        style={{ display: 'flex', gap: 4 }}
      >
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            aria-hidden="true"
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: segment <= level ? barColor : t.track,
              transition: 'background 120ms ease'
            }}
          />
        ))}
      </div>
      <p id={`${id}-status`} aria-live="polite" style={{ margin: 0, fontSize: 12.5, lineHeight: '19px' }}>
        {status}
      </p>
      {offerPassphrase ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            className="nm-tap-h"
            onClick={suggest}
            disabled={disabled || !check.ready}
            style={{
              alignSelf: 'flex-start',
              height: 38,
              padding: '0 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: `1px solid ${t.borderStrong}`,
              borderRadius: 10,
              background: t.surface,
              color: t.text,
              font: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              cursor: check.ready ? 'pointer' : 'not-allowed',
              opacity: check.ready ? 1 : 0.5
            }}
          >
            <Wand2 size={15} aria-hidden="true" />
            {suggested ? tr('password.suggest_another') : tr('password.suggest')}
          </button>
          {suggested ? (
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: t.text2 }}>
              {tr('password.suggest_hint', { words: PASSPHRASE_WORDS })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
