import React from 'react';
import { announce } from '../../lib/announce';
import { useAddFilter, useRemoveFilter, type Filter, type FilterKind } from '../../lib/filters';
import { useT } from '../../lib/i18n';
import { FilterGroup } from './FilterGroup';

interface FilterListProps {
  kind: FilterKind;
  /** The entries of this list only, in the order they are shown. */
  entries: readonly Filter[];
}

/**
 * One of the two sender lists of Settings > Filters (Allowed senders, Blocked senders), with its state; FilterGroup draws it. Nothing but the
 * entries, an empty state and one field with Add: no search, no import, no counts.
 *
 * Remove asks nothing: adding the sender again undoes it, and it is said to screen readers. The pressed Remove waits for the server (its own
 * button shows the spinner, `loading` keeps its focus) and, when the row is gone, focus goes to the Remove that took its place, else the one
 * before, else the field: never to the page. A refusal of Add (`invalid_filter`, `too_many_filters`) stands under the field, in the words of
 * lib/api.ts, and is said at once; the field keeps what was typed. A result that comes back after Settings was left changes nothing on screen
 * (the lists in the cache are updated by the hooks all the same).
 */
export function FilterList({ kind, entries }: FilterListProps): React.ReactElement {
  const tr = useT();
  const add = useAddFilter();
  const remove = useRemoveFilter();
  const [value, setValue] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [removeProblem, setRemoveProblem] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const fieldRef = React.useRef<HTMLInputElement | null>(null);
  // The entry whose Remove was pressed and the place it had: once it is out of the list, focus goes to the row that took that place.
  const leaving = React.useRef<{ id: string; index: number } | null>(null);

  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useLayoutEffect(() => {
    const gone = leaving.current;
    if (gone === null || entries.some((entry) => entry.id === gone.id)) {
      return;
    }
    leaving.current = null;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    (buttons.at(gone.index) ?? (gone.index > 0 ? buttons.at(gone.index - 1) : undefined) ?? fieldRef.current)?.focus({
      preventScroll: true
    });
  }, [entries]);

  // fetch rejects with a TypeError when offline; any other failure carries its own words (the server's code, in the UI language).
  const wording = (error: Error): string => (error instanceof TypeError ? tr('app.no_connection') : error.message);

  const fail = (text: string, set: (text: string) => void) => {
    if (mounted.current) {
      set(text);
      announce(text, { assertive: true });
    }
  };

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (add.isPending) {
      return;
    }
    setProblem(null);
    // Nothing typed is the same refusal the server gives, without asking it.
    if (text === '') {
      fail(tr('err.invalid_filter'), setProblem);
      return;
    }
    add.mutate(
      { kind, value: text },
      {
        onSuccess: (filter) => {
          if (mounted.current) {
            setValue('');
            announce(tr('filters.added', { value: filter.value }));
          }
        },
        onError: (error) => fail(wording(error), setProblem)
      }
    );
  };

  const removeEntry = (entry: Filter, index: number) => {
    if (removing !== null) {
      return;
    }
    setRemoving(entry.id);
    setRemoveProblem(null);
    leaving.current = { id: entry.id, index };
    remove.mutate(entry.id, {
      onSuccess: () => {
        if (mounted.current) {
          announce(tr('filters.removed', { value: entry.value }));
        }
      },
      onError: (error) => {
        leaving.current = null;
        fail(wording(error), setRemoveProblem);
      },
      onSettled: () => {
        if (mounted.current) {
          setRemoving(null);
        }
      }
    });
  };

  return (
    <FilterGroup
      kind={kind}
      entries={entries}
      value={value}
      problem={problem}
      removeProblem={removeProblem}
      removing={removing}
      adding={add.isPending}
      listRef={listRef}
      fieldRef={fieldRef}
      onValue={(text) => {
        setValue(text);
        setProblem(null);
      }}
      onAdd={submit}
      onRemove={removeEntry}
    />
  );
}
