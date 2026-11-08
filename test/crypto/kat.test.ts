import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { describe, expect, it } from 'vitest';
import * as client from '../../src/shared/crypto/client';
import { hpkeOpen } from '../../src/shared/crypto/hpke-open';
import * as server from '../../src/shared/crypto/server';
import cfrg from './cfrg-p256.json';
import V from './vectors.json';
import W from './vectors-v4.json';
import { deriveKeyMaterial } from '../../src/shared/crypto/kdf';

// Known-answer tests KAT-1..5 of crypto-review.md section 6, against the reviewer's vectors (test/crypto/vectors.json) and the CFRG HPKE
// vector (test/crypto/cfrg-p256.json), run on the Workers runtime. Browser engines run the same file: `npm run kat:browser` (docs/development.md).

type Bytes = Uint8Array<ArrayBuffer>;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const unhex = (text: string): Bytes => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const { concat: join } = server;

/** A key pair from a vector's scalar and public point; the private half is NON-extractable, as unwrapKey(extractable=false) gives. */
async function keyPairOf(scalarHex: string, rawPublicHex: string): Promise<CryptoKeyPair> {
  const point = unhex(rawPublicHex);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: server.toBase64Url(unhex(scalarHex)),
      x: server.toBase64Url(point.slice(1, 33)),
      y: server.toBase64Url(point.slice(33)),
      ext: false
    },
    P256,
    false,
    ['deriveBits']
  );
  return { privateKey, publicKey: await crypto.subtle.importKey('raw', point, P256, true, []) };
}

const rejects = async (promise: Promise<unknown>): Promise<boolean> =>
  promise.then(
    () => false,
    () => true
  );

