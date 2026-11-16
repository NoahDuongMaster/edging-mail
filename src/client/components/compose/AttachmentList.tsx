import type React from 'react';
import { Info, X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { fileTypeOf, formatBytes } from '../../lib/mail';
import { useT } from '../../lib/i18n';
import { IconButton } from '../../ui';
import { FileTypeTile } from '../FileTypeTile';

/** A file of the message being written: `progress` is how much of it is read (0..1) while it is being added, null once it is in. */
export interface AttachedFile {
  id: string;
  filename: string;
  size: number;
  progress: number | null;
}

/**
 * The files attached to the message being written, as chips under the body (type, name, size, a remove button named after the file).
 * Its type tile is the reader's (FileTypeTile, J3-15). A file still being read shows a progress bar in place of its size (M12: a
 * progressbar for screen readers; the fill grows by `transform: scaleX` from the left, never by animating a width (J2-11); under reduced
 * motion it jumps). Then the quiet note that drafts do not keep attachments. Nothing when there are none.
 */
export const AttachmentList: React.FC<{ t: ThemeTokens; files: readonly AttachedFile[]; onRemove: (id: string) => void }> = ({
  t,
  files,
  onRemove
}) => {
  const tr = useT();
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="cp-attach">
      <ul role="list" aria-label={tr('term.attachments')} className="cp-files">
        {files.map((file) => {
          const type = fileTypeOf(file.filename);
          const percent = file.progress === null ? 100 : Math.round(file.progress * 100);
          return (
            <li key={file.id} className="cp-file" data-state={file.progress === null ? 'ready' : 'reading'}>
              <FileTypeTile type={type} t={t} size="sm" />
              <span className="cp-file-main">
                <span className="cp-file-name">{file.filename}</span>
                {file.progress === null ? (
                  <span className="cp-file-size">{formatBytes(file.size)}</span>
                ) : (
                  <span
                    role="progressbar"
                    className="cp-progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={tr('compose.attaching', { filename: file.filename })}
                  >
                    <span className="cp-progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
                  </span>
                )}
              </span>
              <IconButton label={tr('compose.remove_file', { filename: file.filename })} size="sm" onClick={() => onRemove(file.id)}>
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <p className="cp-file-note">
        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{tr('compose.attachments_not_saved')}</span>
      </p>
    </div>
  );
};
