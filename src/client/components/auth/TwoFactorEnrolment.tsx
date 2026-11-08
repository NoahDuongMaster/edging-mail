import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { confirmEnrolment, startEnrolment } from '../../lib/crypto/gates';
import type { EnrolmentStart } from '../../lib/crypto/gates';
import type { GateCredentials } from '../../lib/crypto/gateCredentials';
import { qrMatrix } from '../../lib/crypto/qr';
import type { QrMatrix } from '../../lib/crypto/qr';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { AuthButton, ErrorLine, Field, inputStyle } from './authUi';
import { RecoveryCodesPanel, useCopy } from './RecoveryCodesPanel';

// Gate 3 (and Settings): turn on two-factor sign-in. The server makes a NEW secret every time the enrolment starts and it only counts once a
// code from it is confirmed; the confirmation answers with the single-use recovery codes, which RecoveryCodesPanel shows once. The secret is
// in this component's state only while the screen is mounted, and it is dropped the moment the codes appear. The caller wraps this in an
// `AuthCard` WITHOUT `onSubmit` (this renders its own form) and refetches the session in `onDone`.

const CODE_LENGTH = 6;
const QR_SIZE = 208;
// The empty border a scanner needs around the code, drawn by the viewBox (the matrix itself has none).
const QUIET_ZONE = 4;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The secret in groups of four characters, the way an authenticator app shows its manual key. */
export function groupSecret(secret: string): string[] {
  const compact = secret.replaceAll(/\s/g, '');
  const groups: string[] = [];
  for (let index = 0; index < compact.length; index += 4) {
    groups.push(compact.slice(index, index + 4));
  }
  return groups;
}

/** Only the digits of what was typed or pasted, at most six (an app often shows its code as "123 456"). */
export const sixDigits = (value: string): string => value.replaceAll(/\D/g, '').slice(0, CODE_LENGTH);

interface QrCodeProps {
  t: ThemeTokens;
  /** null while the generator loads, 'failed' when it could not make the code (the manual key is still on screen). */
  matrix: QrMatrix | 'failed' | null;
}

