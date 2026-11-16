import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';
import { initialsOf } from '../ui/initials';

export interface Settings {
  display_name: string;
  signature: string;
  /** The person's own primary address: their sign-in name and the only From address. Read-only; the server ignores it on save. */
  email: string;
}

/** What a save sends: the two fields a person can change. */
export type SettingsPatch = Partial<Pick<Settings, 'display_name' | 'signature'>>;

export const settingsKey = ['settings'] as const;

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ settings: Settings }>('/api/settings', 'fail.settings_load', signal);
      return data.settings;
    }
  });
}

export function useSaveSettings(): UseMutationResult<Settings, Error, SettingsPatch> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const data = await apiPost<{ settings: Settings }>('/api/settings', patch, 'fail.settings_save');
      return data.settings;
    },
    // The server answers with the effective settings, which replace the cached ones.
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings)
  });
}

/**
 * Avatar initials of the owner, by the one rule of every avatar (ui/initials.ts: two Latin initials, one CJK character): the display name,
 * else the sender address, else '?'. Empty while the settings load.
 */
export function ownerInitials(settings?: Settings): string {
  if (settings === undefined) {
    return '';
  }
  const name = settings.display_name.trim();
  return initialsOf(name === '' ? settings.email.trim() : name);
}

/** Plain-text signature block for the editor: a blank line, the '-- ' separator, the signature. '' when none is saved. */
export function signatureBlock(signature: string): string {
  const text = signature.trimEnd();
  return text.trim() === '' ? '' : `\n\n-- \n${text}`;
}

/**
 * The editor's `innerText` drops the trailing space of the '-- ' separator (and may hold it as a no-break space), which
 * would stop mail clients from recognising the signature. A line that is exactly '--' gets its space back.
 */
export function restoreSignatureDelimiter(text: string): string {
  return text.replaceAll('\u00A0', ' ').replaceAll(/^-- ?$/gm, '-- ');
}
