// The one place the admin console touches the crypto layer. A password never leaves the browser: for a new account the browser turns the
// one-time password into `auth` (crypto-design.md section 3) and sends only that. Phase 2b registers the real implementation, built on the
// browser entry of src/shared/crypto; until then the create dialog says plainly that it cannot create accounts yet instead of sending
// anything.

export interface AccountAuth {
  /** The proof of the password the server stores a verifier of. Never the password. */
  auth: string;
  kdf: 1;
}

export type AccountAuthDeriver = (address: string, password: string) => Promise<AccountAuth>;

export class CredentialsUnavailableError extends Error {
  constructor() {
    // A message for the developer, never shown: the screen that catches this error says it in the catalogue's words.
    super('account auth deriver is not registered');
    this.name = 'CredentialsUnavailableError';
  }
}

let deriver: AccountAuthDeriver | null = null;

/** Called once at start-up by the code that owns the crypto (Phase 2b). */
export function registerAccountAuthDeriver(next: AccountAuthDeriver | null): void {
  deriver = next;
}

/** `auth` for an account that does not exist yet: derived from its primary address and its one-time password, in this browser. */
export function deriveAccountAuth(address: string, password: string): Promise<AccountAuth> {
  return deriver === null ? Promise.reject(new CredentialsUnavailableError()) : deriver(address, password);
}
