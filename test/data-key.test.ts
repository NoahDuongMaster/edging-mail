import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { dataMacs, isCurrent, loadDataKeys, openData, openLegacyVapidKey, sealData, utf8 } from '../src/shared/crypto/server';
import type { DataKeys } from '../src/shared/crypto/server';

// DATA_KEY (M2 / RR-5): what it accepts, what it seals, and how a rotation keeps old values readable.

const CURRENT = env.DATA_KEY ?? '';
const PREVIOUS = env.TEST_PREVIOUS_DATA_KEY;
const OTHERS = [env.JWT_SECRET, env.APP_PASSWORD];
// A valid key whose standard base64 contains + and /, so its base64url spelling differs
const URL_SAFE = '+wIJEBceJSwzOkFIT1ZdZGtyeYCHjpWco6qxuL/GzdQ=';

async function keys(current: string | undefined = CURRENT, previous?: string): Promise<DataKeys> {
  const loaded = await loadDataKeys(current, previous, OTHERS);
  if (loaded === undefined) {
    throw new Error('the keys did not load');
  }
  return loaded;
}

const rejects = (promise: Promise<unknown>): Promise<boolean> =>
  promise.then(
    () => false,
    () => true
  );

describe('which DATA_KEY values are accepted', () => {
  it('takes base64 of exactly 32 bytes, in the padded spelling openssl prints', async () => {
    expect(await loadDataKeys(CURRENT, undefined, OTHERS)).toBeDefined();
    expect(await loadDataKeys(`  ${CURRENT}\n`, undefined, OTHERS)).toBeDefined();
    expect(await loadDataKeys(URL_SAFE, undefined, OTHERS)).toBeDefined();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a placeholder', 'generate-with-openssl-rand-base64-32'],
    ['31 bytes', btoa('x'.repeat(31))],
    ['33 bytes', btoa('0123456789abcdef0123456789abcdefg')],
    ['all zero bytes', btoa(String.fromCodePoint(...new Uint8Array(32)))],
    ['one repeated byte', btoa('A'.repeat(32))],
    ['unpadded', CURRENT.replace('=', '')],
    ['base64url instead of base64', URL_SAFE.replaceAll('+', '-').replaceAll('/', '_')]
  ])('refuses %s', async (_name, value) => {
    expect(await loadDataKeys(value, undefined, OTHERS)).toBeUndefined();
  });

  it('refuses a DATA_KEY that equals JWT_SECRET or the setup key (one leaked secret must not open the other data)', async () => {
    expect(await loadDataKeys(CURRENT, undefined, [CURRENT])).toBeUndefined();
    expect(await loadDataKeys(CURRENT, undefined, [undefined, `${CURRENT} `])).toBeUndefined();
  });

  it('ignores a DATA_KEY_PREVIOUS that is another secret of the deployment', async () => {
    const asPrevious = await loadDataKeys(CURRENT, PREVIOUS, [PREVIOUS]);
    expect(asPrevious).toBeDefined();
    expect(asPrevious?.previous).toBeUndefined();
  });

  it('ignores a malformed or repeated DATA_KEY_PREVIOUS instead of failing the deployment', async () => {
    expect((await keys(CURRENT, 'not a key')).previous).toBeUndefined();
    expect((await keys(CURRENT, CURRENT)).previous).toBeUndefined();
    expect((await keys(CURRENT, PREVIOUS)).previous).toBeDefined();
  });
});

describe('sealing and opening', () => {
  it('round-trips, binds the purpose and the context, and says nothing about why a value does not open', async () => {
    const current = await keys();
    const sealed = await sealData(current, 'totp', 'user-1', utf8('secret bytes'));
    expect(new TextDecoder().decode(await openData(current, 'totp', 'user-1', sealed))).toBe('secret bytes');
    expect(await rejects(openData(current, 'totp', 'user-2', sealed))).toBe(true);
    expect(await rejects(openData(current, 'pendingCek', 'user-1', sealed))).toBe(true);
    expect(await rejects(openData(await keys(PREVIOUS), 'totp', 'user-1', sealed))).toBe(true);
    for (let index = 0; index < sealed.length; index += 1) {
      const damaged = new Uint8Array(sealed);
      damaged[index] ^= 1;
      expect(await rejects(openData(current, 'totp', 'user-1', damaged)), `byte ${index}`).toBe(true);
    }
    expect(await rejects(openData(current, 'totp', 'user-1', sealed.slice(0, 20)))).toBe(true);
  });

  it('starts every value with a version and a kid (4 bytes) that is not a hash of the key, and uses a fresh IV each time', async () => {
    const current = await keys();
    const first = await sealData(current, 'vapid', 'x', utf8('a'));
    const second = await sealData(current, 'vapid', 'x', utf8('a'));
    expect(first[0]).toBe(1);
    expect(first.slice(1, 5)).toEqual(second.slice(1, 5));
    expect(first.slice(5, 17)).not.toEqual(second.slice(5, 17));
    const plainHash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        Uint8Array.from(atob(CURRENT), (char) => char.codePointAt(0) ?? 0)
      )
    );
    expect(first.slice(1, 5)).not.toEqual(plainHash.slice(0, 4));
    expect(isCurrent(current, first)).toBe(true);
  });

  it('keeps old values readable during a rotation: the previous key opens them, only the current key seals', async () => {
    const before = await keys(PREVIOUS);
    const sealedBefore = await sealData(before, 'pendingCek', 'row-1', utf8('cek'));
    const rotating = await keys(CURRENT, PREVIOUS);
    expect(new TextDecoder().decode(await openData(rotating, 'pendingCek', 'row-1', sealedBefore))).toBe('cek');
    expect(isCurrent(rotating, sealedBefore)).toBe(false);
    const sealedNow = await sealData(rotating, 'pendingCek', 'row-1', utf8('cek'));
    expect(isCurrent(rotating, sealedNow)).toBe(true);
    // After the previous key is dropped the old value is gone, the new one is not
    expect(await rejects(openData(await keys(), 'pendingCek', 'row-1', sealedBefore))).toBe(true);
    expect(new TextDecoder().decode(await openData(await keys(), 'pendingCek', 'row-1', sealedNow))).toBe('cek');
  });
});

