import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { apiGet } from '../api';
import { PAGE_SIZE, type AuditPage } from './types';

export const auditKey = ['admin', 'audit'] as const;

/** The audit log, newest first, a page at a time. */
export function useAdminAudit(): UseInfiniteQueryResult<InfiniteData<AuditPage, string>> {
  return useInfiniteQuery({
    queryKey: auditKey,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam !== '') {
        params.set('cursor', pageParam);
      }
      return apiGet<AuditPage>(`/api/admin/audit?${params.toString()}`, 'fail.audit_load', signal);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0
  });
}
