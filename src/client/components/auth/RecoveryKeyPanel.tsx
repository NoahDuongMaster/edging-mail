import React from 'react';
import type { ThemeTokens } from '../../theme';
import { drawChallenge } from '../../lib/crypto/recoveryDraft';
import type { RecoveryKeyDraft } from '../../lib/crypto/recoveryDraft';
import { credentialErrorText } from '../../lib/crypto/errors';
import { useT } from '../../lib/i18n';
import { AuthButton, ErrorLine, Field, inputStyle } from './authUi';

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
  const [copied, setCopied] = React.useState<'idle' | 'done' | 'failed'>('idle');
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

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
  const quiet: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: '18px', color: t.text2 };

  return (
    <form
      onSubmit={(event) => {
        void confirm(event);
      }}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{tr('recovery.claim')}</p>
      <p style={quiet}>{tr('recovery.shown_once')}</p>
      {replaces ? <p style={quiet}>{tr('recovery.old_stops')}</p> : null}

      <ol
        translate="no"
        style={{
          margin: 0,
          padding: 12,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 10,
          background: t.raised
        }}
      >
        {draft.groups.map((group, index) => (
          <li key={`${index + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: t.text3 }}>{tr('recovery.group_label', { number: index + 1 })}</span>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 16,
                letterSpacing: '0.04em',
                userSelect: 'all',
                overflowWrap: 'anywhere'
              }}
            >
              {group}
            </span>
          </li>
        ))}
      </ol>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <AuthButton
          t={t}
          type="button"
          label={copied === 'done' ? tr('common.copied') : tr('common.copy')}
          onClick={() => {
            void copy();
          }}
        />
        <AuthButton t={t} type="button" quiet label={tr('recovery.download')} onClick={download} />
      </div>
      {copied === 'failed' ? <ErrorLine t={t} id="recovery-copy-error" text={tr('recovery.copy_failed')} /> : null}
      <p style={quiet}>{tr('recovery.download_warning')}</p>

      <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>
        {tr('recovery.confirm_lead', { first, second, third })}
      </p>
      {[first, second, third].map((number, position) => (
        <Field key={number} t={t} id={`recovery-group-${position}`} label={tr('recovery.group_label', { number })}>
          <input
            id={`recovery-group-${position}`}
            value={typed[position]}
            onChange={(event) => setTyped((current) => current.map((group, index) => (index === position ? event.target.value : group)))}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            translate="no"
            style={{ ...inputStyle(t), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.04em' }}
          />
        </Field>
      ))}
      <ErrorLine t={t} id="recovery-mismatch" text={mismatch ? tr('recovery.confirm_mismatch') : null} />
      <ErrorLine t={t} id="recovery-failure" text={failure} />
      <AuthButton t={t} busy={busy} disabled={!complete} label={tr('recovery.confirm_button')} />
      {onCancel === undefined ? null : (
        <AuthButton t={t} type="button" quiet disabled={busy} label={cancelLabel ?? tr('common.cancel')} onClick={onCancel} />
      )}
    </form>
  );
};
