import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { IconButton, InfoTip } from '../../ui';
import { tipLines } from './SettingsPage';

/**
 * A view that takes the place of a section's page (a view of Security: Change password, Recovery codes...): on a phone the bar at the top of
 * the sheet shows its title, its tip and its way back instead of the section's. `back` is null when the view brings its own way out (a
 * Cancel under a recovery key, a Back under a result): the bar then goes back to the list, as on a section's page.
 */
export interface SettingsView {
  title: string;
  back: (() => void) | null;
  /** The explanation of the view, in paragraphs: an InfoTip after its title (in the bar on a phone, beside the heading on a desktop). */
  info?: readonly string[];
}

const ViewContext = React.createContext<((view: SettingsView | null) => void) | null>(null);

/** Given by the Settings dialog round its sections: what a view calls to put itself in the phone bar. */
export const SettingsViewProvider = ViewContext.Provider;

/**
 * Puts a view in the phone bar while it is on screen, and takes it out when it goes. Its words are compared by value, and its Back is called
 * through a ref, so a parent that makes a new function on each render does not register it again. Outside Settings (a test), nothing.
 */
export function useSettingsView({ title, back, info }: SettingsView): void {
  const set = React.useContext(ViewContext);
  const latest = React.useRef(back);
  React.useLayoutEffect(() => {
    latest.current = back;
  });
  const hasBack = back !== null;
  const words = info?.join('\n');
  React.useLayoutEffect(() => {
    set?.({
      title,
      back: hasBack ? () => latest.current?.() : null,
      info: words === undefined ? undefined : words.split('\n')
    });
  }, [set, title, hasBack, words]);
  React.useLayoutEffect(() => () => set?.(null), [set]);
}

interface SettingsBarProps {
  /** The title of what is on screen: the section's, or the view's. */
  title: string;
  info?: readonly string[];
  /** Where Back goes: to the section (from a view) or to the list (from a section). */
  onBack: () => void;
  /** While a secret is held (C-7) the way back to the list is off, as every other way out. */
  backDisabled: boolean;
}

/**
 * A phone's bar at the top of a section (DESIGN-v4m R3; settings.css places it over the sheet's head, which never scrolls): Back, the title
 * of what is on screen with its InfoTip, and the sheet's own X at the right. A desktop shows the page's own heading instead and hides it.
 * The title is drawn here for the eyes only: the page's heading (kept for screen readers) names it in the outline.
 */
export function SettingsBar({ title, info, onBack, backDisabled }: SettingsBarProps): React.ReactElement {
  const tr = useT();
  const titleRef = React.useRef<HTMLSpanElement>(null);
  const hasTip = info !== undefined;
  // A title that does not fit the bar at the title size (a long one in Vietnamese at 320px) steps down to the body size before it is cut
  // (settings.css); measured again when the title, its tip or the bar's width changes.
  React.useLayoutEffect(() => {
    const el = titleRef.current;
    if (el === null) {
      return;
    }
    const fit = (): void => {
      delete el.dataset.fit;
      if (el.scrollWidth > el.clientWidth + 1) {
        el.dataset.fit = 'tight';
      }
    };
    fit();
    const bar = el.closest('.st-bar');
    if (bar === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [title, hasTip]);
  return (
    <div className="st-bar">
      <IconButton label={tr('common.back')} disabled={backDisabled} onClick={onBack}>
        <ChevronLeft size={20} aria-hidden="true" />
      </IconButton>
      <div className="st-bar-heading">
        <span ref={titleRef} className="st-bar-title" aria-hidden="true">
          {title}
        </span>
        {info === undefined ? null : <InfoTip label={title}>{tipLines(info)}</InfoTip>}
      </div>
    </div>
  );
}
