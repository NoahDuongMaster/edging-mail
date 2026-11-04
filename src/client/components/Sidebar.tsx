import type React from 'react';
import { Archive, Ban, Clock, FileText, Inbox, Mail, PenLine, Send, Sliders, Star, Trash2, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { getLabelChip } from '../theme';
import type { FolderStats } from '../types';

interface SidebarProps {
  t: ThemeTokens;
  folder: string;
  onSelectFolder: (folder: string) => void;
  stats: FolderStats;
  labels: string[];
  onCompose: () => void;
  onOpenSettings: () => void;
  onCloseMobile?: () => void;
}

const NAV_ITEMS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'snoozed', label: 'Snoozed', icon: Clock },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'spam', label: 'Spam', icon: Ban },
  { id: 'trash', label: 'Trash', icon: Trash2 }
] as const;

export const Sidebar: React.FC<SidebarProps> = ({ t, folder, onSelectFolder, stats, labels, onCompose, onOpenSettings, onCloseMobile }) => {
  // Stats come from the API, so any folder can be missing.
  const folderStats: Partial<FolderStats> = stats;
  const inboxUnread = folderStats.inbox?.unread ?? 0;

  // 'starred' is a virtual folder (a view over mails that also sit in their own folder): summing it would count them twice.
  const realFolders = Object.entries(folderStats).filter(([id]) => id !== 'starred');
  const totalMail = realFolders.reduce((sum, [, s]) => sum + (s?.total ?? 0), 0);
  const totalUnread = realFolders.reduce((sum, [, s]) => sum + (s?.unread ?? 0), 0);
  const readRatio = totalMail > 0 ? Math.round(((totalMail - totalUnread) / totalMail) * 100) : 0;

  const pick = (id: string) => {
    onSelectFolder(id);
    onCloseMobile?.();
  };

  const navRow = (active: boolean) => ({
    width: '100%',
    height: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 12px',
    border: 0,
    borderRadius: 8,
    background: active ? t.navSelBg : 'transparent',
    color: active ? t.selText : t.text,
    fontWeight: active ? 600 : 500,
    fontSize: 14,
    textAlign: 'left' as const,
    cursor: 'pointer',
    transition: 'background 120ms ease'
  });

  return (
    <aside
      aria-label="Mail navigation"
      className="nm-sidebar"
      style={{
        // In the mobile drawer the panel decides the width; on desktop it is the fixed 248px column.
        width: onCloseMobile ? '100%' : 248,
        flex: '0 0 248px',
        height: '100%',
        padding: '12px 12px 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        background: t.bg,
        color: t.text,
        overflowY: 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 40, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: t.accent,
              color: '#FFFFFF',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Mail size={18} strokeWidth={2} />
          </span>
          <span style={{ fontSize: 17, lineHeight: '24px', letterSpacing: '-0.01em' }}>
            <span style={{ fontWeight: 700 }}>Edging</span> <span style={{ fontWeight: 400, color: t.text2 }}>Mail</span>
          </span>
        </div>
        {onCloseMobile ? (
          <button
            type="button"
            aria-label="Close mailboxes"
            className="nm-tap"
            onClick={onCloseMobile}
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
            <X size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onCompose}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 44,
          border: 0,
          borderRadius: 12,
          background: t.accent,
          color: '#FFFFFF',
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(16,24,40,0.14), inset 0 1px 0 rgba(255,255,255,0.14)'
        }}
      >
        <PenLine size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>Compose</span>
        {onCloseMobile ? null : (
          <kbd
            style={{
              marginLeft: 4,
              fontFamily: "'Geist Mono', ui-monospace, monospace",
              fontSize: 11,
              lineHeight: '16px',
              padding: '0 6px',
              borderRadius: 5,
              background: 'rgba(0,0,0,0.22)',
              color: '#FFFFFF'
            }}
          >
            C
          </kbd>
        )}
      </button>

      <nav aria-label="Mailboxes">
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const active = folder === item.id;
            // Drafts and Snoozed show their total (nothing there is new mail); every other folder shows its unread mail.
            const count =
              item.id === 'drafts' || item.id === 'snoozed' ? (folderStats[item.id]?.total ?? 0) : (folderStats[item.id]?.unread ?? 0);
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="nm-tap-h"
                  onClick={() => pick(item.id)}
                  aria-current={active ? 'page' : undefined}
                  style={navRow(active)}
                >
                  <span style={{ display: 'inline-flex', color: active ? t.selText : t.text2 }}>
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.id === 'inbox' && inboxUnread > 0 ? (
                    <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inboxUnread}</span>
                  ) : item.id !== 'inbox' && count > 0 ? (
                    <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: t.text2 }}>{count}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {labels.length > 0 ? (
        <section aria-labelledby="labels-heading" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 0 12px' }}>
            <h2
              id="labels-heading"
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: '16px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: t.text2
              }}
            >
              Labels
            </h2>
          </div>

          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {labels.map((name) => {
              const active = folder === `label:${name}`;
              const chip = getLabelChip(name, t);
              return (
                <li key={name}>
                  <button
                    type="button"
                    className="nm-tap-h"
                    onClick={() => pick(`label:${name}`)}
                    aria-current={active ? 'page' : undefined}
                    style={navRow(active)}
                  >
                    <span aria-hidden="true" style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: chip.dot }} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          onClick={onOpenSettings}
          className="nm-tap-h"
          style={{
            height: 32,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            border: `1px solid ${t.border}`,
            borderRadius: 8,
            background: t.surface,
            color: t.text2,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          <Sliders size={14} color={t.accent} aria-hidden="true" />
          <span>Settings</span>
        </button>

        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: t.surface,
            border: `1px solid ${t.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: '16px' }}>
            <span style={{ fontWeight: 600 }}>Mailbox</span>
            <span style={{ color: t.text2 }}>
              {totalMail} {totalMail === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: t.track, overflow: 'hidden' }}>
            <div style={{ width: `${readRatio}%`, height: '100%', borderRadius: 999, background: t.accent }} />
          </div>
          <div style={{ fontSize: 12, lineHeight: '16px', color: t.text2 }}>
            {totalUnread > 0 ? `${totalUnread} unread` : 'All caught up'}
          </div>
        </div>
      </div>
    </aside>
  );
};
