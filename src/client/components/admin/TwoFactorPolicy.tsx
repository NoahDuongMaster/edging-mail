import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { auditKey } from '../../lib/admin/audit';
import { apiPut } from '../../lib/api';
import { announce } from '../../lib/announce';
import { sessionKey, useSession } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { orgSettingsKey } from '../../lib/language';
import { Button, InfoTip, Switch, TextField } from '../../ui';
import { ErrorText, Group, tipLines } from './adminUi';
import { useAdminAction } from './useAdminAction';

const SWITCH_ID = 'admin-require-2fa';
const FIELD_ID = 'admin-require-2fa-confirm';

/**
 * Whether everyone must use two-step sign-in (admins always must). Turning it on takes effect at once. Turning it off for members is asked
 * first: the admin types their own address (the server checks it), the server may ask for a fresh authenticator code (StepUp), and the
 * change is logged and told to the other admins. It never turns off anybody's own two-step sign-in.
 */
export const TwoFactorPolicy: React.FC<{ required: boolean | undefined }> = ({ required }) => {
  const tr = useT();
  const queryClient = useQueryClient();
  const email = useSession().data?.user?.email ?? '';
  const action = useAdminAction();
  const [confirming, setConfirming] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [mismatch, setMismatch] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // The field takes the focus when the question appears; the switch gets it back when the question goes away.
  const shown = React.useRef(false);
  React.useEffect(() => {
    if (confirming !== shown.current) {
      document.querySelector<HTMLElement>(`#${confirming ? FIELD_ID : SWITCH_ID}`)?.focus({ preventScroll: true });
    }
    shown.current = confirming;
  }, [confirming]);

  const change = async (body: { require_2fa: boolean; confirm?: string }) => {
    setSaved(false);
    const done = await action.run(async () => {
      await apiPut('/api/admin/settings', body, 'fail.policy_save');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgSettingsKey }),
        queryClient.invalidateQueries({ queryKey: sessionKey }),
        queryClient.invalidateQueries({ queryKey: auditKey })
      ]);
    });
    if (done) {
      setConfirming(false);
      setTyped('');
      setSaved(true);
      announce(tr('settings.saved'));
    }
  };

  const confirmOff = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy) {
      return;
    }
    // The button stays pressable: an address that is not the admin's own is said under the field.
    if (typed.trim().toLowerCase() !== email.toLowerCase()) {
      setMismatch(true);
      return;
    }
    void change({ require_2fa: false, confirm: typed.trim() });
  };

  const cancel = () => {
    setConfirming(false);
    setTyped('');
    setMismatch(false);
    action.clearError();
  };

  return (
    // One InfoTip after the card's title says what the rule is and what each state does (DESIGN-v4m R1); the switch shows the state.
    <Group
      title={tr('admin.policy_title')}
      info={tipLines([tr('admin.policy_desc'), tr('admin.policy_on_effect'), tr('admin.policy_off_effect')])}
    >
      <Switch
        id={SWITCH_ID}
        label={tr('admin.policy_switch')}
        // The switch shows what the server has: it stays on while the question is open, and goes off only once the change is made.
        checked={required === true}
        disabled={required === undefined || action.busy}
        onChange={(next) => {
          if (next) {
            void change({ require_2fa: true });
          } else if (confirming) {
            // Pressed again while the question is open: the question is taken back, as with Cancel.
            cancel();
          } else {
            setSaved(false);
            setConfirming(true);
          }
        }}
        className="ad-switch"
      />
      {confirming ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape is a shortcut for the Cancel button of this form; the buttons are the controls
        <form
          noValidate
          onSubmit={confirmOff}
          // Escape takes the question back, as Cancel does (not while the request runs).
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !action.busy) {
              event.stopPropagation();
              cancel();
            }
          }}
          className="ad-confirm"
        >
          {/* The consequence in one line; that the change is logged and told to the other admins, in its InfoTip. */}
          <p className="ad-text">
            {tr('admin.policy_off_body_short')}
            <InfoTip label={tr('admin.policy_turn_off')}>{tr('admin.policy_off_body')}</InfoTip>
          </p>
          <TextField
            id={FIELD_ID}
            label={tr('admin.policy_confirm_label', { address: email })}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setMismatch(false);
            }}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? `${FIELD_ID}-error` : undefined}
          />
          {mismatch ? <ErrorText id={`${FIELD_ID}-error`}>{tr('admin.policy_confirm_mismatch', { address: email })}</ErrorText> : null}
          <div className="ad-confirm-foot">
            <Button disabled={action.busy} onClick={cancel}>
              {tr('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={action.busy} loading={action.busy}>
              {tr('admin.policy_turn_off')}
            </Button>
          </div>
        </form>
      ) : null}
      {saved || action.error !== null ? (
        <div className="ad-row-note">
          {saved ? (
            <p className="ad-feedback">
              <CircleCheck size={16} aria-hidden="true" />
              {tr('settings.saved')}
            </p>
          ) : null}
          {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
        </div>
      ) : null}
    </Group>
  );
};
