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

  it('swipe (left to archive, right to Trash): the gesture lives in refs (a flick can end before React re-renders), touch and pen only, a swipe never opens the mail', () => {
    expect(list).toMatch(/const gesture = React\.useRef\(\{ startX: 0, startY: 0, tracking: false, active: false, dx: 0 \}\)/);
    expect(list).toMatch(/const swiped = React\.useRef\(false\)/);
    expect(list).toContain("e.pointerType === 'mouse'");
    expect(list).toMatch(/Math\.abs\(moveX\) < 10 \|\| Math\.abs\(moveX\) < Math\.abs\(e\.clientY - g\.startY\)/);
    // Armed at 96px or 35% of the row (M2), or by a flick; the action runs once the row has slid off (no wait under reduced motion).
    expect(list).toMatch(/Math\.max\(SWIPE_REVEAL, width\(\) \* 0\.35\)/);
    expect(list).toMatch(/\(Math\.abs\(g\.dx\) >= threshold\(\) \|\| fling\) && g\.dx !== 0/);
    expect(list).toMatch(/window\.setTimeout\(\(\) => \(toTrash \? onSwipeTrash\?\.\(m\) : onSwipeArchive\?\.\(m\)\), ms\)/);
    // The settle keeps the speed of the release (J2-09): at most the exit rule (0.7 of the distance rule), at once under reduced motion.
    expect(list).toMatch(/motionReduced\(\) \? \{ ms: 0, curve: '' \} : swipeSettle\(rest, Math\.abs\(last\.current\.speed\)\)/);
    expect(list).toMatch(/const longest = Math\.round\(durationFor\(rest\) \* 0\.7\)/);
    expect(list).toMatch(/onClickCapture=\{\(e\) => \{\s*if \(swiped\.current\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
  });

  it('a row that leaves plays its exit on an inert copy (M1) and focus moves to the next row at once; one that comes back enters (M4)', () => {
    expect(list).toMatch(/copy\.inert = true;\s*copy\.dataset\.leaving = 'true';/);
    expect(list).toMatch(/void leaveRow\(copy, style === 'fade' \? 'none' : 'left'\)/);
    expect(list).toMatch(/void enterRow\(el\)/);
    // A bulk change, another view or a row still listed plays nothing.
    expect(list).toMatch(/now\.view !== seenIn \|\| now\.removed > ROW_MOTION_MAX \|\| now\.ids\.has\(id\)/);
    expect(list).toMatch(/neighbourRow\(el\)\?\.focus\(/);
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
      /if \(isOpen && viaKeyboard && !sheet\) \{\s*menuRef\.current\?\.querySelector<HTMLElement>\('\[data-snooze-choice\]'\)\?\.focus\(\)/
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

  it('the date-time field is the library picker (ui/DateTimePicker, no browser datetime field), the buttons are library buttons', () => {
    expect(menu).toMatch(/<DateTimePicker[\s\S]*?label=\{tr\('snooze\.date_time_label'\)\}/);
    expect(menu).not.toMatch(/datetime-local/);
    expect(menu).not.toMatch(/<input\b|<select\b/);
    expect(menu).toMatch(/<ToolButton|<IconButton/);
    expect(menu).toMatch(/<Button type="submit" variant="primary"/);
  });
});

/** How many inline `style={...}` a file has. */
const inline = (name: string): number => (code(name).match(/\bstyle=\{/g) ?? []).length;

describe('the look of the two files', () => {
  const list = code('MessageList.tsx');
  it('names no colour in the code (the theme variables and the computed chip colours do), no native tooltip, no browser dialog', () => {
    for (const name of ['MessageList.tsx', 'SnoozeMenu.tsx']) {
      const source = code(name);
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
      // `title` is a prop of EmptyState here; what is banned is the native tooltip on a DOM element.
      expect(source, name).not.toMatch(/<(?:button|a|span|div|svg|img|input)\s[^>]*\btitle=|window\.(confirm|alert|prompt)/);
    }
  });

  it('inline styles are only computed values: the distance of a swipe, the width of the archive label, the hue of a quiet label dot (data: theme.ts getLabelChip); and the toolbar button the reader styles', () => {
    expect(inline('MessageList.tsx')).toBe(3);
    expect(code('MessageList.tsx')).toContain('style={{ background: getLabelChip(label, t).dot }}');
    expect(inline('SnoozeMenu.tsx')).toBe(1);
  });

  it('the CSS has no gradient, no blur, no coloured rail, and every transition rests under reduced motion', () => {
    const css = read('messagelist.css');
    // The one gradient allowed is the alpha mask that fades the hidden edge of the phone's chip row: it paints no colour.
    expect(css.replaceAll(/mask-image:[^;]*;/g, '')).not.toMatch(/gradient|backdrop-filter|filter:\s*blur/);
    expect(css).not.toMatch(/border-left:\s*\d+px solid var\(--(accent|danger|success|warning)/);
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/transition: none/);
    const moving = [...css.matchAll(/^\.([\w-]+)[^{]*\{[^}]*transition:/gm)].map((match) => match[1]);
    expect(moving.length).toBeGreaterThan(2);
    for (const name of moving) {
      expect(block, name).toContain(`.${name}`);
    }
  });

  it('keeps the star off the time and the quick actions: its box starts under the first line (24 px high with a mouse, 2.5.8; down the row on touch)', () => {
    const css = read('messagelist.css');
    // Under the sender's line (--ml-line: 20 px with a mouse, 22 px on touch, DESIGN-v4m R2) and 4 px of air.
    expect(css).toMatch(/\.ml-star \{[^}]*top: calc\(var\(--ml-pad-y\) \+ var\(--ml-line\) \+ 4px\);[^}]*height: 24px;/);
    expect(css).toMatch(/--ml-line: var\(--lh-secondary\);/);
    expect(css).toMatch(/@media \(max-width: 900px\), \(pointer: coarse\) \{\s*\.ml-star \{\s*bottom: 0;\s*height: auto;/);
    // The quick actions (28 px in a pill with 2 px of padding) end where the star's box starts: top at pad - 8, so their bottom is pad + 24.
    expect(css).toMatch(/\.ml-quick \{[^}]*top: calc\(var\(--ml-pad-y\) - 8px\);[^}]*padding: 2px;/);
    expect(css).toMatch(
      /\.ml-quick \.ui-btn\[data-size\],\s*\.ml-quick \.ml-snooze \.ui-btn\[data-size\] \{\s*width: 28px;\s*min-width: 28px;\s*height: 28px;/
    );
    // The subject and the preview line (and its chips) stop short of the star's column.
    expect(css).toMatch(/\.ml-item\[data-star='true'\] \.ml-line2 \{\s*padding-right: calc\(\(var\(--ml-star\) \+ 16px\) \/ 2 \+ 4px\);/);
    expect(css).toMatch(/\.ml-item\[data-star='true'\] \.ml-line3 \{\s*padding-right: calc\(\(var\(--ml-star\) \+ 16px\) \/ 2 \+ 4px\);/);
  });

  it('starts the head, the filters and the avatars at the content edge of the list (--ml-edge, as the title)', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-filters \{[^}]*padding: 8px var\(--ml-edge\);/);
    expect(css).toMatch(/\.ml-root\[data-compact='true'\] \.ml-filters \{[^}]*padding: 8px var\(--ml-edge\) 4px;/);
    expect(css).toMatch(/\.ml-head \{[^}]*padding: 12px 12px 12px var\(--ml-edge\);/);
    expect(css).toMatch(/\.ml-search \{[^}]*padding: 0 var\(--ml-edge\) 4px;/);
    // A row stands --ml-inset in and keeps the rest of the edge as the dot's column, so its avatar starts on the edge too.
    expect(css).toMatch(/--ml-gutter: calc\(var\(--ml-edge\) - var\(--ml-inset\)\);/);
    expect(css).toMatch(/\.ml-row \{[^}]*padding: var\(--ml-pad-y\) var\(--ml-end\) var\(--ml-pad-y\) var\(--ml-gutter\);/);
  });

  it('v3: the head is a 56 px band with no hairline (12 + the 32 px title + 12), so the title stands on the middle line of the reader toolbar beside it', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-head \{[^}]*min-height: 56px;[^}]*padding: 12px 12px 12px var\(--ml-edge\);/);
    expect(css.slice(css.indexOf('.ml-head {'), css.indexOf('}', css.indexOf('.ml-head {')))).not.toMatch(/border/);
    // 24/32 from the type variables (DESIGN-v4m R2: no literal size; the title variable is 18/26 on a desktop).
    expect(css).toMatch(
      /\.ml-title \{[^}]*font-size: calc\(var\(--fs-title\) \+ 6px\);[^}]*line-height: calc\(var\(--lh-title\) \+ 6px\);[^}]*letter-spacing: -0\.02em;/
    );
    expect(css).not.toContain("data-last='true'");
  });

  it('draws the loading rows as high as the rows that replace them, under the room of the first day heading', () => {
    const css = read('messagelist.css');
    // 36 px of heading (12 + its 20 px line + 4; no hairline: the rows fade in under it while it sticks) and the list's own 4 px.
    expect(css).toMatch(/\.ml-skel \{\s*padding-top: 40px;/);
    expect(css).toMatch(/--ml-head-h: 36px;/);
    // 13 px on its 20 px line everywhere: --fs-secondary (13) with a mouse, --fs-meta (13) on a phone; the line is --lh-label (20 on both).
    expect(css).toMatch(
      /\.ml-group-title \{[^}]*padding: 12px var\(--ml-edge\) 4px;[^}]*font-size: var\(--fs-secondary\);\s*line-height: var\(--lh-label\);/
    );
    expect(css).toMatch(/@media \(max-width: 640px\), \(pointer: coarse\) \{[\s\S]*?\.ml-group-title \{\s*font-size: var\(--fs-meta\);/);
    expect(css).not.toMatch(/\.ml-group-title[^{]*\{[^}]*(border-bottom|background: var\(--border\))/);
    // The air between two days is outside the heading, so a stuck heading keeps --ml-head-h.
    expect(css).not.toMatch(/\.ml-group \+ \.ml-group \.ml-group-title \{/);
    // Bars of 14, 14 and 12 px, each in the middle of its line (--ml-line): 6 px gaps and 3/5 px of padding with a mouse (20 px lines).
    expect(css).toMatch(
      /\.ml-skel \.ui-skel-row \{\s*gap: calc\(var\(--ml-line\) - 14px\);\s*padding: calc\(var\(--ml-pad-y\) \+ \(var\(--ml-line\) - 14px\) \/ 2\) 20px calc\(var\(--ml-pad-y\) \+ var\(--ml-line\) \/ 2 - 5px\) var\(--ml-text\);/
    );
    // The avatar of a loading row is a square block (the stamp it stands for, W6 QA) on the content edge; they appear only after 300 ms
    // of waiting (M13).
    expect(css).toMatch(
      /\.ml-skel \.ui-skel-row::before \{[^}]*left: var\(--ml-edge\);[^}]*width: var\(--ml-avatar\);[^}]*height: var\(--ml-avatar\);[^}]*border-radius: 6px;/
    );
    expect(css).toMatch(/\.ml-skel \{[^}]*animation: nm-fade var\(--dur-quick\) var\(--ease-enter\) 300ms both;/);
  });

  it('marks the open row with the tint AND a 3 px indicator bar, apart from the unread dot and weight', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-cell\[data-selected='true'\] \{\s*--ml-row-bg: var\(--accent-soft\);/);
    // The bar is a pill of its own inset from the rounded corners (J3-03), never an inset shadow or a border that bends with them.
    expect(css).toMatch(/\.ml-row\[aria-current='true'\]::before \{[^}]*width: 3px;[^}]*background: var\(--indicator\);/);
    expect(css).toMatch(/\.ml-row\[data-unread='true'\] \.ml-dot \{\s*opacity: 1;/);
    expect(css).toMatch(/\.ml-row\[data-unread='true'\] \.ml-sender \{\s*font-weight: 650;/);
    // v3 H3: one capsule glides from the open row to the next (a desktop, not while rows are ticked); it carries the tint and the bar then.
    expect(list).toContain(`useGlide(bodyRef, ".ml-cell[data-selected='true']", { key: selectedId, enabled: !compact && !selecting })`);
    expect(list).toMatch(/className="ui-glide-host ml-body"/);
    expect(css).toMatch(/\.ml-glide \{[^}]*border-radius: 12px;[^}]*background: var\(--accent-soft\);/);
    expect(css).toMatch(/\.ml-glide::before \{[^}]*width: 3px;[^}]*background: var\(--indicator\);/);
  });

  it('W5 lead review 2: the unread dot stands in the right column, under the time on the subject line; the gutter keeps only the pill', () => {
    const css = read('messagelist.css');
    // Right-aligned on the time's edge (--ml-end), on the middle of line 2 (the row's padding + the sender's line + half a line - 4).
    expect(css).toMatch(
      /\.ml-dot \{[^}]*position: absolute;\s*top: calc\(var\(--ml-pad-y\) \+ var\(--ml-line\) \* 1\.5 - 4px\);\s*right: var\(--ml-end\);/
    );
    expect(css).not.toMatch(/\.ml-dot \{[^}]*left: calc\(var\(--ml-gutter\)/);
    // Its room: the subject (and the star of an unread row) stop before it; it hides while the quick actions take the time's place.
    expect(css).toMatch(/\.ml-row\[data-unread='true'\] \.ml-line2 \{\s*padding-right: var\(--ml-dot-room\);/);
    expect(css).toMatch(
      /:root:not\(\[data-density='compact'\]\) :is\(\.ml-cell, \.ml-swipe-pane\):has\(> \.ml-row\[data-unread='true'\]\) > \.ml-star \{\s*right: calc\(var\(--ml-end\) - \(var\(--ml-star\) - 16px\) \/ 2 \+ var\(--ml-dot-room\)\);/
    );
    expect(css).toMatch(/\.ml-root:not\(\[data-selecting='true'\]\) \.ml-cell:hover \.ml-row \.ml-dot \{\s*opacity: 0;/);
    expect(css).not.toContain(".ml-row[aria-current='true'] .ml-dot");
    // Compact density: in the line, right of the time.
    expect(css).toMatch(/:root\[data-density='compact'\] \.ml-dot \{\s*position: relative;[^}]*order: 1;\s*margin-left: 8px;/);
    // Unread is still two cues and words: the dot, the weight, and the row's spoken state.
    expect(list).toMatch(/<span aria-hidden="true" className="ml-dot" \/>/);
    expect(list).toContain("tr('list.unread_sr')");
  });

  it('W5 lead review 1: the open row pill is as tall as the text block, 4px in from the capsule', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/--ml-pill-trim: 32px;/);
    expect(css).toMatch(/:root\[data-density='compact'\] \.ml-root \{[^}]*--ml-pill-trim: 16px;/);
    for (const rule of [/\.ml-glide::before \{([^}]*)\}/, /\.ml-row\[aria-current='true'\]::before \{([^}]*)\}/]) {
      expect(rule.exec(css)?.[1]).toMatch(
        /top: calc\(var\(--ml-pill-trim\) \/ 2\);\s*bottom: calc\(var\(--ml-pill-trim\) \/ 2\);\s*left: 4px;\s*width: 3px;/
      );
    }
    expect(css).not.toMatch(/height: 16px;\s*margin-top: -8px;/);
  });

  it('W5 lead review 10: the desktop filters are equal segments (SegmentedControl stretch), wrapping by pairs into two equal rows', () => {
    expect(list).toMatch(/<SegmentedControl label=\{tr\('list\.filter_label'\)\} wrap stretch /);
    const ui = read(path.join('..', 'ui', 'ui.css'));
    expect(ui).toMatch(/\.ui-seg\[data-stretch='true'\] \.ui-seg-item \{\s*flex: 1 1 0;/);
    expect(ui).toMatch(/\.ui-seg\[data-stretch='true'\]\[data-cell\] \.ui-seg-item \{\s*min-width: var\(--ui-seg-cell\);/);
    expect(ui).toMatch(
      /\.ui-seg\[data-stretch='true'\]\[data-cell\] > \.ui-seg-pair \{\s*flex-basis: calc\(var\(--ui-seg-cell\) \* 2 \+ 2px\);/
    );
    // The floor is measured in the browser from the widest label (its bold copy included) and the segment's padding.
    const seg = read(path.join('..', 'ui', 'SegmentedControl.tsx'));
    expect(seg).toMatch(/function widestSegment\(track: HTMLElement\): number \| null/);
    expect(seg).toMatch(/style: cell === null \? undefined : \(\{ '--ui-seg-cell': `\$\{cell\}px` \} as React\.CSSProperties\)/);
  });

  it('v3 lead review 6/10: the list fades at its foot and under a stuck day heading (alpha masks), and sets no scrollbar for touch', () => {
    const css = read('messagelist.css');
    expect(css).toMatch(/\.ml-scroll \{[^}]*mask-image: linear-gradient\(to bottom, var\(--ml-fade-foot\)\);/);
    expect(css).toMatch(
      /--ml-fade-foot:\s*var\(--text\) calc\(100% - var\(--ml-fade-end\)\),[^;]*transparent calc\(100% - var\(--ml-fade-gone, 0px\)\);/
    );
    // W5 lead review 3: 48px (it was 24), clear for its last 8px; the body keeps that much room under its last row.
    expect(css).toMatch(/--ml-fade-end: 48px;/);
    expect(css).toMatch(/--ml-fade-gone: 8px;/);
    expect(css).toMatch(/\.ml-root:not\(\[data-compact='true'\]\) \.ml-body \{\s*padding-bottom: var\(--ml-fade-end\);/);
    // The phone fades only the band behind the floating Compose button, never to clear (W5 lead review 12).
    expect(css).toMatch(
      /\.ml-root\[data-compact='true'\] \.ml-scroll \{\s*--ml-fade-foot:[^;]*var\(--ml-fab-mid, 40%\)[^;]*var\(--ml-fab-floor, 0%\), transparent\) 100%;/
    );
    expect(css).toMatch(
      /\.ml-scroll\[data-stuck\] \{\s*mask-image: linear-gradient\(\s*to bottom,\s*var\(--text\) var\(--ml-head-h\),\s*transparent var\(--ml-head-h\),/
    );
    expect(list).toMatch(/scroller\.toggleAttribute\(\s*'data-stuck',/);
    // The phone fades over the floating Compose button's zone (mailbox.css), never shows a forced scrollbar or keeps a lane for one.
    expect(css).toMatch(/--ml-fade-end: var\(--ml-fab-fade, 24px\);/);
    expect(css).not.toMatch(/@media \(pointer: coarse\) \{\s*\.ml-scroll \{[^}]*scrollbar/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.ml-scroll \{\s*scrollbar-gutter: stable;/);
  });

  it('v3 4.1 (lead review 4): no lines between rows, the star only when starred or pointed at, one quiet label (dot + name, no fill) and a quiet +N', () => {
    const css = read('messagelist.css');
    expect(css.replaceAll(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.ml-(item|row|cell|list)[^{]*\{[^}]*border-(top|bottom): 1px/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.ml-cell \.ml-star\[aria-pressed='false'\] \{\s*opacity: 0;/);
    expect(css).toMatch(
      /\.ml-label \{[^}]*color: var\(--text2\);[^}]*font-size: var\(--fs-meta\);\s*line-height: var\(--lh-meta\);\s*font-weight: 500;/
    );
    expect(css.slice(css.indexOf('.ml-label {'), css.indexOf('}', css.indexOf('.ml-label {')))).not.toMatch(/background/);
    expect(css).toMatch(/\.ml-label-dot \{[^}]*width: 6px;\s*height: 6px;/);
    expect(list).not.toMatch(/<Chip key=\{label\} colors=/);
    expect(list).toContain('const ROW_LABELS_MAX = 1;');
    expect(list).toMatch(/labels\.slice\(0, ROW_LABELS_MAX\)/);
    expect(list).toMatch(/<VisuallyHidden>\{labels\.slice\(ROW_LABELS_MAX\)\.join\(', '\)\}<\/VisuallyHidden>/);
  });
});
