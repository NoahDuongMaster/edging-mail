import React from 'react';
import { CircleCheck } from 'lucide-react';
import { adminErrorText } from '../../lib/admin/types';
import { announce } from '../../lib/announce';
import { useT } from '../../lib/i18n';
import { useSaveOutsidePictures } from '../../lib/language';
import { Switch } from '../../ui';
import { ErrorText, Group, tipLines } from './adminUi';

const SWITCH_ID = 'admin-outside-pictures';

/**
 * Whether the server may look up the pictures of people who write from outside (Gravatar, then Libravatar): one switch for the whole
 * organisation, off until an admin turns it on. What it costs in privacy is the sentence under the title (a hash of the sender's address goes
 * from the server, never from a browser); the details are in the InfoTip. It takes effect at once and the server asks for nothing more (no
 * code, no typed address), so there is no question here. The switch shows what the server has: it changes once the server has answered
 * and the settings are read again, and it cannot be pressed meanwhile.
 */
export const OutsidePictures: React.FC<{ enabled: boolean | undefined }> = ({ enabled }) => {
  const tr = useT();
  const save = useSaveOutsidePictures();

  // The switch is off while the request runs, and a button that is turned off drops the keyboard's place to the page: it gets the focus back
  // when it is on again, only if it had it when it was pressed.
  const hadFocus = React.useRef(false);
  const { isPending } = save;
  React.useEffect(() => {
    if (!isPending && hadFocus.current) {
      hadFocus.current = false;
      document.querySelector<HTMLElement>(`#${SWITCH_ID}`)?.focus({ preventScroll: true });
    }
  }, [isPending]);

  return (
    <Group
      title={tr('admin.pictures_title')}
      description={tr('admin.pictures_desc')}
      info={tipLines([
        tr('admin.pictures_tip_sent'),
        tr('admin.pictures_tip_kept'),
        tr('admin.pictures_tip_unverified'),
        tr('admin.pictures_tip_later')
      ])}
    >
      <Switch
        id={SWITCH_ID}
        label={tr('admin.pictures_switch')}
        checked={enabled === true}
        disabled={enabled === undefined || save.isPending}
        onChange={(next) => {
          hadFocus.current = document.activeElement?.id === SWITCH_ID;
          // The answer is said only while this card is on screen (a callback of `mutate` is dropped once it is gone); the settings are read again either way.
          save.mutate(next, { onSuccess: () => announce(tr('settings.saved')) });
        }}
        className="adm-switch"
      />
      {save.isSuccess || save.isError ? (
        <div className="adm-row-note">
          {save.isSuccess ? (
            <p className="adm-feedback">
              <CircleCheck size={16} aria-hidden="true" />
              {tr('settings.saved')}
            </p>
          ) : null}
          {save.isError ? <ErrorText>{adminErrorText(save.error)}</ErrorText> : null}
        </div>
      ) : null}
    </Group>
  );
};
