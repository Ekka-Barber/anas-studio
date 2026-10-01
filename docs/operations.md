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
   or exhausted row past the 23-hour idempotency window opens a confirmation dialog,
   because it may already have been delivered. A suppressed recipient is
   refused — «المستلم محظور بعد ارتداد أو شكوى» — and only a deliberate
   manual database action re-allows it. Remember: provider acceptance is not
   delivery.
2. **مهام التشغيل** — the latest run of each job; a job never run shows
   «لم يعمل بعد». «إرسال البريد» is the outbox, «بناء الموقع» the Pages
   deploy hook after a publish, «تنظيف الوسائط» the daily media sweep. A
   «فاشل» on «بناء الموقع» after five tries means the hook itself is broken
   (see "Site rebuilds" below). Two more red lines say what is wrong in words:
   - «بريد محجوز بسبب حدّ الإرسال. يُرسل تلقائيًا عند تجدّد الحد.» on
     «إرسال البريد»: mail is due but a sending cap holds it (the day's
     80-send mark, or Resend's daily or monthly quota). Nothing to do: it goes
     when the cap renews (see "Quota"). It shows only while a row has been due
     for more than 10 minutes.
   - «رابط بناء الموقع غير مضبوط، فلن يُعاد بناء الموقع عند النشر.» on
     «بناء الموقع»: a build is owed and no `pages_deploy_hook` is in Vault.
     Publishing still works, but the site is not rebuilt until the secret is
     created (see "Hosted setup" below).
3. **المحتوى المجدول** (owner and editors) — how many documents wait for their
   publish time. The owner also sees «تعذّر نشر N من المحتوى المجدول في آخر 7
   أيام:» and one link per document (its collection and id, opening its
   editor) when a scheduled publish failed in the last 7 days; the list comes
   from the `content.publish_due_failed` audit rows, once per document. A
   failed document has lost its schedule: fix the cause (usually a post slug
   another live post uses) and schedule it again. If the audit read itself
   fails the line says «تعذّر التحقق من نجاح النشر المجدول.».
4. **الإحصاءات** (owner only) — see below. The visits line says «تعذّر
   التحميل» when the stats call itself failed, and «غير متاحة» only when the
   analytics report themselves unavailable.

Each role's home loads only what that role may read: the email and job lines
for the owner and operations, the scheduled-content line for the owner and
editors, the failed-publish list and the visits for the owner. Operations
members see the same email screen; editors do not (the email RPC is refused).
No API role can read `public.contacts`, the owner included.

**Unsaved text in the editor.** Every edit in a content form is also kept as
a local copy in this browser (`localStorage`, `anasaq:draft:<collection>:<id>`),
so a closed tab or a conflict never loses typed text. When the document is
opened again and a different local copy is waiting, a banner replaces the
whole form: «يوجد تعديل غير محفوظ محليًا لهذا المستند.», with the time of the
last local edit and two buttons. «استرجاع» puts the copy into the form;
«تجاهل» deletes it and opens the last saved version. If a newer version was
saved after the copy was made, the banner says so («هذه النسخة المحلية مبنية
على النسخة N، والأحدث الآن M»), because restoring replaces what was saved
after it. The form, «حفظ» and the publish bar stay hidden until the banner is
answered, and nothing is autosaved over the copy meanwhile. A copy is offered
only to the person who wrote it; one written before the author was recorded
has no owner and is offered to anyone. «تسجيل الخروج», or another person
signing in under an open tab, deletes every copy; an involuntary sign-out (an
expired session) keeps them, on purpose.

**Admin messages worth knowing.**

- Email problems: after a replay the heading takes focus and says «أُعيدت
  الرسالة إلى طابور الإرسال.». If the row changed after the list was loaded
  (SQLSTATE 55000), the screen says «تغيّرت حالة الرسالة منذ تحميل القائمة.
  حُدّثت القائمة، راجعها ثم أعد المحاولة.» and reloads the list.
- Sign-in: a request that never reached the server says «تعذّر الاتصال. تحقق
  من الشبكة وحاول مرة أخرى.»; the answers for an unknown address stay masked.
- Statistics: a Cloudflare reply the function could not read says «غير متاح:
  تعذّر قراءة بيانات الزيارات. جرّب بعد قليل.».
- Team: a member who loses the owner role while the screen is open sees «لم
  تعد تملك صلاحية عرض الفريق. أعد تحميل الصفحة.»; the team and settings
  screens say «هذه الصفحة للمالك فقط.» to anyone else.
- Media and store screens: see `docs/media-rights.md` and "Store admin" below.

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
   project delivers is checked at P11 (I32). An IPv6 caller is keyed by its
   /64 only (one subscriber or VPS controls a whole /64, so the full address
   would give a caller a fresh bucket on every request); IPv4, `local` and
   IPv4-mapped addresses stay whole. Turnstile still receives the real address.
   A Turnstile failure that is not the visitor's answers 503
   `TURNSTILE_UNAVAILABLE` here and in checkout, never «تعذّر التحقق من أنك
   إنسان.»: Cloudflare unreachable, siteverify answering
   `missing-input-secret`, `invalid-input-secret` or `internal-error` (a
   wrong `TURNSTILE_SECRET_KEY`; an unset one is 503 too), or a test secret on
   a hosted `SITE_URL`. Only the error codes are logged, so a wrong secret does
   not look like every visitor failing.
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
| `contact:all` | 40 per day | everyone |

pg_cron purges the rate-limit windows nightly (`rate-limits-purge`).

**Why 40 a day.** The cap is sized to the outbox, not to the form's traffic.
Every message queues one priority-1 notice per active owner or operations
member, and the outbox sends priority 1 only while the day's sends are under
80 (see "Quota"). 40 messages for up to two notified recipients is at most 80
notices, which one UTC day holds. The cap used to be 200 a day: at one
recipient that queued 120 more notices a day than could be sent, so a flood
backlogged the FIFO queue for days and a real visitor's notice waited behind
spam. D31 makes the notice the only inbox, so a notice that waits is a message
the owner has not seen. The number is fixed in `contact_submit`
(`20260930140000_audit2_fixes.sql`): with a third notified member, 40 × 3 = 120
notices a day no longer fits, so lower the cap there.

**Residual abuse risk (accepted):** the `contact:all` cap is global, so an
attacker who passes Turnstile can spend the whole 40/day budget (8 rotating
IPs at 5/hour each) and lock the form for everyone else until the next UTC
midnight; real visitors get «أرسلت رسائل كثيرة؛ حاول لاحقًا.» and still have
the published email address (`help@anas.studio`). The outbox does not back up:
the flood's notices are at most 80, they fit the day, and the 20-send reserve
stays free for sign-in codes. Receipts (P08, priority 0) count toward
the same 80-send mark, so on a day with many receipts a notice can still wait
for the next UTC midnight; the owner home then shows «بريد محجوز بسبب حدّ
الإرسال…». Manual mitigation when a burst locks the form: look at
`public.contacts` for the burst, then delete the day's `contact:all` row from
`finance.rate_limits` (its `key_hash` is 64 zeros) — the same deliberate
manual-database-action standard as un-suppressing a recipient.

## The outbox

One row per message (`finance.email_outbox`). Priorities: **0** receipts,
**1** staff notices, **2** availability notices (P08). Sign-in codes never
enter the outbox (Supabase Auth SMTP, I28).

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
  or `uncertain` row again. A suppressed recipient is refused, and so is a
  contact notice whose recipient is no longer an active owner or operations
  member (such a notice is exhausted with `RECIPIENT_INACTIVE` when it is
  claimed, and cannot be replayed; `outbox_attention` leaves it out, because
  there is nothing to replay or fix, and it stays in the outbox and the audit
  trail until the contacts purge removes it). An `uncertain` or `exhausted` row whose
  first attempt was more than 23 hours ago may already have been delivered,
  so replaying it requires `accept_duplicate_risk` and rotates the
  idempotency key (the dedupe key — the business identity — never changes).
  The action is written to `audit_events` as `email.replay`.
- **Attention** (`outbox_attention`, owner or operations): rows that need a
  person — `exhausted`, `uncertain`, `suppressed`, or a terminal delivery
  event, except a `RECIPIENT_INACTIVE` notice — with `replay_needs_confirmation`
  set for uncertain or exhausted rows past the 23-hour window.

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
- Once 80 sends (quota − reserve) are used today, only priority 0 (receipts)
  still goes: contact notices (priority 1, which anyone can trigger through
  the form) and availability notices (priority 2) wait so receipts still go;
  at 100 nothing is claimed until midnight UTC. Held-back priority 1 rows
  stay due in `finance.outbox_due_since()`, so `outbox_kick()` calls the
  function every minute until 00:00 UTC (an I35 residual: each call finds
  nothing to claim).
- A run that claims nothing is recorded in `finance.job_runs` as `partial`
  with the reason `QUOTA_HELD` (it used to read `ok` every minute, which hid
  the hold). `outbox_kick()` calls the function only while a row is due, so an
  empty claim almost always means a daily, reserve or monthly cap holds mail
  back; the reason is inferred, because no SQL function `service_role` can
  call says whether mail is due. One empty claim after a lease or suppression
  change can record it too, so the owner home warns («بريد محجوز بسبب حدّ
  الإرسال. يُرسل تلقائيًا عند تجدّد الحد.») only when the newest run has this
  reason **and** a row has been due for more than 10 minutes.

**Sign-in codes share the account but are not counted (residual risk):**
sign-in emails travel through Supabase Auth's SMTP (I28), never through the
outbox, but the same Resend account absorbs them — and the outbox's
sent-today count sees only outbox rows. The 20-send reserve is what keeps
room for them (the outbox holds it back from everything but receipts), so it
must absorb auth traffic too: keep sign-in volume low, and raise `RESERVE` in
`supabase/functions/_shared/outbox.ts` if auth traffic grows. If Supabase
Auth ever changes its sending path (a different provider or subaccount),
this shared-limit assumption breaks silently — re-check I28's mail routing
then.

A 429 from Resend for its daily or monthly quota (`daily_quota_exceeded`,
`monthly_quota_exceeded`) is a `QUOTA` retry: it does not use an attempt, it
stops the run, and the row waits until the next 00:00 UTC (a monthly quota is
probed once a day), so a quota outage does not use up the retry budget. If an
earlier attempt may have reached Resend and that wait would outlast the
23-hour idempotency window, the row becomes `uncertain` instead, so a person
confirms the duplicate risk before a replay. Any other 429 is an ordinary
`retry` with backoff.

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
`job_runs_latest`, purged after 30 days except each job's newest run, so the
backup warning and the `site_build` and `media_sweep` status survive). With `JOBS_SECRET` unset the
function answers 404; with the Vault values unset (the local stack)
`outbox_kick()` does nothing.

