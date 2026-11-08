import React from 'react';
import { Download } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { drawChallenge } from '../../lib/crypto/recoveryDraft';
import type { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { credentialErrorText } from '../../lib/crypto/errors';
import { useT } from '../../lib/i18n';
import { CopyButton, Divider, SecretBox, TextField } from '../../ui';
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

/**
 * Shows a NEW recovery key once and checks that it was saved: Copy first, Download second (with its warning), then the typed confirmation of
 * three groups that are drawn again after every wrong attempt. There is no way past it without the right groups. The key text is on screen only
 * while this panel is mounted; the parent discards the draft when it unmounts it (the bytes are zeroed there).
 */
export const RecoveryKeyPanel: React.FC<RecoveryKeyPanelProps> = ({ t, draft, address, replaces, onConfirmed, onCancel, cancelLabel }) => {
  const tr = useT();
  const [challenge, setChallenge] = React.useState(() => drawChallenge(draft.text));
  const [typed, setTyped] = React.useState<readonly string[]>(NO_TYPING);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [mismatch, setMismatch] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const alive = React.useRef(true);
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
    if (!challenge.matches(typed)) {
      // A wrong attempt gets a new draw, so the answer cannot be found by trying the same three groups with small changes.
      setMismatch(true);
      setTyped(NO_TYPING);
      setChallenge(drawChallenge(draft.text));
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
  const complete = typed.every((group) => group.trim() !== '');

  return (
    <form
      onSubmit={(event) => {
        void confirm(event);
      }}
      noValidate
      className="au-stack"
    >
      <p className="au-strong">{tr('recovery.claim')}</p>
      <p className="au-muted">{tr('recovery.shown_once')}</p>
      {replaces ? <p className="au-muted">{tr('recovery.old_stops')}</p> : null}

      <SecretBox
        label={tr('term.recovery_key')}
        value={draft.groups}
        columns={3}
        partLabel={(index) => tr('recovery.group_label', { number: index + 1 })}
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
      <p className="au-muted">{tr('recovery.download_warning')}</p>

      <Divider />
      <p className="au-strong">{tr('recovery.confirm_lead', { first, second, third })}</p>
      <div className="au-groups">
        {[first, second, third].map((number, position) => (
          <TextField
            key={number}
            id={`recovery-group-${position}`}
            label={tr('recovery.group_label', { number })}
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
      <ErrorLine t={t} id="recovery-mismatch" text={mismatch ? tr('recovery.confirm_mismatch') : null} />
      <ErrorLine t={t} id="recovery-failure" text={failure} />
      <AuthButton t={t} busy={busy} disabled={!complete} label={tr('recovery.confirm_button')} />
      {onCancel === undefined ? null : (
        // A way back is a quiet text button under the main one, as on the other screens before the mailbox.
        <div className="au-alt">
          <TextButton t={t} label={cancelLabel ?? tr('common.cancel')} onClick={onCancel} disabled={busy} />
        </div>
      )}
    </form>
  );
};
