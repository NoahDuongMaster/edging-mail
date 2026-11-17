import React from 'react';
import { Inbox } from 'lucide-react';
import type { Message } from '../../types';
import { useT } from '../../lib/i18n';
import { explainSpam } from '../../lib/spamReasons';
import { Banner, Button, Disclosure, DisclosurePanel } from '../../ui';

interface SpamBannerProps {
  message: Pick<Message, 'spam_reasons' | 'spam_score'>;
  /** Not spam: the message goes to the Inbox and its sender is allowed (App: the `not_spam` batch action, with Undo). */
  onNotSpam: () => void;
}

/**
 * The one banner above a letter in the Spam folder: why it is there, in plain short lines (the first three; "See all reasons" opens the rest
 * only when the filter gave more), and the one way back, Not spam. A message with no recorded reason (one the person moved to Spam themselves, or
 * older than the filter) gets a single line saying that, and the same button; an id this client does not know is one general line
 * (lib/spamReasons.ts), so an odd column never breaks the reader. Quiet like the other notices of the reader (an info Banner, not an alarm), and
 * not a live region: it is read in its place, with the letter it belongs to. Key it by the message id, so each message starts closed.
 */
export function SpamBanner({ message, onNotSpam }: SpamBannerProps): React.ReactElement {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const { shown, more } = explainSpam(message);
  const action = (
    <Button variant="primary" size="sm" leadingIcon={<Inbox size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={onNotSpam}>
      {tr('action.not_spam')}
    </Button>
  );
  if (shown.length === 0) {
    return (
      <Banner live={false} className="rd-spam" action={action}>
        {tr('spam.moved_by_you')}
      </Banner>
    );
  }
  return (
    <Banner live={false} className="rd-spam" title={tr('spam.why_title')} action={action}>
      <ul className="rd-why">
        {shown.map((key) => (
          <li key={key}>{tr(key)}</li>
        ))}
      </ul>
      {more.length === 0 ? null : (
        <>
          {/* The rest opens above its button, so "See all reasons" / "Show fewer" always ends the list. */}
          <DisclosurePanel id={panelId} open={open}>
            <ul className="rd-why">
              {more.map((key) => (
                <li key={key}>{tr(key)}</li>
              ))}
            </ul>
          </DisclosurePanel>
          <p className="rd-why-more">
            <Disclosure inline open={open} onOpenChange={setOpen} controls={panelId}>
              {open ? tr('spam.see_fewer') : tr('spam.see_all')}
            </Disclosure>
          </p>
        </>
      )}
    </Banner>
  );
}