The owner home therefore does not judge the email job by its last run's age
(I35): the job warns only when a row has been due for more than 10 minutes
**and** no run finished inside those 10 minutes — «بريد ينتظر الإرسال منذ
أكثر من 10 دقائق. تأكد من الجدولة.» — so a quiet site whose last run is
hours old still shows «سليم». A `QUOTA_HELD` run is not a sign of life: while
mail stays due after one, the line says the mail is held instead (see
"Quota").

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
the owner home shows «بناء الموقع: فاشل». Every new request (a publish, an
archive, a scheduled go-live or a catalog change) starts its own five tries:
`site_build_request()` resets the failure count, which used to go back to
zero only after a success, so one failing episode left every later publish
with a single try. A 2xx only means Cloudflare accepted the hook: a build that
then breaks is visible only in the Pages dashboard, so check it after the first
publishes.

With no `pages_deploy_hook` in Vault a build is owed but nothing can be
called: one `site_build` run is recorded as `skipped` with the reason
`NO_HOOK` (once per episode, not again while it is the newest `site_build`
run), and the owner home says the site will not be rebuilt on publish. Create
the secret (see "Hosted setup" above) and the next minute's run calls the hook.

A catalog change asks for a rebuild only when a public field changes. For a
variant the row trigger compares the product, SKU, title, fulfillment, price,
enabled flag and sort order; stock, the low-stock threshold and the digital
asset are not public. Before, every variant save (a stock correction, an
unchanged save, even a lost version conflict) started a Pages build, which
counts against the 500 builds a month of the Free plan (docs/costs.md).
Inserts and deletes of variants still rebuild.

