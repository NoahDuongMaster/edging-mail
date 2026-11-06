import React from 'react';
import { Cloud, Database, HardDrive, Loader2, LogOut, Mail, ShieldCheck, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useLogout } from '../lib/auth';
import { deviceOffMessage, removeThisDevice, usePushNotifications } from '../lib/push';
import { useSaveSettings, useSettings, type Settings } from '../lib/settings';

interface SettingsModalProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
  onToggleDark: () => void;
}

type Tab = 'account' | 'architecture' | 'deployment' | 'routing';

const TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'routing', label: 'Email routing & MX' }
];

// Arrow keys wrap around; Home and End jump to the ends. null = not a tab key.
function tabAfterKey(key: string, current: number): number | null {
  switch (key) {
    case 'ArrowRight': {
      return (current + 1) % TABS.length;
    }
    case 'ArrowLeft': {
      return (current + TABS.length - 1) % TABS.length;
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return TABS.length - 1;
    }
    default: {
      return null;
    }
  }
}

const SETTING_KEYS: (keyof Settings)[] = ['display_name', 'default_from', 'signature'];

type Feedback = { type: 'saved' } | { type: 'error'; text: string } | null;

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

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, t, onClose, onToggleDark }) => {
  const [tab, setTab] = React.useState<Tab>('account');
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  const settingsQuery = useSettings();
  const { mutate: saveSettings, isPending: isSaving } = useSaveSettings();
  const { mutateAsync: logOut } = useLogout();
  const push = usePushNotifications();
  const settings = settingsQuery.data;
  // null = the form is untouched and shows the saved settings.
  const [form, setForm] = React.useState<Settings | null>(null);
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);

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
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Move focus into the dialog on open and hand it back to the opener on close.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      // On a phone the opener sits in the mailbox drawer, which unmounts when Settings opens (the browser then reports BODY as the
      // focused element): the header button that opens the drawer takes over (found by its label; App.tsx gives it no id).
      const openerGone = !opener || opener === document.body || !opener.isConnected;
      const target = openerGone ? document.querySelector<HTMLElement>('button[aria-label="Open mailboxes"]') : opener;
      target?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const values = form ?? settings;
  const dirty = form !== null && settings !== undefined && SETTING_KEYS.some((key) => form[key] !== settings[key]);

  const edit = (key: keyof Settings, value: string) => {
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
      { display_name: form.display_name.trim(), default_from: form.default_from.trim(), signature: form.signature.trimEnd() },
      {
        onSuccess: () => {
          setForm(null);
          setFeedback({ type: 'saved' });
        },
        // fetch rejects with a TypeError when offline: its own text ('Failed to fetch') tells the user nothing.
        onError: (error) =>
          setFeedback({ type: 'error', text: error instanceof TypeError ? 'No connection: nothing was saved' : error.message })
      }
    );
  };

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const next = tabAfterKey(
      event.key,
      TABS.findIndex((item) => item.id === tab)
    );
    const target = next === null ? undefined : TABS[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    setTab(target.id);
    document.querySelector<HTMLElement>(`#settings-tab-${target.id}`)?.focus();
  };

  const signOut = async () => {
    // Disabled from the first click on, so a second click cannot start another round while notifications are being turned off.
    setSigningOut(true);
    setSignOutError(null);
    // Server first: when it cannot confirm, the browser subscription and the login both stay, and this click can be repeated.
    const removal = await removeThisDevice();
    if (removal === 'failed' || removal === 'offline') {
      setSignOutError(deviceOffMessage(removal));
      setSigningOut(false);
      return;
    }
    try {
      await logOut();
    } catch (error) {
      // The login stays (an HttpOnly cookie cannot be cleared from here), so the button is usable again.
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out');
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
  const pre: React.CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${t.border}`,
    background: t.bg,
    color: t.text,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: '18px',
    overflowX: 'auto'
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
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click is a pointer shortcut; Escape (window keydown) and the Close button are the keyboard routes
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
      onClick={onClose}
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
            Settings
          </h2>
          <button type="button" className="nm-tap" onClick={onClose} aria-label="Close" style={button}>
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div
          className="nm-settings-tabs"
          role="tablist"
          aria-label="Settings sections"
          style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${t.divider}` }}
        >
          {TABS.map((item) => {
            const on = tab === item.id;
            return (
              <button
                key={item.id}
                id={`settings-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`settings-panel-${item.id}`}
                tabIndex={on ? 0 : -1}
                className="nm-tap-h nm-settings-tab"
                onClick={() => setTab(item.id)}
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
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          id={`settings-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {tab === 'account' ? (
            <>
              {values === undefined ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <p style={{ ...muted, color: settingsQuery.isError ? danger : t.text2 }}>
                    {settingsQuery.isError ? 'Could not load your settings.' : 'Loading…'}
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
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : (
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-name" style={fieldLabel}>
                      Display name
                    </label>
                    <input
                      id="settings-name"
                      className="nm-tap-h"
                      type="text"
                      autoComplete="name"
                      value={values.display_name}
                      onChange={(e) => edit('display_name', e.target.value)}
                      maxLength={100}
                      placeholder="Shown to people you write to"
                      style={{ ...fieldInput, height: 40 }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-from" style={fieldLabel}>
                      Sender address
                    </label>
                    <input
                      id="settings-from"
                      className="nm-tap-h"
                      type="email"
                      autoComplete="email"
                      value={values.default_from}
                      onChange={(e) => edit('default_from', e.target.value)}
                      placeholder="you@yourdomain.com"
                      style={{ ...fieldInput, height: 40 }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="settings-signature" style={fieldLabel}>
                      Signature
                    </label>
                    <textarea
                      id="settings-signature"
                      rows={4}
                      value={values.signature}
                      onChange={(e) => edit('signature', e.target.value)}
                      maxLength={2000}
                      placeholder="Added to new messages"
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
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                    {feedback?.type === 'saved' ? (
                      <span role="status" style={{ fontSize: 13, color: t.dark ? '#4ADE80' : '#15803D' }}>
                        Saved
                      </span>
                    ) : null}
                    {feedback?.type === 'error' ? (
                      <span role="alert" style={{ fontSize: 13, color: danger }}>
                        {feedback.text}
                      </span>
                    ) : null}
                  </div>
                </form>
              )}

              <section aria-labelledby="settings-appearance" style={card}>
                <h3 id="settings-appearance" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                  Appearance
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div id="settings-dark-label" style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    Dark theme
                  </div>
                  <Switch t={t} checked={t.dark} labelledBy="settings-dark-label" onClick={onToggleDark} />
                </div>
              </section>

              <section aria-labelledby="settings-notifications" style={card}>
                <h3 id="settings-notifications" style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
                  Notifications
                </h3>
                {push.supported ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div id="settings-push-label" style={{ fontSize: 13 }}>
                          New mail on this device
                        </div>
                        <p role="status" style={{ ...muted, color: push.permission === 'denied' ? danger : t.text2 }}>
                          {push.busy
                            ? 'Working…'
                            : push.permission === 'denied'
                              ? 'Blocked in your browser settings. Allow notifications for this site, then try again.'
                              : push.subscribed
                                ? 'On'
                                : 'Off'}
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
                        Send test notification
                      </button>
                    </div>
                  </>
                ) : (
                  <p style={muted}>
                    Notifications are not available in this browser. On iPhone, add Edging Mail to the Home Screen first, then open it from
                    there.
                  </p>
                )}
              </section>
            </>
          ) : null}

          {tab === 'architecture' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <Mail size={16} color={t.accent} aria-hidden="true" />
                  Inbound routing
                </div>
                <p style={muted}>
                  Cloudflare Email Routing hands the raw SMTP stream to the Worker&apos;s email handler, which parses and stores it.
                </p>
              </div>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <Database size={16} color="#15803D" aria-hidden="true" />
                  D1 (SQLite)
                </div>
                <p style={muted}>Headers, snippets, folders, labels and read state live in D1 for instant edge queries.</p>
              </div>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <HardDrive size={16} color="#2F5BEA" aria-hidden="true" />
                  R2 bucket
                </div>
                <p style={muted}>Raw RFC 822 messages and attachments are stored in R2, with no egress fees on reads.</p>
              </div>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13 }}>
                  <ShieldCheck size={16} color="#B97800" aria-hidden="true" />
                  Static assets
                </div>
                <p style={muted}>The React client is served from the Cloudflare edge cache alongside the API routes.</p>
              </div>
            </div>
          ) : null}

          {tab === 'deployment' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ ...muted, fontWeight: 600, color: t.text }}>1. Create the D1 database and R2 bucket</p>
              <pre style={pre}>{`npx wrangler d1 create edging_mail_db\nnpx wrangler r2 bucket create edging-mail-storage`}</pre>
              <p style={{ ...muted, fontWeight: 600, color: t.text }}>2. Apply the migrations</p>
              <pre style={pre}>npm run db:migrate:remote</pre>
              <p style={{ ...muted, fontWeight: 600, color: t.text }}>3. Set the secrets (wrangler secret put)</p>
              <pre style={pre}>{`npx wrangler secret put APP_PASSWORD\nnpx wrangler secret put JWT_SECRET`}</pre>
              <p style={{ ...muted, fontWeight: 600, color: t.text }}>4. Deploy</p>
              <pre style={pre}>npm run deploy</pre>
            </div>
          ) : null}

          {tab === 'routing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={muted}>To receive real mail at your own domain:</p>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  listStyle: 'decimal',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  color: t.text2,
                  fontSize: 13
                }}
              >
                <li>
                  Open <strong style={{ color: t.text }}>Cloudflare Dashboard → your domain → Email Routing</strong>.
                </li>
                <li>Enable Email Routing so the MX and SPF records are created for you.</li>
                <li>
                  Add a routing rule with the custom address <code style={{ color: t.text }}>*@yourdomain.com</code> and the action{' '}
                  <strong style={{ color: t.text }}>Send to a Worker</strong> → <code style={{ color: t.text }}>edging-mail</code>.
                </li>
                <li>Save. Inbound mail now lands straight in this inbox.</li>
              </ol>
            </div>
          ) : null}
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
            disabled={signingOut}
            onClick={() => {
              void signOut();
            }}
            style={{ ...secondaryButton, flex: 'none', whiteSpace: 'nowrap', cursor: signingOut ? 'progress' : 'pointer' }}
          >
            <LogOut size={16} style={{ flex: 'none' }} aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
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
          <button type="button" className="nm-tap-h" onClick={onClose} style={{ ...secondaryButton, flex: 'none', whiteSpace: 'nowrap' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
