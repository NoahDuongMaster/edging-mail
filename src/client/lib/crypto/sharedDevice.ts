// "This is a shared or public device" ends the KEY with the tab, not the session: the cookie lives on, so the next page load of the same tab shows
// the unlock screen. That screen must not offer the personal-device choice by default: unlocking with the box empty would write the key to this
// browser's database, exactly what the person chose not to do. So the choice is remembered for this TAB only (sessionStorage, closed with the tab)
// as a plain yes/no. It holds no secret, and when storage is not available the box simply starts empty.
//
// A second tab has no such memory, but the session cookie is the same: the server knows that this session was started on a shared device and says
// so in GET /api/auth/session (`shared`). That answer wins: the box is ticked and cannot be cleared (C-5b, `sharedDeviceStart`).

const FLAG = 'edging-mail-shared-device';

/** The part of `sessionStorage` used here; tests pass their own. */
export type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let override: FlagStorage | null | undefined;

/** Tests only: a stand-in for sessionStorage (null: no storage at all; undefined: the real one again). */
export function setSharedDeviceStorage(storage: FlagStorage | null | undefined): void {
  override = storage;
}

function storageOf(): FlagStorage | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Did the person say, in this tab, that this is a shared or public device? */
export function sharedDeviceChosen(): boolean {
  try {
    return storageOf()?.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

/** Remembers the choice made at a sign-in or an unlock (`true`: shared), for this tab. */
export function rememberSharedDevice(shared: boolean): void {
  try {
    if (shared) {
      storageOf()?.setItem(FLAG, '1');
    } else {
      storageOf()?.removeItem(FLAG);
    }
  } catch {
    // Storage is blocked: the choice cannot be remembered, and the box starts empty next time.
  }
}

/** What the shared-device box starts as: the server says this session is a shared-device one (it is then locked on), or this tab remembers the choice. */
export function sharedDeviceStart(serverSaysShared?: boolean): { shared: boolean; locked: boolean } {
  const locked = serverSaysShared === true;
  return { shared: locked || sharedDeviceChosen(), locked };
}
