import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { applyDueTwoFactorResets } from '../src/worker/admin';
import { addresses, auditLog, messages, recoveryCodes, userSecurityEvents, users } from '../src/worker/db/schema';
import {
  addMessage,
  call,
  createUser,
  db,
  decryptPush,
  enrollTotp,
  fakePushService,
  signIn,
  subscribeDevice,
  must,
  testEnv,
  userRow,
  waitUntil
} from './helpers';

// Per-person admin actions: aliases, reset of two-step verification (AC23, AC24) and delete with its R2 purge (AC22).

const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);
async function adminSession(email = 'boss@example.com') {
  const admin = await createUser(email, { role: 'admin' });
  return { admin, cookie: await signIn(admin) };
}
const kindsOf = async (userId: string): Promise<string[]> =>
  (await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, userId))).map((row) => row.kind);

const reset = (cookie: string, id: string) => call(`/api/admin/users/${id}/reset-2fa`, { method: 'POST', cookie, body: {} });

const remove = (cookie: string, id: string, confirm: unknown) =>
  call(`/api/admin/users/${id}`, { method: 'DELETE', cookie, body: { confirm } });

describe('aliases', () => {
  it('adds and removes an alias on a configured domain, and mail to it then routes to that person', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com');
    const added = await call<{ aliases: string[] }>(`/api/admin/users/${member.id}/aliases`, {
      cookie,
      body: { address: 'Sales@Example.com' }
    });
    expect([added.status, added.json.aliases]).toEqual([201, ['sales@example.com']]);
    expect(await db().select().from(addresses).where(eq(addresses.address, 'sales@example.com'))).toEqual([
      { address: 'sales@example.com', user_id: member.id, kind: 'alias' }
    ]);
    const removed = await call(`/api/admin/users/${member.id}/aliases/sales%40example.com`, { method: 'DELETE', cookie });
    expect(removed.json).toMatchObject({ success: true, aliases: [] });
    expect(await actions()).toEqual(expect.arrayContaining(['alias.add', 'alias.remove']));
  });

  it('refuses an address that exists (primary or alias, of anyone), an unknown domain, a malformed address, the 21st alias, a primary address as an alias', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com', { aliases: ['one@example.com'] });
    await createUser('other@example.com');
    const add = (address: unknown) => call(`/api/admin/users/${member.id}/aliases`, { cookie, body: { address } });
    expect((await add('one@example.com')).json).toMatchObject({ code: 'address_taken' });
    expect((await add('other@example.com')).json).toMatchObject({ code: 'address_taken' });
    expect((await add('x@elsewhere.example.org')).json).toMatchObject({ code: 'domain_not_configured' });
    expect((await add('not an address')).json).toMatchObject({ code: 'invalid_address' });
    expect((await call(`/api/admin/users/${member.id}/aliases`, { cookie, body: { address: 'a@example.com', extra: 1 } })).status).toBe(
      400
    );
    expect((await call('/api/admin/users/no-such-id/aliases', { cookie, body: { address: 'a@example.com' } })).json).toMatchObject({
      code: 'user_not_found'
    });
    for (let n = 2; n <= 20; n += 1) {
      expect((await add(`alias${n}@example.com`)).status).toBe(201);
    }
    expect((await add('alias21@example.com')).json).toMatchObject({ code: 'too_many_aliases' });
    // a primary address cannot be removed through the alias route, nor another person's alias through this person
    expect((await call(`/api/admin/users/${member.id}/aliases/member%40example.com`, { method: 'DELETE', cookie })).json).toMatchObject({
      code: 'alias_not_found'
    });
    const other = await db().select().from(users).where(eq(users.email, 'other@example.com')).get();
    expect((await call(`/api/admin/users/${must(other).id}/aliases/one%40example.com`, { method: 'DELETE', cookie })).status).toBe(404);
    expect(await db().select().from(addresses).where(eq(addresses.address, 'one@example.com'))).toHaveLength(1);
  });
});

