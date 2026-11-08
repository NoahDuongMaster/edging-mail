import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from './api';
import { fmt, tDyn, tr } from './i18n';

/** One row of `GET /api/auth/activity`: a sign-in attempt of the caller, newest first. `at` is epoch milliseconds. */
export interface SignIn {
  at: number;
  ip: string | null;
  user_agent: string | null;
  ok: boolean;
  /** `sign_in` for an ordinary one; the security events of the account (recovery, 2FA reset, ...) use their own names. */
  kind: string;
}

/** A thing about the account that its owner is told about until they have dismissed it (a 2FA reset, a recovery) or, for an admin, an alert about another admin's action. */
export interface AccountNotice {
  id: string | number;
  kind: string;
  at: number;
  /** Who did it, when it was another person (an admin's address). */
  by?: string | null;
  /** What the server recorded with the event (the person it was about, a role, a due time). */
  detail?: Record<string, unknown>;
  /** The notice stays for seven days before it can be dismissed. */
  dismissible?: boolean;
  dismissibleAfter?: number;
}

interface ActivityResponse {
  activity: SignIn[];
  notices?: AccountNotice[];
}

/** One row of `GET /api/auth/notices`. */
export interface NoticeRow {
  id: number;
  kind: string;
  at: number;
  actor_email: string | null;
  detail: Record<string, unknown>;
  dismissible_after: number;
  dismissible: boolean;
}

export function toNotice(row: NoticeRow): AccountNotice {
  return {
    id: row.id,
    kind: row.kind,
    at: row.at,
    by: row.actor_email,
    detail: row.detail,
    dismissibleAfter: row.dismissible_after,
    dismissible: row.dismissible
  };
}

export const activityKey = ['account-activity'] as const;

export function useAccountActivity(): UseQueryResult<ActivityResponse> {
  return useQuery({
    queryKey: activityKey,
    queryFn: async ({ signal }) => {
      const [data, notices] = await Promise.all([
        apiGet<ActivityResponse>('/api/auth/activity', 'fail.activity_load', signal),
        apiGet<{ notices: NoticeRow[] }>('/api/auth/notices', 'fail.notices_load', signal)
      ]);
      return { activity: data.activity, notices: notices.notices.map(toNotice) };
    },
    // Looked at each time the Account tab opens: a stale list of sign-ins is worse than a short wait.
    staleTime: 0
  });
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari']
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux']
];

/** "Firefox on Windows" from a user-agent string; "Unknown device" when it says nothing useful. */
export function describeAgent(userAgent: string | null): string {
  const matches = (pattern: RegExp) => pattern.test(userAgent ?? '');
  const browser = BROWSERS.find(([pattern]) => matches(pattern))?.[1];
  const system = SYSTEMS.find(([pattern]) => matches(pattern))?.[1];
  if (browser !== undefined && system !== undefined) {
    return tr('activity.agent_on', { browser, system });
  }
  return browser ?? system ?? tr('activity.unknown_device');
}

/** The second line of a sign-in row: the device, then the address it came from when the server knows it. */
export function describeDevice(userAgent: string | null, ip: string | null): string {
  const device = describeAgent(userAgent);
  return ip === null || ip === '' ? device : tr('activity.device_ip', { device, ip });
}

/** The row's title: the event for a security event (family `activity.kind.<kind>`), "Sign-in" or "Sign-in failed" for an ordinary one. */
export function describeKind(kind: string, ok: boolean): string {
  if (kind === 'sign_in' && !ok) {
    return tr('activity.sign_in_failed');
  }
  return tDyn(`activity.kind.${kind}`) ?? tr('activity.kind_unknown', { kind });
}

export const formatWhen = (at: number): string => fmt.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' });

/** One sentence for a notice. It names the admin when an admin did it, and says what to do when it was not you. */
export function describeNotice(notice: AccountNotice): string {
  const date = formatWhen(notice.at);
  const admin = notice.by ?? '';
  const detail = notice.detail ?? {};
  const target = typeof detail.target === 'string' ? detail.target : '';
  const due = typeof detail.due === 'number' ? formatWhen(detail.due) : '';
  switch (notice.kind) {
    case '2fa_reset': {
      return admin === '' ? tr('activity.notice_2fa_reset', { date }) : tr('activity.notice_2fa_reset_by', { admin, date });
    }
    case '2fa_reset_pending': {
      return tr('activity.notice_2fa_reset_pending', { admin, due });
    }
    case 'locked_delete_requested': {
      // Whoever asked had the password and the second step. The date it will be deleted is the Worker's own (`detail.delete_after`, LK-3): the
      // client holds no copy of the waiting time. The Cancel button comes from NoticesBanner (live state).
      return typeof detail.delete_after === 'number'
        ? tr('activity.notice_locked_delete_requested', { date, due: formatWhen(detail.delete_after) })
        : tr('activity.notice_generic', { event: describeKind(notice.kind, true), date });
    }
    case 'password_recovered': {
      return tr('activity.notice_password_recovered', { date });
    }
    case 'recovery_started': {
      return tr('activity.notice_recovery_started', { date });
    }
    case 'recovery_key_replaced': {
      return tr('activity.notice_recovery_key_replaced', { date });
    }
    case 'break_glass': {
      return tr('activity.notice_break_glass', { date });
    }
    case 'alert_2fa_reset': {
      if (detail.cancelled === true) {
        return tr('activity.notice_alert_2fa_reset_cancelled', { target, date });
      }
      return detail.pending === true
        ? tr('activity.notice_alert_2fa_reset_pending', { admin, target, due })
        : tr('activity.notice_alert_2fa_reset', { admin, target, date });
    }
    case 'alert_role_change': {
      if (detail.created === true) {
        return tr('activity.notice_alert_admin_created', { admin, target, date });
      }
      const role = detail.to === 'admin' ? tr('term.admin') : tr('term.member');
      return tr('activity.notice_alert_role_change', { admin, target, role, date });
    }
    case 'alert_account_delete': {
      return tr('activity.notice_alert_account_delete', { admin, target, date });
    }
    case 'alert_break_glass': {
      return tr('activity.notice_alert_break_glass', { target, date });
    }
    case 'alert_require_2fa_relaxed': {
      return tr('activity.notice_alert_require_2fa_relaxed', { admin, date });
    }
    case 'alert_temp_password_reissued': {
      return tr('activity.notice_alert_temp_password_reissued', { admin, target, date });
    }
    case 'second_factor_locked': {
      // To the owner: wrong codes after a right password paused sign-in with a code (PB-4).
      return tr('activity.notice_second_factor_locked', { date });
    }
    case 'alert_break_glass_failures': {
      // To every admin: ten failed uses of the setup key within an hour (PB-6). The count is the server's own, never a guess.
      return typeof detail.failures === 'number'
        ? tr('activity.notice_alert_break_glass_failures', { count: fmt.number(detail.failures), date })
        : tr('activity.notice_generic', { event: describeKind(notice.kind, true), date });
    }
    default: {
      const event = describeKind(notice.kind, true);
      return admin === '' ? tr('activity.notice_generic', { event, date }) : tr('activity.notice_generic_by', { event, admin, date });
    }
  }
}
