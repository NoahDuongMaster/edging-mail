import React from 'react';
import type { ThemeTokens } from '../theme';
import { formatWhen } from '../lib/activity';
import { useSession } from '../lib/auth';
import { useT } from '../lib/i18n';
import { keepLockedMail, lockedMailKept } from '../lib/lockedKept';
import { bannerRows, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useNotices } from '../lib/notices';
import { Banner, Button } from '../ui';
import { LockedMailDialog } from './security/LockedMailDialog';
import './mailbox.css';

/**
 * Old mail that is locked under a key that was replaced (an admin restored with the setup key): how many messages, and two plain choices. Keep
 * leaves them as they are and puts the banner away for this tab; Delete asks for the address, the password and the code, and then the banner says
 * on which date the server will delete them, with a Cancel. Calm on purpose: one neutral info banner, no counters beyond the one that matters.
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
  const keep = (keyId: string) => {
    keepLockedMail(keyId);
    setKeptNow((now) => new Set(now).add(keyId));
  };

  return (
    <>
      {rows.length === 0 ? null : (
        <section aria-label={tr('locked.region')} data-locked-mail className="mb-strip">
          <ul role="list" className="mb-strip-list">
            {rows.map((row) => (
              <li key={row.mail.keyId} data-locked-row={row.state}>
                <Banner
                  tone="info"
                  action={
                    <div className="mb-actions">
                      {row.state === 'ask' ? (
                        <>
                          <Button size="sm" data-locked-keep onClick={() => keep(row.mail.keyId)}>
                            {tr('locked.keep')}
                          </Button>
                          <Button size="sm" data-locked-delete onClick={() => setDeleting(row.mail)}>
                            {tr('locked.delete')}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" data-locked-cancel disabled={cancel.isPending} onClick={() => cancel.mutate(row.mail.keyId)}>
                          {tr('locked.cancel')}
                        </Button>
                      )}
                    </div>
                  }
                >
                  <p>
                    {row.state === 'ask'
                      ? tr('locked.banner', { count: row.mail.locked })
                      : tr('locked.pending', { count: row.mail.locked, date: formatWhen(row.until) })}
                  </p>
                  {cancel.isError && row.state === 'pending' ? (
                    <p role="alert" data-tone="error" className="mb-note">
                      {cancel.error.message}
                    </p>
                  ) : null}
                </Banner>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deleting === null ? null : <LockedMailDialog t={t} user={user} mail={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
};
