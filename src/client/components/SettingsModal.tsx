import React from 'react';
import { CircleAlert, CircleCheck, LogOut, ShieldCheck } from 'lucide-react';
import { BRAND_NAME } from '../../shared/i18n';
import type { ThemeTokens } from '../theme';
import { useIsAdmin, useLogout } from '../lib/auth';
import { useT, type MessageKey } from '../lib/i18n';
import { useSaveLanguage } from '../lib/language';
import { useSecretHeld } from '../lib/secretHold';
import { pushForSignOut, usePushNotifications } from '../lib/push';
import { useSaveSettings, useSettings, type Settings, type SettingsPatch } from '../lib/settings';
import { Button, Dialog, RadioGroup, Section, Spinner, Switch, TabPanel, Tabs, TextArea, TextField } from '../ui';
import { AccountActivity } from './AccountActivity';
import { LanguagePicker } from './LanguagePicker';
import { ErrorLine } from './auth/authUi';
import { DeveloperDocs, DOCS_TABS, type DocsTab } from './settings/DeveloperDocs';
import { SecuritySection } from './security/SecuritySection';
import './settings/settings.css';

interface SettingsModalProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
  onToggleDark: () => void;
  /** Opens the admin console (and the caller closes Settings). Only offered to admins. */
  onOpenAdmin: () => void;
}

type Tab = 'account' | DocsTab;

const ACCOUNT_TAB: { id: Tab; labelKey: MessageKey } = { id: 'account', labelKey: 'term.account' };
// The technical tabs (architecture, deployment, mail setup) are for admins: they are about the deployment, not about a person's mail.
const ADMIN_TABS: { id: Tab; labelKey: MessageKey }[] = [ACCOUNT_TAB, ...DOCS_TABS];
const MEMBER_TABS: { id: Tab; labelKey: MessageKey }[] = [ACCOUNT_TAB];

// The ids of the tabs and their panels are `settings-tab-<id>` and `settings-panel-<id>` (ui/Tabs builds them from this prefix).
const TABS_ID = 'settings';

const SETTING_KEYS: (keyof SettingsPatch)[] = ['display_name', 'signature'];

type Feedback = { type: 'saved' } | { type: 'offline' } | { type: 'error'; text: string } | null;

/**
 * Where focus goes when Settings closes and the button that opened it is gone: on a phone the opener sits in the mailbox drawer, which
 * unmounts when Settings opens (the browser then reports BODY as the focused element), and the header button that opens the drawer takes
 * over (found by its data attribute, never by its label). Looked up when the dialog closes, never earlier.
 */
