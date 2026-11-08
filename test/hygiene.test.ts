import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, createUser, signIn } from './helpers';

// S13 / CR-4: `auth` is a password equivalent. A malformed request to a route that takes it must never put a fragment of it in a response or
// a log line, and must never surface the JSON parser's own error text (V8's messages quote a piece of the input).

const SECRET = 'tv1dHD4yD8hm9RwRBgpbns5ijXFMM-NMVzU1r-ziZ-U';
const OTHER = 'ZPY6vSdxzGKZLXm-IUN0tq4Vv8f0DCxwpIQN3i3pkbs';
const FRAGMENTS = [SECRET.slice(0, 12), SECRET.slice(15, 27), SECRET.slice(-12), OTHER.slice(0, 12), OTHER.slice(-12)];
const PARSER_TEXT = /Unexpected|in JSON|JSON\.parse|not valid JSON|position \d|SyntaxError|Expected .* after/i;

interface Target {
  name: string;
  path: string;
  /** A well-formed body of the route, carrying the secret. */
  valid: Record<string, unknown>;
  needsSession: boolean;
}

const TARGETS: Target[] = [
  { name: 'login', path: '/api/auth/login', valid: { email: 'alex@example.com', auth: SECRET, kdf: 1 }, needsSession: false },
  {
    name: 'setup',
    path: '/api/auth/setup',
    valid: { setup_key: 'not-the-key-at-all', email: 'a@example.com', display_name: 'A', auth: SECRET, kdf: 1, aliases: [], keys: {} },
    needsSession: false
  },
  {
    name: 'recover',
    path: '/api/auth/recover',
    valid: { setup_key: 'not-the-key-at-all', email: 'alex@example.com', new_auth: SECRET, kdf: 1 },
    needsSession: false
  },
  {
    name: 'change-password',
    path: '/api/auth/change-password',
    valid: {
      current_auth: SECRET,
      new_auth: OTHER,
      kdf: 1,
      keys: { wrapped_private_key_pw: SECRET },
      keys_version: 1,
      admin_strength: false
    },
    needsSession: true
  },
  { name: 'login second step', path: '/api/auth/login/2fa', valid: { challenge: SECRET, code: '123456' }, needsSession: false },
  {
    name: 'key setup',
    path: '/api/keys/setup',
    valid: { current_auth: SECRET, keys: { new_keypair: {} }, keys_version: 1 },
    needsSession: true
  },
  {
    name: 'recovery key',
    path: '/api/keys/recovery',
    valid: { current_auth: SECRET, wrapped_private_key_recovery: SECRET, key_id: 'k', keys_version: 1 },
    needsSession: true
  },
  { name: '2fa enrol start', path: '/api/auth/2fa/enroll/start', valid: { current_auth: SECRET }, needsSession: true },
  { name: '2fa enrol confirm', path: '/api/auth/2fa/enroll/confirm', valid: { current_auth: SECRET, code: '123456' }, needsSession: true },
  { name: '2fa disable', path: '/api/auth/2fa/disable', valid: { current_auth: SECRET, code: '123456' }, needsSession: true },
  { name: '2fa recovery codes', path: '/api/auth/2fa/recovery-codes', valid: { current_auth: SECRET, code: '123456' }, needsSession: true }
];

/** Malformed variants of a valid body: every few truncations, wrong types, extra keys, and text that is not JSON at all. */
function malformed(valid: Record<string, unknown>): string[] {
  const text = JSON.stringify(valid);
  const bodies: string[] = [];
  for (let end = 1; end < text.length; end += 3) {
    bodies.push(text.slice(0, end));
  }
  for (const field of Object.keys(valid)) {
    for (const bad of [7, null, [SECRET], { nested: SECRET }, true, '']) {
      bodies.push(JSON.stringify({ ...valid, [field]: bad }));
    }
  }
  bodies.push(
    JSON.stringify({ ...valid, password: SECRET }),
    JSON.stringify({ ...valid, temp_password: SECRET, auth: SECRET }),
    JSON.stringify({ ...valid, kdf: 2 }),
    `auth=${SECRET}`,
    `{"auth":"${SECRET}`,
    `{"auth":"${SECRET}"}}`,
    `[${text}]`,
    `{${text}`,
    '['.repeat(5000) + SECRET,
    `${text}${SECRET}`,
    `\u0000${text}`
  );
  return bodies;
}

const outputOf = (spies: { mock: { calls: unknown[][] } }[]): string => JSON.stringify(spies.map((spy) => spy.mock.calls));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('malformed requests leak nothing (S13)', () => {
  for (const target of TARGETS) {
    it(`${target.name}: no fragment of auth and no parser text in a response or a log line, never a 500`, async () => {
      const member = await createUser('alex@example.com');
      const cookie = target.needsSession ? await signIn(member) : undefined;
      const spies = [
        vi.spyOn(console, 'error'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'info'),
        vi.spyOn(console, 'debug')
      ];
      const bodies = malformed(target.valid);
      expect(bodies.length).toBeGreaterThan(30);
      for (const [index, body] of bodies.entries()) {
        // A spread of client addresses, so the per-client throttle does not turn the later answers into 429.
        const answer = await call(target.path, { body, cookie, ip: `198.51.100.${(index % 200) + 1}` });
        const label = `${target.name} #${index}`;
        expect([400, 401, 403, 409, 429, 503], label).toContain(answer.status);
        for (const fragment of FRAGMENTS) {
          expect(answer.text, label).not.toContain(fragment);
        }
        expect(answer.text, label).not.toMatch(PARSER_TEXT);
      }
      const logged = outputOf(spies);
      for (const fragment of FRAGMENTS) {
        expect(logged).not.toContain(fragment);
      }
      expect(logged).not.toMatch(PARSER_TEXT);
    }, 120_000);
  }

  it('rejects an unknown key (strict validators) with the same fixed text, without echoing the key', async () => {
    const answer = await call('/api/auth/login', {
      body: { email: 'alex@example.com', auth: SECRET, kdf: 1, temp_password: 'hunter2hunter2' }
    });
    expect(answer.status).toBe(400);
    expect(answer.text).not.toContain('temp_password');
    expect(answer.text).not.toContain('hunter2');
    expect(answer.json).toEqual({
      success: false,
      error: 'A JSON object body with only the documented fields is required',
      code: 'invalid_body'
    });
  });
});
