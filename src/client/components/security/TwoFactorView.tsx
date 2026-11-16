import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThemeTokens } from '../../theme';
import { applySignedIn } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { disableTwoFactor, enrolmentCredentials, newRecoveryCodes } from '../../lib/crypto/account';
import type { GateCredentials } from '../../lib/crypto/gateCredentials';
import { useT } from '../../lib/i18n';
import { Banner } from '../../ui';
import { RecoveryCodesPanel } from '../auth/RecoveryCodesPanel';
import { TwoFactorEnrolment } from '../auth/TwoFactorEnrolment';
import { CredentialForm } from './CredentialForm';
import { DoneNote, ViewFrame } from './securityUi';

export type TwoFactorMode = 'on' | 'codes' | 'off';

interface InnerProps {
  t: ThemeTokens;
  user: SessionUser;
  onBack: () => void;
}

/** The password, then the enrolment screen (QR code, six-digit check, recovery codes). The session learns about it once the codes were saved. */
const TurnOn: React.FC<InnerProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  // What the enrolment repeats with its two requests (made from the password just typed): in state only while that screen is open.
  const [credentials, setCredentials] = React.useState<GateCredentials | null>(null);
  const [done, setDone] = React.useState(false);
  // Three steps for the person (J4-09): the password, the app (QR code and a code), the recovery codes.
  const [phase, setPhase] = React.useState<'scan' | 'codes'>('scan');

  if (done) {
    return (
      <ViewFrame t={t} title={tr('term.two_factor')} onBack={null}>
        <DoneNote t={t} text={tr('security.on_done')} onBack={onBack} />
      </ViewFrame>
    );
  }
  if (credentials !== null) {
    return (
      <ViewFrame t={t} title={tr('term.two_factor')} onBack={null} step={{ current: phase === 'codes' ? 3 : 2, total: 3 }}>
        <TwoFactorEnrolment
          t={t}
          credentials={credentials}
          onCancel={onBack}
          onPhase={setPhase}
          // The codes at the end are a part of this view, whose title is an h4 (ViewFrame).
          headingLevel={5}
          onDone={() => {
            setCredentials(null);
            setDone(true);
            applySignedIn(queryClient, { ...user, totp_enabled: true });
          }}
        />
      </ViewFrame>
    );
  }
  return (
    <ViewFrame t={t} title={tr('term.two_factor')} onBack={onBack} step={{ current: 1, total: 3 }}>
      {/* What two-factor sign-in is, once, before the password (the next step explains the app and its code: J4-39). */}
      <p className="st-lead">{tr('twofa.intro')}</p>
      <CredentialForm
        t={t}
        id="security-on"
        lead={tr('security.on_lead')}
        submitLabel={tr('gate.continue')}
        withCode={false}
        work={(password) => enrolmentCredentials(user, password)}
        onResult={setCredentials}
      />
    </ViewFrame>
  );
};

/** Password and a current code, then a fresh set of recovery codes (shown once); the old set stops working. */
const NewCodes: React.FC<InnerProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const [codes, setCodes] = React.useState<string[] | null>(null);

  if (codes !== null) {
    // J3-41: one heading (the view's, which takes focus when the codes replace the form) and the fact that the old codes stopped working
    // as a quiet notice under it, not a second heading of the same weight with the sentence between them.
    return (
      <ViewFrame t={t} title={tr('security.codes_new_title')} onBack={null}>
        <Banner tone="info" live={false}>
          {tr('security.codes_replace_note')}
        </Banner>
        <RecoveryCodesPanel t={t} codes={codes} onDone={onBack} showHeading={false} />
      </ViewFrame>
    );
  }
  return (
    <ViewFrame t={t} title={tr('term.recovery_codes')} onBack={onBack}>
      <CredentialForm
        t={t}
        id="security-codes"
        lead={tr('security.codes_lead')}
        submitLabel={tr('security.new_codes')}
        note={tr('security.other_devices_note')}
        withCode
        work={(password, code) => newRecoveryCodes(user, password, code)}
        onResult={setCodes}
      />
    </ViewFrame>
  );
};

/** Password and a current code, then two-factor sign-in is off. The Worker refuses it for an admin and where the organisation requires it. */
const TurnOff: React.FC<InnerProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <ViewFrame t={t} title={tr('term.two_factor')} onBack={null}>
        <DoneNote t={t} text={tr('security.off_done')} onBack={onBack} />
      </ViewFrame>
    );
  }
  return (
    <ViewFrame t={t} title={tr('term.two_factor')} onBack={onBack}>
      <CredentialForm
        t={t}
        id="security-off"
        lead={tr('security.off_lead')}
        submitLabel={tr('security.turn_off')}
        note={tr('security.other_devices_note')}
        withCode
        danger
        work={(password, code) => disableTwoFactor(user, password, code)}
        onResult={(next) => {
          setDone(true);
          applySignedIn(queryClient, next);
        }}
      />
    </ViewFrame>
  );
};

interface TwoFactorViewProps {
  t: ThemeTokens;
  user: SessionUser;
  mode: TwoFactorMode;
  onBack: () => void;
}

/** The three things a person does with two-factor sign-in in Settings: turn it on, get new recovery codes, turn it off. */
export const TwoFactorView: React.FC<TwoFactorViewProps> = ({ t, user, mode, onBack }) => {
  switch (mode) {
    case 'on': {
      return <TurnOn t={t} user={user} onBack={onBack} />;
    }
    case 'codes': {
      return <NewCodes t={t} user={user} onBack={onBack} />;
    }
    case 'off': {
      return <TurnOff t={t} user={user} onBack={onBack} />;
    }
  }
};
