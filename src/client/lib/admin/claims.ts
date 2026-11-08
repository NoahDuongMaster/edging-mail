import { tr } from '../i18n';

/**
 * The claim about what admins can and cannot do, as its five sentences in the UI language (Product Owner addendum 4.12 and the security
 * review 11.8): what an admin cannot do, the temporary-password exception right next to it, what admins can do, the setup key, and the
 * software-change sentence. Every screen that talks about admins uses this one text, so it cannot drift from the landing page, the README and
 * docs/security.md. Call it where the text is shown (never at module load: the language can change).
 */
export function adminClaim(): string[] {
  return [
    ...adminClaimLimits(),
    tr('security.admin_claim_powers'),
    tr('security.admin_claim_setup_key'),
    tr('security.admin_claim_operator')
  ];
}

/** The first two sentences, which never appear apart: the limit on admins and the exception for an account that has not been signed in to yet. */
export function adminClaimLimits(): string[] {
  return [tr('security.admin_claim_no_access'), tr('security.admin_claim_temp_password')];
}
