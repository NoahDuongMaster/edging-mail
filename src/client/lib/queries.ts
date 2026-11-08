import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult
} from '@tanstack/react-query';
import React from 'react';
import type { Attachment, FolderStats, Message } from '../types';
import { apiGet, apiPost } from './api';
import { getUnlockedKey } from './crypto/keyStore';
import { openDetail, openListRows } from './mailcrypto/rows';
import type { DetailRow } from './mailcrypto/rows';
import { withLoadedMatches } from './mailcrypto/search';
import { bindMailCache } from './mailcrypto/sync';

export type BatchAction = 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'restore' | 'move' | 'snooze' | 'delete';

export interface MessageDetail {
  message: Message;
  attachments: Attachment[];
}

export interface BatchVariables {
  action: BatchAction;
  ids: string[];
  /** Target folder of a 'move'. */
  folder?: string;
  /** Wake time of a 'snooze', epoch ms. */
  until?: number;
}

export interface SendPayload {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content_type: string; content_base64: string }[];
  /** Message-ID (with angle brackets) of the mail being answered; absent for new mails and forwards. */
  in_reply_to?: string;
  references?: string[];
  /** The draft this send finishes: the server deletes it once the mail is delivered. */
  draft_id?: string;
}

export const queryKeys = {
  stats: ['stats'] as const,
  // Every message list sits under this prefix, so one filter patches or invalidates all of them.
  messages: ['messages'] as const,
  messageList: (folder: string, search: string) => ['messages', { folder, search }] as const,
  // Details use another root on purpose: they hold one message, not an array of rows.
  messageDetails: ['message'] as const,
  messageDetail: (id: string) => ['message', id] as const,
  labels: ['labels'] as const
};

// Everything that holds opened (decrypted) mail: dropped when the keys are wiped, read again when a key appears (lib/mailcrypto/sync.ts).
const MAIL_ROOTS = [queryKeys.messages, queryKeys.messageDetails] as const;

export function useStats(): UseQueryResult<FolderStats> {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ stats: FolderStats }>('/api/stats', 'fail.queries_stats', signal);
      return data.stats;
    }
  });
}

/** Labels in use by mail outside Trash and Spam. */
export function useLabels(): UseQueryResult<string[]> {
  return useQuery({
    queryKey: queryKeys.labels,
    queryFn: async ({ signal }) => {
      const data = await apiGet<{ labels?: string[] }>('/api/labels', 'fail.queries_labels', signal);
      return data.labels ?? [];
    }
  });
}

export const MESSAGES_PAGE_SIZE = 50;

/** One loaded page of a message list. */
export interface MessagesPage {
  messages: Message[];
  /** The server filled the page, so older mail may follow. Stored, not derived from the length: archiving a row shortens a page. */
  hasMore: boolean;
}

type MessageLists = InfiniteData<MessagesPage, number>;

/** The rows of all loaded pages, each mail once: a mail arriving or leaving between two page loads shifts the pages and repeats a row. */
function flattenPages(data: MessageLists): Message[] {
  const seen = new Set<string>();
  const rows: Message[] = [];
  for (const page of data.pages) {
    for (const message of page.messages) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        rows.push(message);
      }
    }
  }
  return rows;
}

/**
 * The rows of the same view that are already loaded without a search. The server matches only addresses; a subject lives encrypted there,
 * so a search looks for it here, among what the browser has opened (lib/mailcrypto/search.ts).
 */
function loadedRowsOf(queryClient: QueryClient, folder: string): Message[] {
  const rows: Message[] = [];
  for (const [key, data] of queryClient.getQueriesData<MessageLists>({ queryKey: queryKeys.messages })) {
    const view: unknown = key[1];
    if (
      data !== undefined &&
      typeof view === 'object' &&
      view !== null &&
      'folder' in view &&
      'search' in view &&
      view.folder === folder &&
      view.search === ''
    ) {
      rows.push(...flattenPages(data));
    }
  }
  return rows;
}

