// "Keep" on the locked-mail banner means: leave the messages as they are and stop showing the banner for now. The choice lasts as long as this tab
// (sessionStorage), so a shared computer shows the banner again to the next person who signs in, and the banner is back in the next session. What
// is stored is the id of a retired key: a public fingerprint, not a secret. When storage is blocked the banner simply shows again after a reload.

const PREFIX = 'edging-mail-locked-kept:';

/** The part of `sessionStorage` used here; tests pass their own. */
export type KeptStorage = Pick<Storage, 'getItem' | 'setItem'>;

let override: KeptStorage | null | undefined;

/** Tests only: a stand-in for sessionStorage (null: no storage at all; undefined: the real one again). */
export function setKeptStorage(storage: KeptStorage | null | undefined): void {
  override = storage;
}

function storageOf(): KeptStorage | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Did the person choose "Keep" for this retired key in this tab? */
export function lockedMailKept(keyId: string): boolean {
  try {
    return storageOf()?.getItem(PREFIX + keyId) === '1';
  } catch {
    return false;
  }
}

export function keepLockedMail(keyId: string): void {
  try {
    storageOf()?.setItem(PREFIX + keyId, '1');
  } catch {
    // Storage is blocked: the choice lasts until the page reloads (the component remembers it in memory).
  }
}
