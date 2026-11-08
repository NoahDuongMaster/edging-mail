import React from 'react';
import { Cloud, Loader2, LogOut, ShieldCheck, X } from 'lucide-react';
import { BRAND_NAME } from '../../shared/i18n';
import type { ThemeTokens } from '../theme';
import { useIsAdmin, useLogout } from '../lib/auth';
import { trapTab } from '../lib/focusTrap';
import { useT, type MessageKey } from '../lib/i18n';
import { useSaveLanguage } from '../lib/language';
import { useSecretHeld } from '../lib/secretHold';
import { pushForSignOut, usePushNotifications } from '../lib/push';
import { useSaveSettings, useSettings, type Settings, type SettingsPatch } from '../lib/settings';
import { AccountActivity } from './AccountActivity';
import { LanguagePicker } from './LanguagePicker';
import { DeveloperDocs, DOCS_TABS, type DocsTab } from './settings/DeveloperDocs';
import { SecuritySection } from './security/SecuritySection';

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

// Arrow keys wrap around; Home and End jump to the ends. null = not a tab key.
function tabAfterKey(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight': {
      return (current + 1) % count;
    }
    case 'ArrowLeft': {
      return (current + count - 1) % count;
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return count - 1;
    }
    default: {
      return null;
    }
  }
}

const SETTING_KEYS: (keyof SettingsPatch)[] = ['display_name', 'signature'];

type Feedback = { type: 'saved' } | { type: 'offline' } | { type: 'error'; text: string } | null;

interface SwitchProps {
  t: ThemeTokens;
  checked: boolean;
  /** Names the switch: the id of the element that holds its label. */
  labelledBy: string;
  onClick: () => void;
  busy?: boolean;
}

