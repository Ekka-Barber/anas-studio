# Operations: contact messages and email delivery (P06)

How a contact message reaches the owner's mailbox, and what to do when an
automatic email gets stuck. There is no admin inbox (D31): the owner reads
and answers contact messages in his own mailbox. The SQL contract lives in
`supabase/migrations/20260926120000_contacts_and_email.sql`; the dispatcher
is `supabase/functions/_shared/outbox.ts`, the `outbox` Edge Function, which
pg_cron calls while an email is due (D32).

## The owner's routine

**Contact messages: in his own mailbox.** Each message arrives as an email
«رسالة جديدة من نموذج التواصل» with the full text. Pressing Reply answers
the visitor directly (the notice carries Reply-To set to the visitor's
address). The notice goes to the sign-in address of every active owner and
operations member; for Anas that is his Gmail, or `help@anas.studio`, which
Cloudflare Email Routing forwards to it.

**The admin, only when the owner home flags something.** Start at `/admin`
(the owner home). Every number there is a live query — a failed one shows
«تعذّر التحميل», never 0:

1. **البريد** — the `outbox_attention()` rows that need a person
   (`/admin/email`). «إعادة الإرسال» replays an exhausted row. An uncertain
   row past the 23-hour idempotency window opens a confirmation dialog,
   because it may already have been delivered. A suppressed recipient is
   refused — «المستلم محظور بعد ارتداد أو شكوى» — and only a deliberate
   manual database action re-allows it. Remember: provider acceptance is not
   delivery.
2. **مهام التشغيل** — the latest run of each job; a job never run shows
   «لم يعمل بعد». «إرسال البريد» is the outbox, «بناء الموقع» the Pages
   deploy hook after a publish, «تنظيف الوسائط» the daily media sweep. A
   «فاشل» on «بناء الموقع» after five tries means the hook itself is broken
   (see "Site rebuilds" below).
3. **الإحصاءات** (owner only) — see below.

Operations members see the same email screen; editors do not (the email RPC
is refused). No API role can read `public.contacts`, the owner included.

## The contact flow

1. The public form posts JSON (≤ 8 KiB) to the `contact` Edge Function
   (`<supabase>/functions/v1/contact`), which answers only the `SITE_URL`
   origin (CORS; any other `Origin` is 403):
   `name`, `email`, `message`, `submissionKey` (a fresh browser uuid),
   `turnstileToken`, and the hidden `website` honeypot.
2. The function verifies the Turnstile token (action `contact`, hostname from
   `SITE_URL`) and hashes the caller — sha256 of
   `${TOKEN_HASH_PEPPER}:${utc-date}:${ip}`, where the IP is
   `cf-connecting-ip` (Cloudflare, in front of hosted Supabase, sets it and
   replaces any client value), else the LAST `x-forwarded-for` hop (earlier
   hops are client-chosen) — so no raw IP is ever stored or logged. With
   neither header the IP is the literal `local`; which headers the hosted
   project delivers is checked at P11 (I32).
3. `contact_submit(ip_hash, …)` commits, in one transaction: the throttle
   checks, the message row, and one `contact_notice` outbox row per **active
   owner or operations member**. Editors and inactive staff get no notice.
4. The reply is the same whether the message was just stored or the same
   `submissionKey` was already stored (`duplicate`): `201 {received: true}`.
   A bot that fills the honeypot gets the same 201 with nothing stored.

Because the durable write happens before any provider is called, **a
message survives an email outage**: messages keep arriving and the notices
simply wait in the outbox until a jobs run can send them (proven by
`tests/e2e/owner-operations.spec.ts`).

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
UTC day. Accepted because nothing is lost — messages already stored still
reach the owner's mailbox, real visitors still have the published email
address (`help@anas.studio`), and the
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

`supabase/functions/_shared/outbox.ts` claims with `DAILY_QUOTA = 100`, `RESERVE = 20` and
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
keep sign-in volume low, and raise `RESERVE` in `supabase/functions/_shared/outbox.ts` if auth
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
`svix-signature`). The `resend-webhook` Edge Function verifies the HMAC
against the **raw** body (≤ 256 KiB) with a 5-minute timestamp tolerance,
then records the event through `email_event_record`, which deduplicates on
the provider's event id (`svix-id`) — a redelivered event is recorded once.

