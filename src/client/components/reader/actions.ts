/** The folders of a message, as the reader's toolbars see them. */
type Folder = string | undefined;

/** The fourth button of the phone's bottom bar (after Archive, the main move and Reply). */
export type PhoneFourth = 'delete' | 'snooze' | 'unread';

/** What the phone's More menu holds: the other move, Mark as unread, Add label. */
export type PhoneMoreItem = 'other-move' | 'unread' | 'label';

/**
 * How the phone's bottom bar shares out the actions of the desktop toolbar, so that none is lost on a 320 px phone: Archive, the main move
 * (Move to Trash; Move to Inbox in Trash and Spam) and Reply always; then Delete forever in Trash and Spam, Snooze where a message can be
 * snoozed, Mark as unread elsewhere (drafts, sent mail); More holds the rest.
 */
export function phoneBar(folder: Folder): { fourth: PhoneFourth; more: PhoneMoreItem[] } {
  const inBin = folder === 'trash' || folder === 'spam';
  const canSnooze = folder !== 'drafts' && folder !== 'sent' && !inBin;
  const fourth: PhoneFourth = inBin ? 'delete' : canSnooze ? 'snooze' : 'unread';
  return { fourth, more: fourth === 'unread' ? ['other-move', 'label'] : ['other-move', 'unread', 'label'] };
}
