import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLog, domains, settings, userSecurityEvents } from '../src/worker/db/schema';
import { call, createUser, db, must, signIn } from './helpers';

// /api/admin/domains (with the DNS check), settings, health and audit, and the signed-in person's own notices (AC19, AC25-AC27).

afterEach(() => {
  vi.restoreAllMocks();
});

async function adminSession(email = 'boss@example.com') {
  const admin = await createUser(email, { role: 'admin' });
  return { admin, cookie: await signIn(admin) };
}
const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);

interface DomainRow {
  id: string;
  name: string;
  addresses_count: number;
}

const check = async (cookie: string, name = 'example.com') => {
  const id = must(await db().select().from(domains).where(eq(domains.name, name)).get()).id;
  return call<{
    receiving: { ready: boolean; state: string; mx: { priority: number; host: string }[]; note: string };
    sending: { ready: boolean; records: { purpose: string; found: boolean }[] };
  }>(`/api/admin/domains/${id}/check`, { cookie });
};

const put = (cookie: string, body: Record<string, unknown>) => call('/api/admin/settings', { method: 'PUT', cookie, body });

const read = (cookie: string) => call<{ settings: { require_2fa: boolean; default_language: string } }>('/api/admin/settings', { cookie });

describe('domains', () => {
  it('adds, lists with the number of addresses on each, and removes only a domain no address uses', async () => {
    const { cookie } = await adminSession();
    await createUser('member@example.com', { aliases: ['sales@example.com'] });
    const added = await call<{ domain: DomainRow }>('/api/admin/domains', { cookie, body: { name: ' Example.ORG ' } });
    expect([added.status, added.json.domain.name]).toEqual([201, 'example.org']);
    const listed = await call<{ domains: DomainRow[] }>('/api/admin/domains', { cookie });
    expect(listed.json.domains.map((row) => [row.name, row.addresses_count])).toEqual([
      ['example.com', 3],
      ['example.org', 0]
    ]);
    const inUse = listed.json.domains.find((row) => row.name === 'example.com');
    expect((await call(`/api/admin/domains/${must(inUse).id}`, { method: 'DELETE', cookie })).json).toMatchObject({
      code: 'domain_in_use'
    });
    expect((await call(`/api/admin/domains/${added.json.domain.id}`, { method: 'DELETE', cookie })).json).toEqual({ success: true });
    expect(await db().select().from(domains).where(eq(domains.name, 'example.org'))).toEqual([]);
    expect(await actions()).toEqual(expect.arrayContaining(['domain.add', 'domain.remove']));
  });

  it('refuses a duplicate, a malformed name, extra fields and a missing id', async () => {
    const { cookie } = await adminSession();
    expect((await call('/api/admin/domains', { cookie, body: { name: 'example.com' } })).json).toMatchObject({ code: 'domain_exists' });
    for (const name of ['', 'no spaces.com', 'a'.repeat(300), '-bad.com', 'x@y.com', 'localhost']) {
      expect((await call('/api/admin/domains', { cookie, body: { name } })).json, name).toMatchObject({ code: 'invalid_hostname' });
    }
    expect((await call('/api/admin/domains', { cookie, body: { name: 'a.example.net', note: 1 } })).status).toBe(400);
    expect((await call('/api/admin/domains/no-such-id', { method: 'DELETE', cookie })).json).toMatchObject({ code: 'domain_not_found' });
  });
});

