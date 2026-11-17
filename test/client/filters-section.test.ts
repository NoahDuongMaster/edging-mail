import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import { FilterGroup, type FilterGroupProps } from '../../src/client/components/settings/FilterGroup';
import { FiltersSection } from '../../src/client/components/settings/FiltersSection';
import { filtersKey, type Filter } from '../../src/client/lib/filters';
import { settingsKey, type Settings } from '../../src/client/lib/settings';

// Settings > Filters, as the HTML it renders (no browser): the one switch, then the two sender lists. Typing, Add, Remove and the focus that
// follows them need a real browser; their requests and their cache are in test/client/filters-lib.test.ts.

const SETTINGS: Settings = { display_name: 'Dana', signature: '', email: 'dana@example.com', spam_filter: true };
const entry = (id: string, kind: Filter['kind'], value: string, created_at = 1): Filter => ({ id, kind, value, created_at });

function section(options: { settings?: Partial<Settings> | null; filters?: Filter[] | null } = {}): string {
  const client = new QueryClient();
  if (options.settings !== null) {
    client.setQueryData(settingsKey, { ...SETTINGS, ...options.settings });
  }
  if (options.filters !== null) {
    client.setQueryData(filtersKey, options.filters ?? []);
  }
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(FiltersSection)));
}

/** The opening tag of the switch. */
const switchTag = (html: string): string => /<button\b[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? '';
/** The words of the quiet group titles, in page order. */
const titles = (html: string): string[] =>
  [...html.matchAll(/<h4[^>]*class="ui-section-title"[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1]);

describe('the switch', () => {
  it('is one switch named "Move likely spam to Spam", on by default, with the one line that promises nothing is deleted or rejected', () => {
    const html = section();
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(switchTag(html)).toContain('aria-checked="true"');
    expect(html).toContain(`>${en['filters.switch']}</label>`);
    // The help is one visible line (not behind a tip): it is what the person needs to trust the switch.
    expect(html).toContain(`<span id="filters-spam-hint" class="ui-hint">${en['filters.switch_hint']}</span>`);
    expect(en['filters.switch_hint']).toContain('Nothing is ever deleted or rejected.');
  });

  it('shows the filter off when the server says so, and on while the settings are not known yet (disabled until they are)', () => {
    expect(switchTag(section({ settings: { spam_filter: false } }))).toContain('aria-checked="false"');
    const loading = switchTag(section({ settings: null }));
    expect(loading).toContain('aria-checked="true"');
    expect(loading).toContain('disabled');
    expect(switchTag(section())).not.toContain('disabled');
  });
});

describe('the two lists', () => {
  it('are Allowed senders and Blocked senders, each with its one line, and each with an add field and an Add button', () => {
    const html = section();
    expect(titles(html)).toEqual([en['filters.allow_title'], en['filters.block_title']]);
    expect(html).toContain(en['filters.allow_desc']);
    expect(html).toContain(en['filters.block_desc']);
    expect(html.match(/placeholder="name@example\.com or example\.com"/g)).toHaveLength(2);
    expect(html).toContain('id="filters-add-allow"');
    expect(html).toContain('id="filters-add-block"');
    expect(html.match(/type="submit"/g)).toHaveLength(2);
    // The fields are named for screen readers (the placeholder is not a name).
    expect(html).toContain(`>${en['filters.add_allow_label']}</label>`);
    expect(html).toContain(`>${en['filters.add_block_label']}</label>`);
  });

  it('say one sentence each when empty, and list no rows', () => {
    const html = section();
    expect(html).toContain(en['filters.allow_empty']);
    expect(html).toContain(en['filters.block_empty']);
    expect(html).not.toContain('st-filter-list');
  });

  it('list their own entries, in the order of the cache (newest first: lib/filters), each with a Remove named by its entry', () => {
    const html = section({
      filters: [
        entry('b', 'allow', 'example.org', 5),
        entry('a', 'allow', 'alice@example.com', 1),
        entry('c', 'block', 'spam.example.net', 3)
      ]
    });
    const [allowed, blocked] = html.split(`>${en['filters.block_title']}<`);
    expect([...allowed.matchAll(/class="st-filter-value">([^<]*)</g)].map((match) => match[1])).toEqual([
      'example.org',
      'alice@example.com'
    ]);
    expect([...blocked.matchAll(/class="st-filter-value">([^<]*)</g)].map((match) => match[1])).toEqual(['spam.example.net']);
    for (const value of ['alice@example.com', 'example.org', 'spam.example.net']) {
      expect(html).toContain(`aria-label="Remove ${value}"`);
    }
    // The visible word is the one the name starts with (2.5.3), and no list is empty any more.
    expect(html.match(/>Remove<\/button>/g)).toHaveLength(3);
    expect(allowed).not.toContain(en['filters.allow_empty']);
    expect(blocked).not.toContain(en['filters.block_empty']);
  });

  it('keep the empty state of one list while the other has entries', () => {
    const html = section({ filters: [entry('c', 'block', 'spam.example.net')] });
    expect(html).toContain(en['filters.allow_empty']);
    expect(html).not.toContain(en['filters.block_empty']);
  });

  it('show a quiet status while they load, not the empty sentences', () => {
    const html = section({ filters: null });
    expect(html).toContain('role="status"');
    expect(html).toContain(en['common.loading']);
    expect(html).not.toContain(en['filters.allow_empty']);
    expect(html).not.toContain('placeholder=');
  });

  it('never ask before removing (adding the sender again undoes it): no dialog, no confirm in the section', () => {
    const html = section({ filters: [entry('a', 'allow', 'alice@example.com')] });
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('role="alertdialog"');
  });
});

const noop = (): void => undefined;

const view = (over: Partial<FilterGroupProps> = {}): string =>
  renderToStaticMarkup(
    createElement(FilterGroup, {
      kind: 'allow',
      entries: [],
      value: '',
      problem: null,
      removeProblem: null,
      removing: null,
      adding: false,
      listRef: null,
      fieldRef: null,
      onValue: noop,
      onAdd: noop,
      onRemove: noop,
      ...over
    })
  );

describe('the validation message (the server code invalid_filter, too_many_filters)', () => {
  it('stands under the field, tied to it, and turns the field invalid', () => {
    const html = view({ value: 'not an address', problem: en['err.invalid_filter'] });
    expect(html).toContain(`<p id="filters-add-allow-error" class="ui-error">`);
    expect(html).toContain(en['err.invalid_filter']);
    const field = /<input\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain('aria-describedby="filters-add-allow-error"');
    // What was typed stays, so it can be corrected.
    expect(field).toContain('value="not an address"');
  });

  it('is the one the server code names, in the words of each language', () => {
    expect(en['err.invalid_filter']).toMatch(/name@example\.com/);
    expect(en['err.too_many_filters']).toMatch(/500/);
    expect(view({ problem: en['err.too_many_filters'] })).toContain(en['err.too_many_filters']);
  });

  it('has no message while nothing is wrong, and says a failed Remove under the list, not under the field', () => {
    expect(view()).not.toContain('ui-error');
    const html = view({ entries: [entry('a', 'allow', 'alice@example.com')], removeProblem: en['app.no_connection'] });
    expect(html).toContain(`data-tone="danger"`);
    expect(html).toContain(en['app.no_connection']);
    expect(html).not.toContain('ui-error');
  });

  it('shows the pressed Remove as busy (it keeps its focus and its text) and Add as busy while it waits', () => {
    const html = view({
      entries: [entry('a', 'allow', 'alice@example.com'), entry('b', 'allow', 'example.org')],
      removing: 'b',
      adding: true
    });
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*\sdisabled[\s=>]/);
  });
});
