import type React from 'react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { bareAddress } from '../../lib/mail';
import type { ReplyRedirect } from '../../lib/mail';

/**
 * PX-12: a reply goes to the Reply-To address of the mail it answers, which is how a faked payment request gets its answer. When that is not the
 * sender's address, one plain line under the recipient fields says so, for as long as the To field still holds that address. Information, not a
 * warning: the person decides.
 */
export const ReplyRedirectNote: React.FC<{ t: ThemeTokens; redirect: ReplyRedirect | undefined; to: readonly string[] }> = ({
  t,
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
    <p
      data-reply-redirect=""
      style={{
        margin: 0,
        padding: '8px 24px',
        borderBottom: `1px solid ${t.divider}`,
        color: t.text2,
        fontSize: 12.5,
        lineHeight: '18px',
        overflowWrap: 'anywhere'
      }}
    >
      {tr('compose.reply_redirect', { address: redirect.address, sender: redirect.sender })}
    </p>
  );
};
