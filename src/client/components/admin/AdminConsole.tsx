import React from 'react';
import { Globe, ScrollText, SlidersHorizontal, Users, X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useAdminUsers } from '../../lib/admin/users';
import { useSession } from '../../lib/auth';
import { useDocumentTitle } from '../../lib/documentTitle';
import { trapTab } from '../../lib/focusTrap';
import { fmt, useT } from '../../lib/i18n';
import { Avatar, IconButton, Odometer, PhoneBar, TabPanel, Tabs, useGlide, useMediaMatch } from '../../ui';
import { AuditPanel } from './AuditPanel';
import { DomainsPanel } from './DomainsPanel';
import { LanguagePanel } from './LanguagePanel';
import { StepUpProvider } from './StepUp';
import { UsersPanel } from './UsersPanel';
import { BarSlot, PHONE_LAYOUT, focusAccountButton } from './adminUi';
import './admin.css';

interface AdminConsoleProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
}

type Tab = 'users' | 'domains' | 'audit' | 'settings';

const TABS: readonly Tab[] = ['users', 'domains', 'audit', 'settings'];

const ICONS: Record<Tab, React.ReactNode> = {
  users: <Users size={16} strokeWidth={1.75} aria-hidden="true" />,
  domains: <Globe size={16} strokeWidth={1.75} aria-hidden="true" />,
  audit: <ScrollText size={16} strokeWidth={1.75} aria-hidden="true" />,
  settings: <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
};

/** The row the glide capsule sits under (ui/glide.ts): the open section's tab in the nav. */
const OPEN_SECTION = '.ad-tabs > [role="tab"][aria-selected="true"]';

/**
 * The nav's own box with the capsule of the open section, which glides from row to row (v3 signature H3), as in Settings. It mounts with
 * the console, so the hook finds its box at once; a phone hides the capsule (the sections are a row of tabs with their sliding line there),
 * and reduced motion places it without a glide.
 */
const SectionNav: React.FC<{ open: Tab; children: React.ReactNode }> = ({ open, children }) => {
  const navRef = React.useRef<HTMLDivElement | null>(null);
  const capsule = useGlide(navRef, OPEN_SECTION, { key: open });
  return (
    <div ref={navRef} className="ad-side ui-glide-host">
      <div ref={capsule} className="ui-glide ad-glide" aria-hidden="true" />
      {children}
    </div>
  );
};

/**
 * The open console: a page over the mailbox, drawn as one sheet on the window ground in the language of Settings. On a desktop the sheet
 * has two tones and no line between them: the sections down the left on the raised tone (the open one under the gliding capsule), the
 * section's page on the surface with its head (title, one line, the primary action) and its content in a column of at most 1040px; the
 * console's name sits at the top of the nav and Close at the top right of the page. On a phone (DESIGN-v4m R3) the console's name is a
 * fixed top bar (ui PhoneBar: Close at its start, the open section's one action at its end, so Add person and Add domain never scroll
 * away), and the sections are one row of tabs fixed under it that scrolls sideways, its hidden side faded (J3-05: a 2x2 grid took a
 * quarter of the screen); the page scrolls under both.
 */
