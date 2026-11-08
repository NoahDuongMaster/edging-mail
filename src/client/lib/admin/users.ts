import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api';
import { PAGE_SIZE, type AdminUser, type Role, type UserStatus, type UsersPage } from './types';
import { domainsKey } from './domains';
import { auditKey } from './audit';

export const usersKey = ['admin', 'users'] as const;

/** The people list: server-side search over address, name and aliases, and a cursor for the next page (never every row at once). */
export function useAdminUsers(search: string): UseInfiniteQueryResult<InfiniteData<UsersPage, string>> {
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: [...usersKey, q],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (q !== '') {
        params.set('q', q);
      }
      if (pageParam !== '') {
        params.set('cursor', pageParam);
      }
      return apiGet<UsersPage>(`/api/admin/users?${params.toString()}`, 'fail.users_load', signal);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The list changes under the admin's hands (another admin, a first sign-in): look again when the tab is shown.
    staleTime: 0
  });
}

export interface NewUserRequest {
  local_part: string;
  domain: string;
  display_name: string;
  role: Role;
  /** Derived in this browser from the address and the one-time password (lib/credentials.ts). */
  auth: string;
  kdf: 1;
}

export interface UserPatch {
  display_name?: string;
  role?: Role;
  status?: UserStatus;
}

/** Everything an admin changes about an account changes the audit log, and creating or removing one changes the domain's address count. */
function useRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: usersKey });
    void queryClient.invalidateQueries({ queryKey: domainsKey });
    void queryClient.invalidateQueries({ queryKey: auditKey });
  };
}

export function useCreateUser(): UseMutationResult<{ user: AdminUser }, Error, NewUserRequest> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (request: NewUserRequest) => apiPost<{ user: AdminUser }>('/api/admin/users', request, 'fail.users_create'),
    onSuccess: refresh
  });
}

export function usePatchUser(): UseMutationResult<unknown, Error, { id: string; patch: UserPatch }> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, patch }) => apiPatch(`/api/admin/users/${encodeURIComponent(id)}`, patch, 'fail.users_change'),
    onSuccess: refresh
  });
}

/**
 * A new temporary password for an account whose person has never signed in (no keys yet): the old one dies at once. The browser derives
 * `auth` from the new password (lib/credentials.ts); the server only ever sees `auth`. The server refuses it for anyone else.
 */
export function useReissueTempPassword(): UseMutationResult<unknown, Error, { id: string; auth: string; kdf: 1 }> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, auth, kdf }) => apiPost(`/api/admin/users/${encodeURIComponent(id)}/reissue`, { auth, kdf }, 'fail.users_reissue'),
    onSuccess: refresh
  });
}

/** What `POST /api/admin/users/:id/reset-2fa` answers: `applied` for a member (at once), `due` (epoch ms) for an admin (scheduled, the person can cancel). */
export interface TwoFactorResetResult {
  applied: boolean;
  due?: number;
}

/** Clears the person's authenticator and recovery codes, so they set up two-factor sign-in again at the next sign-in (an admin's reset waits 24 hours). */
export function useResetTwoFactor(): UseMutationResult<TwoFactorResetResult, Error, string> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<TwoFactorResetResult>(`/api/admin/users/${encodeURIComponent(id)}/reset-2fa`, {}, 'fail.users_reset_two_factor'),
    onSuccess: refresh
  });
}

export function useAddAlias(): UseMutationResult<unknown, Error, { id: string; address: string }> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, address }) => apiPost(`/api/admin/users/${encodeURIComponent(id)}/aliases`, { address }, 'fail.users_alias_add'),
    onSuccess: refresh
  });
}

export function useRemoveAlias(): UseMutationResult<unknown, Error, { id: string; address: string }> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, address }) =>
      apiDelete(`/api/admin/users/${encodeURIComponent(id)}/aliases/${encodeURIComponent(address)}`, 'fail.users_alias_remove'),
    onSuccess: refresh
  });
}

/** Deletes the account and all its mail. `confirm` is the exact address, typed by the admin. */
export function useDeleteUser(): UseMutationResult<unknown, Error, { id: string; confirm: string }> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, confirm }) => apiDelete(`/api/admin/users/${encodeURIComponent(id)}`, 'fail.users_delete', { confirm }),
    onSuccess: refresh
  });
}
