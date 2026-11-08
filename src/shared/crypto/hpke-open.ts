import { CryptoFormatError, CryptoOpenError } from './bytes';
import type { Bytes } from './bytes';
import { P256_POINT_BYTES } from './constants';
import { hpkeSuite } from './hpke-seal';

// HPKE OPEN: needs the recipient's PRIVATE key, so this file belongs to the browser entry only. The Worker must never import it
// (test/crypto/static.test.ts and scripts/check-worker-bundle.mjs check that).
// The private key is a NON-extractable CryptoKey (from unwrapKey with extractable=false). The library MUST be given the PAIR
// {privateKey, publicKey}, never the private key alone (SPIKE-1): to find the recipient's public point it cannot export a non-extractable
// key, so it falls back to deriving the point from the ECDH x-coordinate and always picks the EVEN y: wrong for half of all keys, and the
// open then fails with an AEAD error. We always have the public key (the server returns it), so we pass it.

export async function hpkeOpen(recipient: CryptoKeyPair, enc: Bytes, info: Bytes, aad: Bytes, ct: Bytes): Promise<Bytes> {
  if (enc.length !== P256_POINT_BYTES || enc[0] !== 4) {
    throw new CryptoFormatError('Not an uncompressed P-256 point');
  }
  try {
    const context = await hpkeSuite().createRecipientContext({ recipientKey: recipient, enc, info });
    return new Uint8Array(await context.open(ct, aad));
  } catch {
    // Wrong key, wrong context, altered data, or a point that is not on the curve: all the same answer.
    throw new CryptoOpenError();
  }
}
