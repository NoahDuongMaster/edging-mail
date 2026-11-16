import React from 'react';
import { Globe, ScrollText, SlidersHorizontal, Users, X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useAdminUsers } from '../../lib/admin/users';
import { useDocumentTitle } from '../../lib/documentTitle';
import { trapTab } from '../../lib/focusTrap';
import { fmt, useT } from '../../lib/i18n';
import { IconButton, TabPanel, Tabs } from '../../ui';
import { AuditPanel } from './AuditPanel';
import { DomainsPanel } from './DomainsPanel';
import { LanguagePanel } from './LanguagePanel';
import { StepUpProvider } from './StepUp';
import { UsersPanel } from './UsersPanel';
import { focusAccountButton } from './adminUi';
import './admin.css';

interface AdminConsoleProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
}

type Tab = 'users' | 'domains' | 'audit' | 'settings';

const TABS: readonly Tab[] = ['users', 'domains', 'audit', 'settings'];

const ICONS: Record<Tab, React.ReactNode> = {
  users: <Users size={16} aria-hidden="true" />,
  domains: <Globe size={16} aria-hidden="true" />,
  audit: <ScrollText size={16} aria-hidden="true" />,
  settings: <SlidersHorizontal size={16} aria-hidden="true" />
};

/**
 * The open console: a page over the mailbox. On a desktop the sections are a list down the left side on the window ground (the selected one
 * tinted, with the 3px indicator that slides to the next) and the section is a page on the content sheet: its head (title, one line, the
 * primary action) and its content in a column of at most 1080px. On a phone the sections are one row of tabs under the title that scrolls
 * sideways, its hidden side faded (J3-05: a 2x2 grid took a quarter of the screen).
 */
const Workspace: React.FC<{ t: ThemeTokens; onClose: () => void }> = ({ t, onClose }) => {
  const tr = useT();
  const [tab, setTab] = React.useState<Tab>('users');
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
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
        <div className="ad-head">
          <h1 id="admin-title" className="ad-title">
            {tr('term.admin_console')}
          </h1>
          <IconButton ref={closeRef} label={tr('admin.close_console')} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="ad-body">
          <div className="ad-side">
            <Tabs
              id="admin"
              label={tr('admin.sections_label')}
              tabs={TABS.map((id) => ({
                value: id,
                label: tabLabel(id),
                leading: ICONS[id],
                trailing:
                  id === 'users' && total !== undefined ? (
                    <span className="ad-count" aria-hidden="true">
                      {fmt.number(total)}
                    </span>
                  ) : undefined
              }))}
              value={tab}
              onChange={choose}
              className="ad-tabs"
              phoneRow
              orientation="vertical"
            />
          </div>
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