**Order on the hosted project:** the build reads each library image's alt text
(`alt_ar`) as `anon`, which migration `20260930140000_audit2_fixes.sql` grants
(`grant select (alt_ar) on public.media to anon`). Apply the migration to the
hosted database before the next build, or every page with a library image
fails to build (the last good deploy stays live, D32).

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
outlive a deleted media row (I34's residual) are not swept yet, and neither
is an orphaned original under `media-private/originals/`.

### Scheduled publishing

`publish_due()` (pg_cron, every minute) publishes each due scheduled version
in its own subtransaction, so one failing document does not stop the others.
Like every other writer of a document it takes the document's advisory lock
first: a document being published, scheduled, cancelled or archived at that
moment is left for the next minute, and a version whose schedule a publish or
a cancel cleared meanwhile never goes live over a newer one (`publish_due`
checks that the version is still due after taking the lock). A document that
fails loses its schedule and is written to `audit_events` as
`content.publish_due_failed`; the owner home lists it for 7 days (see "The
owner's routine"). Scheduling a post whose slug another live post uses is
refused at once, in the editor (unique_violation on
`published_documents_post_slug`: «معرّف المقال مستخدم في مقال منشور آخر؛ غيّره
ثم أعد المحاولة.»), so a slug clash rarely reaches the due time. Archiving a
post or taxonomy keeps its first publication date
(`finance.content_first_published`): publishing it again does not start a new
date, which the journal shows and sorts by. A stale admin tab cannot publish or
schedule a version older than the latest: the Data API answers 409 and the
editor keeps its text.

### Uncertain-send reconciliation, in one paragraph

An `uncertain` row means the HTTP request may or may not have reached
Resend. Inside 23 hours the dispatcher retries it with the same idempotency
key, which Resend answers with the original result (or 409
`concurrent_idempotent_requests`, itself a retry). Past 23 hours the key is
gone, so the row appears in `outbox_attention` with
`replay_needs_confirmation`; an owner checks Resend's activity
(`https://resend.com/emails`) for the recipient, then either lets it go or
replays with `accept_duplicate_risk`.

### Every pg_cron job (the restore checklist)

Ten jobs exist, each created by a `select cron.schedule('<name>', ...)` in a
migration; the times are UTC. `pnpm restore-check` derives the same list from
`supabase/migrations` (every `cron.schedule('<name>'` call; a name scheduled
twice, `job-runs-purge`, keeps the later definition), so a new job is checked
without editing the script. Keep this table in step.

| Job | Schedule | What it runs | Created in |
| --- | --- | --- | --- |
| `content-publish-due` | every minute | `public.publish_due()` | `20260925120000_content_versions_and_publishing` |
| `site-build-trigger` | every minute | `public.site_build_trigger()` | `20260927090000_static_site_and_functions` |
| `email-outbox` | every minute | `public.outbox_kick()` | `20260927090000_static_site_and_functions` |
| `checkout-expire` | every minute | `finance.checkout_expire()` | `20260927160000_catalog_and_checkout` |
| `rate-limits-purge` | 03:17 daily | deletes `finance.rate_limits` windows older than 2 days | `20260926120000_contacts_and_email` |
| `job-runs-purge` | 03:23 daily | deletes `finance.job_runs` older than 30 days, except each job's newest run | `20260926120000_contacts_and_email`, replaced in `20260930120000_audit_fixes` |
| `contacts-purge` | 03:29 daily | `finance.contacts_purge()` | `20260927140000_privacy_requests` |
| `cron-run-details-purge` | 03:31 daily | deletes `cron.job_run_details` older than 7 days | `20260930140000_audit2_fixes` |
| `media-sweep` | 03:41 daily | `public.media_sweep_kick()` | `20260927120000_rebuild_delivery_and_media_sweep` |
| `buyer-retention` | 03:53 daily | `finance.buyer_retention_purge()` | `20260930130000_buyer_retention` |

pg_cron records every run in `cron.job_run_details` and never purges it; four
jobs run every minute, about 2 million rows a year. `cron-run-details-purge`
keeps the last seven days.

## Statistics: sources and the E11 gate

`/admin/stats` (owner only) calls the `admin` Edge Function's `stats`
action, which verifies the staff token and role and caches one answer per
isolate for 5 minutes (the cache is read only after authorization; the reply
is `cache-control: no-store` and carries no PII).

- **Visits and top pages** come from the Cloudflare GraphQL Analytics API
  (`httpRequestsAdaptiveGroups`, `sum.visits` and path counts, filtered to
  `requestSource: "eyeball"` and the production host, a 7-day UTC window).
  The top pages count only 200 and 304 answers (a returning visitor's
  revalidation is a 304 and is a page view; scanner probes, redirects and
  blocked requests are not), and the query asks for up to 10,000 groups,
  because the asset filter runs in code and a static export's fonts, chunks and
  images far outnumber its pages. The HTML content-type filter is not
  applied yet: at E11 confirm `edgeResponseContentTypeName` on the live schema
  and add it to `TOP_PATHS_QUERY`. Also at E11 confirm the zone's
  `maxPageSize` for `httpRequestsAdaptiveGroups` (Cloudflare's docs say it
  depends on the plan; their example shows 10000): if it is lower, the query
  answers a GraphQL error and the screen says «غير متاح: ردّ الإحصاءات يحتوي
  على خطأ.» rather than showing wrong numbers.
  A sampled answer (`avg.sampleInterval` above 1) is refused, not estimated.
  It needs the function secrets `ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID`, and
  a `SITE_URL` with a host (the production-host filter); with any of them
  missing the screen says «غير متاح: الإحصاءات غير مُعدّة بعد. تحتاج إلى
  ANALYTICS_TOKEN و CLOUDFLARE_ZONE_ID.», never 0 (the text names the first two;
  a missing `SITE_URL` host gives the same screen). The settings screen's
  analytics line follows the same three-part test. **The live account proof is
  gate E11 (P11)**: until the real zone is queried against the live account,
  the numbers are proven only against fixtures, and the schema/dimension names
  are re-checked then.
- **Commerce** (the «المتجر» block) says «غير مُعدّ بعد. تظهر أرقامه عند
  افتتاح المتجر.» until P08: the order tables exist since P07, but
  `stats.ts` reports `not_configured` until the exact paid/refund/net/customer
  SQL counts land with P08 (`// P08:` in `supabase/functions/_shared/stats.ts`).
  No invented zeros.

## Commerce settings

`/admin/settings` carries an «إعدادات المتجر» section (owner only): the
seller's legal name, address and freelance-certificate registration, the
currency (SAR, fixed, read-only) and the approved policy revisions
(read-only; «لم تُعتمد بعد» until P07 records them). `checkout_enabled`
stays `false`: P07 lifted the old check constraint, but no API path sets it
(only the demo seed and the tests do); P08 adds the owner's switch behind the
verified payment gateway, and until then the screen says payment is closed. There is no tax field anywhere (D34): prices are what the buyer
pays.

Reading goes through `commerce_settings_get()` (granted to `authenticated`;
the owner role is rechecked inside). Saving goes through the `admin` Edge
Function's `commerce-settings-save` action: an active owner at aal2 with a
TOTP verification from the last five minutes, then `commerce_settings_save()`
as `service_role`. The browser sends the row version it read; if another
session saved first, SQL raises a `unique_violation` (SQLSTATE 23505, the
code publish and schedule use for a stale version; not 40001) and the function
answers 409 («تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.»). Every save appends
one `commerce.settings` audit event naming the changed fields, never their
values. No API role has any grant on `finance.commerce_settings`.

## Team invites and admin function errors

- **Invite** (`staff-admin`). It creates the Auth user, then the staff row. If
  the second step fails and the rollback delete fails too, the address is left
  as a confirmed Auth user with no staff row, which would answer
  `USER_EXISTS` for ever. The next invite of that address adopts it (the
  function looks the address up among the first 1000 Auth users and reuses the
  id when there is no staff row). A real member, revoked ones included, still
  answers 409 «هذا البريد مسجّل مسبقًا.».
- **A request body that is not a JSON object** (`null`, an array, a number or
  a string) answers 400 `BAD_JSON` from `staff-admin`.
- **An Auth outage** (a network failure or a 5xx while a function verifies the
  bearer token) answers a server error, not 401: only a missing, bad or
  expired token is 401, so the admin does not read an outage as a sign-out.
- **Media completion** (`media-complete`). It blames the upload (422) only
  when a part is really missing from Storage (a not-found answer); any other
  Storage failure answers 500, so retry later instead of uploading again.
- **Settings status** (`/admin/settings`). Analytics shows as configured only
  when `ANALYTICS_TOKEN`, `CLOUDFLARE_ZONE_ID` and a `SITE_URL` host are all
  set, the same test the stats call applies.

## Checkout holds and limits (P07)

The `checkout` Edge Function is the only buyer-facing path to an order: a
`quote` prices the live cart, a `create` opens one pending order with its
holds behind Turnstile, and a `cancel` releases them. The SQL contract is
`supabase/migrations/20260927160000_catalog_and_checkout.sql`.

- **Holds last 20 minutes.** A created order holds its physical and signed
  stock (and its coupon use) for 20 minutes, with at most one unexpired
  pending order per normalized email and one per checkout session — enforced
  under transaction-scoped advisory locks, so two concurrent requests cannot
  both pass. A new idempotency key neither adds a hold nor refreshes one; a
  buyer who changed their mind cancels the held order first.
- **Throttles** (secondary, so shared networks stay usable): 10 creates per
  hour per salted IP hash, 5 per hour per email, 500 per day in total, and
  quotes 300 per hour per salted IP hash. A throttle answers HTTP 429
  «أرسلت طلبات كثيرة؛ حاول لاحقًا.»
- **Expiry:** availability ignores an expired hold the moment it expires, so
  the stock counts again before any job runs; the minute pg_cron job
  `checkout-expire` (`finance.checkout_expire()`) then marks the order
  expired and releases its reservation rows in bounded batches. Each expired
  order writes one `order.expired` audit row (the order's id and number).
- **Buyer retention (D42):** the daily pg_cron job `buyer-retention`
  (03:53 UTC, `finance.buyer_retention_purge()`) deletes every expired or
  cancelled order, with its items, reservations and coupon use, 90 days
  after it ended, then every customer profile left with no order and
  unchanged for 90 days. It writes one `privacy.buyer_retention` audit row
  with the two counts. Open holds are never touched, and paid orders (P08)
  keep the accounting retention E08 sets.
- **A buyer cancels** with the order number and the access token the create
  replied with (`{"action":"cancel"}`): the holds release at once, and a
  wrong token answers 404, revealing nothing about the order.
- **Residual risk (accepted):** many emails from many addresses can still
  hold scarce stock for 20 minutes at a time; the throttles bound, not stop,
  that. Turnstile runs before every create, and nothing is charged while a
  hold is open (P08 adds payment). The store-wide 500-per-day create budget
  is spent by refused requests as well as by real orders from many emails, so
  a flood can close checkout for the rest of the UTC day; that is accepted
  for now, and whether to keep it, raise it or replace it with an alert is a
  P08 decision.
- **Checkout stays off until P08.** The check that pinned `checkout_enabled`
  to false is lifted, but no API path sets it — only the local demo seed
  (`pnpm db:demo-catalog`) and the tests turn it on; P08 adds the owner's
  switch behind the verified payment gateway.

## Store admin (P07)

`/admin/store` (owner and operations; editors see nothing of the store):
المنتجات, التوصيل, أكواد الخصم (owner only — RLS refuses coupons to anyone
else) and العملاء, plus السياسات, which links to the policy documents under
`/admin/content/policies`. While any demo row exists (D37), the page says
«بيانات المتجر الحالية تجريبية، يحرّرها أنس أو يستبدلها قبل الافتتاح.»

**Who can do what.** Only the owner writes catalog rows — every save is a
Data API write under his JWT, and RLS plus the migration's column grants
decide (a config that wrote a column the migration never grants is caught by
`tests/unit/collections.test.ts`). Operations reads products, variants,
rates and customers, sees values without inputs, and has no «جديد» button.
The owner edits a customer's `name` and `phone` only; customers are written
by checkout, never created by hand, and `email` is read-only because every
order keeps its own contact snapshot. A phone that `normalizeSaudiMobile`
cannot read as a Saudi mobile is refused in the form («أدخل رقم جوال سعوديًا
صحيحًا.»); the table's own check (`customers.phone` matches `^9665[0-9]{8}$`)
stays the last line.

**Invalid values.** While a store form has a problem, «حفظ» stays reachable
by keyboard (`aria-disabled`, not `disabled`) and pressing it moves focus to
the list «هناك مشاكل في البيانات:», one line per field.

**Retire, never delete.** There is no delete button anywhere: orders
reference rows. A product is retired with `الحالة = مؤرشف`, a variant, rate
or coupon with its enabled flag off. Every price, stock, fee, coupon term
and status change is written to `audit_events` by the catalog's own
triggers, with old and new values for the financial columns. A coupon's
scope (`product_ids`), kind and code are audited with from/to too.

**Stale saves.** Every catalog row carries a `version` the database bumps on
each update; a save sends the version it read, so when another session
changed the row first the update matches zero rows: the form shows «تغيّر
هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.» and keeps what
was typed. A duplicate slug, SKU, code or city answers with the field's own
message, and a database check violation answers «تحقق من القيم.» with no
internal detail.

**Prices.** Money is entered in riyals (« ر.س») and stored as integer
halalas (D06); Arabic-Indic digits are accepted, and an unpriced variant or
city is null — never free: «غير مسعّر: لا يُعرض للبيع.» / «غير مسعّر: لا
نوصل إليها». A coupon percentage is typed as a percentage (12.5) and
stored as basis points (1250).

**Policy approval.** Editors draft and publish policy text as content; it
becomes the store's checkout policy only when the owner approves it:
`/admin/settings` carries «اعتماد السياسات المنشورة», which runs through
the same TOTP step-up dialog as the seller-details save. The approval
records the published revisions of سياسة المتجر, سياسة التوصيل and
سياسة الاسترجاع (plus سياسة الخصوصية when it is published) into
`finance.commerce_settings.policy_revisions`, bumps the settings version and
writes one audit row. Unpublished required policies answer «انشر سياسات
المتجر والتوصيل والاسترجاع أولًا.», and a version changed in another
session answers 409 like the seller save (the SQL raises the same 23505). The checkout compares the buyer's
accepted revisions with the approved ones and refuses a mismatch. Buying
itself opens only after the payment gateway is linked (P08). Publishing a new
seq of an approved policy, or removing it, resets the approval (audit
`commerce.policies_reset`) and closes checkout (`POLICIES_NOT_CONFIGURED`)
until the owner approves again; republishing the approved seq, or publishing
a policy document that is not in the approved revisions (for example a privacy
policy published after the approval), does not. A new seq of the privacy
policy that was approved does reset it, like any other approved policy.

## Public store (P07)

The public pages are `/store` (the list), `/store/<slug>` (one product),
`/cart`, `/checkout` and `/policies/<store|delivery|refund|privacy>`, built
at build time from the published catalog and the `policies` collection (D32;
styled in direction B, D39, with the calm treatment of DESIGN.md's "serious
pages").

- **The browser cart** stores only variant ids, quantities and the schema
  version (`localStorage['anasaq:cart:v1']`, at most 50 lines, quantity 1–20,
  duplicate variants merged). A change is applied to the latest stored cart
  (read, change, write), and the page re-reads storage when another tab
  writes, so an item added in one tab is not lost when a quantity changes in
  another. Dedications live in
  `sessionStorage['anasaq:dedications']` and go with the tab. No price, total, name or address is ever
  stored; every shown price comes from a live `quote` call to the `checkout`
  function, debounced ~300 ms. The city and coupon live in sessionStorage. A coupon code
  is trimmed, upper-cased and cut at 64 characters, the most the checkout
  function accepts; a saved code longer than that (from before the cap) is
  dropped with an alert.
  When the browser blocks storage, the cart lives in memory for the tab and
  the page says «السلة مؤقتة في هذه الصفحة: المتصفح يمنع الحفظ.»
- **Checkout** sends `create` with one `checkoutSession` per tab and an
  `idempotencyKey` reused only for an identical retried request; the buyer
  consents to exactly the policy revisions the quote carried. The create
  idempotency key and a 53-bit digest of the request are kept in
  `sessionStorage['anasaq:idempotency']`, with no buyer data. While
  `checkout_enabled` is false, the cart and checkout pages say «الشراء غير
  متاح حاليًا، ويفتح قريبًا.» and no order can be created (D34). A created
  hold shows its order number and «حُجز طلبك لمدة 20 دقيقة…», keeps the cart
  (nothing settles before payment verification, P08) and offers «إلغاء
  الطلب» from the tab's sessionStorage copy of the access token.
- **Screens:** the store pages link to the cart themselves; a site-nav entry
  for the store is Anas's to add in the site settings.

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
secrets`; step 5 below names every one, and `TOKEN_HASH_PEPPER` is in no
backup at all), Auth settings and email templates, the project's encryption
root key, and the database password. All of these are re-created by hand after
a real restore (below).

What a file cannot be trusted to bring back: the **pg_cron schedules**. They
exist only as `cron.schedule(...)` calls inside the migrations, and the
restored migration history marks every migration applied without running it.
Whether `data.sql` carries the `cron.job` rows depends on the CLI: in the CLI
source read on 2026-10-01 (`supabase/cli`, branch `develop`,
`apps/cli-go/pkg/migration/dump.go`), the schema dump excludes the `cron`
schema, and the data dump excludes `vault` but, unlike the other extension
schemas, no longer excludes `cron`. A newer CLI's `data.sql` may therefore
carry the rows and an older one not; this was not checked against the pinned
2.106.0 (docs/development.md). The runbook never assumes either: step 4 lists
the jobs and re-creates the missing ones.

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
  (created if missing). `--linked`, the default, needs `supabase link` first
  (or `SUPABASE_PROJECT_ID` exported in the shell: the script does not read
  `.env`, and the variable takes precedence over the link) and stops before
  writing anything without one of them.
  `--local` backs up the development stack instead;
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
  compares every table's row count and every object's sha256, and prints the
  elapsed time. It then re-runs every `cron.schedule(...)` statement of
  `supabase/migrations` (printed as «Caveat applied (runbook)», with how many
  of the ten jobs `cron.job` already held, which shows whether the dump
  carried them) and requires all ten in `cron.job`, listing each as `ok` or
  `MISSING`: a missing job, or pg_cron missing from the restored database,
  fails the rehearsal. The ten names are derived from the migrations (see
  "Every pg_cron job"). `--extract <dir>` only decrypts the files for a manual
  restore. The files are unencrypted, so it refuses a directory inside the
  repository: use a folder outside the project.

### A real restore into a new hosted project

1. `pnpm restore-check <file> --extract <empty dir outside the project>` on any
   machine with the file and the passphrase (this yields the five dump files).
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
4. Check the pg_cron jobs. A restore never runs a migration's
   `cron.schedule(...)` call again, and `data.sql` may or may not carry the
   `cron.job` rows (see "What a file holds"). List what the new project has:
   `select jobname, schedule from cron.job order by 1;` and compare it with
   the ten names of "Every pg_cron job": `content-publish-due`,
   `rate-limits-purge`, `job-runs-purge`, `cron-run-details-purge`,
   `contacts-purge`, `media-sweep`, `buyer-retention`, `checkout-expire`,
   `site-build-trigger` and `email-outbox`. For every missing one (with an
   empty `cron.job`, all ten) run its `select cron.schedule(...)` statement
   from `supabase/migrations`; for a name scheduled twice (`job-runs-purge`)
   take the later migration's. From the repository root, this prints all ten,
   ready for psql (node writes the file itself: a shell `>` redirect would
   save UTF-16 under Windows PowerShell 5.1, which psql cannot read):
   `node -e "import('./scripts/lib/cron-jobs.mjs').then(m => require('fs').writeFileSync('cron-schedules.sql', [...m.cronScheduleStatements('supabase/migrations').values()].join('\n')))"`
   then `psql "<connection string>" --single-transaction --variable
   ON_ERROR_STOP=1 --file cron-schedules.sql`, and delete `cron-schedules.sql`
   (it lands in the repository root). Scheduling a name that already
   exists replaces its schedule and command (the migration
   `20260930120000_audit_fixes.sql` relies on this for `job-runs-purge`), so
   running all ten is safe. Repeat the `select` and expect ten rows.
   `pnpm restore-check` does the same in its rehearsal and fails while any job
   is missing. Without the jobs the project has every function and no schedule:
   no email is sent, no publish triggers a rebuild, scheduled posts never go
   live, holds never expire and the 90-day retention purges never run, while
   the owner home only says «لم يعمل بعد».
5. Re-set the Edge Function secrets with `supabase secrets set`, every one of
   them, because no backup holds any: `SITE_URL`, `JOBS_SECRET` (the same value
   as the Vault `jobs_secret` of step 3), `TOKEN_HASH_PEPPER`, `RESEND_API_KEY`,
   `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`,
   `ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID` (and `PAYMENTS_MODE` with the
   payment gateway's secrets, once P08 adds them). **`TOKEN_HASH_PEPPER` is not
   a throwaway value: reuse the original, and keep a copy with the backup
   passphrase.** It salts the throttles' caller keys and derives each order's
   access token, of which the database keeps only a peppered hash
   (`orders.access_token_hash`); a new pepper makes every stored order link and
   cancel call stop matching (404), and the P08 download links with them. A
   missing `TOKEN_HASH_PEPPER` makes `contact` answer 500 and `checkout` 503,
   and a missing `SITE_URL` makes `contact` answer 403 to every origin, so
   finish with a smoke test: send one real message through the contact form
   from the site. It must answer «received» (201), and the notice must reach
   the mailbox within a few minutes (this proves Turnstile, the secrets,
   Resend, the outbox and the step 4 jobs together).
6. Re-apply the Auth settings (I28): SMTP for Resend, redirect URLs, the
   Arabic email templates, the Custom Access Token hook
   (`public.deny_password_tokens`) and `secure_password_change = true`;
   re-check with a password grant, which must return 403.
7. Upload the objects from `storage/<bucket>/...` back to their buckets with
   their original content types (read from
   `storage.objects.metadata->>'mimetype'` in the restored data) — exactly
   what `pnpm restore-check` does in its rehearsal.
8. Reapply the deletion ledger before the site reopens
   (docs/privacy-data-map.md, "The deletion ledger and restores"): first
   re-revoke in the team screen every member a `revoke` line lists, then
   re-run every erase line. A restored older backup brings revoked members
   back active and erased contacts and staff data back.
9. Once the restore is verified, delete the extracted directory. It is
   unencrypted and holds every personal record and the Auth secrets.

### Accepted risks (D35)

- Anything entered after the last backup is lost if the project is lost:
  Supabase Free keeps no backups, so the recovery point is the owner's own
  cadence.
- A lost machine loses its copies unless the encrypted file was also copied
  to a USB drive or a cloud drive (safe: the file is encrypted).
- A forgotten passphrase makes every file unreadable. There is no reset.
- Before live orders, E07's Supabase Pro adds the platform's daily backups;
  the cadence is revisited then.
