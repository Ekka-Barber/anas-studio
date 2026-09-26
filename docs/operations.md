# Operations: contact inbox and email delivery (P06)

How a contact message becomes an inbox row and (eventually) a delivered
email, and what to do when something gets stuck. The SQL contract lives in
`supabase/migrations/20260926120000_contacts_and_email.sql`; the dispatcher
is `src/lib/outbox.ts`, run by the Worker's Cron Trigger through
`POST /api/jobs/run`.

## The owner's daily routine (admin screens)

Start at `/admin` (the owner home). Every number there is a live query — a
failed one shows «تعذّر التحميل», never 0:

1. **الوارد** — how many contact messages are still `new`. Open
   `/admin/inbox`: newest first, filter by status, 30 per page with
   «المزيد». Opening a `new` message marks it `read` automatically. Reply by
   the `mailto:` link (the subject is preset), then set the status, add
   notes, and «تعيين لي» when the message is yours. Everything saves through
   one «حفظ».
2. **البريد** — the `outbox_attention()` rows that need a person
   (`/admin/email`). «إعادة الإرسال» replays an exhausted row. An uncertain
   row past the 23-hour idempotency window opens a confirmation dialog,
   because it may already have been delivered. A suppressed recipient is
   refused — «المستلم محظور بعد ارتداد أو شكوى» — and only a deliberate
   manual database action re-allows it. Remember: provider acceptance is not
   delivery.
3. **مهام التشغيل** — the latest run of each job; a job never run shows
   «لم يعمل بعد».
4. **الإحصاءات** (owner only) — see below.

Operations members see the same inbox and email screens; editors see neither
(RLS returns nothing, the email RPC is refused).

## The contact flow

1. The public form posts JSON (≤ 8 KiB, same origin) to `POST /api/contact`:
   `name`, `email`, `message`, `submissionKey` (a fresh browser uuid),
   `turnstileToken`, and the hidden `website` honeypot.
2. The route verifies the Turnstile token (action `contact`, hostname from
   `SITE_URL`) and hashes the caller — sha256 of
   `${TOKEN_HASH_PEPPER}:${utc-date}:${cf-connecting-ip}` — so no raw IP is
   ever stored or logged. Under `next dev` (no Cloudflare header) the IP is
   the literal `local`.
3. `contact_submit(ip_hash, …)` commits, in one transaction: the throttle
   checks, the message row, and one `contact_notice` outbox row per **active
   owner or operations member**. Editors and inactive staff get no notice.
4. The reply is the same whether the message was just stored or the same
   `submissionKey` was already stored (`duplicate`): `201 {received: true}`.
   A bot that fills the honeypot gets the same 201 with nothing stored.

Because the durable write happens before any provider is called, **the inbox
survives an email outage**: messages keep arriving and the notices simply
wait in the outbox (proven by `tests/e2e/owner-operations.spec.ts`).

### Throttles

Fixed windows, enforced inside `contact_submit` (SQLSTATE 54000 → HTTP 429
«أرسلت رسائل كثيرة؛ حاول لاحقًا.»):

| Bucket | Limit | Key |
| --- | --- | --- |
| `contact:ip` | 5 per hour | salted daily IP hash |
| `contact:email` | 3 per hour | sha256 of the sender email |
| `contact:all` | 200 per day | everyone |

pg_cron purges the rate-limit windows nightly (`rate-limits-purge`).

**Residual abuse risk (accepted):** the `contact:all` cap is global, so an
attacker who passes Turnstile can spend the whole 200/day budget (40 rotating
IPs at 5/hour each) and lock the form for everyone else for the rest of the
UTC day. Accepted because nothing is lost — messages already stored stay in
the inbox, real visitors still have the published email address, and the
window resets at the next UTC midnight. Manual mitigation when it happens:
look at `public.contacts` for the burst, then delete the day's `contact:all`
row from `finance.rate_limits` (its `key_hash` is 64 zeros) — the same
deliberate manual-database-action standard as un-suppressing a recipient.

## The outbox

One row per message (`finance.email_outbox`). Priorities: **0** sign-in
codes and receipts, **1** staff notices, **2** availability notices (P07).

