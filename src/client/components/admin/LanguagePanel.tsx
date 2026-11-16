import React from 'react';
import { CircleCheck } from 'lucide-react';
import { isLocale } from '../../../shared/i18n';
import type { ThemeTokens } from '../../theme';
import { announce } from '../../lib/announce';
import { LANGUAGE_NAMES, LOCALES, useT } from '../../lib/i18n';
import { useOrgSettings, useSaveDefaultLanguage } from '../../lib/language';
import { Card, Select } from '../../ui';
import { TwoFactorPolicy } from './TwoFactorPolicy';
import { ErrorText, PageHead } from './adminUi';

/**
 * The organisation's settings, one card each: the default language (what the sign-in screens and anyone who has not chosen a language
 * see; saved as soon as it is chosen) and whether everyone must use two-step sign-in.
 */
export const LanguagePanel: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  const settings = useOrgSettings();
  const save = useSaveDefaultLanguage();
  const current = settings.data?.settings.default_language;

  const loadError = settings.error?.message;
  const saveError = save.error?.message;
  // "Saved" shows under the list once the server took the language, and is said by the live region.
  const saved = save.isSuccess;
  React.useEffect(() => {
    if (saved) {
      announce(tr('settings.saved'));
    }
  }, [saved, tr]);

  return (
    <div className="ad-pane">
      <PageHead title={tr('term.settings')} description={tr('admin.settings_desc')} />
      <div className="ad-cards">
        <Card title={tr('lang.org_default')} description={tr('lang.org_default_hint')} headingLevel={3} className="ad-setting-card">
          <div className="ad-setting">
            <Select
              id="admin-language"
              label={tr('lang.org_default')}
              hideLabel
              // Each language by its own name, marked with its own language (3.1.2), as in the other language lists.
              options={LOCALES.map((tag) => ({ value: tag, label: LANGUAGE_NAMES[tag], lang: tag }))}
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
          {saved ? (
            <p className="ad-feedback">
              <CircleCheck size={16} aria-hidden="true" />
              {tr('settings.saved')}
            </p>
          ) : null}
          {loadError === undefined && saveError === undefined ? null : <ErrorText>{saveError ?? loadError}</ErrorText>}
        </Card>
        <TwoFactorPolicy required={settings.data?.settings.require_2fa} />
      </div>
    </div>
  );
};
