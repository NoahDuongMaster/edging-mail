import React from 'react';
import { Lock } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { formatWhen } from '../lib/activity';
import { useSession } from '../lib/auth';
import { useT } from '../lib/i18n';
import { keepLockedMail, lockedMailKept } from '../lib/lockedKept';
import { bannerRows, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useNotices } from '../lib/notices';
import { LockedMailDialog } from './security/LockedMailDialog';

/**
 * Old mail that is locked under a key that was replaced (an admin restored with the setup key): how many messages, and two plain choices. Keep
 * leaves them as they are and puts the banner away for this tab; Delete asks for the address, the password and the code, and then the banner says
 * on which date the server will delete them, with a Cancel. Calm on purpose: one neutral card, no counters beyond the one that matters.
 */
export const LockedMailBanner: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const user = useSession().data?.user;
  const mail = useLockedMail().data;
  const notices = useNotices().data;
  const cancel = useCancelLockedDelete();
  // Keys kept in this tab: sessionStorage is the memory (lockedKept.ts), this set is what the page already knows when storage is blocked.
  const [keptNow, setKeptNow] = React.useState<ReadonlySet<string>>(() => new Set());
  const [deleting, setDeleting] = React.useState<LockedMail | null>(null);

  if (user === undefined || mail === undefined) {
    return null;
  }
  const rows = bannerRows(mail, bannerNotices(notices ?? []).shown, (keyId) => keptNow.has(keyId) || lockedMailKept(keyId));
  // No inline min-height here: it would beat the class `nm-tap-h` that makes these 44 px high on a phone. 36 px on a desktop come from the padding.
  const button: React.CSSProperties = {
    minWidth: 44,
    padding: '8px 12px',
    lineHeight: '20px',
    borderRadius: 8,
    border: `1px solid ${t.borderStrong}`,
    background: 'transparent',
    color: t.text,
    fontSize: 13,
    cursor: 'pointer'
  };
  const keep = (keyId: string) => {
    keepLockedMail(keyId);
    setKeptNow((now) => new Set(now).add(keyId));
  };

  return (
    <>
      {rows.length === 0 ? null : (
        <section
          aria-label={tr('locked.region')}
          data-locked-mail
          style={{ flex: 'none', borderBottom: `1px solid ${t.border}`, background: t.raised, color: t.text }}
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <li
                key={row.mail.keyId}
                data-locked-row={row.state}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', fontSize: 13, lineHeight: '19px' }}
              >
                <Lock size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2, color: t.text2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0 }}>
                    {row.state === 'ask'
                      ? tr('locked.banner', { count: row.mail.locked })
                      : tr('locked.pending', { count: row.mail.locked, date: formatWhen(row.until) })}
                  </p>
                  {cancel.isError && row.state === 'pending' ? (
                    <p role="alert" style={{ margin: '2px 0 0', fontSize: 12, color: t.dark ? '#F87171' : '#B91C1C' }}>
                      {cancel.error.message}
                    </p>
                  ) : null}
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {row.state === 'ask' ? (
                      <>
                        <button type="button" className="nm-tap-h" data-locked-keep onClick={() => keep(row.mail.keyId)} style={button}>
                          {tr('locked.keep')}
                        </button>
                        <button type="button" className="nm-tap-h" data-locked-delete onClick={() => setDeleting(row.mail)} style={button}>
                          {tr('locked.delete')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="nm-tap-h"
                        data-locked-cancel
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(row.mail.keyId)}
                        style={button}
                      >
                        {tr('locked.cancel')}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deleting === null ? null : <LockedMailDialog t={t} user={user} mail={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
};
