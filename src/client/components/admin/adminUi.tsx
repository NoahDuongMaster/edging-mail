import React from 'react';
import { Ban, CircleAlert, Clock, ExternalLink, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { adminErrorText, type AdminUser } from '../../lib/admin/types';
import { useT } from '../../lib/i18n';
import { Badge, Banner, Button, Dialog, Disclosure, DisclosurePanel, Section, VisuallyHidden } from '../../ui';

/**
 * A long text that is there for whoever wants it (the full statement of what admins can and cannot do): a quiet disclosure with `label`,
 * the text in a panel under it, closed at first.
 */
export const MoreText: React.FC<{ label: string; text: string }> = ({ label, text }) => {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  return (
    <div className="ad-more">
      <Disclosure open={open} onOpenChange={setOpen} controls={panelId} look="button" className="ad-toggle">
        {label}
      </Disclosure>
      <DisclosurePanel id={panelId} open={open}>
        <p className="ad-muted">{text}</p>
      </DisclosurePanel>
    </div>
  );
};

/** The visible account avatar (the one that opens Settings), if there is one on screen. */
function accountButton(): HTMLElement | null {
  const buttons = [...document.querySelectorAll<HTMLElement>('button[data-account-button]')];
  return buttons.find((button) => button.getClientRects().length > 0) ?? null;
}

/** Moves focus to the visible account avatar (the one that opens Settings): where focus belongs when a screen opened from Settings closes. */
export function focusAccountButton(): void {
  accountButton()?.focus({ preventScroll: true });
}

/** The account avatar as a ref for ui/Dialog's `returnFocusRef`: looked up when a dialog closes and its opener is gone, never earlier. */
const ACCOUNT_BUTTON: React.RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    return accountButton();
  }
};

/** What went wrong, as words with an icon in the danger colour. Announced as soon as it appears; `id` lets a field point at it. */
export const ErrorText: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
  <p id={id} role="alert" className="ad-error">
    <CircleAlert size={16} aria-hidden="true" />
    <span>{children}</span>
  </p>
);

/** Where an account stands: in use, made but never signed into (on its temporary password), or turned off by an admin. */
export type PersonState = 'active' | 'pending' | 'disabled';

export function personState(user: AdminUser): PersonState {
  if (user.status === 'disabled') {
    return 'disabled';
  }
  return user.never_signed_in ? 'pending' : 'active';
}

/**
 * A state in words after a 14px icon, never a pill, so every value of a column starts its text at the same edge. `tone` colours an
 * exception or a check that passed (the words and the icon say it too).
 */
export const StateWord: React.FC<{ icon: React.ReactNode; tone?: 'success' | 'warning' | 'danger'; children: React.ReactNode }> = ({
  icon,
  tone,
  children
}) => (
  <span className="ad-plain" data-tone={tone}>
    <span className="ad-state-icon" aria-hidden="true">
      {icon}
    </span>
    {children}
  </span>
);

/**
 * The status of an account in words. The usual case, an account in use, is quiet text after a small neutral dot; an exception has its
 * icon and colour: Not signed in (warning) and Disabled (danger).
 */
export const PersonStatus: React.FC<{ user: AdminUser }> = ({ user }) => {
  const tr = useT();
  switch (personState(user)) {
    case 'active': {
      return <StateWord icon={<span className="ad-dot" />}>{tr('users.status_active')}</StateWord>;
    }
    case 'pending': {
      return (
        <StateWord icon={<Clock size={14} />} tone="warning">
          {tr('users.filter_pending')}
        </StateWord>
      );
    }
    case 'disabled': {
      return (
        <StateWord icon={<Ban size={14} />} tone="danger">
          {tr('users.status_disabled')}
        </StateWord>
      );
    }
  }
};

/**
 * Whether the account has two-factor sign-in. On is quiet; Off is a warning on an account someone can sign in to (a disabled one is
 * quiet). `short`: "On" or "Off" under the column header of a
 * table; the whole phrase where nothing names the column (the stacked rows of a phone, the person's dialog).
 */
export const PersonTwoFactor: React.FC<{ user: AdminUser; short?: boolean }> = ({ user, short = false }) => {
  const tr = useT();
  // Off is a warning on any account that is not disabled.
  const exposed = !user.two_factor && personState(user) !== 'disabled';
  const long = tr(user.two_factor ? 'users.two_factor_is_on' : 'users.two_factor_is_off');
  return (
    <StateWord icon={user.two_factor ? <ShieldCheck size={14} /> : <ShieldOff size={14} />} tone={exposed ? 'warning' : undefined}>
      {short ? (
        <>
          <span className="ad-wide">{tr(user.two_factor ? 'users.two_factor_on' : 'users.two_factor_off')}</span>
          <span className="ad-narrow">{long}</span>
        </>
      ) : (
        long
      )}
    </StateWord>
  );
};

/** The role of an account, the same pill for both roles so their words line up; an admin's pill is a step stronger. */
export const PersonRole: React.FC<{ user: AdminUser }> = ({ user }) => {
  const tr = useT();
  return user.role === 'admin' ? <Badge className="ad-role-admin">{tr('term.admin')}</Badge> : <Badge>{tr('term.member')}</Badge>;
};

/**
 * The head of a section of the console, as a page of Settings has it: its title (the h2 under the console's h1, 24/32), one line that says
 * what the section is for, and on the right the section's one primary action.
 */