describe('KAT-1: HPKE', () => {
  const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

  it('the pinned library reproduces the CFRG vector (mode 0, kem 16, kdf 1, aead 2)', async () => {
    const recipient = await suite.kem.deriveKeyPair(unhex(cfrg.ikmR).buffer);
    expect(hex(new Uint8Array(await suite.kem.serializePublicKey(recipient.publicKey)))).toBe(cfrg.pkRm);
    const sender = await suite.createSenderContext({
      recipientPublicKey: recipient.publicKey,
      info: unhex(cfrg.info),
      ekm: unhex(cfrg.ikmE)
    });
    expect(hex(new Uint8Array(sender.enc))).toBe(cfrg.enc);
    for (const item of cfrg.encryptions) {
      expect(hex(new Uint8Array(await sender.seal(unhex(item.pt), unhex(item.aad))))).toBe(item.ct);
    }
    // ...and opens them with a NON-extractable private key (SPIKE-1).
    const receiver = await suite.createRecipientContext({
      recipientKey: await keyPairOf(cfrg.skRm, cfrg.pkRm),
      enc: unhex(cfrg.enc),
      info: unhex(cfrg.info)
    });
    for (const item of cfrg.encryptions) {
      expect(hex(new Uint8Array(await receiver.open(unhex(item.ct), unhex(item.aad))))).toBe(item.pt);
    }
  });

  it('opens the three hpke_* vectors through the production open path with a non-extractable key', async () => {
    const userKey = await keyPairOf(V.user_key.scalar, V.user_key.raw_pub);
    // The names `org_key`, `hpke_user_escrow_to_org` and `hpke_org_key_custodian_copy_for_admin_alice` come from cyber's v3 vector file, kept verbatim;
    // here they are only a second recipient key and two more HPKE inputs for the same open path.
    const secondKey = await keyPairOf(V.org_key.scalar, V.org_key.raw_pub);
    expect(userKey.privateKey.extractable).toBe(false);
    const cases = [
      [V.hpke_wrapped_cek, userKey],
      [V.hpke_user_escrow_to_org, secondKey],
      [V.hpke_org_key_custodian_copy_for_admin_alice, userKey]
    ] as const;
    for (const [vector, key] of cases) {
      const opened = await hpkeOpen(key, unhex(vector.enc_hex), server.utf8(vector.info), unhex(vector.aad_hex), unhex(vector.ct_hex));
      expect(hex(opened), vector.info).toBe(vector.plaintext_hex);
    }
  });

  it('opens a wrapped CEK vector through unwrapCek, and the header must name the key', async () => {
    const vector = V.hpke_wrapped_cek;
    const [rowId, keyId] = text(unhex(vector.aad_hex)).split('\0');
    const key = await keyPairOf(V.user_key.scalar, V.user_key.raw_pub);
    expect(hex(await client.unwrapCek(unhex(vector.wrapped_cek_hex), rowId, keyId, key))).toBe(vector.plaintext_hex);
    expect(keyId).toBe(V.user_key.key_id);
    expect(await rejects(client.unwrapCek(unhex(vector.wrapped_cek_hex), rowId, V.org_key.key_id, key))).toBe(true);
  });

  it('fails on a flipped AAD byte, wrong info, wrong key id, wrong row id, a truncated or off-curve enc, a wrong-length enc', async () => {
    const vector = V.hpke_wrapped_cek;
    const key = await keyPairOf(V.user_key.scalar, V.user_key.raw_pub);
    const [rowId, keyId] = text(unhex(vector.aad_hex)).split('\0');
    const enc = unhex(vector.enc_hex);
    const ct = unhex(vector.ct_hex);
    const info = server.utf8(vector.info);
    const aad = unhex(vector.aad_hex);
    const open = (overrides: { enc?: Bytes; info?: Bytes; aad?: Bytes }) =>
      hpkeOpen(key, overrides.enc ?? enc, overrides.info ?? info, overrides.aad ?? aad, ct);
    const flipped = new Uint8Array(aad);
    flipped[0] ^= 1;
    const offCurve = new Uint8Array(enc);
    offCurve[64] ^= 1;
    expect(hex(await open({}))).toBe(vector.plaintext_hex);
    for (const [name, change] of Object.entries({
      'flipped AAD': { aad: flipped },
      'wrong info': { info: server.utf8('edging-mail/v1/other') },
      'wrong key id': { aad: server.cekAad(rowId, V.org_key.key_id) },
      'wrong row id': { aad: server.cekAad('00000000-0000-4000-8000-0000000000ff', keyId) },
      'truncated enc': { enc: enc.slice(0, 64) },
      'point not on the curve': { enc: offCurve },
      'enc of the wrong length': { enc: join(enc, Uint8Array.of(0)) }
    })) {
      expect(await rejects(open(change)), name).toBe(true);
    }
  });

  it('seals with a fresh ephemeral key every time and round-trips through unwrapCek', async () => {
    const { privateKey, publicKey } = await client.generateUserKeyPair();
    const cek = server.newCek();
    const rowId = crypto.randomUUID();
    const first = await server.sealCek(cek, rowId, publicKey);
    const second = await server.sealCek(cek, rowId, publicKey);
    expect(first).toHaveLength(131);
    expect(hex(first)).not.toBe(hex(second));
    // The unwrapped, non-extractable key is what the browser works with.
    const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
      'wrapKey',
      'unwrapKey'
    ]);
    const blob = await client.wrapPrivateKey(wrapKey, privateKey, 'alice@example.com', publicKey.keyId);
    const everyday = await client.unwrapPrivateKey(wrapKey, blob, 'alice@example.com', publicKey.keyId);
    for (const wrapped of [first, second]) {
      expect(hex(await client.unwrapCek(wrapped, rowId, publicKey.keyId, { privateKey: everyday, publicKey: publicKey.key }))).toBe(
        hex(cek)
      );
    }
  });

  it('opens for keys of both y parities (the library must be given the pair, never the private key alone)', async () => {
    const parities = new Set<number>();
    for (let count = 0; count < 24; count += 1) {
      const { privateKey, publicKey } = await client.generateUserKeyPair();
      parities.add(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey.key))[64] & 1);
      const wrapKey = await crypto.subtle.importKey('raw', server.newCek(), 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
      const everyday = await client.unwrapPrivateKey(
        wrapKey,
        await client.wrapPrivateKey(wrapKey, privateKey, 'alice@example.com', publicKey.keyId),
        'alice@example.com',
        publicKey.keyId
      );
      const cek = server.newCek();
      const rowId = crypto.randomUUID();
      const wrapped = await server.sealCek(cek, rowId, publicKey);
      expect(hex(await client.unwrapCek(wrapped, rowId, publicKey.keyId, { privateKey: everyday, publicKey: publicKey.key }))).toBe(
        hex(cek)
      );
    }
    expect([...parities].toSorted((a, b) => a - b)).toEqual([0, 1]);
  }, 60_000);

  it('refuses a wrapped CEK with an unknown version or suite byte (the reserved auth-mode suite included) or the wrong length', () => {
    const good = new Uint8Array(131);
    good[0] = 1;
    good[1] = 1;
    expect(() => server.parseWrappedCek(good)).not.toThrow();
    for (const [index, value] of [
      [0, 2],
      [0, 0],
      [1, 2],
      [1, 0]
    ] as const) {
      const bad = new Uint8Array(good);
      bad[index] = value;
      expect(() => server.parseWrappedCek(bad), `byte ${index} = ${value}`).toThrow();
    }
    expect(() => server.parseWrappedCek(good.slice(0, 130))).toThrow();
    expect(() => server.parseWrappedCek(join(good, Uint8Array.of(0)))).toThrow();
  });
});

