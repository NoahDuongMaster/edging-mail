import React from 'react';
import type { ThemeTokens } from '../theme';
import { LANGUAGE_NAMES, LOCALES, chooseLanguage, useLocale, useT, type Locale } from '../lib/i18n';
import { Select } from '../ui';
import './auth/auth.css';

interface LanguagePickerProps {
  t: ThemeTokens;
  /** Runs after the language was applied on this device (Settings saves it to the account here). May reject with a localized error. */
  onChosen?: (locale: Locale) => Promise<unknown>;
  /** Shows the word "Language" above the list (Settings); the small picker of the sign-in screens has only the accessible name. */
  showLabel?: boolean;
  id?: string;
}

// Each language by its own name, in its own script: the same list on every screen.
const OPTIONS = LOCALES.map((tag) => ({ value: tag, label: LANGUAGE_NAMES[tag] }));

/**
 * The language list: each language by its own name, in its own script, so a person who cannot read the current language still
 * finds theirs. The app's own list (ui/Select: arrows, Home/End, letters, Escape, 44 px rows on touch). The choice applies at once and is
 * kept on this device; `onChosen` saves it to the account.
 */
export const LanguagePicker: React.FC<LanguagePickerProps> = ({ onChosen, showLabel = false, id = 'language-picker' }) => {
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
    <div className="au-lang">
      <Select
        id={id}
        label={showLabel ? tr('lang.label') : tr('lang.picker_label')}
        hideLabel={!showLabel}
        options={OPTIONS}
        value={locale}
        disabled={busy}
        onChange={(value) => {
          const next = LOCALES.find((tag) => tag === value);
          // Choosing the language that is already on does nothing (as the browser's own list did): Settings does not save it again.
          if (next !== undefined && next !== locale) {
            void choose(next);
          }
        }}
      />
      {problem !== '' && (
        <p role="alert" className="ui-error">
          {problem}
        </p>
      )}
    </div>
  );
};
