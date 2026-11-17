import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { apiDelete, apiPut } from './api';
import { sessionKey, type Session, type SessionUser } from './auth';
import type { AvatarMime } from './avatarImage';
import type { Message } from '../types';

// Pictures. A picture always comes from this server (`/api/avatars/<id>`, same origin): the people of this deployment upload their own (it never
// leaves the server), and for a sender from outside the Worker may have looked one up on Gravatar and then Libravatar, only when an admin turned
// that on for the organisation. The browser itself never asks a third party for anything. The Worker says whose picture a row shows
// (`from_avatar`, a person's upload or a looked-up picture; as unverified as the From address of outside mail); the client trusts it and never
// builds a picture address from an email address. A sender without a picture keeps the initials of the stamp.

/** The address of a picture: the id changes with every upload, so the address is a perfect cache key (the Worker answers it immutable). */
export const avatarUrl = (id: string): string => `/api/avatars/${encodeURIComponent(id)}`;

const idOf = (id: string | null | undefined): string | undefined => (typeof id === 'string' && id !== '' ? id : undefined);

/**
 * The picture of the sender of a message row or reader header, or undefined (the initials stay). Sent and Drafts keep today's initials: in
 * Sent the sender is the owner, and a draft's tile shows the recipient. Judged by the message's own folder, so All mail and search results
 * follow the same rule.
 */
export function senderPicture(message: Pick<Message, 'from_avatar' | 'folder'>): string | undefined {
  const id = idOf(message.from_avatar);
  return id === undefined || message.folder === 'sent' || message.folder === 'drafts' ? undefined : avatarUrl(id);
}

/** The signed-in person's own picture, for the account button, the rail and Settings; undefined while there is none (or the session loads). */
export function ownPicture(user: Pick<SessionUser, 'avatar'> | undefined): string | undefined {
  const id = idOf(user?.avatar);
  return id === undefined ? undefined : avatarUrl(id);
}

/** A picture ready to send: what `PUT /api/avatar` takes. */
export interface PicturePayload {
  mime: AvatarMime;
  /** Standard base64 of the encoded image. */
  data: string;
}

interface AvatarAnswer {
  avatar: string | null;
}

/** The session says which picture is the person's own: it follows what the Worker answered (the same way every screen sees the change). */
export function keepAvatar(queryClient: QueryClient, avatar: string | null): void {
  queryClient.setQueryData<Session>(sessionKey, (old) => (old?.user === undefined ? old : { ...old, user: { ...old.user, avatar } }));
}

/** `PUT /api/avatar`: sets or replaces the picture; the Worker answers its new id. A refusal (`invalid_avatar`) is an `ApiError` with the words in the UI language. */
export async function putAvatar(picture: PicturePayload): Promise<string | null> {
  const answer = await apiPut<AvatarAnswer>('/api/avatar', picture, 'fail.avatar_save');
  return answer.avatar;
}

/** `DELETE /api/avatar`: takes the picture away; the Worker answers `avatar: null`. */
export async function deleteAvatar(): Promise<string | null> {
  const answer = await apiDelete<AvatarAnswer>('/api/avatar', 'fail.avatar_remove');
  return answer.avatar;
}

/** Sets or replaces the signed-in person's picture: resolves with the new picture's id. */
export function useSaveAvatar(): UseMutationResult<string | null, Error, PicturePayload> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putAvatar,
    // Whatever happened to the dialog meanwhile, the answer is the truth about the picture: the session takes it.
    onSuccess: (avatar) => {
      keepAvatar(queryClient, avatar);
    }
  });
}

/** Takes the signed-in person's picture away: the initials come back. */
export function useRemoveAvatar(): UseMutationResult<string | null, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAvatar,
    onSuccess: (avatar) => {
      keepAvatar(queryClient, avatar);
    }
  });
}