```
pending ──claim──▶ sending ──accepted──▶ sent ──webhook──▶ delivered
   ▲                  │                                 delayed / bounced /
   │  retry (backoff) ├─▶ retry → pending …             complained / failed
   │                  ├─▶ permanent → exhausted
   └─ replay (owner)  └─▶ uncertain
suppressed (a suppressed recipient is never claimed; set by bounce,
                              complaint, provider suppression, or manually)
```

- **Claim** (`outbox_claim`): up to 10 rows per run, most important first,
  each leased for 120 s. The dispatcher claims **one row at a time**, so every
  send is preceded by its own claim — and its own quota recount. An expired
  lease never returns the row to `pending` — it becomes `uncertain`, because
  the send may have left.
- **Bounded retries**: a row is claimed only while `attempts < max_attempts`
  (default 8), and the counter is incremented at claim time — so every path,
  including `uncertain` ones, is bounded. Reaching the cap makes the row
  `exhausted` (terminal) wherever it happens — the claim's expired-lease flip
  or `outbox_result` — and each such transition is written to `audit_events`
  as `email.exhausted`.
- **Retry backoff**: `next_at = now() + 2^attempts` minutes
  (2, 4, 8, 16 …). Every path that lands in `uncertain` (send timeout,
  unknown reply, expired lease, a pre-send dispatch failure) gets the same
  exponential backoff capped at 60 minutes, so a stuck row converges to
  `exhausted` instead of being retried every minute for 23 hours.
- **Uncertain sends** are retried only inside 23 hours of the first attempt:
  the row's `idempotency_key` is sent as Resend's `Idempotency-Key`, which
  Resend keeps for 24 hours (resend.com/docs/dashboard/emails/
  idempotency-keys), so a retry within that window cannot send twice. After
  23 hours (one hour of margin) the row waits for a person.
- **Replay** (`outbox_replay`, owner or operations): queues an `exhausted`
  or `uncertain` row again. A suppressed recipient is refused. An uncertain
  row whose key has expired may already have been delivered, so replaying it
  requires `accept_duplicate_risk` and rotates the idempotency key (the
  dedupe key — the business identity — never changes). The action is
  written to `audit_events` as `email.replay`.
- **Attention** (`outbox_attention`, owner or operations): rows that need a
  person — `exhausted`, `uncertain`, `suppressed`, or a terminal delivery
  event — with `replay_needs_confirmation` set for uncertain rows past the
  23-hour window.

### Quota

`src/lib/outbox.ts` claims with `DAILY_QUOTA = 100`, `RESERVE = 20` and
`MONTHLY_QUOTA = 3000`:

- 100/day and 3,000/month are Resend's **free plan** quotas — "daily email
  quota of 100 emails/day and 3,000 emails/month", a UTC calendar day
  (resetting at midnight UTC) and a UTC calendar month
  (resend.com/docs/knowledge-base/account-quotas-and-limits,
  fetched 2026-09-26). Raise the constants when the plan changes.
- Both caps are enforced by the outbox and checked **immediately before each
  send**: the dispatcher claims one row at a time and every claim recounts
  the day and the month, so one run can never overshoot either cap. When a
  cap is hit the run stops cleanly — rows never claimed simply stay
  `pending` for the next run.
- Once 80 sends (quota − reserve) are used today, priority 2 (availability
  notices) waits so sign-in codes, receipts and staff notices still go; at
  100 nothing is claimed until midnight UTC.

**Sign-in codes are not covered by the reserve (residual risk):** sign-in
emails travel through Supabase Auth's SMTP (I28), not through the outbox, but
the same Resend account absorbs them — and the outbox's sent-today count sees
only outbox rows. The 20-send reserve must therefore absorb auth traffic too:
keep sign-in volume low, and raise `RESERVE` in `src/lib/outbox.ts` if auth
traffic grows. If Supabase Auth ever changes its sending path (a different
provider or subaccount), this shared-limit assumption breaks silently —
re-check I28's mail routing then.

Exceeding a quota at the provider returns 429, which the dispatcher
classifies as `retry`.

### Suppression

