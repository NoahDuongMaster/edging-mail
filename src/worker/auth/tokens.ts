import { fromBase64Url, hkdf, LABEL, toBase64Url, utf8 } from '../../shared/crypto/server';

// Signed tokens: the session cookie and the two-factor challenge. Both are `base64url(json) . base64url(HMAC-SHA256)`, each under its OWN key
// derived from JWT_SECRET with its own label, and both carry a `typ` that the reader checks, so one can never be presented as the other.

const decoder = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();

type TokenKind = 'session' | 'challenge';
const LABELS: Record<TokenKind, string> = { session: LABEL.tokenSession, challenge: LABEL.tokenChallenge };

// One derived key per (secret, kind), kept for the life of the isolate.
function macKey(secret: string, kind: TokenKind): Promise<CryptoKey> {
  const id = `${kind}\0${secret}`;
  let key = keys.get(id);
  if (key === undefined) {
    key = hkdf(utf8(secret), utf8(LABELS[kind]), 32).then((raw) =>
      crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    );
    keys.set(id, key);
  }
  return key;
}

/** `claims` plus the type and the expiry (epoch seconds). */
export async function signToken(
  secret: string,
  kind: TokenKind,
  claims: Record<string, string | number>,
  lifetimeSeconds: number
): Promise<string> {
  const payload = toBase64Url(utf8(JSON.stringify({ ...claims, typ: kind, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds })));
  const signature = await crypto.subtle.sign('HMAC', await macKey(secret, kind), utf8(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The claims of a genuine, unexpired token of this kind, or undefined. Never throws and never says why. */
export async function readToken(token: string | undefined, secret: string, kind: TokenKind): Promise<Record<string, unknown> | undefined> {
  const parts = token?.split('.');
  if (parts?.length !== 2) {
    return undefined;
  }
  const [payload = '', signature = ''] = parts;
  try {
    // SubtleCrypto.verify compares the MAC in constant time
    if (!(await crypto.subtle.verify('HMAC', await macKey(secret, kind), fromBase64Url(signature), utf8(payload)))) {
      return undefined;
    }
    const claims = JSON.parse(decoder.decode(fromBase64Url(payload))) as Record<string, unknown>;
    return claims.typ === kind && typeof claims.exp === 'number' && claims.exp > Date.now() / 1000 ? claims : undefined;
  } catch {
    // malformed base64 or JSON
    return undefined;
  }
}
