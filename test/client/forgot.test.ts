import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertKeyPair,
  createKeySet,
  decodeRecoveryKey,
  deriveCredentials,
  deriveRecoveryAuth,
  encodeRecoveryKey,
  fromBase64Url,
  generateRecoveryKey,
  recoveryWrapKey,
  unwrapPrivateKey
} from '../../src/shared/crypto/client';
import { ForgotFlow, parseFactorInput } from '../../src/client/lib/crypto/forgot';
import { RecoveryKeyDraft } from '../../src/client/lib/crypto/recoveryDraft';
import { ApiError } from '../../src/client/lib/api';
import { KeysOpenError } from '../../src/client/lib/crypto/errors';

// "Forgot password", the browser's half (crypto-design.md 15.3), end to end against a stand-in server: the recovery key opens the private key,
// the new password and the NEW recovery key both open it afterwards, and nothing secret goes out.

const ADDRESS = 'alice@example.com';
const OLD_PASSWORD = 'forgot-OldPassword-2291-lantern';
const NEW_PASSWORD = 'forgot-NewPassword-7710-granite-orbit';

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

function serverThatAnswers(answers: Record<string, unknown>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown> });
      const answer = answers[url];
      return Promise.resolve(
        answer === undefined
          ? Response.json({ success: false, code: 'recovery_failed' }, { status: 401 })
          : Response.json({ success: true, ...(answer as object) }, { status: 200 })
      );
    })
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function accountWithRecoveryKey() {
  const recoveryKey = generateRecoveryKey();
  const recoveryText = await encodeRecoveryKey(recoveryKey);
  const old = await deriveCredentials(OLD_PASSWORD, ADDRESS);
  const keySet = await createKeySet(old.wrapKey, recoveryKey, ADDRESS);
  return { recoveryText, keySet };
}

describe('parseFactorInput', () => {
  it('reads six digits as an authenticator code, other text as a recovery code, nothing as no code', () => {
    expect(parseFactorInput('')).toBeNull();
    expect(parseFactorInput(' '.repeat(3))).toBeNull();
    expect(parseFactorInput('123 456')).toEqual({ code: '123456' });
    expect(parseFactorInput(' 654321 ')).toEqual({ code: '654321' });
    expect(parseFactorInput('abcd-efgh-ijkl')).toEqual({ recovery_code: 'abcd-efgh-ijkl' });
    expect(parseFactorInput('12345')).toEqual({ recovery_code: '12345' });
  });
});

