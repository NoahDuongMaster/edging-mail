import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { apiGet, apiPost } from './api';

export interface Session {
  authenticated: boolean;
}

export const sessionKey = ['session'] as const;

/**
 * Flips the session to signed out (App then shows the login screen) and drops every cached mail, setting
 * and push status so nothing from the old session stays in memory. The session entry itself is kept:
 * `queryClient.clear()` would detach App's session observer, so the screen would never update.
 */
export function endSession(queryClient: QueryClient): void {
  queryClient.setQueryData<Session>(sessionKey, { authenticated: false });
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] });
}

export function useSession(): UseQueryResult<Session> {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      const data = await apiGet<Session>('/api/auth/session', 'Failed to check the session', signal);
      return { authenticated: data.authenticated };
    },
    // A cookie that expires later shows up as a 401 on some API call, which ends the session (main.tsx).
    staleTime: Infinity,
    // Until the first answer arrives (server down, started offline) the check tries again by itself every 5 s.
    refetchInterval: (query) => (query.state.data === undefined ? 5000 : false)
  });
}

export const CANNOT_REACH_SERVER = 'Cannot reach the server. Check your connection and try again.';

// `fetch` rejects with a TypeError ('Failed to fetch', 'Load failed', ...) when the server cannot be reached at all.
async function humanizeNetworkError<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw error instanceof TypeError ? new Error(CANNOT_REACH_SERVER) : error;
  }
}

export function useLogin(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => humanizeNetworkError(apiPost('/api/auth/login', { password }, 'Could not sign in')),
    onSuccess: () => queryClient.setQueryData<Session>(sessionKey, { authenticated: true })
  });
}

export function useLogout(): UseMutationResult<unknown, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => humanizeNetworkError(apiPost('/api/auth/logout', {}, 'Could not sign out')),
    onSuccess: () => endSession(queryClient)
  });
}
