import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from '../api';
import { auditKey } from './audit';
import type { AdminDomain, DnsCheck } from './types';

export const domainsKey = ['admin', 'domains'] as const;

export function useAdminDomains(): UseQueryResult<AdminDomain[]> {
  return useQuery({
    queryKey: domainsKey,
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ domains: AdminDomain[] }>('/api/admin/domains', 'fail.domains_load', signal);
      return data.domains;
    },
    staleTime: 0
  });
}

export function useAddDomain(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiPost('/api/admin/domains', { name }, 'fail.domains_add'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsKey });
      void queryClient.invalidateQueries({ queryKey: auditKey });
    }
  });
}

export function useRemoveDomain(): UseMutationResult<unknown, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/domains/${encodeURIComponent(id)}`, 'fail.domains_remove'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: domainsKey });
      void queryClient.invalidateQueries({ queryKey: auditKey });
    }
  });
}

/**
 * "Check DNS": the Worker looks the domain's records up and answers what it found. A lookup that fails answers an error, never a made-up
 * "ready", so the panel shows the error and the previous result stays visible.
 */
export function useCheckDomain(): UseMutationResult<DnsCheck, Error, string> {
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await apiGet<{ check?: DnsCheck } & Partial<DnsCheck>>(
        `/api/admin/domains/${encodeURIComponent(id)}/check`,
        'fail.domains_check'
      );
      // The contract names the fields at the top level of the answer; a `check` wrapper is accepted as well.
      return (data.check ?? data) as DnsCheck;
    }
  });
}