describe('MACs', () => {
  it('are separated by purpose, by message and by key, and a rotation also offers the previous key MAC for lookups', async () => {
    const current = await keys();
    const a = await dataMacs(current, 'recoveryCode', 'user\0CODE');
    expect((await dataMacs(current, 'recoveryCode', 'user\0CODE')).current).toBe(a.current);
    expect((await dataMacs(current, 'audit', 'user\0CODE')).current).not.toBe(a.current);
    expect((await dataMacs(current, 'forgotTicket', 'user\0CODE')).current).not.toBe(a.current);
    expect((await dataMacs(current, 'recoveryCode', 'user2\0CODE')).current).not.toBe(a.current);
    expect((await dataMacs(await keys(PREVIOUS), 'recoveryCode', 'user\0CODE')).current).not.toBe(a.current);
    const rotating = await dataMacs(await keys(CURRENT, PREVIOUS), 'recoveryCode', 'user\0CODE');
    expect(rotating.all).toHaveLength(2);
    expect(rotating.all[0]).toBe(a.current);
  });
});

// The Web Push key of the single-user version (read once at an upgrade, then sealed under DATA_KEY): AES-GCM under HKDF(JWT_SECRET, salt, info), IV in front.
async function sealLikeTheSingleUserVersion(
  secret: string,
  publicKey: string,
  plain: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8('edging-mail'), info: utf8('vapid private key v1') },
    material,
    256
  );
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(publicKey) }, key, plain));
  return Uint8Array.from([...iv, ...sealed]);
}

const newSigningPair = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const openAsSigningKey = (jwk: JsonWebKey) => crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

describe('the legacy Web Push key (openLegacyVapidKey)', () => {
  const SECRET = 'a-jwt-secret-of-the-old-install-0123456789';
  const PUBLIC = 'BPublicKeyOfTheDevicesAsText';
  const PRIVATE = utf8('private-half-of-the-pair');

  it('opens a key sealed the old way, with the same secret and public key', async () => {
    const sealed = await sealLikeTheSingleUserVersion(SECRET, PUBLIC, PRIVATE);
    expect(await openLegacyVapidKey(SECRET, PUBLIC, sealed)).toEqual(PRIVATE);
  });

  it('answers undefined for another secret, another public key, a cut or flipped value, and a value of the current format', async () => {
    const sealed = await sealLikeTheSingleUserVersion(SECRET, PUBLIC, PRIVATE);
    expect(await openLegacyVapidKey(`${SECRET}-other`, PUBLIC, sealed)).toBeUndefined();
    expect(await openLegacyVapidKey(SECRET, `${PUBLIC}x`, sealed)).toBeUndefined();
    expect(await openLegacyVapidKey(SECRET, PUBLIC, sealed.slice(0, -1))).toBeUndefined();
    expect(await openLegacyVapidKey(SECRET, PUBLIC, sealed.slice(0, 5))).toBeUndefined();
    const flipped = Uint8Array.from(sealed);
    flipped[20] ^= 1;
    expect(await openLegacyVapidKey(SECRET, PUBLIC, flipped)).toBeUndefined();
    const current = await sealData(await keys(), 'vapid', PUBLIC, PRIVATE);
    expect(await openLegacyVapidKey(SECRET, PUBLIC, current)).toBeUndefined();
  });

  it('refuses an empty secret itself: a value sealed under the empty secret would open, so the primitive does not try (LG-1)', async () => {
    const sealedUnderEmpty = await sealLikeTheSingleUserVersion('', PUBLIC, PRIVATE);
    expect(await openLegacyVapidKey('', PUBLIC, sealedUnderEmpty)).toBeUndefined();
    // and the refusal is about the empty secret only: the same blob is still not opened by a real one
    expect(await openLegacyVapidKey(SECRET, PUBLIC, sealedUnderEmpty)).toBeUndefined();
  });

  it("relies on the runtime to refuse a key whose private scalar is not its public key's: the check before a legacy pair is sealed again (LG-5)", async () => {
    const [one, other] = await Promise.all([newSigningPair(), newSigningPair()]);
    const [mine, theirs] = await Promise.all([
      crypto.subtle.exportKey('jwk', one.privateKey),
      crypto.subtle.exportKey('jwk', other.privateKey)
    ]);
    await expect(openAsSigningKey(mine)).resolves.toBeDefined();
    await expect(openAsSigningKey({ ...mine, d: theirs.d })).rejects.toMatchObject({ name: 'DataError' });
  });
});
