import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type React from 'react';
import { useT } from '../lib/i18n';
import { cx } from './cx';
import { has } from './Field';
import { IconButton } from './IconButton';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

interface BannerProps {
  tone?: BannerTone;
  /** A short heading in bold; the text goes in the children. */
  title?: string;
  /** One button or link for what to do about it. */
  action?: React.ReactNode;
  /** Shows a close button that calls this. Leave it out for a notice that must stay. */
  onDismiss?: () => void;
  /**
   * False for a notice that is part of what a screen just showed and is read in its place (under the heading that takes focus): no live
   * region, so it is not said twice. Default: `warning` and `danger` are alerts, the others are polite.
   */
  live?: boolean;
  className?: string;
  children: React.ReactNode;
}

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert } as const;

/**
 * A notice inside the page, above the content it is about: something to know (`info`), a result (`success`), something to watch
 * (`warning`) or a failure (`danger`). It always says it in words, with an icon as a second cue. `warning` and `danger` are announced to a screen
 * reader as soon as they appear; the others politely. For a short message that goes away on its own use the Toast.
 */
export function Banner({ tone = 'info', title, action, onDismiss, live = true, className, children }: BannerProps): React.ReactElement {
  const tr = useT();
  const Icon = ICONS[tone];
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div role={live ? role : undefined} className={cx('ui-banner', className)} data-tone={tone}>
      <Icon size={18} aria-hidden="true" className="ui-banner-icon" />
      <div className="ui-banner-body">
        {has(title) ? <p className="ui-banner-title">{title}</p> : null}
        <div className="ui-banner-text">{children}</div>
      </div>
      {action === undefined ? null : <div className="ui-banner-action">{action}</div>}
      {onDismiss === undefined ? null : (
        <IconButton label={tr('common.close')} size="sm" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
