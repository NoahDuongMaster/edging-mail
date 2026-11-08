import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { addresses, users } from '../db/schema';
import type { Db } from '../db';

// How the admin console sees a person: never key material, never a verifier. Shared by the user routes.

/** The columns the console shows of an account. */
export const userColumns = {
  id: users.id,
  email: users.email,
  display_name: users.display_name,
  role: users.role,
  status: users.status,
  last_login_at: users.last_login_at,
  created_at: users.created_at,
  two_factor: sql<number>`${users.totp_enabled}`,
  reset_2fa_due_at: users.reset_2fa_due_at,
  has_keys: sql<number>`${users.public_key} IS NOT NULL`,
  must_change_password: users.must_change_password,
  temp_password_expires_at: users.temp_password_expires_at
};

export interface UserListRow {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  last_login_at: number | null;
  created_at: number;
  two_factor: number;
  reset_2fa_due_at: number | null;
  has_keys: number;
  must_change_password: number;
  temp_password_expires_at: number | null;
}

export interface UserView {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  last_login_at: number | null;
  created_at: number;
  two_factor: boolean;
  two_factor_reset_due_at: number | null;
  has_keys: boolean;
  /** The person has not chosen their own password yet and has no keys: the account is still on the temporary password an admin made. */
  never_signed_in: boolean;
  /** When the temporary password stops working (null once the person chose their own). */
  temp_password_expires_at: number | null;
  aliases: string[];
}

export const userView = (row: UserListRow, aliases: string[]): UserView => ({
  id: row.id,
  email: row.email,
  display_name: row.display_name,
  role: row.role,
  status: row.status,
  last_login_at: row.last_login_at,
  created_at: row.created_at,
  two_factor: row.two_factor === 1,
  two_factor_reset_due_at: row.reset_2fa_due_at,
  has_keys: row.has_keys === 1,
  never_signed_in: row.must_change_password === 1 && row.has_keys === 0,
  temp_password_expires_at: row.must_change_password === 1 ? row.temp_password_expires_at : null,
  aliases
});

export async function aliasesOf(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (let start = 0; start < ids.length; start += 50) {
    const rows = await db
      .select({ user_id: addresses.user_id, address: addresses.address })
      .from(addresses)
      .where(and(inArray(addresses.user_id, ids.slice(start, start + 50)), eq(addresses.kind, 'alias')))
      .orderBy(asc(addresses.address));
    for (const row of rows) {
      found.set(row.user_id, [...(found.get(row.user_id) ?? []), row.address]);
    }
  }
  return found;
}

/** One person as the console shows them, or null when the id does not exist. */
export async function viewOf(db: Db, id: string): Promise<UserView | null> {
  const row = await db.select(userColumns).from(users).where(eq(users.id, id)).get();
  const aliases = await aliasesOf(db, [id]);
  return row === undefined ? null : userView(row, aliases.get(id) ?? []);
}
