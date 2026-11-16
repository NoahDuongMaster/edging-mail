import React from 'react';
import { Archive, Ban, Clock, FileText, Inbox, PenLine, Send, Star, Trash2, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { getLabelChip } from '../theme';
import type { FolderStats } from '../types';
import { fmt, useT } from '../lib/i18n';
import { folderName } from '../lib/mail';
import { usePrefs } from '../lib/prefs';
import { homeRef } from '../lib/shellMotion';
import { Button, IconButton, Odometer, Tooltip, useGlide, useTooltip } from '../ui';
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
  /** The foot of the desktop rail: the account (the one way into Settings) and the theme switch, drawn by App. */
  foot?: React.ReactNode;
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

/** The C key of Compose (the same in every language). */
const COMPOSE_KEY = 'C';

/**
 * The left rail (DESIGN-v3 4.1): the brand, Compose (a tonal pill, lead review 1: the accent tint, not a second filled blue beside the
 * reader's Reply; its C key is said by its tooltip while single-key shortcuts are on), the folders with their rolling counts, the person's
 * labels, and at its foot the account. The open folder is
 * marked by one capsule that glides from folder to folder (ui/glide). Every folder's and label's icon is the home a message flies to (ui/
 * homing). On the desktop it stands on the window ground beside the two sheets; on a phone it is the drawer (a sheet of its own).
 */
export const Sidebar: React.FC<SidebarProps> = ({ t, folder, onSelectFolder, stats, labels, onCompose, onCloseMobile, foot }) => {
  const tr = useT();
  // The C key works only while single-key shortcuts are on (Settings, WCAG 2.1.4): the tooltip names it only then.
  const singleKeys = usePrefs().shortcuts;
  const keyHint = singleKeys && onCloseMobile === undefined;
  // Stats come from the API, so any folder can be missing.
  const folderStats: Partial<FolderStats> = stats;
  const navRef = React.useRef<HTMLDivElement | null>(null);
  const glideRef = useGlide(navRef, "[aria-current='page']", { key: `${folder}\n${labels.length}` });
  const composeRef = React.useRef<HTMLButtonElement | null>(null);
  const composeHome = homeRef('compose');
  const setCompose = React.useCallback(
    (node: HTMLButtonElement | null) => {
      composeRef.current = node;
      return composeHome(node);
    },
    [composeHome]
  );
  const tip = useTooltip();

  const pick = (id: string) => {
    onSelectFolder(id);
    onCloseMobile?.();
  };

  return (
    <aside aria-label={tr('sidebar.navigation')} className="mb-sidebar" data-drawer={onCloseMobile ? '' : undefined}>
      <div className="mb-sidebar-top">
        <BrandMark t={t} />
        {/* The drawer brings its own way out. */}
        {onCloseMobile ? (
          <IconButton label={tr('sidebar.close_mailboxes')} onClick={onCloseMobile}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>

      <div className="mb-compose-wrap">
        <Button
          ref={setCompose}
          variant="secondary"
          shape="pill"
          size="lg"
          fullWidth
          data-compose-button=""
          className="mb-compose"
          aria-keyshortcuts={keyHint ? COMPOSE_KEY : undefined}
          leadingIcon={<PenLine size={18} strokeWidth={1.75} aria-hidden="true" />}
          onPointerEnter={keyHint ? tip.anchor.onPointerEnter : undefined}
          onPointerMove={keyHint ? tip.anchor.onPointerMove : undefined}
          onPointerLeave={keyHint ? tip.anchor.onPointerLeave : undefined}
          onPointerDown={() => tip.show(false)}
          onFocus={(event) => tip.show(keyHint && event.currentTarget.matches(':focus-visible'))}
          onBlur={() => tip.show(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              tip.show(false);
            }
          }}
          onClick={onCompose}
        >
          {tr('action.compose')}
        </Button>
        <Tooltip
          open={tip.open ? keyHint : false}
          text={`${tr('action.compose')} (${COMPOSE_KEY})`}
          anchorRef={composeRef}
          {...tip.bubble}
        />
      </div>

      <div className="mb-sidebar-scroll">
        {/* One capsule marks the open folder or label and glides to the next one (DESIGN-v3 H3); it stands under the rows. */}
        <div ref={navRef} className="ui-glide-host mb-rail-nav">
          <div ref={glideRef} aria-hidden="true" className="ui-glide mb-nav-glide" />
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
                      <span ref={homeRef(item.id)} className="mb-nav-icon" data-home-icon="">
                        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="mb-nav-label">{folderName(item.id)}</span>
                      {count > 0 ? (
                        <Odometer
                          value={count}
                          format={(n) => fmt.number(n)}
                          className={item.id === 'inbox' ? 'mb-nav-count mb-nav-count-unread' : 'mb-nav-count'}
                        />
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
                        <span ref={homeRef(`label:${name}`)} aria-hidden="true" className="mb-label-swatch" data-home-icon="">
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
      </div>

      {foot === undefined ? null : <div className="mb-rail-foot">{foot}</div>}
    </aside>
  );
};
