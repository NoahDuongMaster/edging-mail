import React from 'react';
import { Bold, Ellipsis, Image as ImageIcon, Italic, Link2, List, ListOrdered, Quote, Underline, type LucideIcon } from 'lucide-react';
import { useT, type MessageKey } from '../../lib/i18n';
import { Button, Divider, IconButton, Menu, Popover, Select, TextField, Toolbar, type MenuItem, type MenuTriggerProps } from '../../ui';
import { toolbarItems, toolbarTarget } from '../../ui/Toolbar';

/** The formats that are on or off at the caret (aria-pressed on their buttons). */
interface Formats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bullets: boolean;
  numbers: boolean;
  quote: boolean;
  /** The block style at the caret: p, h3 or h4. */
  block: string;
}

const NONE: Formats = { bold: false, italic: false, underline: false, bullets: false, numbers: false, quote: false, block: 'p' };

/* eslint-disable @typescript-eslint/no-deprecated -- the editor is a contentEditable: queryCommandState/Value are the only way to read the format at the caret */
const readFormats = (): Formats => {
  const block = document.queryCommandValue('formatBlock').toLowerCase();
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    bullets: document.queryCommandState('insertUnorderedList'),
    numbers: document.queryCommandState('insertOrderedList'),
    quote: block === 'blockquote',
    block: block === 'h3' || block === 'h4' ? block : 'p'
  };
};
/* eslint-enable @typescript-eslint/no-deprecated */

const sameFormats = (a: Formats, b: Formats) => (Object.keys(a) as (keyof Formats)[]).every((key) => a[key] === b[key]);

/**
 * A web address as typed, made whole: `example.com/x` gets https://; a link may also be mailto:. Null when it is not one (spaces, an
 * empty field, another scheme such as javascript:).
 */
