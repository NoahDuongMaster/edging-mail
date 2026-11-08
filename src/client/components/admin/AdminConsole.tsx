import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { trapTab } from '../../lib/focusTrap';
import { useT } from '../../lib/i18n';
import { AuditPanel } from './AuditPanel';
import { DomainsPanel } from './DomainsPanel';
import { LanguagePanel } from './LanguagePanel';
import { StepUpProvider } from './StepUp';
import { UsersPanel } from './UsersPanel';
import { focusAccountButton } from './adminUi';

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

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.indexOf(tab);
    const next = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index + TABS.length - 1) % TABS.length,
      Home: 0,
      End: TABS.length - 1
    }[event.key];
    const target = next === undefined ? undefined : TABS[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    setTab(target);
    document.querySelector<HTMLElement>(`#admin-tab-${target}`)?.focus();
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

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the console is a dialog: Escape and Tab are handled here, and the Close button is the pointer route
    <div
      ref={rootRef}
      role="dialog"
      className="nm-admin"
      aria-modal="true"
      aria-labelledby="admin-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        justifyContent: 'center',
        background: t.bg,
        color: t.text,
        outline: 'none'
      }}
    >
      <StepUpProvider t={t}>
        <div style={{ width: '100%', maxWidth: 880, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${t.divider}` }}>
            <ShieldCheck size={18} color={t.accent} aria-hidden="true" />
            <h1 id="admin-title" style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>
              {tr('term.admin_console')}
            </h1>
            <button
              ref={closeRef}
              type="button"
              className="nm-tap"
              onClick={onClose}
              aria-label={tr('admin.close_console')}
              style={{
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
              }}
            >
              <X size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label={tr('admin.sections_label')}
            style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${t.divider}`, overflowX: 'auto' }}
          >
            {TABS.map((id) => {
              const on = tab === id;
              return (
                <button
                  key={id}
                  id={`admin-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={on ? `admin-panel-${id}` : undefined}
                  tabIndex={on ? 0 : -1}
                  className="nm-tap-h"
                  onClick={() => setTab(id)}
                  onKeyDown={onTabKeyDown}
                  style={{
                    height: 36,
                    padding: '0 12px',
                    border: 0,
                    borderRadius: 8,
                    background: on ? t.selBg : 'transparent',
                    color: on ? t.selText : t.text2,
                    font: 'inherit',
                    fontSize: 13.5,
                    fontWeight: on ? 600 : 500,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer'
                  }}
                >
                  {tabLabel(id)}
                </button>
              );
            })}
          </div>
          <div
            id={`admin-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`admin-tab-${tab}`}
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}
          >
            {tab === 'users' ? <UsersPanel t={t} onGoToDomains={() => setTab('domains')} /> : null}
            {tab === 'domains' ? <DomainsPanel t={t} /> : null}
            {tab === 'audit' ? <AuditPanel t={t} /> : null}
            {tab === 'settings' ? <LanguagePanel t={t} /> : null}
          </div>
        </div>
      </StepUpProvider>
    </div>
  );
};
