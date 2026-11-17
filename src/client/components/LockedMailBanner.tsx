import React from 'react';
import type { ThemeTokens } from '../theme';
import { formatWhen } from '../lib/activity';
import { useSession } from '../lib/auth';
import { useT } from '../lib/i18n';
import { keepLockedMail, lockedMailKept } from '../lib/lockedKept';
import { bannerRows, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useNotices } from '../lib/notices';
import { Banner, Button, Disclosure, DisclosurePanel } from '../ui';
import { LockedMailDialog } from './security/LockedMailDialog';
import './mailbox.css';

/**
 * Old mail that is locked under a key that was replaced (an admin restored with the setup key): how many messages, why (one plain paragraph
 * behind "Why?"), and two choices that say what they do. Keep them locked leaves them as they are and puts the banner away for this tab;
 * Delete them… (danger) opens the confirmation that names the count and asks for the address, the password and the code; then the banner says
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
  const [why, setWhy] = React.useState(false);
  const whyId = React.useId();

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
                            {tr('locked.keep_locked', { count: row.mail.locked })}
                          </Button>
                          <Button size="sm" variant="danger" data-locked-delete onClick={() => setDeleting(row.mail)}>
                            {tr('locked.delete_them', { count: row.mail.locked })}
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
                  {/* DESIGN-v4m R1: the consequence in one line, See why right after it (an inline text button with a 44px touch box), and
                      its paragraph in place; the cause is that paragraph's to tell. */}
                  <p>
                    {row.state === 'ask' ? (
                      <>
                        {tr('locked.banner_short', { count: row.mail.locked })}{' '}
                        <Disclosure open={why} onOpenChange={setWhy} controls={whyId} inline>
                          {tr('locked.why')}
                        </Disclosure>
                      </>
                    ) : (
                      tr('locked.pending', { count: row.mail.locked, date: formatWhen(row.until) })
                    )}
                  </p>
                  {row.state === 'ask' ? (
                    <DisclosurePanel id={whyId} open={why}>
                      <p className="mb-note">{tr('locked.why_text')}</p>
                    </DisclosurePanel>
                  ) : null}
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