const NAV_TOGGLE: React.RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    return document.querySelector<HTMLElement>('button[data-nav-toggle="mailboxes"]');
  }
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, t, onClose, onToggleDark, onOpenAdmin }) => {
  const tr = useT();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = React.useState<Tab>('account');
  // The dialog element itself takes focus when Settings opens (not its first field, which on a phone would raise the keyboard).
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  const settingsQuery = useSettings();
  const { mutate: saveSettings, isPending: isSaving } = useSaveSettings();
  const { mutateAsync: logOut } = useLogout({ push: pushForSignOut() });
  const { mutateAsync: saveLanguage } = useSaveLanguage();
  const push = usePushNotifications();
  const settings = settingsQuery.data;
  // null = the form is untouched and shows the saved settings.
  const [form, setForm] = React.useState<Settings | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);
  // A screen inside shows a secret once (two-factor recovery codes): every way out of the dialog waits until the person has saved it (C-7).
  const secretHeld = useSecretHeld();
  const leave = React.useCallback(() => {
    if (!secretHeld) {
      onClose();
    }
  }, [secretHeld, onClose]);

  // Each time the dialog opens, start from the saved settings on the Account tab (adjusting state while rendering, not in an effect).
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTab('account');
      setForm(null);
      setFeedback(null);
      setSignOutError(null);
    }
  }

  if (!isOpen) {
    return null;
  }

  const values = form ?? settings;
  const tabs = isAdmin ? ADMIN_TABS : MEMBER_TABS;
  // A member who was an admin a moment ago (the dialog is open while the role changes) lands on the Account tab.
  const shownTab: Tab = tabs.some((item) => item.id === tab) ? tab : 'account';
  const dirty = form !== null && settings !== undefined && SETTING_KEYS.some((key) => form[key] !== settings[key]);

  const edit = (key: keyof SettingsPatch, value: string) => {
    if (values === undefined) {
      return;
    }
    setForm({ ...values, [key]: value });
    setFeedback(null);
  };

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (form === null || !dirty || isSaving) {
      return;
    }
    setFeedback(null);
    saveSettings(
      { display_name: form.display_name.trim(), signature: form.signature.trimEnd() },
      {
        onSuccess: () => {
          setForm(null);
          setFeedback({ type: 'saved' });
        },
        // fetch rejects with a TypeError when offline: its own text ('Failed to fetch') tells the user nothing.
        onError: (error) => setFeedback(error instanceof TypeError ? { type: 'offline' } : { type: 'error', text: error.message })
      }
    );
  };

  const signOut = async () => {
    // Disabled from the first click on, so a second click cannot start another round.
    setSigningOut(true);
    setSignOutError(null);
    // The key is wiped first, always; the endpoint of this browser's push subscription then travels with the logout request, which ends the
    // session and deletes that subscription on the server in one batch; the browser's own subscription is dropped after the answer (CK-16).
    // A push service that cannot be reached no longer keeps the login and the key on the device.
    try {
      await logOut();
    } catch (error) {
      // The login stays (an HttpOnly cookie cannot be cleared from here), the key is already gone, and the button is usable again.
      setSignOutError(error instanceof Error ? error.message : tr('fail.sign_out'));
      setSigningOut(false);
    }
  };

  const pushStatus = push.busy
    ? tr('settings.push_working')
    : push.permission === 'denied'
      ? tr('settings.push_blocked')
      : push.subscribed
        ? tr('settings.push_on')
        : tr('settings.push_off');

  const account = (
    <>
      <Section>
        {values === undefined ? (
          settingsQuery.isError ? (
            <div className="st-inline">
              <ErrorLine t={t} id="settings-load-error" text={tr('settings.load_failed')} />
              <Button
                size="sm"
                onClick={() => {
                  void settingsQuery.refetch();
                }}
              >
                {tr('common.retry')}
              </Button>
            </div>
          ) : (
            <p role="status" className="st-status">
              <Spinner decorative /> {tr('common.loading')}
            </p>
          )
        ) : (
          <form onSubmit={submit} className="st-form">
            <TextField
              id="settings-name"
              label={tr('term.display_name')}
              type="text"
              autoComplete="name"
              value={values.display_name}
              onChange={(e) => edit('display_name', e.target.value)}
              maxLength={100}
              placeholder={tr('settings.display_name_placeholder')}
            />
            <TextField
              id="settings-from"
              label={tr('settings.your_address')}
              type="email"
              readOnly
              value={values.email}
              hint={tr('settings.address_hint')}
            />
            <TextArea
              id="settings-signature"
              label={tr('term.signature')}
              rows={4}
              value={values.signature}
              onChange={(e) => edit('signature', e.target.value)}
              maxLength={2000}
              placeholder={tr('settings.signature_placeholder')}
            />
            <div className="st-actions">
              <Button type="submit" variant="primary" loading={isSaving} disabled={!dirty}>
                {isSaving ? tr('settings.saving') : tr('common.save')}
              </Button>
              {feedback?.type === 'saved' ? (
                <p role="status" className="st-feedback" data-tone="success">
                  <CircleCheck size={16} aria-hidden="true" />
                  {tr('settings.saved')}
                </p>
              ) : null}
              {feedback?.type === 'error' || feedback?.type === 'offline' ? (
                <p role="alert" className="st-feedback" data-tone="danger">
                  <CircleAlert size={16} aria-hidden="true" />
                  {feedback.type === 'offline' ? tr('settings.save_offline') : feedback.text}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </Section>

      <AccountActivity t={t} />
      <SecuritySection t={t} />

      {isAdmin ? (
        <Section headingLevel={3} title={tr('term.admin_console')} description={tr('settings.admin_hint')}>
          <Button size="sm" leadingIcon={<ShieldCheck size={16} aria-hidden="true" />} onClick={onOpenAdmin} disabled={secretHeld}>
            {tr('settings.open_admin')}
          </Button>
        </Section>
      ) : null}

      <Section headingLevel={3} title={tr('settings.appearance')}>
        {/* onToggleDark flips the theme: it runs only for the choice that is not the theme on screen. */}
        <RadioGroup
          className="st-theme"
          label={tr('settings.appearance')}
          options={[
            { value: 'light', label: tr('settings.light_theme') },
            { value: 'dark', label: tr('settings.dark_theme') }
          ]}
          value={t.dark ? 'dark' : 'light'}
          onChange={(value) => {
            if ((value === 'dark') !== t.dark) {
              onToggleDark();
            }
          }}
        />
      </Section>

      <Section headingLevel={3} title={tr('lang.label')}>
        <LanguagePicker t={t} id="settings-language-select" onChosen={saveLanguage} />
      </Section>

      <Section headingLevel={3} title={tr('term.notifications')}>
        {push.supported ? (
          <>
            {/* The status line under the label is read out when it changes (working, blocked, on, off): the region is polite and reads only what
                changed. The switch stays usable when the browser blocks notifications: a click asks again (Notification.requestPermission). */}
            <div className="st-push" data-denied={push.permission === 'denied' ? 'true' : undefined} aria-live="polite" aria-atomic="false">
              <Switch
                id="settings-push"
                label={tr('settings.push_device')}
                hint={pushStatus}
                checked={push.subscribed}
                disabled={push.busy}
                onChange={() => {
                  void (push.subscribed ? push.disable() : push.enable());
                }}
              />
            </div>
            <ErrorLine t={t} id="settings-push-error" text={push.error} />
            <div className="st-actions">
              <Button
                size="sm"
                disabled={!push.subscribed || push.busy}
                onClick={() => {
                  void push.sendTest();
                }}
              >
                {tr('settings.push_test')}
              </Button>
            </div>
          </>
        ) : (
          <p className="st-muted">{tr('settings.push_unsupported', { brand: BRAND_NAME })}</p>
        )}
      </Section>
    </>
  );

  const content = shownTab === 'account' ? account : <DeveloperDocs t={t} tab={shownTab} />;

  return (
    // Rendered in place (no portal): Settings sits under the toast and renders on the server too, where the C-7 test counts its buttons.
    // While a secret is held (C-7) the X shows disabled and Escape and the scrim do nothing; every way out still goes through `leave`.
    <Dialog
      inline
      open
      onClose={leave}
      closeDisabled={secretHeld}
      title={tr('term.settings')}
      size="lg"
      ref={dialogRef}
      initialFocusRef={dialogRef}
      returnFocusRef={NAV_TOGGLE}
      rootClassName="st-root"
      className="st-dialog"
      toolbar={
        tabs.length > 1 ? (
          <Tabs
            id={TABS_ID}
            className="st-tabs"
            grid
            label={tr('settings.sections_label')}
            // While a secret is held the tabs do not move either: the screen that shows it stays where it is.
            tabs={tabs.map((item) => ({ value: item.id, label: tr(item.labelKey), disabled: secretHeld }))}
            value={shownTab}
            onChange={(value) => {
              const next = tabs.find((item) => item.id === value);
              if (next !== undefined && !secretHeld) {
                setTab(next.id);
              }
            }}
          />
        ) : undefined
      }
      footer={
        <>
          <Button
            disabled={signingOut || secretHeld}
            leadingIcon={<LogOut size={16} aria-hidden="true" />}
            onClick={() => {
              void signOut();
            }}
          >
            {signingOut ? tr('settings.signing_out') : tr('auth.sign_out')}
          </Button>
          {signOutError === null ? null : (
            <p role="alert" className="st-foot-msg">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{signOutError}</span>
            </p>
          )}
          <Button onClick={leave} disabled={secretHeld}>
            {tr('common.close')}
          </Button>
        </>
      }
    >
      {tabs.length > 1 ? (
        <TabPanel tabsId={TABS_ID} value={shownTab} selected={shownTab}>
          {content}
        </TabPanel>
      ) : (
        <div id={`${TABS_ID}-panel-account`}>{content}</div>
      )}
    </Dialog>
  );
};
