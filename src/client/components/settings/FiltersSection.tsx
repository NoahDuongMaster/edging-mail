import React from 'react';
import { announce } from '../../lib/announce';
import { ofKind, useFilters } from '../../lib/filters';
import { useT } from '../../lib/i18n';
import { useSaveSettings, useSettings } from '../../lib/settings';
import { Button, Spinner, Switch } from '../../ui';
import { FilterList } from './FilterList';
import { SettingsGroup } from './SettingsPage';
import './settings.css';

const SWITCH_ID = 'filters-spam';

/**
 * The one switch of the spam filter: it takes effect at once and the server asks for nothing more. It is confirmed, not optimistic (as the
 * admin's pictures switch): it shows what the server has, cannot be pressed while the request runs, and takes the keyboard's place back
 * afterwards only if it had it (a button that turns disabled drops focus to the page). The help under it is one visible line and keeps the
 * promise that nothing is deleted or rejected; a failed save says so under the switch (and at once to a screen reader).
 */
function SpamSwitch(): React.ReactElement {
  const tr = useT();
  const settings = useSettings();
  const { mutate, isPending } = useSaveSettings();
  const [problem, setProblem] = React.useState<string | null>(null);
  const hadFocus = React.useRef(false);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (!isPending && hadFocus.current) {
      hadFocus.current = false;
      document.querySelector<HTMLElement>(`#${SWITCH_ID}`)?.focus({ preventScroll: true });
    }
  }, [isPending]);

  if (settings.isError && settings.data === undefined) {
    return (
      <SettingsGroup>
        <div className="st-inline">
          <p className="st-muted">{tr('settings.load_failed')}</p>
          <Button
            size="sm"
            onClick={() => {
              void settings.refetch();
            }}
          >
            {tr('common.retry')}
          </Button>
        </div>
      </SettingsGroup>
    );
  }
  return (
    <SettingsGroup>
      <Switch
        id={SWITCH_ID}
        label={tr('filters.switch')}
        hint={tr('filters.switch_hint')}
        hintMode="inline"
        // On until the person turns it off (the server's default too), also while the settings load.
        checked={settings.data?.spam_filter !== false}
        disabled={settings.data === undefined || isPending}
        onChange={(next) => {
          hadFocus.current = document.activeElement?.id === SWITCH_ID;
          setProblem(null);
          mutate(
            { spam_filter: next },
            {
              onSuccess: () => announce(tr('settings.saved')),
              onError: (error) => {
                const text = error instanceof TypeError ? tr('settings.save_offline') : error.message;
                if (mounted.current) {
                  setProblem(text);
                }
                announce(text, { assertive: true });
              }
            }
          );
        }}
      />
      {problem === null ? null : (
        <p className="st-feedback" data-tone="danger">
          {problem}
        </p>
      )}
    </SettingsGroup>
  );
}

/**
 * Settings > Filters, small on purpose: the one switch, then the person's own Allowed senders and Blocked senders (FilterList). Nothing else: no
 * search, no import or export, no counts. The lists come from `GET /api/filters`; while they load there is a quiet status, and when they cannot be
 * loaded the one line with Try again that the profile uses.
 */
export function FiltersSection(): React.ReactElement {
  const tr = useT();
  const filters = useFilters();
  const loaded = filters.data;
  return (
    <>
      <SpamSwitch />
      {loaded === undefined ? (
        <SettingsGroup>
          {filters.isError ? (
            <div className="st-inline">
              <p className="st-muted">{tr('fail.filters_load')}</p>
              <Button
                size="sm"
                onClick={() => {
                  void filters.refetch();
                }}
              >
                {tr('common.retry')}
              </Button>
            </div>
          ) : (
            <p role="status" className="st-status">
              <Spinner decorative /> {tr('common.loading')}
            </p>
          )}
        </SettingsGroup>
      ) : (
        <>
          <FilterList kind="allow" entries={ofKind(loaded, 'allow')} />
          <FilterList kind="block" entries={ofKind(loaded, 'block')} />
        </>
      )}
    </>
  );
}
