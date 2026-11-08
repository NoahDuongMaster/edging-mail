import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { TFunction } from '../../lib/i18n';
import { useT } from '../../lib/i18n';
import { useSecretHold } from '../../lib/secretHold';
import { AuthButton, CheckboxRow, ErrorLine } from './authUi';

// The single-use recovery codes of two-factor sign-in, shown once right after enrolment. They are not the recovery key (that one restores
// access to mail and lives in RecoveryKeyPanel); they only stand in for the authenticator app when the phone is lost.

const RECOVERY_CODES_FILE = 'edging-mail-recovery-codes.txt';

/** The text file a person can keep: a title line, the codes one per line, and one sentence saying each works once. */
export const recoveryCodesFile = (codes: readonly string[], tr: TFunction): string =>
  `${tr('twofa.file_title')}\n\n${codes.join('\n')}\n\n${tr('twofa.file_note')}\n`;

export type CopyState = 'idle' | 'done' | 'failed';

/** Copies `text` to the clipboard when `copy` is called and says how it went. Nothing of the text is kept here. */
export function useCopy(text: string): { state: CopyState; copy: () => void } {
  const [state, setState] = React.useState<CopyState>('idle');
  const write = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      // Also lands here when there is no clipboard (an insecure page) or the browser refuses: the person copies by hand.
      setState('failed');
    }
  };
  return {
    state,
    copy: () => {
      void write();
    }
  };
}

interface RecoveryCodesPanelProps {
  t: ThemeTokens;
  codes: readonly string[];
  /** The person ticked "I have saved these recovery codes" and continued. */
  onDone: () => void;
}

/**
 * Shows the recovery codes with Copy and Download, says what they are for (and that they are not the recovery key), and does not let the
 * person continue before they confirm they saved them. The codes are on screen only while this panel is mounted and are not stored anywhere
 * else: the server cannot show them again.
 */
export const RecoveryCodesPanel: React.FC<RecoveryCodesPanelProps> = ({ t, codes, onDone }) => {
  const tr = useT();
  const [saved, setSaved] = React.useState(false);
  // In Settings the dialog stays open until the person says the codes are saved (C-7): the server cannot show them again.
  useSecretHold(!saved);
  const { state: copied, copy } = useCopy(codes.join('\n'));
  // C-9b: the panel replaces the form the person just submitted, and the field that had the focus is gone with it: the heading takes it, so a keyboard
  // or a screen reader starts at the top of the codes (and the browser scrolls it into view).
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    heading.current?.focus();
  }, []);

  const download = () => {
    const url = URL.createObjectURL(new Blob([recoveryCodesFile(codes, tr)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_CODES_FILE;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const quiet: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: '18px', color: t.text2 };

  return (
    <div data-testid="twofa-codes" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600, outline: 'none' }}>
        {tr('twofa.codes_title')}
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>{tr('twofa.codes_lead')}</p>
      <p style={quiet}>{tr('twofa.codes_not_key')}</p>

      <ol
        aria-label={tr('term.recovery_codes')}
        translate="no"
        style={{
          margin: 0,
          padding: 12,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 10,
          background: t.raised
        }}
      >
        {codes.map((code) => (
          <li
            key={code}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 16,
              letterSpacing: '0.04em',
              userSelect: 'all',
              overflowWrap: 'anywhere'
            }}
          >
            {code}
          </li>
        ))}
      </ol>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <AuthButton t={t} type="button" label={copied === 'done' ? tr('common.copied') : tr('common.copy')} onClick={copy} />
        <AuthButton t={t} type="button" quiet label={tr('twofa.download')} onClick={download} />
      </div>
      {copied === 'failed' ? <ErrorLine t={t} id="twofa-codes-copy-error" text={tr('twofa.copy_failed')} /> : null}
      <p style={quiet}>{tr('twofa.codes_keep')}</p>

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
