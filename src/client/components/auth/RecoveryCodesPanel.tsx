import React from 'react';
import { Download } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import type { TFunction } from '../../lib/i18n';
import { useT } from '../../lib/i18n';
import { useSecretHold } from '../../lib/secretHold';
import { CopyButton, SecretBox } from '../../ui';
import { AuthButton, CheckboxRow, ErrorLine } from './authUi';

// The single-use recovery codes of two-factor sign-in, shown once right after enrolment. They are not the recovery key (that one restores
// access to mail and lives in RecoveryKeyPanel); they only stand in for the authenticator app when the phone is lost.

const RECOVERY_CODES_FILE = 'edging-mail-recovery-codes.txt';

/** The text file a person can keep: a title line, the codes one per line, and one sentence saying each works once. */
export const recoveryCodesFile = (codes: readonly string[], tr: TFunction): string =>
  `${tr('twofa.file_title')}\n\n${codes.join('\n')}\n\n${tr('twofa.file_note')}\n`;

interface RecoveryCodesPanelProps {
  t: ThemeTokens;
  codes: readonly string[];
  /** The person ticked "I have saved these recovery codes" and continued. */
  onDone: () => void;
  /** The level of its heading in the page around it: 2 on a screen before the mailbox (under the h1), 5 in a view of Settings (under its h4). */
  headingLevel?: 2 | 3 | 4 | 5;
}

/**
 * Shows the recovery codes with Copy and Download, says what they are for (and that they are not the recovery key), and does not let the
 * person continue before they confirm they saved them. The codes are on screen only while this panel is mounted and are not stored anywhere
 * else: the server cannot show them again.
 */
export const RecoveryCodesPanel: React.FC<RecoveryCodesPanelProps> = ({ t, codes, onDone, headingLevel = 2 }) => {
  const tr = useT();
  const [saved, setSaved] = React.useState(false);
  // In Settings the dialog stays open until the person says the codes are saved (C-7): the server cannot show them again.
  useSecretHold(!saved);
  const [copyFailed, setCopyFailed] = React.useState(false);
  // C-9b: the panel replaces the form the person just submitted, and the field that had the focus is gone with it: the heading takes it, so a keyboard
  // or a screen reader starts at the top of the codes (and the browser scrolls it into view).
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    heading.current?.focus();
  }, []);
  const Heading = `h${headingLevel}` as const;

  const download = () => {
    const url = URL.createObjectURL(new Blob([recoveryCodesFile(codes, tr)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_CODES_FILE;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div data-testid="twofa-codes" className="au-stack">
      <Heading ref={heading} tabIndex={-1} className="au-subtitle">
        {tr('twofa.codes_title')}
      </Heading>
      <p className="au-text">{tr('twofa.codes_lead')}</p>
      <p className="au-muted">{tr('twofa.codes_not_key')}</p>

      <SecretBox label={tr('term.recovery_codes')} value={codes} />

      <div className="au-actions">
        <CopyButton text={codes.join('\n')} size="lg" className="au-btn" onResult={(result) => setCopyFailed(result === 'failed')} />
        <AuthButton
          t={t}
          type="button"
          quiet
          icon={<Download size={16} aria-hidden="true" />}
          label={tr('twofa.download')}
          onClick={download}
        />
      </div>
      {copyFailed ? <ErrorLine t={t} id="twofa-codes-copy-error" text={tr('twofa.copy_failed')} /> : null}
      <p className="au-muted">{tr('twofa.codes_keep')}</p>

      <CheckboxRow
        t={t}
        id="twofa-codes-saved"
        label={tr('twofa.saved_check')}
        hint={tr('twofa.saved_hint')}
        checked={saved}
        onChange={setSaved}
      />
      <AuthButton t={t} type="button" disabled={!saved} label={tr('twofa.continue')} onClick={onDone} />
    </div>
  );
};
