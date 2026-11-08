import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/worker/base64url';
import { KDF_VERSION, PBKDF2_VERIFIER_ITERATIONS, createVerifier, dummyVerify, isAuthValue, verifyAuth } from '../src/shared/crypto/server';
import { authFor } from './helpers';

describe('the sign-in verifier', () => {
  // Cloudflare Workers refuse PBKDF2 above 100,000 iterations in production (the local runtime does not, so only this test notices
  // a change): going higher would make every sign-in fail once deployed.
  it('uses at most 100,000 PBKDF2 iterations, the production cap of Workers', () => {
    expect(PBKDF2_VERIFIER_ITERATIONS).toBe(100_000);
    expect(KDF_VERSION).toBe(1);
  });

  it('accepts only a 32-byte base64url value as the credential', async () => {
    expect(isAuthValue(await authFor('a@example.com', 'a password'))).toBe(true);
    for (const value of [
      '',
      'short',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)}+`,
      `${'A'.repeat(42)}/`,
      // 43 characters, but the last one has bits that 32 bytes do not use: the same bytes in a non-canonical spelling
      `${'A'.repeat(42)}B`,
      `${'A'.repeat(42)}_`,
      7,
      null,
      undefined
    ]) {
      expect(isAuthValue(value), String(value)).toBe(false);
    }
  });

  it('verifies the right credential and nothing else, with a new salt every time', async () => {
    const auth = await authFor('a@example.com', 'a password');
    const first = await createVerifier(auth);
    const second = await createVerifier(auth);
    expect(first.auth_salt).not.toBe(second.auth_salt);
    expect(first.auth_verifier).not.toBe(second.auth_verifier);
    expect(first).toMatchObject({ auth_iterations: PBKDF2_VERIFIER_ITERATIONS, kdf_version: KDF_VERSION });
    expect(first.auth_verifier).not.toContain(auth);
    expect(await verifyAuth(auth, first)).toBe(true);
    expect(await verifyAuth(await authFor('a@example.com', 'another password'), first)).toBe(false);
    expect(await verifyAuth('not an auth value', first)).toBe(false);
    expect(await dummyVerify(auth)).toBe(false);
  });
});

// KAT-7 of the crypto review (crypto-review-vectors/vectors.json, `verifier`): the verifier is PBKDF2-SHA256 over the RAW 32 bytes of
// `auth`, 100,000 iterations. Hashing the 43-character text instead gives the second value, which must NOT verify.
const AUTH = 'tv1dHD4yD8hm9RwRBgpbns5ijXFMM-NMVzU1r-ziZ-U';
const stored = (verifierHex: string) => ({
  auth_salt: toBase64Url(Uint8Array.from({ length: 16 }, (_, index) => index)),
  auth_iterations: 100_000,
  auth_verifier: toBase64Url(Uint8Array.from(verifierHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)))
});

describe('the verifier known-answer test', () => {
  it('accepts the verifier of the raw bytes and refuses the one of the base64url text', async () => {
    expect(fromBase64Url(AUTH)).toHaveLength(32);
    expect(await verifyAuth(AUTH, stored('a98e9c497c1ab1a799d9039ba2d9a804f13d9bb7f42464333c23292893c1e846'))).toBe(true);
    expect(await verifyAuth(AUTH, stored('3dcb24d1d98e5076f1e82bc79bd5e40c2c32d75c67b6a3676963f58929e59748'))).toBe(false);
  });
});
