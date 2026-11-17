import type { TFunction } from './i18n';
import type { AllowedEntry } from './filters';

// Not spam (the Spam folder's way back): the `not_spam` batch action moves the messages to the Inbox and the Worker allows their senders (a sender
// of a domain this server hosts is never listed). What the person is told, and what Undo has to put right, both come from the Worker's answer, so
// they are decided here, pure, and tested without a screen.

/**
 * The toast after Not spam. It says only what the Worker did: the one sender it allowed by name, or how many senders it allowed (a sender of a
 * domain this server hosts, or one the person had allowed already, is not among them), or just where the messages went when it allowed nobody.
 */
export function notSpamText(tr: TFunction, count: number, allowed: readonly AllowedEntry[]): string {
  if (allowed.length === 0) {
    return count === 1 ? tr('toast.moved_to_inbox') : tr('toast.batch_moved', { count, folder: tr('folder.inbox') });
  }
  return allowed.length === 1 ? tr('toast.not_spam', { sender: allowed[0].value }) : tr('toast.not_spam_many', { count: allowed.length });
}

/** What Undo does: the same messages go back to Spam (the existing `move`), then the entries the action created are deleted and the blocks it removed are made again. */
export interface NotSpamUndo {
  move: { action: 'move'; ids: string[]; folder: 'spam' };
  /** The ids for `DELETE /api/filters/:id`, once the move has succeeded (a message that did not go back keeps its sender allowed). */
  remove: string[];
  /** The addresses to block again (`POST /api/filters`, kind `block`): the action took them off the block list when it allowed them. */
  block: string[];
}

export function notSpamUndo(ids: readonly string[], allowed: readonly AllowedEntry[], unblocked: readonly string[] = []): NotSpamUndo {
  return { move: { action: 'move', ids: [...ids], folder: 'spam' }, remove: allowed.map((entry) => entry.id), block: [...unblocked] };
}
