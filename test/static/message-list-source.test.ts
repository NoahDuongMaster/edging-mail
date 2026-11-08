// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// What a render cannot show about the message list and the snooze menu (components/MessageList.tsx, SnoozeMenu.tsx, messagelist.css): the
// behaviour that the restyle must not change, kept as source facts (the gesture reads refs, not state; the menu tells a pointer open from a
// keyboard open), and the design discipline of the two files (no colour literal in the code, no browser control, motion that rests).

const read = (name: string): string => readFileSync(path.join(ROOT, 'src', 'client', 'components', name), 'utf8');
const code = (name: string): string =>
  read(name)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');

describe('MessageList: behaviour that the restyle keeps', () => {
  const list = code('MessageList.tsx');

  it('swipe-to-archive: the gesture lives in refs (a flick can end before React re-renders), touch and pen only, a swipe never opens the mail', () => {
    expect(list).toMatch(/const gesture = React\.useRef\(\{ startX: 0, startY: 0, tracking: false, active: false, dx: 0 \}\)/);
    expect(list).toMatch(/const swiped = React\.useRef\(false\)/);
    expect(list).toContain("e.pointerType === 'mouse'");
    expect(list).toMatch(/Math\.abs\(moveX\) < 10 \|\| Math\.abs\(moveX\) < Math\.abs\(e\.clientY - g\.startY\)/);
    expect(list).toMatch(/g\.dx <= -SWIPE_REVEAL/);
    expect(list).toMatch(/window\.setTimeout\(\(\) => onSwipeArchive\?\.\(m\), 160\)/);
    expect(list).toMatch(/onClickCapture=\{\(e\) => \{\s*if \(swiped\.current\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
  });

  it('scroll memory: the offset is restored before paint and written on scroll', () => {
    expect(list).toMatch(
      /React\.useLayoutEffect\(\(\) => \{\s*if \(scrollMemory && scrollerRef\.current\) \{\s*scrollerRef\.current\.scrollTop = scrollMemory\.current;/
    );
    expect(list).toMatch(/scrollMemory\.current = e\.currentTarget\.scrollTop/);
  });

  it('Load more keeps keyboard focus while it loads (aria-disabled through `loading`, never `disabled`) and ignores a press then', () => {
    expect(list).toMatch(/loading=\{loadingMore\}/);
    expect(list).toMatch(/if \(!loadingMore\) \{\s*onLoadMore\?\.\(\);/);
    expect(list).not.toMatch(/disabled=/);
  });

  it('the load failure keeps its own state and its Try again button', () => {
    expect(list).toContain("tr('list.load_failed')");
    expect(list).toContain("tr('list.load_failed_hint')");
    expect(list).toMatch(/loadFailed \? <Button onClick=\{onRetry\}>\{tr\('common\.retry'\)\}<\/Button>/);
  });

  it('keeps the exported names and the props that App.tsx passes', () => {
    expect(list).toMatch(/export type MailFilter = 'all' \| 'unread' \| 'starred' \| 'attachments'/);
    expect(list).toMatch(/export const MessageList: React\.FC<MessageListProps>/);
    for (const prop of [
      'onSwipeArchive',
      'scrollMemory',
      'hasMore',
      'loadingMore',
      'onLoadMore',
      'loadFailed',
      'onRetry',
      'isDrafts',
      'isSnoozed',
      'compact'
    ]) {
      expect(list, prop).toMatch(new RegExp(String.raw`\b${prop}\??:`));
    }
  });
});

describe('SnoozeMenu: behaviour that the restyle keeps', () => {
  const menu = code('SnoozeMenu.tsx');

  it('tells a pointer open from a keyboard open: only the keyboard moves focus into the menu', () => {
    expect(menu).toMatch(/const pointerOpen = React\.useRef\(false\)/);
    expect(menu).toMatch(/onPointerDown=\{\(\) => \{\s*pointerOpen\.current = true;/);
    expect(menu).toMatch(/onKeyDown=\{\(\) => \{\s*pointerOpen\.current = false;/);
    expect(menu).toMatch(/viaKeyboard: !viaPointer/);
    expect(menu).toMatch(
      /if \(isOpen && viaKeyboard\) \{\s*menuRef\.current\?\.querySelector<HTMLElement>\('\[role="menuitem"\]'\)\?\.focus\(\)/
    );
  });

  it('Escape closes it and gives focus back to the button; a press outside only closes it', () => {
    expect(menu).toMatch(/if \(reason === 'escape'\) \{\s*buttonRef\.current\?\.focus\(\);/);
    expect(menu).toContain('<Popover');
    expect(menu).toContain('anchorRef={buttonRef}');
  });

  it('the arrow keys: from a pointer open Down enters at the first item and Up at the last; inside the date field they belong to the field', () => {
    expect(menu).toContain("items.at(e.key === 'ArrowDown' ? 0 : -1)?.focus()");
    expect(menu).toContain("items.at((index + (e.key === 'ArrowDown' ? 1 : -1)) % items.length)?.focus()");
  });

  it('keeps the rules of a custom time: minute precision, at least a minute ahead, at most a year, checked again on submit', () => {
    expect(menu).toContain('MIN_SNOOZE_MS');
    expect(menu).toContain('MAX_SNOOZE_MS');
    expect(menu).toMatch(/min=\{toLocalInputValue\(new Date\(menu\.now\.getTime\(\) \+ MIN_SNOOZE_MS\)\)\}/);
    expect(menu).toMatch(/max=\{toLocalInputValue\(new Date\(menu\.now\.getTime\(\) \+ MAX_SNOOZE_MS\)\)\}/);
    expect(menu).toMatch(/const message = snoozeProblem\(at, new Date\(\)\)/);
    expect(menu).toMatch(/role="alert"/);
  });

  it('closes when the window loses focus to the mail frame, and keeps the exported props', () => {
    expect(menu).toMatch(/document\.activeElement instanceof HTMLIFrameElement/);
    expect(menu).toMatch(/export const SnoozeMenu: React\.FC<SnoozeMenuProps>/);
    expect(menu).toMatch(/export const SnoozeChip: React\.FC<SnoozeChipProps>/);
    for (const prop of ['t', 'buttonStyle', 'snoozed', 'onSnooze', 'onUnsnooze']) {
      expect(menu, prop).toMatch(new RegExp(String.raw`^\s+${prop}: `, 'm'));
    }
  });

  it('the date-time field is the library field (a native picker inside ui/TextField), the buttons are library buttons', () => {
    expect(menu).toMatch(/<TextField[\s\S]*?type="datetime-local"/);
    expect(menu).not.toMatch(/<input\b|<select\b/);
    expect(menu).toMatch(/<IconButton/);
    expect(menu).toMatch(/<Button type="submit" variant="primary"/);
  });
});

/** How many inline `style={...}` a file has. */
const inline = (name: string): number => (code(name).match(/\bstyle=\{/g) ?? []).length;

describe('the look of the two files', () => {
  it('names no colour in the code (the theme variables and the computed chip colours do), no native tooltip, no browser dialog', () => {
    for (const name of ['MessageList.tsx', 'SnoozeMenu.tsx']) {
      const source = code(name);
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
      // `title` is a prop of EmptyState here; what is banned is the native tooltip on a DOM element.
      expect(source, name).not.toMatch(/<(?:button|a|span|div|svg|img|input)\s[^>]*\btitle=|window\.(confirm|alert|prompt)/);
    }
  });

  it('inline styles are only computed values: the distance of a swipe, the width of the archive label (the colours of a label chip are set by ui/Chip); and the toolbar button the reader styles', () => {
    expect(inline('MessageList.tsx')).toBe(2);
    expect(inline('SnoozeMenu.tsx')).toBe(1);
  });

  it('the CSS has no gradient, no blur, no coloured rail, and every transition rests under reduced motion', () => {
    const css = read('messagelist.css');
    expect(css).not.toMatch(/gradient|backdrop-filter|filter:\s*blur/);
    expect(css).not.toMatch(/border-left:\s*\d+px solid var\(--(accent|danger|success|warning)/);
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/transition: none/);
    const moving = [...css.matchAll(/^\.([\w-]+)[^{]*\{[^}]*transition:/gm)].map((match) => match[1]);
    expect(moving.length).toBeGreaterThan(2);
    for (const name of moving) {
      expect(block, name).toContain(`.${name}`);
    }
  });

  it('keeps the star off the time: its box starts at the top of the subject line (20 px high with a mouse, down the row on touch)', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-star \{[^}]*top: calc\(var\(--ml-pad-y\) \+ 20px\);[^}]*height: 20px;/);
    expect(css).toMatch(/@media \(max-width: 900px\), \(pointer: coarse\) \{\s*\.ml-star \{\s*bottom: 0;\s*height: auto;/);
    // On touch the preview line (and its chips) stops short of the star's column.
    expect(css).toMatch(/\.ml-item\[data-star='true'\] \.ml-line3 \{\s*padding-right: calc\(\(var\(--ml-star\) \+ 16px\) \/ 2 \+ 4px\);/);
  });

  it('starts the filters at the content edge of the list (16 px, as the title)', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-filters \{[^}]*padding: 8px 16px;/);
    expect(css).toMatch(/\.ml-root\[data-compact='true'\] \.ml-filters \{[^}]*padding: 4px 16px;/);
    expect(css).toMatch(/\.ml-head \{[^}]*padding: 8px 8px 8px 16px;/);
  });

  it("closes the head with a hairline in every folder, on the line of the reader toolbar's hairline beside it (both 8 + a small button + 8)", () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-head \{[^}]*padding: 8px 8px 8px 16px;[^}]*border-bottom: 1px solid var\(--border\);/);
    expect(css).not.toContain("data-last='true'");
    expect(read('reader.css')).toMatch(/\.rd-bar \{[^}]*padding: 8px 12px;[^}]*border-bottom: 1px solid var\(--border\);/);
  });

  it('draws the loading rows as high as the rows that replace them, under the room of the first date heading', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-skel \{\s*padding-top: 32px;/);
    expect(css).toMatch(
      /\.ml-skel \.ui-skel-row \{\s*gap: 6px;\s*padding: calc\(var\(--ml-pad-y\) \+ 3px\) 16px calc\(var\(--ml-pad-y\) \+ 5px\) 32px;/
    );
  });
});
