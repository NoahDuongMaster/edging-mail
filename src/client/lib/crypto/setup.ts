import { canonicalAddress, CryptoFormatError, deriveCredentials } from '../../../shared/crypto/client';
import { apiPost } from '../api';
import type { GateCode, SessionUser } from '../auth';
import type { MessageKey } from '../i18n';
import { normalizePassword } from '../password/policy';
import { dropGateCredentials, holdGateCredentials } from './gateCredentials';
import { keepKey } from './keyStore';
import type { RecoveryKeyDraft } from './recoveryDraft';
import { setupBody } from './requests';
import type { SetupFields } from './requests';

// First-run Setup (crypto-design.md 15.4): the first admin's setup key, address, name, language and password, and the first key set with
// the mandatory recovery key, in ONE request. The password is turned into `auth` and the wrap key right here and goes no further; the
// setup key is the one secret of this request that is sent as it is (it is what the server compares to its APP_PASSWORD secret).

/** The longest display name the server accepts (src/worker/auth/setup.ts). */
export const DISPLAY_NAME_MAX = 100;

// The address rules of the server (src/worker/addresses.ts), repeated here so a refused address is explained on the form instead of
// coming back as "the request is not valid". The server checks again.
const MAX_LOCAL_PART = 64;
const MAX_HOSTNAME = 253;
const MAX_LABEL = 63;
const LOCAL_PART = /^[\d_a-z-]+(?:\.[\d_a-z-]+)*$/;
const HOST_LABEL = /^[\da-z](?:[\da-z-]*[\da-z])?$/;

function isHostname(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HOSTNAME) {
    return false;
  }
  const labels = value.split('.');
  // At least two labels, and the last (the TLD) is never all digits, which also refuses IPv4 addresses.
  return (
    labels.length >= 2 && labels.every((label) => label.length <= MAX_LABEL && HOST_LABEL.test(label)) && !/^\d+$/.test(labels.at(-1) ?? '')
  );
}

/** The catalogue key of what is wrong with the admin's address, or null when the server and the key derivation both accept it. */
export function addressProblem(input: string): MessageKey | null {
  if (input.trim() === '') {
    return 'setup.err_address_required';
  }
  let address: string;
  try {
    address = canonicalAddress(input);
  } catch (error) {
    if (error instanceof CryptoFormatError) {
      return 'setup.err_address_invalid';
    }
    throw error;
  }
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return local.length > 0 && local.length <= MAX_LOCAL_PART && LOCAL_PART.test(local) && isHostname(domain)
    ? null
    : 'setup.err_address_invalid';
}

/** What is wrong with the form, as catalogue KEYS (the screen translates them). A field that is fine has no entry. */
export interface SetupProblems {
  setupKey?: MessageKey;
  email?: MessageKey;
  displayName?: MessageKey;
  confirm?: MessageKey;
}

/**
 * The checks that need no derivation and no server: a setup key was typed, the address is one the server and the key derivation take, the
 * display name is one line of at most 100 characters (it may be empty), and the two passwords are the same (compared after NFKC, as the
 * key derivation sees them). The password's own strength is judged by `usePasswordCheck`, which needs the loaded word lists.
 */
export function validateSetupFields(fields: SetupFields, password: string, confirm: string): SetupProblems {
  const problems: SetupProblems = {};
  if (fields.setupKey === '') {
    problems.setupKey = 'setup.err_key_required';
  }
  const email = addressProblem(fields.email);
  if (email !== null) {
    problems.email = email;
  }
  // The server trims the name and then refuses a line break or more than 100 characters.
  const name = fields.displayName.trim();
  if (name.length > DISPLAY_NAME_MAX || /[\n\r]/.test(name)) {
    problems.displayName = 'setup.err_name_invalid';
  }
  if (normalizePassword(confirm) !== normalizePassword(password)) {
    problems.confirm = 'gate.passwords_differ';
  }
  return problems;
}

export const hasProblems = (problems: SetupProblems): boolean => Object.keys(problems).length > 0;

interface SetupAnswer {
  /** Null only if the account could not be read back right after it was made. */
  user: SessionUser | null;
  gate?: GateCode | null;
}

/**
 * Creates the first admin: derives the credentials for the address, makes the key set around the new recovery key, posts the request and
 * makes the new key the key in use (kept on this device: Setup is the operator's own). The server answers with a started session; when it
 * names a gate (the admin's two-factor enrolment) the credentials that gate repeats are held, so it does not ask for the password again.
 * Rejects with the API's error (wrong setup key, throttled, ...) and keeps nothing in that case.
 */
export async function completeSetup(
  fields: SetupFields,
  password: string,
  draft: RecoveryKeyDraft
): Promise<{ user: SessionUser; gate: GateCode | null }> {
  const email = canonicalAddress(fields.email);
  const { auth, wrapKey } = await deriveCredentials(password, email);
  const keySet = await draft.keySet(wrapKey, email);
  const answer = await apiPost<SetupAnswer>(
    '/api/auth/setup',
    setupBody({ ...fields, email, displayName: fields.displayName.trim() }, auth, keySet.upload),
    'fail.setup_create'
  );
  if (answer.user === null) {
    throw new Error('setup answered without a user');
  }
  await keepKey(answer.user.id, keySet.pair, keySet.publicKey, { persist: true });
  // After keepKey: it drops the held credentials when it replaces another account's key.
  const gate = answer.gate ?? null;
  if (gate === null) {
    dropGateCredentials();
  } else {
    holdGateCredentials({ email, auth, wrapKey, persist: true });
  }
  return { user: answer.user, gate };
}