describe('KAT-2: password KDF', () => {
  it('reproduces K1, K2 and the decomposed K2 (salt, mk, auth, wk)', async () => {
    for (const vector of [V.kdf.K1, V.kdf.K2_composed, V.kdf.K2_decomposed_must_equal_K2_composed]) {
      const material = await deriveKeyMaterial(vector.password, 'address_input' in vector ? vector.address_input : vector.address);
      expect(hex(material.salt)).toBe(vector.salt);
      expect(hex(material.mk)).toBe(vector.mk);
      expect(hex(material.auth)).toBe(vector.auth_hex);
      expect(server.toBase64Url(material.auth)).toBe(vector.auth_b64url);
      expect(hex(material.wk)).toBe(vector.wk);
    }
    expect(V.kdf.K2_decomposed_must_equal_K2_composed.auth_hex).toBe(V.kdf.K2_composed.auth_hex);
  }, 120_000);

  it('hands the browser the credential and a non-extractable wrap key', async () => {
    const { auth, wrapKey } = await client.deriveCredentials(V.kdf.K1.password, V.kdf.K1.address_input);
    expect(auth).toBe(V.kdf.K1.auth_b64url);
    expect(wrapKey.extractable).toBe(false);
    expect(server.isAuthValue(auth)).toBe(true);
  }, 60_000);

  it('gives one salt to every spelling of the primary address, and refuses what is not one before the KDF', async () => {
    const reference = hex(await client.kdfSalt('alice@example.com'));
    for (const spelling of ['Alice@Example.com', '  alice@example.com\n', 'ALICE@EXAMPLE.COM ']) {
      expect(hex(await client.kdfSalt(spelling)), spelling).toBe(reference);
    }
    for (const bad of ['', 'alice', 'alice@', '@example.com', 'a@b@c', 'alicé@example.com', 'ａlice@example.com', 'a b@example.com']) {
      expect(await rejects(client.kdfSalt(bad)), bad).toBe(true);
    }
  });

  it('counts the password rule in code points after NFKC (12..256)', () => {
    expect(client.isAcceptablePassword('a'.repeat(11))).toBe(false);
    expect(client.isAcceptablePassword('a'.repeat(12))).toBe(true);
    expect(client.isAcceptablePassword('a'.repeat(256))).toBe(true);
    expect(client.isAcceptablePassword('a'.repeat(257))).toBe(false);
    // 12 code points, though 24 UTF-16 units
    expect(client.isAcceptablePassword('😀'.repeat(12))).toBe(true);
    // Fullwidth forms fold to one code point each under NFKC; a ligature expands to three, so 4 + 3 + 5 = 12
    expect(client.isAcceptablePassword('ＡＢＣＤﬃ12345')).toBe(true);
    expect(client.isAcceptablePassword('ＡＢＣＤ12345')).toBe(false);
  });
});

