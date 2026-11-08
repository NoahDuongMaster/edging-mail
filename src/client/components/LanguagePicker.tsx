import React from 'react';
import type { ThemeTokens } from '../theme';
import { LANGUAGE_NAMES, LOCALES, chooseLanguage, useLocale, useT, type Locale } from '../lib/i18n';

interface LanguagePickerProps {
  t: ThemeTokens;
  /** Runs after the language was applied on this device (Settings saves it to the account here). May reject with a localized error. */
  onChosen?: (locale: Locale) => Promise<unknown>;
  /** Shows the word "Language" above the list (Settings); the small picker of the sign-in screens has only the accessible name. */
  showLabel?: boolean;
  id?: string;
}

/**
 * The language list: each language by its own name, in its own script, so a person who cannot read the current language still
 * finds theirs. A plain `<select>`: the phone and the desktop both give it their native, accessible list. The choice applies at
 * once and is kept on this device; `onChosen` saves it to the account.
 */
export const LanguagePicker: React.FC<LanguagePickerProps> = ({ t, onChosen, showLabel = false, id = 'language-picker' }) => {
  const tr = useT();
  const locale = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');

  const choose = async (next: Locale): Promise<void> => {
    setBusy(true);
    setProblem('');
    const applied = await chooseLanguage(next);
    if (!applied) {
      setProblem(tr('lang.not_loaded'));
    } else if (onChosen) {
      try {
        await onChosen(next);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : tr('common.something_wrong'));
      }
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {showLabel ? (
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>
          {tr('lang.label')}
        </label>
      ) : null}
      <select
        id={id}
        aria-label={showLabel ? undefined : tr('lang.picker_label')}
        value={locale}
        disabled={busy}
        onChange={(event) => {
          void choose(event.target.value as Locale);
        }}
        style={{
          height: 44,
          padding: '0 12px',
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 10,
          background: t.raised,
          color: t.text,
          font: 'inherit',
          fontSize: 16
        }}
      >
        {LOCALES.map((tag) => (
          <option key={tag} value={tag} lang={tag}>
            {LANGUAGE_NAMES[tag]}
          </option>
        ))}
      </select>
      {problem !== '' && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: t.dark ? '#F97066' : '#B42318' }}>
          {problem}
        </p>
      )}
    </div>
  );
};
