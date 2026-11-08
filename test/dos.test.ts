import { describe, expect, it } from 'vitest';
import { authFor, call, createUser, fakeWrap, setupKeys } from './helpers';

// DOS-1 (crypto-review.md 12.6): a verify costs CPU, so every public route that runs one reads its counters BEFORE the key derivation, and fails
// CLOSED (503, no derivation, no answer that reveals anything) when the throttle store cannot be read.

const broken = {
  prepare: () => {
    throw new Error('database is down');
  },
  batch: () => {
    throw new Error('database is down');
  }
} as unknown as D1Database;

const SECRET = 'A'.repeat(43);
// Well-formed bodies: a request that fails validation never reaches the throttle (nor the key derivation), so shape is not what is tested here.
const routes = async (): Promise<[string, Record<string, unknown>][]> => [
  ['/api/auth/login', { email: 'alex@example.com', auth: SECRET, kdf: 1 }],
  ['/api/auth/forgot/verify', { email: 'alex@example.com', recovery_auth: SECRET, kdf: 1 }],
  [
    '/api/auth/forgot/complete',
    {
      ticket: SECRET,
      new_auth: SECRET,
      kdf: 1,
      wrapped_private_key_pw: fakeWrap(),
      wrapped_private_key_recovery: fakeWrap(),
      recovery_auth: SECRET
    }
  ],
  [
    '/api/auth/setup',
    {
      setup_key: 'test-setup-key-0123456789',
      email: 'alex@example.com',
      auth: SECRET,
      kdf: 1,
      keys: await setupKeys('alex@example.com')
    }
  ],
  [
    '/api/auth/recover',
    {
      setup_key: 'test-setup-key-0123456789',
      email: 'alex@example.com',
      new_auth: SECRET,
      kdf: 1,
      keys: await setupKeys('alex@example.com')
    }
  ]
];

describe('the public routes fail closed when the throttle store cannot be read', () => {
  it('answers 503 and nothing else on login, forgot verify and complete, setup and break-glass', async () => {
    for (const [path, body] of await routes()) {
      const answer = await call(path, { body, env: { DB: broken } });
      expect(answer.status, path).toBe(503);
      expect(answer.json, path).toMatchObject({ success: false, code: 'unavailable' });
      expect(answer.headers.get('Set-Cookie'), path).toBeNull();
      expect(answer.text, path).not.toMatch(/database|down|SQL/i);
    }
  });

  it('is not an answer about the account: the same 503 for an address that exists and one that does not', async () => {
    await createUser('alex@example.com');
    const texts = new Set<string>();
    for (const email of ['alex@example.com', 'nobody@example.com']) {
      const answer = await call('/api/auth/login', {
        body: { email, auth: await authFor(email, 'whatever password'), kdf: 1 },
        env: { DB: broken }
      });
      expect(answer.status).toBe(503);
      texts.add(answer.text);
    }
    expect(texts.size).toBe(1);
  });
});