describe('KAT-3: private-key wraps', () => {
  const address = V.kdf.K1.address_input;
  const wrapKey = () => crypto.subtle.importKey('raw', unhex(V.kdf.K1.wk), 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
  const blob = unhex(V.wrapped_private_key_pw.blob_hex);

  it('opens wrapped_private_key_pw and the recovery blob; the everyday key cannot be exported', async () => {
    const key = await client.unwrapPrivateKey(await wrapKey(), blob, 'alice@example.com', V.user_key.key_id);
    expect(key.extractable).toBe(false);
    expect(await rejects(crypto.subtle.exportKey('pkcs8', key))).toBe(true);
    // password change unwraps a SECOND, short-lived extractable copy: its public point is the vector's
    const extractable = await client.unwrapPrivateKey(await wrapKey(), blob, 'alice@example.com', V.user_key.key_id, true);
    const jwk = await crypto.subtle.exportKey('jwk', extractable);
    expect(hex(join(Uint8Array.of(4), server.fromBase64Url(jwk.x ?? ''), server.fromBase64Url(jwk.y ?? '')))).toBe(V.user_key.raw_pub);
    const recoveryKey = unhex(V.recovery_key.rk_hex);
    const recovered = await client.unwrapPrivateKey(
      await client.recoveryWrapKey(recoveryKey),
      unhex(V.recovery_key.wrapped_private_key_recovery_blob_hex),
      'alice@example.com',
      V.user_key.key_id
    );
    expect(recovered.extractable).toBe(false);
    expect(address.trim().toLowerCase()).toBe('alice@example.com');
  });

  it('fails for another address, another key id, a wrong version byte, a truncated blob and EVERY single flipped byte', async () => {
    const key = await wrapKey();
    const attempt = (data: Uint8Array, who = 'alice@example.com', keyId: string = V.user_key.key_id) =>
      client.unwrapPrivateKey(key, data, who, keyId);
    expect(await rejects(attempt(blob, 'bob@example.com'))).toBe(true);
    expect(await rejects(attempt(blob, 'alice@example.com', V.org_key.key_id))).toBe(true);
    const wrongVersion = blob.slice();
    wrongVersion[0] = 2;
    expect(await rejects(attempt(wrongVersion))).toBe(true);
    expect(await rejects(attempt(blob.slice(0, -1)))).toBe(true);
    expect(await rejects(attempt(blob.slice(0, 20)))).toBe(true);
    for (let index = 0; index < blob.length; index += 1) {
      const damaged = blob.slice();
      damaged[index] ^= 0x80;
      expect(await rejects(attempt(damaged)), `byte ${index}`).toBe(true);
    }
  });

  it('wraps a fresh key pair under the password key and the recovery key, and both open it', async () => {
    const { privateKey, publicKey } = await client.generateUserKeyPair();
    const recoveryKey = client.generateRecoveryKey();
    for (const key of [await wrapKey(), await client.recoveryWrapKey(recoveryKey)]) {
      const wrapped = await client.wrapPrivateKey(key, privateKey, 'alice@example.com', publicKey.keyId);
      const opened = await client.unwrapPrivateKey(key, wrapped, 'alice@example.com', publicKey.keyId);
      const cek = server.newCek();
      const rowId = crypto.randomUUID();
      expect(
        hex(
          await client.unwrapCek(await server.sealCek(cek, rowId, publicKey), rowId, publicKey.keyId, {
            privateKey: opened,
            publicKey: publicKey.key
          })
        )
      ).toBe(hex(cek));
    }
  });
});

describe('KAT-4: EM1 envelope', () => {
  const E = V.em1_summary;

  it('opens the summary vector; a wrong row id, a wrong purpose, a wrong version and any flipped byte fail', async () => {
    const blob = unhex(E.blob_hex);
    const cek = unhex(E.cek_hex);
    expect(text(await client.openField(cek, 'summary', E.row_id, blob))).toBe(E.plaintext);
    expect(await rejects(client.openField(cek, 'summary', '00000000-0000-4000-8000-000000000002', blob))).toBe(true);
    expect(await rejects(client.openField(cek, 'body', E.row_id, blob))).toBe(true);
    const wrongVersion = blob.slice();
    wrongVersion[0] = 2;
    expect(await rejects(client.openField(cek, 'summary', E.row_id, wrongVersion))).toBe(true);
    for (let index = 0; index < blob.length; index += 1) {
      const damaged = blob.slice();
      damaged[index] ^= 1;
      expect(await rejects(client.openField(cek, 'summary', E.row_id, damaged)), `byte ${index}`).toBe(true);
    }
  });

  it('round-trips every kind of purpose and refuses an unknown one or a row id that is not a lower-case UUID', async () => {
    const cek = server.newCek();
    const rowId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    for (const purpose of ['summary', 'body', 'raw', `att-meta/${attachmentId}`, `att/${attachmentId}`]) {
      const sealed = await server.sealField(cek, purpose, rowId, server.utf8(`secret for ${purpose}`));
      expect(text(await client.openField(cek, purpose, rowId, sealed))).toBe(`secret for ${purpose}`);
      // a blob is bound to its purpose and its row
      expect(await rejects(client.openField(cek, purpose === 'raw' ? 'body' : 'raw', rowId, sealed))).toBe(true);
      expect(await rejects(client.openField(cek, purpose, crypto.randomUUID(), sealed))).toBe(true);
    }
    for (const purpose of ['subject', 'att/not-a-uuid', 'att-meta/', 'summary/extra', '']) {
      expect(await rejects(server.sealField(cek, purpose, rowId, server.utf8('x'))), purpose).toBe(true);
    }
    expect(await rejects(server.sealField(cek, 'summary', rowId.toUpperCase(), server.utf8('x')))).toBe(true);
  });

  it('never reuses a CEK or an IV', async () => {
    const ceks = new Set(Array.from({ length: 10_000 }, () => hex(server.newCek())));
    expect(ceks.size).toBe(10_000);
    const key = await crypto.subtle.importKey('raw', server.newCek(), 'AES-GCM', false, ['encrypt']);
    const aad = server.utf8('x');
    const ivs = new Set<string>();
    for (let count = 0; count < 100_000; count += 1) {
      ivs.add(hex((await server.sealBlob(key, aad, Uint8Array.of(count & 255))).slice(1, 13)));
    }
    expect(ivs.size).toBe(100_000);
  }, 120_000);
});

describe('KAT-5 (v4): recovery-key codec, rwk and rauth', () => {
  const keys = Object.values(W.keys);

  it('encodes each vector key as 54 symbols in 9 groups of 6, with the reviewer check symbols', async () => {
    for (const key of keys) {
      expect(await client.encodeRecoveryKey(unhex(key.rk_hex))).toBe(key.grouped_9x6);
      expect(key.text54).toBe(key.symbols52 + key.check2);
    }
  });

  it('decodes every case of the vector file to the expected key or the expected problem', async () => {
    for (const item of W.decoder_cases) {
      if (item.expect === 'ok') {
        expect(hex(await client.decodeRecoveryKey(item.input)), item.name).toBe(item.rk_hex);
      } else {
        const failure = await client.decodeRecoveryKey(item.input).then(
          () => 'no failure',
          (error: unknown) => error
        );
        expect(failure, item.name).toBeInstanceOf(client.RecoveryKeyError);
        expect((failure as InstanceType<typeof client.RecoveryKeyError>).reason, item.name).toBe(item.expect);
      }
    }
  });

  it('derives rwk and rauth from one key as independent outputs, and rauth in base64url', async () => {
    for (const key of keys) {
      const rk = unhex(key.rk_hex);
      const rauth = await client.deriveRecoveryAuth(rk);
      expect(hex(rauth.raw)).toBe(key.rauth_hex);
      expect(rauth.text).toBe(key.rauth_b64url);
      expect(hex(await server.hkdf(rk, server.utf8(server.LABEL.recoveryWrap), 32))).toBe(key.rwk_hex);
      expect(key.rwk_hex).not.toBe(key.rauth_hex);
    }
  });

  it('round-trips 1000 random keys and shows them as 9 groups of 6', async () => {
    for (let count = 0; count < 1000; count += 1) {
      const key = client.generateRecoveryKey();
      const written = await client.encodeRecoveryKey(key);
      expect(written).toMatch(/^(?:[\dA-HJKMNP-TV-Z]{6}-){8}[\dA-HJKMNP-TV-Z]{6}$/);
      expect(hex(await client.decodeRecoveryKey(written))).toBe(hex(key));
    }
  });

  it('never decodes a single-symbol substitution or an adjacent transposition to the key it was made from', async () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const key = unhex(keys[0].rk_hex);
    const good = (await client.encodeRecoveryKey(key)).replaceAll('-', '');
    const outcomes = new Set<string>();
    const decode = async (candidate: string): Promise<string> =>
      client.decodeRecoveryKey(candidate).then(
        (decoded) => (hex(decoded) === hex(key) ? 'same' : 'other'),
        (error: unknown) => (error instanceof client.RecoveryKeyError ? 'refused' : 'crash')
      );
    for (let index = 0; index < good.length; index += 1) {
      for (const symbol of alphabet) {
        if (symbol !== good[index]) {
          outcomes.add(await decode(good.slice(0, index) + symbol + good.slice(index + 1)));
        }
      }
      if (index > 0 && good[index] !== good[index - 1]) {
        outcomes.add(await decode(good.slice(0, index - 1) + good[index] + good[index - 1] + good.slice(index + 1)));
      }
    }
    // Refused almost always; the rare miss decodes to a DIFFERENT key (never to the same one), and nothing throws another way.
    expect(outcomes.has('same')).toBe(false);
    expect(outcomes.has('crash')).toBe(false);
    expect(outcomes.has('refused')).toBe(true);
  }, 60_000);

  it('draws 3 distinct, non-adjacent groups out of 9 (35 possible sets, all reachable), and compares after normalising', () => {
    const seen = new Set<string>();
    for (let count = 0; count < 4000; count += 1) {
      const groups = client.drawConfirmationGroups();
      expect(groups[1] - groups[0]).toBeGreaterThanOrEqual(2);
      expect(groups[2] - groups[1]).toBeGreaterThanOrEqual(2);
      expect(groups[0]).toBeGreaterThanOrEqual(0);
      expect(groups[2]).toBeLessThanOrEqual(8);
      seen.add(groups.join(','));
    }
    expect(W.typed_confirmation.triples_count).toBe(35);
    expect(seen.size).toBe(35);
    const shown = keys[0].grouped_9x6;
    const parts = shown.split('-');
    expect(client.confirmationMatches(shown, [0, 2, 8], [parts[0], parts[2].toLowerCase(), ` ${parts[8]} `])).toBe(true);
    expect(client.confirmationMatches(shown, [0, 2, 8], [parts[0], parts[3], parts[8]])).toBe(false);
    expect(client.confirmationMatches(shown, [0, 2], [parts[0]])).toBe(false);
    expect(client.confirmationMatches(shown, [0], [parts[0].slice(0, 5)])).toBe(false);
  });
});

