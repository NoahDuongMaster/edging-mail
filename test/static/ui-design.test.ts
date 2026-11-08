// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DARK, FONT_FILES, LIGHT } from '../../src/shared/design/tokens';
import { ROOT } from './helpers/scan';

// The foundation of the redesign, as files: the fonts are ours and are the ones the CSS names, the app's policy lets in nothing from a font
// service, the browser's chrome takes the colour of the page, the licence travels with the font, and the library keeps its promises that a
// scan can check (every component says when to use it, the select and the dialog are not the browser's). The behaviour of the controls
// (focus, keys) was run in a browser; what a file scan can hold is held here.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const UI = path.join(ROOT, 'src', 'client', 'ui');
const uiFiles = readdirSync(UI).filter((name) => name.endsWith('.tsx'));

describe('the fonts', () => {
  it('are files in public/fonts, named with their version, next to the licence', () => {
    for (const url of Object.values(FONT_FILES)) {
      expect(url).toMatch(/^\/fonts\/[\w-]+-\d+\.\d+\.\d+\.woff2$/);
      expect(existsSync(path.join(ROOT, 'public', url)), url).toBe(true);
      // A woff2 file starts with its signature, and a variable font of Geist is tens of KB: not an error page saved under the name.
      const bytes = readFileSync(path.join(ROOT, 'public', url));
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(statSync(path.join(ROOT, 'public', url)).size).toBeGreaterThan(40_000);
    }
    const licence = readdirSync(path.join(ROOT, 'public', 'fonts')).filter((name) => /OFL.*\.txt$/.test(name));
    expect(licence).toHaveLength(1);
    expect(read('public', 'fonts', licence[0])).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('are preloaded by the app page under the same name that the CSS uses, and nothing is asked of a font service', () => {
    const html = read('index.html');
    expect(html).toContain(`<link rel="preload" href="${FONT_FILES.sans}" as="font" type="font/woff2" crossorigin />`);
    expect(html).not.toMatch(/googleapis|gstatic|rel="stylesheet"|preconnect/);
  });

  it('are listed in NOTICE with their licence', () => {
    const notice = read('NOTICE');
    expect(notice).toMatch(/Geist/);
    expect(notice).toMatch(/SIL Open Font License 1\.1/);
    expect(notice).toContain('public/fonts/geist-OFL-');
    expect(notice).not.toMatch(/No font file is shipped|from Google Fonts/);
  });
});

describe('public/_headers', () => {
  const headers = read('public', '_headers');

  it('lets fonts in from this origin only, and styles from no one else', () => {
    const policy = /Content-Security-Policy: (.*)/.exec(headers)?.[1] ?? '';
    expect(policy).toContain("font-src 'self';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).not.toMatch(/googleapis|gstatic/);
    expect(policy).toContain("default-src 'self'");
  });

  it('caches the versioned font files for a year', () => {
    expect(headers).toMatch(/^\/fonts\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m);
  });
});

describe('index.html', () => {
  it('gives the status bar of the installed app the page colour of each theme', () => {
    const html = read('index.html');
    expect(html).toContain(`<meta name="theme-color" content="${LIGHT.bg}" media="(prefers-color-scheme: light)" />`);
    expect(html).toContain(`<meta name="theme-color" content="${DARK.bg}" media="(prefers-color-scheme: dark)" />`);
  });
});

describe('the component library (src/client/ui)', () => {
  it('has a JSDoc that says when to use it above every exported component', () => {
    const missing = uiFiles.flatMap((name) => {
      const source = read('src', 'client', 'ui', name);
      const exported = [...source.matchAll(/^export (?:function|const) ([A-Z]\w*)/gm)].map((match) => match[1]);
      return exported
        .filter((component) => !new RegExp(String.raw`\*/\n(?:export (?:function|const) ${component}\b)`).test(source))
        .map((component) => `${name}: ${component}`);
    });
    expect(missing).toEqual([]);
  });

  it('exports every component from the barrel', () => {
    const barrel = read('src', 'client', 'ui', 'index.ts');
    const missing = uiFiles.flatMap((name) => {
      const source = read('src', 'client', 'ui', name);
      return [...source.matchAll(/^export (?:function|const) ([A-Z]\w*)/gm)]
        .map((match) => match[1])
        .filter((component) => !new RegExp(String.raw`\b${component}\b`).test(barrel));
    });
    expect(missing).toEqual([]);
  });

  it('does not use the browser controls it replaces: no <select>, no window.confirm or alert, no native tooltip', () => {
    for (const name of uiFiles) {
      // Comments may name them ("replaces the browser's <select>"); the code may not use them.
      const source = read('src', 'client', 'ui', name)
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/^\s*\/\/.*$/gm, '');
      expect(source, name).not.toMatch(/<select\b|window\.(confirm|alert|prompt)|\btitle=\{/);
    }
  });

  it('builds the Select on the ARIA select-only combobox and the Switch on role="switch"', () => {
    const select = read('src', 'client', 'ui', 'Select.tsx');
    expect(select).toContain('role="combobox"');
    expect(select).toContain('aria-activedescendant');
    expect(select).toContain('role="listbox"');
    expect(select).toContain('role="option"');
    expect(read('src', 'client', 'ui', 'Switch.tsx')).toContain('role="switch"');
    expect(read('src', 'client', 'ui', 'Tabs.tsx')).toContain('role="tablist"');
    expect(read('src', 'client', 'ui', 'Menu.tsx')).toContain('role="menu"');
  });

  it('draws the popups in a portal, so no parent with overflow can clip them', () => {
    for (const name of ['Popover.tsx', 'Tooltip.tsx', 'Dialog.tsx']) {
      expect(read('src', 'client', 'ui', name), name).toMatch(/createPortal\(/);
    }
  });

  it('traps Tab in the dialog with lib/focusTrap, closes on Escape, and returns focus to the opener (or to a fallback when the opener is gone)', () => {
    const dialog = read('src', 'client', 'ui', 'Dialog.tsx');
    expect(dialog).toMatch(/import \{ trapTab \} from '\.\.\/lib\/focusTrap'/);
    expect(dialog).toMatch(/trapTab\(event, panelRef\.current\)/);
    expect(dialog).toMatch(/useLayer\(true, /);
    expect(dialog).toMatch(/!opener\.isConnected/);
    expect(dialog).toMatch(/opener === document\.body/);
    expect(dialog).toContain('returnFocusRef');
    expect(dialog).toContain('aria-modal="true"');
  });

  it('closes a dialog by its scrim only when the press began on the scrim too', () => {
    const dialog = read('src', 'client', 'ui', 'Dialog.tsx');
    expect(dialog).toMatch(/onPointerDown=\{\(event\) => \{\s*pressedOnScrim\.current = event\.target === event\.currentTarget;/);
    expect(dialog).toMatch(/pressedOnScrim\.current && event\.target === event\.currentTarget/);
  });

  it('draws a dialog in a portal unless it is asked to stay in place (inline), and never reads `document` while it renders inline', () => {
    const dialog = read('src', 'client', 'ui', 'Dialog.tsx');
    expect(dialog).toMatch(/return inline \? dialog : createPortal\(dialog, document\.body\);/);
    expect(dialog).toMatch(/inline = false,/);
    // Everything else that needs the page (focus, Tab, Escape, the scroll lock) runs in effects and handlers, which the server never runs.
    const render = dialog.slice(dialog.indexOf('function DialogPanel'), dialog.indexOf('const dialog = ('));
    expect(render.replaceAll(/React\.useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/g, '')).not.toMatch(/\bdocument\./);
  });

  it('lets a control inside a dialog answer Escape first: the dialog closes on an Escape that nothing inside used', () => {
    const layers = read('src', 'client', 'ui', 'layers.ts');
    // The document listener closes a popup at once, and leaves an Escape pressed inside a dialog to the dialog's own keydown.
    expect(layers).toMatch(/top\.element\?\.current\?\.contains\(target\) === true \? 'content' : 'close'/);
    expect(layers).toMatch(/=== 'close'\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*top\?\.escape\(\);/);
    const dialog = read('src', 'client', 'ui', 'Dialog.tsx');
    expect(dialog).toMatch(/useLayer\(true, escape, rootRef\)/);
    // React runs that keydown after the controls inside: a control that stopped the key or called preventDefault keeps the dialog open,
    // and nothing behind the dialog ever gets it.
    expect(dialog).toMatch(
      /event\.stopPropagation\(\);\s*if \(!event\.defaultPrevented && isTop\(\)\) \{\s*event\.preventDefault\(\);\s*escape\(\);/
    );
    expect(dialog).toMatch(
      /<div\s+ref=\{rootRef\}\s+role="presentation"\s+className=\{cx\('ui-dialog-root', rootClassName\)\}\s+onKeyDown=\{onKeyDown\}/
    );
  });

  it('asks for a label on an IconButton (it is the accessible name and the tooltip)', () => {
    const icon = read('src', 'client', 'ui', 'IconButton.tsx');
    expect(icon).toMatch(/^ {2}label: string;/m);
    expect(icon).toContain('aria-label={label}');
  });

  it('draws a disabled button as a neutral box with readable text (no opacity), lets a busy one keep its look, and beats the hover', () => {
    const ui = read('src', 'client', 'ui', 'ui.css');
    const disabled = /\n\.ui-btn\[data-variant\]:is\(:disabled, \[aria-disabled='true'\]\):not\(\[aria-busy='true'\]\) \{([^}]*)\}/.exec(
      ui
    );
    expect(disabled?.[1]).toMatch(/background: var\(--raised\);\s*border-color: var\(--border\);\s*color: var\(--text3\);/);
    expect(ui).toMatch(
      /\n\.ui-btn\[data-variant='ghost'\]:is\(:disabled, \[aria-disabled='true'\]\):not\(\[aria-busy='true'\]\) \{[^}]*background: transparent;/
    );
    // No rule of a button fades it as a whole while it is disabled.
    expect(ui).not.toMatch(/\.ui-btn(?:\[aria-disabled='true'\]|:disabled)[^{]*\{[^}]*opacity/);
    // As specific as the hover rules (0,4,0) and after them, so a disabled button does not light up under the pointer.
    expect(ui.indexOf(disabled?.[0] ?? '-')).toBeGreaterThan(
      ui.indexOf(".ui-btn[data-variant='danger']:hover:not(:disabled, [aria-busy='true'])")
    );
  });

  it('has a reduced-motion block that stops every transition and animation of the library, and keeps the guarantee of index.css', () => {
    const ui = read('src', 'client', 'ui', 'ui.css');
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(ui)?.[1] ?? '';
    expect(block).toMatch(/transition: none/);
    expect(block).toMatch(/animation: none/);
    const animated = [...ui.matchAll(/^\.([\w-]+)[^{]*\{[^}]*animation:/gm)].map((match) => match[1]);
    expect(animated.length).toBeGreaterThan(2);
    for (const name of animated) {
      expect(block, name).toContain(`.${name}`);
    }
    const index = read('src', 'client', 'index.css');
    expect(index).toMatch(/@import '\.\/ui\/ui\.css';/);
    expect(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(index)?.[1]).toMatch(
      /\.nm-fade-in,\s*\.nm-spin \{\s*animation: none;/
    );
  });

  it('is 44 px on touch: every size of control goes through the --ui-h-* variables, which become 44px on a phone or a coarse pointer', () => {
    const ui = read('src', 'client', 'ui', 'ui.css');
    expect(ui).toMatch(
      /@media \(max-width: 900px\), \(pointer: coarse\) \{\s*:root \{\s*--ui-h-sm: var\(--control-touch\);\s*--ui-h-md: var\(--control-touch\);/
    );
    expect(ui).toMatch(/--ui-field-size: 16px;/);
    // No fixed pixel height on a control: heights are var(--ui-h-*). (Badges, avatars, switches, kbd and skeletons are not controls.)
    const fixed = [
      ...ui.matchAll(/^\.(ui-(?:btn|input|select|option|menu-item|tab)[\w-]*)[^{:]*\{[^}]*?\n\s+(?:min-)?height: (\d+)px/gm)
    ].map((match) => `${match[1]} ${match[2]}`);
    expect(fixed).toEqual([]);
  });
});
