// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The client half of the spam filter, read from the sources: what a render cannot show (how Not spam is wired in the app, its Undo, the lifecycle
// of the lists, the words that must stay true) and the size of the new files.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const readRoot = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const withoutComments = (code: string): string => code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');

const NEW_FILES = [
  ['lib', 'spamReasons.ts'],
  ['lib', 'filters.ts'],
  ['lib', 'notSpam.ts'],
  ['components', 'reader', 'SpamBanner.tsx'],
  ['components', 'settings', 'FiltersSection.tsx'],
  ['components', 'settings', 'FilterList.tsx'],
  ['components', 'settings', 'FilterGroup.tsx']
];

describe('Not spam in the app (App.tsx)', () => {
  const app = withoutComments(read('App.tsx'));

  it('is the batch action not_spam, and the toast waits for the answer, because who was allowed is only known from it', () => {
    expect(app).toMatch(/batch\('not_spam', \[message\.id\], undefined, \(answer\) => \{\s*allowed\.push\(\.\.\.allowedOf\(answer\)\);/);
    expect(app).toMatch(/void Promise\.all\(\[rowsGone\(\[message\.id\]\), request\]\)\.then\(\(\[, ok\]\) => \{\s*if \(ok === true\) \{/);
    expect(app).toMatch(/runChunks\('not_spam', ids, undefined, \(answer\) => \{\s*allowed\.push\(\.\.\.allowedOf\(answer\)\);/);
    expect(app).toMatch(/\(notSpam && !\(await request\)\)/);
  });

  it('is what a restore of a message in Spam does (row action, row menu, the e key), and only there: Trash keeps the plain move', () => {
    expect(app).toMatch(
      /if \(action === 'restore'\) \{\s*if \(message\.folder === 'spam'\) \{\s*await notSpamMessage\(message, origin\);\s*return;\s*\}\s*await moveMessage\(message, 'inbox', origin\);/
    );
    expect(app).toMatch(/restore: \(\) => \(folder === 'spam' \? bulkMove\('inbox', undefined, true\) : bulkMove\('inbox'\)\)/);
    expect(app).toMatch(/onNotSpam=\{\(m\) => \{\s*void notSpamMessage\(m, 'reader'\);/);
  });

  it('undoes by moving the messages back to Spam first and putting the lists back (delete the allowed entries, block the unblocked again) only when that worked, one or many', () => {
    // One message: undoFor puts it back, and only then runs the deletion of what the answer named.
    expect(app).toMatch(
      /const undoFor = \(message: Message, after\?: \(\) => Promise<void>\) => async \(\): Promise<void> => \{\s*const ok = await putBack\(message\);\s*if \(ok\) \{\s*await after\?\.\(\);/
    );
    expect(app).toContain('undoFor(message, () => restoreLists(notSpamUndo([message.id], allowed, unblocked)))');
    // Many: the same plan, the move first, the deletion only if every chunk went back.
    expect(app).toMatch(
      /const plan = notSpamUndo\(ids, allowed, unblocked\);\s*if \(await runChunks\(plan\.move\.action, plan\.move\.ids, \{ folder: plan\.move\.folder \}\)\) \{\s*await restoreLists\(plan\);/
    );
  });

  it('says it when the allowed senders could not be taken away again: an error toast that says where they still are', () => {
    expect(app).toMatch(/setToast\(\{ text: tr\('toast\.not_spam_undo_partial'\), error: true \}\)/);
  });

  it('keeps the Undo toast to the default 8 s (no duration of its own)', () => {
    expect(app).not.toMatch(/notSpamText[^}]*duration/);
  });
});

describe('where else Spam offers the way back', () => {
  it('names it Not spam in the reader toolbar, the selection bar and summary, the row action and the row menu, and only for Spam', () => {
    expect(read('components', 'MessageView.tsx')).toMatch(
      /const toInbox: Move = inSpam\s*\? \{ label: tr\('action\.not_spam'\), icon: Inbox, run: \(\) => onNotSpam\(message\) \}/
    );
    expect(read('components', 'SelectionBar.tsx')).toContain(
      "label: folder === 'spam' ? tr('action.not_spam') : tr('action.move_to_inbox')"
    );
    expect(read('components', 'SelectionSummary.tsx')).toContain(
      "{folder === 'spam' ? tr('action.not_spam') : tr('action.move_to_inbox')}"
    );
    expect(read('components', 'MessageList.tsx')).toContain("label={inSpam ? tr('action.not_spam') : tr('action.move_to_inbox')}");
    expect(read('components', 'RowMenu.tsx')).toContain("label: folder === 'spam' ? tr('action.not_spam') : tr('action.move_to_inbox')");
  });

  it('keeps the old "In Spam" notice out of the catalogues: one banner now explains', () => {
    for (const language of ['en', 'vi', 'zh-CN']) {
      const catalogue = JSON.parse(readRoot('src', 'shared', 'i18n', 'locales', `${language}.json`)) as Record<string, string>;
      expect(catalogue['reader.spam_notice'], language).toBeUndefined();
    }
  });
});

describe('the banner (reader/SpamBanner.tsx)', () => {
  const code = withoutComments(read('components', 'reader', 'SpamBanner.tsx'));

  it('is a ui Banner that is not a live region (it is read with its letter), with a primary Not spam button', () => {
    expect(code).toMatch(/<Banner live=\{false\} className="rd-spam"/);
    expect(code).toMatch(/<Button variant="primary" size="sm"/);
    expect(code).not.toMatch(/role=|aria-live|announce\(/);
  });

  it('reads its reasons only through explainSpam (nothing parses the column in place)', () => {
    expect(code).toContain('explainSpam(message)');
    expect(code).not.toMatch(/JSON\.parse/);
  });

  it('draws no colour of its own (reader.css and the ui Banner do)', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|style=/);
  });
});

describe('Settings > Filters', () => {
  const modal = withoutComments(read('components', 'SettingsModal.tsx'));
  const section = withoutComments(read('components', 'settings', 'FiltersSection.tsx'));
  const list = withoutComments(read('components', 'settings', 'FilterList.tsx'));

  it('is one quiet nav entry after Mail, with a funnel icon, and a page that is only the section', () => {
    expect(modal).toMatch(
      /\{ id: 'mail', [^}]*\},\s*\{ id: 'filters', labelKey: 'settings\.filters', descriptionKey: 'settings\.filters_desc', icon: ListFilter \}/
    );
    expect(modal).toMatch(/case 'filters': \{\s*return page\(entry, <FiltersSection \/>\);/);
  });

  it('saves the switch alone (spam_filter), confirmed and not optimistic: disabled while it saves, announced, focus given back', () => {
    expect(section).toMatch(/mutate\(\s*\{ spam_filter: next \}/);
    expect(section).toMatch(/disabled=\{settings\.data === undefined \|\| isPending\}/);
    expect(section).toMatch(/announce\(tr\('settings\.saved'\)\)/);
    expect(section).toMatch(/hadFocus\.current = document\.activeElement\?\.id === SWITCH_ID/);
    expect(section).not.toMatch(/setQueryData|optimistic/);
  });

  it('removes without asking, says it to screen readers, and hands focus on (never to the page)', () => {
    expect(list).not.toMatch(/ConfirmDialog|confirm\(|window\.confirm/);
    expect(list).toMatch(/announce\(tr\('filters\.removed', \{ value: entry\.value \}\)\)/);
    expect(list).toMatch(
      /\(buttons\.at\(gone\.index\) \?\? \(gone\.index > 0 \? buttons\.at\(gone\.index - 1\) : undefined\) \?\? fieldRef\.current\)\?\.focus/
    );
  });

  it('says a refusal at once (assertive) and turns an offline failure into "No connection", not the browser\'s own text', () => {
    expect(list).toMatch(/announce\(text, \{ assertive: true \}\)/);
    expect(list).toMatch(/error instanceof TypeError \? tr\('app\.no_connection'\) : error\.message/);
  });

  it('has no search, no import or export and no counts: only the switch and two lists', () => {
    for (const code of [section, list, withoutComments(read('components', 'settings', 'FilterGroup.tsx'))]) {
      expect(code).not.toMatch(
        /type="search"|variant="search"|\bimport(?:ing)? ?(?:list|file)|\bexport(?:ing)? ?(?:list|file)|\.length\}\s*(?:entries|senders)/i
      );
    }
  });
});

describe('the client lib', () => {
  it('asks only /api/filters for the lists, and /api/messages/batch for Not spam (no new route of its own)', () => {
    const filters = withoutComments(read('lib', 'filters.ts'));
    expect([...filters.matchAll(/'(\/api\/[^'`]*)'|`(\/api\/[^`]*)`/g)].map((match) => match[1] || match[2])).toEqual([
      '/api/filters',
      '/api/filters',
      // The path as the source spells it: a template literal, read here as plain text.
      // eslint-disable-next-line no-template-curly-in-string -- the case under test: the source text of a template literal
      '/api/filters/${encodeURIComponent(id)}'
    ]);
    expect(withoutComments(read('lib', 'queries.ts'))).toContain("| 'not_spam'");
  });

  it('puts the person first: no sender address or filter value is written to a log', () => {
    for (const file of ['filters.ts', 'notSpam.ts', 'spamReasons.ts']) {
      expect(withoutComments(read('lib', file)), file).not.toMatch(/console\./);
    }
  });

  it('keeps every new file within 300 lines', () => {
    for (const parts of NEW_FILES) {
      expect(read(...parts).split('\n').length, parts.join('/')).toBeLessThanOrEqual(300);
    }
  });
});
