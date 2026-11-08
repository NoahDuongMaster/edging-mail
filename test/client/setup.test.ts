import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveCredentials } from '../../src/shared/crypto/client';
import en from '../../src/shared/i18n/locales/en.json';
import { ApiError } from '../../src/client/lib/api';
import { retryAfterOf } from '../../src/client/lib/crypto/errors';
import { dropGateCredentials, readGateCredentials } from '../../src/client/lib/crypto/gateCredentials';
import { getUnlockedKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import type { KeyBackend, StoredKey } from '../../src/client/lib/crypto/keyStore';
import { RecoveryKeyDraft } from '../../src/client/lib/crypto/recoveryDraft';
import { setupBody } from '../../src/client/lib/crypto/requests';
import type { SetupFields } from '../../src/client/lib/crypto/requests';
import { addressProblem, completeSetup, DISPLAY_NAME_MAX, hasProblems, validateSetupFields } from '../../src/client/lib/crypto/setup';

const SETUP_KEY = 'canary-setup-key-7f3a91c2d0b4';
const PASSWORD = 'canary password: horse battery staple 7731';

const FIELDS: SetupFields = { setupKey: SETUP_KEY, email: 'admin@example.com', displayName: 'Ada Lovelace', language: 'vi' };

describe('validateSetupFields', () => {
  it('accepts a complete, matching form and an empty display name', () => {
    expect(validateSetupFields(FIELDS, PASSWORD, PASSWORD)).toEqual({});
    expect(validateSetupFields({ ...FIELDS, displayName: '' }, PASSWORD, PASSWORD)).toEqual({});
    expect(hasProblems({})).toBe(false);
  });

  it('asks for the setup key when it is empty', () => {
    expect(validateSetupFields({ ...FIELDS, setupKey: '' }, PASSWORD, PASSWORD)).toEqual({ setupKey: 'setup.err_key_required' });
  });

  it('names an empty address and a refused address by different keys', () => {
    expect(addressProblem('')).toBe('setup.err_address_required');
    expect(addressProblem(' '.repeat(3))).toBe('setup.err_address_required');
    expect(validateSetupFields({ ...FIELDS, email: 'nobody' }, PASSWORD, PASSWORD)).toEqual({ email: 'setup.err_address_invalid' });
  });

  it('accepts what the server accepts, trimmed and in any case', () => {
    for (const address of [
      'admin@example.com',
      '  Admin@Example.COM  ',
      'first.last@mail.example.co.uk',
      'a_b-c9@sub-domain.example.com',
      `${'a'.repeat(64)}@example.com`
    ]) {
      expect(addressProblem(address), address).toBeNull();
    }
  });

  it('refuses what the server or the key derivation would refuse, before any derivation', () => {
    for (const address of [
      'admin',
      '@example.com',
      'admin@',
      'a@b@example.com',
      'admin@example',
      'admin@localhost',
      'admin@192.168.0.1',
      'admin@-example.com',
      'admin@example..com',
      'ad min@example.com',
      'ádmin@example.com',
      'admin@exämple.com',
      'admin+tag@example.com',
      '.admin@example.com',
      'ad..min@example.com',
      'admin.@example.com',
      `${'a'.repeat(65)}@example.com`,
      `admin@${'a'.repeat(64)}.com`,
      'Ada <admin@example.com>'
    ]) {
      expect(addressProblem(address), address).toBe('setup.err_address_invalid');
    }
  });

  it('takes a display name of one line up to 100 characters, trimmed like the server does', () => {
    const padded = `${' '.repeat(2)}${'a'.repeat(DISPLAY_NAME_MAX)}${' '.repeat(2)}`;
    for (const displayName of ['Ada', 'a'.repeat(DISPLAY_NAME_MAX), padded, 'Ada\r\n', ' '.repeat(2)]) {
      expect(validateSetupFields({ ...FIELDS, displayName }, PASSWORD, PASSWORD), JSON.stringify(displayName)).toEqual({});
    }
    for (const displayName of ['a'.repeat(DISPLAY_NAME_MAX + 1), 'Ada\nLovelace', 'Ada\rLovelace']) {
      expect(validateSetupFields({ ...FIELDS, displayName }, PASSWORD, PASSWORD), JSON.stringify(displayName)).toEqual({
        displayName: 'setup.err_name_invalid'
      });
    }
  });

  it('wants both passwords equal, compared the way the key derivation sees them (NFKC)', () => {
    expect(validateSetupFields(FIELDS, PASSWORD, `${PASSWORD}x`)).toEqual({ confirm: 'gate.passwords_differ' });
    expect(validateSetupFields(FIELDS, PASSWORD, '')).toEqual({ confirm: 'gate.passwords_differ' });
    expect(validateSetupFields(FIELDS, 'caf\u00E9 caf\u00E9 caf\u00E9', 'cafe\u0301 cafe\u0301 cafe\u0301')).toEqual({});
  });

  it('reports every problem at once, by key, and every key is in the catalogue', () => {
    const problems = validateSetupFields({ setupKey: '', email: 'x', displayName: 'a\nb', language: 'en' }, 'one', 'two');
    expect(Object.keys(problems).toSorted()).toEqual(['confirm', 'displayName', 'email', 'setupKey']);
    expect(hasProblems(problems)).toBe(true);
    const catalogue: Record<string, string> = en;
    const returned: unknown[] = Object.values(problems);
    returned.push('setup.err_address_required');
    for (const key of returned) {
      expect(catalogue[key as string], String(key)).toBeTypeOf('string');
    }
  });
});

// Names that must never be a field of a request body, at any depth. The setup key IS sent (it is what the server checks), under its own name.
const SECRET_NAME = /^(password|passwd|pw|rk|rwk|wk|mk|recovery_key|private_key|privatekey)$/i;

function fieldNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(fieldNames);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([name, inner]) => [name, ...fieldNames(inner)]);
  }
  return [];
}