// A 44px target around a 44x26 track, as used for every on/off setting in this dialog.
const Switch: React.FC<SwitchProps> = ({ t, checked, labelledBy, onClick, busy = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={labelledBy}
    className="nm-tap"
    disabled={busy}
    onClick={onClick}
    style={{
      flex: 'none',
      width: 52,
      height: 44,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      border: 0,
      background: 'transparent',
      cursor: busy ? 'progress' : 'pointer'
    }}
  >
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 44,
        height: 26,
        borderRadius: 13,
        background: checked ? t.accent : t.text3,
        opacity: busy ? 0.6 : 1,
        transition: 'background 120ms ease'
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#FFFFFF',
          boxShadow: '0 1px 2px rgba(16,24,40,0.3)',
          transition: 'left 120ms ease'
        }}
      />
    </span>
  </button>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, t, onClose, onToggleDark, onOpenAdmin }) => {
  const tr = useT();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = React.useState<Tab>('account');
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  // Whether the latest press began on the backdrop itself: a drag that starts in a field and ends outside the card must not close the dialog.
  const pressedBackdrop = React.useRef(false);

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
  const heldLook: React.CSSProperties = secretHeld ? { opacity: 0.45, cursor: 'not-allowed' } : {};

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

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        leave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, leave]);

  // Move focus into the dialog on open and hand it back to the opener on close.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      // On a phone the opener sits in the mailbox drawer, which unmounts when Settings opens (the browser then reports BODY as the
      // focused element): the header button that opens the drawer takes over (found by its data attribute, never by its label).
      const openerGone = !opener || opener === document.body || !opener.isConnected;
      const target = openerGone ? document.querySelector<HTMLElement>('button[data-nav-toggle="mailboxes"]') : opener;
      target?.focus({ preventScroll: true });
    };
  }, [isOpen]);

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

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const next = tabAfterKey(
      event.key,
      tabs.findIndex((item) => item.id === shownTab),
      tabs.length
    );
    const target = next === null ? undefined : tabs[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    if (secretHeld) {
      return;
    }
    setTab(target.id);
    document.querySelector<HTMLElement>(`#settings-tab-${target.id}`)?.focus();
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

  const danger = t.dark ? '#F97066' : '#B42318';
  const card: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: t.raised,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  };
  const muted: React.CSSProperties = { color: t.text2, fontSize: 12.5, lineHeight: '19px', margin: 0 };
  const button: React.CSSProperties = {
    width: 36,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 10,
    background: 'transparent',
    color: t.text2,
    cursor: 'pointer'
  };
  const secondaryButton: React.CSSProperties = {
    height: 38,
    padding: '0 16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: `1px solid ${t.borderStrong}`,
    borderRadius: 10,
    background: t.surface,
    color: t.text,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer'
  };
  const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: t.text2 };
  const fieldInput: React.CSSProperties = {
    width: '100%',
    padding: '0 12px',
    border: `1px solid ${t.borderStrong}`,
    borderRadius: 10,
    background: t.surface,
    color: t.text,
    font: 'inherit',
    fontSize: 16
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- backdrop click is a pointer shortcut; Escape (window keydown) and the Close button are the keyboard routes
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(16,24,40,0.45)',
        outline: 'none'
      }}
      onKeyDown={(e) => trapTab(e, dialogRef.current)}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (pressedBackdrop.current) {
          pressedBackdrop.current = false;
          leave();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops clicks from reaching the backdrop; not an interactive control */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="nm-fade-in"
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 64px -24px rgba(16,24,40,0.32)',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${t.divider}` }}>
          <Cloud size={18} color={t.accent} aria-hidden="true" />
          <h2 id="settings-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>
            {tr('term.settings')}
          </h2>
          <button
            type="button"
            className="nm-tap"
            onClick={leave}
            disabled={secretHeld}
            aria-label={tr('common.close')}
            style={{ ...button, ...heldLook }}
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        {tabs.length > 1 ? (
          <div
            className="nm-settings-tabs"
            role="tablist"
            aria-label={tr('settings.sections_label')}
            style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${t.divider}` }}
          >
            {tabs.map((item) => {
              const on = shownTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`settings-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={on ? `settings-panel-${item.id}` : undefined}
                  tabIndex={on ? 0 : -1}
                  className="nm-tap-h nm-settings-tab"
                  onClick={() => setTab(item.id)}
                  disabled={secretHeld}
                  onKeyDown={onTabKeyDown}
                  style={{
                    height: 34,
                    padding: '0 10px',
                    border: 0,
                    borderRadius: 8,
                    background: on ? t.selBg : 'transparent',
                    color: on ? t.selText : t.text2,
                    fontSize: 13,
                    fontWeight: on ? 600 : 500,
                    cursor: 'pointer'
                  }}
                >
                  {tr(item.labelKey)}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          id={`settings-panel-${shownTab}`}
          role="tabpanel"
          aria-labelledby={tabs.length > 1 ? `settings-tab-${shownTab}` : 'settings-title'}
          style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {shownTab === 'account' ? (
            <>
              {values === undefined ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <p style={{ ...muted, color: settingsQuery.isError ? danger : t.text2 }}>
                    {settingsQuery.isError ? tr('settings.load_failed') : tr('common.loading')}
                  </p>
                  {settingsQuery.isError ? (
                    <button
                      type="button"
                      className="nm-tap-h"
                      onClick={() => {
                        void settingsQuery.refetch();
                      }}
                      style={secondaryButton}
                    >
                      {tr('common.retry')}
                    </button>
                  ) : null}
                </div>
              ) : (
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-name" style={fieldLabel}>
                      {tr('term.display_name')}
                    </label>
                    <input
                      id="settings-name"
                      className="nm-tap-h"
                      type="text"
                      autoComplete="name"
                      value={values.display_name}
                      onChange={(e) => edit('display_name', e.target.value)}
                      maxLength={100}
                      placeholder={tr('settings.display_name_placeholder')}
                      style={{ ...fieldInput, height: 44 }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-from" style={fieldLabel}>
                      {tr('settings.your_address')}
                    </label>
                    <input
                      id="settings-from"
                      type="email"
                      readOnly
                      value={values.email}
                      aria-describedby="settings-from-hint"
                      style={{ ...fieldInput, height: 44, background: t.raised, color: t.text2 }}
                    />
                    <p id="settings-from-hint" style={muted}>
                      {tr('settings.address_hint')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-signature" style={fieldLabel}>
                      {tr('term.signature')}
                    </label>
                    <textarea
                      id="settings-signature"
                      rows={4}
                      value={values.signature}
                      onChange={(e) => edit('signature', e.target.value)}
                      maxLength={2000}
                      placeholder={tr('settings.signature_placeholder')}
                      style={{ ...fieldInput, padding: '10px 12px', lineHeight: '22px', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="submit"
                      className="nm-tap-h"
                      disabled={!dirty || isSaving}
                      style={{
                        ...secondaryButton,
                        border: 0,
                        background: t.accent,
                        color: '#FFFFFF',
                        fontWeight: 600,
                        cursor: isSaving ? 'progress' : dirty ? 'pointer' : 'not-allowed',
                        opacity: dirty || isSaving ? 1 : 0.5
                      }}
                    >
                      {isSaving ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
                      {isSaving ? tr('settings.saving') : tr('common.save')}
                    </button>
                    {feedback?.type === 'saved' ? (
                      <span role="status" style={{ fontSize: 13, color: t.dark ? '#4ADE80' : '#15803D' }}>
                        {tr('settings.saved')}
                      </span>
                    ) : null}
                    {feedback?.type === 'error' || feedback?.type === 'offline' ? (
                      <span role="alert" style={{ fontSize: 13, color: danger }}>
                        {feedback.type === 'offline' ? tr('settings.save_offline') : feedback.text}
                      </span>
                    ) : null}
                  </div>
                </form>
              )}

              <AccountActivity t={t} />
              <SecuritySection t={t} />

              {isAdmin ? (
                <section aria-labelledby="settings-admin" style={card}>
                  <h3 id="settings-admin" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                    {tr('term.admin_console')}
                  </h3>
                  <p style={muted}>{tr('settings.admin_hint')}</p>
                  <div>
                    <button
                      type="button"
                      className="nm-tap-h"
                      onClick={onOpenAdmin}
                      disabled={secretHeld}
                      style={{ ...secondaryButton, ...heldLook }}
                    >
                      <ShieldCheck size={16} aria-hidden="true" />
                      {tr('settings.open_admin')}
                    </button>
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="settings-appearance" style={card}>
                <h3 id="settings-appearance" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                  {tr('settings.appearance')}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div id="settings-dark-label" style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {tr('settings.dark_theme')}
                  </div>
                  <Switch t={t} checked={t.dark} labelledBy="settings-dark-label" onClick={onToggleDark} />
                </div>
              </section>

              <section aria-labelledby="settings-language" style={card}>
                <h3 id="settings-language" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                  {tr('lang.label')}
                </h3>
                <LanguagePicker t={t} id="settings-language-select" onChosen={saveLanguage} />
              </section>

              <section aria-labelledby="settings-notifications" style={card}>
                <h3 id="settings-notifications" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                  {tr('term.notifications')}
                </h3>
                {push.supported ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div id="settings-push-label" style={{ fontSize: 13 }}>
                          {tr('settings.push_device')}
                        </div>
                        <p role="status" style={{ ...muted, color: push.permission === 'denied' ? danger : t.text2 }}>
                          {push.busy
                            ? tr('settings.push_working')
                            : push.permission === 'denied'
                              ? tr('settings.push_blocked')
                              : push.subscribed
                                ? tr('settings.push_on')
                                : tr('settings.push_off')}
                        </p>
                      </div>
                      <Switch
                        t={t}
                        checked={push.subscribed}
                        busy={push.busy}
                        labelledBy="settings-push-label"
                        onClick={() => {
                          void (push.subscribed ? push.disable() : push.enable());
                        }}
                      />
                    </div>
                    {push.error === null ? null : (
                      <p role="alert" style={{ ...muted, color: danger }}>
                        {push.error}
                      </p>
                    )}
                    <div>
                      <button
                        type="button"
                        className="nm-tap-h"
                        disabled={!push.subscribed || push.busy}
                        onClick={() => {
                          void push.sendTest();
                        }}
                        style={{
                          ...secondaryButton,
                          cursor: push.subscribed && !push.busy ? 'pointer' : 'not-allowed',
                          opacity: push.subscribed ? 1 : 0.5
                        }}
                      >
                        {tr('settings.push_test')}
                      </button>
                    </div>
                  </>
                ) : (
                  <p style={muted}>{tr('settings.push_unsupported', { brand: BRAND_NAME })}</p>
                )}
              </section>
            </>
          ) : null}

          {shownTab === 'account' ? null : <DeveloperDocs t={t} tab={shownTab} />}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px 12px',
            flexWrap: 'wrap',
            padding: 16,
            borderTop: `1px solid ${t.divider}`
          }}
        >
          <button
            type="button"
            className="nm-tap-h"
            disabled={signingOut || secretHeld}
            onClick={() => {
              void signOut();
            }}
            style={{ ...secondaryButton, flex: 'none', whiteSpace: 'nowrap', cursor: signingOut ? 'progress' : 'pointer', ...heldLook }}
          >
            <LogOut size={16} style={{ flex: 'none' }} aria-hidden="true" />
            {signingOut ? tr('settings.signing_out') : tr('auth.sign_out')}
          </button>
          {signOutError === null ? null : (
            <span
              role="alert"
              className="nm-settings-foot-msg"
              style={{ flex: '1 1 0', minWidth: 0, fontSize: 13, color: danger, overflowWrap: 'anywhere' }}
            >
              {signOutError}
            </span>
          )}
          <button
            type="button"
            className="nm-tap-h"
            onClick={leave}
            disabled={secretHeld}
            style={{ ...secondaryButton, flex: 'none', whiteSpace: 'nowrap', ...heldLook }}
          >
            {tr('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
