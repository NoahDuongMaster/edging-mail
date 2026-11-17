import React from 'react';
import {
  Bell,
  Building2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Info,
  Keyboard,
  Languages,
  ListFilter,
  Lock,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  UserRound,
  type LucideIcon
} from 'lucide-react';
import { BRAND_NAME } from '../../shared/i18n';
import type { ThemeTokens } from '../theme';
import { useIsAdmin, useLogout, useSession } from '../lib/auth';
import { ownPicture } from '../lib/avatar';
import { useDocumentTitle } from '../lib/documentTitle';
import { useT, type MessageKey } from '../lib/i18n';
import { useSaveLanguage } from '../lib/language';
import { useSecretHeld } from '../lib/secretHold';
import { pushForSignOut, usePushNotifications } from '../lib/push';
import { ownerName, useSaveSettings, useSettings, type Settings } from '../lib/settings';
import {
  ActionBar,
  Avatar,
  Button,
  Dialog,
  PHONE_QUERY,
  RadioGroup,
  Section,
  Spinner,
  Switch,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  useGlide,
  useMediaMatch
} from '../ui';
import { LanguagePicker } from './LanguagePicker';
import { ErrorLine } from './auth/authUi';
import { DeveloperDocs, DOCS_TABS, type DocsTab } from './settings/DeveloperDocs';
import { FiltersSection } from './settings/FiltersSection';
import { DensityGroup, MotionGroup, ShortcutsPreference, UndoSendPreference } from './settings/PreferencesPanel';
import { ProfilePicture } from './settings/ProfilePicture';
import { SettingsBar, SettingsViewProvider, type SettingsView } from './settings/SettingsBar';
import { SettingRow, SettingsGroup, SettingsPage } from './settings/SettingsPage';
import { SecuritySection } from './security/SecuritySection';
import './settings/settings.css';

/** The theme stored on this device: one of the two, or 'system' (it follows the device's light or dark setting as it changes). */
export type ThemeChoice = 'light' | 'dark' | 'system';

interface SettingsModalProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
  /** Flips light and dark (the desktop header's toggle uses it too). Settings uses it only when `themeChoice` is not given. */
  onToggleDark: () => void;
  /** The stored theme choice. With `onThemeChoice`, Appearance offers three cards: Light, Dark and Match system. */
  themeChoice?: ThemeChoice;
  onThemeChoice?: (choice: ThemeChoice) => void;
  /** Opens the admin console (and the caller closes Settings). Only offered to admins. */
  onOpenAdmin: () => void;
  /** The section shown when the dialog opens: Profile unless a caller (a test, a link to Security) asks for another one. */
  initialSection?: SettingsSection;
}

type AccountSection = 'profile' | 'appearance' | 'mail' | 'filters' | 'language' | 'notifications' | 'keyboard' | 'security';
export type SettingsSection = AccountSection | DocsTab;

interface SectionEntry {
  id: SettingsSection;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: LucideIcon;
}

// The sections of a person's own account, in the order of the nav. Each one is a page of cards on the right.
const ACCOUNT_SECTIONS: SectionEntry[] = [
  { id: 'profile', labelKey: 'settings.profile', descriptionKey: 'settings.profile_desc', icon: UserRound },
  { id: 'appearance', labelKey: 'settings.appearance', descriptionKey: 'settings.appearance_desc', icon: Palette },
  { id: 'mail', labelKey: 'settings.mail', descriptionKey: 'settings.mail_desc', icon: Mail },
  { id: 'filters', labelKey: 'settings.filters', descriptionKey: 'settings.filters_desc', icon: ListFilter },
  { id: 'language', labelKey: 'lang.label', descriptionKey: 'settings.language_desc', icon: Languages },
  { id: 'notifications', labelKey: 'term.notifications', descriptionKey: 'settings.notifications_desc', icon: Bell },
  { id: 'keyboard', labelKey: 'prefs.keyboard_title', descriptionKey: 'settings.keyboard_desc', icon: Keyboard },
  { id: 'security', labelKey: 'security.title', descriptionKey: 'security.description', icon: ShieldCheck }
];
// The technical sections (architecture, deployment, mail setup) are for admins: they are about the deployment, not about a person's mail.
const ADMIN_SECTIONS: SectionEntry[] = [...ACCOUNT_SECTIONS, ...DOCS_TABS];

// The ids of the tabs and their panels are `settings-tab-<id>` and `settings-panel-<id>` (ui/Tabs builds them from this prefix).
const TABS_ID = 'settings';
/** The line under the nav that says why its ways out are off while new recovery codes are on screen (J1-27). */
const HELD_REASON_ID = 'settings-held-reason';