/** The QR code as an svg: dark modules in one path, black on white in both themes so every scanner reads it. No innerHTML. */
const QrCode: React.FC<QrCodeProps> = ({ t, matrix }) => {
  const tr = useT();
  const box: React.CSSProperties = {
    alignSelf: 'center',
    width: `min(${QR_SIZE}px, 100%)`,
    aspectRatio: '1 / 1',
    height: 'auto',
    borderRadius: 8
  };
  if (matrix === 'failed') {
    return <ErrorLine t={t} id="twofa-qr-error" text={tr('twofa.qr_failed')} />;
  }
  if (matrix === null) {
    return (
      <div
        role="status"
        style={{
          ...box,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          border: `1px solid ${t.border}`,
          background: t.raised,
          color: t.text2,
          fontSize: 13
        }}
      >
        <Loader2 size={16} className="nm-spin" aria-hidden="true" />
        {tr('common.loading')}
      </div>
    );
  }
  const total = matrix.size + 2 * QUIET_ZONE;
  return (
    <svg
      data-testid="twofa-qr"
      role="img"
      aria-label={tr('twofa.qr_label')}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${total} ${total}`}
      style={{ ...box, display: 'block' }}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={total} height={total} fill="#FFFFFF" />
      <path d={matrix.path} fill="#000000" shapeRendering="crispEdges" />
    </svg>
  );
};

/** The fallback for a phone that cannot scan: the same secret as text, in groups of four, with a Copy button. */
const ManualKey: React.FC<{ t: ThemeTokens; secret: string }> = ({ t, secret }) => {
  const tr = useT();
  const { state: copied, copy } = useCopy(secret);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: t.text2 }}>{tr('twofa.manual_title')}</p>
      <code
        data-testid="twofa-secret"
        translate="no"
        style={{
          padding: 12,
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 10,
          background: t.raised,
          fontFamily: MONO,
          fontSize: 16,
          lineHeight: '24px',
          letterSpacing: '0.04em',
          userSelect: 'all'
        }}
      >
        {groupSecret(secret).map((group, index) => (
          <React.Fragment key={`${index + 1}`}>
            {index === 0 ? null : ' '}
            <span style={{ whiteSpace: 'nowrap' }}>{group}</span>
          </React.Fragment>
        ))}
      </code>
      <div style={{ display: 'flex' }}>
        <AuthButton t={t} type="button" quiet label={copied === 'done' ? tr('common.copied') : tr('common.copy')} onClick={copy} />
      </div>
      {copied === 'failed' ? <ErrorLine t={t} id="twofa-secret-copy-error" text={tr('twofa.copy_failed')} /> : null}
    </div>
  );
};

interface TwoFactorEnrolmentProps {
  t: ThemeTokens;
  /** What the sign-in kept for the gates: `current_auth` of both requests comes from it. */
  credentials: GateCredentials;
  /** The codes were saved and the person continued: the caller refetches the session. */
  onDone: () => void;
  /** Only where skipping is allowed (Settings); the gate gives no way out and passes nothing. */
  onCancel?: () => void;
}

export const TwoFactorEnrolment: React.FC<TwoFactorEnrolmentProps> = ({ t, credentials, onDone, onCancel }) => {
  const tr = useT();
  const start = useAction();
  const confirm = useAction();
  const { run: runStart } = start;
  const [enrolment, setEnrolment] = React.useState<EnrolmentStart | null>(null);
  const [matrix, setMatrix] = React.useState<QrMatrix | 'failed' | null>(null);
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<readonly string[] | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const started = React.useRef(false);

  const begin = React.useCallback(async () => {
    const answer = await runStart(() => startEnrolment(credentials));
    if (answer !== undefined) {
      setEnrolment(answer);
    }
  }, [credentials, runStart]);

  // Once on mount. StrictMode mounts twice in development; the ref keeps that from asking the server for two secrets.
  React.useEffect(() => {
    if (!started.current) {
      started.current = true;
      void begin();
    }
  }, [begin]);

  const otpauthUri = enrolment === null ? null : enrolment.otpauth_uri;
  React.useEffect(() => {
    if (otpauthUri === null) {
      return;
    }
    let current = true;
    qrMatrix(otpauthUri).then(
      (made) => {
        if (current) {
          setMatrix(made);
        }
      },
      () => {
        if (current) {
          setMatrix('failed');
        }
      }
    );
    return () => {
      current = false;
    };
  }, [otpauthUri]);

  const verify = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (confirm.busy || code.length !== CODE_LENGTH) {
      return;
    }
    const done = await confirm.run(() => confirmEnrolment(credentials, code));
    if (done === undefined) {
      // A wrong code keeps what was typed and the focus in the field.
      input.current?.focus();
      return;
    }
    // The secret and the code leave the screen and the state; only the recovery codes stay, in the panel.
    setEnrolment(null);
    setMatrix(null);
    setCode('');
    setCodes(done.recovery_codes);
  };

  if (codes !== null) {
    return <RecoveryCodesPanel t={t} codes={codes} onDone={onDone} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: t.text2 }}>{tr('twofa.intro')}</p>

      {enrolment === null && start.error !== null ? (
        <>
          <ErrorLine t={t} id="twofa-start-error" text={start.error} />
          <AuthButton
            t={t}
            type="button"
            quiet
            label={tr('common.retry')}
            onClick={() => {
              void begin();
            }}
          />
        </>
      ) : null}
      {enrolment === null && start.error === null ? (
        <div
          role="status"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, fontSize: 13, color: t.text2 }}
        >
          <Loader2 size={16} className="nm-spin" aria-hidden="true" />
          {tr('common.loading')}
        </div>
      ) : null}

      {enrolment === null ? null : (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{tr('twofa.scan_lead')}</p>
          <QrCode t={t} matrix={matrix} />
          <ManualKey t={t} secret={enrolment.secret_base32} />
          <form
            onSubmit={(event) => {
              void verify(event);
            }}
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <Field t={t} id="twofa-code" label={tr('twofa.code_label')} hint={tr('twofa.code_hint')}>
              <input
                id="twofa-code"
                ref={input}
                value={code}
                onChange={(event) => {
                  setCode(sixDigits(event.target.value));
                  if (confirm.error !== null) {
                    confirm.clear();
                  }
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={confirm.error !== null}
                aria-describedby={confirm.error === null ? 'twofa-code-hint' : 'twofa-code-error twofa-code-hint'}
                style={{ ...inputStyle(t), fontFamily: MONO, fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }}
              />
            </Field>
            <ErrorLine t={t} id="twofa-code-error" text={confirm.error} />
            <AuthButton t={t} busy={confirm.busy} disabled={code.length !== CODE_LENGTH} label={tr('twofa.verify')} />
          </form>
        </>
      )}

      {onCancel === undefined ? null : (
        <AuthButton t={t} type="button" quiet disabled={confirm.busy} label={tr('common.cancel')} onClick={onCancel} />
      )}
    </div>
  );
};