describe('the forgot-password flow', () => {
  it('opens the key with the recovery key, then the new password and the new recovery key both open it', async () => {
    const { recoveryText, keySet } = await accountWithRecoveryKey();
    const sent = serverThatAnswers({
      '/api/auth/forgot/verify': {
        ticket: 'ticket-value',
        public_key: keySet.upload.public_key,
        key_id: keySet.upload.key_id,
        keys_version: 4,
        wrapped_private_key_recovery: keySet.upload.wrapped_private_key_recovery,
        min_password_length: 12
      },
      '/api/auth/forgot/complete': {}
    });

    const flow = await ForgotFlow.verify(` ${ADDRESS.toUpperCase()} `, recoveryText.toLowerCase(), '');
    expect(flow.minPasswordLength).toBe(12);
    // Step 1 sent the proof, never the key; the address is lowercased and trimmed; no code was asked for.
    const verifyBody = sent[0]?.body ?? {};
    expect(Object.keys(verifyBody).toSorted()).toEqual(['email', 'kdf', 'recovery_auth']);
    expect(verifyBody.email).toBe(ADDRESS);
    expect(verifyBody.recovery_auth).toBe((await deriveRecoveryAuth(await decodeRecoveryKey(recoveryText))).text);
    expect(JSON.stringify(verifyBody).includes(recoveryText.replaceAll('-', ''))).toBe(false);

    const draft = await RecoveryKeyDraft.create();
    const newRecoveryText = draft.text;
    await flow.complete(NEW_PASSWORD, draft);

    const completeBody = sent[1]?.body ?? {};
    expect(sent[1]?.url).toBe('/api/auth/forgot/complete');
    expect(Object.keys(completeBody).toSorted()).toEqual([
      'kdf',
      'new_auth',
      'recovery_auth',
      'ticket',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
    expect(completeBody.ticket).toBe('ticket-value');
    const json = JSON.stringify(completeBody);
    for (const secret of [NEW_PASSWORD, OLD_PASSWORD, recoveryText, newRecoveryText, newRecoveryText.replaceAll('-', '')]) {
      expect(json.includes(secret)).toBe(false);
    }

    // The new password opens the key...
    const next = await deriveCredentials(NEW_PASSWORD, ADDRESS);
    expect(completeBody.new_auth).toBe(next.auth);
    const byPassword = await unwrapPrivateKey(
      next.wrapKey,
      fromBase64Url(completeBody.wrapped_private_key_pw as string),
      ADDRESS,
      keySet.upload.key_id
    );
    await assertKeyPair(byPassword, keySet.publicKey);
    // ...and so does the NEW recovery key; the old one's proof is not what was sent.
    const newKey = await decodeRecoveryKey(newRecoveryText);
    const byRecovery = await unwrapPrivateKey(
      await recoveryWrapKey(newKey),
      fromBase64Url(completeBody.wrapped_private_key_recovery as string),
      ADDRESS,
      keySet.upload.key_id
    );
    await assertKeyPair(byRecovery, keySet.publicKey);
    expect(completeBody.recovery_auth).toBe((await deriveRecoveryAuth(newKey)).text);
    expect(completeBody.recovery_auth).not.toBe(verifyBody.recovery_auth);
  }, 60_000);

  it('reports a mistyped recovery key before any request', async () => {
    const { recoveryText } = await accountWithRecoveryKey();
    const sent = serverThatAnswers({});
    const typo = recoveryText.slice(0, -1) + (recoveryText.endsWith('A') ? 'B' : 'A');
    await expect(ForgotFlow.verify(ADDRESS, typo, '')).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('shows the server refusal as an ApiError and keeps the flow unopened', async () => {
    const { recoveryText } = await accountWithRecoveryKey();
    serverThatAnswers({});
    await expect(ForgotFlow.verify(ADDRESS, recoveryText, '')).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses a recovery wrap that the key does not open (a substituted answer)', async () => {
    const { recoveryText, keySet } = await accountWithRecoveryKey();
    const other = await accountWithRecoveryKey();
    serverThatAnswers({
      '/api/auth/forgot/verify': {
        ticket: 't',
        public_key: keySet.upload.public_key,
        key_id: keySet.upload.key_id,
        keys_version: 1,
        wrapped_private_key_recovery: other.keySet.upload.wrapped_private_key_recovery,
        min_password_length: 12
      }
    });
    await expect(ForgotFlow.verify(ADDRESS, recoveryText, '')).rejects.toBeInstanceOf(KeysOpenError);
  }, 60_000);

  it('a discarded flow cannot complete', async () => {
    const { recoveryText, keySet } = await accountWithRecoveryKey();
    serverThatAnswers({
      '/api/auth/forgot/verify': {
        ticket: 't',
        public_key: keySet.upload.public_key,
        key_id: keySet.upload.key_id,
        keys_version: 1,
        wrapped_private_key_recovery: keySet.upload.wrapped_private_key_recovery,
        min_password_length: 16
      }
    });
    const flow = await ForgotFlow.verify(ADDRESS, recoveryText, '');
    expect(flow.minPasswordLength).toBe(16);
    flow.discard();
    const draft = await RecoveryKeyDraft.create();
    await expect(flow.complete(NEW_PASSWORD, draft)).rejects.toThrow('discarded');
    draft.discard();
  }, 60_000);
});
