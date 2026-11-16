// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The round-3 clerk's measured issues (F3), pinned from the source; each was verified in the UI lab with a browser (focus, live region,
// sizes, insets), which a render test cannot do.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, 'src', 'client', ...parts), 'utf8');
const app = read('App.tsx');
const rowMenu = read('components', 'RowMenu.tsx');

describe('keys pressed in a menu never act on the page under it', () => {
  it('the mailbox keys skip a menu or a popup, as they skip a dialog (b in the row menu acted on the open message)', () => {
    expect(app).toContain(`target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], .ui-popover')`);
  });

  it('the row menu runs the key beside an item for its own row, and stops it there', () => {
    const keys = rowMenu.slice(rowMenu.indexOf('const shortcut = keysOn ? shortcutOf('));
    expect(keys).toMatch(/event\.stopPropagation\(\);\s*const item = items\.find\(\(each\) => each\.shortcut === shortcut\);/);
  });

  it('after a press outside on nothing that takes focus, focus goes back to the row', () => {
    expect(rowMenu).toMatch(/now === document\.body \|\| \(row !== null && now !== row && now\.contains\(row\)\)/);
  });
});

describe('the status region after the selection is emptied', () => {
  it('says "Selection cleared" (Escape, Clear, the last box), not after a move of the ticked mail', () => {
    expect(app).toContain(`announce(tr('list.selection_cleared'))`);
    expect(app).toMatch(/const clearSelection = React\.useCallback\(\(\) => \{\s*quietClear\.current = true;/);
  });
});

describe('sizes and insets', () => {
  it("a dialog's close button never shrinks under its 44px on touch (a long title squeezed it to 40)", () => {
    expect(read('ui', 'ui.css')).toMatch(/\.ui-dialog-head \.ui-btn \{\s*flex: none;/);
  });

  it('the phone reader keeps its text at the safe-area line in landscape, not 1px into it', () => {
    expect(read('components', 'reader.css')).toMatch(
      /\.rd-page\[data-compact='true'\] \{[^}]*max\(16px, env\(safe-area-inset-left, 0px\) - var\(--rd-side\)\)/
    );
  });

  it('a phone on its side gives the Compose button a lane of its own at the end of the rows', () => {
    expect(read('components', 'mailbox.css')).toMatch(
      /@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.mb-root\[data-layout='phone'\] \.ml-root\[data-compact='true'\] \{\s*--ml-end: calc\(/
    );
  });
});
