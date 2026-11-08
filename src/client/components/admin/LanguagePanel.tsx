import type React from 'react';
import { isLocale } from '../../../shared/i18n';
import type { ThemeTokens } from '../../theme';
import { LANGUAGE_NAMES, LOCALES, useT } from '../../lib/i18n';
import { useOrgSettings, useSaveDefaultLanguage } from '../../lib/language';
import { adminStyles } from './adminUi';

/** The organisation's default language: what the sign-in screens and anyone who has not chosen a language see. */
export const LanguagePanel: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const s = adminStyles(t);
  const settings = useOrgSettings();
  const save = useSaveDefaultLanguage();
  const current = settings.data?.settings.default_language;

  const loadError = settings.error?.message;
  const saveError = save.error?.message;

  return (
    <section aria-labelledby="admin-language" style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 id="admin-language" style={s.h3}>
        {tr('lang.org_default')}
      </h3>
      <p style={s.muted}>{tr('lang.org_default_hint')}</p>
      <select
        aria-labelledby="admin-language"
        value={isLocale(current) ? current : ''}
        disabled={settings.isPending || save.isPending}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) {
            save.mutate(next);
          }
        }}
        style={s.input}
      >
        {isLocale(current) ? null : <option value="" disabled />}
        {LOCALES.map((tag) => (
          <option key={tag} value={tag} lang={tag}>
            {LANGUAGE_NAMES[tag]}
          </option>
        ))}
      </select>
      {loadError === undefined && saveError === undefined ? null : (
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {saveError ?? loadError}
        </p>
      )}
    </section>
  );
};