export const PageHead: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({ title, description, action }) => (
  <header className="ad-page-head">
    <div className="ad-page-heading">
      <h2 className="ad-page-title">{title}</h2>
      <p className="ad-page-desc">{description}</p>
    </div>
    {action === undefined ? null : <div className="ad-page-action">{action}</div>}
  </header>
);

/**
 * One grouped card of rows (ui Section `grouped`, the card of a Settings page): each direct child is a row, separated from the next by a
 * hairline that starts at the text. `title` is the quiet label over the card.
 */
export const Group: React.FC<{ title?: string; description?: string; headingLevel?: 3 | 4; children: React.ReactNode }> = ({
  title,
  description,
  headingLevel = 3,
  children
}) => (
  <Section grouped className="ad-group" title={title} description={description} headingLevel={headingLevel}>
    {children}
  </Section>
);

/** A row of a Group: its words (a label, a hint under it) on the left, its control on the right; under the words on a narrow card. */
export const Row: React.FC<{ label?: string; hint?: string; hintId?: string; children?: React.ReactNode }> = ({
  label,
  hint,
  hintId,
  children
}) => (
  <div className="ad-row">
    {label === undefined && hint === undefined ? null : (
      <div className="ad-row-text">
        {label === undefined ? null : <span className="ad-row-label">{label}</span>}
        {hint === undefined ? null : (
          <span id={hintId} className="ad-row-hint">
            {hint}
          </span>
        )}
      </div>
    )}
    {children === undefined ? null : <div className="ad-row-control">{children}</div>}
  </div>
);

/** The Cloudflare dashboard: the setup of a domain is done there, not in this app. */
const DASHBOARD_URL = 'https://dash.cloudflare.com/';

/**
 * A link that opens the Cloudflare dashboard in a new tab (said by its icon, and in words to screen readers), with the way to the page
 * inside it after the link (`path`: "Compute → Email Service → Email Sending"): the dashboard has no stable address for a page of one zone.
 */
export const DashboardLink: React.FC<{ path?: string }> = ({ path }) => {
  const tr = useT();
  return (
    <p className="ad-dash">
      <a href={DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="ad-ext">
        {tr('domains.open_dashboard')}
        <ExternalLink size={13} aria-hidden="true" />
        <VisuallyHidden>{tr('domains.new_tab')}</VisuallyHidden>
      </a>
      {path === undefined ? null : <span className="ad-dash-path">{path}</span>}
    </p>
  );
};

/** A list that could not be loaded at all: the reason, and Try again. */
export const LoadError: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => {
  const tr = useT();
  return (
    <Banner
      tone="danger"
      action={
        <Button size="sm" onClick={onRetry}>
          {tr('common.retry')}
        </Button>
      }
    >
      {adminErrorText(error)}
    </Banner>
  );
};

interface ModalFrameProps {
  t: ThemeTokens;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** A request is running: the dialog cannot be dismissed until it answers. */
  locked?: boolean;
  maxWidth?: number;
  /** Role "alertdialog" for a dialog that asks before something that cannot be undone. */
  alert?: boolean;
  /** False hides the X of the title bar (a temporary password not copied yet: a dead X that looks live says nothing). */
  closeButton?: boolean;
  /** The id of the part of the content a screen reader reads when the dialog opens: the warning of a deletion (J1-26). */
  describedBy?: string;
}

/**
 * The control that takes focus when an admin dialog opens: the first, in the order of the page, that is marked data-autofocus or is an
 * enabled field or button. That is the close button of the title bar unless it is disabled; a dialog that wants focus on another control
 * moves it in its own effect, which runs after ui/Dialog's (DeleteUserDialog).
 */
const FIRST_CONTROL = '[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])';

/**
 * The frame of every admin dialog: a ui Dialog drawn in place (inside the console, so it stays under the toast as the console does) with
 * the title, the close button, Escape, the scrim, the focus trap, focus on FIRST_CONTROL when it opens and back to the opener when it
 * closes (to the account avatar when the opener is gone). `locked` disables the close button, Escape and the scrim. Dialogs are siblings,
 * never nested, so Escape and Tab only ever act on the one on top. A control inside answers Escape first: the confirmation of the person
 * dialog takes itself back before the dialog closes (D-6).
 */
export const ModalFrame: React.FC<ModalFrameProps> = ({
  title,
  onClose,
  children,
  locked = false,
  maxWidth = 480,
  alert = false,
  closeButton = true,
  describedBy
}) => {
  const firstRef = React.useRef<HTMLElement | null>(null);
  // Looked up as soon as the panel is in the page, so it is ready when ui/Dialog's effect gives the focus.
  const findFirst = React.useCallback((panel: HTMLDivElement | null) => {
    firstRef.current = panel?.querySelector<HTMLElement>(FIRST_CONTROL) ?? null;
  }, []);

  return (
    <Dialog
      inline
      open
      onClose={onClose}
      closeDisabled={locked}
      closeButton={closeButton}
      title={title}
      role={alert ? 'alertdialog' : 'dialog'}
      describedBy={describedBy}
      width={maxWidth}
      className="nm-admin ad-dialog"
      ref={findFirst}
      initialFocusRef={firstRef}
      returnFocusRef={ACCOUNT_BUTTON}
    >
      {children}
    </Dialog>
  );
};
