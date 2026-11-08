import type React from 'react';
import { Archive, Ban, Clock, FileText, Inbox, PenLine, Send, Star, Trash2, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { getLabelChip } from '../theme';
import type { FolderStats } from '../types';
import { useT } from '../lib/i18n';
import { folderName } from '../lib/mail';
import { Button, IconButton, Kbd } from '../ui';
import { BrandMark } from './BrandMark';
import './mailbox.css';

interface SidebarProps {
  t: ThemeTokens;
  folder: string;
  onSelectFolder: (folder: string) => void;
  stats: FolderStats;
  labels: string[];
  onCompose: () => void;
  onCloseMobile?: () => void;
}

// The folder's name comes from `folderName(id)` when it is shown, so a language switch reaches it.
const NAV_ITEMS = [
  { id: 'inbox', icon: Inbox },
  { id: 'starred', icon: Star },
  { id: 'snoozed', icon: Clock },
  { id: 'sent', icon: Send },
  { id: 'drafts', icon: FileText },
  { id: 'archive', icon: Archive },
  { id: 'spam', icon: Ban },
  { id: 'trash', icon: Trash2 }
] as const;

export const Sidebar: React.FC<SidebarProps> = ({ t, folder, onSelectFolder, stats, labels, onCompose, onCloseMobile }) => {
  const tr = useT();
  // Stats come from the API, so any folder can be missing.
  const folderStats: Partial<FolderStats> = stats;

  const pick = (id: string) => {
    onSelectFolder(id);
    onCloseMobile?.();
  };

  return (
    <aside aria-label={tr('sidebar.navigation')} className="mb-sidebar" data-drawer={onCloseMobile ? '' : undefined}>
      {/* The desktop header carries the mark; the drawer has no header, so it brings its own, with the way out. */}
      {onCloseMobile ? (
        <div className="mb-sidebar-top">
          <BrandMark t={t} />
          <IconButton label={tr('sidebar.close_mailboxes')} onClick={onCloseMobile}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}

      <div className="mb-sidebar-scroll">
        <Button
          variant="primary"
          fullWidth
          data-compose-button=""
          className="mb-compose"
          leadingIcon={<PenLine size={18} strokeWidth={1.75} aria-hidden="true" />}
          trailingIcon={
            onCloseMobile ? undefined : (
              <span aria-hidden="true" className="mb-compose-key">
                <Kbd>C</Kbd>
              </span>
            )
          }
          onClick={onCompose}
        >
          {tr('action.compose')}
        </Button>

        <nav aria-label={tr('sidebar.mailboxes')}>
          <ul role="list" className="mb-nav-list">
            {NAV_ITEMS.map((item) => {
              const active = folder === item.id;
              // Drafts and Snoozed show their total (nothing there is new mail); every other folder shows its unread mail.
              const count =
                item.id === 'drafts' || item.id === 'snoozed' ? (folderStats[item.id]?.total ?? 0) : (folderStats[item.id]?.unread ?? 0);
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button type="button" className="mb-nav-item" onClick={() => pick(item.id)} aria-current={active ? 'page' : undefined}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span className="mb-nav-label">{folderName(item.id)}</span>
                    {count > 0 ? (
                      <span className="mb-nav-count" data-unread={item.id === 'inbox' ? '' : undefined}>
                        {count}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {labels.length > 0 ? (
          <section aria-labelledby="labels-heading" className="mb-labels">
            <h2 id="labels-heading" className="mb-labels-title">
              {tr('folder.labels')}
            </h2>
            <ul role="list" className="mb-nav-list">
              {labels.map((name) => {
                const active = folder === `label:${name}`;
                const chip = getLabelChip(name, t);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      className="mb-nav-item"
                      onClick={() => pick(`label:${name}`)}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span aria-hidden="true" className="mb-label-swatch">
                        <span style={{ background: chip.dot }} />
                      </span>
                      <span className="mb-nav-label">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
};