const Workspace: React.FC<{ t: ThemeTokens; onClose: () => void }> = ({ t, onClose }) => {
  const tr = useT();
  const [tab, setTab] = React.useState<Tab>('users');
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const phone = useMediaMatch(PHONE_LAYOUT);
  // The end of the phone bar, where the open section draws its action (adminUi BarSlot); none on a desktop.
  const [barSlot, setBarSlot] = React.useState<HTMLElement | null>(null);
  // The admin who acts here, at the top of the nav as Settings shows who is signed in (every change of the console is logged under them).
  const self = useSession().data?.user;
  let selfName = '';
  if (self !== undefined) {
    selfName = self.display_name === '' ? self.email : self.display_name;
  }
  // The number of people, next to People in the list of sections (the People page reads the same answer: one request).
  const people = useAdminUsers('');
  const total = people.data?.pages.at(-1)?.total;
  useDocumentTitle([tr('term.admin_console')]);

  React.useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    // Opened from Settings, which closes at the same time: focus goes back to the avatar that opens Settings.
    return () => focusAccountButton();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // A dialog inside the console (an account, a confirmation) handles its own Escape and Tab.
    const owner = (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]');
    if (owner !== event.currentTarget) {
      return;
    }
    if (event.key === 'Escape') {
      onClose();
    } else {
      trapTab(event.nativeEvent, rootRef.current);
    }
  };

  const tabLabel = (id: Tab): string => {
    switch (id) {
      case 'users': {
        return tr('admin.tab_people');
      }
      case 'domains': {
        return tr('admin.tab_domains');
      }
      case 'audit': {
        return tr('term.audit_log');
      }
      case 'settings': {
        return tr('term.settings');
      }
    }
  };

  // The sections follow the ARIA tabs pattern (ui/Tabs): Up and Down move and wrap, Home and End jump, the section that gets focus is shown.
  const choose = (value: string) => {
    const next = TABS.find((id) => id === value);
    if (next !== undefined) {
      setTab(next);
    }
  };

  const close = (
    <IconButton ref={closeRef} label={tr('admin.close_console')} onClick={onClose} className="ad-close">
      <X size={18} aria-hidden="true" />
    </IconButton>
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the console is a dialog: Escape and Tab are handled here, and the Close button is the pointer route
    <div
      ref={rootRef}
      role="dialog"
      className="ad-console nm-admin"
      aria-modal="true"
      aria-labelledby="admin-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <StepUpProvider t={t}>
        <div ref={sheetRef} className="ad-sheet">
          {phone ? (
            <PhoneBar
              as="h1"
              titleId="admin-title"
              title={tr('term.admin_console')}
              start={close}
              end={<span ref={setBarSlot} className="ad-bar-slot" />}
              scroller={sheetRef}
              className="ad-bar"
            />
          ) : (
            <div className="ad-head">
              <h1 id="admin-title" className="ad-title">
                {tr('term.admin_console')}
              </h1>
              {close}
            </div>
          )}
          <SectionNav open={tab}>
            {self === undefined ? null : (
              <div className="ad-identity">
                <Avatar name={selfName} size="md" selected />
                <div className="ad-identity-text">
                  <span className="ad-identity-name">{selfName}</span>
                  <span className="ad-identity-address">{self.email}</span>
                </div>
              </div>
            )}
            <Tabs
              id="admin"
              label={tr('admin.sections_label')}
              tabs={TABS.map((id) => ({
                value: id,
                label: tabLabel(id),
                leading: ICONS[id],
                trailing:
                  id === 'users' && total !== undefined ? (
                    // The count rolls when it changes (an account added or deleted); the tab's own name is what is read.
                    <span className="ad-count" aria-hidden="true">
                      <Odometer value={total} format={(count) => fmt.number(count)} />
                    </span>
                  ) : undefined
              }))}
              value={tab}
              onChange={choose}
              className="ad-tabs"
              phoneRow
              orientation="vertical"
            />
          </SectionNav>
          <BarSlot.Provider value={phone ? barSlot : null}>
            <div className="ad-main">
              <TabPanel tabsId="admin" value="users" selected={tab}>
                <UsersPanel t={t} onGoToDomains={() => setTab('domains')} />
              </TabPanel>
              <TabPanel tabsId="admin" value="domains" selected={tab}>
                <DomainsPanel t={t} />
              </TabPanel>
              <TabPanel tabsId="admin" value="audit" selected={tab}>
                <AuditPanel t={t} />
              </TabPanel>
              <TabPanel tabsId="admin" value="settings" selected={tab}>
                <LanguagePanel t={t} />
              </TabPanel>
            </div>
          </BarSlot.Provider>
        </div>
      </StepUpProvider>
    </div>
  );
};

/** The admin console: People, Domains and the Audit log. Only an admin is offered it (Settings > Account); the server checks again on every call. */
export const AdminConsole: React.FC<AdminConsoleProps> = ({ isOpen, t, onClose }) => {
  // Each time the console opens it starts on People: the workspace mounts afresh, with its own state.
  return isOpen ? <Workspace t={t} onClose={onClose} /> : null;
};