Event handling (`email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.bounced`, `email.complained`,
`email.failed`, `email.suppressed`; anything else is acknowledged and
ignored): complaints, suppressions and every bounce except a `Temporary`
(or soft/transient) one suppress the recipient — Resend documents
`bounce.type` as `Permanent`/`Temporary` (`artifacts/acceptance/P06/
source-resend-bounced.md`), so a missing or undocumented type suppresses
conservatively; a temporary bounce records the event (and sets the row's
`delivery`) without suppressing;
`delivered`/`delayed`/`bounced`/`complained`/`failed` set the row's
`delivery`. **Provider acceptance is not delivery**: a `sent` row keeps
`delivery` null until an event arrives.

Responses: no secret → 404; a body over 256 KiB → 413 (before the
signature, so only junk can hit it); a missing or bad signature → 401. A
signed event that is over 32 KiB, not JSON or an unexpected shape is
recorded as malformed (salvaged fields, the body size, never the body) and
answered 200, because redelivering the same bytes can never fix it. Any
database failure — on either path — is 503, which Svix redelivers; the
`svix-id` dedupe makes the redelivery safe, and every value passed to the
database (the event time included) is bounded first, so a 503 is never
caused by the event's own data.

Webhook setup (P11, launch): in the Resend dashboard
(`https://resend.com/webhooks`) add an endpoint for
`https://<project-ref>.supabase.co/functions/v1/resend-webhook` with the
delivery/bounce/complaint events, and store its signing secret as the
function secret `RESEND_WEBHOOK_SECRET` (`supabase secrets set`). With the
secret unset the endpoint answers 404 — it does not exist.

## The outbox schedule

pg_cron runs `outbox_kick()` every minute (D32). It calls the `outbox` Edge
Function (`Authorization: Bearer <jobs_secret>`, with `functions_url` and
`jobs_secret` read from Vault) **only while a row is due**, so an idle site
makes no calls. Due means whatever `finance.outbox_due_since()` (I35) finds:
a `pending` row whose `next_at` has passed and that is still under its
attempt cap; an `uncertain` row under the cap whose `next_at` has passed and
whose first attempt is inside the 23-hour idempotency window; or a `sending`
row whose lease expired (the claim's expiry step must still flip it). An
`uncertain` row past 23 hours waits for a person on البريد and no longer
wakes the function. The minute cadence is deliberate — the outbox's own
`next_at` backoff and quota checks decide whether anything is actually sent,
so the frequent check only keeps dispatch latency small. Each run is recorded
in `finance.job_runs` (visible to owner/operations through
`job_runs_latest`, purged after 30 days). With `JOBS_SECRET` unset the
function answers 404; with the Vault values unset (the local stack)
`outbox_kick()` does nothing.

The owner home therefore does not judge the email job by its last run's age
(I35): the job warns only when a row has been due for more than 10 minutes
**and** no run finished inside those 10 minutes — «بريد ينتظر الإرسال منذ
أكثر من 10 دقائق. تأكد من الجدولة.» — so a quiet site whose last run is
hours old still shows «سليم».

Hosted setup (P11): `supabase secrets set JOBS_SECRET=…`, then in the SQL
editor `select vault.create_secret('<the same value>', 'jobs_secret')` and
`select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'functions_url')`.
The same Vault holds `pages_deploy_hook`, the Cloudflare Pages deploy hook
that `site_build_trigger()` calls after a publish.

### Site rebuilds (I34)

`site_build_trigger()` runs every minute and calls the deploy hook at most
once per two minutes after a publish. It keeps the id `net.http_post`
returns and, on the next run, reads pg_net's answer (`net._http_response`,
kept about six hours). Each answered call is one `site_build` run in
`finance.job_runs`: `ok` for a 2xx, `failed` for any other status, a
timeout, or no answer after ten minutes (the detail carries `httpStatus`,
`timedOut`, `error`, `noAnswer` and `attempt`). A failed call is re-armed
and tried again the next minute, up to five times in a row; after the fifth
the owner home shows «بناء الموقع: فاشل» and the next publish tries once
more. A 2xx only means Cloudflare accepted the hook: a build that then
breaks is visible only in the Pages dashboard, so check it after the first
publishes.

