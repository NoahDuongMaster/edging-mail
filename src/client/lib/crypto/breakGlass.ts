import { deriveCredentials } from '../../../shared/crypto/client';
import { apiPost } from '../api';
import { breakGlassBody } from './requests';
import type { RecoveryKeyDraft } from './recoveryDraft';

/**
 * Break-glass for an ADMIN who lost both the password and the recovery key (crypto-design.md 15.7): whoever holds the deployment's setup key
 * restores the admin's console access with a NEW password, a NEW key pair and a NEW recovery key, all made here in the browser. The old key is
 * retired by the server; mail sealed to it stays locked. Two-factor sign-in is never cleared. The new recovery key was shown and confirmed
 * before this call.
 */
export async function breakGlass(setupKey: string, email: string, newPassword: string, draft: RecoveryKeyDraft): Promise<void> {
  const address = email.trim().toLowerCase();
  const { auth, wrapKey } = await deriveCredentials(newPassword, address);
  const keySet = await draft.keySet(wrapKey, address);
  await apiPost('/api/auth/recover', breakGlassBody(setupKey, address, auth, keySet.upload), 'fail.break_glass');
}
