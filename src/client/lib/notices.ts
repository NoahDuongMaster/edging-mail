import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';
import { activityKey, toNotice } from './activity';
import type { AccountNotice, NoticeRow } from './activity';
import { sessionKey } from './auth';

export const noticesKey = ['notices'] as const;

/** The notices that go in the banner above the mailbox: they ask for attention. A first sign-in only shows in Settings > Account. */
export const isBannerNotice = (notice: AccountNotice): boolean => notice.kind !== 'first_sign_in';

/** At most this many notices show at once; the rest are in Settings > Account. */
export const SHOWN_NOTICES = 3;

/** A notice with a button that stops something (a pending two-factor reset, a pending deletion of locked mail) always comes first. */
const asksForAction = (notice: AccountNotice): boolean => notice.kind === '2fa_reset_pending' || notice.kind === 'locked_delete_requested';

/** The notices the banner shows, in order, and how many more are only in Settings. */
export function bannerNotices(notices: readonly AccountNotice[]): { shown: AccountNotice[]; rest: number } {
  const ordered = notices.filter(isBannerNotice).toSorted((a, b) => Number(asksForAction(b)) - Number(asksForAction(a)));
  return { shown: ordered.slice(0, SHOWN_NOTICES), rest: Math.max(0, ordered.length - SHOWN_NOTICES) };
}

export function useNotices(enabled = true): UseQueryResult<AccountNotice[]> {
  return useQuery({
    queryKey: noticesKey,
    enabled,
    queryFn: async ({ signal }) => {
      const answer = await apiGet<{ notices: NoticeRow[] }>('/api/auth/notices', 'fail.notices_load', signal);
      return answer.notices.map(toNotice);
    },
    // Read again when the window regains focus (the default): a reset that an admin asks for while this tab is open shows up without a reload.
    staleTime: 60_000
  });
}

export function useDismissNotice(): UseMutationResult<unknown, Error, string | number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => apiPost(`/api/auth/notices/${String(id)}/dismiss`, {}, 'fail.notice_dismiss'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: noticesKey })
  });
}

/** An admin's own pending two-factor reset (asked for by another admin, due in 24 hours): the person it is about can stop it. */
export function useCancelTwoFactorReset(): UseMutationResult<unknown, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/api/auth/2fa/cancel-reset', {}, 'fail.notice_cancel_reset'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: noticesKey }),
        queryClient.invalidateQueries({ queryKey: sessionKey }),
        queryClient.invalidateQueries({ queryKey: activityKey })
      ]);
    }
  });
}
