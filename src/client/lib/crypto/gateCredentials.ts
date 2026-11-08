import { onKeysWiped } from './keyStore';

// What a sign-in leaves behind for the steps that follow it BEFORE the mailbox opens: the two-factor step and the gates (choose a password,
// set up keys, enrol two-factor). The password itself is never kept: only what it was turned into, `auth` (the credential the server
// checks, which each gate request has to repeat as `current_auth`) and the non-extractable key that wraps the private key. They live in
// this module, not in React state, and are dropped the moment the last step is done, on sign-out and whenever the keys are wiped.

export interface GateCredentials {
  email: string;
  auth: string;
  wrapKey: CryptoKey;
  /** False when the person ticked "shared device": the key they end up with stays in memory only. */
  persist: boolean;
}

let held: GateCredentials | null = null;

export function holdGateCredentials(credentials: GateCredentials): void {
  held = credentials;
}

export const readGateCredentials = (): GateCredentials | null => held;

export function dropGateCredentials(): void {
  held = null;
}

onKeysWiped(dropGateCredentials);
