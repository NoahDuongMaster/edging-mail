import React from 'react';
import type { ThemeTokens } from '../../theme';
import { confirmEnrolment, startEnrolment } from '../../lib/crypto/gates';
import type { EnrolmentStart } from '../../lib/crypto/gates';
import type { GateCredentials } from '../../lib/crypto/gateCredentials';
import { firstInvalid, useFieldFocus } from '../../lib/fieldFocus';
import { qrMatrix } from '../../lib/crypto/qr';
import type { QrMatrix } from '../../lib/crypto/qr';
import { useT } from '../../lib/i18n';
import { useAction } from '../../lib/useAction';
import { CopyButton, SecretBox, Spinner, TextField, useMediaMatch } from '../../ui';
import { AuthButton, ErrorLine, TextButton } from './authUi';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';

// Gate 3 (and Settings): turn on two-factor sign-in. The server makes a NEW secret every time the enrolment starts and it only counts once a
// code from it is confirmed; the confirmation answers with the single-use recovery codes, which RecoveryCodesPanel shows once. The secret is
// in this component's state only while the screen is mounted, and it is dropped the moment the codes appear. The caller wraps this in an
// `AuthCard` WITHOUT `onSubmit` (this renders its own form) and refetches the session in `onDone`.

const CODE_LENGTH = 6;
// The empty border a scanner needs around the code, drawn by the viewBox (the matrix itself has none).
const QUIET_ZONE = 4;
// A phone, or any touch screen: the authenticator app is most likely on this very device, which cannot scan its own screen.
const ON_THE_PHONE = '(max-width: 640px), (pointer: coarse)';

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
  if (matrix === 'failed') {
    return <ErrorLine t={t} id="twofa-qr-error" text={tr('twofa.qr_failed')} />;
  }
  if (matrix === null) {
    return (
      <div role="status" className="au-qr" data-state="loading">
        <Spinner decorative />
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
      className="au-qr"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={total} height={total} fill="#FFFFFF" />
      <path d={matrix.path} fill="#000000" shapeRendering="crispEdges" />
    </svg>
  );
};

/** The fallback for a phone that cannot scan: the same secret as text, in groups of four, with a Copy button. */
const ManualKey: React.FC<{ t: ThemeTokens; secret: string; title: string }> = ({ t, secret, title }) => {
  const tr = useT();
  const [copyFailed, setCopyFailed] = React.useState(false);
  return (
    <div className="au-manual">
      <p className="au-strong">{title}</p>
      <SecretBox label={tr('twofa.manual_title')} value={groupSecret(secret)} layout="inline" data-testid="twofa-secret">
        <CopyButton text={secret} size="md" onResult={(result) => setCopyFailed(result === 'failed')} />
      </SecretBox>
      {copyFailed ? <ErrorLine t={t} id="twofa-secret-copy-error" text={tr('twofa.copy_failed')} /> : null}
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
  /** The level of the heading of the recovery codes shown at the end (RecoveryCodesPanel): 2 by default, 5 in a view of Settings. */
  headingLevel?: 2 | 3 | 4 | 5;
  /** Told when the screen moves on from the QR code to the recovery codes, so the caller's step indicator follows ("Step 2 of 2"). */
  onPhase?: (phase: 'scan' | 'codes') => void;
}

export const TwoFactorEnrolment: React.FC<TwoFactorEnrolmentProps> = ({ t, credentials, onDone, onCancel, headingLevel = 2, onPhase }) => {
  const tr = useT();
  const start = useAction();
  const confirm = useAction();
  const { run: runStart } = start;
  const [enrolment, setEnrolment] = React.useState<EnrolmentStart | null>(null);
  const [matrix, setMatrix] = React.useState<QrMatrix | 'failed' | null>(null);
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<readonly string[] | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const started = React.useRef(false);
  const focusLater = useFieldFocus();
  const onThePhone = useMediaMatch(ON_THE_PHONE);

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
    if (confirm.busy) {
      return;
    }
    // Verify can always be pressed: fewer than six digits is said under the field, and the keyboard goes there.
    setSubmitted(true);
    const toFix = firstInvalid([['twofa-code', code.length !== CODE_LENGTH]]);
    if (toFix !== undefined) {
      focusLater(toFix);
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
    onPhase?.('codes');
  };

  if (codes !== null) {
    return <RecoveryCodesPanel t={t} codes={codes} onDone={onDone} headingLevel={headingLevel} />;
  }

  const codeError = submitted && code.length !== CODE_LENGTH ? tr('twofa.code_required') : undefined;

  return (
    <div className="au-stack">
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
        <div role="status" className="au-loading">
          <Spinner decorative />
          {tr('common.loading')}
        </div>
      ) : null}

      {enrolment === null ? null : (
        <>
          {/* What an authenticator app is, with names a first-timer can look for (J4-10); the only explanation of the six-digit code on this
              step (J4-39: Settings says what two-factor sign-in is on the step before). */}
          <p className="au-muted">{tr(onThePhone ? 'twofa.app_hint_phone' : 'twofa.app_hint')}</p>
          {onThePhone ? (
            // J5-21: the app is on this phone, which cannot scan its own screen. First the link that opens the account in the app (the same
            // otpauth URI as the QR code), then the key with Copy, then the QR code for an app on another device.
            <>
              <a href={enrolment.otpauth_uri} className="ui-btn au-open-app" data-variant="secondary" data-size="lg">
                {tr('twofa.open_app')}
              </a>
              <ManualKey t={t} secret={enrolment.secret_base32} title={tr('twofa.manual_title_phone')} />
              <p className="au-strong">{tr('twofa.scan_other_device')}</p>
              <div className="au-enrol-scan">
                <QrCode t={t} matrix={matrix} />
              </div>
            </>
          ) : (
            <>
              <p className="au-strong">{tr('twofa.scan_lead')}</p>
              {/* Scan, or type the key: the QR code and the manual key side by side where the card is wide enough, one above the other. */}
              <div className="au-enrol">
                <div className="au-enrol-scan">
                  <QrCode t={t} matrix={matrix} />
                </div>
                <ManualKey t={t} secret={enrolment.secret_base32} title={tr('twofa.manual_title')} />
              </div>
            </>
          )}
          <form
            onSubmit={(event) => {
              void verify(event);
            }}
            noValidate
            className="au-stack au-part"
          >
            <TextField
              id="twofa-code"
              ref={input}
              label={tr('twofa.code_label')}
              hint={tr('twofa.code_hint')}
              error={codeError}
              mono
              className="au-otp-large"
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
              aria-invalid={codeError !== undefined || confirm.error !== null}
              aria-describedby={confirm.error === null ? undefined : 'twofa-code-error-server'}
            />
            <ErrorLine t={t} id="twofa-code-error-server" text={confirm.error} />
            <AuthButton t={t} busy={confirm.busy} label={tr('twofa.verify')} />
          </form>
        </>
      )}

      {onCancel === undefined ? null : (
        // A way back is a quiet text button under the main one, as under the recovery key (RecoveryKeyPanel).
        <div className="au-alt">
          <TextButton t={t} label={tr('common.cancel')} onClick={onCancel} disabled={confirm.busy} />
        </div>
      )}
    </div>
  );
};
