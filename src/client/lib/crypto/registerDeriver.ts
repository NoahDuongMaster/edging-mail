import { deriveCredentials } from '../../../shared/crypto/client';
import { KDF_VERSION } from '../../../shared/crypto/constants';
import { registerAccountAuthDeriver } from '../credentials';

/**
 * Gives the admin console the one thing it needs from the crypto layer: the `auth` of a NEW account's temporary password, derived in this
 * browser from the account's primary address (the same derivation as a sign-in). The wrap key that comes out with it is not kept.
 */
export function registerCredentialDeriver(): void {
  registerAccountAuthDeriver(async (address, password) => {
    const { auth } = await deriveCredentials(password, address);
    return { auth, kdf: KDF_VERSION };
  });
}
