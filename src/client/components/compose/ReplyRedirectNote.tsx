import type React from 'react';
import { Info } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { bareAddress } from '../../lib/mail';
import type { ReplyRedirect } from '../../lib/mail';

/**
 * PX-12: a reply goes to the Reply-To address of the mail it answers, which is how a faked payment request gets its answer. When that is not the
 * sender's address, one plain line under the recipient fields says so, for as long as the To field still holds that address. Information, not a
 * warning: the person decides. `t` is not read any more (the colours are the theme's variables); the compose still passes it.
 */
export const ReplyRedirectNote: React.FC<{ t: ThemeTokens; redirect: ReplyRedirect | undefined; to: readonly string[] }> = ({
  redirect,
  to
}) => {
  const tr = useT();
  if (redirect === undefined) {
    return null;
  }
  const inTo = new Set(to.map(bareAddress));
  if (!redirect.address.split(', ').some((address) => inTo.has(address))) {
    return null;
  }
  return (
    <p data-reply-redirect="" className="cp-note">
      <Info size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>{tr('compose.reply_redirect', { address: redirect.address, sender: redirect.sender })}</span>
    </p>
  );
};
