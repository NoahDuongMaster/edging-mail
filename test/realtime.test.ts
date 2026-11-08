import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker/index';
import {
  addMessage,
  authFor,
  call,
  cookieOf,
  createUser,
  decryptPush,
  draftBody,
  deliverMail,
  enrollTotp,
  fakeWrap,
  messageRow,
  newSubscriber,
  ORIGIN,
  rawMail,
  signIn,
  testEnv,
  totpCode
} from './helpers';
import type { PushSubscriber, TestUser } from './helpers';

// AC12 (realtime and push reach only the owner) and AC13 (the snooze cron returns each user's mail to that user and tells only them).

interface Event {
  type: string;
  [key: string]: unknown;
}

interface Tab {
  events: Event[];
  closed: Promise<number>;
  close: () => void;
}

async function openTab(cookie: string): Promise<Tab> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: 'websocket', Cookie: cookie, Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' }
    }),
    testEnv(),
    ctx
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error('no websocket in the upgrade response');
  }
  const events: Event[] = [];
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener('close', (event) => {
      resolve(event.code);
    });
  });
  socket.addEventListener('message', (event) => {
    events.push(JSON.parse(String(event.data)) as Event);
  });
  socket.accept();
  await waitFor(() => events.some((event) => event.type === 'hello'));
  return {
    events,
    closed,
    close: () => {
      socket.close(1000, 'test over');
    }
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for a condition');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

const quiet = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 250);
  });
const types = (tab: Tab): string[] => tab.events.map((event) => event.type).filter((type) => type !== 'hello');

const urlOf = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : input.toString());

async function runCron(): Promise<void> {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '* * * * *' }), testEnv(), ctx);
  await waitOnExecutionContext(ctx);
}

function snoozedFor(user: TestUser, due: boolean): Promise<string> {
  return addMessage(user.id, {
    folder: 'snoozed',
    snoozed_until: Date.now() + (due ? -1000 : 3_600_000),
    is_read: 1,
    subject: `snoozed for ${user.email}`
  });
}