describe('KAT-7 (v4): the recovery verifier is the same function over the RAW rauth', () => {
  it('matches the reviewer vector, refuses the string-form value, and keeps the row hygiene', async () => {
    const vector = W.recovery_verifier;
    const rauth = unhex(W.keys.R1_00_1f.rauth_hex);
    const salt = unhex(vector.salt16_hex);
    const stored = {
      verifier: server.toBase64Url(unhex(vector.verifier_of_RAW_rauth_hex)),
      salt: server.toBase64Url(salt),
      iterations: vector.iterations
    };
    expect(vector.iterations).toBe(server.PBKDF2_VERIFIER_ITERATIONS);
    expect(await server.verifySecret(rauth, stored)).toBe(true);
    expect(
      await server.verifySecret(rauth, { ...stored, verifier: server.toBase64Url(unhex(vector.WRONG_if_utf8_of_base64url_string_hex)) })
    ).toBe(false);
    expect(await server.verifySecret(new Uint8Array(32), stored)).toBe(false);
    expect(await server.verifySecret(rauth, { ...stored, iterations: 0 })).toBe(false);
    expect(await server.verifySecret(rauth, { ...stored, iterations: server.PBKDF2_VERIFIER_ITERATIONS + 1 })).toBe(false);
    expect(await server.verifySecret(rauth.slice(1), stored)).toBe(false);
    const fresh = await server.createSecretVerifier(rauth);
    expect(await server.verifySecret(rauth, fresh)).toBe(true);
    expect(await server.verifySecret(unhex(W.keys.R2_all_ff.rauth_hex), fresh)).toBe(false);
    expect(await server.dummyVerifySecret(rauth)).toBe(false);
  });
});

