import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { toBase64Url } from '../src/worker/base64url';

// The single-user version (the commit before multi-user) as it left its data: the schema of migrations 0000-0004 and the rows and R2 objects
// that version wrote (raw mail under `raw/<id>.eml`, sent mail under `sent/<id>.eml`, attachments under `attachments/<mail>/<id>_<name>`,
// plaintext subject, snippet and bodies in D1, a VAPID key sealed under JWT_SECRET). Used by upgrade.test.ts.

const LEGACY_MIGRATIONS = 5;
const encoder = new TextEncoder();

/** Every table gone, as on a database that was never created (test/setup.ts empties the tables before every test, so none holds rows). */
export async function dropEverything(): Promise<void> {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
  ).all<{
    name: string;
  }>();
  await env.DB.batch(tables.results.map((table) => env.DB.prepare(`DROP TABLE IF EXISTS \`${table.name}\``)));
}

/** The database of an installation that has run migrations 0000-0004 and nothing else. */
export async function installLegacySchema(): Promise<void> {
  await dropEverything();
  await applyD1Migrations(env.DB, env.MIGRATIONS.slice(0, LEGACY_MIGRATIONS));
}

/** `wrangler d1 migrations apply`: whatever is not applied yet (0005), on the database as it is. */
export const upgradeSchema = (): Promise<void> => applyD1Migrations(env.DB, env.MIGRATIONS);

export interface LegacyAttachment {
  id: string;
  filename: string;
  mime: string;
  cid: string | null;
  inline: boolean;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface LegacyMail {
  id: string;
  folder: 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'snoozed';
  from: string;
  fromName: string | null;
  to: string;
  cc: string | null;
  subject: string;
  text: string;
  html: string | null;
  labels: string[];
  read: boolean;
  starred: boolean;
  snoozedUntil: number | null;
  messageId: string | null;
  threadId: string;
  inReplyTo: string | null;
  createdAt: number;
  /** The whole raw mail as stored in R2 (`raw/<id>.eml`, or `sent/<id>.eml` for sent mail); null for a draft (a draft has no R2 object). */
  raw: string | null;
  rawKey: string | null;
  attachments: LegacyAttachment[];
}

/** Deterministic filler, so a test can compare bytes without storing them. */
function filler(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

const base64 = (bytes: Uint8Array): string => {
  let text = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    text += String.fromCodePoint(...bytes.subarray(start, start + 8192));
  }
  return btoa(text);
};

/** The marker a plaintext scan looks for, unique per mail. */
export const tagOf = (key: string): string =>
  [...encoder.encode(key)]
    .reduce((hash, byte) => (Math.imul(hash, 31) + byte) >>> 0, 7)
    .toString(16)
    .padStart(8, '0');

export function attachmentOf(
  mailKey: string,
  filename: string,
  mime: string,
  size: number,
  extra: Partial<LegacyAttachment> = {}
): LegacyAttachment {
  const tag = tagOf(mailKey);
  const head = encoder.encode(`attc-${tag} `);
  const bytes = new Uint8Array(size);
  bytes.set(head);
  bytes.set(filler(size - head.length, Number.parseInt(tag, 16)), head.length);
  return { id: crypto.randomUUID(), filename, mime, cid: null, inline: false, bytes, ...extra };
}

/** The raw mail as the single-user Worker kept it: the headers it received and the body, with the attachments as MIME parts. */
function rawOf(mail: Omit<LegacyMail, 'raw' | 'rawKey'>): string {
  const head = [
    `From: ${mail.fromName === null ? mail.from : `${mail.fromName} <${mail.from}>`}`,
    `To: ${mail.to}`,
    ...(mail.cc === null ? [] : [`Cc: ${mail.cc}`]),
    `Subject: ${mail.subject}`,
    `Date: ${new Date(mail.createdAt).toUTCString()}`,
    ...(mail.messageId === null ? [] : [`Message-ID: ${mail.messageId}`]),
    ...(mail.inReplyTo === null ? [] : [`In-Reply-To: ${mail.inReplyTo}`]),
    'MIME-Version: 1.0'
  ];
  if (mail.attachments.length === 0) {
    return [...head, 'Content-Type: text/plain; charset=utf-8', '', mail.text].join('\r\n');
  }
  const parts = mail.attachments.flatMap((file) => [
    '--B',
    `Content-Type: ${file.mime}; name="${file.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${file.filename}"`,
    '',
    base64(file.bytes)
  ]);
  return [
    ...head,
    'Content-Type: multipart/mixed; boundary=B',
    '',
    '--B',
    'Content-Type: text/plain; charset=utf-8',
    '',
    mail.text,
    ...parts,
    '--B--'
  ].join('\r\n');
}

export function legacyMail(key: string, createdAt: number, overrides: Partial<LegacyMail> = {}): LegacyMail {
  const tag = tagOf(key);
  const id = crypto.randomUUID();
  const base = {
    id,
    folder: 'inbox' as const,
    from: 'sender@example.org',
    fromName: 'Sender Example' as string | null,
    to: 'hi@example.com',
    cc: null,
    subject: `${key} subj-${tag}`,
    text: `Xin chào, đây là thư ${key}.\nbody-${tag}`,
    html: null,
    labels: [],
    read: false,
    starred: false,
    snoozedUntil: null,
    messageId: `<${id}@example.org>`,
    threadId: `<${id}@example.org>`,
    inReplyTo: null,
    createdAt,
    attachments: [],
    ...overrides
  };
  const rawKey = base.folder === 'drafts' ? null : `${base.folder === 'sent' ? 'sent' : 'raw'}/${id}.eml`;
  return { ...base, rawKey, raw: rawKey === null ? null : rawOf(base) };
}

/** The snippet the single-user version stored: the text on one line, 180 characters. */
export const snippetOf = (text: string): string => text.replaceAll(/\s+/g, ' ').slice(0, 180);

const insertMail = (mail: LegacyMail): D1PreparedStatement =>
  env.DB.prepare(
    `INSERT INTO messages (id, message_id, thread_id, from_address, from_name, to_address, cc, bcc, reply_to, subject, snippet, body_text, body_html, r2_key,
       folder, labels, is_read, is_starred, has_attachments, size, created_at, updated_at, references_header, in_reply_to, snoozed_until)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19, ?20, ?20, ?21)`
  ).bind(
    mail.id,
    mail.messageId,
    mail.threadId,
    mail.from,
    mail.fromName,
    mail.to,
    mail.cc,
    mail.subject,
    snippetOf(mail.text),
    mail.text,
    mail.html,
    mail.rawKey,
    mail.folder,
    JSON.stringify(mail.labels),
    mail.read ? 1 : 0,
    mail.starred ? 1 : 0,
    mail.attachments.length > 0 ? 1 : 0,
    (mail.raw ?? mail.text).length,
    mail.createdAt,
    mail.inReplyTo,
    mail.snoozedUntil
  );

/** The R2 key of an attachment as the single-user version named it: the file name reduced to a safe character set. */
export const legacyAttachmentKey = (mailId: string, file: LegacyAttachment): string =>
  `attachments/${mailId}/${file.id}_${file.filename.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}`;

/**
 * The VAPID row of the single-user version: AES-GCM under HKDF(JWT_SECRET, 'edging-mail', 'vapid private key v1'), the public key as associated data.
 * `mismatched` seals the private scalar of ANOTHER pair under this public key (a row that opens but whose halves do not belong together).
 */
export async function legacyVapidRow(jwtSecret: string, mismatched = false): Promise<{ public_key: string; private_key_sealed: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { d } = await crypto.subtle.exportKey('jwk', mismatched ? other.privateKey : pair.privateKey);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const ikm = await crypto.subtle.importKey('raw', encoder.encode(jwtSecret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('edging-mail'), info: encoder.encode('vapid private key v1') },
    ikm,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(publicKey) }, key, encoder.encode(d ?? ''))
  );
  return { public_key: publicKey, private_key_sealed: toBase64Url(Uint8Array.from([...iv, ...sealed])) };
}