describe('realtime events reach only their owner (AC12)', () => {
  it("delivers new mail, changes and drafts to the owner's tabs and to nobody else's", async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const [cookieA, cookieB] = [await signIn(alice), await signIn(bob)];
    const tabA = await openTab(cookieA);
    const tabA2 = await openTab(cookieA);
    const tabB = await openTab(cookieB);

    await deliverMail('bob@example.com', rawMail({ to: 'bob@example.com', subject: 'for Bob' }));
    await waitFor(() => types(tabB).includes('mail.new'));
    await quiet();
    expect(types(tabA)).toEqual([]);
    expect(types(tabA2)).toEqual([]);
    // Ids and the sender only: no subject, snippet or body in a realtime event.
    const event = tabB.events.find((entry) => entry.type === 'mail.new');
    expect(Object.keys(event ?? {}).toSorted()).toEqual(['created_at', 'folder', 'from_address', 'from_name', 'id', 'type']);
    expect(event).toMatchObject({ folder: 'inbox', from_address: 'sender@example.org' });
    expect(JSON.stringify(tabB.events)).not.toContain('for Bob');

    const mine = await addMessage(alice.id);
    await call('/api/messages/batch', { cookie: cookieA, body: { message_ids: [mine], action: 'star' } });
    const draftId = crypto.randomUUID();
    await call(`/api/drafts/${draftId}`, { cookie: cookieA, method: 'PUT', body: await draftBody(alice, draftId) });
    await waitFor(() => types(tabA).length >= 2 && types(tabA2).length >= 2);
    await quiet();
    expect(types(tabA)).toEqual(['mail.changed', 'mail.changed']);
    expect(types(tabB)).toEqual(['mail.new']);
    for (const tab of [tabA, tabA2, tabB]) {
      tab.close();
    }
  });

  it('refuses the upgrade without a session, and closes the sockets of a user who signs out', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const noSession = await call('/api/ws', { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(noSession.status).toBe(401);

    const [cookieA, cookieB] = [await signIn(alice), await signIn(bob)];
    const tabA = await openTab(cookieA);
    const tabB = await openTab(cookieB);
    await call('/api/auth/logout', { cookie: cookieA, body: {} });
    expect(await tabA.closed).toBe(4401);
    await quiet();
    await deliverMail('bob@example.com', rawMail({ to: 'bob@example.com' }));
    await waitFor(() => types(tabB).includes('mail.new'));
    tabB.close();
  });

  it('closes with 4402 (session renewed), not 4401, when a password or two-step change renews the caller\u2019s own session', async () => {
    const alice = await createUser('alice@example.com');
    const phone = await signIn(alice);
    const laptop = await signIn(alice);
    const [tabPhone, tabLaptop] = [await openTab(phone), await openTab(laptop)];
    const newAuth = await authFor(alice.email, 'another long password');
    const changed = await call('/api/auth/change-password', {
      cookie: laptop,
      body: { current_auth: alice.auth, new_auth: newAuth, kdf: 1, keys: { wrapped_private_key_pw: fakeWrap() }, keys_version: 1 }
    });
    expect(changed.status).toBe(200);
    // every socket of the person ends with the "renewed" code, so the browser that changed the password can keep its key and reconnect
    expect([await tabLaptop.closed, await tabPhone.closed]).toEqual([4402, 4402]);
    const renewed = cookieOf(changed);
    (await openTab(renewed)).close();
    // the other device's old cookie is refused on reconnect: that is where its browser learns the session really ended
    const refused = await call('/api/ws', { cookie: phone, headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(refused.status).toBe(401);

    const bob = await createUser('bob@example.com', { totp: false });
    const enrolled = await enrollTotp(await signIn(bob), bob);
    const tabBob = await openTab(enrolled.cookie);
    const fresh = await call('/api/auth/2fa/recovery-codes', {
      cookie: enrolled.cookie,
      body: { current_auth: bob.auth, code: await totpCode({ ...bob, totpSecret: enrolled.secret }, 1) }
    });
    expect(fresh.status).toBe(200);
    expect(await tabBob.closed).toBe(4402);
  });
});

// A fake push service: every notification is a POST to the subscription's endpoint, which is a different URL per device.
function pushSink(): { posted: string[]; bodies: Uint8Array<ArrayBuffer>[]; restore: () => void } {
  const posted: string[] = [];
  const bodies: Uint8Array<ArrayBuffer>[] = [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = urlOf(input);
    if (url.includes('fcm.googleapis.com')) {
      bodies.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
      posted.push(url);
      return new Response(null, { status: 201 });
    }
    return original(input, init);
  });
  return {
    posted,
    bodies,
    restore: () => {
      vi.restoreAllMocks();
    }
  };
}

async function subscribe(cookie: string, endpoint: string): Promise<PushSubscriber> {
  const subscriber = await newSubscriber();
  const answer = await call('/api/push/subscribe', { cookie, body: { endpoint, keys: subscriber.keys } });
  expect(answer.status).toBe(200);
  return subscriber;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("push notifications go only to the owner's devices (AC12)", () => {
  it("notifies the recipient's devices for new mail and nobody else's", async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await subscribe(await signIn(alice), 'https://fcm.googleapis.com/fcm/send/alice-phone');
    const bobPhone = await subscribe(await signIn(bob), 'https://fcm.googleapis.com/fcm/send/bob-phone');
    const sink = pushSink();
    await deliverMail('bob@example.com', rawMail({ to: 'bob@example.com', subject: 'SECRET SUBJECT LINE', body: 'SECRET BODY TEXT' }));
    await waitFor(() => sink.posted.length > 0);
    // The notification carries the sender and a link, never the subject, snippet or body.
    const notification = await decryptPush(sink.bodies[0], bobPhone);
    expect(notification).toMatchObject({ title: 'Sender', body: '' });
    expect(JSON.stringify(notification)).not.toMatch(/SECRET/);
    expect(notification.url).toMatch(/^\/app\?m=[\da-f-]{36}$/);
    await quiet();
    expect(sink.posted).toEqual(['https://fcm.googleapis.com/fcm/send/bob-phone']);
    sink.restore();
  });

  it("uses the deployment contact (DEFAULT_FROM) or the user's own address as the VAPID subject, never a project URL", async () => {
    const alice = await createUser('alice@example.com');
    await subscribe(await signIn(alice), 'https://fcm.googleapis.com/fcm/send/alice-phone');
    const subjects: string[] = [];
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (urlOf(input).includes('fcm.googleapis.com')) {
        const authorization = new Headers(init?.headers).get('Authorization') ?? '';
        const claims = /t=[\w-]+\.([\w-]+)\./.exec(authorization)?.[1] ?? '';
        subjects.push((JSON.parse(atob(claims.replaceAll('-', '+').replaceAll('_', '/'))) as { sub: string }).sub);
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      return original(input, init);
    });
    const cookie = await signIn(alice);
    await call('/api/push/test', { cookie, body: {} });
    await call('/api/push/test', { cookie, body: {}, env: { DEFAULT_FROM: undefined } });
    await call('/api/push/test', { cookie, body: {}, env: { DEFAULT_FROM: 'not an address' } });
    expect(subjects).toEqual(['mailto:hi@example.test', 'mailto:alice@example.com', 'mailto:alice@example.com']);
  });
});

