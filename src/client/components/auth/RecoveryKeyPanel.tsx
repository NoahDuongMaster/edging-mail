import React from 'react';
import { Download } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { drawChallenge } from '../../lib/crypto/recoveryDraft';
import type { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { credentialErrorText } from '../../lib/crypto/errors';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { useT } from '../../lib/i18n';
import { Banner, CopyButton, Divider, SecretBox, TextField } from '../../ui';
import { AuthButton, ErrorLine, TextButton } from './authUi';

interface RecoveryKeyPanelProps {
  t: ThemeTokens;
  draft: RecoveryKeyDraft;
  address: string;
  /** Says the previous recovery key stops working (a replaced or a recovered key); a first key has no predecessor. */
  replaces: boolean;
  /** Runs the request that stores the key, after the person typed three groups back. Rejecting shows the error and keeps the screen. */
  onConfirmed: () => Promise<void>;
  /** Backing out of a flow that has changed nothing yet. Absent where the key must be confirmed (a first key: no way to skip). */
  onCancel?: () => void;
  cancelLabel?: string;
}

const NO_TYPING: readonly string[] = ['', '', ''];
const groupId = (position: number): string => `recovery-group-${position}`;

/**
 * Shows a NEW recovery key once and checks that it was saved: a warning that it is shown once, the nine groups in mono, Copy first, Download
 * second (with its warning), then the typed confirmation of three groups that are drawn again after every wrong attempt. There is no way past
 * it without the right groups. The confirm button can always be pressed: a group left empty is said under its own field. The key text is on
 * screen only while this panel is mounted; the parent discards the draft when it unmounts it (the bytes are zeroed there).
 */
export const RecoveryKeyPanel: React.FC<RecoveryKeyPanelProps> = ({ t, draft, address, replaces, onConfirmed, onCancel, cancelLabel }) => {
  const tr = useT();
  const [challenge, setChallenge] = React.useState(() => drawChallenge(draft.text));
  const [typed, setTyped] = React.useState<readonly string[]>(NO_TYPING);
  const [submitted, setSubmitted] = React.useState(false);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [mismatch, setMismatch] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  const focusLater = useFieldFocus();
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const download = () => {
    const body = `${tr('recovery.file_title', { address })}\n\n${draft.text}\n\n${tr('recovery.claim')}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edging-mail-recovery-key.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const confirm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setSubmitted(true);
    const toFix = firstInvalid(typed.map((group, position) => [groupId(position), group.trim() === ''] as const));
    if (toFix !== undefined) {
      focusLater(toFix);
      return;
    }
    if (!challenge.matches(typed)) {
      // A wrong attempt gets a new draw, so the answer cannot be found by trying the same three groups with small changes.
      setMismatch(true);
      setSubmitted(false);
      setTyped(NO_TYPING);
      setChallenge(drawChallenge(draft.text));
      focusLater(groupId(0));
      return;
    }
    setMismatch(false);
    setFailure(null);
    setBusy(true);
    try {
      await onConfirmed();
    } catch (error) {
      if (alive.current) {
        setFailure(credentialErrorText(error));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const [first, second, third] = challenge.numbers;

  return (
    <form
      onSubmit={(event) => {
        void confirm(event);
      }}
      noValidate
      className="au-stack"
    >
      <p className="au-text">{tr('recovery.claim')}</p>
      <Banner tone="warning">
        <p className="au-banner-line">{tr('recovery.shown_once')}</p>
        {replaces ? <p className="au-banner-line">{tr('recovery.old_stops')}</p> : null}
      </Banner>

      <SecretBox
        label={tr('term.recovery_key')}
        value={draft.groups}
        columns={3}
        partLabel={(index) => tr('recovery.group_label', { number: index + 1 })}
        className="au-key"
      />

      <div className="au-actions">
        <CopyButton text={draft.text} size="lg" className="au-btn" onResult={(result) => setCopyFailed(result === 'failed')} />
        <AuthButton
          t={t}
          type="button"
          quiet
          icon={<Download size={16} aria-hidden="true" />}
          label={tr('recovery.download')}
          onClick={download}
        />
      </div>
      {copyFailed ? <ErrorLine t={t} id="recovery-copy-error" text={tr('recovery.copy_failed')} /> : null}
      <p className="au-note">{tr('recovery.download_warning')}</p>

      <Divider />
      <p className="au-strong">{tr('recovery.confirm_lead', { first, second, third })}</p>
      <ErrorLine t={t} id="recovery-mismatch" text={mismatch ? tr('recovery.confirm_mismatch') : null} />
      <div className="au-groups">
        {[first, second, third].map((number, position) => (
          <TextField
            key={number}
            id={groupId(position)}
            label={tr('recovery.group_label', { number })}
            error={submitted && typed[position].trim() === '' ? tr('recovery.group_required', { number }) : undefined}
            mono
            className="au-key-input"
            value={typed[position]}
            onChange={(event) => setTyped((current) => current.map((group, index) => (index === position ? event.target.value : group)))}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            translate="no"
          />
        ))}
      </div>
      <ErrorLine t={t} id="recovery-failure" text={failure} />
      <AuthButton t={t} busy={busy} label={tr('recovery.confirm_button')} />
      {onCancel === undefined ? null : (
        // A way back is a quiet text button under the main one, as on the other screens before the mailbox.
        <div className="au-alt">
          <TextButton t={t} label={cancelLabel ?? tr('common.cancel')} onClick={onCancel} disabled={busy} />
        </div>
      )}
    </form>
  );
};
