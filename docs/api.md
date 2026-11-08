# HTTP API reference

The Worker serves a JSON API under `/api`. The React app is its only intended client, but the API is plain HTTP and can be scripted. Everything here is read from
`src/worker/` (`index.ts`, `errors.ts`, `auth/`, `admin/`, `mail/`, `drafts.ts`, `push.ts`, `realtime.ts`).

Mail and keys are **encrypted by the browser's keys**: the API stores and serves ciphertext and wrapped keys, never a password, a recovery key or an unwrapped private key.
This page documents the contract; the cryptography is in [Security](security.md).

- [Conventions](#conventions)
- [Health](#health)
- [Authentication](#authentication): [session](#get-apiauthsession), [login](#post-apiauthlogin), [second step](#post-apiauthlogin2fa), [logout](#post-apiauthlogout),
  [change password](#post-apiauthchange-password), [two-step verification](#two-step-verification), [forgot password](#forgot-password),
  [setup](#post-apiauthsetup), [break-glass](#post-apiauthrecover), [notices and activity](#notices-and-activity)
- [Keys](#keys), [Locked old mail](#locked-old-mail)
- [Mail](#mail): [stats](#get-apistats), [list](#get-apimessages), [read one](#get-apimessagesid), [batch](#post-apimessagesbatch),
  [mark all read](#post-apimessagesread-all), [labels](#labels), [send](#post-apimessagessend), [internal (end to end)](#post-apimessagesinternal), [downloads](#downloads)
- [Drafts](#drafts) · [Settings](#settings) · [Web Push](#web-push) · [Realtime](#realtime-websocket)
- [Admin](#admin)
- [Errors](#errors)

## Conventions

- Bodies are JSON (`Content-Type: application/json`). Timestamps are epoch milliseconds, except where noted.
- Every JSON answer has `success: boolean`. A failure is `{ "success": false, "error": "<English text>", "code": "<stable code>" }` with a 4xx/5xx status. The `code` is the
  contract: it never changes, the English `error` may be reworded or made more specific, and the app shows its own translated text for each `code`. Every failure has a
  code (see [Errors](#errors)). Exceptions: `GET /api/health` has no `success` field, and the two download routes answer errors as plain text.
- JSON answers carry `Cache-Control: no-store`.
- **Roles.** _public_: no cookie needed. _signed in_: the session cookie (`__Host-edging_session` over https, `edging_session` over plain http in local development) of an account that has no open gate. _admin_: signed in, role `admin`, with no
  pending administrator-password change. A route marked _step-up_ also needs a second-factor check from the last five minutes (a sign-in with 2FA counts).
- **Gates.** While an account has an open gate, every route answers `403 { "code": "<gate>" }` except the gate's own endpoints, `GET /api/auth/session` and
  `POST /api/auth/logout`. In order: `password_change_required` (only `POST /api/auth/change-password`), `key_setup_required` (`POST /api/keys/setup`,
  `POST /api/auth/change-password`, `GET /api/keys/me`), `two_factor_enrollment_required` (`POST /api/auth/2fa/enroll/start` and `/confirm`). An admin promoted from member
  also meets `admin_password_upgrade_required` on `/api/admin/*` until the browser has set a password of the administrator length.
- Without a valid cookie a protected route answers `401 unauthorized`, also for paths that do not exist.
- A route that needs a secret the Worker does not have in a usable form answers `503 not_configured` (for example sign-in, Setup, two-step verification, forgot password, a password change and internal mail; see [Configuration](configuration.md)).
- **Same origin only:** browsers send `Sec-Fetch-Site`; any value other than `same-origin` or `none` is refused with `403 forbidden`. Clients that send no such header
  (curl, scripts) are accepted. There are no CORS headers, so other websites cannot call the API from a browser.
- **Strict bodies.** A body that is not a JSON object, or has a field the route does not document, is `400 invalid_body`; the answer never echoes what was sent. A `500`
  answers fixed text (`server_error`).
- **Body size.** A JSON body is cut at 16 KiB, before the route runs (`413 payload_too_large`), whether the request declares its length or streams it. A batch action
  (`POST /api/messages/batch`) may be 256 KiB (it names message ids). The three routes that carry mail have their own limits, and they differ:
  `POST /api/messages/internal` is capped at 16 MiB for every body, declared or streamed; `PUT /api/drafts/:id` is cut at 4 MiB when the request declares a `Content-Length`;
  `POST /api/messages/send` has no cut in front of the read. A body streamed **without** a length to the draft route or to the send route is therefore not cut by the app: it is read
  whole and then refused by the field checks (`400`, for sending also a message above 25 MiB), and only Cloudflare's request-body limit for the zone's plan applies. Only signed-in callers
  get that far (an anonymous caller is answered `401` before the body is read), and the app's own client always sends a length. Planned: per-route caps after authentication.
- **`auth` and `kdf`.** Wherever a request carries a credential, `auth` is the 43-character base64url form of 32 bytes derived in the browser from the password (never the
  password), in its canonical encoding, and `kdf` is `1`.
- Examples use `curl` with a cookie jar: `-c jar -b jar`.

```bash
curl -s -c jar -H 'Content-Type: application/json' -d '{"email":"you@example.com","auth":"<43 characters>","kdf":1}' http://localhost:8787/api/auth/login
curl -s -b jar http://localhost:8787/api/stats
```

## Health

`GET /api/health` (public): `{ "status": "ok", "app": "<APP_NAME>", "edge": "Cloudflare Workers", "timestamp": <ms> }`.

## Authentication

| Route                                                                                    | Role                 | Purpose                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `GET /api/auth/session`                                                                  | public               | Who is signed in, the open gate, the languages, the setup state          |
| `POST /api/auth/login`                                                                   | public               | Exchange address + `auth` for a session (or for a second-step challenge) |
| `POST /api/auth/login/2fa`                                                               | public               | Finish a sign-in with a code or a recovery code                          |
| `POST /api/auth/logout`                                                                  | public               | Clear the cookie and revoke every session of the account                 |
| `POST /api/auth/change-password`                                                         | signed in (any gate) | Choose a new password                                                    |
| `POST /api/auth/step-up`                                                                 | signed in            | Record a second-factor check on this session                             |
| `POST /api/auth/2fa/enroll/start`, `…/confirm`                                           | signed in (any gate) | Enrol two-step verification                                              |
| `POST /api/auth/2fa/disable`, `…/recovery-codes`                                         | signed in            | Turn it off (members, when the policy allows) / make new recovery codes  |
| `POST /api/auth/forgot/verify`, `…/complete`                                             | public               | Reset a forgotten password with the recovery key                         |
| `POST /api/auth/setup`                                                                   | public               | First-run Setup (once)                                                   |
| `POST /api/auth/recover`                                                                 | public               | Break-glass for an admin, with the setup key                             |
| `GET /api/auth/activity`                                                                 | signed in            | The caller's own recent sign-ins                                         |
| `GET /api/auth/notices`, `POST …/notices/:id/dismiss`, `POST /api/auth/2fa/cancel-reset` | signed in            | Security notices of the caller; cancel a pending 2FA reset of an admin   |

### `GET /api/auth/session`

Always `200`. Signed in: `{ "success": true, "authenticated": true, "configured": true, "setup_required": false, "user": SessionUser, "gate": "<code>" | null,
"language": "vi" | "en" | "zh-CN" | null, "default_language": "vi" | "en" | "zh-CN", "shared": <bool> }`. `shared` is true exactly when the session cookie of this request was issued for a shared device (`shared: true` at sign-in; a renewal by a password change keeps it): the app starts its unlock screen with the "shared device" box ticked, also in a second tab. Signed out: `{ "success": true, "authenticated": false, "configured": <bool>,
"setup_required": <bool>, "default_language": "…" }`; while `setup_required` it also lists `missing_secrets` (the **names** of secrets that are missing or invalid, never a
value) and, when set, `default_from` and `default_display_name`. `configured` is false when sign-in cannot work (a secret is unusable).

`SessionUser`: `id`, `email` (the primary address), `display_name`, `role`, `must_change_password`, `has_keys`, `totp_enabled`, `require_2fa`, `two_factor_reset_due_at`
(a reset of this admin's 2FA takes effect then; `null` = none pending), `language`, `admin_password_upgrade_required`, `step_up_at`.

### `POST /api/auth/login`

Role: public. Body: `{ "email": "<primary address>", "auth": "<43 characters>", "kdf": 1, "shared"?: true }`. `shared: true` says that this is a shared or public device: the
session cookie then has no `Max-Age` (it goes when the browser session ends) and the server ends the session after twelve hours whatever the browser does; the flag rides in the
signed challenge to the second step, and renewing the session (password change, two-step changes, step-up) keeps it. Anything but a boolean is `400 invalid_request`.

| Status | Body                                                                                             | When                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "success": true, "user": SessionUser, "keys"?: KeyBundle, "gate"?: "<code>" }` + `Set-Cookie` | Right credential, no second factor on the account                                                               |
| 200    | `{ "success": true, "two_factor_required": true, "challenge": "<token>" }`, no cookie            | Right credential, the account has two-step verification: finish with `login/2fa`                                |
| 401    | `wrong_credentials`                                                                              | Unknown address, wrong credential or an expired temporary password: the same answer and the same delay (400 ms) |
| 403    | `account_disabled`                                                                               | Only after a right credential                                                                                   |
| 403    | `two_factor_broken`                                                                              | The account's TOTP secret cannot be opened (the server secret changed)                                          |
| 429    | `too_many_attempts` + `retry_after` + `Retry-After`                                              | The client or the account is locked, see [security](security.md#brute-force-protection-and-cpu-cost)            |
| 503    | `not_configured` / `unavailable`                                                                 | A secret is unusable / the throttle store cannot be read                                                        |

Every answer of this route with a status of 400 or more takes at least 400 ms, whichever check refused it (so the time of a refusal tells nothing). A success is not held.

`KeyBundle`: `public_key`, `key_id`, `wrapped_private_key_pw`, `keys_version`, and, when they exist, `wrapped_private_key_recovery` and `recovery_set_at`. It is absent (or `null`) for an
account without keys. The cookie is `__Host-edging_session=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600` (14 days) over https and
`edging_session=…; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600` over plain http (local development: the `__Host-` prefix needs `Secure`). Each scheme reads only its own name; a
cookie called `edging_session` over https is never read, so the first request after an upgrade from an earlier version is signed out. Sign-in and sign-out also clear such a leftover
cookie when the request carries one.

### `POST /api/auth/login/2fa`

Role: public. Body: `{ "challenge": "<token>", "code": "123456" }` or `{ "challenge": "<token>", "recovery_code": "…" }`. Answer: as a successful login, with the
step-up mark. A challenge works once, lives five minutes, is burned after five wrong codes and is dead when the person's sessions were revoked after it was made (a break-glass, a
forgot-password completion, a reissue, a 2FA reset or a password change in between): all `challenge_invalid`. A wrong code is `401 wrong_code`; a time step works once. The codes of
one account have a budget of their own (also used by step-up and enrolment): ten wrong codes, then a 15 minute lock, again 15 minutes after the next ten, and from the third lock on
24 hours (`429 too_many_attempts`); when a lock starts the owner gets a notice (`second_factor_locked`, kept seven days) and a push: "someone with your password is guessing your code".

### `POST /api/auth/logout`

Role: public. Always clears the cookie. For a signed-in caller it also revokes every session of the account on every device and closes its WebSockets. The body is optional;
`{ "push_endpoint"?: "<the browser's Web Push endpoint>" }` deletes that one push subscription of the caller in the same batch as the revocation (never another person's, and an unknown or
over-long value is ignored: signing out always works). The client sends it so that a device that cannot reach the push service is not left behind after sign-out.

### `POST /api/auth/change-password`

Role: signed in, also while a gate is open. Body: `{ "current_auth", "new_auth", "kdf": 1, "keys"?, "keys_version"?: <n>, "admin_strength"?: <bool> }`. The current password
is always required (also for a temporary one). An account **with keys** must send `keys: { "wrapped_private_key_pw" }` (the same private key wrapped under the new password) and
`keys_version`; otherwise `400 keys_required`. An account **without keys** (a first sign-in on a temporary password) may send a full key set in `keys` (the shape of
[`POST /api/keys/setup`](#keys)) together with `keys_version`, which finishes the password change and the key setup in one request; invalid keys are `400 invalid_keys`. A stale
`keys_version` is `409 keys_changed`; a key id that another account already uses is `409 key_in_use`. `admin_strength: true` is the browser's statement that the new password has the administrator length; it clears the
`admin_password_upgrade_required` gate of a promoted member. `new_auth` equal to the current one is `400 same_password`; a wrong current
password is `403 wrong_password` (counted under its own throttle key, never against sign-in). Success: other sessions end, a fresh cookie is issued, gates are re-evaluated:
`{ "success": true, "user": SessionUser, "keys": KeyBundle | null }`.

### `POST /api/auth/step-up`

Body: `{ "code": "123456" }` (six digits; a recovery code is not accepted here). Gives this session a second-factor mark for five minutes (the cookie is re-issued with it) and answers
`{ "success": true }`. `401 wrong_code`, `409 not_enabled` when the account has no 2FA.

### Two-step verification

| Route                               | Body                         | Answer                                                                                                                                              |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/2fa/enroll/start`   | `{ "current_auth" }`         | `{ "secret_base32", "otpauth_uri" }`; `409 already_enabled`                                                                                         |
| `POST /api/auth/2fa/enroll/confirm` | `{ "current_auth", "code" }` | `{ "recovery_codes": [10 strings], "user" }`, shown once; `409 not_started`, `409 conflict` (the account changed while it was confirmed: try again) |
| `POST /api/auth/2fa/disable`        | `{ "current_auth", "code" }` | `{ "user" }`; members only and not while `require_2fa` is on (`403 two_factor_required`); `409 not_enabled`                                         |
| `POST /api/auth/2fa/recovery-codes` | `{ "current_auth", "code" }` | `{ "recovery_codes": [10 strings] }`; the old codes stop working; `409 not_enabled`                                                                 |

### Forgot password

Both routes are public. Neither signs anyone in.

- `POST /api/auth/forgot/verify` `{ "email", "recovery_auth", "kdf": 1, "code"?, "recovery_code"? }`: `recovery_auth` is derived from the recovery key in the browser. Every
  failure (unknown address, wrong key, missing or wrong code, an account without keys) is `401 recovery_failed` after the same delay; a disabled account says so only after a
  right key and code (`403 account_disabled`). Success: `{ "ticket", "public_key", "key_id", "keys_version", "wrapped_private_key_recovery", "min_password_length" }`; the ticket works once for ten
  minutes. The person is notified at once (notice, sign-in entry, push). `429 too_many_attempts`, `503 unavailable`. Throttling has two parts that cannot be used to lock the owner out
  for good: a wrong key counts per client address (escalating) and per address with the fixed account policy (ten attempts, then 15 minutes, never longer); a RIGHT key with a missing or
  wrong code spends an escalating budget of its own (`forgot2fa:<id>`, five attempts, then 15 minutes doubling up to 24 hours) that only a holder of the key can reach, and when it is
  locked the answer is exactly that of a wrong key.
- `POST /api/auth/forgot/complete` `{ "ticket", "new_auth", "kdf": 1, "wrapped_private_key_pw", "wrapped_private_key_recovery", "recovery_auth" }`: the browser sends the key
  wrapped under the new password, a NEW recovery key's wrap and its `recovery_auth`. One guarded step: new verifier, both wraps, `keys_version + 1`, every session revoked.
  `{ "success": true }`. `401 ticket_invalid` (used, expired, unknown), `409 recovery_stale` (the keys changed since `verify`), `403 account_disabled`, `429 too_many_attempts`.

### `POST /api/auth/setup`

Role: public, once. Body: `{ "setup_key", "email", "display_name"?, "auth", "kdf": 1, "aliases"?: [..], "language"?: "vi" | "en" | "zh-CN", "keys": { "public_key",
"key_id", "wrapped_private_key_pw", "wrapped_private_key_recovery", "recovery_auth" } }`. Creates the first admin (and their domain and aliases), hands the old single-user
data and mail that arrived before Setup to them, signs them in and answers `{ "success": true, "user", "keys", "gate" }`; the admin is then gated by
`two_factor_enrollment_required`. `401 wrong_setup_key`, `409 already_set_up`, `429 too_many_attempts`, `503 not_configured`, `400 invalid_language` for a language that is not offered.

### `POST /api/auth/recover`

Role: public. Break-glass for an **admin** address, with the setup key. Body: `{ "setup_key", "email", "new_auth", "kdf": 1, "keys": { …a NEW key set, as in Setup } }`.
Sets the new credential and keys, retires the old key (its mail stays locked), revokes sessions, never clears 2FA, audits, alerts the other admins and notifies the admin's
devices. Signs nobody in. `404 no_such_admin` for a member or an unknown address (answered at once, with no delay: the right setup key is already required to get that far, so
the answer tells nothing to somebody who does not hold it), `401 wrong_setup_key` (after the fixed delay), `429 too_many_attempts`, `400 invalid_keys` (the new key set is not valid), `409 keys_changed` (the admin's keys changed meanwhile: try again), `409 key_in_use` (that key id is already used), `503 not_configured` without a usable `APP_PASSWORD` (at least 24
characters, generated with `openssl rand -base64 24`). Every wrong setup key is counted in one hourly counter whatever its address; at the tenth, every active admin gets a notice
(`alert_break_glass_failures`) and a push.

### Notices and activity

- `GET /api/auth/activity` → `{ "activity": [ { "at", "ip", "user_agent", "ok", "kind" } ] }`: the caller's last sign-ins and sensitive events (`kind`: `sign_in`,
  `first_sign_in`, `recovery_started`, `password_recovered`, `recovery_key_replaced`, …).
- `GET /api/auth/notices` → `{ "notices": [ { "id", "kind", "at", "actor_email", "detail", "dismissible_after", "dismissible" } ] }`: undismissed security notices (a 2FA reset, a
  recovery-key use, a recovery completed, a break-glass, an alert about another admin's action). `POST /api/auth/notices/:id/dismiss` works only after `dismissible_after` (seven days
  after the event): `403 notice_locked` before, `404 notice_not_found` for another person's notice.
- `POST /api/auth/2fa/cancel-reset` (send `{}`; a request with no body at all is `400 invalid_body`): an admin cancels the pending reset of their own two-step verification; `409 no_pending_reset` when none.

## Keys

| Route                                 | Role                         | Purpose                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/keys/me`                    | signed in (key-setup gate)   | `{ "keys": KeyBundle \| null, "retired": [ RetiredKey ] }`: the current bundle and the keys retired by break-glass (their mail can be opened only with the old recovery key); see [Locked old mail](#locked-old-mail) |
| `POST /api/keys/setup`                | signed in (key-setup gate)   | Store the first keys and the mandatory recovery key, in one request                                                                                                                                                   |
| `POST /api/keys/recovery`             | signed in, step-up           | Create a new recovery key                                                                                                                                                                                             |
| `POST /api/keys/lookup`               | signed in                    | Public keys of addresses on this deployment                                                                                                                                                                           |
| `POST /api/keys/delete-locked`        | signed in, password, step-up | Ask to delete the mail locked under one retired key (carried out after seven days)                                                                                                                                    |
| `POST /api/keys/cancel-delete-locked` | signed in                    | Cancel such a request before the time has come                                                                                                                                                                        |

- `POST /api/keys/setup` `{ "current_auth", "keys": { "public_key", "key_id", "wrapped_private_key_pw", "wrapped_private_key_recovery", "recovery_auth" }, "keys_version" }`:
  only while the account has no keys (`409 not_applicable` otherwise). The server checks shape and that the key id belongs to the public key; it never accepts an unwrapped
  private key (`400 invalid_keys`; `409 keys_changed` for a stale `keys_version`, `409 key_in_use` for a key id another account already uses). Pending mail held for the account is wrapped to the new key straight away. Success: `{ "keys": KeyBundle, "user": SessionUser }`.
- `POST /api/keys/recovery` `{ "current_auth", "wrapped_private_key_recovery", "recovery_auth", "keys_version" }`: replaces the recovery wrap and its verifier at once (the old
  recovery key stops working), bumps `keys_version`, writes a notice and a sign-in entry, notifies the devices, kills an open forgot-password ticket. `403 step_up_required`
  (when the account has 2FA), `403 wrong_password`, `409 keys_changed`.
- `POST /api/keys/lookup` `{ "addresses": ["…"] }` (1 to 50): `{ "keys": [ { "address", "internal": bool, "public_key"?, "key_id"? } ] }`, one entry per distinct address in
  the order asked. An alias answers with its owner's key (a `+tag` is ignored); an address that is not on this deployment, or whose owner has no keys yet, has no key. The address
  of a **disabled** account answers like one that is not on this deployment (`internal: false`, no key): a disabled person is not offered as a recipient and the answer does not
  list who is disabled. (A disabled account still receives mail that arrives by email; it waits for them.)
  Limited to 60 lookups per 15 minutes per person (`429 too_many_lookups`).

### Locked old mail

A break-glass gives the admin a NEW key pair and retires the old one (`user_keys`). Mail sealed to a retired key stays where it is, **locked**: only the old recovery key can open it (the
browser unwraps `wrapped_private_key_recovery` of the retired key offline). The person either **keeps** it (nothing to do: keeping is the absence of a call) or **deletes** it.

`RetiredKey` (an entry of `retired` in `GET /api/keys/me`): `{ "key_id", "wrapped_private_key_recovery", "retired_at", "locked", "delete_requested_at", "delete_after" }`. `locked` is the number of
the caller's own messages (any folder, drafts too) sealed to that key; `delete_requested_at` and `delete_after` are `null` unless a deletion is pending (epoch ms).

- `POST /api/keys/delete-locked` `{ "current_auth", "key_id" }`: asks to delete the caller's messages sealed to that retired key. The password is required in the same request, and, when the account has two-step verification, the session's **step-up mark** (a second-factor check from the last five minutes: `403 step_up_required` without it; the request itself carries no code; `403 wrong_password`, throttled like every password check). Only the **marking** happens now:
  `delete_after` = now + 7 days (a fixed delay: there is no way to shorten it). It writes an audit row (`locked_mail_delete_requested`, with the key id and the count, never a message), an
  undismissable notice (`locked_delete_requested`, seven days; its `detail` is `{ "key_id", "delete_after" }`, so a client shows the date without knowing the delay), a sign-in-history entry and a push to the owner's devices. Success: `{ "success": true, "key_id", "locked", "delete_requested_at",
"delete_after" }`. Asking again while a deletion is pending answers the same schedule and writes nothing (the first time stands). `404 not_found` for the current key, a key that does
  not exist and another person's key (they answer alike; a `user_keys` row that holds the person's LIVE key counts as the current key, and the cron never deletes under it either), `400 invalid_request` / `400 invalid_body` for a malformed body.
  A pending request is ended by every recovery of the account (forgot-password completion, break-glass, a reissued temporary password, an applied two-step reset), in the same batch: the owner decides again.
- `POST /api/keys/cancel-delete-locked` `{ "key_id" }`: cancels a pending deletion (session only: it protects the mail). Audited as `locked_mail_delete_canceled`. `409 conflict` when none is
  pending, `404 not_found` as above.
- The cron (every minute) carries out every request whose `delete_after` has passed: the messages sealed to that key are deleted, with their attachment rows and R2 objects, in chunks of
  50 (at most 200 per run), and the request stays marked until nothing is left. A cancel in the middle of a run wins: the delete carries the marker as its condition. Each run that deleted
  something writes one audit row `locked_mail_deleted` (`{ key_id, deleted }`, actor `scheduled job`). The retired key itself stays listed (with `locked: 0`).

## Mail

Row shapes used below:

- **Message** (a row of `messages`, in a list and in the detail answer, with two more fields): `origin` (`smtp` for mail that arrived by email, whose `From` address is only what its
  sender wrote; `internal` for mail written in the app and sent through `POST /api/messages/internal`, whose `From` address is the signed-in author; set by the Worker, never by a
  sender; mail from before the field and drafts are `smtp`) and `from_hosted` (a boolean, not stored: whether the `From` address is on a domain of this deployment, worked out when the
  message is read). A message with `origin: "smtp"` and `from_hosted: true` claims to come from somebody here but did not come through the app. Fields: `id`, `message_id`, `thread_id`, `from_address`, `from_name`, `to_address`, `cc`, `bcc`, `reply_to`, `labels` (a JSON array stored as text),
  `is_read` (0/1), `is_starred` (0/1), `has_attachments` (0/1), `size`, `created_at`, `updated_at`, `references_header`, `in_reply_to`, `snoozed_until`, `folder`, and the content:
  - **EM1 rows** (`enc_fmt: 1`, every row written since the upgrade): `summary_blob` (the encrypted subject and snippet), `body_blob` (the encrypted bodies), `wrapped_cek` (the
    content key sealed to the owner's key), `key_id`, `wrap_kind` (`user`, or `server` while the owner has no keys yet), `is_e2e` (`1` for mail sent end to end between people on this deployment; `0` for everything else). `subject`, `snippet`, `body_text` and
    `body_html` are `null`. The browser opens the blobs with the private key.
  - **Legacy rows** (`enc_fmt: 0`, mail from before the upgrade that the cron has not converted yet): plaintext `subject`, `snippet`, `body_text`, `body_html`.
- **Attachment** (a row of `attachments`): `id`, `message_id`, `filename` (empty for EM1 rows), `mime_type`, `size`, `content_id`, `is_inline`, `created_at`, `meta_blob` (the
  encrypted file name, type and content id).
- **Folders:** `inbox`, `sent`, `drafts`, `snoozed`, `archive`, `spam`, `trash`. `starred` is a view (mail with `is_starred = 1` that is not in `trash`).

Every mail route sees only the caller's own rows. An id that belongs to somebody else answers exactly like one that does not exist (`404 message_not_found`), and a batch
action changes only the caller's rows.

### `GET /api/stats`

Role: signed in. `{ "success": true, "stats": { "inbox": { "total": n, "unread": n }, "sent": …, "starred": …, "archive": …, "spam": …, "trash": …, "drafts": …, "snoozed": … } }`.
`drafts.unread` is always `0`.

### `GET /api/messages`

| Query    | Default | Meaning                                                                                                                                                                                                               |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder` | `inbox` | A folder, `starred`, or `label:<name>` (mail carrying that label, outside `trash` and `spam`)                                                                                                                         |
| `q`      | none    | Search text, trimmed and cut to 200 characters; matches the sender's address and name and the recipients' addresses only (the server cannot read subjects or bodies); ASCII case-insensitive, `%` `_` `\` are literal |
| `page`   | 1       | 1-based, capped at 100000; a non-numeric value takes the default                                                                                                                                                      |
| `limit`  | 30      | 1 to 100                                                                                                                                                                                                              |

Answer: `{ "success": true, "messages": [Message…], "page": n, "limit": n }`. List rows carry the summary blob, never the body. Order: newest `created_at` first (equal dates:
later arrival first). `drafts`: most recently saved first. `snoozed`: the one due soonest first. An unknown folder name gives an empty list.

### `GET /api/messages/:id`

Returns `{ "success": true, "message": Message, "attachments": [Attachment…] }` and marks the mail read. `?peek=1` skips the mark-read. `404 message_not_found`.

### `POST /api/messages/batch`

Body: `{ "action": "<action>", "message_ids": ["…"], "folder"?: "…", "until"?: <epoch ms> }`. Answer: `{ "success": true, "count": n }`.

| `action`            | Effect                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| `read` / `unread`   | Set `is_read`                                                                  |
| `star` / `unstar`   | Set `is_starred`                                                               |
| `trash` / `archive` | Move to that folder (clears `snoozed_until`)                                   |
| `restore`           | Move to `inbox` (clears `snoozed_until`)                                       |
| `move`              | Move to `folder`: one of `inbox`, `archive`, `trash`, `spam`, `sent`, `drafts` |
| `snooze`            | Move to `snoozed` until `until`; drafts and Sent mail are left alone           |
| `delete`            | Delete the rows, their attachment rows and the R2 objects (permanent)          |

`count` is the number of ids sent, except for `snooze`, where it is the number of mails actually snoozed. Failures are `400 invalid_body` / `invalid_request` with the reason in
`error` (`message_ids array is required`, `Valid folder is required for move`, `Use the snooze action to snooze mail`, `until must be between 1 minute and 1 year from now`,
`Invalid action`). D1 allows 100 bound parameters per statement, so the Worker works through the ids in chunks; send at most 100 ids per call.

### `POST /api/messages/read-all`

Body: `{ "folder"?: "inbox", "q"?: "…" }`. Marks every unread mail of that folder view as read, with the same folder, label and search rules as the list, also beyond the pages
a client has loaded. Answer: `{ "success": true, "count": n }`.

### Labels

- `GET /api/labels` → `{ "success": true, "labels": ["…"] }`: the distinct label names in use by the caller's mail outside `trash` and `spam`, sorted.
- `POST /api/messages/labels` with `{ "id": "<message id>", "labels": ["…"] }` replaces the labels of one of the caller's mails and answers `{ "success": true, "labels": […] }`.
  Names are trimmed and de-duplicated ignoring case (first spelling wins). `404 message_not_found` for an id that is not the caller's. `400 invalid_request`: `id and labels[]
are required`, `At most 20 labels per message`, `Labels must be 1-30 letters, numbers, spaces, "_" or "-"`.

### `POST /api/messages/send`

Role: signed in. Sends a mail through Cloudflare Email Sending and keeps the copy in Sent, **sealed to the sender's own key** (plaintext is never stored). The sender is always the
caller's primary address and display name: a `from` that is another address is `403 from_not_allowed` and nothing is sent. See
[Mail features](mail-features.md#sending) for the behaviour behind it.

| Field          | Type               | Notes                                                                                                        |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `to`           | string or string[] | Required, at least one address                                                                               |
| `subject`      | string             | Required (empty is refused)                                                                                  |
| `from`         | string             | Optional; if present it must be the caller's own address                                                     |
| `cc`, `bcc`    | string or string[] | Optional                                                                                                     |
| `reply_to`     | string             | Optional bare address                                                                                        |
| `text`, `html` | string             | Body parts; send either or both                                                                              |
| `in_reply_to`  | string             | `Message-ID` of the mail you answer, in angle brackets, at most 998 bytes                                    |
| `references`   | string[]           | Used as the chain only when the answered mail is not stored                                                  |
| `attachments`  | array              | `{ "filename", "content_base64", "content_type" }`, at most 32                                               |
| `draft_id`     | string             | Lowercase UUID of the draft the mail was written in; deleted after a successful send (only if it is a draft) |

Success: `200 { "success": true, "message": Message, "note": "Accepted by Cloudflare Email Service" }`. Errors: `400 invalid_body`; `400 invalid_request` with a reason (`to and
subject are required`, `Invalid email address: …`, line breaks in headers, more than 32 attachments, a message above 25 MiB); `403 key_setup_required` (no keys yet);
`502` `Email sending is not configured: the SEND_EMAIL binding is missing`; `502` `Email delivery failed: …` (Cloudflare refused it, nothing is stored); `500` the mail is out but
the Sent copy could not be saved (do not send it again).

There is no byte limit in front of the read: the body is read whole, whether the request declares a length or streams it, and then refused by the field checks (`400`; a message
above 25 MiB is one of them). Only Cloudflare's request-body limit for the zone's plan applies. Only signed-in callers get that far (an anonymous caller is answered `401` before the
body is read), and the app's own client sends a length. Planned: per-route caps after authentication.

### `POST /api/messages/internal`

Role: signed in (no gate open). End-to-end mail between people on this deployment: the browser seals one **independent copy per recipient person** (its own content key and row
id) and one copy for the sender's Sent folder; the Worker checks them and stores the rows. It never opens a copy, never calls Email Sending, and takes the sender and the
sender name from the session. The behaviour is described in [Mail features](mail-features.md#mail-between-people-on-this-deployment). The body is read as a stream and refused
over 16 MiB (`413 payload_too_large`) whether the request declares its length or not; every key not listed is `400 invalid_body`.

```json
{
  "to": ["bob@example.com"],
  "cc": [],
  "bcc": [],
  "in_reply_to": "<id@host>",
  "references": ["<id@host>"],
  "draft_id": "<uuid>",
  "sent": {
    "id": "<uuid>",
    "key_id": "<key id>",
    "wrapped_cek": "<b64url>",
    "summary_blob": "<b64url>",
    "body_blob": "<b64url>",
    "attachments": [{ "id": "<uuid>", "blob": "<b64url>", "meta_blob": "<b64url>" }]
  },
  "copies": [
    { "address": "bob@example.com", "id": "<uuid>", "key_id": "…", "wrapped_cek": "…", "summary_blob": "…", "body_blob": "…" },
    {
      "address": "late@example.com",
      "plain": { "subject": "…", "text": "…", "html": null, "attachments": [{ "filename": "…", "mime_type": "…", "content_base64": "…" }] }
    }
  ]
}
```

| Field                                           | Rule                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`, `cc`, `bcc`                               | `to` has at least one bare address; at most 50 different addresses over the three lists (`400 too_many_recipients`); every address must belong to a person here (`400 recipient_not_internal`, with `addresses: [...]`) |
| `copies`                                        | Exactly one per recipient **person** (two addresses of one person are one person), its `address` one of the typed addresses of that person; else `400 copies_mismatch`                                                  |
| sealed copy (`sent` and each entry of `copies`) | `id` a lower-case UUID, `key_id` and `wrapped_cek` (its header must name `key_id`), `summary_blob` (≤ 8 KiB), `body_blob` (≤ 1 MiB), attachments (≤ 32 per copy), every id different                                    |
| `plain` copy                                    | For a recipient **without keys** only: `subject` (≤ 998 characters, one line), `text`/`html` (together ≤ 1 MiB), attachments with `filename`, `mime_type` and `content_base64`                                          |
| `in_reply_to`, `references`, `draft_id`         | As in `POST /api/messages/send`; `draft_id` is deleted only if it is the caller's own draft                                                                                                                             |

Checks, in this order, and nothing is stored until all pass: the throttle (60 sends per 15 minutes per person, claimed first: `429 too_many_requests` with `Retry-After`; `503 unavailable`
when the throttle store cannot be read); shape and size (`400 invalid_body`; **count and length caps are `400 invalid_request`** with the reason named: more than 32 attachments in a copy, a plain
subject over 998 characters or with a line break, a plain file name or type over 255 characters, a malformed blob or id; **size caps are `413 payload_too_large`**: a 16 MiB request, a summary
over 8 KiB, a body over 1 MiB, a description over 4 KiB, plain text and html over 1 MiB, 10 MiB of attachment bytes and 100 attachment
objects over all copies); recipients and copies (above); **key freshness**: every sealed copy must be sealed to that person's **current** key, the sender's own copy too, else `409 key_changed`
with `keys` (the lookup answer for every address of the request) and `own_key` (`{ public_key, key_id }` of the caller), and the browser seals again; unused ids: a row or attachment id
that already exists is `409 id_in_use` (the server never overwrites). A `plain` copy is sealed by the server (to the person's key if they have one by now, else held under `DATA_KEY` as
pending, re-sealed after their key setup); without a usable `DATA_KEY` that is `503 not_configured`. **Daily byte budget:** every stored send adds the size of its request to a budget of 256 MiB per
person in a fixed 24 hour window that starts with the first send; one that does not fit is `429 too_many_requests` with `Retry-After` (the seconds until the window ends) and nothing is
stored. It is spent last, after every other check, so a refused request costs nothing; it is a limit on storage, not a quota shown to the person.

Rows are written in one batch, each insert conditional on the person's key still being the one it was sealed to (a key change between the check and the write stores nothing and answers `409
key_changed`). `from_address` and `from_name` are the caller's; `message_id` is one `<uuid@domain>` shared by every copy; `to_address` and `cc` are as typed; `bcc` is on the Sent row only;
`is_e2e` is `1` on every row when no copy was `plain`, else `0` on every row. Recipients get a realtime `mail.new` and a push with the sender's name and the message id only.

Success: `200 { "success": true, "e2e": true|false, "message": Message (the Sent row), "copies": [ { "address", "id", "sealed": true|false } ] }`.

### Downloads

| Route                      | Content-Type               | Notes                                                                                                                |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/attachments/:id` | `application/octet-stream` | The stored attachment: for an EM1 row, the **ciphertext**, which the browser decrypts. Always an attachment download |
| `GET /api/raw/:id`         | `message/rfc822`           | The stored raw message: for an EM1 row, the ciphertext                                                               |

Both answer `404` with plain text for an id that is not the caller's, and add `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and
`Cache-Control: private, no-store`. A failure of the storage is a fixed plain text.

## Drafts

A draft is a `messages` row in the `drafts` folder. `:id` is a lowercase UUID made by the client (`crypto.randomUUID()`), so the first save and every later save are the same
call. The subject and body are **encrypted in the browser** with a fresh content key on every save; recipients stay plaintext.

| Route                    | Role      | Answer                                                                                                                                                   |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/drafts/:id`    | signed in | Create or update. Body: `{ from?, to?, cc?, bcc?, in_reply_to?, summary_blob, body_blob, wrapped_cek, key_id }`. `{ "success": true, "id", "saved_at" }` |
| `GET /api/drafts/:id`    | signed in | `{ "success": true, "draft": { id, from, to[], cc[], bcc[], in_reply_to?, summary_blob, body_blob, wrapped_cek, key_id } }`                              |
| `DELETE /api/drafts/:id` | signed in | `{ "success": true }`                                                                                                                                    |

`GET` and `DELETE` only see the caller's drafts: any other id is `404 draft_not_found`. A `PUT` never overwrites a real mail or somebody else's row: `409 not_a_draft`.
`wrapped_cek` must be sealed to the caller's **current** key (`409` otherwise). Recipient addresses are not syntax-checked (a draft may be unfinished); sending validates them.

| Limit                                                                  | Status |
| ---------------------------------------------------------------------- | ------ |
| request body over 4 MiB (by `Content-Length`)                          | 413    |
| `body_blob` over 2 MiB, `summary_blob` over 8 KiB                      | 400    |
| `to`, `cc`, `bcc` over 100 items each; one address over 320 characters | 400    |
| `from` over 320 characters                                             | 400    |
| `in_reply_to` not `<id@host>`, or over 998 characters                  | 400    |
| `:id` is not a lowercase UUID (`PUT` only)                             | 400    |

The 4 MiB limit is checked on a **declared** `Content-Length` only. A body streamed without a length to `PUT /api/drafts/:id` is not cut by the app: it is read whole and then refused by
the field checks (`400`), and only Cloudflare's request-body limit for the zone's plan applies. Only signed-in callers get that far (an anonymous caller is answered `401` before the body
is read), and the app's own client sends a length. Planned: per-route caps after authentication.

## Settings

Role: signed in. The settings are the caller's own.

`GET /api/settings` → `{ "success": true, "settings": { "display_name": "", "signature": "", "email": "<primary address>", "language": "vi" | "en" | "zh-CN" | null } }`.

`POST /api/settings` takes a partial object of `display_name`, `signature` and `language` and answers `{ "success": true, "settings": <effective values> }`. The primary address is
read-only (it is the sign-in name and the only sender).

| Key            | Rule                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `display_name` | String, trimmed, one line, at most 100 characters                                                                                   |
| `signature`    | String, kept as typed, at most 2000 characters                                                                                      |
| `language`     | `vi`, `en`, `zh-CN`, or `null` (use the organisation default); it also decides the language of the push notices sent to this person |

Errors: `400 invalid_body` for an unknown key, `400 invalid_language` for a language that is not offered, `400 invalid_request` with the rule that failed for the other keys.

## Web Push

Role: signed in. There is nothing to configure: the Worker creates its VAPID key pair the first time push needs it ([Web Push keys](configuration.md#web-push-keys)). Without a usable
`DATA_KEY`, `public-key`, `subscribe` and `test` answer `503`. Bodies are limited to 4096 characters (`413`). A person has at most 20 devices.

| Route                        | Body                                           | Answer                                                               |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/push/public-key`   |                                                | `{ "success": true, "publicKey": "…" }`                              |
| `POST /api/push/subscribe`   | `{ "endpoint", "keys": { "p256dh", "auth" } }` | `{ "success": true }`; upserts by endpoint and stores the User-Agent |
| `POST /api/push/unsubscribe` | `{ "endpoint" }`                               | `{ "success": true }` (also when it was not subscribed)              |
| `POST /api/push/status`      | `{ "endpoint" }`                               | `{ "success": true, "subscribed": true \| false }`                   |
| `POST /api/push/test`        |                                                | `{ "success": true, "sent": n, "failed": n, "removed": n }`          |

`subscribe` validation (all `400`): `endpoint` is required, at most 2048 characters, a valid URL, without credentials, and `https` on port 443 to a known push service
(`fcm.googleapis.com`, `updates.push.services.mozilla.com` or another `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`); any other port on those hosts is
refused. Only a deployment that says it is local (`ALLOW_LOCAL_PUSH` is `on`, see [Configuration](configuration.md)) also accepts a loopback address (`localhost`, `127.0.0.1`, and the
forms the URL parser turns into it, such as `127.1`) over `http` or `https` on any port, for a fake push service. `keys.p256dh` must decode to 65 bytes and be a valid P-256 point, `keys.auth` to 16 bytes. A notification for new mail carries the sender and nothing else
(no subject, no snippet). See [Realtime, Web Push and PWA](pwa-and-push.md) for the delivery details.

## Realtime (WebSocket)

Role: signed in. `GET /api/ws` with `Upgrade: websocket`. A request without the upgrade header is `426 upgrade_required`. The `Origin` header must equal the Worker's own origin
(two loopback hosts, as in local development, are also accepted), otherwise `403`. Each person has their own Durable Object, so a socket receives only its own events.

A socket lasts as long as the session it was opened with: the Worker tells the person's Durable Object when that session's cookie ends (14 days, or twelve hours for a shared device),
and the object closes the socket then with close code **4401** and sends it nothing after that time. A connection the object was not told an end for is refused.

On connect the server sends `{"type":"hello"}`. Send the text `ping` to get `pong`. Events:

```json
{ "type": "mail.new", "id": "…", "folder": "inbox", "from_name": "…", "from_address": "…", "created_at": 0 }
{ "type": "mail.changed" }
```

`mail.new` is sent when an inbound mail is stored for the caller; it carries no subject and no snippet. `mail.changed` follows a send, a draft save or delete, a batch action, a label
change, "mark all as read" and a snoozed mail returning to the inbox. A revocation of the account's sessions closes its sockets with close code **4401** (`session ended`: the
browser must lock and wipe its key), except when the change renewed the caller's own session in the same answer (`change-password`, `2fa/enroll/confirm`, `2fa/disable`,
`2fa/recovery-codes`): then every socket of the person closes with **4402** (`session renewed`). The browser that made the change keeps its key and reconnects once with the new
cookie; another device reconnects with a revoked cookie and is refused with `401`, which is where it learns that its session ended. Broadcasting is best effort and never fails the
request that caused it.

## Admin

Every route here needs the **admin** role; the ones marked _step-up_ need a second-factor check from the last five minutes. **No route under `/api/admin` sets, resets or returns a
password, a key or a recovery key.** The only credential any of them receives is the temporary `auth` of a new account (`POST /api/admin/users`) or of an account nobody has
opened (`POST /api/admin/users/:id/reissue`); the admin's browser derives it and the server returns none. A test derived from the route table enforces this
(`test/admin-p1.test.ts`).

| Route                                                               | Role                               | Purpose                                                                            |
| ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/admin/users`                                              | admin                              | List accounts (`q`, `limit`, `cursor`)                                             |
| `POST /api/admin/users`                                             | admin                              | Create an account with a temporary password (72 hours)                             |
| `PATCH /api/admin/users/:id`                                        | admin (step-up for role or status) | Display name, role, `status` (`active` / `disabled`)                               |
| `POST /api/admin/users/:id/reissue`                                 | admin                              | A new temporary password for an account nobody has opened                          |
| `POST /api/admin/users/:id/aliases`, `DELETE …/aliases/:address`    | admin                              | Add or remove an alias address                                                     |
| `POST /api/admin/users/:id/reset-2fa`                               | admin, step-up                     | Clear a person's two-step verification                                             |
| `POST /api/admin/users/:id/cancel-2fa-reset`                        | admin                              | Cancel the pending reset of an admin's two-step verification (any admin)           |
| `DELETE /api/admin/users/:id`                                       | admin, step-up                     | Delete the account and everything of it                                            |
| `GET`, `POST /api/admin/domains`, `DELETE …/:id`, `GET …/:id/check` | admin                              | Mail domains and the DNS check                                                     |
| `GET`, `PUT /api/admin/settings`                                    | admin (step-up to relax 2FA)       | The organisation's `require_2fa` and `default_language`                            |
| `GET /api/admin/health`                                             | admin                              | Secrets present (`ok`/`missing`, never values), rows still plaintext, pending mail |
| `GET /api/admin/audit`                                              | admin                              | The audit log, newest first                                                        |

Every admin answer also carries `success: true`; the shapes below leave it out. A route marked _step-up_ called without a second-factor check from the last five minutes answers `403 step_up_required`; an `:id` that is no account is `404 user_not_found`.

**User view** (the shape of every account in an admin answer): `id`, `email`, `display_name`, `role`, `status`, `last_login_at`, `created_at`, `two_factor`, `two_factor_reset_due_at`,
`has_keys`, `never_signed_in` (still on the temporary password, no keys), `temp_password_expires_at`, `aliases[]`. It never carries key material or a verifier.

- `GET /api/admin/users?q=&limit=&cursor=` → `{ "users": [UserView], "next_cursor": "<email>" | null, "total": n }`. `q` matches the address, the display name and the aliases
  (case-insensitive; `%` and `_` are ordinary characters); `limit` 1 to 100 (default 50); `cursor` is the last address of the previous page; sorted by address.
- `POST /api/admin/users` `{ "local_part", "domain", "display_name"?, "role"?: "member" | "admin", "auth", "kdf": 1 }` → `201 { "user": UserView }`. `domain` is a configured domain's
  id or name. Never an upsert: an address that exists (primary or alias, of anyone) is `409 address_taken`; an unknown domain is `400 domain_not_configured`. The account is active,
  has `must_change_password` and a 72-hour temporary password; an admin account also has `admin_password_upgrade_required`. Creating an admin alerts the other admins. Shares an
  hourly cap with reissue (60 per admin, `429 too_many_requests`).
- `PATCH /api/admin/users/:id` `{ "display_name"?, "role"?, "status"? }`: a role or status change ends the person's sessions, is audited, and needs the step-up. A promotion also
  sets the administrator-password gate and alerts the other admins. The **last active admin can never be demoted or disabled** (`409 last_admin`; the condition is part of the
  update, so two admins acting at once cannot both succeed) and nobody can disable themselves (`409 cannot_disable_self`).
- `POST /api/admin/users/:id/reissue` `{ "auth", "kdf": 1 }` → `{ "user": UserView }`. Only while the account is active, still on the temporary password an admin chose
  (`must_change_password`) and has **no keys**; for anyone else `409 reissue_refused` and nothing changes. The new verifier replaces the old at once (the previous temporary password
  stops working), sessions and open challenges end, the 72 hours restart, `temp_password_reissued` is audited with the acting admin and the other admins are alerted.
- `POST /api/admin/users/:id/aliases` `{ "address" }` → `201 { "aliases": [...] }`; `409 address_taken`, `400 invalid_address`, `400 domain_not_configured`, `400 too_many_aliases`
  (20 per account). `DELETE /api/admin/users/:id/aliases/:address` (URL-encoded) removes an alias, never a primary address: `404 alias_not_found`.
- `POST /api/admin/users/:id/reset-2fa` (send `{}`; a request with no body at all is `400 invalid_body`): a **member's** two-step verification is cleared at once (secret and recovery codes removed, sessions ended, the person
  notified, the other admins alerted) → `{ "applied": true }`. An **admin's** is scheduled in 24 hours unless that admin cancels it (`POST /api/auth/2fa/cancel-reset`) →
  `{ "applied": false, "due": <ms> }`; the cron applies it when due. Not on yourself (`409 cannot_reset_self`), `409 not_enabled` when there is nothing to reset, `409 conflict` when the account changed at the same moment (try again), at most three
  per person per hour (`429 reset_limit`).
- `POST /api/admin/users/:id/cancel-2fa-reset` (send `{}`): any admin cancels the pending reset of an admin's two-step verification, not only the admin it is about (cancelling only
  keeps 2FA on, so it needs no step-up). Audited as `2fa_reset_cancelled`, the other admins are alerted. `409 no_pending_reset` when none is pending, `404 user_not_found`. The 24 hour
  reset is applied only while the admin who asked is still an **active admin**: if that admin was disabled, demoted or deleted meanwhile, the request is cleared and nothing is applied.
- `DELETE /api/admin/users/:id` `{ "confirm": "<the person's address>" }` (step-up): the account is disabled and its sessions end first, its R2 objects are removed in bounded
  pages, then one batch audits, alerts the other admins and deletes the user, which cascades to every row of theirs. A large mailbox answers `202 { "done": false }`: send the same
  request again until `{ "done": true }`. `400 confirm_mismatch`, `409 cannot_delete_self`, `409 last_admin`. Creating the address again later makes a new person with an empty mailbox.
- `GET /api/admin/domains` → `{ "domains": [ { "id", "name", "created_at", "addresses_count" } ] }`; `POST /api/admin/domains` `{ "name" }` (`400 invalid_hostname`, `409 domain_exists`);
  `DELETE /api/admin/domains/:id` only when no address uses it (`409 domain_in_use`, `404 domain_not_found`).
- `GET /api/admin/domains/:id/check` → `{ "domain", "checked_at", "receiving": { "ready", "via_cloudflare", "state": "ready" | "other_provider" | "no_records" | "null_mx", "mx": [ { "priority", "host" } ],
"note" }, "sending": { "ready", "records": [ { "type", "name", "purpose": "bounce" | "spf" | "dkim" | "dmarc", "found", "required" } ], "note" } }`, from DNS-over-HTTPS lookups. A domain whose MX
  points to another provider is "receiving not ready" with those hosts listed. A domain that publishes the RFC 7505 null MX (`0 .`: it accepts no mail) is `null_mx`; that record
  is in `mx` with an empty `host`, and no note names it as a host. A failed lookup is `502 dns_lookup_failed`, never reported as ready or not ready.
- `GET /api/admin/settings` → `{ "settings": { "require_2fa": bool, "default_language": "…" } }`. `PUT /api/admin/settings` `{ "require_2fa"?, "default_language"?, "confirm"? }`: turning `require_2fa` **off** needs the
  step-up and the admin's own address as `confirm`, is audited and alerts the other admins; it never turns off anybody's enrolled 2FA. Turning it on gates every open session at
  once. `400 invalid_language`, `400 confirm_mismatch`, `403 step_up_required`.
- `GET /api/admin/health` → `{ "health": { "data_key": "ok" | "missing", "jwt_secret": "ok" | "missing", "setup_key": "ok" | "missing", "plaintext_rows": n, "pending_rows": n } }`.
- `GET /api/admin/audit?limit=&cursor=` → `{ "entries": [ { "id", "at", "actor_email", "action", "target", "detail" } ], "next_cursor": <id> | null }`. `action` is a code, for example `setup`, `break_glass`, `sign_in`, `sign_in_failed`, `user.create`, `user.rename`, `user.role_change`, `user.disable`, `user.enable`,
  `user.delete`, `user.first_sign_in`, `alias.add`, `alias.remove`, `domain.add`, `domain.remove`, `settings.require_2fa`, `settings.default_language`, `temp_password_reissued`,
  `temp_password_expired`, `2fa_reset`, `2fa_reset_requested`, `recovery_started`, `password_recovered`, `password_change`, `recovery_code_used`, `recovery_codes_regenerated`
  (sign-in entries older than the retention period are pruned by the cron); `detail` holds codes and values only.

## Errors

Every failure answers `{ "success": false, "error": "<English text>", "code": "<code>" }`. The codes are stable; the table is generated from `src/worker/errors.ts`, where each route
takes its code. Some routes replace the English text with a more specific reason (a field name, a limit) and keep the code and the status. The text of `invalid_language` lists the app's languages in the order of `LOCALES`, so it grows with the list; the table shows it for today's three.

| Code                              | Status | English text                                                                                                                              |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_request`                 | 400    | The request is not valid                                                                                                                  |
| `invalid_body`                    | 400    | A JSON object body with only the documented fields is required                                                                            |
| `unauthorized`                    | 401    | Unauthorized                                                                                                                              |
| `forbidden`                       | 403    | Forbidden                                                                                                                                 |
| `not_found`                       | 404    | Not found                                                                                                                                 |
| `conflict`                        | 409    | The request conflicts with the current state                                                                                              |
| `payload_too_large`               | 413    | The request is too large                                                                                                                  |
| `too_many_requests`               | 429    | Too many requests. Try again later.                                                                                                       |
| `server_error`                    | 500    | Something went wrong                                                                                                                      |
| `bad_gateway`                     | 502    | An upstream service did not answer                                                                                                        |
| `unavailable`                     | 503    | This is temporarily unavailable                                                                                                           |
| `not_configured`                  | 503    | Server is not configured                                                                                                                  |
| `admin_required`                  | 403    | Administrator access is required                                                                                                          |
| `wrong_credentials`               | 401    | Wrong email or password                                                                                                                   |
| `wrong_password`                  | 403    | The current password is wrong                                                                                                             |
| `wrong_code`                      | 401    | That code is wrong or was already used                                                                                                    |
| `wrong_setup_key`                 | 401    | Wrong setup key                                                                                                                           |
| `too_many_attempts`               | 429    | Too many attempts. Try again later.                                                                                                       |
| `too_many_lookups`                | 429    | Too many lookups. Try again later.                                                                                                        |
| `upgrade_required`                | 426    | Expected a WebSocket upgrade request                                                                                                      |
| `account_disabled`                | 403    | This account is disabled. Contact your administrator.                                                                                     |
| `challenge_invalid`               | 401    | This sign-in step has expired. Sign in again.                                                                                             |
| `two_factor_broken`               | 403    | Two-step verification is broken for this account. Ask an administrator to reset it.                                                       |
| `two_factor_required`             | 403    | Two-step verification is required and cannot be turned off                                                                                |
| `two_factor_enrollment_required`  | 403    | Set up two-step verification first                                                                                                        |
| `password_change_required`        | 403    | Choose a new password first                                                                                                               |
| `key_setup_required`              | 403    | Set up your encryption keys first                                                                                                         |
| `admin_password_upgrade_required` | 403    | Set a password of the administrator length first                                                                                          |
| `step_up_required`                | 403    | Confirm with a code from your authenticator first                                                                                         |
| `already_set_up`                  | 409    | Setup is already done                                                                                                                     |
| `not_enabled`                     | 409    | Two-step verification is not on                                                                                                           |
| `already_enabled`                 | 409    | Two-step verification is already on                                                                                                       |
| `not_started`                     | 409    | Two-step enrolment was not started                                                                                                        |
| `same_password`                   | 400    | Choose a password that is different from your current one                                                                                 |
| `keys_required`                   | 400    | The private key must be wrapped again under the new password                                                                              |
| `invalid_keys`                    | 400    | The keys are not valid                                                                                                                    |
| `keys_changed`                    | 409    | Your keys changed in the meantime. Reload and try again.                                                                                  |
| `key_in_use`                      | 409    | That key is already in use                                                                                                                |
| `not_applicable`                  | 409    | This does not apply to the account in its current state                                                                                   |
| `recovery_failed`                 | 401    | The recovery key or the authenticator code is not correct. If you use two-factor sign-in, enter the code from your authenticator app too. |
| `ticket_invalid`                  | 401    | This recovery has expired. Start again.                                                                                                   |
| `recovery_stale`                  | 409    | Your account changed in the meantime. Start again.                                                                                        |
| `message_not_found`               | 404    | Message not found                                                                                                                         |
| `draft_not_found`                 | 404    | Draft not found                                                                                                                           |
| `not_a_draft`                     | 409    | This id belongs to a message that is not a draft                                                                                          |
| `from_not_allowed`                | 403    | You can only send from your own address                                                                                                   |
| `invalid_address`                 | 400    | That is not an address this product can host                                                                                              |
| `invalid_hostname`                | 400    | That is not a valid domain name                                                                                                           |
| `domain_not_configured`           | 400    | Add the domain first                                                                                                                      |
| `domain_exists`                   | 409    | That domain is already added                                                                                                              |
| `domain_in_use`                   | 409    | Addresses still use this domain                                                                                                           |
| `domain_not_found`                | 404    | Domain not found                                                                                                                          |
| `address_taken`                   | 409    | That address is already in use                                                                                                            |
| `no_such_admin`                   | 404    | No administrator has that address                                                                                                         |
| `reissue_refused`                 | 409    | A new temporary password can only be issued while the person has not chosen their own password yet                                        |
| `user_not_found`                  | 404    | User not found                                                                                                                            |
| `alias_not_found`                 | 404    | Alias not found                                                                                                                           |
| `too_many_aliases`                | 400    | This account has the most aliases it can have                                                                                             |
| `cannot_disable_self`             | 409    | You cannot disable your own account                                                                                                       |
| `cannot_delete_self`              | 409    | You cannot delete your own account                                                                                                        |
| `cannot_reset_self`               | 409    | You cannot reset your own two-step verification                                                                                           |
| `last_admin`                      | 409    | There must always be one active administrator                                                                                             |
| `confirm_mismatch`                | 400    | The confirmation does not match                                                                                                           |
| `reset_limit`                     | 429    | Too many resets for this person. Try again later.                                                                                         |
| `notice_locked`                   | 403    | This notice cannot be dismissed yet                                                                                                       |
| `notice_not_found`                | 404    | Notice not found                                                                                                                          |
| `no_pending_reset`                | 409    | No reset of your two-step verification is pending                                                                                         |
| `dns_lookup_failed`               | 502    | The DNS lookup failed                                                                                                                     |
| `invalid_language`                | 400    | language must be en, vi or zh-CN                                                                                                          |
| `key_changed`                     | 409    | A recipient's key changed. Their current keys are in the answer: encrypt the message again.                                               |
| `too_many_recipients`             | 400    | A message can have at most 50 different recipients                                                                                        |
| `recipient_not_internal`          | 400    | Some recipients are not on this deployment: send the message the normal way                                                               |
| `copies_mismatch`                 | 400    | There must be exactly one encrypted copy for each recipient                                                                               |
| `id_in_use`                       | 409    | One of the ids is already in use                                                                                                          |
