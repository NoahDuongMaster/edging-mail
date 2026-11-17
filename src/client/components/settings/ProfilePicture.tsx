import React from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { announce } from '../../lib/announce';
import { useRemoveAvatar, useSaveAvatar } from '../../lib/avatar';
import { prepareAvatar } from '../../lib/avatarCanvas';
import { AvatarImageError, type AvatarProblem } from '../../lib/avatarImage';
import { useT, type MessageKey } from '../../lib/i18n';
import { Avatar, Button } from '../../ui';
import { SettingsGroup } from './SettingsPage';
import './settings.css';

interface ProfilePictureProps {
  /** The name the initials are made from (the tile under a picture, and in its place without one). */
  name: string;
  /** The address of the person's own picture, none yet: undefined. */
  picture: string | undefined;
}

/** What went wrong or right, in words (an icon is the second cue). */
type Result = { tone: 'success' | 'danger'; text: string } | null;

// The words for each way a chosen file can be turned down before it is sent (written out whole, not built from the problem's name).
const PROBLEM_KEYS: Record<AvatarProblem, MessageKey> = {
  too_large: 'avatar.too_large',
  not_image: 'avatar.not_image',
  cannot_read: 'avatar.cannot_read'
};

/**
 * Settings > Profile > the picture: the person's face (their picture, or the initials), Change picture, and Remove while there is a picture.
 * A chosen file is cut to a small square in the browser (lib/avatarCanvas.ts) and sent as one `PUT /api/avatar`; the session then holds the
 * new id, so the rail and the phone's account button change with it. The picture is shown on mail the person sends to people of this
 * server and never leaves it, which the help line says.
 *
 * Both buttons wait while a request runs (aria-disabled, not `disabled`, so the focused one keeps focus; the pressed one shows the spinner); a result that arrives after the section was left changes nothing
 * on screen (the session still takes it); the file field is emptied after each choice so the same file can be chosen twice; and when Remove
 * takes its own button away, focus goes to Change picture, not to the page.
 */
export function ProfilePicture({ name, picture }: ProfilePictureProps): React.ReactElement {
  const tr = useT();
  const { mutateAsync: saveAvatar } = useSaveAvatar();
  const { mutateAsync: removeAvatar } = useRemoveAvatar();
  const [busy, setBusy] = React.useState<'save' | 'remove' | null>(null);
  const [result, setResult] = React.useState<Result>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const changeRef = React.useRef<HTMLButtonElement | null>(null);
  const hintId = React.useId();
  const labelId = React.useId();

  // Mounted: a result that comes back after Settings closed (or another section opened) is not drawn. Set in the effect and cleared in its
  // cleanup, so StrictMode's second run leaves it true.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = (next: NonNullable<Result>, refocus = false) => {
    if (!mounted.current) {
      return;
    }
    setBusy(null);
    setResult(next);
    // Status goes through the one live region, failures at once (WCAG 4.1.3).
    announce(next.text, { assertive: next.tone === 'danger' });
    if (refocus) {
      changeRef.current?.focus();
    }
  };

  // fetch rejects with a TypeError when offline; any other failure has its own words (`invalid_avatar` among them, from the catalogue).
  const failure = (error: unknown, fallback: MessageKey): NonNullable<Result> => ({
    tone: 'danger',
    text: error instanceof TypeError ? tr('app.no_connection') : error instanceof Error ? error.message : tr(fallback)
  });

  const upload = async (file: File) => {
    setBusy('save');
    setResult(null);
    let ready;
    try {
      ready = await prepareAvatar(file);
    } catch (error) {
      finish({ tone: 'danger', text: tr(PROBLEM_KEYS[error instanceof AvatarImageError ? error.problem : 'cannot_read']) });
      return;
    }
    try {
      await saveAvatar(ready);
      finish({ tone: 'success', text: tr('settings.picture_saved') });
    } catch (error) {
      finish(failure(error, 'fail.avatar_save'));
    }
  };

  const remove = async () => {
    setBusy('remove');
    setResult(null);
    try {
      await removeAvatar();
      finish({ tone: 'success', text: tr('settings.picture_removed') }, true);
    } catch (error) {
      finish(failure(error, 'fail.avatar_remove'));
    }
  };

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const file = field.files?.[0];
    // Emptied at once, so choosing the same file again (after a refusal, or to retry) still fires a change.
    field.value = '';
    if (file !== undefined && busy === null) {
      void upload(file);
    }
  };

  return (
    <SettingsGroup>
      <div className="st-picture">
        <Avatar name={name} size="xl" selected src={picture} className="st-picture-face" />
        <div className="st-row-text">
          <span id={labelId} className="st-row-label">
            {tr('settings.picture')}
          </span>
          <span id={hintId} className="st-row-hint">
            {tr('settings.picture_help')}
          </span>
          {result === null ? null : (
            <p className="st-feedback" data-tone={result.tone}>
              {result.tone === 'success' ? <CircleCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
              {result.text}
            </p>
          )}
        </div>
        {/* A group named by the row's label: a screen reader says "Profile picture" when it enters, so a bare "Remove" is not ambiguous. */}
        <div className="st-row-control" role="group" aria-labelledby={labelId}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={choose} />
          <Button
            ref={changeRef}
            size="sm"
            loading={busy === 'save'}
            aria-disabled={busy === null ? undefined : true}
            aria-describedby={hintId}
            onClick={() => {
              if (busy === null) {
                fileRef.current?.click();
              }
            }}
          >
            {picture === undefined ? tr('settings.picture_add') : tr('settings.picture_change')}
          </Button>
          {picture === undefined ? null : (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'remove'}
              aria-disabled={busy === null ? undefined : true}
              onClick={() => {
                if (busy === null) {
                  void remove();
                }
              }}
            >
              {tr('common.remove')}
            </Button>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
