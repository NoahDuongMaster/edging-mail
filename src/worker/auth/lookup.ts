import { eq, inArray } from 'drizzle-orm';
import { routingAddress } from '../addresses';
import type { Db } from '../db';
import { addresses, users } from '../db/schema';
import type { UserStatus } from '../db/schema';

// Who owns an address on this deployment, and the public key mail to them is sealed to. Shared by the key lookup and by internal mail, so
// both read the same thing the same way.

export interface Owner {
  user_id: string;
  public_key: string | null;
  key_id: string | null;
  /** A disabled person still receives mail (it waits for them), but is not offered as a recipient by the key lookup. */
  status: UserStatus;
}

/** The answer of `POST /api/keys/lookup` for one address. */
export interface KeyEntry {
  address: string;
  internal: boolean;
  public_key?: string;
  key_id?: string;
}

// D1 binds at most 100 parameters per statement.
const CHUNK = 50;

/** The owner of each routing address (see `routingAddress`) that belongs to a person here (primary address or alias). */
export async function ownersOf(db: Db, routed: string[]): Promise<Map<string, Owner>> {
  const found = new Map<string, Owner>();
  const distinct = [...new Set(routed)];
  for (let start = 0; start < distinct.length; start += CHUNK) {
    const rows = await db
      .select({
        address: addresses.address,
        user_id: addresses.user_id,
        public_key: users.public_key,
        key_id: users.key_id,
        status: users.status
      })
      .from(addresses)
      .innerJoin(users, eq(users.id, addresses.user_id))
      .where(inArray(addresses.address, distinct.slice(start, start + CHUNK)));
    for (const row of rows) {
      found.set(row.address, { user_id: row.user_id, public_key: row.public_key, key_id: row.key_id, status: row.status });
    }
  }
  return found;
}

/**
 * `asked`: trimmed, lower-cased, distinct addresses. One entry per address in the order asked; an alias answers with its owner's key. The address of
 * a DISABLED person answers like one nobody owns (PX-10): no key is handed out for someone who cannot sign in, and the answer does not list the
 * disabled people of the organisation.
 */
export async function lookupKeys(db: Db, asked: string[]): Promise<KeyEntry[]> {
  const routed = asked.map((address) => routingAddress(address));
  const owners = await ownersOf(
    db,
    routed.filter((address): address is string => address !== null)
  );
  return asked.map((address, index) => {
    const owner = owners.get(routed[index] ?? '');
    return owner?.status !== 'active'
      ? { address, internal: false }
      : {
          address,
          internal: true,
          ...(owner.public_key === null || owner.key_id === null ? {} : { public_key: owner.public_key, key_id: owner.key_id })
        };
  });
}
