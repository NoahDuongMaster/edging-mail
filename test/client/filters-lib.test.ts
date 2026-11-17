import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import {
  allowedOf,
  deleteFilter,
  filtersKey,
  ofKind,
  parseFilter,
  parseFilters,
  unblockedOf,
  useAddFilter,
  useRemoveFilter,
  type Filter
} from '../../src/client/lib/filters';
import { notSpamText, notSpamUndo } from '../../src/client/lib/notSpam';
import { queryKeys, useBatchAction } from '../../src/client/lib/queries';
import { tr } from '../../src/client/lib/i18n';
import type { Message } from '../../src/client/types';

// The sender lists and Not spam, below the screens: what the Worker's answers are turned into (defensively), the requests that are sent, and
// what the cache looks like afterwards. The hooks run for real: rendered once on the server to get their result object, then called.

const filter = (id: string, kind: Filter['kind'], value: string, created_at = 1): Filter => ({ id, kind, value, created_at });

/** What `fetch` was asked, in order; each call answers the next item of `answers` (status, body). */
interface Call {
  url: string;
  method: string;
  body: unknown;
}
function stubFetch(...answers: [number, unknown][]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      });
      const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
      return Promise.resolve(Response.json(body, { status }));
    })
  );
  return calls;
}

/** The result of a hook, got by rendering a component that calls it once. */
function run<T>(client: QueryClient, hook: () => T): T {
  let result: T | undefined;
  const Probe = (): null => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  if (result === undefined) {
    throw new Error('the hook did not run');
  }
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the Worker answers, read defensively', () => {
  it('parseFilter keeps an entry of the right shape and nothing else', () => {
    expect(parseFilter({ id: 'f1', kind: 'allow', value: 'a@example.com', created_at: 5 })).toEqual(
      filter('f1', 'allow', 'a@example.com', 5)
    );
    expect(parseFilter({ id: 'f1', kind: 'block', value: 'example.org' })).toEqual(filter('f1', 'block', 'example.org', 0));
    for (const bad of [
      null,
      undefined,
      'x',
      3,
      [],
      {},
      { id: '', kind: 'allow', value: 'x' },
      { id: 'a', kind: 'maybe', value: 'x' },
      { id: 'a', kind: 'allow', value: '' }
    ]) {
      expect(parseFilter(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('parseFilters drops the rows it cannot read and lists the newest first (then by value)', () => {
    const rows = [
      { id: 'a', kind: 'allow', value: 'b.example.com', created_at: 1 },
      { id: 'x' },
      { id: 'c', kind: 'block', value: 'new.example.com', created_at: 9 },
      { id: 'd', kind: 'allow', value: 'a.example.com', created_at: 1 }
    ];
    expect(parseFilters(rows).map((row) => row.id)).toEqual(['c', 'd', 'a']);
    expect(parseFilters(null)).toEqual([]);
    expect(parseFilters({ filters: rows })).toEqual([]);
  });

  it('ofKind picks one list and keeps the order', () => {
    const all = [filter('1', 'allow', 'a'), filter('2', 'block', 'b'), filter('3', 'allow', 'c')];
    expect(ofKind(all, 'allow').map((row) => row.id)).toEqual(['1', '3']);
    expect(ofKind(all, 'block').map((row) => row.id)).toEqual(['2']);
  });

  it('allowedOf reads the entries a not_spam answer created, and nobody from an answer it cannot read', () => {
    expect(
      allowedOf({
        success: true,
        count: 2,
        allowed: [
          { id: 'f1', value: 'a@example.com' },
          { id: 'f2', value: 'example.org' }
        ]
      })
    ).toEqual([
      { id: 'f1', value: 'a@example.com' },
      { id: 'f2', value: 'example.org' }
    ]);
    for (const bad of [
      undefined,
      null,
      'ok',
      7,
      {},
      { allowed: null },
      { allowed: 'f1' },
      { allowed: [null, 'x', { id: 1, value: 'a' }, { id: 'f', value: '' }, { value: 'a' }] }
    ]) {
      expect(allowedOf(bad), JSON.stringify(bad)).toEqual([]);
    }
    expect(allowedOf({ allowed: [{ id: 'f1', value: 'a@example.com', extra: 1 }, { id: 'f2' }] })).toEqual([
      { id: 'f1', value: 'a@example.com' }
    ]);
  });
});

describe('adding and removing an entry', () => {
  it('POST /api/filters sends the kind and the value as typed (trimmed by the screen), and lists the answered entry once', async () => {
    const client = new QueryClient();
    client.setQueryData(filtersKey, [filter('f0', 'block', 'old.example.com', 1)]);
    const calls = stubFetch([200, { success: true, filter: { id: 'f1', kind: 'allow', value: 'alice@example.com', created_at: 7 } }]);
    const add = run(client, useAddFilter);
    await add.mutateAsync({ kind: 'allow', value: 'Alice@Example.com' });
    expect(calls).toEqual([{ url: '/api/filters', method: 'POST', body: { kind: 'allow', value: 'Alice@Example.com' } }]);
    expect(client.getQueryData<Filter[]>(filtersKey)?.map((row) => row.id)).toEqual(['f1', 'f0']);
    // The Worker answers 200 with the entry that was already there: it is never listed twice.
    stubFetch([200, { success: true, filter: { id: 'f1', kind: 'allow', value: 'alice@example.com', created_at: 7 } }]);
    await run(client, useAddFilter).mutateAsync({ kind: 'allow', value: 'alice@example.com' });
    expect(client.getQueryData<Filter[]>(filtersKey)?.map((row) => row.id)).toEqual(['f1', 'f0']);
  });

  it('turns invalid_filter and too_many_filters into the words of the language, and leaves the list alone', async () => {
    const client = new QueryClient();
    client.setQueryData(filtersKey, [filter('f0', 'block', 'old.example.com')]);
    stubFetch([400, { success: false, error: 'Invalid filter', code: 'invalid_filter' }]);
    await expect(run(client, useAddFilter).mutateAsync({ kind: 'block', value: '???' })).rejects.toThrow(en['err.invalid_filter']);
    stubFetch([409, { success: false, error: 'Too many filters', code: 'too_many_filters' }]);
    await expect(run(client, useAddFilter).mutateAsync({ kind: 'block', value: 'a.example.com' })).rejects.toThrow(
      en['err.too_many_filters']
    );
    // No code at all (a proxy page): the fallback of the request.
    stubFetch([502, { success: false }]);
    await expect(run(client, useAddFilter).mutateAsync({ kind: 'block', value: 'a.example.com' })).rejects.toThrow(en['fail.filter_add']);
    expect(client.getQueryData<Filter[]>(filtersKey)?.map((row) => row.id)).toEqual(['f0']);
  });

  it('refuses an answer that has no entry in it, in words', async () => {
    const client = new QueryClient();
    stubFetch([200, { success: true }]);
    await expect(run(client, useAddFilter).mutateAsync({ kind: 'allow', value: 'a@example.com' })).rejects.toThrow(tr('fail.filter_add'));
  });

  it('DELETE /api/filters/:id removes the entry from the list, the id encoded', async () => {
    const client = new QueryClient();
    client.setQueryData(filtersKey, [filter('f 1', 'allow', 'a@example.com'), filter('f2', 'block', 'b.example.com')]);
    const calls = stubFetch([200, { success: true }]);
    await run(client, useRemoveFilter).mutateAsync('f 1');
    expect(calls).toEqual([{ url: '/api/filters/f%201', method: 'DELETE', body: undefined }]);
    expect(client.getQueryData<Filter[]>(filtersKey)?.map((row) => row.id)).toEqual(['f2']);
  });

  it('counts an entry that is already gone (not_found) as removed, but not any other failure', async () => {
    const client = new QueryClient();
    client.setQueryData(filtersKey, [filter('f1', 'allow', 'a@example.com')]);
    stubFetch([404, { success: false, error: 'Not found', code: 'not_found' }]);
    await run(client, useRemoveFilter).mutateAsync('f1');
    expect(client.getQueryData<Filter[]>(filtersKey)).toEqual([]);
    client.setQueryData(filtersKey, [filter('f1', 'allow', 'a@example.com')]);
    stubFetch([500, { success: false, error: 'x', code: 'server_error' }]);
    await expect(run(client, useRemoveFilter).mutateAsync('f1')).rejects.toThrow();
    expect(client.getQueryData<Filter[]>(filtersKey)).toHaveLength(1);
    // Offline: fetch rejects with a TypeError, which the screen turns into "No connection".
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(deleteFilter('f1')).rejects.toBeInstanceOf(TypeError);
  });
});

const row = (id: string, folder: Message['folder'] = 'spam'): Message => ({
  id,
  from_address: `${id}@example.net`,
  to_address: 'me@example.com',
  subject: id,
  folder,
  is_read: 0,
  is_starred: 0,
  has_attachments: 0,
  size: 1,
  created_at: 1,
  updated_at: 1
});

describe('the not_spam batch action', () => {
  it('posts the ids with the action, answers the entries it allowed, takes the rows out of every cached list at once and refreshes the lists of senders', async () => {
    const client = new QueryClient();
    const list: InfiniteData<{ messages: Message[] }> = { pages: [{ messages: [row('m1'), row('m2'), row('m3')] }], pageParams: [0] };
    client.setQueryData(queryKeys.messageList('spam', ''), list);
    client.setQueryData(filtersKey, [filter('f0', 'block', 'old.example.com')]);
    const calls = stubFetch([200, { success: true, count: 2, allowed: [{ id: 'f9', value: 'm1@example.net' }] }]);
    const batch = run(client, useBatchAction);
    const answer = await batch.mutateAsync({ action: 'not_spam', ids: ['m1', 'm2'] });
    expect(calls[0]).toEqual({ url: '/api/messages/batch', method: 'POST', body: { message_ids: ['m1', 'm2'], action: 'not_spam' } });
    expect(allowedOf(answer)).toEqual([{ id: 'f9', value: 'm1@example.net' }]);
    expect(client.getQueryData<typeof list>(queryKeys.messageList('spam', ''))?.pages[0].messages.map((m) => m.id)).toEqual(['m3']);
    // The senders it allowed are in Settings > Filters: that list is read again.
    expect(client.getQueryState(filtersKey)?.isInvalidated).toBe(true);
  });

  it('puts the rows back when the request fails, and leaves the lists of senders alone', async () => {
    const client = new QueryClient();
    const list: InfiniteData<{ messages: Message[] }> = { pages: [{ messages: [row('m1'), row('m2')] }], pageParams: [0] };
    client.setQueryData(queryKeys.messageList('spam', ''), list);
    client.setQueryData(filtersKey, []);
    stubFetch([500, { success: false, error: 'x', code: 'server_error' }]);
    await expect(run(client, useBatchAction).mutateAsync({ action: 'not_spam', ids: ['m1'] })).rejects.toThrow();
    expect(client.getQueryData<typeof list>(queryKeys.messageList('spam', ''))?.pages[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(client.getQueryState(filtersKey)?.isInvalidated).toBe(false);
  });
});

describe('what Not spam tells the person, and what Undo does', () => {
  const allowed = [{ id: 'f1', value: 'alice@example.com' }];

  it('names the sender that is now allowed (one message, one entry)', () => {
    expect(notSpamText(tr, 1, allowed)).toBe('Moved to Inbox. Mail from alice@example.com will not go to Spam.');
  });

  it('names the one sender that was allowed even when several messages moved (a hosted sender among them is not claimed)', () => {
    expect(notSpamText(tr, 3, allowed)).toBe('Moved to Inbox. Mail from alice@example.com will not go to Spam.');
  });

  it('counts the senders it allowed when there are two or more, not the messages', () => {
    const two = [...allowed, { id: 'f2', value: 'example.org' }];
    expect(notSpamText(tr, 2, two)).toBe('Moved to Inbox. Mail from 2 senders will not go to Spam.');
    expect(notSpamText(tr, 9, [...two, { id: 'f3', value: 'x@example.net' }])).toBe(
      'Moved to Inbox. Mail from 3 senders will not go to Spam.'
    );
  });

  it("only says where the message went when the Worker allowed nobody (a sender of this server's own domains is never listed)", () => {
    expect(notSpamText(tr, 1, [])).toBe(en['toast.moved_to_inbox']);
    expect(notSpamText(tr, 4, [])).toBe('4 messages moved to Inbox');
  });

  it('undoes with the existing move back to Spam, then the deletion of exactly the entries the action created', () => {
    expect(notSpamUndo(['m1', 'm2'], [...allowed, { id: 'f2', value: 'example.org' }])).toEqual({
      move: { action: 'move', ids: ['m1', 'm2'], folder: 'spam' },
      remove: ['f1', 'f2'],
      block: []
    });
    // Nobody was allowed: there is nothing to delete.
    expect(notSpamUndo(['m1'], [])).toEqual({ move: { action: 'move', ids: ['m1'], folder: 'spam' }, remove: [], block: [] });
  });

  it('blocks again the addresses the action took off the block list', () => {
    expect(notSpamUndo(['m1'], allowed, ['alice@example.com']).block).toEqual(['alice@example.com']);
    expect(unblockedOf({ allowed: [], unblocked: ['a@example.com', '', 3, null, 'b@example.org'] })).toEqual([
      'a@example.com',
      'b@example.org'
    ]);
    for (const bad of [undefined, null, 'x', {}, { unblocked: 'a@example.com' }, { unblocked: {} }]) {
      expect(unblockedOf(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  it('does not share the ids it was given (a later change to the list cannot change what Undo moves)', () => {
    const ids = ['m1'];
    const plan = notSpamUndo(ids, allowed);
    ids.push('m2');
    expect(plan.move.ids).toEqual(['m1']);
  });
});
