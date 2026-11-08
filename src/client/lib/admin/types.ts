import { ApiError, UnauthorizedError } from '../api';
import { fmt, tr } from '../i18n';

// Shapes of the admin API (design.md section 5, with the v4 changes of crypto-design.md section 15). Times are epoch milliseconds.

export type Role = 'member' | 'admin';
export type UserStatus = 'active' | 'disabled';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  last_login_at: number | null;
  has_keys: boolean;
  /** The person has not chosen their own password yet and has no keys: the account is still on the temporary password an admin made. */
  never_signed_in: boolean;
  /** When the temporary password stops working (null once the person chose their own). */
  temp_password_expires_at: number | null;
  aliases: string[];
}

/** How long a temporary password works (the server's TEMP_PASSWORD_HOURS), for the texts that say so. */
export const TEMP_PASSWORD_HOURS = 72;

export interface UsersPage {
  users: AdminUser[];
  next_cursor: string | null;
  total: number;
}

export interface AdminDomain {
  id: string;
  name: string;
  created_at: number;
  addresses_count: number;
}

export interface DnsCheck {
  domain: string;
  checked_at: number;
  receiving: { ready: boolean; via_cloudflare: boolean; mx: { priority: number; host: string }[]; note: string };
  sending: { ready: boolean; records: { type: string; name: string; found: boolean }[]; note: string };
}

export interface AuditEntry {
  id: number;
  at: number;
  actor_email: string;
  action: string;
  target: string;
  /** Small JSON the server wrote (`{from:'member',to:'admin'}`): an object, or the JSON text of one. Never a password. */
  detail: unknown;
}

export interface AuditPage {
  entries: AuditEntry[];
  next_cursor: string | null;
}

/** Page size of the user and audit lists: the server's default, so a first page is one cheap query. */
export const PAGE_SIZE = 50;

/** What to tell the admin about a failed call. An API error already carries text in the UI language (the catalogue's `err.<code>`). */
export function adminErrorText(error: unknown): string {
  if (error instanceof TypeError) {
    return tr('app.no_connection');
  }
  // Only the text of an answer is for a person; any other Error (a developer error such as an unregistered deriver) is not.
  return error instanceof ApiError || error instanceof UnauthorizedError ? error.message : tr('common.something_wrong');
}

export const isStepUpRequired = (error: unknown): boolean => error instanceof ApiError && error.code === 'step_up_required';

/** Key and value of an audit entry's detail, for display. Anything that is not a small object is shown as text. */
export function detailPairs(detail: unknown): [string, string][] {
  let value: unknown = detail;
  if (typeof detail === 'string') {
    try {
      value = JSON.parse(detail) as unknown;
    } catch {
      return detail === '' ? [] : [['', detail]];
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).map(([key, entry]): [string, string] => [key, typeof entry === 'string' ? entry : JSON.stringify(entry)]);
}

/** The name of a detail field in the UI language; a field this screen does not know is shown as its own words. */
function detailLabel(key: string): string {
  switch (key) {
    case 'from': {
      return tr('audit.detail_from');
    }
    case 'to': {
      return tr('audit.detail_to');
    }
    case 'role': {
      return tr('audit.detail_role');
    }
    case 'reason': {
      return tr('audit.detail_reason');
    }
    case 'user': {
      return tr('audit.detail_user');
    }
    case 'aliases': {
      return tr('audit.detail_aliases');
    }
    case 'due': {
      return tr('audit.detail_due');
    }
    case 'second_factor': {
      return tr('audit.detail_second_factor');
    }
    default: {
      return key.replaceAll('_', ' ');
    }
  }
}

/** The value of a detail field in the UI language: the words the server writes for a role, a second factor or a reason, and a time. */
function detailValue(key: string, value: string): string {
  if (key === 'due' && /^\d{10,}$/.test(value)) {
    return fmt.dateTime(Number(value));
  }
  switch (value) {
    case 'member': {
      return tr('term.member');
    }
    case 'admin': {
      return tr('term.admin');
    }
    case 'totp': {
      return tr('term.authenticator_app');
    }
    case 'recovery_code': {
      return tr('audit.detail_recovery_code');
    }
    case 'disabled': {
      return tr('users.status_disabled');
    }
    case 'second_factor': {
      return tr('term.two_factor');
    }
    default: {
      return value;
    }
  }
}

/** The one line an audit row shows for its detail: `name: value` pairs side by side (empty when the entry has no detail). */
export function detailLine(detail: unknown): string {
  return detailPairs(detail)
    .map(([key, value]) => (key === '' ? value : tr('audit.detail_pair', { label: detailLabel(key), value: detailValue(key, value) })))
    .join(' · ');
}
