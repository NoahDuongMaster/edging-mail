import { describe, expect, it } from 'vitest';
import {
  createKeySet,
  deriveCredentials,
  deriveRecoveryAuth,
  encodeRecoveryKey,
  generateRecoveryKey,
  toBase64Url,
  unwrapPrivateKey
} from '../../src/shared/crypto/client';
import { fromBase64Url } from '../../src/shared/crypto/server';
import {
  breakGlassBody,
  changePasswordBody,
  enrollStartBody,
  firstPasswordBody,
  forgotCompleteBody,
  forgotVerifyBody,
  keySetupBody,
  loginBody,
  lockedCancelBody,
  logoutBody,
  lockedDeleteBody,
  newRecoveryKeyBody,
  secondStepBody,
  setupBody,
  stepUpBody,
  twoFactorBody
} from '../../src/client/lib/crypto/requests';

// crypto-design.md 15.10, canary scan: no password, recovery key, `rwk`, `wk` or private key ever appears in a request body, and no body has a field
// named for one. Real values are made once (one PBKDF2 pass for the password, one for the new password), every body is built with them, and the
// JSON of each body is searched for every secret in every spelling a bug could produce.

const PASSWORD = 'canary-Password-\u00E9-4817-horse-battery';
const NEW_PASSWORD = 'canary-NewPassword-9042-correct-staple';
const ADDRESS = 'alice@example.com';
const FORBIDDEN_NAMES = [
  'password',
  'new_password',
  'current_password',
  'rk',
  'rwk',
  'wk',
  'mk',
  'recovery_key',
  'recoveryKey',
  'privateKey',
  'private_key',
  'pkcs8',
  'jwk',
  'secret'
];

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function fieldNames(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'object' && value !== null) {
    for (const [name, inner] of Object.entries(value)) {
      into.push(name);
      fieldNames(inner, into);
    }
  }
  return into;
}