describe('key set, key-pair check and address rules', () => {
  it('makes a key set whose two wraps open to the same non-extractable key, and sends only the allowed fields', async () => {
    const { wrapKey } = await client.deriveCredentials('correct horse battery staple', 'Alex@Example.com');
    const rk = client.generateRecoveryKey();
    const set = await client.createKeySet(wrapKey, rk, 'alex@example.com');
    expect(Object.keys(set.upload).toSorted()).toEqual([
      'key_id',
      'public_key',
      'recovery_auth',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
    expect(set.upload.recovery_auth).toBe((await client.deriveRecoveryAuth(rk)).text);
    expect(set.pair.privateKey.extractable).toBe(false);
    await expect(client.assertKeyPair(set.pair.privateKey, set.publicKey)).resolves.toBeUndefined();
    // the recovery wrap opens under the recovery key alone, to the same public key
    const viaRecovery = await client.unwrapPrivateKey(
      await client.recoveryWrapKey(rk),
      server.fromBase64Url(set.upload.wrapped_private_key_recovery),
      'alex@example.com',
      set.upload.key_id
    );
    await expect(client.assertKeyPair(viaRecovery, set.publicKey)).resolves.toBeUndefined();
  });

  it('refuses a private key that does not belong to the public key', async () => {
    const one = await client.generateUserKeyPair();
    const other = await client.generateUserKeyPair();
    await expect(client.assertKeyPair(one.privateKey, other.publicKey)).rejects.toThrow();
    await expect(client.assertKeyPair(one.privateKey, one.publicKey)).resolves.toBeUndefined();
  });

  it('accepts only ASCII primary addresses, tested before lower-casing (the Kelvin sign is not a k)', () => {
    expect(client.canonicalAddress('  Alex@Example.COM ')).toBe('alex@example.com');
    for (const bad of ['user@exam\u212Aple.com', 'user@exam\u0130ple.com', 'üser@example.com', 'a@b@c', '@example.com', 'alex@', '']) {
      expect(() => client.canonicalAddress(bad), bad).toThrow();
    }
  });
});