/** `data` is the flattened rows of the loaded pages; `fetchNextPage` appends the next one. */
export function useMessages({ folder, search }: { folder: string; search: string }): UseInfiniteQueryResult<Message[]> {
  const queryClient = useQueryClient();
  React.useEffect(() => bindMailCache(queryClient, MAIL_ROOTS), [queryClient]);
  const select = React.useCallback(
    (data: MessageLists): Message[] => {
      const rows = flattenPages(data);
      return search === '' ? rows : withLoadedMatches(rows, loadedRowsOf(queryClient, folder), search, folder);
    },
    [queryClient, folder, search]
  );
  return useInfiniteQuery({
    queryKey: queryKeys.messageList(folder, search),
    // The param is the number of rows held so far. A refetch walks the loaded pages again from 0.
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      // The server pages by number. The offset sits on a page boundary except after a removal (an archived row shortens a
      // page): then the page that contains it is fetched and the rows already held are dropped, so none is skipped.
      const params = new URLSearchParams({
        folder,
        page: String(Math.floor(pageParam / MESSAGES_PAGE_SIZE) + 1),
        limit: String(MESSAGES_PAGE_SIZE)
      });
      if (search) {
        params.set('q', search);
      }
      // The signal aborts the request as soon as another search or folder replaces this one.
      const data = await apiGet<{ messages?: Message[] }>(`/api/messages?${params.toString()}`, 'fail.queries_messages', signal);
      const rows = data.messages ?? [];
      // Opened here, so the cache and the components only ever see the subject and the snippet, never a blob.
      const opened = await openListRows(rows.slice(pageParam % MESSAGES_PAGE_SIZE), getUnlockedKey());
      return { messages: opened, hasMore: rows.length === MESSAGES_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.reduce((held, page) => held + page.messages.length, 0) : undefined),
    select,
    // Keep showing the previous rows while the next search is loading instead of flashing empty, but
    // not across folders: another folder's rows under the new title would be wrong.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1].folder === folder ? previous : undefined),
    // Always revalidate when a list is shown again (folder switch), as before: cached rows appear at
    // once, and every optimistic patch below restamps a list as fresh, so a stale time would hide changes.
    staleTime: 0
  });
}

export function messageDetailOptions(
  queryClient: QueryClient,
  id: string | null
): UseQueryOptions<MessageDetail, Error, MessageDetail, ReturnType<typeof queryKeys.messageDetail>> {
  return {
    queryKey: queryKeys.messageDetail(id ?? ''),
    enabled: id !== null,
    // Not given the abort signal on purpose: the first GET marks the mail read on the server, so it must
    // always finish and reach the cached lists below, even if the user has already moved on.
    queryFn: async ({ queryKey }): Promise<MessageDetail> => {
      const messageId = queryKey[1];
      // A refetch of a mail that is already shown (a realtime change) only peeks: reading it again would mark it read, so a mail
      // that came back unread while open would silently turn read.
      const peek = queryClient.getQueryData(queryKey) !== undefined;
      const data = await apiGet<{ message: DetailRow; attachments?: Attachment[] }>(
        `/api/messages/${encodeURIComponent(messageId)}${peek ? '?peek=1' : ''}`,
        'fail.queries_message'
      );
      // The text, the attachment names and the state of the message come out of the blobs here (the key is read once, so one message is
      // never half opened with one key and half with another).
      const opened = await openDetail(data.message, data.attachments ?? [], getUnlockedKey());
      if (!peek) {
        patchMessages(queryClient, [messageId], { is_read: 1 });
        void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      }
      return opened;
    },
    // Re-focusing the tab must never GET again. gcTime 0 drops the entry once another mail is selected,
    // so opening a mail again does GET (and mark it read) again, as it always did.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false
  };
}

export function useMessageDetail(id: string | null): UseQueryResult<MessageDetail> {
  const queryClient = useQueryClient();
  React.useEffect(() => bindMailCache(queryClient, MAIL_ROOTS), [queryClient]);
  return useQuery(messageDetailOptions(queryClient, id));
}

interface OptimisticContext {
  /** A list request was in flight and got cancelled, so the visible list needs a refetch afterwards. */
  wasFetching: boolean;
  snapshot: [QueryKey, unknown][];
}

async function beginOptimistic(queryClient: QueryClient): Promise<OptimisticContext> {
  const wasFetching = queryClient.isFetching({ queryKey: queryKeys.messages }) > 0;
  // An in-flight list response would otherwise overwrite the optimistic patch with older data.
  await queryClient.cancelQueries({ queryKey: queryKeys.messages });
  return {
    wasFetching,
    snapshot: [
      ...queryClient.getQueriesData({ queryKey: queryKeys.messages }),
      ...queryClient.getQueriesData({ queryKey: queryKeys.messageDetails })
    ]
  };
}

function rollback(queryClient: QueryClient, context: OptimisticContext | undefined) {
  for (const [key, data] of context?.snapshot ?? []) {
    queryClient.setQueryData(key, data);
  }
}