describe('request bodies never carry a secret', () => {
  it('has no secret field name and no canary value in any body', async () => {
    const current = await deriveCredentials(PASSWORD, ADDRESS);
    const next = await deriveCredentials(NEW_PASSWORD, ADDRESS);
    const recoveryKey = generateRecoveryKey();
    const recoveryText = await encodeRecoveryKey(recoveryKey);
    const keySet = await createKeySet(next.wrapKey, recoveryKey, ADDRESS);
    const recoveryAuth = (await deriveRecoveryAuth(recoveryKey)).text;
    const { upload } = keySet;

    // The private key as PKCS8: the browser holds it only as a non-extractable key, and the one wrap that leaves is the encrypted one.
    const wrapped = upload.wrapped_private_key_pw;
    const opened = await unwrapPrivateKey(next.wrapKey, fromBase64Url(wrapped), ADDRESS, upload.key_id, true);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', opened));

    const bodies = {
      login: loginBody(ADDRESS, current.auth),
      login_shared: loginBody(ADDRESS, current.auth, true),
      second_step: secondStepBody('challenge-token', { code: '123456' }),
      second_step_recovery: secondStepBody('challenge-token', { recovery_code: 'abcd-efgh' }),
      first_password: firstPasswordBody(current.auth, next.auth, upload, true),
      change_password: changePasswordBody(current.auth, next.auth, wrapped, 3, false),
      key_setup: keySetupBody(current.auth, upload),
      new_recovery_key: newRecoveryKeyBody(current.auth, upload.wrapped_private_key_recovery, recoveryAuth, 3),
      forgot_verify: forgotVerifyBody(ADDRESS, recoveryAuth, { code: '123456' }),
      forgot_verify_without_code: forgotVerifyBody(ADDRESS, recoveryAuth, null),
      forgot_complete: forgotCompleteBody(
        toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        next.auth,
        wrapped,
        upload.wrapped_private_key_recovery,
        recoveryAuth
      ),
      setup: setupBody({ setupKey: 'the-setup-key', email: ADDRESS, displayName: 'Alice', language: 'en' }, next.auth, upload),
      break_glass: breakGlassBody('the-setup-key', ADDRESS, next.auth, upload),
      enroll_start: enrollStartBody(current.auth),
      enroll_confirm: twoFactorBody(current.auth, '123456'),
      step_up: stepUpBody('123456'),
      locked_delete: lockedDeleteBody(current.auth, 'AAAAAAAAAAAAAAAAAAAAAA'),
      locked_cancel: lockedCancelBody('AAAAAAAAAAAAAAAAAAAAAA'),
      logout_with_push: logoutBody('https://push.example.net/send/abc123'),
      logout: logoutBody(null)
    };

    const canaries: [string, string][] = [
      ['the password', PASSWORD],
      ['the new password', NEW_PASSWORD],
      ['the recovery key text', recoveryText],
      ['the recovery key text without hyphens', recoveryText.replaceAll('-', '')],
      ['the recovery key (base64url)', toBase64Url(recoveryKey)],
      ['the recovery key (hex)', hex(recoveryKey)],
      ['the PKCS8 private key (base64url)', toBase64Url(pkcs8)],
      ['the PKCS8 private key (hex)', hex(pkcs8)],
      ['the PKCS8 prefix', 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg']
    ];
    for (const [name, body] of Object.entries(bodies)) {
      const json = JSON.stringify(body);
      for (const [what, secret] of canaries) {
        expect(json.includes(secret), `${name} must not contain ${what}`).toBe(false);
      }
      const names = fieldNames(body);
      for (const forbidden of FORBIDDEN_NAMES) {
        expect(names.includes(forbidden), `${name} must not have a field named ${forbidden}`).toBe(false);
      }
    }
  }, 60_000);

  it('builds exactly the fields the routes read', () => {
    expect(Object.keys(loginBody('a@example.com', 'x')).toSorted()).toEqual(['auth', 'email', 'kdf']);
    // CK-17: the shared-device choice goes with the sign-in only when it was made, as one boolean (not a secret).
    expect(Object.keys(loginBody('a@example.com', 'x', false)).toSorted()).toEqual(['auth', 'email', 'kdf']);
    expect(loginBody('a@example.com', 'x', true)).toMatchObject({ shared: true });
    expect(Object.keys(loginBody('a@example.com', 'x', true)).toSorted()).toEqual(['auth', 'email', 'kdf', 'shared']);
    expect(Object.keys(secondStepBody('c', { code: '1' })).toSorted()).toEqual(['challenge', 'code']);
    expect(Object.keys(secondStepBody('c', { recovery_code: '1' })).toSorted()).toEqual(['challenge', 'recovery_code']);
    expect(Object.keys(forgotVerifyBody('a@example.com', 'r', null)).toSorted()).toEqual(['email', 'kdf', 'recovery_auth']);
    expect(Object.keys(forgotVerifyBody('a@example.com', 'r', { recovery_code: 'z' })).toSorted()).toEqual([
      'email',
      'kdf',
      'recovery_auth',
      'recovery_code'
    ]);
    expect(Object.keys(changePasswordBody('a', 'b', 'w', 1, false)).toSorted()).toEqual([
      'admin_strength',
      'current_auth',
      'kdf',
      'keys',
      'keys_version',
      'new_auth'
    ]);
    expect(Object.keys(changePasswordBody('a', 'b', 'w', 1, false).keys)).toEqual(['wrapped_private_key_pw']);
    expect(Object.keys(newRecoveryKeyBody('a', 'w', 'r', 1)).toSorted()).toEqual([
      'current_auth',
      'keys_version',
      'recovery_auth',
      'wrapped_private_key_recovery'
    ]);
    expect(Object.keys(forgotCompleteBody('t', 'n', 'w', 'v', 'r')).toSorted()).toEqual([
      'kdf',
      'new_auth',
      'recovery_auth',
      'ticket',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
    expect(Object.keys(enrollStartBody('a'))).toEqual(['current_auth']);
    expect(Object.keys(twoFactorBody('a', '1')).toSorted()).toEqual(['code', 'current_auth']);
    expect(Object.keys(stepUpBody('1'))).toEqual(['code']);
    // Locked old mail: Delete carries the password's `auth` and the key id; Cancel needs the session only.
    expect(Object.keys(lockedDeleteBody('a', 'k')).toSorted()).toEqual(['current_auth', 'key_id']);
    expect(Object.keys(lockedCancelBody('k'))).toEqual(['key_id']);
    // Sign-out: the push endpoint of this browser, only when it has one (CK-16); nothing else.
    expect(logoutBody(null)).toEqual({});
    expect(logoutBody('')).toEqual({});
    expect(logoutBody('https://push.example.net/x')).toEqual({ push_endpoint: 'https://push.example.net/x' });
  });

  it('a first key set is sent with version 0 and the kdf version the server accepts', async () => {
    const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
      'wrapKey',
      'unwrapKey'
    ]);
    const { upload } = await createKeySet(wrapKey, generateRecoveryKey(), ADDRESS);
    const body = firstPasswordBody('a', 'b', upload, false);
    expect(body.keys_version).toBe(0);
    expect(body.kdf).toBe(1);
    expect(Object.keys(body.keys).toSorted()).toEqual([
      'key_id',
      'public_key',
      'recovery_auth',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
  });
});
