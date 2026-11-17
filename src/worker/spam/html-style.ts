// Does a `style` attribute hide the text of its element? Used by the HTML scanner for the hidden-text rule. Linear in the (capped) attribute: declarations are
// split on `;` and read once, and no pattern here can backtrack.

/** A style attribute is only read up to this many characters. */
const MAX_STYLE_CHARS = 4096;

const COLOR_NAMES: ReadonlyMap<string, string> = new Map([
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['red', '#ff0000'],
  ['blue', '#0000ff'],
  ['gray', '#808080'],
  ['grey', '#808080'],
  ['yellow', '#ffff00'],
  ['green', '#008000']
]);
const ZERO_SIZE = /^0(?:\.0+)?(?:px|pt|em|rem|%|ex|ch|vw|vh|cm|mm|in|pc)?$/;
const RGB = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})/;

function normalColor(raw: string): string {
  const value = raw.replaceAll(/\s+/g, '');
  const named = COLOR_NAMES.get(value);
  if (named !== undefined) {
    return named;
  }
  if (/^#[\da-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  const rgb = RGB.exec(value);
  if (rgb !== null) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`;
  }
  return value;
}

/** Does this `style` attribute hide the element's text: display:none, visibility:hidden, a font size of zero, or a text colour equal to the background colour? */
export function isHiddenStyle(style: string): boolean {
  let color = '';
  let background = '';
  for (const declaration of style.slice(0, MAX_STYLE_CHARS).split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!\s*important/i, '')
      .trim()
      .toLowerCase();
    switch (property) {
      case 'display': {
        if (value === 'none') {
          return true;
        }
        break;
      }
      case 'visibility': {
        if (value === 'hidden' || value === 'collapse') {
          return true;
        }
        break;
      }
      case 'font-size': {
        if (ZERO_SIZE.test(value)) {
          return true;
        }
        break;
      }
      case 'color': {
        color = value;
        break;
      }
      case 'background-color': {
        background = value;
        break;
      }
      case 'background': {
        background = value.split(' ', 1)[0] ?? '';
        break;
      }
      default:
    }
  }
  return color !== '' && background !== '' && normalColor(color) === normalColor(background);
}
