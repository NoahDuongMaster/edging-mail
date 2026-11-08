import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { pushSubscriptions } from '../src/worker/db/schema';
import { call, createUser, db, signIn, subscribeDevice } from './helpers';

// POST /api/auth/logout with `push_endpoint` (CK-16): the caller's own device subscription goes in the same batch as the revocation.

const endpointOf = (name: string): string => `https://fcm.googleapis.com/fcm/send/${name}`;
const endpoints = async (): Promise<string[]> => (await db().select().from(pushSubscriptions)).map((row) => row.endpoint).toSorted();

describe('signing out with the push endpoint of this device', () => {
  it('deletes that subscription of the caller, keeps the caller\u2019s other devices, and ends the sessions as before', async () => {
    const alex = await createUser('alex@example.com');
    const cookie = await signIn(alex);
    await subscribeDevice(cookie, 'alex-phone');
    await subscribeDevice(cookie, 'alex-laptop');
    expect(await endpoints()).toEqual([endpointOf('alex-laptop'), endpointOf('alex-phone')]);

    const out = await call('/api/auth/logout', { cookie, body: { push_endpoint: endpointOf('alex-phone') } });
    expect(out.status).toBe(200);
    expect(await endpoints()).toEqual([endpointOf('alex-laptop')]);
    expect((await call('/api/stats', { cookie })).status).toBe(401);
  });

  it('never deletes the subscription of somebody else, and a signed-out caller deletes nothing', async () => {
    const alex = await createUser('alex@example.com');
    const blake = await createUser('blake@example.com');
    const alexCookie = await signIn(alex);
    const blakeCookie = await signIn(blake);
    await subscribeDevice(blakeCookie, 'blake-phone');

    expect((await call('/api/auth/logout', { cookie: alexCookie, body: { push_endpoint: endpointOf('blake-phone') } })).status).toBe(200);
    expect(await endpoints()).toEqual([endpointOf('blake-phone')]);
    expect((await call('/api/auth/logout', { body: { push_endpoint: endpointOf('blake-phone') } })).status).toBe(200);
    expect(await endpoints()).toEqual([endpointOf('blake-phone')]);
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, blake.id))).toHaveLength(1);
  });

  it('still signs out when the field is missing, not a string, empty, too long, or the body is not JSON', async () => {
    const alex = await createUser('alex@example.com');
    const tries: { body: unknown }[] = [
      { body: {} },
      { body: { push_endpoint: 42 } },
      { body: { push_endpoint: '' } },
      { body: { push_endpoint: 'x'.repeat(5000) } },
      { body: [1, 2] },
      { body: 'not json' }
    ];
    for (const [index, attempt] of tries.entries()) {
      const cookie = await signIn(alex);
      await subscribeDevice(cookie, `alex-${index}`);
      const before = await endpoints();
      const out = await call('/api/auth/logout', { cookie, body: attempt.body });
      expect(out.status, JSON.stringify(attempt).slice(0, 60)).toBe(200);
      expect(await endpoints()).toEqual(before);
      expect((await call('/api/stats', { cookie })).status).toBe(401);
    }
  });
});