describe('reset 2FA', () => {
  it('clears a MEMBER at once: secret, recovery codes and sessions go; the person is notified, the other admins alerted, the gate re-opens', async () => {
    const { cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    const member = await createUser('member@example.com');
    const memberCookie = await signIn(member);
    const enrolled = await enrollTotp(memberCookie, member);
    expect(enrolled.recoveryCodes.length).toBeGreaterThan(0);
    const phone = await subscribeDevice(enrolled.cookie, 'member-phone');
    const sink = fakePushService();
    const answer = await reset(cookie, member.id);
    expect([answer.status, answer.json]).toEqual([200, { success: true, applied: true }]);
    expect(await userRow(member.id)).toMatchObject({
      totp_enabled: 0,
      totp_secret_enc: null,
      totp_enrolled_at: null,
      reset_2fa_due_at: null
    });
    expect(await db().select().from(recoveryCodes).where(eq(recoveryCodes.user_id, member.id))).toEqual([]);
    expect((await call('/api/stats', { cookie: enrolled.cookie })).status).toBe(401);
    expect(await kindsOf(member.id)).toEqual(['2fa_reset']);
    expect(await kindsOf(other.id)).toEqual(['alert_2fa_reset']);
    expect(await actions()).toContain('2fa_reset');
    // the person's next sign-in goes to the gate; the notice names the ADMIN'S ADDRESS, in the person's language
    const next = await call('/api/auth/login', { body: { email: member.email, auth: member.auth, kdf: 1 }, ip: '198.51.100.40' });
    expect(next.json).toMatchObject({ success: true });
    await waitUntil(() => sink.posted.length > 0);
    const note = await decryptPush(sink.bodies[0], phone);
    expect(String(note.body)).toContain('boss@example.com');
    expect(JSON.stringify(note)).not.toMatch(/Subject|secret/i);
  });

  it('is DELAYED 24 hours for an ADMIN; the target can cancel from any session; the cron applies it when due', async () => {
    const { cookie } = await adminSession();
    const target = await createUser('second@example.com', { role: 'admin' });
    const targetCookie = await signIn(target);
    const answer = await call<{ applied: boolean; due: number }>(`/api/admin/users/${target.id}/reset-2fa`, {
      method: 'POST',
      cookie,
      body: {}
    });
    expect([answer.status, answer.json.applied]).toEqual([200, false]);
    expect(answer.json.due).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(await userRow(target.id)).toMatchObject({
      totp_enabled: 1,
      reset_2fa_due_at: answer.json.due,
      reset_2fa_by: 'boss@example.com'
    });
    // the person sees their own notice; the alert for "the other admins" reaches them too (they are an admin other than the actor)
    expect(await kindsOf(target.id)).toEqual(['2fa_reset_pending', 'alert_2fa_reset']);
    expect((await call<{ user: { two_factor_reset_due_at: number } }>('/api/auth/session', { cookie: targetCookie })).json).toMatchObject({
      user: { two_factor_reset_due_at: answer.json.due }
    });
    // nothing is due yet
    expect(await applyDueTwoFactorResets(testEnv(), db())).toBe(0);
    // the target cancels
    expect((await call('/api/auth/2fa/cancel-reset', { cookie: targetCookie, body: {} })).json).toEqual({ success: true });
    expect(await userRow(target.id)).toMatchObject({ totp_enabled: 1, reset_2fa_due_at: null, reset_2fa_by: null });
    expect((await call('/api/auth/2fa/cancel-reset', { cookie: targetCookie, body: {} })).json).toMatchObject({ code: 'no_pending_reset' });
    expect(await actions()).toEqual(expect.arrayContaining(['2fa_reset_requested', '2fa_reset_cancelled']));
    // asked again and left alone: the cron applies it once due
    await reset(cookie, target.id);
    await db()
      .update(users)
      .set({ reset_2fa_due_at: Date.now() - 1 })
      .where(eq(users.id, target.id));
    expect(await applyDueTwoFactorResets(testEnv(), db())).toBe(1);
    expect(await userRow(target.id)).toMatchObject({ totp_enabled: 0, totp_secret_enc: null, reset_2fa_due_at: null });
    expect(await actions()).toContain('2fa_reset');
    expect(await applyDueTwoFactorResets(testEnv(), db())).toBe(0);
  });

  it('needs a step-up, refuses yourself, a person without 2FA, a missing person and extra fields, and caps resets per person at three an hour', async () => {
    const { admin, cookie } = await adminSession();
    const member = await createUser('member@example.com', { totp: true });
    expect((await reset(cookie, admin.id)).json).toMatchObject({ code: 'cannot_reset_self' });
    expect((await reset(cookie, 'no-such-id')).json).toMatchObject({ code: 'user_not_found' });
    const plain = await createUser('plain@example.com', { keys: false });
    expect((await reset(cookie, plain.id)).json).toMatchObject({ code: 'not_enabled' });
    expect((await call(`/api/admin/users/${member.id}/reset-2fa`, { cookie, body: { password: 'x' } })).status).toBe(400);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await reset(cookie, member.id)).json).toMatchObject({ code: 'step_up_required' });
    } finally {
      vi.useRealTimers();
    }
    for (let n = 0; n < 3; n += 1) {
      await db().update(users).set({ totp_enabled: 1, totp_secret_enc: 'x' }).where(eq(users.id, member.id));
      expect((await reset(cookie, member.id)).status).toBe(200);
    }
    await db().update(users).set({ totp_enabled: 1, totp_secret_enc: 'x' }).where(eq(users.id, member.id));
    expect((await reset(cookie, member.id)).json).toMatchObject({ code: 'reset_limit' });
  });
});

