import { esc } from '../html';

// The landing page's icons: 16 x 16 strokes drawn in the style of the app's icon set (lucide), inlined so the page asks for nothing
// else. They take the colour of the text around them (currentColor).

const PATHS = {
  alert: '<path d="M8 2.25 14.25 13.5H1.75z"/><path d="M8 6.75v3M8 11.6v.05"/>',
  archive: '<rect x="1.75" y="2.75" width="12.5" height="3" rx=".75"/><path d="M3 5.75v7.5h10v-7.5M6.5 8.5h3"/>',
  arrowRight: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  arrowsLeftRight: '<path d="M2.5 5.5h11M10.5 2.5l3 3-3 3M13.5 10.5h-11M5.5 7.5l-3 3 3 3"/>',
  arrowDown: '<path d="M8 2.5v11M4 9.5l4 4 4-4"/>',
  ban: '<circle cx="8" cy="8" r="6"/><path d="M3.8 3.8l8.4 8.4"/>',
  bell: '<path d="M4 6.5a4 4 0 0 1 8 0c0 3.5 1.5 4.75 1.5 4.75h-11S4 10 4 6.5M6.75 13.75a1.4 1.4 0 0 0 2.5 0"/>',
  browser: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M1.75 5.75h12.5M4 4.25h.05M5.75 4.25h.05"/>',
  bucket: '<path d="M2.5 4.75h11l-1.25 8.5h-8.5z"/><ellipse cx="8" cy="4.75" rx="5.5" ry="1.75"/>',
  check: '<path d="M3 8.5l3.25 3.25L13 4.75"/>',
  chevronDown: '<path d="M4 6l4 4 4-4"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.75V8l2.25 1.5"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  cloud: '<path d="M4.75 12.75h6.5a3.25 3.25 0 0 0 .5-6.46A4.5 4.5 0 0 0 3.6 7.3a2.75 2.75 0 0 0 1.15 5.45"/>',
  database:
    '<ellipse cx="8" cy="3.75" rx="5.25" ry="2"/><path d="M2.75 3.75v8.5c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2v-8.5M2.75 8c0 1.1 2.35 2 5.25 2s5.25-.9 5.25-2"/>',
  file: '<path d="M4 1.75h5l3.25 3.25v9.25H4z"/><path d="M9 1.75V5h3.25"/>',
  globe:
    '<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c1.75 1.7 2.65 3.8 2.65 6.25S9.75 12.55 8 14.25C6.25 12.55 5.35 10.45 5.35 8S6.25 3.45 8 1.75"/>',
  hexagon: '<path d="M8 1.75 13.4 4.9v6.2L8 14.25 2.6 11.1V4.9z"/><path d="M8 5.5 10.2 6.75v2.5L8 10.5 5.8 9.25v-2.5z"/>',
  inbox:
    '<path d="M2 9.5 3.6 4.3a1 1 0 0 1 .95-.7h6.9a1 1 0 0 1 .95.7L14 9.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M2 9.5h3.25l.9 1.5h3.7l.9-1.5H14"/>',
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.9v.05"/>',
  limitMark: '<path d="M8 3.5v5.75M8 12.1v.05"/>',
  key: '<circle cx="5.25" cy="10.75" r="3"/><path d="m7.4 8.6 6.1-6.1M11.25 4.75l1.75 1.75M9.75 6.25l1.25 1.25"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7"/>',
  mail: '<rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5"/><path d="m2.25 4 5.75 4.5L13.75 4"/>',
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  objects:
    '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><circle cx="11.5" cy="11.5" r="2.5"/>',
  paperclip: '<path d="m13 7.5-5.2 5.2a3 3 0 0 1-4.25-4.25l5.6-5.6a2 2 0 0 1 2.8 2.8L6.4 11.2A1 1 0 0 1 5 9.8l4.8-4.8"/>',
  pencil: '<path d="M10.5 2.75 13.25 5.5 5.5 13.25H2.75V10.5z"/><path d="m9 4.25 2.75 2.75"/>',
  reply: '<path d="M6.5 4 2.5 8l4 4"/><path d="M2.5 8h7a4 4 0 0 1 4 4v.5"/>',
  route: '<path d="M2 4.75h7.25a2.75 2.75 0 0 1 0 5.5H4.5"/><path d="m6.5 8.25-2 2 2 2"/><circle cx="13" cy="12.25" r="1.25"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>',
  send: '<path d="M14 2 7 9M14 2 9.5 14 7 9 2 6.5z"/>',
  shield: '<path d="M8 1.75 13.25 3.75v4c0 3.1-2.2 5.5-5.25 6.5-3.05-1-5.25-3.4-5.25-6.5v-4z"/>',
  star: '<path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4-2.9-2.8 4-.6z"/>',
  terminal: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5"/>',
  trash: '<path d="M2.5 4.25h11M6 4.25v-1.5h4v1.5M3.75 4.25l.6 9h7.3l.6-9"/>',
  users:
    '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.75 13.25c.5-2.3 2.15-3.5 4.25-3.5s3.75 1.2 4.25 3.5M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12 9.9c1.2.5 2 1.6 2.25 3.35"/>'
} as const;

/** The name of an icon of the landing page. */
export type IconName = keyof typeof PATHS;

// The GitHub mark (Octicons mark-github, MIT), the one filled glyph: it is how people recognise a link to a repository.
const GITHUB_MARK =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8';

/**
 * An inline icon. Decorative by default (`aria-hidden`): the text next to it says what it means. Pass `label` only when the icon
 * carries meaning on its own (a check or a limit mark in a list): it then becomes an image with that name.
 */
export function icon(name: IconName, options: { readonly label?: string; readonly className?: string } = {}): string {
  const className = options.className === undefined ? 'ic' : `ic ${options.className}`;
  const a11y = options.label === undefined ? 'aria-hidden="true"' : `role="img" aria-label="${esc(options.label)}"`;
  return `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${a11y} focusable="false">${PATHS[name]}</svg>`;
}

/** The GitHub mark, decorative (the link it sits in says "GitHub"). */
export const githubMark = (): string =>
  `<svg class="ic" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="${GITHUB_MARK}"/></svg>`;
