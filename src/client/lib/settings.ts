import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';
import { initialsOf } from './mail';

export interface Settings {
  display_name: string;
  signature: string;
  default_from: string;
}

export const settingsKey = ['settings'] as const;

export function useSettings(): UseQueryResult<Settings> {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ settings: Settings }>('/api/settings', 'Failed to load settings', signal);
      return data.settings;
    }
  });
}

export function useSaveSettings(): UseMutationResult<Settings, Error, Partial<Settings>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const data = await apiPost<{ settings: Settings }>('/api/settings', patch, 'Failed to save settings');
      return data.settings;
    },
    // The server answers with the effective settings, which replace the cached ones.
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings)
  });
}

/** Avatar initials of the owner: display name, else the local part of the sender address, else '?'. Empty while the settings load. */
export function ownerInitials(settings: Settings | undefined): string {
  if (settings === undefined) {
    return '';
  }
  return initialsOf(settings.display_name.trim(), settings.default_from.split('@', 1)[0].trim());
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