export interface LegacySettings {
  display_name: string;
  signature: string;
  default_from: string;
}

/** Writes the installation: mail rows and objects, settings, one device, the VAPID row and a logout marker. */
export async function seedLegacyInstall(
  mails: LegacyMail[],
  settings: LegacySettings,
  device: { endpoint: string; p256dh: string; auth: string },
  vapidSecret: string
): Promise<{ vapidPublicKey: string }> {
  const now = Date.now();
  for (const mail of mails) {
    if (mail.raw !== null && mail.rawKey !== null) {
      await env.BUCKET.put(mail.rawKey, mail.raw, { httpMetadata: { contentType: 'message/rfc822' } });
    }
    for (const file of mail.attachments) {
      await env.BUCKET.put(legacyAttachmentKey(mail.id, file), file.bytes, { httpMetadata: { contentType: file.mime } });
    }
  }
  const vapid = await legacyVapidRow(vapidSecret);
  const statements = [
    ...mails.map(insertMail),
    ...mails.flatMap((mail) =>
      mail.attachments.map((file) =>
        env.DB.prepare(
          'INSERT INTO attachments (id, message_id, filename, mime_type, size, r2_key, content_id, is_inline, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)'
        ).bind(
          file.id,
          mail.id,
          file.filename,
          file.mime,
          file.bytes.length,
          legacyAttachmentKey(mail.id, file),
          file.cid,
          file.inline ? 1 : 0,
          mail.createdAt
        )
      )
    ),
    ...Object.entries({ ...settings, sessions_valid_after: String(now - 3_600_000) }).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)').bind(key, value, now)
    ),
    env.DB.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
      device.endpoint,
      device.p256dh,
      device.auth,
      'EdgingLegacyFixture/1.0',
      now - 86_400_000
    ),
    env.DB.prepare('INSERT INTO push_keys (id, public_key, private_key_sealed, created_at) VALUES (1, ?1, ?2, ?3)').bind(
      vapid.public_key,
      vapid.private_key_sealed,
      now - 86_400_000
    )
  ];
  await env.DB.batch(statements);
  return { vapidPublicKey: vapid.public_key };
}

/** A cookie of the single-user version: `<base64url({iat, exp})>.<HMAC-SHA-256 under JWT_SECRET NUL APP_PASSWORD>`. */
export async function legacySessionCookie(): Promise<string> {
  const now = Date.now();
  const payload = toBase64Url(encoder.encode(JSON.stringify({ iat: now, exp: Math.floor(now / 1000) + 14 * 86_400 })));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${env.JWT_SECRET ?? ''}\u0000${env.APP_PASSWORD ?? ''}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `edging_session=${payload}.${toBase64Url(signature)}`;
}