// The two fields of the profile form (the Filters switch saves on its own).
type ProfileField = 'display_name' | 'signature';
const SETTING_KEYS: ProfileField[] = ['display_name', 'signature'];

type Feedback = { type: 'saved' } | { type: 'unchanged' } | { type: 'offline' } | { type: 'error'; text: string } | null;

/** On a phone the dialog shows the list of sections OR one section (list, then detail); a desktop shows both side by side. */
type Pane = 'nav' | 'section';

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

/** Is this element on screen (a phone hides the list while a section is open, and the section while the list is)? */
const shown = (element: Element | null | undefined): element is HTMLElement =>
  element instanceof HTMLElement && element.getClientRects().length > 0;

/** The row of the section that is open, in the nav: where the focus goes when Settings opens (2.4.7: its ring shows on a keyboard open). */
const selectedNavItem = (panel: HTMLElement | null): HTMLElement | null =>
  panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? panel;

/** The row the glide capsule sits under (ui/glide.ts): the open section's tab in the nav. */
const OPEN_ROW = '.st-tabs > [role="tab"][aria-selected="true"]';

/**
 * One section on the page (keyed by the section, so it fades in as a new element each time). The panel keeps one height for every section,
 * so nothing jumps while switching; a short section simply ends under its last group (FP2: the end mark, a small flight trail, read as a
 * stray doodle and is gone).
 */