A verified bounce whose type is missing or **hard/permanent**
(`email.bounced`, the type read from the event's evidence — a soft/transient
bounce only records the event, because the address may deliver later), a
complaint (`email.complained`) or a provider suppression
(`email.suppressed`) adds the recipient's hash to
`finance.email_suppressions`. Every sender consults it: a suppressed
recipient is never claimed again, and replaying a suppressed row is refused.
A later `delivered` never clears a suppression, and never overwrites a
bounce or complaint on a row. Re-allowing a recipient is a deliberate
manual database action, not an automatic one.

**Supabase Auth mail goes through Resend SMTP once hosted (I28), so
Resend's own suppression applies to sign-in codes too** — a bounced address
stops receiving codes from both paths.

## Delivery events

Resend webhooks are Svix-signed (`svix-id`, `svix-timestamp`,
`svix-signature`). `POST /api/email/resend/webhook` verifies the HMAC
against the **raw** body (≤ 256 KiB) with a 5-minute timestamp tolerance,
then records the event through `email_event_record`, which deduplicates on
the provider's event id (`svix-id`) — a redelivered event is recorded once.

Event handling (`email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`,
`email.failed`, `email.suppressed`; anything else is acknowledged and
ignored): hard/permanent or untyped bounces, complaints and suppressions
suppress the recipient; a soft/transient bounce records the event (and sets
the row's `delivery`) without suppressing;
`delivered`/`delayed`/`bounced`/`complained`/`failed` set the row's
`delivery`. **Provider acceptance is not delivery**: a `sent` row keeps
`delivery` null until an event arrives.

Webhook setup (P11, launch): in the Resend dashboard
(`https://resend.com/webhooks`) add an endpoint for
`https://anas.studio/api/email/resend/webhook` with the delivery/bounce/
complaint events, and store its signing secret as the Worker secret
`RESEND_WEBHOOK_SECRET` (`wrangler secret put RESEND_WEBHOOK_SECRET`).
With the secret unset the endpoint answers 404 — it does not exist.

## The cron trigger

`wrangler.jsonc` runs one Worker Cron Trigger every minute;
`worker-entry.ts`'s `scheduled` handler turns it into one authenticated
`POST /api/jobs/run` (`Authorization: Bearer ${JOBS_SECRET}`, a Worker
secret). The minute cadence is deliberate — the outbox's own `next_at`
backoff and quota checks decide whether anything is actually sent, so the
frequent trigger only keeps dispatch latency small. Each run is recorded in
`finance.job_runs` (visible to owner/operations through `job_runs_latest`,
purged after 30 days). With `JOBS_SECRET` unset the trigger does nothing
and the endpoint answers 404.

### Uncertain-send reconciliation, in one paragraph

An `uncertain` row means the HTTP request may or may not have reached
Resend. Inside 23 hours the dispatcher retries it with the same idempotency
key, which Resend answers with the original result (or 409
`concurrent_idempotent_requests`, itself a retry). Past 23 hours the key is
gone, so the row appears in `outbox_attention` with
`replay_needs_confirmation`; an owner checks Resend's activity
(`https://resend.com/emails`) for the recipient, then either lets it go or
replays with `accept_duplicate_risk`.

## Statistics: sources and the E11 gate

`/admin/stats` (owner only) reads `GET /api/admin/stats`, which verifies the
staff token and role server-side and caches one answer per isolate for 5
minutes (the cache is read only after authorization; the reply is
`cache-control: private, no-store` and carries no PII).

- **Visits and top pages** come from the Cloudflare GraphQL Analytics API
  (`httpRequestsAdaptiveGroups`, `sum.visits` and path counts, filtered to
  `requestSource: "eyeball"` and the production host, a 7-day UTC window).
  A sampled answer (`avg.sampleInterval` above 1) is refused, not estimated.
  It needs the Worker secrets `ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID`
  (set both before the launch build); with either missing the screen says
  «غير متاح — غير مُعدّة بعد», never 0. **The live account proof is gate
  E11 (P11)**: until the real zone is queried against the live account, the
  numbers are proven only against fixtures, and the schema/dimension names
  are re-checked then.
- **Commerce** says «غير مُعدّ بعد — يبدأ مع المتجر» until the order and
  payment tables exist (P07/P08); the exact paid/refund/net/customer SQL
  counts land with them (`// P08:` in `src/lib/stats.ts`). No invented
  zeros.
