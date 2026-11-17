import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiPost } from './api';
import { tr } from './i18n';

// The person's own sender lists (Settings > Filters). `allow`: mail from these never goes to Spam; `block`: it always does. An entry is an address
// (`name@host`) or a bare host, which covers that host and its subdomains; the Worker lower-cases, validates and caps the lists (500 entries), and
// answers `invalid_filter` / `too_many_filters` with the words of the person's language (lib/api.ts `errorText`).

export type FilterKind = 'allow' | 'block';

export interface Filter {
  id: string;
  kind: FilterKind;
  value: string;
  created_at: number;
}

export const filtersKey = ['filters'] as const;

/** One entry of an answer, or undefined when it is not one (a row of an unexpected shape never breaks the screen). */
export function parseFilter(raw: unknown): Filter | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { id, kind, value, created_at: createdAt } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof value !== 'string' || value === '' || (kind !== 'allow' && kind !== 'block')) {
    return undefined;
  }
  return { id, kind, value, created_at: typeof createdAt === 'number' ? createdAt : 0 };
}

/** The entries of `GET /api/filters`, newest first. */
export function parseFilters(raw: unknown): Filter[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row) => parseFilter(row))
    .filter((row): row is Filter => row !== undefined)
    .toSorted((a, b) => b.created_at - a.created_at || a.value.localeCompare(b.value));
}

/** The entries of one list, in the order they are shown. */
export const ofKind = (filters: readonly Filter[], kind: FilterKind): Filter[] => filters.filter((filter) => filter.kind === kind);

/** An entry the `not_spam` batch action created: removed again by `DELETE /api/filters/:id` when the person takes Not spam back. */
export interface AllowedEntry {
  id: string;
  value: string;
}

/** The `allowed` list of a `not_spam` answer (`{ success, count, allowed: [{ id, value }], unblocked: [address] }`); an answer without a readable one allowed nobody. */
export function allowedOf(answer: unknown): AllowedEntry[] {
  const raw = typeof answer === 'object' && answer !== null ? (answer as { allowed?: unknown }).allowed : undefined;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry: unknown) => {
    const { id, value } = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    return typeof id === 'string' && id !== '' && typeof value === 'string' && value !== '' ? [{ id, value }] : [];
  });
}

/** The `unblocked` list of a `not_spam` answer: the addresses whose block entry the action removed, which Undo blocks again. */
export function unblockedOf(answer: unknown): string[] {
  const raw = typeof answer === 'object' && answer !== null ? (answer as { unblocked?: unknown }).unblocked : undefined;
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string' && value !== '') : [];
}

export function useFilters(): UseQueryResult<Filter[]> {
  return useQuery({
    queryKey: filtersKey,
    queryFn: async ({ signal }) => {
      const answer = await apiGet<{ filters?: unknown }>('/api/filters', 'fail.filters_load', signal);
      return parseFilters(answer.filters);
    }
  });
}

export interface NewFilter {
  kind: FilterKind;
  value: string;
}

/** Adds an entry. The server answers 200 with the entry that is already there when the value was listed; it is never shown twice. */
export function useAddFilter(): UseMutationResult<Filter, Error, NewFilter> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry: NewFilter) => {
      const answer = await apiPost<{ filter?: unknown }>('/api/filters', entry, 'fail.filter_add');
      const filter = parseFilter(answer.filter);
      if (filter === undefined) {
        // A success without the entry (not what the Worker sends): the person is told it did not work, in their words.
        throw new Error(tr('fail.filter_add'));
      }
      return filter;
    },
    onSuccess: (filter) =>
      queryClient.setQueryData<Filter[]>(filtersKey, (old) =>
        parseFilters([filter, ...(old ?? []).filter((entry) => entry.id !== filter.id)])
      )
  });
}

/** `DELETE /api/filters/:id`; an entry that is already gone (`not_found`) counts as removed. */
export async function deleteFilter(id: string): Promise<void> {
  try {
    await apiDelete<unknown>(`/api/filters/${encodeURIComponent(id)}`, 'fail.filter_remove');
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'not_found')) {
      throw error;
    }
  }
}

/** Removes an entry (no confirmation: adding it again undoes it). The list shows it gone once the server says so. */
export function useRemoveFilter(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFilter,
    onSuccess: (_none, id) => queryClient.setQueryData<Filter[]>(filtersKey, (old) => old?.filter((entry) => entry.id !== id))
  });
}
