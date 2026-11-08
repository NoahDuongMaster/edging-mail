import { esc } from '../html';
import { icon } from './icons';
import { windowDots } from './windowDots';

/** A group of commands under one comment line. */
export interface CommandGroup {
  readonly comment: string;
  readonly commands: readonly string[];
}

// The first word of a command (npx, npm) is tinted; the prompt sign comes from CSS, so copying the text copies only the command.
const command = (line: string): string => {
  const space = line.indexOf(' ');
  const head = space === -1 ? line : line.slice(0, space);
  const rest = space === -1 ? '' : line.slice(space);
  return `<span class="cmd"><span class="k">${esc(head)}</span>${esc(rest)}</span>`;
};

/**
 * A terminal window with real commands, on the dark code surface in both themes: a tab bar (title and language), then the groups
 * of commands, each under its comment. The commands are shown exactly as the guide writes them. There is no copy button: the page
 * has no script, and a button that does nothing is not allowed. The block scrolls sideways on a narrow screen and can take focus
 * so a keyboard can scroll it.
 */
export function codeBlock(block: { readonly title: string; readonly label: string; readonly groups: readonly CommandGroup[] }): string {
  const lines = block.groups
    .map((group) => [`<span class="cm"># ${esc(group.comment)}</span>`, ...group.commands.map(command)].join('\n'))
    .join('\n\n');
  return `<figure class="code"><figcaption class="code-bar">${windowDots()}<span class="code-title">${icon('terminal')}${esc(block.title)}</span><span class="code-lang">bash</span></figcaption><pre tabindex="0" aria-label="${esc(block.label)}"><code>${lines}</code></pre></figure>`;
}