describe("the snooze cron returns each user's mail to that user (AC13)", () => {
  it('returns due mail to the inbox of its owner, unread, and leaves the rest snoozed', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const dueA = await snoozedFor(alice, true);
    const dueB = await snoozedFor(bob, true);
    const laterB = await snoozedFor(bob, false);
    await runCron();
    expect(await messageRow(dueA)).toMatchObject({ folder: 'inbox', user_id: alice.id, is_read: 0, snoozed_until: null });
    expect(await messageRow(dueB)).toMatchObject({ folder: 'inbox', user_id: bob.id, is_read: 0 });
    expect(await messageRow(laterB)).toMatchObject({ folder: 'snoozed', user_id: bob.id });
    // Running it again does nothing more: the mail is not touched a second time.
    const stamp = (await messageRow(dueA))?.updated_at;
    await runCron();
    expect((await messageRow(dueA))?.updated_at).toBe(stamp);
  });

  it('tells only the owner: realtime and push', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const [cookieA, cookieB] = [await signIn(alice), await signIn(bob)];
    await subscribe(cookieA, 'https://fcm.googleapis.com/fcm/send/alice-phone');
    await subscribe(cookieB, 'https://fcm.googleapis.com/fcm/send/bob-phone');
    const tabA = await openTab(cookieA);
    const tabB = await openTab(cookieB);
    await snoozedFor(bob, true);
    const sink = pushSink();
    await runCron();
    await waitFor(() => types(tabB).includes('mail.changed') && sink.posted.length > 0);
    await quiet();
    expect(types(tabA)).toEqual([]);
    expect(sink.posted).toEqual(['https://fcm.googleapis.com/fcm/send/bob-phone']);
    sink.restore();
    tabA.close();
    tabB.close();
  });

  it('summarises a big return per owner and links to /app', async () => {
    const alice = await createUser('alice@example.com');
    await subscribe(await signIn(alice), 'https://fcm.googleapis.com/fcm/send/alice-phone');
    for (let n = 0; n < 5; n += 1) {
      await snoozedFor(alice, true);
    }
    const sink = pushSink();
    await runCron();
    await waitFor(() => sink.posted.length >= 4);
    // three individual notifications and one summary, all for her only device
    expect(new Set(sink.posted)).toEqual(new Set(['https://fcm.googleapis.com/fcm/send/alice-phone']));
    expect(sink.posted).toHaveLength(4);
    sink.restore();
  });

  it('returns mail snoozed before setup to the inbox without an owner and without a notification', async () => {
    const orphan = await addMessage(null, { folder: 'snoozed', snoozed_until: Date.now() - 1000 });
    const sink = pushSink();
    await runCron();
    expect(await messageRow(orphan)).toMatchObject({ folder: 'inbox', user_id: null });
    expect(sink.posted).toEqual([]);
    sink.restore();
  });
});