describe('DNS check: receiving ready + sending ready', () => {
  type Records = Partial<Record<string, { MX?: string[]; TXT?: string[] }>>;
  function fakeDns(records: Records, failing = false) {
    const original = globalThis.fetch;
    const asked: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname !== 'cloudflare-dns.com') {
        return original(input, init);
      }
      asked.push(`${url.searchParams.get('type') ?? ''} ${url.searchParams.get('name') ?? ''}`);
      if (failing) {
        return Promise.resolve(new Response('nope', { status: 502 }));
      }
      const type = url.searchParams.get('type') as 'MX' | 'TXT';
      const data = records[url.searchParams.get('name') ?? '']?.[type] ?? [];
      return Promise.resolve(Response.json({ Status: 0, Answer: data.map((text) => ({ type: type === 'MX' ? 15 : 16, data: text })) }));
    });
    return asked;
  }

  it('is ready on both sides for a domain that is fully on Cloudflare, with no special case for any provider', async () => {
    const { cookie } = await adminSession();
    fakeDns({
      'example.com': { MX: ['10 route1.mx.cloudflare.net.', '20 route2.mx.cloudflare.net.'] },
      'cf-bounce.example.com': { MX: ['10 mx.cloudflare.net.'], TXT: ['"v=spf1 include:_spf.mx.cloudflare.net ~all"'] },
      'cf-bounce._domainkey.example.com': { TXT: ['"v=DKIM1; k=rsa; p=MIIB"'] },
      '_dmarc.example.com': { TXT: ['"v=DMARC1; p=none"'] }
    });
    const answer = await check(cookie);
    expect(answer.status).toBe(200);
    expect(answer.json.receiving).toMatchObject({ ready: true, state: 'ready' });
    expect(answer.json.receiving.mx.map((record) => record.priority)).toEqual([10, 20]);
    expect(answer.json.sending.ready).toBe(true);
    expect(answer.json.sending.records.every((record) => record.found)).toBe(true);
  });

  it('says "receiving not ready" with the foreign MX hosts for a domain that mails elsewhere, and "sending not ready" when records are missing', async () => {
    const { cookie } = await adminSession();
    await call('/api/admin/domains', { cookie, body: { name: 'gmail.com' } });
    fakeDns({ 'gmail.com': { MX: ['5 gmail-smtp-in.l.google.com.', '10 alt1.gmail-smtp-in.l.google.com.'] } });
    const answer = await check(cookie, 'gmail.com');
    expect(answer.json.receiving).toMatchObject({ ready: false, state: 'other_provider' });
    expect(answer.json.receiving.mx.map((record) => record.host)).toEqual([
      'gmail-smtp-in.l.google.com',
      'alt1.gmail-smtp-in.l.google.com'
    ]);
    expect(answer.json.sending.ready).toBe(false);
    expect(answer.text).not.toMatch(/proton/i);
    fakeDns({});
    expect((await check(cookie, 'gmail.com')).json.receiving.state).toBe('no_records');
  });

  it('says a null MX (RFC 7505, "0 .") is a domain that accepts no mail, and never names an empty host', async () => {
    const { cookie } = await adminSession();
    fakeDns({ 'example.com': { MX: ['0 .'] } });
    const answer = await check(cookie);
    expect(answer.status).toBe(200);
    expect(answer.json.receiving).toMatchObject({ ready: false, via_cloudflare: false, state: 'null_mx' });
    // The record stays in the answer as it is (an empty host for the root); the note says what it means instead of listing it.
    expect(answer.json.receiving.mx).toEqual([{ priority: 0, host: '' }]);
    expect(answer.json.receiving.note).toMatch(/null MX/);
    expect(answer.json.receiving.note).not.toMatch(/point to/);
  });

  it('answers a failed lookup as a failed lookup (502), never as "ready" or "not ready"', async () => {
    const { cookie } = await adminSession();
    fakeDns({}, true);
    const answer = await check(cookie);
    expect([answer.status, answer.json]).toEqual([502, expect.objectContaining({ code: 'dns_lookup_failed' })]);
  });
});

describe('settings: the organisation policy', () => {
  it('relaxing the 2FA requirement needs the typed admin address and a step-up, is audited and alerts the other admins; it never touches enrolled 2FA', async () => {
    const { cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    await db().delete(settings).where(eq(settings.key, 'require_2fa'));
    expect((await read(cookie)).json.settings).toEqual({ require_2fa: true, default_language: 'en' });
    expect((await put(cookie, { require_2fa: false })).json).toMatchObject({ code: 'confirm_mismatch' });
    expect((await put(cookie, { require_2fa: false, confirm: 'nobody@example.com' })).json).toMatchObject({ code: 'confirm_mismatch' });
    expect((await read(cookie)).json.settings.require_2fa).toBe(true);
    const done = await put(cookie, { require_2fa: false, confirm: 'Boss@Example.com' });
    expect(done.json).toMatchObject({ success: true, settings: { require_2fa: false } });
    expect(await actions()).toContain('settings.require_2fa');
    expect((await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, other.id))).map((row) => row.kind)).toEqual([
      'alert_require_2fa_relaxed'
    ]);
    expect((await db().select().from(userSecurityEvents)).filter((row) => row.kind === 'alert_require_2fa_relaxed')).toHaveLength(1);
  });

  it('turning it back on needs no confirmation, and gates a member who is already signed in without 2FA', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com');
    const memberCookie = await signIn(member);
    expect((await call('/api/stats', { cookie: memberCookie })).status).toBe(200);
    expect((await put(cookie, { require_2fa: true })).json).toMatchObject({ settings: { require_2fa: true } });
    expect((await call('/api/stats', { cookie: memberCookie })).json).toMatchObject({ code: 'two_factor_enrollment_required' });
  });

  it('sets the default language, and refuses anything else, extra fields and a non-boolean', async () => {
    const { cookie } = await adminSession();
    expect((await put(cookie, { default_language: 'vi' })).json).toMatchObject({ settings: { default_language: 'vi' } });
    expect(await actions()).toContain('settings.default_language');
    expect((await put(cookie, { default_language: 'qaa' })).json).toMatchObject({ code: 'invalid_language' });
    expect((await put(cookie, { require_2fa: 'no' })).status).toBe(400);
    expect((await put(cookie, { extra: 1 })).status).toBe(400);
    expect((await read(cookie)).json.settings.default_language).toBe('vi');
  });
});

