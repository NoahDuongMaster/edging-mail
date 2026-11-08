// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeKind, describeNotice, formatWhen } from '../../src/client/lib/activity';
import type { AccountNotice } from '../../src/client/lib/activity';
import { tr } from '../../src/client/lib/i18n';
import { ROOT } from './helpers/scan';

// Every security notice the Worker can write (SecurityKind and AlertKind in src/worker/security.ts) has a sentence of its own in the app, not the
// generic line of an unknown event. Reads the Worker source, so it runs in Node.

const source = readFileSync(path.join(ROOT, 'src', 'worker', 'security.ts'), 'utf8');
const declared = source.slice(source.indexOf('export type SecurityKind'), source.indexOf('/** How long a notice'));
const kinds = [...declared.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);

// Kinds that are generic on purpose, and why.
const GENERIC_ON_PURPOSE = new Set([
  // Only listed in Settings > Account as "First sign-in" (isBannerNotice); its title is the whole message.
  'first_sign_in'
]);

const noticeOf = (kind: string): AccountNotice => ({
  id: 1,
  kind,
  at: Date.UTC(2026, 10, 7, 8, 30),
  by: 'admin@example.com',
  detail: {
    target: 'bob@example.com',
    failures: 10,
    due: Date.UTC(2026, 10, 8, 8, 30),
    role: 'admin',
    delete_after: Date.UTC(2026, 10, 14, 8, 30)
  }
});

describe('the notice kinds of the Worker', () => {
  it('are found in the source (the test would pass on an empty list otherwise)', () => {
    expect(kinds).toContain('second_factor_locked');
    expect(kinds).toContain('alert_break_glass_failures');
    expect(kinds.length).toBeGreaterThan(10);
  });

  it.each(kinds.filter((kind) => !GENERIC_ON_PURPOSE.has(kind)))('%s has its own sentence, not the line of an unknown event', (kind) => {
    const notice = noticeOf(kind);
    const text = describeNotice(notice);
    const event = describeKind(kind, true);
    const date = formatWhen(notice.at);
    expect(text).not.toBe(tr('activity.notice_generic', { event, date }));
    expect(text).not.toBe(tr('activity.notice_generic_by', { event, admin: 'admin@example.com', date }));
    expect(text).not.toContain('{');
  });

  it('say what happened: the owner is told about wrong codes, every admin about the failed setup-key attempts, with the count the server wrote', () => {
    expect(describeNotice(noticeOf('second_factor_locked'))).toMatch(/wrong codes[\s\S]*change your password/);
    const alert = describeNotice(noticeOf('alert_break_glass_failures'));
    expect(alert).toContain('10 failed attempts');
    expect(alert).toMatch(/setup key/);
  });

  it("tells the owner when the locked mail will be deleted, from the Worker's own date, and falls back to the generic line without it (LK-3)", () => {
    const due = formatWhen(Date.UTC(2026, 10, 14, 8, 30));
    const full = describeNotice(noticeOf('locked_delete_requested'));
    expect(full).toContain(due);
    expect(full).toMatch(/cancel it now and tell an admin/);
    expect(full).not.toContain('{');
    const without = describeNotice({ ...noticeOf('locked_delete_requested'), detail: { key_id: 'k' } });
    expect(without).not.toMatch(/undefined|NaN|\{due\}/);
    expect(without).not.toContain(due);
  });

  it('shows the generic line, not "undefined", when the Worker sent no count', () => {
    const notice: AccountNotice = { ...noticeOf('alert_break_glass_failures'), detail: {} };
    expect(describeNotice(notice)).not.toMatch(/undefined|NaN|\{count\}/);
  });
});
