import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { isLocale } from '../../shared/i18n';
import { apiGet, apiPost, apiPut } from './api';
import { sessionKey, useSession } from './auth';
import { readDeviceLanguage, type Locale } from './i18n';

/** Saves the signed-in person's language on the server (it follows them to every device). */
export function useSaveLanguage(): UseMutationResult<unknown, Error, Locale> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (language: Locale) => apiPost('/api/settings', { language }, 'fail.language_save'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKey })
  });
}

export interface OrgSettings {
  success: true;
  settings: { default_language: string; require_2fa: boolean };
}

export const orgSettingsKey = ['admin', 'org-settings'] as const;

/** Admin: the organisation's settings (today the default language). */
export function useOrgSettings(): UseQueryResult<OrgSettings> {
  return useQuery({
    queryKey: orgSettingsKey,
    queryFn: ({ signal }) => apiGet<OrgSettings>('/api/admin/settings', 'fail.org_settings_load', signal)
  });
}

/** Admin: the language of the organisation, used on the sign-in screens and for people who have not chosen one. */
export function useSaveDefaultLanguage(): UseMutationResult<unknown, Error, Locale> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (default_language: Locale) => apiPut('/api/admin/settings', { default_language }, 'fail.default_language_save'),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: sessionKey }), queryClient.invalidateQueries({ queryKey: orgSettingsKey })])
  });
}

/** What decides whether the device language is saved to the account now. */
export interface AdoptionInputs {
  authenticated: boolean;
  /** `session.language`: null when the account has none, undefined while the session is not read. */
  saved: string | null | undefined;
  /** A gate (forced password change, key setup, two-factor enrolment) is still open. */
  gateOpen: boolean;
  /** The language chosen on this device (the picker), as stored. */
  device: string | null;
}

/**
 * The device language to save to the account, or `undefined` when nothing is due: signed in, no language saved yet, a language chosen on this
 * device, and no gate open. The server refuses every settings call while a gate is open (403), so a save made then is lost for good: it waits
 * for the last gate (C-8).
 */
export function languageToAdopt({ authenticated, saved, gateOpen, device }: AdoptionInputs): Locale | undefined {
  if (!authenticated || gateOpen || saved !== null) {
    return undefined;
  }
  return isLocale(device) ? device : undefined;
}

/**
 * A person with no saved language who signs in after choosing one in the sign-in picker keeps that choice: it is saved to the account once, as
 * soon as the sign-in and its gates are done. A `?lang=` link alone is never saved (it is not written to the device either).
 */
export function useAdoptDeviceLanguage(): void {
  const session = useSession().data;
  const save = useSaveLanguage();
  const tried = useRef(false);
  const authenticated = session?.authenticated === true;
  const saved = session?.language;
  const gateOpen = (session?.gate ?? null) !== null;
  const { mutate } = save;
  useEffect(() => {
    if (tried.current) {
      return;
    }
    const language = languageToAdopt({ authenticated, saved, gateOpen, device: readDeviceLanguage() });
    if (language !== undefined) {
      tried.current = true;
      mutate(language);
    }
  }, [authenticated, saved, gateOpen, mutate]);
}
