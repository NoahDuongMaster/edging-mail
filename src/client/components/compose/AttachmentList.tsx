import type React from 'react';
import { X } from 'lucide-react';
import { fileTypeOf, formatBytes } from '../../lib/mail';
import { useT } from '../../lib/i18n';
import { Badge, IconButton } from '../../ui';

/**
 * The files attached to the message being written: a hairline list of type, name, size and a remove button, then the quiet note that drafts
 * do not keep attachments. Nothing when there are none.
 */
export const AttachmentList: React.FC<{ files: readonly { filename: string; size: number }[]; onRemove: (index: number) => void }> = ({
  files,
  onRemove
}) => {
  const tr = useT();
  if (files.length === 0) {
    return null;
  }
  return (
    <>
      <ul role="list" aria-label={tr('term.attachments')} className="cp-files">
        {files.map((file, index) => (
          <li
            // eslint-disable-next-line react/no-array-index-key -- the same file can be attached twice and rows have no id; the list is only appended to or filtered by index
            key={`${file.filename}-${index}`}
            className="cp-file"
          >
            <Badge>{fileTypeOf(file.filename)}</Badge>
            <span className="cp-file-name">{file.filename}</span>
            <span className="cp-file-size">{formatBytes(file.size)}</span>
            <IconButton label={tr('compose.remove_file', { filename: file.filename })} size="sm" onClick={() => onRemove(index)}>
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      <p className="cp-file-note">{tr('compose.attachments_not_saved')}</p>
    </>
  );
};