describe('the setup request body', () => {
  const upload = {
    public_key: 'public-key',
    key_id: 'key-id',
    wrapped_private_key_pw: 'wrapped-by-password',
    wrapped_private_key_recovery: 'wrapped-by-recovery-key',
    recovery_auth: 'proof-of-recovery-key'
  };

  it('has exactly the fields the route reads and none that could carry a secret', () => {
    const body = setupBody(FIELDS, 'auth-value', upload);
    expect(Object.keys(body).toSorted()).toEqual(['auth', 'display_name', 'email', 'kdf', 'keys', 'language', 'setup_key']);
    expect(Object.keys(body.keys).toSorted()).toEqual([
      'key_id',
      'public_key',
      'recovery_auth',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
    expect(body).toMatchObject({
      setup_key: SETUP_KEY,
      email: 'admin@example.com',
      display_name: 'Ada Lovelace',
      auth: 'auth-value',
      kdf: 1,
      language: 'vi'
    });
    for (const name of fieldNames(body)) {
      expect(name, name).not.toMatch(SECRET_NAME);
      expect(name, name).not.toMatch(/password/i);
    }
  });
});

describe('completeSetup', () => {
  const records = new Map<string, StoredKey>();
  const backend: KeyBackend = {
    read: (userId) => Promise.resolve(records.get(userId) ?? null),
    write: (userId, record) => {
      records.set(userId, record);
      return Promise.resolve();
    },
    remove: (userId) => {
      records.delete(userId);
      return Promise.resolve();
    },
    users: () => [...records.keys()]
  };
  const user = {
    id: 'user-1',
    email: 'admin@example.com',
    display_name: 'Ada Lovelace',
    role: 'admin',
    must_change_password: false,
    has_keys: true,
    totp_enabled: false,
    require_2fa: true,
    two_factor_reset_due_at: null,
    admin_password_upgrade_required: false,
    step_up_at: 0
  };

  interface Sent {
    url: string;
    body: Record<string, unknown>;
  }
  let sent: Sent[] = [];

  /** The fetch of the browser, replaced: answers in turn with the given [status, body, headers] and records what was sent. */
  const answerWith = (...answers: [number, unknown, Record<string, string>?][]): void => {
    const queue = [...answers];
    vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('unexpected request');
      }
      return Promise.resolve(Response.json(next[1], { status: next[0], headers: next[2] }));
    });
  };

  beforeEach(() => {
    sent = [];
    records.clear();
    setKeyBackend(backend);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    dropGateCredentials();
    await wipeKeys();
  });

  it('posts one request that carries the setup key and what the password was turned into, never the password or the recovery key', async () => {
    answerWith([200, { success: true, user, gate: 'two_factor_enrollment_required' }]);
    const draft = await RecoveryKeyDraft.create();
    const result = await completeSetup({ ...FIELDS, email: '  Admin@Example.COM ', displayName: '  Ada Lovelace  ' }, PASSWORD, draft);

    expect(result.gate).toBe('two_factor_enrollment_required');
    expect(sent).toHaveLength(1);
    const [{ url, body }] = sent;
    expect(url).toBe('/api/auth/setup');
    expect(Object.keys(body).toSorted()).toEqual(['auth', 'display_name', 'email', 'kdf', 'keys', 'language', 'setup_key']);
    // The address and the name are sent in their canonical form, the same address the credentials were derived for.
    expect(body).toMatchObject({ setup_key: SETUP_KEY, email: 'admin@example.com', display_name: 'Ada Lovelace', language: 'vi' });
    expect(body.auth).toBe((await deriveCredentials(PASSWORD, 'admin@example.com')).auth);
    for (const name of fieldNames(body)) {
      expect(name, name).not.toMatch(SECRET_NAME);
    }
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(PASSWORD);
    expect(wire).not.toContain(draft.text);
    expect(wire.split(SETUP_KEY)).toHaveLength(2);
    draft.discard();
  });

  it('makes the new key the key in use, kept on this device, and holds the credentials of the next gate', async () => {
    answerWith([200, { success: true, user, gate: 'two_factor_enrollment_required' }]);
    const draft = await RecoveryKeyDraft.create();
    await completeSetup(FIELDS, PASSWORD, draft);

    const key = getUnlockedKey();
    expect(key?.userId).toBe('user-1');
    expect(key?.pair.privateKey.extractable).toBe(false);
    const stored = records.get('user-1');
    expect(stored?.keyId).toBe(key?.keyId);
    expect(stored?.privateKey.extractable).toBe(false);

    const gate = readGateCredentials();
    expect(gate).toMatchObject({ email: 'admin@example.com', persist: true });
    expect(gate?.auth).toBe((await deriveCredentials(PASSWORD, 'admin@example.com')).auth);
    expect(gate?.wrapKey.extractable).toBe(false);
    draft.discard();
  });

  it('holds no gate credentials when the answer names no gate', async () => {
    answerWith([200, { success: true, user, gate: null }]);
    const draft = await RecoveryKeyDraft.create();
    const result = await completeSetup(FIELDS, PASSWORD, draft);
    expect(result.gate).toBeNull();
    expect(readGateCredentials()).toBeNull();
    expect(getUnlockedKey()?.userId).toBe('user-1');
    draft.discard();
  });

  it('refuses a bad address before deriving anything or sending anything', async () => {
    answerWith();
    const draft = await RecoveryKeyDraft.create();
    await expect(completeSetup({ ...FIELDS, email: 'not an address' }, PASSWORD, draft)).rejects.toMatchObject({
      name: 'CryptoFormatError'
    });
    expect(sent).toHaveLength(0);
    draft.discard();
  });

  it('passes a wrong setup key on as the API error and keeps nothing', async () => {
    answerWith([401, { success: false, error: 'Wrong setup key', code: 'wrong_setup_key' }]);
    const draft = await RecoveryKeyDraft.create();
    const failure: unknown = await completeSetup(FIELDS, PASSWORD, draft).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: 'wrong_setup_key', status: 401, message: en['err.wrong_setup_key'] });
    expect(retryAfterOf(failure)).toBeNull();
    expect(getUnlockedKey()).toBeNull();
    expect(readGateCredentials()).toBeNull();
    expect(records.size).toBe(0);
    draft.discard();
  });

  it('reports the seconds a throttled answer asks for, and the same draft can try again afterwards', async () => {
    answerWith(
      [429, { success: false, error: 'Too many attempts', code: 'too_many_attempts', retry_after: 37 }, { 'Retry-After': '37' }],
      [200, { success: true, user, gate: 'two_factor_enrollment_required' }]
    );
    const draft = await RecoveryKeyDraft.create();
    const failure: unknown = await completeSetup(FIELDS, PASSWORD, draft).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'too_many_attempts', status: 429 });
    expect(retryAfterOf(failure)).toBe(37);
    expect(getUnlockedKey()).toBeNull();

    await expect(completeSetup(FIELDS, PASSWORD, draft)).resolves.toMatchObject({ gate: 'two_factor_enrollment_required' });
    expect(getUnlockedKey()?.userId).toBe('user-1');
    draft.discard();
  });
});
