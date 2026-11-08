import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { activityKey } from './activity';
import type { AccountNotice } from './activity';
import { apiPost } from './api';
import { lockedCancelBody } from './crypto/requests';
import { fetchMyKeys } from './crypto/unlock';
import type { RetiredKey } from './crypto/unlock';
import { noticesKey } from './notices';

// Locked old mail: messages sealed to a key that was replaced (after a break-glass), which this browser cannot open. The server counts them per
// retired key (`GET /api/keys/me`, e2e-contract.md section 9). The person keeps them (nothing to do) or asks to delete them: the server waits
// seven days and the person can cancel until then. Nothing here is a secret: the wrapped keys of the answer are dropped before anything is cached.

export const lockedMailKey = ['locked-mail'] as const;

/** One retired key that still has mail under it, or a deletion waiting for its date. */
export interface LockedMail {
  keyId: string;
  /** How many messages are sealed to this key. */
  locked: number;
  /** When the server will delete them (epoch ms); null when no deletion is pending. */
  deleteAfter: number | null;
}

/** What the banner needs of the retired keys, newest first as the server lists them. A key with nothing under it and nothing pending is not shown. */
export function lockedMailOf(retired: readonly RetiredKey[]): LockedMail[] {
  return retired
    .map((key) => ({ keyId: key.key_id, locked: key.locked, deleteAfter: key.delete_after }))
    .filter((entry) => entry.locked > 0 || entry.deleteAfter !== null);
}

export function useLockedMail(enabled = true): UseQueryResult<LockedMail[]> {
  return useQuery({
    queryKey: lockedMailKey,
    enabled,
    queryFn: loadLockedMail,
    // The count changes only when the person acts or the nightly job runs; looked at again when the window regains focus.
    staleTime: 60_000
  });
}

/** Reads the person's keys and keeps only the retired ones' counts: the bundle (wrapped keys included) is dropped here, before anything is cached. */
export async function loadLockedMail(): Promise<LockedMail[]> {
  const { retired } = await fetchMyKeys();
  return lockedMailOf(retired);
}

/** After a request for deletion or a cancel: the list, the notices and the sign-in history all changed. */
export function afterLockedChange(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: lockedMailKey }),
    queryClient.invalidateQueries({ queryKey: noticesKey }),
    queryClient.invalidateQueries({ queryKey: activityKey })
  ]);
}

/** Cancels a pending deletion of locked mail: the session is enough. A `409` means nothing is pending any more. */
export const cancelLockedDelete = (keyId: string): Promise<unknown> =>
  apiPost('/api/keys/cancel-delete-locked', lockedCancelBody(keyId), 'fail.locked_cancel');

/** A refusal (nothing is pending any more: cancelled elsewhere, or done) reads the list again too, so the screen tells the truth. */
export function useCancelLockedDelete(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelLockedDelete,
    onSuccess: () => afterLockedChange(queryClient),
    onError: () => afterLockedChange(queryClient)
  });
}

/** The key a `locked_delete_requested` notice is about (`detail.key_id`), or null. */
export function noticeKeyId(notice: AccountNotice): string | null {
  const keyId = notice.detail?.key_id;
  return typeof keyId === 'string' ? keyId : null;
}

/** The deletion still waiting for its date that this notice is about; undefined once it was cancelled or carried out (or while the list loads). */
export function pendingFor(notice: AccountNotice, mail: readonly LockedMail[]): LockedMail | undefined {
  const keyId = noticeKeyId(notice);
  return keyId === null ? undefined : mail.find((entry) => entry.keyId === keyId && entry.deleteAfter !== null);
}

export type BannerRow = { state: 'ask'; mail: LockedMail } | { state: 'pending'; mail: LockedMail; until: number };

/**
 * The rows of the locked-mail banner. A pending deletion is shown by its own notice (with its date and its Cancel button) while that notice is on
 * screen, so there are never two Cancel buttons for one thing; a key the person chose to keep, in this tab, stays out of the way.
 */
export function bannerRows(
  mail: readonly LockedMail[],
  shownNotices: readonly AccountNotice[],
  isKept: (keyId: string) => boolean
): BannerRow[] {
  const announced = new Set(shownNotices.filter((notice) => notice.kind === 'locked_delete_requested').map(noticeKeyId));
  const rows: BannerRow[] = [];
  for (const entry of mail) {
    if (entry.deleteAfter === null) {
      if (!isKept(entry.keyId)) {
        rows.push({ state: 'ask', mail: entry });
      }
    } else if (!announced.has(entry.keyId)) {
      rows.push({ state: 'pending', mail: entry, until: entry.deleteAfter });
    }
  }
  return rows;
}

/** Does what was typed name the person's own address (the word they type to confirm a deletion)? Case and surrounding spaces do not matter. */
export const isOwnAddress = (typed: string, email: string): boolean => {
  const own = email.trim().toLowerCase();
  return own !== '' && typed.trim().toLowerCase() === own;
};
