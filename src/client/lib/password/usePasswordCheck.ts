import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadPasswordData } from './blocklist';
import type { PasswordData } from './blocklist';
import type { PasswordRole } from './policy';
import { assessPassword } from './strength';
import type { Assessment } from './strength';

export const passwordDataKey = ['password-data'] as const;

export interface PasswordCheck {
  /** The check can run: its data (a separate chunk of the app) has loaded. */
  ready: boolean;
  /** The data did not load, for example because the connection dropped. Setting a password has to wait: nothing is allowed unchecked. */
  failed: boolean;
  /** null until the data has loaded. */
  assessment: Assessment | null;
  data: PasswordData | undefined;
  retry: () => void;
  role: PasswordRole;
}

/**
 * The verdict on a password being typed, for every screen that sets one. The common-password data loads once, on first use, from the
 * app itself (no network call to anyone else), and stays in memory for the rest of the visit.
 */
export function usePasswordCheck(password: string, role: PasswordRole, accountWords: readonly string[] = []): PasswordCheck {
  const query = useQuery({
    queryKey: passwordDataKey,
    queryFn: loadPasswordData,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
    networkMode: 'always'
  });
  const { data, isError, refetch } = query;
  // A new array on every render would redo the work on every keystroke of an unrelated field.
  const wordsKey = accountWords.join('\u0000');
  const assessment = React.useMemo(
    () => (data === undefined ? null : assessPassword(password, role, data, wordsKey === '' ? [] : wordsKey.split('\u0000'))),
    [data, password, role, wordsKey]
  );
  return {
    ready: data !== undefined,
    failed: isError && data === undefined,
    assessment,
    data,
    retry: () => {
      void refetch();
    },
    role
  };
}
