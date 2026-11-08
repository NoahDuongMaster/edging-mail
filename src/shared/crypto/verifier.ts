import { decodeCanonical, equalBytes, fromBase64Url, toBase64Url } from './bytes';
import type { Bytes } from './bytes';
import { AUTH_BYTES, KDF_VERSION, PBKDF2_VERIFIER_ITERATIONS, VERIFIER_BYTES, VERIFIER_SALT_BYTES } from './constants';

// The server's check of `auth`: the browser derives it from the password (the server never sees the password) and sends it as the login
// credential, the 32 raw bytes of the derivation written as unpadded base64url. This stores and checks it exactly like a password:
// PBKDF2-SHA256 over those 32 RAW bytes (not over the 43-character text) with a random per-user salt, compared in constant time.
// This is the only implementation: the Worker imports it from the shared `server` entry. The recovery verifier (the check of `rauth`, the
// forgot-password proof) uses the same functions through the neutral `createSecretVerifier` / `verifySecret`, so there is one place
// where the timing of "known" and "unknown" is equalised.

/** The 32 raw bytes behind an `auth` value, or null when it is not the canonical encoding of exactly 32 bytes. */
export const decodeAuth = (value: unknown): Bytes | null => decodeCanonical(value, AUTH_BYTES);

export const isAuthValue = (value: unknown): value is string => decodeAuth(value) !== null;

async function derive(secret: Bytes, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, VERIFIER_BYTES * 8));
}

/** What a verifier row stores, whatever it verifies (column names differ per use: auth_* for the password, recovery_* for the recovery key). */
export interface SecretVerifier {
  verifier: string;
  salt: string;
  iterations: number;
}

/** True when a stored count can be used: 1..100,000 (above it production deriveBits throws, and a locked-out user must be visible, not silent). */
export const isUsableIterations = (iterations: number): boolean =>
  Number.isInteger(iterations) && iterations >= 1 && iterations <= PBKDF2_VERIFIER_ITERATIONS;

/** A fresh verifier (random salt) for 32 secret bytes. */
export async function createSecretVerifier(secret: Bytes): Promise<SecretVerifier> {
  if (secret.length !== AUTH_BYTES) {
    throw new Error('A verifier secret is 32 bytes');
  }
  const salt = crypto.getRandomValues(new Uint8Array(VERIFIER_SALT_BYTES));
  return {
    verifier: toBase64Url(await derive(secret, salt, PBKDF2_VERIFIER_ITERATIONS)),
    salt: toBase64Url(salt),
    iterations: PBKDF2_VERIFIER_ITERATIONS
  };
}

/** Constant-time check of 32 secret bytes against a stored row. A damaged row, or an unusable iteration count, never matches. */
export async function verifySecret(secret: Bytes, stored: SecretVerifier): Promise<boolean> {
  if (secret.length !== AUTH_BYTES || !isUsableIterations(stored.iterations)) {
    return false;
  }
  try {
    return equalBytes(await derive(secret, fromBase64Url(stored.salt), stored.iterations), fromBase64Url(stored.verifier));
  } catch {
    return false;
  }
}

export interface Verifier {
  auth_verifier: string;
  auth_salt: string;
  auth_iterations: number;
  kdf_version: number;
}

/** A fresh verifier (random salt) for an `auth` value: what the users table stores. */
export async function createVerifier(auth: string): Promise<Verifier> {
  const raw = decodeAuth(auth);
  if (raw === null) {
    throw new Error('The credential is not a canonical 32-byte base64url value');
  }
  const { verifier, salt, iterations } = await createSecretVerifier(raw);
  return { auth_verifier: verifier, auth_salt: salt, auth_iterations: iterations, kdf_version: KDF_VERSION };
}

export async function verifyAuth(
  auth: string,
  stored: Pick<Verifier, 'auth_verifier' | 'auth_salt' | 'auth_iterations'>
): Promise<boolean> {
  const raw = decodeAuth(auth);
  return raw !== null && verifySecret(raw, { verifier: stored.auth_verifier, salt: stored.auth_salt, iterations: stored.auth_iterations });
}

const DUMMY_SALT = new Uint8Array(VERIFIER_SALT_BYTES);

/** The same work as verifySecret for a row that does not exist, so unknown and wrong take equally long. Always false. */
export async function dummyVerifySecret(secret: Bytes | null): Promise<false> {
  await derive(secret?.length === AUTH_BYTES ? secret : new Uint8Array(AUTH_BYTES), DUMMY_SALT, PBKDF2_VERIFIER_ITERATIONS);
  return false;
}

/** The same work as verifyAuth for an address that does not exist. Always false. */
export const dummyVerify = (auth: string): Promise<false> => dummyVerifySecret(decodeAuth(auth));
