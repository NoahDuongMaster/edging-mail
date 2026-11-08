import React from 'react';
import { Bold, Image as ImageIcon, Italic, Link2, List, ListOrdered, Quote, Underline, type LucideIcon } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { Divider, IconButton, Select } from '../../ui';

const Tool: React.FC<{ label: string; icon: LucideIcon; onClick: () => void }> = ({ label, icon: Icon, onClick }) => (
  <IconButton label={label} size="sm" onClick={onClick}>
    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
  </IconButton>
);

interface FormatToolbarProps {
  /** Runs an editor command on the body (the compose focuses the editor first, so the selection it had is the one that changes). */
  exec: (command: string, value?: string) => void;
}

/** How far each edge of the row fades when there is more beyond it (the scroll-driven fade of compose.css), plus the 4px of a focus ring. */
const FADE_CLEARANCE = 24 + 4;

/**
 * A button that takes the keyboard focus under a faded edge of the row is scrolled clear of the fade, its ring included. The browser only
 * scrolls a button that is out of the row, and one under the fade is inside it. (A focus from the text style's list, drawn in the page's
 * body, is not in the row and moves nothing.)
 */
const clearOfFade = (event: React.FocusEvent<HTMLDivElement>) => {
  const row = event.currentTarget;
  if (!row.contains(event.target)) {
    return;
  }
  const edges = row.getBoundingClientRect();
  const box = event.target.getBoundingClientRect();
  if (box.right > edges.right - FADE_CLEARANCE) {
    row.scrollBy({ left: box.right - (edges.right - FADE_CLEARANCE) });
  } else if (box.left < edges.left + FADE_CLEARANCE) {
    row.scrollBy({ left: box.left - (edges.left + FADE_CLEARANCE) });
  }
};

/**
 * The formatting row above the body: text style, bold, italic, underline, lists, quote, link, image. It is one row that scrolls
 * sideways when the screen is too narrow, never two rows. The buttons only call `exec`; the editor itself stays in the compose.
 */
export const FormatToolbar: React.FC<FormatToolbarProps> = ({ exec }) => {
  const tr = useT();
  // The style the person last chose. The editor does not report the style under the caret, and the old list did not either.
  const [block, setBlock] = React.useState('p');

  const askUrl = (message: string, command: 'createLink' | 'insertImage') => {
    // eslint-disable-next-line no-alert -- no custom dialog exists for the URL prompt
    const url = window.prompt(message);
    if (url !== null && url !== '') {
      exec(command, url);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the row only follows the focus of its buttons (scrolls one clear of the fade); the buttons are the controls
    <div role="group" aria-label={tr('compose.format_group')} className="cp-fmt nm-hide-scrollbar" onFocus={clearOfFade}>
      <div className="cp-style">
        <Select
          label={tr('compose.text_style')}
          hideLabel
          options={[
            { value: 'p', label: tr('compose.style_normal') },
            { value: 'h3', label: tr('compose.style_heading') },
            { value: 'h4', label: tr('compose.style_subheading') }
          ]}
          value={block}
          onChange={(next) => {
            setBlock(next);
            exec('formatBlock', next);
          }}
        />
      </div>
      <Divider orientation="vertical" className="nm-hide-sm" />
      <Tool label={tr('compose.bold')} icon={Bold} onClick={() => exec('bold')} />
      <Tool label={tr('compose.italic')} icon={Italic} onClick={() => exec('italic')} />
      <Tool label={tr('compose.underline')} icon={Underline} onClick={() => exec('underline')} />
      <Divider orientation="vertical" className="nm-hide-sm" />
      <Tool label={tr('compose.bulleted_list')} icon={List} onClick={() => exec('insertUnorderedList')} />
      <Tool label={tr('compose.numbered_list')} icon={ListOrdered} onClick={() => exec('insertOrderedList')} />
      <Tool label={tr('compose.quote')} icon={Quote} onClick={() => exec('formatBlock', 'blockquote')} />
      <Divider orientation="vertical" className="nm-hide-sm" />
      <Tool label={tr('compose.insert_link')} icon={Link2} onClick={() => askUrl(tr('compose.link_prompt'), 'createLink')} />
      <Tool label={tr('compose.insert_image_url')} icon={ImageIcon} onClick={() => askUrl(tr('compose.image_prompt'), 'insertImage')} />
    </div>
  );
};