describe('health and audit', () => {
  it('reports the secrets as ok or missing and the counts, and never a value', async () => {
    const { cookie } = await adminSession();
    const ok = await call<{ health: Record<string, unknown> }>('/api/admin/health', { cookie });
    expect(ok.json.health).toEqual({ data_key: 'ok', jwt_secret: 'ok', setup_key: 'ok', plaintext_rows: 0, pending_rows: 0 });
    const missing = await call<{ health: Record<string, unknown> }>('/api/admin/health', { cookie, env: { DATA_KEY: undefined } });
    expect(missing.json.health.data_key).toBe('missing');
    expect(ok.text).not.toContain('test-jwt-secret');
  });

  it('lists the audit log newest first, in pages, with its detail', async () => {
    const { cookie } = await adminSession();
    for (const name of ['a.example.net', 'b.example.net', 'c.example.net']) {
      await call('/api/admin/domains', { cookie, body: { name } });
    }
    const first = await call<{
      entries: { action: string; target: string; actor_email: string; detail: unknown }[];
      next_cursor: number | null;
    }>('/api/admin/audit?limit=2', { cookie });
    expect(first.json.entries.map((entry) => entry.target)).toEqual(['c.example.net', 'b.example.net']);
    expect(first.json.entries[0]).toMatchObject({ action: 'domain.add', actor_email: 'boss@example.com', detail: {} });
    const second = await call<{ entries: { target: string }[] }>(`/api/admin/audit?limit=2&cursor=${String(first.json.next_cursor)}`, {
      cookie
    });
    expect(second.json.entries[0].target).toBe('a.example.net');
  });
});

describe('notices of the signed-in person', () => {
  it('lists their own undismissed notices, and dismisses one only after its seven days; nobody else can read or dismiss it', async () => {
    const member = await createUser('member@example.com');
    const other = await createUser('other@example.com');
    const now = Date.now();
    await db()
      .insert(userSecurityEvents)
      .values([
        {
          user_id: member.id,
          kind: '2fa_reset',
          at: now,
          actor_email: 'boss@example.com',
          detail: '{}',
          dismissible_after: now + 7 * 86_400_000
        },
        { user_id: other.id, kind: '2fa_reset', at: now, actor_email: 'boss@example.com', detail: '{}', dismissible_after: now - 1 }
      ]);
    const cookie = await signIn(member);
    const listed = await call<{ notices: { id: number; kind: string; dismissible: boolean }[] }>('/api/auth/notices', { cookie });
    expect(listed.json.notices).toHaveLength(1);
    expect(listed.json.notices[0]).toMatchObject({ kind: '2fa_reset', dismissible: false });
    const [mine, theirs] = await db().select().from(userSecurityEvents);
    expect((await call(`/api/auth/notices/${mine.id}/dismiss`, { cookie, body: {} })).json).toMatchObject({ code: 'notice_locked' });
    expect((await call(`/api/auth/notices/${theirs.id}/dismiss`, { cookie, body: {} })).json).toMatchObject({ code: 'notice_not_found' });
    await db()
      .update(userSecurityEvents)
      .set({ dismissible_after: now - 1 })
      .where(eq(userSecurityEvents.id, mine.id));
    expect((await call(`/api/auth/notices/${mine.id}/dismiss`, { cookie, body: {} })).json).toEqual({ success: true });
    expect((await call<{ notices: unknown[] }>('/api/auth/notices', { cookie })).json.notices).toEqual([]);
  });
});