describe('delete', () => {
  it('deletes the person and everything of theirs, including R2 objects, and lets the address be created again as a new, empty person', async () => {
    const { cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    const member = await createUser('member@example.com', { aliases: ['sales@example.com'] });
    const kept = await createUser('keeper@example.com');
    const mine = await addMessage(member.id, { subject: 'Mine' });
    const theirs = await addMessage(kept.id, { subject: 'Theirs' });
    await env.BUCKET.put(`em1/${member.id}/${mine}/raw`, 'sealed');
    await env.BUCKET.put(`em1/${kept.id}/${theirs}/raw`, 'sealed');
    const answer = await remove(cookie, member.id, 'Member@Example.com');
    expect([answer.status, answer.json]).toEqual([200, { success: true, done: true }]);
    expect(await db().select().from(users).where(eq(users.id, member.id))).toEqual([]);
    expect(await db().select().from(addresses).where(eq(addresses.user_id, member.id))).toEqual([]);
    expect(await db().select().from(messages).where(eq(messages.user_id, member.id))).toEqual([]);
    expect((await env.BUCKET.list({ prefix: `em1/${member.id}/` })).objects).toEqual([]);
    expect((await env.BUCKET.list({ prefix: `em1/${kept.id}/` })).objects).toHaveLength(1);
    expect(await db().select().from(messages).where(eq(messages.user_id, kept.id))).toHaveLength(1);
    expect(await actions()).toContain('user.delete');
    expect(await kindsOf(other.id)).toEqual(['alert_account_delete']);
    // the same address is a NEW person: no old mail, no old keys
    const created = await call<{ user: { id: string } }>('/api/admin/users', {
      cookie,
      body: { local_part: 'member', domain: 'example.com', role: 'member', auth: member.auth, kdf: 1 }
    });
    expect(created.status).toBe(201);
    expect(created.json.user.id).not.toBe(member.id);
    expect(await userRow(created.json.user.id)).toMatchObject({ public_key: null });
  });

  it('wants the typed address and a step-up, and refuses yourself, a missing person and the last active administrator', async () => {
    const { admin, cookie } = await adminSession();
    const member = await createUser('member@example.com');
    expect((await remove(cookie, member.id, 'nobody@example.com')).json).toMatchObject({ code: 'confirm_mismatch' });
    expect((await remove(cookie, member.id, 5)).status).toBe(400);
    expect((await remove(cookie, admin.id, admin.email)).json).toMatchObject({ code: 'cannot_delete_self' });
    expect((await remove(cookie, 'no-such-id', 'x')).json).toMatchObject({ code: 'user_not_found' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await remove(cookie, member.id, member.email)).json).toMatchObject({ code: 'step_up_required' });
    } finally {
      vi.useRealTimers();
    }
    expect(await userRow(member.id)).toMatchObject({ status: 'active' });
    // two administrators deleting each other at once: the second statement finds no other active admin, so one of them stays
    const second = await createUser('second@example.com', { role: 'admin' });
    const secondCookie = await signIn(second);
    const answers = await Promise.all([remove(cookie, second.id, second.email), remove(secondCookie, admin.id, admin.email)]);
    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    expect(await db().select().from(users).where(eq(users.role, 'admin'))).toHaveLength(1);
  });
});
