import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { SessionUser } from '../../lib/auth';
import { signOutOtherDevices } from '../../lib/crypto/account';
import { useT } from '../../lib/i18n';
import { CredentialForm } from './CredentialForm';
import { DoneNote, ViewFrame } from './securityUi';

interface OtherDevicesViewProps {
  t: ThemeTokens;
  user: SessionUser;
  onBack: () => void;
}

/**
 * Sign out other devices: the password, then every other browser and phone that is signed in to this account is signed out. This device stays
 * signed in with its key (signing out of THIS device is the Sign out of the account menu; a password change ends the other devices too). Its
 * one visible line says both halves; the password field and the button say what to do.
 */
export const OtherDevicesView: React.FC<OtherDevicesViewProps> = ({ t, user, onBack }) => {
  const tr = useT();
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <ViewFrame t={t} title={tr('security.devices_title')} onBack={null}>
        <DoneNote t={t} text={tr('security.devices_done')} onBack={onBack} />
      </ViewFrame>
    );
  }
  return (
    <ViewFrame t={t} title={tr('security.devices_title')} onBack={onBack}>
      <CredentialForm
        t={t}
        id="security-devices"
        lead={tr('security.devices_hint')}
        submitLabel={tr('security.devices_action')}
        withCode={false}
        work={(password) => signOutOtherDevices(user, password)}
        onResult={() => {
          setDone(true);
        }}
      />
    </ViewFrame>
  );
};