function SectionBody({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="st-section">{children}</div>;
}

/**
 * The nav's own box, with the capsule of the open section that glides from row to row (v3 signature H3). It mounts with the dialog, so the
 * hook finds its box at once and follows its resizes; a phone hides the capsule (a list that opens what is tapped shows no selection), and
 * reduced motion places it without a glide.
 */
function NavFrame({ pane, openKey, children }: { pane: Pane; openKey: string; children: React.ReactNode }): React.ReactElement {
  const navRef = React.useRef<HTMLDivElement | null>(null);
  // The dialog scales in from 96 % as it opens (ui.css), and the capsule is measured on screen: once the entrance has ended it is placed
  // again at the row's real size (a key that changes with the same row places it without a glide).
  const [settled, setSettled] = React.useState(0);
  React.useEffect(() => {
    const panel = navRef.current?.closest('.ui-dialog');
    if (!panel) {
      return;
    }
    const again = (event: Event) => {
      if (event.target === panel) {
        setSettled((count) => count + 1);
      }
    };
    panel.addEventListener('transitionend', again);
    return () => {
      panel.removeEventListener('transitionend', again);
    };
  }, []);
  const capsule = useGlide(navRef, OPEN_ROW, { key: `${openKey} ${settled}` });
  return (
    <div ref={navRef} className="st-nav ui-glide-host" data-pane={pane}>
      <div ref={capsule} className="ui-glide st-glide" aria-hidden="true" />
      {children}
    </div>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  t,
  onClose,
  onToggleDark,
  themeChoice,
  onThemeChoice,
  onOpenAdmin,
  initialSection = 'profile'
}) => {
  const tr = useT();
  const isAdmin = useIsAdmin();
  const user = useSession().data?.user;
  const [tab, setTab] = React.useState<SettingsSection>(initialSection);
  const [pane, setPane] = React.useState<Pane>('nav');
  // A view open inside the section (a view of Security): a phone's bar shows its title and goes back to the section (SettingsBar).
  const [view, setView] = React.useState<SettingsView | null>(null);
  // A phone (or a touch screen): Save is in the bottom action bar of the sheet, not in the card (DESIGN-v4m R3; ui ActionBar docks there).
  const phone = useMediaMatch(PHONE_QUERY);
  // When Settings opens, the focus goes to the row of the open section in the nav (with its ring when opened from the keyboard), not to a
  // field, which on a phone would raise the keyboard. Looked up when the dialog opens, through a ref object that never changes.
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const navItemRef = React.useMemo<React.RefObject<HTMLElement | null>>(
    () => ({
      get current(): HTMLElement | null {
        return selectedNavItem(dialogRef.current);
      }
    }),
    []
  );

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

  // Each time the dialog opens, start from the saved settings on the first section (adjusting state while rendering, not in an effect).
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTab(initialSection);
      setPane('nav');
      setForm(null);
      setFeedback(null);
      setSignOutError(null);
    }
  }

  const sections = isAdmin ? ADMIN_SECTIONS : ACCOUNT_SECTIONS;
  // A member who was an admin a moment ago (the dialog is open while the role changes) lands on Profile.
  const current = sections.find((item) => item.id === tab) ?? ACCOUNT_SECTIONS[0];
  useDocumentTitle(isOpen ? [tr(current.labelKey), tr('term.settings')] : null);

  // A phone switches between the list and a section: the focus follows to what is now on screen (the section's title, or the row of the
  // section that was open). On a desktop both stay on screen and the focus stays where the person put it.
  const paneShown = React.useRef<Pane>(pane);
  React.useEffect(() => {
    if (paneShown.current === pane) {
      return;
    }
    paneShown.current = pane;
    const panel = dialogRef.current;
    if (panel === null) {
      return;
    }
    const target = pane === 'section' ? panel.querySelector('.st-page-title') : panel.querySelector(`[role="tab"][aria-selected="true"]`);
    if (shown(target) && !shown(document.activeElement)) {
      target.focus();
    }
  }, [pane]);

  if (!isOpen) {
    return null;
  }

  const values = form ?? settings;
  const dirty = form !== null && settings !== undefined && SETTING_KEYS.some((key) => form[key] !== settings[key]);

  const edit = (key: ProfileField, value: string) => {
    if (values === undefined) {
      return;
    }
    setForm({ ...values, [key]: value });
    setFeedback(null);
  };

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    // Save is never disabled (a disabled button is skipped by Tab and says nothing): with nothing changed it says so.
    if (form === null || !dirty) {
      setFeedback({ type: 'unchanged' });
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

  // The line under the switch says what the browser allows, not only the switch's state: blocked (and how to allow it), not asked yet (the
  // browser will ask), or allowed.
  const pushStatus = push.busy
    ? tr('settings.push_working')
    : push.permission === 'denied'
      ? tr('settings.push_blocked')
      : push.subscribed
        ? tr('settings.push_on')
        : push.permission === 'granted'
          ? tr('settings.push_off')
          : tr('settings.push_ask');
  // What the browser allows is an InfoTip after the label (the switch itself says On or Off); why it does not work (blocked) and that it is
  // working stay a visible line, as the person needs them while acting.
  const pushHintMode = push.busy || push.permission === 'denied' ? 'inline' : 'tip';

  // The profile: one group of rows (the name, the address, the signature: label (and tip) on the left, the field on the right), then what
  // Save did as the card's last row. Save sits at its right on a desktop; on a phone it is the full-width button of the sheet's bottom bar.
  const feedbackLine =
    feedback === null && dirty ? (
      <p className="st-feedback" data-tone="pending">
        <CircleDot size={16} aria-hidden="true" />
        {tr('settings.unsaved')}
      </p>
    ) : feedback?.type === 'saved' ? (
      <p role="status" className="st-feedback" data-tone="success">
        <CircleCheck size={16} aria-hidden="true" />
        {tr('settings.saved')}
      </p>
    ) : feedback?.type === 'unchanged' ? (
      <p role="status" className="st-feedback">
        <Info size={16} aria-hidden="true" />
        {tr('settings.no_changes')}
      </p>
    ) : feedback?.type === 'error' || feedback?.type === 'offline' ? (
      <p role="alert" className="st-feedback" data-tone="danger">
        <CircleAlert size={16} aria-hidden="true" />
        {feedback.type === 'offline' ? tr('settings.save_offline') : feedback.text}
      </p>
    ) : null;
  const save = (
    <Button type="submit" variant="primary" loading={isSaving}>
      {isSaving ? tr('settings.saving') : tr('common.save')}
    </Button>
  );
  const profileFields =
    values === undefined ? (
      <SettingsGroup>
        {settingsQuery.isError ? (
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
        )}
      </SettingsGroup>
    ) : (
      <form onSubmit={submit} className="st-form">
        <SettingsGroup>
          <div className="st-field-row">
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
          </div>
          <div className="st-field-row">
            <TextField
              id="settings-from"
              label={tr('settings.your_address')}
              type="email"
              readOnly
              value={values.email}
              hint={tr('settings.address_hint')}
              trailing={<Lock size={14} aria-hidden="true" className="st-lock" />}
            />
          </div>
          <div className="st-field-row">
            <TextArea
              id="settings-signature"
              label={tr('term.signature')}
              rows={4}
              value={values.signature}
              onChange={(e) => edit('signature', e.target.value)}
              maxLength={2000}
              placeholder={tr('settings.signature_placeholder')}
            />
          </div>
          {phone ? (
            feedbackLine === null ? null : (
              <div className="st-form-foot">{feedbackLine}</div>
            )
          ) : (
            <div className="st-form-foot">
              {feedbackLine}
              {save}
            </div>
          )}
        </SettingsGroup>
        {phone ? <ActionBar>{save}</ActionBar> : null}
      </form>
    );

  // The page: the person's picture first (it has its own buttons and is not saved with the form), then the form.
  // The initials come from the saved name (the form below may be mid-edit), the session's while the settings load.
  const savedName = ownerName(settings);
  const pictureName = savedName !== '' || user === undefined ? savedName : user.display_name === '' ? user.email : user.display_name;
  const profile = (
    <>
      <ProfilePicture name={pictureName} picture={ownPicture(user)} />
      {profileFields}
    </>
  );

  const appearance = (
    <>
      <Section headingLevel={4} title={tr('settings.theme')} className="st-block">
        {/* Each choice is a card with a small picture of the app in that theme (settings.css draws the window, the rail with its Compose
            pill and the two sheets in the browser's own light or dark colours, not in this theme's; Match system shows both halves). With the
            stored choice (themeChoice) there are three; without it, onToggleDark flips the theme and runs only for the choice that is not
            the theme on screen. */}
        {themeChoice !== undefined && onThemeChoice !== undefined ? (
          <RadioGroup
            className="st-theme st-theme-3"
            label={tr('settings.theme')}
            options={[
              { value: 'light', label: tr('settings.light_theme') },
              { value: 'dark', label: tr('settings.dark_theme') },
              { value: 'system', label: tr('settings.system_theme') }
            ]}
            value={themeChoice}
            onChange={(value) => onThemeChoice(value === 'system' ? 'system' : value === 'dark' ? 'dark' : 'light')}
          />
        ) : (
          <RadioGroup
            className="st-theme"
            label={tr('settings.theme')}
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
        )}
      </Section>
      <MotionGroup />
    </>
  );

  // The message list and sending, on this device (lib/prefs.ts): the row density, and how long a sent message can be taken back.
  const mail = (
    <>
      {/* The page's tip already says these stay in this browser: the groups do not repeat it. */}
      <DensityGroup />
      <SettingsGroup title={tr('prefs.undo_send')}>
        <UndoSendPreference />
      </SettingsGroup>
    </>
  );

  const language = (
    <SettingsGroup>
      <div className="st-field-row">
        <LanguagePicker t={t} id="settings-language-select" onChosen={saveLanguage} showLabel />
      </div>
    </SettingsGroup>
  );

  const notifications = (
    <SettingsGroup>
      {push.supported ? (
        <>
          {/* The status line under the label is read out when it changes (working, blocked, on, off): the region is polite and reads only what
              changed. The switch stays usable when the browser blocks notifications: a click asks again (Notification.requestPermission). */}
          <div className="st-push" data-denied={push.permission === 'denied' ? 'true' : undefined} aria-live="polite" aria-atomic="false">
            <Switch
              id="settings-push"
              label={tr('settings.push_device')}
              hint={pushStatus}
              hintMode={pushHintMode}
              checked={push.subscribed}
              disabled={push.busy}
              onChange={() => {
                void (push.subscribed ? push.disable() : push.enable());
              }}
            />
          </div>
          <ErrorLine t={t} id="settings-push-error" text={push.error} />
          {/* Why the test is not available yet, next to it (a greyed button alone says nothing). */}
          <SettingRow hint={push.subscribed ? undefined : tr('settings.push_test_hint')} hintId="settings-push-test-hint">
            <Button
              size="sm"
              disabled={!push.subscribed || push.busy}
              aria-describedby={push.subscribed ? undefined : 'settings-push-test-hint'}
              onClick={() => {
                void push.sendTest();
              }}
            >
              {tr('settings.push_test')}
            </Button>
          </SettingRow>
        </>
      ) : (
        <p className="st-muted">{tr('settings.push_unsupported', { brand: BRAND_NAME })}</p>
      )}
    </SettingsGroup>
  );

  const keyboard = <ShortcutsPreference />;

  const page = (entry: SectionEntry, body: React.ReactNode) => (
    <SettingsPage title={tr(entry.labelKey)} description={tr(entry.descriptionKey)}>
      {body}
    </SettingsPage>
  );

  const contentOf = (entry: SectionEntry): React.ReactNode => {
    switch (entry.id) {
      case 'profile': {
        return page(entry, profile);
      }
      case 'appearance': {
        return page(entry, appearance);
      }
      case 'mail': {
        return page(entry, mail);
      }
      case 'filters': {
        return page(entry, <FiltersSection />);
      }
      case 'language': {
        return page(entry, language);
      }
      case 'notifications': {
        return page(entry, notifications);
      }
      case 'keyboard': {
        return page(entry, keyboard);
      }
      case 'security': {
        // Security draws its own title: it moves the focus to it when one of its views opens or closes.
        return <SecuritySection t={t} />;
      }
      case 'architecture':
      case 'deployment':
      case 'routing': {
        return page(entry, <DeveloperDocs t={t} tab={entry.id} />);
      }
    }
  };

  // An admin's nav has two groups, the account and the technical sections, each with a small label above its first row; a member's has one
  // group and no label.
  const navTabs = sections.map((item, index) => {
    const Icon = item.icon;
    return {
      value: item.id,
      label: tr(item.labelKey),
      // While a secret is held the nav does not move either: the screen that shows it stays where it is.
      disabled: secretHeld,
      group: index === ACCOUNT_SECTIONS.length ? tr('settings.technical') : index === 0 && isAdmin ? tr('term.account') : undefined,
      leading: <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    };
  });

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
      initialFocusRef={navItemRef}
      returnFocusRef={NAV_TOGGLE}
      // While the section scrolls, the content is a Tab stop named by the section (J1-22): its tab carries the section's name.
      bodyLabelledBy={`${TABS_ID}-tab-${current.id}`}
      rootClassName="st-root"
      className="st-dialog"
      toolbar={
        // The nav down the left side (desktop), or the list a phone opens a section from: who is signed in, the sections, then the two ways
        // out of Settings that are not sections (the admin console, signing out), at its foot.
        <NavFrame pane={pane} openKey={current.id}>
          {user === undefined ? null : (
            <div className="st-identity">
              <Avatar name={user.display_name === '' ? user.email : user.display_name} size="md" selected src={ownPicture(user)} />
              <div className="st-identity-text">
                <span className="st-identity-name">{user.display_name === '' ? user.email : user.display_name}</span>
                <span className="st-identity-address">{user.email}</span>
              </div>
            </div>
          )}
          <Tabs
            id={TABS_ID}
            className="st-tabs"
            orientation="vertical"
            label={tr('settings.sections_label')}
            tabs={navTabs}
            value={current.id}
            onChange={(value) => {
              const next = sections.find((item) => item.id === value);
              if (next !== undefined && !secretHeld) {
                setTab(next.id);
              }
            }}
            onActivate={() => {
              if (!secretHeld) {
                setPane('section');
              }
            }}
          />
          <div className="st-nav-foot">
            {isAdmin ? (
              <Button
                variant="ghost"
                className="st-nav-link"
                leadingIcon={<Building2 size={16} strokeWidth={1.75} aria-hidden="true" />}
                // A chevron, not an outward arrow: the console opens in the app, over the mailbox.
                trailingIcon={<ChevronRight size={16} aria-hidden="true" />}
                onClick={onOpenAdmin}
                disabled={secretHeld}
                aria-describedby={secretHeld ? HELD_REASON_ID : undefined}
              >
                {tr('term.admin_console')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="st-nav-link"
              disabled={signingOut || secretHeld}
              aria-describedby={secretHeld ? HELD_REASON_ID : undefined}
              leadingIcon={<LogOut size={16} strokeWidth={1.75} aria-hidden="true" />}
              onClick={() => {
                void signOut();
              }}
            >
              {signingOut ? tr('settings.signing_out') : tr('auth.sign_out')}
            </Button>
            {/* J1-27: while new recovery codes are on screen the ways out are off; this says why, on screen and to a screen reader. */}
            {secretHeld ? (
              <p id={HELD_REASON_ID} className="st-held-note">
                <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{tr('settings.held_reason')}</span>
              </p>
            ) : null}
            {signOutError === null ? null : (
              <p role="alert" className="st-foot-msg">
                <CircleAlert size={16} aria-hidden="true" />
                <span>{signOutError}</span>
              </p>
            )}
          </div>
        </NavFrame>
      }
    >
      <TabPanel tabsId={TABS_ID} value={current.id} selected={current.id}>
        {/* A phone shows one section at a time under a bar (hidden on a desktop by settings.css): Back returns to the list (the same pane
            switch as a tap on a row, the other way), or from a view of the section to the section; the title of what is on screen and its
            tip; the sheet's X stays at the right. */}
        <SettingsBar
          title={view?.title ?? tr(current.labelKey)}
          info={view === null ? [tr(current.descriptionKey)] : view.info}
          backDisabled={secretHeld}
          onBack={view?.back ?? (() => setPane('nav'))}
        />
        {/* A new section fades in (keyed, so it is a new element each time). */}
        <SettingsViewProvider value={setView}>
          <SectionBody key={current.id}>{contentOf(current)}</SectionBody>
        </SettingsViewProvider>
      </TabPanel>
    </Dialog>
  );
};