### Media sweep (I29)

pg_cron runs `media_sweep_kick()` at 03:41 UTC, which calls the `outbox`
function with `{"job": "media_sweep"}`. The job removes, through the Storage
API, every `media-private` object under `quarantine/` older than a day (parts
of uploads that never completed; a completed or failed upload removes its
own), then deletes `media_upload_tickets` rows older than a day (tickets
expire after five minutes). Storage refuses direct deletes from
`storage.objects`, and one would orphan the stored bytes, so the removal
never runs in SQL. The run is recorded as `media_sweep`; the owner home
flags it when the last run is over 26 hours old. Public derivatives that
outlive a deleted media row (I34's residual) are not swept yet.

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

`/admin/stats` (owner only) calls the `admin` Edge Function's `stats`
action, which verifies the staff token and role and caches one answer per
isolate for 5 minutes (the cache is read only after authorization; the reply
is `cache-control: no-store` and carries no PII).

- **Visits and top pages** come from the Cloudflare GraphQL Analytics API
  (`httpRequestsAdaptiveGroups`, `sum.visits` and path counts, filtered to
  `requestSource: "eyeball"` and the production host, a 7-day UTC window).
  A sampled answer (`avg.sampleInterval` above 1) is refused, not estimated.
  It needs the function secrets `ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID`; with either missing the screen says
  «غير متاح — غير مُعدّة بعد», never 0. **The live account proof is gate
  E11 (P11)**: until the real zone is queried against the live account, the
  numbers are proven only against fixtures, and the schema/dimension names
  are re-checked then.
- **Commerce** says «غير مُعدّ بعد — يبدأ مع المتجر» until the order and
  payment tables exist (P07/P08); the exact paid/refund/net/customer SQL
  counts land with them (`// P08:` in `supabase/functions/_shared/stats.ts`). No invented
  zeros.

## Commerce settings

`/admin/settings` carries an «إعدادات المتجر» section (owner only): the
seller's legal name, address and freelance-certificate registration, the
currency (SAR, fixed, read-only) and the approved policy revisions
(read-only; «لم تُعتمد بعد» until P07 records them). `checkout_enabled`
is `false` behind a check constraint the migration owns: P08 lifts it with
the verified payment gateway, and until then the screen says payment is
closed. There is no tax field anywhere (D34): prices are what the buyer
pays.

Reading goes through `commerce_settings_get()` (granted to `authenticated`;
the owner role is rechecked inside). Saving goes through the `admin` Edge
Function's `commerce-settings-save` action: an active owner at aal2 with a
TOTP verification from the last five minutes, then `commerce_settings_save()`
as `service_role`. The browser sends the row version it read; if another
session saved first, SQL raises 40001 and the function answers 409
(«تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.»). Every save appends
one `commerce.settings` audit event naming the changed fields, never their
values. No API role has any grant on `finance.commerce_settings`.

## Backups (D35)

Anas runs backups himself, on his own machine, whenever he chooses (the habit:
after every editing session). One command writes one encrypted file; a second
command proves the file restores. There is no CI workflow, nothing is copied
off the machine by us, and only Anas holds the passphrase.

### What a file holds

- `roles.sql`, `schema.sql`, `data.sql`, `history_schema.sql`,
  `history_data.sql` — the five dumps from Supabase's backup/restore guide
  (supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore):
  roles, schema, data (`--use-copy --data-only`, excluding
  `storage.buckets_vectors` and `storage.vector_indexes`), and the
  `supabase_migrations` history (schema, then data).
- `storage/media-private/...` and `storage/media-public/...` — every object
  of both Storage buckets, with the `storage.objects` rows (so metadata and
  content types) inside `data.sql`.
- `manifest.json` — format version, creation time, source (`linked` or
  `local`) and every file's size and sha256.

What a file deliberately does **not** hold: Vault secrets (`functions_url`,
`jobs_secret`, `pages_deploy_hook`), Edge Function secrets (`supabase
secrets`), Auth settings and email templates, the project's encryption root
key, and the database password. All of these are re-created by hand after a
real restore (below).

### Format, in short

One file: a 46-byte header (the ASCII magic `ANASAQ-BACKUP`, a version byte,
the scrypt parameters, a 16-byte salt and a 12-byte IV; the header is also
the AES-GCM additional authenticated data), then AES-256-GCM over gzip over
length-prefixed entries (`manifest.json` first), then the 16-byte auth tag.
The key is scrypt(passphrase, salt) with N=2^17, r=8, p=1. A wrong passphrase
or one flipped byte anywhere fails the whole file — by design.

### Commands

Prerequisites, once: Docker Desktop, Node 24, pnpm and the Supabase CLI on
the owner's machine, then `supabase login` and `supabase link` (choose the
ANAS.STUDIO project). Install the CLI as a global command, because the
scripts run `supabase` by name: on Windows `scoop bucket add supabase
https://github.com/supabase/scoop-bucket.git` then `scoop install supabase`;
on macOS `brew install supabase/tap/supabase` (Supabase's CLI guide,
supabase.com/docs/guides/local-development/cli/getting-started, read
2026-09-27). An npm install gives no global command. Docker Desktop must be
running during `pnpm backup`: the CLI runs `pg_dump` in a container.

