# Mail features

How mail behaves: sending and replying, lists and search, drafts and snooze. The routes behind these are in the [API reference](api.md).

- [Sending](#sending)
- [Lists, threads, search and stats](#lists-threads-search-and-stats)
- [Drafts](#drafts)
- [Snooze](#snooze)

## Sending

**Sender identity.** Open **Settings** in the app to set your display name, signature and default sender address (stored in D1). A message is sent from, in this
order: the `from` of the request, the saved default address, the `DEFAULT_FROM` var (`wrangler.jsonc`). If none is set the send is rejected with
`No sender address configured`. The display name appears in the `From` header (`"Your Name" <you@yourdomain.com>`). The accepted values are listed under
[Settings](api.md#settings).

**Delivery.** Mail goes out through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) using the `send_email` binding (`SEND_EMAIL` in
`wrangler.jsonc`) and its structured `send()` API. Cloudflare builds the MIME message, adds the `Date`, `Message-ID` and DKIM signature, and returns the
`Message-ID`. That id is stored with the sent mail, so a reply from the recipient lands in the same thread. Replying sets `In-Reply-To` and `References`.

A failed send is a failed send:

- If the binding is missing or Cloudflare refuses the message, `POST /api/messages/send` answers `502` with the reason and nothing is saved in Sent.
- A request that is invalid on its face is rejected with `400` before anything is built or sent: an address that contains a comma, quote or whitespace, a line
  break in the subject, sender name or an attachment's name or type, an attachment that is not valid base64, more than 32 attachments, a `draft_id` that is not
  a lowercase UUID, an `in_reply_to` or `references` entry that is not a `<…>` Message-ID of at most 998 bytes, or more than 25 MiB.
- The archive copy of the mail (`.eml` in R2) is built before delivery, so a problem with it can never surface after the mail is out.
- If the mail is delivered but saving the Sent copy then fails, the answer is `500` with `The email was sent but could not be saved to Sent`. The mail is out:
  do not send it again.

**Replies, attachments and drafts.** A reply (`in_reply_to` = the Message-ID of the mail you answer) sends `In-Reply-To` and a `References` header made of the
answered mail's own stored chain plus its Message-ID, oldest first and without duplicates. If that mail is not stored, the `references` list of the request
stands in for its chain. When the chain would not fit in 2048 bytes, the oldest ids are dropped, except the first (the thread root) and the last (the mail you
answer). The same value is stored on the Sent row (`references_header`, `in_reply_to`) and in its archive copy, and the reply joins the answered mail's thread.

The attachments of a sent mail are stored like inbound ones (R2 `attachments/<message id>/…` plus `attachments` rows), so Sent lists them and
`GET /api/attachments/:id` serves them. The optional `draft_id` is the id of the draft the mail was written in: once the mail is delivered and stored in Sent,
that row is deleted if, and only if, it is in the `drafts` folder. Any other id is ignored, and a failed send keeps the draft.

### Requirements for real delivery

Email Sending is in beta.

1. Your domain uses Cloudflare DNS and is onboarded under **Compute → Email Service → Email Sending → Onboard Domain**. Cloudflare adds MX, SPF and DKIM records on
   the `cf-bounce` subdomain and a DMARC record on `_dmarc.<your domain>`; propagation usually takes 5-15 minutes. A name can carry only one DMARC record and one
   SPF record: see [Deployment](deployment.md#send-mail-from-your-domain) for a domain whose mail is hosted elsewhere.
2. The sender address must belong to an onboarded domain (otherwise `E_SENDER_NOT_VERIFIED` / `E_SENDER_DOMAIN_NOT_AVAILABLE`).
3. Before a domain is onboarded you can only send to verified destination addresses of your account (Email Routing → Destination addresses). Once it is, any
   recipient works, but sending to arbitrary recipients needs the Workers Paid plan.
4. Cloudflare's limits: 50 recipients (to + cc + bcc) per message, 25 MiB per message including attachments, 32 attachments, and a daily quota that starts low
   on new accounts ([limits](https://developers.cloudflare.com/email-service/platform/limits/)).

### Sending while developing

`wrangler dev` only simulates the binding: the message is logged (`send_email binding called with MessageBuilder`), its text, HTML and attachments are written
under `.wrangler/tmp/email/`, and nothing leaves your machine. The headers (`In-Reply-To`, `References`) and the attachment list of each simulated send are readable at
`http://localhost:8787/cdn-cgi/explorer/api/local/email/sending`. Add `"remote": true` to the `send_email` entry in `wrangler.jsonc` to send real mail from
`wrangler dev` (use test recipients).

## Lists, threads, search and stats

- **Order.** `GET /api/messages?folder=…` returns the newest mail first by its date (`created_at`). Mails with exactly the same date keep their arrival order (the
  later arrival first), so paging never skips or repeats a mail. The date of an inbound mail is its `Date` header, but a missing or unparsable `Date`, or one more
  than 5 minutes in the future, is replaced by the arrival time, so a wrong clock cannot pin a mail to the top. Two folders sort differently: `drafts` shows the
  most recently saved first, `snoozed` the one that returns soonest first.
- **Threads.** Every stored mail keeps its `In-Reply-To` and `References` headers (`in_reply_to`, `references_header`; a `References` chain longer than 4000
  characters is cut after its last complete id). A mail that answers a stored mail joins that mail's thread (`thread_id`), including when it answers one of your own
  sent replies. The server keeps the thread; the interface lists single mails and has no conversation view yet.
- **Stats.** `GET /api/stats` answers the `{ total, unread }` of each folder and of the starred view; a draft is never unread, so `drafts.unread` is always `0`.
- **Search.** `GET /api/messages?q=…` finds the text in the subject, sender, recipients and snippet of the folder being listed, ignoring upper/lower case for ASCII
  letters; `%`, `_` and `\` are ordinary characters. The text is cut to 200 characters. The test is `instr()`, not `LIKE`, because D1 refuses `LIKE` patterns over
  50 bytes (a long search would be an HTTP 500). The label filter (`folder=label:<name>`) uses the same test, so a 30-character CJK label (90 bytes) works.
- **Opening a mail.** `GET /api/messages/:id` marks the mail read. `GET /api/messages/:id?peek=1` returns the same JSON without marking it: the client uses it to
  refresh a mail that is already open, so a mail the cron has just woken stays unread until it is really opened.
- **Batch actions.** `count` in the answer is the number of ids sent, except for `snooze`, where it is the number of mails really snoozed. `snooze` leaves drafts
  and Sent mail alone, and `move` to `snoozed` is refused with `400` (use `snooze`). Whatever takes a mail out of Snoozed (move, restore, archive, trash) clears its
  `snoozed_until`.
- **Mark all as read.** `POST /api/messages/read-all` with `{ "folder": "inbox", "q": "…" }` (`q` optional) marks every unread mail of that folder view as read,
  also the ones beyond the pages the client has loaded, using the same folder, label and search rules as the list.
- **Inbound.** Everything Email Routing hands to the Worker lands in the Inbox. There is no spam filter: the Spam folder only holds mail you moved there.

## Drafts

A draft is an ordinary row in the `drafts` folder. While you write, the compose window saves it by itself about 1.5 seconds after your last change (header text:
`Saving…` / `Draft saved`); close it and the draft stays in **Drafts**, click it to continue. Sending removes the draft, but only after the mail was really
delivered and stored in Sent: a failed send keeps it. Drafts are never unread and never notify.

- **Attachments are not saved** in drafts (the compose window says so when you attach a file). Re-attach them after reopening a draft.
- A draft that answers a mail remembers it (`in_reply_to`), so the reply lands in the same thread when it is sent.
- `:id` is a UUID made by the browser, so the first save and every later save are the same `PUT /api/drafts/:id`. The body limits are in the
  [API reference](api.md#drafts).
- A `PUT` never overwrites a real mail: if the id already belongs to a message in any other folder the answer is `409`.

## Snooze

Snoozing hides a mail until a chosen time, then brings it back. `POST /api/messages/batch` with `{ "action": "snooze", "message_ids": [...], "until": <epoch ms> }`
moves the mails to the `snoozed` folder; `until` must be between 1 minute and 366 days from now. The **Snoozed** folder lists the soonest first. Moving a snoozed
mail anywhere else (archive, trash, restore…) cancels its snooze.

A Cron Trigger (`triggers.crons = ["* * * * *"]` in `wrangler.jsonc`, every minute) runs the Worker's `scheduled()` handler, which does one atomic
`UPDATE … RETURNING` on every snoozed mail whose time has come. Those mails:

- return to the **Inbox, unread**, with the **original date** they had: a mail comes back in place and is not moved to the top of the list;
- are announced once: open tabs get a single `mail.changed` event, and installed devices get a Web Push notification for each of up to 3 returned mails (sender,
  subject; tapping it opens the mail), plus one summary notification (`N snoozed messages are back`) when more than 3 returned at once.

Because the release is a single statement, two cron runs that overlap cannot release or notify about the same mail twice. A mail is back at the first run after its
time, so at most about a minute late. If a run fails (logged without any mail content) nothing is lost: the mail stays snoozed and the next minute retries. Push and
realtime are best effort and never block the release.

**Plan note.** Cron Triggers are available on the Workers Free plan (5 per account; this app uses 1), and `wrangler deploy` registers the schedule. A new Cron Trigger
can take up to 15 minutes to propagate. If you would rather have fewer runs, change the expression (for example `*/5 * * * *`); snoozed mail then returns up to that
much later. To try the cron path locally, see [Development](development.md#testing-the-snooze-cron).