export function normalizeUrl(typed: string, kind: 'link' | 'image'): string | null {
  const value = typed.trim();
  if (value === '' || /\s/.test(value)) {
    return null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return value.includes('.') ? `https://${value}` : null;
  }
  const allowed = kind === 'link' ? ['http', 'https', 'mailto'] : ['http', 'https'];
  return allowed.includes(scheme) ? value : null;
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface UrlFormProps {
  kind: 'link' | 'image';
  anchorRef: React.RefObject<HTMLElement | null>;
  onInsert: (url: string) => void;
  onClose: (returnFocus: boolean) => void;
}

/**
 * The small form that asks for a web address (Insert link, Insert image): a non-modal dialog under its button, not the browser's prompt.
 * The field takes focus; Enter inserts, Escape closes and puts focus back on the button, Tab out of it closes it too.
 */
const UrlForm: React.FC<UrlFormProps> = ({ kind, anchorRef, onInsert, onClose }) => {
  const tr = useT();
  const id = React.useId();
  const [value, setValue] = React.useState('');
  const [wrong, setWrong] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const label = kind === 'link' ? tr('compose.link_prompt') : tr('compose.image_prompt');

  React.useEffect(() => {
    formRef.current?.querySelector('input')?.focus();
  }, []);

  return (
    <Popover
      open
      anchorRef={anchorRef}
      onClose={(reason) => onClose(reason === 'escape')}
      role="dialog"
      aria-label={kind === 'link' ? tr('compose.insert_link') : tr('compose.insert_image_url')}
      className="cp-ask"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') {
          return;
        }
        const controls = [...(formRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])];
        if (event.target === (event.shiftKey ? controls.at(0) : controls.at(-1))) {
          event.preventDefault();
          onClose(true);
        }
      }}
    >
      <form
        ref={formRef}
        noValidate
        className="cp-ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          // The compose's own form must not see this submit (it would send the message).
          event.stopPropagation();
          const url = normalizeUrl(value, kind);
          setWrong(url === null);
          if (url !== null) {
            onInsert(url);
          }
        }}
      >
        <TextField
          label={label}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={wrong ? true : undefined}
          aria-describedby={wrong ? `${id}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setWrong(false);
          }}
        />
        {wrong ? (
          <p id={`${id}-error`} role="alert" className="cp-ask-error">
            {tr('compose.url_invalid')}
          </p>
        ) : null}
        <div className="cp-ask-actions">
          <Button type="button" size="sm" variant="ghost" onClick={() => onClose(true)}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" size="sm" variant="primary">
            {tr('compose.insert')}
          </Button>
        </div>
      </form>
    </Popover>
  );
};

interface FormatToolbarProps {
  /** Runs an editor command on the body (the compose focuses the editor first, so the selection it had is the one that changes). */
  exec: (command: string, value?: string) => void;
  /** The body: the formats at its caret are shown as pressed buttons, and its selection is kept while a link or picture is asked for. */
  editorRef: React.RefObject<HTMLDivElement | null>;
}

/** The tools after the text style, in order: each with its words, its icon, whether a hairline stands before it. */
type ToolId = 'bold' | 'italic' | 'underline' | 'bullets' | 'numbers' | 'quote' | 'link' | 'image';
interface ToolSpec {
  id: ToolId;
  /** The catalogue key of its name (aria-label and tooltip). */
  nameKey: MessageKey;
  icon: LucideIcon;
  /** A hairline before it: a new group (marks, lists and quote, link and picture). */
  group?: boolean;
}
const TOOLS: readonly ToolSpec[] = [
  { id: 'bold', nameKey: 'compose.bold', icon: Bold, group: true },
  { id: 'italic', nameKey: 'compose.italic', icon: Italic },
  { id: 'underline', nameKey: 'compose.underline', icon: Underline },
  { id: 'bullets', nameKey: 'compose.bulleted_list', icon: List, group: true },
  { id: 'numbers', nameKey: 'compose.numbered_list', icon: ListOrdered },
  { id: 'quote', nameKey: 'compose.quote', icon: Quote },
  { id: 'link', nameKey: 'compose.insert_link', icon: Link2, group: true },
  { id: 'image', nameKey: 'compose.insert_image_url', icon: ImageIcon }
];

/** The gap between the controls of the row (compose.css `.cp-fmt`). */
const GAP = 2;

/**
 * How many tools fit after the text style in a row `available` px wide: each tool `button` px, a hairline `divider` px (its margins
 * included) before each new group, GAP between them; when not all fit, the More formatting button takes the place of the last ones.
 */
export function fittingTools(available: number, style: number, button: number, divider: number): number {
  let used = style;
  let shown = 0;
  for (const [index, tool] of TOOLS.entries()) {
    const cost = GAP + (tool.group === true ? divider + GAP : 0) + button;
    const reserve = index < TOOLS.length - 1 ? GAP + button : 0;
    if (used + cost + reserve > available) {
      break;
    }
    used += cost;
    shown = index + 1;
  }
  return shown;
}

/**
 * The formatting row above the body: text style, bold, italic, underline, lists, quote, link, image. It is ONE Tab stop (ui/Toolbar, the
 * text style's list included: the arrow keys move between all of them, J1-11), the formats at the caret show as pressed buttons, and a link
 * or a picture asks for its address in a small form under its button. One row, never two and never a hidden scroll: when the window is too
 * narrow for every tool, the last ones go into a More formatting menu at the end of the row (J1-12, J5-06). The buttons only call `exec`;
 * the editor itself stays in the compose.
 */
export const FormatToolbar: React.FC<FormatToolbarProps> = ({ exec, editorRef }) => {
  const tr = useT();
  const [formats, setFormats] = React.useState<Formats>(NONE);
  const [asking, setAsking] = React.useState<'link' | 'image' | null>(null);
  const [shown, setShown] = React.useState(TOOLS.length);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const linkRef = React.useRef<HTMLSpanElement | null>(null);
  const imageRef = React.useRef<HTMLSpanElement | null>(null);
  const moreRef = React.useRef<HTMLSpanElement | null>(null);
  // The selection of the body when a link or picture was asked for: the field takes focus (and the selection) meanwhile.
  const savedRange = React.useRef<Range | null>(null);
  // The text style's list is the toolbar's Tab stop (it is the first control, and the last one used if it was): ui/Toolbar roves only
  // buttons, so this row moves the stop onto the list and off it.
  const comboIsStop = React.useRef(true);

  const refresh = React.useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (editor === null || selection === null || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
      return;
    }
    const next = readFormats();
    setFormats((current) => (sameFormats(current, next) ? current : next));
  }, [editorRef]);

  React.useEffect(() => {
    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
  }, [refresh]);

  // How many tools fit, measured on the row as it is laid out, again whenever it resizes.
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    const toolbar = row?.querySelector<HTMLElement>('.cp-fmt');
    if (row === null || toolbar === null || toolbar === undefined) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(toolbar);
      const available = toolbar.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const select = toolbar.querySelector<HTMLElement>('.cp-style')?.getBoundingClientRect().width ?? 0;
      const button = Number.parseFloat(style.getPropertyValue('--ui-h-sm')) || 32;
      const line = toolbar.querySelector<HTMLElement>('.cp-fmt-sep');
      const lineStyle = line === null ? null : getComputedStyle(line);
      const divider =
        line === null || lineStyle === null
          ? 13
          : line.getBoundingClientRect().width + Number.parseFloat(lineStyle.marginLeft) + Number.parseFloat(lineStyle.marginRight);
      if (available > 0) {
        setShown(fittingTools(available, select, button, divider));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // ui/Toolbar puts the Tab stop on a button after each render; while the list is the stop, it gets it back (this runs after the toolbar's).
  React.useLayoutEffect(() => {
    const toolbar = rowRef.current?.querySelector<HTMLElement>('[role="toolbar"]');
    const combo = toolbar?.querySelector<HTMLElement>('[role="combobox"]');
    if (toolbar === null || toolbar === undefined || combo === null || combo === undefined) {
      return;
    }
    if (comboIsStop.current) {
      for (const item of toolbarItems(toolbar)) {
        item.tabIndex = -1;
      }
      combo.tabIndex = 0;
    } else {
      combo.tabIndex = -1;
    }
  });

  const run = (command: string, value?: string) => {
    exec(command, value);
    refresh();
  };

  const ask = (kind: 'link' | 'image') => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    savedRange.current =
      editor !== null && selection !== null && selection.rangeCount > 0 && editor.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setAsking(kind);
  };

  const anchorOf = (kind: 'link' | 'image') => {
    const index = TOOLS.findIndex((tool) => tool.id === kind);
    if (index >= shown) {
      return moreRef;
    }
    return kind === 'image' ? imageRef : linkRef;
  };

  const closeAsk = (returnFocus: boolean) => {
    const kind = asking;
    setAsking(null);
    if (returnFocus && kind !== null) {
      anchorOf(kind).current?.querySelector('button')?.focus();
    }
  };

  const insert = (url: string) => {
    const kind = asking;
    setAsking(null);
    const editor = editorRef.current;
    if (editor === null) {
      return;
    }
    editor.focus();
    const range = savedRange.current;
    const selection = window.getSelection();
    if (range !== null && selection !== null) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (kind === 'image') {
      run('insertImage', url);
    } else if (range === null || range.collapsed) {
      // Nothing was selected: the address itself becomes the text of the link.
      run('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    } else {
      run('createLink', url);
    }
  };

  const pressed: Partial<Record<ToolId, boolean>> = {
    bold: formats.bold,
    italic: formats.italic,
    underline: formats.underline,
    bullets: formats.bullets,
    numbers: formats.numbers,
    quote: formats.quote
  };
  const act: Record<ToolId, () => void> = {
    bold: () => run('bold'),
    italic: () => run('italic'),
    underline: () => run('underline'),
    bullets: () => run('insertUnorderedList'),
    numbers: () => run('insertOrderedList'),
    quote: () => run('formatBlock', formats.quote ? 'p' : 'blockquote'),
    link: () => (asking === 'link' ? closeAsk(false) : ask('link')),
    image: () => (asking === 'image' ? closeAsk(false) : ask('image'))
  };

  const inline = TOOLS.slice(0, shown);
  const overflow = TOOLS.slice(shown);
  const moreItems: MenuItem[] = overflow.map((tool, index) => {
    const Icon = tool.icon;
    return {
      id: tool.id,
      label: tr(tool.nameKey),
      icon: <Icon size={16} strokeWidth={1.75} aria-hidden="true" />,
      separatorBefore: index > 0 && tool.group === true,
      onSelect: tool.id === 'link' || tool.id === 'image' ? () => ask(tool.id as 'link' | 'image') : act[tool.id]
    };
  });

  // The arrow keys, Home and End over every control of the row, the text style's list first (ui/Toolbar alone knows only buttons). An open
  // list keeps its own keys, and the closed list's Home, End, Up and Down (they open it at that end) are its own too: ui/Select takes them first.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const toolbar = event.currentTarget;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) {
      return;
    }
    if (!toolbar.contains(event.target)) {
      return;
    }
    const combo = toolbar.querySelector<HTMLElement>('[role="combobox"]');
    if (combo === null || combo.getAttribute('aria-expanded') === 'true') {
      return;
    }
    const items = [combo, ...toolbarItems(toolbar)];
    const target = toolbarTarget(items.length, items.indexOf(event.target), event.key, 'horizontal');
    if (target < 0) {
      return;
    }
    event.preventDefault();
    items[target].focus();
  };

  // The control that takes focus becomes the Tab stop: the list, or a button (ui/Toolbar moves the stop among the buttons itself).
  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const toolbar = event.currentTarget;
    if (!(event.target instanceof HTMLElement) || !toolbar.contains(event.target)) {
      return;
    }
    const combo = toolbar.querySelector<HTMLElement>('[role="combobox"]');
    comboIsStop.current = event.target === combo;
    if (combo !== null) {
      combo.tabIndex = comboIsStop.current ? 0 : -1;
    }
    if (comboIsStop.current) {
      for (const item of toolbarItems(toolbar)) {
        item.tabIndex = -1;
      }
    }
  };

  const moreTrigger = (props: MenuTriggerProps): React.ReactElement => (
    <IconButton label={tr('compose.more_formatting')} size="sm" {...props}>
      <Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />
    </IconButton>
  );

  return (
    // The row carries the hairline and stays at the top of the form.
    <div ref={rowRef} className="cp-fmt-row">
      <Toolbar aria-label={tr('compose.format_group')} className="cp-fmt" onKeyDown={onKeyDown} onFocus={onFocus}>
        <div className="cp-style">
          <Select
            label={tr('compose.text_style')}
            hideLabel
            options={[
              { value: 'p', label: tr('compose.style_normal') },
              { value: 'h3', label: tr('compose.style_heading') },
              { value: 'h4', label: tr('compose.style_subheading') }
            ]}
            value={formats.block}
            onChange={(next) => {
              setFormats((current) => ({ ...current, block: next }));
              run('formatBlock', next);
            }}
          />
        </div>
        {inline.map((tool) => {
          const Icon = tool.icon;
          const button =
            tool.id === 'link' || tool.id === 'image' ? (
              <span ref={tool.id === 'link' ? linkRef : imageRef} className="cp-tool">
                <IconButton
                  label={tr(tool.nameKey)}
                  size="sm"
                  aria-haspopup="dialog"
                  aria-expanded={asking === tool.id}
                  onClick={act[tool.id]}
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
              </span>
            ) : (
              <IconButton label={tr(tool.nameKey)} size="sm" pressed={pressed[tool.id]} onClick={act[tool.id]}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            );
          return (
            <React.Fragment key={tool.id}>
              {tool.group === true ? <Divider orientation="vertical" className="cp-fmt-sep" /> : null}
              {button}
            </React.Fragment>
          );
        })}
        {overflow.length > 0 ? (
          <span ref={moreRef} className="cp-tool">
            <Menu items={moreItems} align="end" label={tr('compose.more_formatting')} trigger={moreTrigger} />
          </span>
        ) : null}
        {asking === null ? null : <UrlForm key={asking} kind={asking} anchorRef={anchorOf(asking)} onInsert={insert} onClose={closeAsk} />}
      </Toolbar>
    </div>
  );
};