- `pnpm backup` — the five dumps of the linked project plus both buckets'
  objects, written to `~/ANASAQ-backups/anasaq-backup-<UTC yyyymmdd-hhmmss>.enc`
  (created if missing). `--local` backs up the development stack instead;
  `--out <dir>` picks another directory (never inside the repository). The
  passphrase is typed twice, hidden (minimum 12 characters), or read from
  `ANASAQ_BACKUP_PASSPHRASE` for unattended runs. Each run is recorded in
  `finance.job_runs` as `backup` with numbers only (files, objects, bytes);
  a failed record never invalidates the file. The owner home flags the job
  after 30 days («آخر نسخة احتياطية أقدم من 30 يومًا.»).
- `pnpm restore-check <file>` — proves a file end to end: it restores into a
  throwaway local stack (its own workdir under the OS temp dir, every port
  moved by +1000, studio/inbucket/analytics/realtime/edge runtime off; the
  development stack is untouched), reloads every table with the guide's psql
  invocation, re-uploads every object with its original content type, then
  compares every table's row count and every object's sha256 and prints the
  elapsed time. `--extract <dir>` only decrypts the files for a manual
  restore.

### A real restore into a new hosted project

1. `pnpm restore-check <file> --extract <empty dir>` on any machine with the
   file and the passphrase (this yields the five dump files).
2. Create the new Supabase project, then run the guide's psql restore
   (PostgreSQL's `psql` client) against the new project's connection string: `psql --single-transaction --variable
   ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET
   session_replication_role = "replica"' --file data.sql`, then
   `history_schema.sql` and `history_data.sql` the same way. If a
   `supabase_admin` owner or `cli_login_postgres` grant error appears,
   comment out those lines (the guide's documented caveats); never edit data.
3. Re-create the Vault secrets: `select vault.create_secret(...)` for
   `functions_url`, `jobs_secret` and `pages_deploy_hook`
   (docs/operations.md, "The outbox schedule").
4. Re-set the Edge Function secrets with `supabase secrets set`
   (`JOBS_SECRET`, `RESEND_WEBHOOK_SECRET`, and the rest).
5. Re-apply the Auth settings (I28): SMTP for Resend, redirect URLs and the
   Arabic email templates.
6. Upload the objects from `storage/<bucket>/...` back to their buckets with
   their original content types (read from
   `storage.objects.metadata->>'mimetype'` in the restored data) — exactly
   what `pnpm restore-check` does in its rehearsal.

### Accepted risks (D35)

- Anything entered after the last backup is lost if the project is lost:
  Supabase Free keeps no backups, so the recovery point is the owner's own
  cadence.
- A lost machine loses its copies unless the encrypted file was also copied
  to a USB drive or a cloud drive (safe: the file is encrypted).
- A forgotten passphrase makes every file unreadable. There is no reset.
- Before live orders, E07's Supabase Pro adds the platform's daily backups;
  the cadence is revisited then.
