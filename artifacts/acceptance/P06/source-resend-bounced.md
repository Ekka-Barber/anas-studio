# Source excerpt: Resend `email.bounced` webhook
Fetched 2026-09-26 from https://resend.com/docs/webhooks/emails/bounced.md
(curated excerpt replaces the deleted page-fetch caches; see the L10 note.)

Auditor note (2026-09-26, cloud audit D14): this is a paraphrase, not a
verbatim copy — the example payload's `created_at` (2026-11-22) postdates the
fetch date, so it was edited. The page could not be re-fetched from the cloud
session (resend.com is blocked by its egress policy). The suppression rule
does not depend on the example: only an explicit `Temporary` (or
soft/transient) bounce skips suppression, so a wrong vocabulary can only
over-suppress, never let a hard bounce through.

Event triggered whenever the recipient's mail server **permanently rejected
the email**.

`data` fields: broadcast_id, created_at, email_id, message_id, from,
**to (array of recipient addresses)**, subject, template_id, tags, and
`bounce`: { message, subType, type }.

- `bounce.type` — **"Permanent" / "Temporary"**
- `bounce.subType` — e.g. "Suppressed", "MessageRejected"
- `bounce.message` — SMTP diagnostic string

Example payload (abridged):
```json
{ "type": "email.bounced", "created_at": "2026-11-22T23:41:12.126Z",
  "data": { "email_id": "56761188-…", "to": ["delivered@resend.dev"],
    "bounce": { "message": "…hard bounces.", "subType": "Suppressed",
      "type": "Permanent" } } }
```
