import { eq } from 'drizzle-orm';
import { decodeCanonical, newCek, parsePublicKey, sealCek, sealField, toBase64Url, utf8 } from '../src/shared/crypto/server';
import { users } from '../src/worker/db/schema';
import { db, setupKeysWithPair } from './helpers';
import type { TestUser } from './helpers';

// What the browser does for end-to-end mail (reports/e2e-contract.md section 2): one copy per person, each with its own content key and row id.

export interface Content {
  subject: string;
  text?: string;
  html?: string;
  files?: { name: string; mime?: string; bytes: Uint8Array<ArrayBuffer> }[];
}

export interface Sealed {
  id: string;
  key_id: string;
  wrapped_cek: string;
  summary_blob: string;
  body_blob: string;
  attachments?: { id: string; blob: string; meta_blob: string }[];
}

const json = (value: unknown): Uint8Array<ArrayBuffer> => utf8(JSON.stringify(value));

/** One sealed copy of `content` for the person with this public key (`spki`, base64url). */
export async function sealedFor(spki: string, content: Content): Promise<Sealed> {
  const publicKey = await parsePublicKey(decodeCanonical(spki) ?? new Uint8Array(0));
  const id = crypto.randomUUID();
  const cek = newCek();
  const attachments = [];
  for (const file of content.files ?? []) {
    const attachmentId = crypto.randomUUID();
    attachments.push({
      id: attachmentId,
      blob: toBase64Url(await sealField(cek, `att/${attachmentId}`, id, file.bytes)),
      meta_blob: toBase64Url(
        await sealField(
          cek,
          `att-meta/${attachmentId}`,
          id,
          json({ filename: file.name, mime_type: file.mime ?? 'application/octet-stream', content_id: null })
        )
      )
    });
  }
  return {
    id,
    key_id: publicKey.keyId,
    wrapped_cek: toBase64Url(await sealCek(cek, id, publicKey)),
    summary_blob: toBase64Url(
      await sealField(cek, 'summary', id, json({ subject: content.subject, snippet: (content.text ?? '').slice(0, 180) }))
    ),
    body_blob: toBase64Url(await sealField(cek, 'body', id, json({ text: content.text ?? null, html: content.html ?? null }))),
    ...(attachments.length > 0 ? { attachments } : {})
  };
}

const base64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(''));

/** The recipient lists of a message; every person is in the body once, as a sealed copy (or a plain one when they have no keys). */
export interface Lists {
  to: TestUser[];
  cc?: TestUser[];
  bcc?: TestUser[];
}

/** The body of `POST /api/messages/internal` as the browser sends it. `extra` is merged last (to break things on purpose). */
export async function internalBody(
  sender: TestUser,
  lists: Lists,
  content: Content,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (sender.keys === null) {
    throw new Error('the sender has no keys');
  }
  const people = [...lists.to, ...(lists.cc ?? []), ...(lists.bcc ?? [])];
  const copies = await Promise.all(
    people.map(async (person) =>
      person.keys === null
        ? {
            address: person.email,
            plain: {
              subject: content.subject,
              text: content.text ?? null,
              html: content.html ?? null,
              attachments: (content.files ?? []).map((file) => ({
                filename: file.name,
                mime_type: file.mime ?? 'application/octet-stream',
                content_base64: base64(file.bytes)
              }))
            }
          }
        : { address: person.email, ...(await sealedFor(person.keys.spki, content)) }
    )
  );
  return {
    to: lists.to.map((person) => person.email),
    ...(lists.cc === undefined ? {} : { cc: lists.cc.map((person) => person.email) }),
    ...(lists.bcc === undefined ? {} : { bcc: lists.bcc.map((person) => person.email) }),
    sent: await sealedFor(sender.keys.spki, content),
    copies,
    ...extra
  };
}

/** Gives a user a NEW key pair (what a break-glass does to an admin), directly in D1; returns the user with the new keys. */
export async function rotateKeys(user: TestUser): Promise<TestUser> {
  const { request, keys } = await setupKeysWithPair(user.email);
  await db()
    .update(users)
    .set({
      public_key: request.public_key,
      key_id: request.key_id,
      wrapped_private_key_pw: request.wrapped_private_key_pw,
      wrapped_private_key_recovery: request.wrapped_private_key_recovery,
      recovery_verifier: 'x',
      recovery_salt: 'x',
      recovery_iterations: 1
    })
    .where(eq(users.id, user.id));
  return { ...user, keys };
}
