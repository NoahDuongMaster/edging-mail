/**
 * Catalogue keys that the source builds at run time instead of writing as a `t('...')` literal. The static test treats every
 * catalogue key that starts with one of these prefixes as used, and every `tDyn()` call must build a key that starts with
 * one. Declare a family here and nowhere else.
 */
export const DYNAMIC_KEY_FAMILIES = [
  /** `err.<code>`: the text of an API error code (the server registry in src/worker/errors.ts lists the codes). */
  'err.',
  /** `audit.action.<code>`: one audit-log action. */
  'audit.action.',
  /** `activity.kind.<kind>`: one kind of sign-in or security notice. */
  'activity.kind.'
] as const;
