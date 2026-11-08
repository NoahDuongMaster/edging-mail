import React from 'react';
import { X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { trapTab } from '../../lib/focusTrap';
import { useT } from '../../lib/i18n';
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

/** The admin console: People, Domains and the Audit log. Only an admin is offered it (Settings > Account); the server checks again on every call. */
export const AdminConsole: React.FC<AdminConsoleProps> = ({ isOpen, t, onClose }) => {
  const tr = useT();
  const [tab, setTab] = React.useState<Tab>('users');
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);

  // Each time the console opens it starts on People (adjusting state while rendering, as SettingsModal does, not in an effect).
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTab('users');
    }
  }

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    closeRef.current?.focus({ preventScroll: true });
    // Opened from Settings, which closes at the same time: focus goes back to the avatar that opens Settings.
    return () => focusAccountButton();
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

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

  // The tabs follow the ARIA tabs pattern (ui/Tabs): Left and Right move and wrap, Home and End jump, the tab that gets focus is shown.
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
        <Tabs
          id="admin"
          label={tr('admin.sections_label')}
          tabs={TABS.map((id) => ({ value: id, label: tabLabel(id) }))}
          value={tab}
          onChange={choose}
          className="ad-tabs"
          grid
        />
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
      </StepUpProvider>
    </div>
  );
};
