# Security

Edging Mail holds private mail for several people, so the defaults fail closed. This page describes what the code does and where its limits are. The wording of the
claims below is the project's fixed wording: the README, the landing pages and the app use the same sentences.

- [Reporting a vulnerability](#reporting-a-vulnerability)
- [What is claimed, and what is not](#what-is-claimed-and-what-is-not)
- [Threat model](#threat-model)
- [Keys and encryption](#keys-and-encryption)
- [Accounts, sessions and gates](#accounts-sessions-and-gates)
- [Two-step verification](#two-step-verification)
- [Forgotten password, recovery key and break-glass](#forgotten-password-recovery-key-and-break-glass)
- [What admins can and cannot do](#what-admins-can-and-cannot-do)
- [Brute-force protection and CPU cost](#brute-force-protection-and-cpu-cost)
- [Cross-site requests](#cross-site-requests)
- [Mail content](#mail-content)
- [Response headers](#response-headers)
- [Push notifications](#push-notifications)
- [Secrets and logs](#secrets-and-logs)
- [If something leaks](#if-something-leaks)
- [Known limitations](#known-limitations)

## Reporting a vulnerability

Please report security problems privately. On the repository page open the **Security** tab and use **Report a vulnerability** (GitHub private vulnerability
reporting). Do not open a public issue for something exploitable. Include what you found, how to reproduce it, and the version or commit you tested.

## What is claimed, and what is not

**Encrypted storage.** "Subject, snippet, bodies, attachments (content, file name, type) and the raw message are stored encrypted to the owner's key. The server,
admins and anyone who can read the database and file storage cannot read them without the owner's password or recovery key. Exceptions: mail that arrived before its
owner set up keys is protected only by a server secret until the owner signs in; a new account before its owner's first sign-in; a weak password
can be guessed offline by someone holding a copy of the stored data; anyone who holds the person's recovery key."

Deleting means removal from the app and its storage: backups the platform keeps (for example D1 Time Travel) can hold the encrypted copy of a deleted message for a while.

**Admins.** "No admin can reset another person's password, and an admin has no way in Edging Mail to open the mail of a person who has already signed in and set up
their keys. An admin who creates an account knows its temporary password until the person first signs in, and mail that arrives before then is protected only by a
server secret. Admins can disable or delete accounts, re-create an address, add or move alias addresses and reset two-factor sign-in; every such change is logged.
Whoever holds the setup key can restore an admin's console access with a new key (that admin's old mail stays locked). Whoever controls the Cloudflare account or the
deployed code could change the software."

**End to end.** "Mail between people on this deployment is encrypted in the sender's browser to the recipients' keys. Keys are distributed by this server and are
not independently verified, and the app code is delivered by the same server." The browser seals one separate copy for each recipient and one for the sender, and
`POST /api/messages/internal` stores them without being able to open them (the API is in the [API reference](api.md#post-apimessagesinternal)). A message is marked end to
end only when no plaintext reached the server for any of its copies: if a recipient has not set up keys yet, the sender is asked to confirm, that one copy travels in the
clear over TLS and is held under `DATA_KEY` until the person's key setup, and the message carries no end-to-end mark. Mail to anybody outside this deployment goes the
normal way (see below). Copies are not signed: the server sets the sender from the session, so the recipient trusts this server for who sent a message.

Also true, and stated plainly: nobody, admins included, can restore mail without the password or the recovery key; a password change is not a key rotation;
"non-extractable" means only that JavaScript cannot export the key (the key bytes are still in the browser profile on disk).

**Not claimed.** Mail between servers is as protected as those servers make it (it arrives and leaves in the clear over SMTP and is encrypted to the owner when it is
stored). Subjects of mail you send are visible to the recipients' servers. The server can still see metadata: who sent and received which message, when, its size
and folder, how many attachments it has and their sizes, and the addresses of drafts. The server cannot search subjects or bodies, because it cannot read them.

## Threat model

- **Protected:** the contents of every mailbox (subject, snippet, bodies, attachments, raw message) against the people who run the database and the file storage, and
  against other users. A person reaches their own mail with a session cookie and their own password.
- **Not protected against:** whoever controls the Cloudflare account or the deployed code (they can change the software), a weak password that is guessed offline
  from a copy of the stored data, and anyone who holds a person's recovery key (together with the authenticator code, when the person has one).
- **Untrusted input:** every inbound message (headers, HTML, attachments, file names) is treated as hostile.
- **Operator secrets:** `JWT_SECRET` (sessions), `DATA_KEY` (what the server must read back, below) and `APP_PASSWORD` (the setup key). They are three different
  secrets, and a value reused for two of them is refused.

## Keys and encryption

- Each person has a P-256 key pair made in the browser. The **public key** is stored in the clear. The **private key** is stored only wrapped: once under a key made
  from the password (AES-GCM) and once under a key made from the recovery key. The server never receives a password, a recovery key or an unwrapped private key.
- The browser derives from the password (NFKC, PBKDF2-SHA256 with 600,000 iterations, salted with the sign-in address) two independent values with HKDF: `auth`, the
  credential it sends to the server, and the key that wraps the private key. The server stores a verifier of `auth` (PBKDF2-SHA256 with 100,000 iterations, which is
  the most a Workers request may use, over the raw 32 bytes) and compares in constant time, also for an address that does not exist.
- **Every message is stored in the EM1 format:** a random content key per message, a separate AES-256-GCM key per purpose (summary, body, raw message, each
  attachment), every ciphertext bound to the message id, and the content key sealed to the owner's public key (HPKE, P-256, base mode). The Worker can seal and
  cannot open: its bundle contains no HPKE open, no private-key import and no ECDH with a stored key. `npm run check:bundle` builds the Worker like a deploy and fails
  when a module of ours does, and it keeps a per-module list of the `crypto.subtle` calls each module may make. It catches accidents, not a determined contributor: of 25
  deliberately rogue variants it caught 21, and a computed property name or `new Function` gets past it, so code review of `src/worker` stays the control.
- **Recovery key.** Every person gets one when they set up their keys: 256 random bits shown as 54 symbols in 9 groups of 6 (the last two symbols are a checksum), to
  be written down. It is mandatory, shown once, and confirmed by typing three groups. The server stores the wrapped private key and a verifier of a value derived from
  the recovery key; it cannot use either to open anything.
- **`DATA_KEY`** (a Worker secret, 32 random bytes, base64) protects only what the server has to read back: the content keys of mail that arrived before its owner had
  keys ("pending" mail), the TOTP secrets, the MACs of 2FA recovery codes and of forgot-password tickets, and the Web Push signing key. It is **not** the root of any
  person's mail. Without it, sign-in and Setup answer `503`, mail for people who already have keys still arrives, push stops, and mail for people who have no keys yet is
  refused with a permanent error (it cannot be stored safely): bounced mail cannot be recovered. Rotate it with `DATA_KEY_PREVIOUS` (see
  [Configuration](configuration.md#data_key); old values are not re-sealed).
- **Pending mail.** Mail that arrives before its owner has keys is sealed under `DATA_KEY` and is wrapped to the owner's public key by the Worker as soon as the owner
  has set up keys (and by the cron, for owners who do not sign in again). Until then this is the only protection, as the claims above say.
- **Old mail.** An existing single-user install keeps its mail as plaintext rows until the cron has converted them to EM1 for the admin's key (the conversion starts
  after the admin's key setup, writes new objects first and flips each row in one guarded batch, and never overwrites an old object). Once it is done the mail is encrypted
  in the live database and in R2 and no plaintext object is left, but copies made before the job can still hold the plaintext (see Known limitations).
- **Password change is not a key rotation.** It wraps the same private key under the new password. A person whose password was guessed offline keeps the same key
  pair; rotating keys is not in this version.

## Accounts, sessions and gates

- Every `/api/*` route needs a valid session, except `GET /api/health`, sign-in, setup, break-glass and the forgot-password pair.
- The session cookie is `__Host-edging_session` over https: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure`, no `Domain`, valid for 14 days (a shared device: no
  expiry in the browser and twelve hours on the server), and it carries only the account id, the issue time and the time of the last second-factor check. The `__Host-`
  prefix makes the browser refuse the cookie unless it is host-only and Secure, so a page on a sibling subdomain cannot plant a cookie of the same name for the parent
  domain. Over plain http (local development only) the name is `edging_session`, because the prefix needs Secure. Each scheme reads only its own name: over https a cookie
  called `edging_session` is never read, so everybody is signed out once when a deployment first runs this version, and a planted one is inert. Sign-in and sign-out
  remove such a leftover cookie when the browser sends one. The cookie is signed with a key derived from `JWT_SECRET` (the two-step challenge uses a separate key derived
  from the same secret). Changing `JWT_SECRET` signs everybody out. `APP_PASSWORD` is not part of it.
- **An open WebSocket ends with its session.** The Worker tells the person's Durable Object when the session behind a socket ends (the expiry of its cookie: 14 days, or
  twelve hours on a shared device) and the object closes the socket then, with code `4401`, from an alarm; it also never sends an event to a socket past that time. A
  revocation closes the sockets at once, as before.
- **Revocation.** Signing out, changing the password, disabling an account, changing a role, resetting two-step verification and recovering a password each store a
  `sessions_valid_after` time that invalidates every older cookie on every device and closes the open WebSockets. The check reads the account on every request; if
  the database cannot be read the request is treated as signed out.
- **Gates.** A signed-in account may be limited to one task until it is done: choose a new password (a temporary one), set up keys and the recovery key, enrol
  two-step verification. While a gate is open only that gate's endpoints, `GET /api/auth/session` and sign-out answer; everything else is `403` with the gate's
  code. The order on a first sign-in is exactly that. The gates are evaluated on every request from the database, so a policy change reaches sessions that are already
  open. An account promoted to admin also has to set a password of the administrator length (16 characters; members need 12, counted after NFKC; the rule is
  enforced in the browser) before the console opens.
- **Temporary passwords** exist only when an admin creates an account (or reissues one for an account nobody has opened). The admin's browser makes the password and
  derives `auth` from it; the server never sees the password and returns none. It works for 72 hours. After that sign-in fails like a wrong password.
- Disabled accounts cannot sign in; the message is shown only to someone who has the right password, so it reveals nothing about which addresses exist.

## Two-step verification

TOTP (RFC 6238, SHA-1, 6 digits, 30 s, one step of drift) with ten one-time recovery codes. It is required for everyone from Setup, and always for admins. An admin can
relax the requirement for members (a typed confirmation, a second-factor check, an audit entry and an alert to the other admins); that never turns off the 2FA of a
person who has already enrolled.

- The secret is stored sealed under `DATA_KEY`; recovery codes are stored as MACs. A time step works once, a wrong code is counted per account, and a sign-in
  challenge works once, lives five minutes and is burned after five wrong codes. A sign-in with 2FA gives the session a "second factor checked" mark for five
  minutes, which actions that change who can do what ask for (the **step-up**).
- If the secret cannot be opened (for example `DATA_KEY` was replaced), password sign-in is refused with "two-step verification is broken for this account" rather than
  falling back to the password alone.
- **Reset by an admin.** An admin can clear a member's two-step verification (immediately: sessions end, the person is notified and the other admins alerted) or an
  admin's (after 24 hours, unless that admin signs in and cancels; all admins are alerted at once). At most three resets per person per hour. The person enrols again at
  the next sign-in. Nothing here touches a password or a key.

## Forgotten password, recovery key and break-glass

- **Forgot password** is self-service with the recovery key: the browser proves possession of the recovery key (and, when the person has 2FA, the code), gets a
  single-use ticket, opens its own copy of the private key with the recovery key, asks for a new password, makes a **new recovery key**, and only then completes in one
  guarded step. The server never sees the recovery key or the private key. The old recovery key no longer works on this server. The mail key does not change, so someone who kept both a copy of the old stored data and the old recovery key can still open
  the mail it protected; a key rotation does not exist in this version. Every session ends, and nobody is signed in by the reset.
  Every failed check of the key or the code answers the same text after the same delay, for unknown addresses too. A lock lasts at most 15 minutes for a wrong key, but more wrong
  attempts renew it (see Known limitations): a
  wrong key costs a fixed 15 minute lock per address (and an escalating lock per client address), and only somebody who already holds the key can spend the escalating budget of
  the code. A recovery that reaches the first step is visible to the owner at once (an
  undismissable notice for seven days, an entry in the sign-in history, a push to their devices: "someone used your recovery key"), and so is the completion. The
  owner can answer "this was not me" from any session that is still signed in with **Create a new recovery key**, which also kills an open ticket.
- Whoever holds the recovery key (and the authenticator code, when the person has one) can take the account over and lock the owner out. Keep it offline.
- **Break-glass.** Whoever holds the setup key (`APP_PASSWORD`) can give an **admin** address a new password and a new key pair with a new recovery key. It never
  clears two-step verification. The admin's old key is kept but its mail stays locked (it can be opened later only with the old recovery key); the other admins are
  alerted, the admin's devices get a push, and it is audited. It never opens anybody's mail. Run at least two admins. The route is anonymous, so its only brake is the strength of the
  setup key: it must be at least 24 characters (generate it, `openssl rand -base64 24`), every wrong setup key is counted in one hourly counter, and at the tenth every admin gets a
  notice and a push.
  After a break-glass, the old mail can be **kept** (nothing to do) or **deleted** by the admin from the app: the password in the request and, when the account has two-step
  verification, the session's **step-up mark** (a second-factor check from the last five minutes; the request carries no code), a fixed
  seven-day delay that cannot be shortened, a notice and a push to the admin, an audit row, and a cancel until the time has come (see [Locked old mail](api.md#locked-old-mail)).
  A pending deletion ends by itself when the account is recovered (forgot password, break-glass, a reissued password, an applied two-step reset): the owner then decides again.

## What admins can and cannot do

Admins can create accounts (with a temporary password), add and remove domains and alias addresses, change roles and display names, disable and delete accounts,
reset two-step verification, relax or restore the 2FA requirement, set the default language, and read the audit log. Deleting an account removes every row and every
file of that person; creating the same address again makes a new person with an empty mailbox and new keys (people who write to them are told their key changed).

- There is **no route under `/api/admin`** that sets, resets or returns a password, a key or a recovery key. The only credential an admin route receives is the
  temporary `auth` of a **new** account, and of an account nobody has opened and that has no keys (a reissue, refused for everyone else). A test derived from the route
  table (`test/admin-p1.test.ts`) fails when a route accepts a password or key field.
- The last active admin can never be demoted, disabled or deleted, and nobody can disable or delete themselves. Changes of role or status, deletes, 2FA resets and
  the 2FA requirement need a second-factor check from the last five minutes; deleting also needs the address typed.
- Every such action is audited, and most also alert the other admins (a banner entry, the audit log and a push).
- An admin who creates an account knows its temporary password until the person first signs in. If the admin signs in first they can choose the password, set up keys
  and a recovery key, and own that mailbox, including mail that arrived before (it was held under `DATA_KEY`). Create an account only when the person is ready to sign
  in; the audit log records the first sign-in with its address and browser, and the person sees it in their sign-in history.

## Brute-force protection and CPU cost

Wrong credentials are throttled in D1 (`login_attempts`), per client IP (`CF-Connecting-IP`; IPv6 is grouped by /64) and per account.

| Event                                                    | Result                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every wrong password                                     | Answer after a 400 ms delay, the same for an unknown address                                                                                                                               |
| Every other refusal of `POST /api/auth/login`            | Also held to 400 ms (a throttle `429`, a malformed request, a disabled account, `two_factor_broken`): the time of an answer says nothing about which branch made it. A success is not held |
| 5 wrong passwords from one client within 15 minutes      | Lock for 15 minutes: `429` with `Retry-After`, even for the right password                                                                                                                 |
| Every further 5 failures from that client                | The lock doubles, up to 24 hours                                                                                                                                                           |
| 10 wrong passwords for one account, from any address     | A fixed 15-minute lock for that account (it never grows, but more wrong attempts renew it)                                                                                                 |
| A correct password                                       | Clears that account's counter; the client's counter is not cleared (see below)                                                                                                             |
| More than 20 wrong passwords per hour across all clients | An extra 3 s delay on wrong-password answers (a delay, never a lockout)                                                                                                                    |
| The throttle table cannot be read                        | `503`: without the throttle there is no sign-in, no forgot-password, no setup, no break-glass                                                                                              |

The 400 ms are counted from the start of the request, so the work of a known address (the password check) is inside them, and the audit and sign-in rows of a failed attempt for a
known address are written after the answer has gone: an unknown address and a known one take the same time, also when the database is slow.

A correct password does not clear the client's counter: someone who is signed in to their own account could otherwise put one sign-in after every few guesses at colleagues
and never be throttled. It only stops counting there (the attempt it made is given back), so the people of an office, who share one address, do not use each other's room up.
A disabled account that proves its password is counted like any attempt and clears nothing.

Every JSON body is cut at 16 KiB before anything is read or derived (`413`, code `payload_too_large`), whether the request declares its length or streams it. Only the three
routes that carry mail (sending, saving a draft, end-to-end sending) have their own, larger limits (two of them are not enforced on a body streamed without a length, see Known limitations), and a batch action, which names message ids, may be 256 KiB.

Separate key spaces count sign-in, forgot-password (`forgot:<ip>`, `forgotacct:<email>`), setup, break-glass, second-factor codes, current-password checks of a
signed-in person, and public-key lookups (60 per 15 minutes per person, 50 addresses per request), so locking one never blocks another. The counters are read and
incremented before any key derivation, so a locked client costs the Worker almost nothing.

A password check costs CPU: one PBKDF2 (100,000 iterations) takes about 45 ms in a local workerd run (about 40 ms is the project's working figure; Cloudflare's own
measurement was not taken). Every public route that verifies runs one, also for an unknown address, so an attacker can spend CPU. Two consequences:

- Run the whole install on **Workers Paid**: the Workers Free limit is 10 ms of CPU per request, which a sign-in exceeds.
- Add a **Cloudflare rate-limiting rule** (WAF, Security rules) for `/api/auth/*` and `/api/admin/*` on your zone, for example 20 requests per minute per IP, with the
  action Block. The app's own throttle stops guessing; the rule stops cost.

To clear a lock by hand:

```bash
npx wrangler d1 execute DB --local --command "DELETE FROM login_attempts"    # --remote for production
```

## Cross-site requests

- Browsers always send `Sec-Fetch-Site` and page scripts cannot forge it. The API answers `403` when it is anything but `same-origin` or `none`, which blocks
  cross-site and same-site (sibling subdomain) requests. Clients that send no such header (curl, Wrangler's email handler) are not affected.
- The WebSocket handshake is covered too: when an `Origin` header is present it must equal the Worker's own origin (loopback hosts talking to each other are
  accepted, for local development through the Vite proxy). This stops a page on a sibling subdomain from opening the cookie-authenticated socket.
- There are no CORS headers, and the cookie is `SameSite=Lax`.

## Mail content

Mail is untrusted, so the reader never runs it as part of the app.

- HTML mail is rendered in an `<iframe>` with `sandbox="allow-popups allow-popups-to-escape-sandbox"`: no scripts, no same-origin access, no form submission, no
  navigation of the parent page.
- The frame has its own Content-Security-Policy (`default-src 'none'`) that blocks every remote request until you press **Show images**, and then allows `https:`
  images only, so images over plain `http` never load. Remote CSS, fonts and frames stay blocked.
- Links open in a new tab with `rel="noopener noreferrer"`, `<meta http-equiv="refresh">` is removed, and the frame sets a `no-referrer` policy.
- Every `<link>` and `<base>` of a mail and every `ping` attribute are removed before the frame is built, a mail's own `x-dns-prefetch-control` is dropped, and DNS
  prefetch is switched off for the frame (`x-dns-prefetch-control: off`, the first element of its head). While images are off, the document itself names no address of
  another host (Firefox does not apply the frame's policy to `srcset` and `<picture>`, so the policy is not the only line). A mail whose markup the parser reads differently
  the second time does not get past that either: the frame parses the text of the built document, so the document is rebuilt from its own text until the text stops
  changing (and none of it is shown if it never does). The frame is checked in real
  browsers with 90 hostile mails, mutation markup among them, against a fake tracker: `node scripts/frame-probe.mjs` (docs/development.md, "The mail frame in a browser").
- Attachments and raw `.eml` downloads are always served as downloads: opaque `application/octet-stream`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. They are stored encrypted; the browser decrypts them. Stored object
  names are random ids and carry no file name, type or address, and objects have no custom metadata.
- Nothing is scanned for malware or phishing. Treat attachments like any other download.

## Mail that claims one of your own addresses

Mail that arrives by email (SMTP) carries whatever `From` address its sender wrote, and the Worker does not check it. Anybody can send a message with `From: ceo@your-domain` and a
`Reply-To` of their own to every person here, and it is stored like any other inbox mail. This is how business-mail-compromise messages look ("the CEO asks for a payment").
What this version does about it:

- **Publish SPF, DKIM and DMARC with `p=reject` for every domain you host** (Cloudflare Email Routing adds the SPF and DKIM records for the domain; the DMARC record is yours, for
  example `v=DMARC1; p=reject; rua=mailto:dmarc-reports@your-domain`; start with `p=none` or `p=quarantine` and watch the reports if you send mail from other services). According to
  Cloudflare's documentation (Email Routing, "Email lifecycle" and "Postmaster", read on 2026-11-07), Email Routing checks SPF, DKIM, DMARC and ARC on every incoming message,
  rejects at SMTP a message that fails the DMARC policy published by the domain it claims (stage 2 of the inbound flow on the "Email lifecycle" page, before rule matching and
  before a Worker sees the message), and rejects a message that neither passes SPF nor carries a valid DKIM signature. That protection
  exists only for domains that publish a policy. **Not verified on a real deployment (UNVERIFIED here):** this project had no real Email Routing route to test it on, so what happens to a forged message for a domain
  with `p=reject` is Cloudflare's statement, not something these tests show. Cloudflare's documentation also says the authentication results can be read by a Worker; this version
  does not use them.
- Every message has an `origin`: `smtp` for mail that arrived by email, `internal` for mail written in the app and sent through this deployment's own end-to-end route, where the
  `From` address is the signed-in author. The Worker sets it; a sender cannot. The message list and the message JSON also carry `from_hosted`: whether the `From` address is on a
  domain this deployment hosts, worked out when the message is read. The app uses the two together: a message with `origin: "smtp"` and `from_hosted: true` claims to be from
  somebody here but did not come through the app, and is shown with a plain notice, and a reply that would go to a `Reply-To` different from the sender shows that address.
- A message from a hosted address that did not arrive the app's way is exactly the case to treat with care, however it looks. The end-to-end badge (`is_e2e`) is the other signal:
  only mail written in the app and sealed in the sender's browser has it.

## Response headers

- API responses go through Hono's `secureHeaders()` defaults (among others `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and `Strict-Transport-Security` over https only).
  JSON answers add `Cache-Control: no-store`.
- Static files get the policy in `public/_headers`: `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`,
  `form-action 'self'`, and a `connect-src` limited to the app's own origin (`'self'`; the WebSocket is same-origin, and browsers older than Safari 16 do not match
  `'self'` for `wss:`), plus `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a `Permissions-Policy` that turns off camera, microphone and geolocation.
  The rule for the hashed `/assets/*` files (one year, immutable) is applied by path, so it would also reach a miss: the Worker sets `Cache-Control: no-store` on every
  error answer of the static-files layer, so a CDN or browser cannot keep a missing hashed file as "404" for a year.

## Push notifications

- A notification for new mail carries the sender (name, else address) and nothing else: no subject and no snippet. Security notices (a recovery key used, a password
  reset, two-step verification reset, an alert to admins) carry a fixed text built from the actor's address, in the recipient's language, with a fixed same-origin
  link; they carry no mail content.
- Push and realtime events never contain a subject or a snippet. Subscriptions are accepted only for the real push services (`fcm.googleapis.com`,
  `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) over https on port 443, and a person has at most 20 devices. A deployment that says it is local
  (`ALLOW_LOCAL_PUSH` is `on`: `wrangler dev` and the tests) also takes a loopback address over http or https on any port, for a fake push service; no production setting needs it.
  Redirects from a push service are never followed.
- The Web Push key pair is created by the Worker on first use. Its private half is stored in D1 (`push_keys`), sealed under `DATA_KEY`; it is not an environment
  variable. See [Web Push keys](configuration.md#web-push-keys). A push that fails never changes anything else: the notice, the audit entry and the alerts are stored first.

## Secrets and logs

- `APP_PASSWORD`, `JWT_SECRET` and `DATA_KEY` are Worker secrets (`wrangler secret put`) or, locally, entries in the gitignored `.dev.vars`. Never commit them, and never
  paste them into an issue or pull request.
- `.env*` and `.dev.vars` are in `.gitignore`. `.dev.vars.example` holds placeholders that are rejected on purpose (too short, or not a valid key), so a copied example
  never works.
- Logs carry fixed texts, ids and error classes. They never carry a password, an `auth` value, a token, a request body, an address with SQL parameters, a file name or
  mail content; a request that fails validation is answered without echoing what was sent, and `JSON.parse` error text is never returned. A caught error is logged by its
  class only (`errorClass`), never its message or stack, and a test (`test/static/log-hygiene.test.ts`) fails on any console call in the Worker that passes more.
- A 500 answers a fixed text. The error code of every failure is documented in the [API reference](api.md#errors).

## If something leaks

1. **`JWT_SECRET`:** replace it (`npx wrangler secret put JWT_SECRET`). Every session stops working at once. The push key is unaffected once the first push after an upgrade
   from the single-user version has happened (until then the old pair is still sealed under `JWT_SECRET`: [Configuration](configuration.md#web-push-keys)).
2. **`DATA_KEY`:** put the new value in `DATA_KEY` and the old one in `DATA_KEY_PREVIOUS` and deploy: everything new is sealed under the new key, and the old values stay
   readable only while the old key is kept ([Configuration](configuration.md#data_key); this version does not re-seal them). Mail of people who have keys was never
   under it.
3. **`APP_PASSWORD`:** replace it. It is only the setup key.
4. **A person's password:** they change it (a password change is not a key rotation). If the stored data was also copied, a weak password can be guessed offline: treat
   that person's mail as exposed.
5. **A recovery key:** the person creates a new one (Settings, Account); the old one stops working immediately.
6. To remove push subscriptions right away: `npx wrangler d1 execute DB --remote --command "DELETE FROM push_subscriptions"`.
7. If the Cloudflare API token leaked, roll it in the Cloudflare dashboard.

## Known limitations

- Whoever controls the Cloudflare account or the deployed code can change the software; that is outside what the encryption can promise.
- Copies made before a person sets up keys, including backups, stay readable with `DATA_KEY`: mail that arrives for a person without keys is held under it until they have keys.
- Mail stored before an upgrade from the single-user version was plaintext. After the conversion job it is encrypted in the live database and in R2, and the cron has removed
  every plaintext object. Copies made **before** the job can still hold the plaintext: the export taken in step 1 of the upgrade guide, a copy of the bucket, D1 Time Travel and
  the other backups the platform keeps (Cloudflare documents 30 days of Time Travel history on Workers Paid), and the free space inside the database file, which D1 does not let you
  vacuum or overwrite as far as we know. The only way to be sure the plaintext is gone is to delete the export and the bucket copy and to let the platform's copies expire. This applies
  only to mail that existed before the upgrade; mail received after Setup is sealed on arrival. What the app promises is that it stores no plaintext any more and converts the old
  mail, not that no copy exists anywhere.
- The bucket must be dedicated to Edging Mail. When an upgraded install has converted every old row, the cron deletes every object under `raw/`, `sent/` and `attachments/` that no
  row points at (up to 1000 per prefix per run, until a pass finds none). A bucket shared with another application loses what that application keeps under those three prefixes.
  During the minutes of a deploy, an old version that writes `raw/<id>` just before it inserts the row could lose that object if the sweep ran in that window (theoretical: the sweep
  only runs once no plaintext row is left).
- When storing a mail fails even after the retries and D1 cannot be asked whether the mail's row exists, the sealed objects of the rejected mail may stay in R2 (ciphertext under
  random names; nothing in the app removes them), and a mail may be stored although the sender was told it failed (a duplicate if the sender writes again, not a loss).
- A body streamed without a `Content-Length` to `PUT /api/drafts/:id` or `POST /api/messages/send` is not cut by the app: it is read whole and then refused by the field checks (`400`),
  and only Cloudflare's request-body limit for the zone's plan (and the Worker's memory) bounds it; the 4 MiB limit of a draft is checked on a declared length only, and the send route
  has no byte cut in front of the read. Only a signed-in caller can do this (an anonymous caller is answered `401` before the body is read), and the app's own client sends a length.
  Every other JSON route is cut at 16 KiB (a batch action at 256 KiB) and `POST /api/messages/internal` at 16 MiB, streamed or not. Planned: per-route caps after authentication.
- Replacing a recovery key (or changing a password) does not change the key that encrypts your mail. The old password or old recovery key stops working on this server; a copy of the
  old stored data together with the old password or recovery key still opens the mailbox.
- Members are trusted, but not without a limit, to keep storage in check: one end-to-end send can store up to 51 rows, and each person may send 60 times per 15 minutes and 256 MiB of
  request data per day (a fixed 24 hour window). That limits what one person can add to the deployment's storage in a day; it is not a quota on a mailbox, and there is none in this version.
- A stranger can keep a person out of sign-in and of forgot-password for as long as he keeps trying: ten wrong passwords for an address (from any addresses) lock it for 15
  minutes, a wrong recovery key does the same for forgot-password, and ten more wrong attempts renew the lock. A person who is already signed in is not affected; a new device or
  an expired session is. The lock never grows beyond 15 minutes, there is no bypass for a device that signed in before, and the lock answers the same for an unknown address, so it
  reveals nothing. A Cloudflare rate-limiting rule on `/api/auth/*` keeps the attempts that renew it down.
- A disabled account still receives mail: it is delivered, sealed to the person's key or held under `DATA_KEY`, and waits until the account is enabled again. The key lookup does not
  offer a disabled person (it answers like an address nobody owns, so it does not list who is disabled), but the end-to-end route does not look at the status of a recipient.
- Signing out ends the sessions of every device of the person, but deletes only the Web Push subscription of the browser that signed out (the app names it). The other devices'
  subscriptions stay until the push service answers 404 or 410, so a signed-out device can still receive a notification (the sender's name, no subject, no body) until then.
- Known and left alone: two compare-and-set batches that run in the very same millisecond can write the audit row of the loser twice (no state is ever wrong), and the parser of a
  wrapped key accepts a size range a little wider than the one real size.
- No key rotation in this version, no passkeys, no hardware-key support, and no second admin approval for sensitive actions.
- Tested in Chromium and Firefox; the cryptography known-answer tests also run in a WebKit engine (WPE); not yet verified on real Safari or iPhone.
- Not covered by the tests here, so smoke-test them after the first deploy (the list is in [Deployment](deployment.md#after-the-first-deploy-a-ten-minute-check)): real Cloudflare
  behaviour (Email Routing and Email Sending, the real push services, real D1 and R2 limits, CPU time and billing per request); real https (the `__Host-` session cookie, HSTS, the 400 ms
  sign-in floor over a real connection, a WebSocket close at the end of a session); and real Safari and iPhone.
- A weak password can be guessed offline by someone holding a copy of the stored data (the verifier and the wrapped keys are in it). The browser enforces a minimum
  length and a blocklist; it cannot make a bad password good.
- The server sees metadata (addresses, times, sizes, folders, attachment counts and sizes) and cannot search subject or body text. Platform backups (for example D1 Time Travel)
  can hold the encrypted copy of deleted mail for a while.
- No spam or virus filtering of inbound mail (everything lands in the Inbox; Spam is a folder you move mail into).
- The page loads the Geist fonts from Google Fonts (`index.html`), so the visitor's browser contacts Google when the app opens. Self-hosting the font files would remove that.
- "Non-extractable" means not readable by JavaScript, nothing more. While you are signed in, the browser keeps your unlocked key in IndexedDB as a non-extractable key, and
  a forensic copy of an unlocked profile (a stolen laptop, a disk image) can still contain that key until the browser data is cleared. Signing out wipes the stored key
  record, but the browser may leave the bytes in its own files: in a disk scan of throw-away profiles, Chromium kept the key's PKCS8 bytes in its IndexedDB files after
  sign-out and after the database was deleted, and they were gone only after "clear site data" for the site; Firefox kept the raw key value in its SQLite file after
  sign-out until the database was deleted; the Linux WPE port of WebKit (not Safari) removed it at sign-out. Use full-disk encryption, and clear the site data on a computer that is not yours, or tick **shared device** at sign-in: the key then never touches the disk, and the session
  ends when the browser session ends and, on the server, after twelve hours.
- Outgoing authentication (SPF, DKIM, DMARC) is whatever Cloudflare Email Sending and your DNS provide; the Worker does not sign mail itself.
