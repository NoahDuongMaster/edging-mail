import type React from 'react';
import { CircleAlert } from 'lucide-react';
import type { Filter, FilterKind } from '../../lib/filters';
import { useT } from '../../lib/i18n';
import { Button, TextField } from '../../ui';
import { SettingsGroup } from './SettingsPage';
import './settings.css';

export interface FilterGroupProps {
  kind: FilterKind;
  /** The entries of this list only, in the order they are shown. */
  entries: readonly Filter[];
  /** What is typed in the add field. */
  value: string;
  /** Why Add was refused (the server's `invalid_filter` / `too_many_filters`, or no connection): under the field. */
  problem: string | null;
  /** Why a Remove failed: under the list. */
  removeProblem: string | null;
  /** The entry whose Remove waits for the server. */
  removing: string | null;
  /** An Add waits for the server. */
  adding: boolean;
  listRef: React.Ref<HTMLUListElement>;
  fieldRef: React.Ref<HTMLInputElement>;
  onValue: (text: string) => void;
  onAdd: (event: React.SyntheticEvent) => void;
  onRemove: (entry: Filter, index: number) => void;
}

/**
 * The look of one sender list (FilterList holds its state): a quiet title and line, the entries (value, Remove), the empty state of one sentence,
 * and the add field with Add under them. Plain props in, markup out, so every state can be rendered on the server and tested.
 */
export function FilterGroup({
  kind,
  entries,
  value,
  problem,
  removeProblem,
  removing,
  adding,
  listRef,
  fieldRef,
  onValue,
  onAdd,
  onRemove
}: FilterGroupProps): React.ReactElement {
  const tr = useT();
  const allow = kind === 'allow';
  return (
    <SettingsGroup
      title={allow ? tr('filters.allow_title') : tr('filters.block_title')}
      description={allow ? tr('filters.allow_desc') : tr('filters.block_desc')}
    >
      {entries.length === 0 ? (
        <p className="st-row-hint">{allow ? tr('filters.allow_empty') : tr('filters.block_empty')}</p>
      ) : (
        <ul ref={listRef} className="st-filter-list">
          {entries.map((entry, index) => (
            <li key={entry.id} className="st-filter">
              <span className="st-filter-value">{entry.value}</span>
              {/* Named by the row it removes (Remove alice@example.com), starting with the word it shows. */}
              <Button
                size="sm"
                variant="ghost"
                loading={removing === entry.id}
                aria-label={tr('filters.remove_named', { value: entry.value })}
                onClick={() => onRemove(entry, index)}
              >
                {tr('common.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {removeProblem === null ? null : (
        <p className="st-feedback st-filter-problem" data-tone="danger">
          <CircleAlert size={16} aria-hidden="true" />
          {removeProblem}
        </p>
      )}
      <form className="st-filter-add" onSubmit={onAdd} noValidate>
        <TextField
          ref={fieldRef}
          id={`filters-add-${kind}`}
          label={allow ? tr('filters.add_allow_label') : tr('filters.add_block_label')}
          hideLabel
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          placeholder={tr('filters.add_placeholder')}
          value={value}
          error={problem ?? undefined}
          onChange={(event) => onValue(event.target.value)}
        />
        <Button type="submit" loading={adding}>
          {tr('common.add')}
        </Button>
      </form>
    </SettingsGroup>
  );
}
