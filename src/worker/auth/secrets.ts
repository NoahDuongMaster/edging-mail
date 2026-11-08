import { loadDataKeys } from '../../shared/crypto/server';
import type { DataKeys } from '../../shared/crypto/server';
import type { Env } from '../types';
import { nonEmpty } from '../utils';
import { signingSecret } from './session';

// The three secrets a deployment needs, and what "not configured" means for each. All fail closed: a missing or malformed secret never
// falls back to something weaker.

// 24 characters (PB-6): the setup key is the only brake on break-glass for a distributed attacker, so it must be generated, not chosen
// (`openssl rand -base64 24`).
const MIN_SETUP_KEY_LENGTH = 24;

// APP_PASSWORD, now only the setup key. Missing or short = Setup and recovery are off.
export const setupKeyOf = (env: Env): string | undefined => {
  const key = nonEmpty(env.APP_PASSWORD);
  return key !== undefined && key.length >= MIN_SETUP_KEY_LENGTH ? key : undefined;
};

const loaded = new Map<string, Promise<DataKeys | undefined>>();
const warned = new Set<string>();

/** DATA_KEY (and DATA_KEY_PREVIOUS during a rotation), or undefined when it is missing, malformed, or equal to JWT_SECRET or APP_PASSWORD. */
export function dataKeysOf(env: Env): Promise<DataKeys | undefined> {
  const id = [env.DATA_KEY, env.DATA_KEY_PREVIOUS, env.JWT_SECRET, env.APP_PASSWORD].map((value) => value ?? '').join('\0');
  let keys = loaded.get(id);
  if (keys === undefined) {
    keys = loadDataKeys(env.DATA_KEY, env.DATA_KEY_PREVIOUS, [env.JWT_SECRET, env.APP_PASSWORD]);
    loaded.clear();
    loaded.set(id, keys);
  }
  return keys;
}

/** The NAMES of the secrets that are missing or unusable (never a value), in the order they appear in the docs. Logs each once per isolate. */
export async function missingSecrets(env: Env): Promise<string[]> {
  const missing: string[] = [];
  if (signingSecret(env) === undefined) {
    missing.push('JWT_SECRET');
  }
  if (setupKeyOf(env) === undefined) {
    missing.push('APP_PASSWORD');
  }
  if ((await dataKeysOf(env)) === undefined) {
    missing.push('DATA_KEY');
  }
  for (const name of missing) {
    if (!warned.has(name)) {
      warned.add(name);
      console.error(
        `[edging-mail] The ${name} secret is missing or unusable: see docs/configuration.md. Related requests are refused until it is set.`
      );
    }
  }
  return missing;
}

/** Sign-in needs JWT_SECRET and DATA_KEY; Setup and recovery need APP_PASSWORD as well. */
export async function signInConfigured(env: Env): Promise<boolean> {
  const missing = await missingSecrets(env);
  return !missing.some((name) => name !== 'APP_PASSWORD');
}

export const NOT_CONFIGURED = 'Server is not configured';