function settle(queryClient: QueryClient, context: OptimisticContext | undefined, failed: boolean, touchesStats: boolean) {
  if (touchesStats) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
  }
  // The visible list already shows the result, and refetching it would race with the read-marking GET of
  // a neighbouring mail, so refetch only after a failure or a request cancelled by onMutate.
  if (failed || context?.wasFetching === true) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
  }
}

/** Applies `change` to the rows of every page of every cached list (a list still loading has no data and is skipped). */
function updateLists(queryClient: QueryClient, change: (rows: Message[]) => Message[]) {
  queryClient.setQueriesData<MessageLists>(
    { queryKey: queryKeys.messages },
    (data) => data && { ...data, pages: data.pages.map((page) => ({ ...page, messages: change(page.messages) })) }
  );
}

/** Patches the given mails in every cached list and detail. */
function patchMessages(queryClient: QueryClient, ids: string[], patch: Partial<Message>) {
  updateLists(queryClient, (rows) => rows.map((m) => (ids.includes(m.id) ? { ...m, ...patch } : m)));
  queryClient.setQueriesData<MessageDetail>({ queryKey: queryKeys.messageDetails }, (detail) =>
    detail && ids.includes(detail.message.id) ? { ...detail, message: { ...detail.message, ...patch } } : detail
  );
}

function removeMessages(queryClient: QueryClient, ids: string[]) {
  updateLists(queryClient, (rows) => rows.filter((m) => !ids.includes(m.id)));
}

export function useBatchAction(): UseMutationResult<unknown, Error, BatchVariables, OptimisticContext> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids, folder, until }: BatchVariables) =>
      apiPost(
        '/api/messages/batch',
        {
          message_ids: ids,
          action,
          ...(folder !== undefined && folder !== '' ? { folder } : {}),
          ...(until === undefined ? {} : { until })
        },
        'fail.queries_action'
      ),
    onMutate: async ({ action, ids }) => {
      const context = await beginOptimistic(queryClient);
      switch (action) {
        case 'read': {
          patchMessages(queryClient, ids, { is_read: 1 });
          break;
        }
        case 'unread': {
          patchMessages(queryClient, ids, { is_read: 0 });
          break;
        }
        case 'star': {
          patchMessages(queryClient, ids, { is_starred: 1 });
          break;
        }
        case 'unstar': {
          patchMessages(queryClient, ids, { is_starred: 0 });
          break;
        }
        // trash, archive, restore, move, snooze and delete all take the mail out of its list
        case 'trash':
        case 'archive':
        case 'restore':
        case 'move':
        case 'snooze':
        case 'delete': {
          removeMessages(queryClient, ids);
          break;
        }
      }
      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: (_data, error, _variables, context) => settle(queryClient, context, error !== null, true)
  });
}

/** Everything unread in a folder view (and search), also on pages that are not loaded: the server marks it, the loaded rows (`ids`) turn at once. */
export function useMarkAllRead(): UseMutationResult<unknown, Error, { folder: string; search: string; ids: string[] }, OptimisticContext> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folder, search }: { folder: string; search: string; ids: string[] }) =>
      apiPost('/api/messages/read-all', { folder, ...(search === '' ? {} : { q: search }) }, 'fail.queries_action'),
    onMutate: async ({ ids }) => {
      const context = await beginOptimistic(queryClient);
      patchMessages(queryClient, ids, { is_read: 1 });
      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: () => {
      // Other cached lists (starred, labels) hold copies of the mails that just turned read.
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
    }
  });
}

export function useUpdateLabels(): UseMutationResult<unknown, Error, { id: string; labels: string[] }, OptimisticContext> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, labels }: { id: string; labels: string[] }) =>
      apiPost('/api/messages/labels', { id, labels }, 'fail.queries_labels_update'),
    onMutate: async ({ id, labels }) => {
      const context = await beginOptimistic(queryClient);
      patchMessages(queryClient, [id], { labels: JSON.stringify(labels) });
      return context;
    },
    onError: (_error, _variables, context) => rollback(queryClient, context),
    onSettled: (_data, error, _variables, context) => {
      settle(queryClient, context, error !== null, false);
      // A label may have appeared (new) or disappeared (last mail using it).
      void queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    }
  });
}

export function useSendMessage(): UseMutationResult<{ note?: string }, Error, SendPayload> {
  return useMutation({
    mutationFn: (payload: SendPayload) => apiPost<{ note?: string }>('/api/messages/send', payload, 'fail.queries_send'),
    // The payload is the plaintext of the message: it is not kept in the mutation cache once the send has settled.
    gcTime: 0
  });
}
