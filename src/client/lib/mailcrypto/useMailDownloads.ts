import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Attachment, Message } from '../../types';
import { UnauthorizedError } from '../api';
import { getUnlockedKey } from '../crypto/keyStore';
import { tr } from '../i18n';
import { queryKeys } from '../queries';
import { openAttachmentBytes, openRawBytes, safeFileName } from './files';
import { saveBytes } from './save';

type Failure = 'fail.mailcrypto_attachment' | 'fail.mailcrypto_raw';

interface State {
  messageId: string;
  /** An attachment id, or 'raw' while the original message is being fetched. */
  busy: string | null;
  error: string | null;
}

export interface MailDownloads {
  /** Which download is running: an attachment id or 'raw'. */
  busy: string | null;
  /** Localized text of the last failure of the open message, when `onNotice` did not take it. */
  error: string | null;
  saveAttachment: (attachment: Attachment) => void;
  saveRaw: () => void;
}

/**
 * Downloads of the open message: an attachment, or the original message as .eml. The bytes are fetched, opened with the unlocked key and
 * handed to the browser's save dialog; they are not kept. A failure becomes catalogue text, given to `onNotice` (the app's toast) when there
 * is one, else returned as `error` for the reader to show.
 */
export function useMailDownloads(message: Message | null, onNotice?: (text: string) => void): MailDownloads {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<State | null>(null);
  const messageId = message?.id ?? null;
  // What belongs to another message is not this one's (the reader is reused when the selection changes).
  const current = state !== null && state.messageId === messageId ? state : null;

  const run = React.useCallback(
    async (what: string, failure: Failure, work: (opened: Message) => Promise<void>) => {
      if (message === null || (current !== null && current.busy !== null)) {
        return;
      }
      setState({ messageId: message.id, busy: what, error: null });
      let error: string | null = null;
      try {
        await work(message);
      } catch (error_) {
        if (error_ instanceof UnauthorizedError) {
          // The session is gone: a normal read signs the person out the way every other screen does.
          void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
        }
        error = tr(failure);
        onNotice?.(error);
      }
      setState({ messageId: message.id, busy: null, error: onNotice === undefined ? error : null });
    },
    [message, current, queryClient, onNotice]
  );

  const saveAttachment = React.useCallback(
    (attachment: Attachment) => {
      void run(attachment.id, 'fail.mailcrypto_attachment', async (opened) => {
        const bytes = await openAttachmentBytes(opened, attachment, getUnlockedKey());
        saveBytes(bytes, safeFileName(attachment.filename, 'attachment'));
      });
    },
    [run]
  );

  const saveRaw = React.useCallback(() => {
    void run('raw', 'fail.mailcrypto_raw', async (opened) => {
      const bytes = await openRawBytes(opened, getUnlockedKey());
      saveBytes(bytes, `${safeFileName(opened.subject, 'message')}.eml`);
    });
  }, [run]);

  return { busy: current?.busy ?? null, error: current?.error ?? null, saveAttachment, saveRaw };
}
