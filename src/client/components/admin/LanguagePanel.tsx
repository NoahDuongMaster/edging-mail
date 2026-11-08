import type React from 'react';
import { isLocale } from '../../../shared/i18n';
import type { ThemeTokens } from '../../theme';
import { LANGUAGE_NAMES, LOCALES, useT } from '../../lib/i18n';
import { useOrgSettings, useSaveDefaultLanguage } from '../../lib/language';
import { Select } from '../../ui';
import { ErrorText } from './adminUi';

/** The organisation's default language: what the sign-in screens and anyone who has not chosen a language see. */
export const LanguagePanel: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  const settings = useOrgSettings();
  const save = useSaveDefaultLanguage();
  const current = settings.data?.settings.default_language;

  const loadError = settings.error?.message;
  const saveError = save.error?.message;

  return (
    <div className="ad-pane">
      <div className="ad-setting">
        <Select
          id="admin-language"
          label={tr('lang.org_default')}
          hint={tr('lang.org_default_hint')}
          options={LOCALES.map((tag) => ({ value: tag, label: LANGUAGE_NAMES[tag] }))}
          value={isLocale(current) ? current : ''}
          disabled={settings.isPending || save.isPending}
          onChange={(next) => {
            // The list also answers a choice of the language that is already set: that is not a change, so nothing is saved (or logged).
            if (isLocale(next) && next !== current) {
              save.mutate(next);
            }
          }}
        />
      </div>
      {loadError === undefined && saveError === undefined ? null : <ErrorText>{saveError ?? loadError}</ErrorText>}
    </div>
  );
};
