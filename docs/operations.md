# Operations: contact messages, email delivery and orders (P06, P08)

How a contact message reaches the owner's mailbox, and what to do when an
automatic email gets stuck. There is no admin inbox (D31): the owner reads
and answers contact messages in his own mailbox. The SQL contract lives in
`supabase/migrations/20260926120000_contacts_and_email.sql`; the dispatcher
is `supabase/functions/_shared/outbox.ts`, the `outbox` Edge Function, which
pg_cron calls while an email is due (D32).

Since P08 the same admin carries the shop's orders: the owner's routine for
them, refunds, the reconciliation screen, review payments, disputes, paid
files, availability notices, preorders, the checkout switch and the mail budget
are under "Orders after the sale (P08)" below. How a payment settles is in
[payments-runbook](payments-runbook.md); what is kept about a buyer, and how a
request to see or erase it is handled, is in
[privacy-data-map](privacy-data-map.md).

What to do when something breaks (a secret that must change, a webhook outage,
a paused project, a member who must lose access at once, a leaked order link, a
suppressed address) is under "When something goes wrong" below, and a restore
of a lost project is under "Backups (D35)".

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
   (`/admin/email`). «إعادة الإرسال» replays an exhausted or uncertain row. An
   uncertain or exhausted row past the 23-hour idempotency window opens a
   confirmation dialog, because it may already have been delivered. «إغلاق»
   (after the question «إغلاق الرسالة يخرجها من القائمة ولا تُرسل بعد ذلك.
   متابعة؟», and only on those two kinds of row) closes a mail that needs
   nothing more: one the owner found delivered at Resend, or one he decides not
   to resend. It leaves the list and the home's count, is never claimed again,
   and is written to `audit_events` as `email.closed` (round M2; before it
   nothing closed a mail, so each one the owner let go stayed counted for
   good). A suppressed recipient is refused — «المستلم محظور بعد ارتداد أو شكوى؛
   لا يمكن الإرسال إليه.» — and lifting a suppression is a deliberate database
   action ("Lifting a suppression" below). Remember: provider acceptance is not
   delivery.
2. **مهام التشغيل** — the latest run of each job; a job never run shows
   «لم يعمل بعد». «إرسال البريد» is the outbox, «مطابقة المدفوعات» the payment
   reconciliation (P08), «بناء الموقع» the Pages deploy hook after a publish,
   «تنظيف الوسائط» the daily media sweep and «النسخ الاحتياطي» Anas's own backup
   (D35). A «فاشل» on «بناء الموقع» after five tries means the hook itself is
   broken (see "Site rebuilds" below). A «فاشل» on «إرسال البريد» whose run
   detail reads `PROVIDER_CONFIG` means Resend refused the key or the domain
   (see "Rotating a secret"). More red lines say what is wrong in words:
   - «بريد محجوز بسبب حدّ الإرسال. يُرسل تلقائيًا عند تجدّد الحد.» on
     «إرسال البريد»: mail is due but a sending cap holds it (the day's
     80-send mark, or Resend's daily or monthly quota). Nothing to do: it goes
     when the cap renews (see "Quota"). It shows only while a row has been due
     for more than 10 minutes.
   - «رابط بناء الموقع غير مضبوط، فلن يُعاد بناء الموقع عند النشر.» on
     «بناء الموقع»: a build is owed and no `pages_deploy_hook` is in Vault.
     Publishing still works, but the site is not rebuilt until the secret is
     created (see "Hosted setup" below).
   - «مدفوعات تنتظر المطابقة منذ أكثر من 10 دقائق. تأكد من الجدولة.» on
     «مطابقة المدفوعات»: an attempt, a webhook event or an in-flight refund has
     been due for more than 10 minutes and no run finished inside them
     (`public.payments_due_since()`, round M1a), the same rule as the mail's.
   - «الدفع غير مضبوط؛ المطابقة متوقفة.» on «مطابقة المدفوعات»: the last run was
     skipped with `PAYMENTS_NOT_CONFIGURED`.
   - «مهام مجدولة فشلت خلال 24 ساعة: <job name> ×N (آخرها <time>)», one line
     under the list for each pg_cron job that has a failed run in pg_cron's own
     log in the last 24 hours (`cron_failures_recent()`, round M2). Eleven of
     the fifteen jobs run pure SQL and record no run of their own, so this is
     the only place their failure shows; the line names the job and counts the
     failures and never prints the error text. If the read itself fails the
     line is «تعذّر التحقق من المهام المجدولة.».
3. **المحتوى المجدول** (owner and editors) — how many documents wait for their
   publish time. The owner also sees «تعذّر نشر N من المحتوى المجدول في آخر 7
   أيام:» and one link per document (its collection and title, opening its
   editor) when a scheduled publish failed in the last 7 days and the document
   has not gone live at that version or a later one since; the list comes from
   the `content.publish_due_failed` audit rows, the newest once per document.
   A failure caused by a post slug another live post uses (23505) adds
   «معرّف المقال مستخدم في مقال منشور آخر.». A failed document has lost its
   schedule: fix the cause and schedule it again. If the audit read or the
   documents' read fails the line says «تعذّر التحقق من نجاح النشر المجدول.»
   (RESIDUALS-1 R3a).
4. **الإحصاءات** (owner only) — see below. The visits line says «تعذّر
   التحميل» when the stats call itself failed, and «غير متاحة» only when the
   analytics report themselves unavailable.
5. **الطلبات** (owner and operations; P08) — «تحتاج حلًا», «للشحن» and
   «دفعات قيد المراجعة», and for the owner «تحتاج مطابقة», which opens the
   reconciliation screen; then «مخزون منخفض» and «فتح الطلبات». See "The
   owner's daily routine for orders".

Each role's home loads only what that role may read: the email, orders and job
lines for the owner and operations, the scheduled-content line for the owner and
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
- Sign-in: the e-mail code is eight digits and its request sits behind a
  Turnstile widget whose token Auth checks (`supabase/config.toml`). A request
  that never reached the server says «تعذّر الاتصال. تحقق من الشبكة وحاول مرة
  أخرى.»; Auth's rate limit says «أُرسلت رموز كثيرة في وقت قصير. انتظر قليلًا ثم
  اطلب رمزًا جديدًا.»; a Turnstile token Auth refused (a 400 with the code
  `captcha_failed`: nothing was sent) says «تعذّر التحقق من أنك لست روبوتًا؛ حدّث
  الصفحة وحاول مرة أخرى.» and the page stays on the e-mail step; a failure on
  Auth's side says «تعذّر الإرسال الآن. حاول بعد قليل.». The button «أرسل الرمز»
  waits for Turnstile's token; without the widget (no site key, or its script
  failed) it stays off and says «التحقق غير متاح حاليًا.» or «تعذّر تحميل
  التحقق؛ حدّث الصفحة.». Every other answer, an
  unknown address included, is the masked «إن كان هذا البريد مسجّلًا لدينا فقد
  أرسلنا إليه رمزًا من 8 أرقام.» (`tests/unit/admin-ops.test.ts`). The hosted
  project needs the same two settings in its own dashboard; they are unverified
  on the hosted project (I28).
- Statistics: a Cloudflare reply the function could not read says «غير متاح:
  تعذّر قراءة بيانات الزيارات. جرّب بعد قليل.».
- Team: a member who loses the owner role while the screen is open sees «لم
  تعد تملك صلاحية عرض الفريق. أعد تحميل الصفحة.»; the team and settings
  screens say «هذه الصفحة للمالك فقط.» to anyone else. A revoke that did not
  finish offers «حاول مرة أخرى» beside «استعادة» (see "Removing access in a
  hurry").
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
midnight; real visitors get «أرسلت رسائل كثيرة؛ حاول لاحقًا.» and have no
published e-mail address to fall back on. No page shows one today (ISSUES I45
(3): Anas answered Q31 on 2026-10-01 that it should be shown, and no package
carries the work yet), and `help@anas.studio` forwards mail only once Cloudflare
Email Routing is set up for it (D31, E01).
What a visitor still has is WhatsApp, when its number is set in the
admin, and the social links, both on /contact. The outbox does not back up:
the flood's notices are at most 80, they fit the day, and the 20-send reserve
stays free for sign-in codes. Receipts and the other priority 0 mail count toward
the same 80-send mark, so on a day with many receipts a notice can still wait
for the next UTC midnight; the owner home then shows «بريد محجوز بسبب حدّ
الإرسال…». Manual mitigation when a burst locks the form: look at
`public.contacts` for the burst, then delete the day's `contact:all` row from
`finance.rate_limits` (its `key_hash` is 64 zeros) — the same deliberate
manual-database-action standard as un-suppressing a recipient.

## The outbox

One row per message (`finance.email_outbox`). Priorities: **0** the mail a
payment or a staff action causes (receipts, shipping, refund and file-ready
notices, owner alerts), **1** contact notices and order-link recoveries, **2**
availability confirmations and notices (the tiers and caps are in "The mail
budget" below). Sign-in codes never enter the outbox (Supabase Auth SMTP, I28).

```
pending ──claim──▶ sending ──accepted──▶ sent ──webhook──▶ delivered
   ▲                  │                                 delayed / bounced /
   │  retry (backoff) ├─▶ retry → pending (uncertain if possibly_sent) … complained / failed
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
  23 hours (one hour of margin) the row waits for a person. A row that had an
  attempt of unknown outcome (a timeout, an unreadable reply, an expired lease:
  `possibly_sent`, round R2a) is never `pending` again: it stays `uncertain`
  when a later attempt fails and will be retried, when a quota or
  configuration refusal gives the attempt back (`QUOTA`, `PROVIDER_CONFIG`) and
  when it is replayed inside the window (a refusal, or the attempts cap,
  exhausts it as any row), so this rule covers it every time; it
  does not go back to `pending` and wait behind the tier caps to be sent days
  later with an expired key. A row that was already `uncertain` when the round
  was applied is marked too. A replay inside the window keeps the key, the
  first attempt and the mark, and queues the row `uncertain` (due at once), so
  it stays on the mail screen's list, with its buttons, until the next run
  claims it; one past it rotates the key, clears the mark and queues the row
  `pending`.
- **Replay** (`outbox_replay`, owner or operations): queues an `exhausted`
  or `uncertain` row again. A suppressed recipient is refused, and so is a
  contact notice whose recipient is no longer an active owner or operations
  member (such a notice is exhausted with `RECIPIENT_INACTIVE` when it is
  claimed, and cannot be replayed; `outbox_attention` leaves it out, because
  there is nothing to replay or fix, and it stays in the outbox and the audit
  trail until the contacts purge removes it). An `uncertain` or `exhausted` row whose
  first attempt was more than 23 hours ago may already have been delivered,
  so replaying it requires `accept_duplicate_risk` (a null is no consent) and
  rotates the idempotency key (the dedupe key — the business identity — never
  changes).
  The action is written to `audit_events` as `email.replay`.
- **Close** (`outbox_close`, owner or operations; round M2, the screen's
  «إغلاق»): turns an `uncertain` or `exhausted` row into `closed` with the
  reason `CLOSED_BY_STAFF`, under the row's lock, so a claim that took the row
  first leaves it `sending` and the close is refused (`BAD_STATUS`, which the
  screen says as a list that changed since it was loaded). A closed row is never
  claimed or replayed again and leaves `outbox_attention`; the action is written
  to `audit_events` as `email.closed` with the status the row had. It is the
  answer for a mail the owner found delivered, or one he does not want sent.
  A `suppressed` row cannot be closed or replayed (see "Lifting a suppression").
- **Attention** (`outbox_attention`, owner or operations): rows that need a
  person — `exhausted`, `uncertain`, `suppressed`, or a terminal delivery
  event (`bounced`, `complained`, `failed`), except a notice closed with
  `RECIPIENT_INACTIVE`, `NOT_PENDING`, `NOT_CONFIRMED` or `NO_FILE` (nothing is
  left to replay or fix for those) and a row a person closed — with
  `replay_needs_confirmation` set for uncertain or exhausted rows past the
  23-hour window. The list is cut at 200 rows: the replayable ones
  (`exhausted`, `uncertain`) come first, the newest first, so while fewer than
  200 rows are replayable the cut drops only rows nobody can act on. When the
  list holds 200 rows the screen says so under its filters: «تُعرض 200 مشكلة
  فقط: ما يحتاج تدخلًا أولًا، ثم الأحدث.» (RESIDUALS-1 R3a).

### Quota

`supabase/functions/_shared/outbox.ts` claims with `DAILY_QUOTA = 100`, `RESERVE = 20`,
`LOW_RESERVE = 30` and `MONTHLY_QUOTA = 3000`:

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
- Three tiers by priority (P08, "The mail budget" below): priority 2
  (availability confirmations and notices) stops once 50 sends (quota −
  reserve − low reserve) are used today, priority 1 (contact notices, which
  anyone can trigger through the form, and order-link recoveries) at 80
  (quota − reserve), and only priority 0 (receipts, shipping, refund and
  file-ready mail, owner alerts) still goes, up to 95 — the last five sends of the day are kept for sign-in
  codes (round M1b, see below); at 95 nothing is
  claimed until midnight UTC. Held-back rows stay due in
  `finance.outbox_due_since()`, so `outbox_kick()` calls the function every
  minute until 00:00 UTC (an I35 residual: each call finds nothing to claim).
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
sent-today count sees only outbox rows. What keeps room for them is the last
five sends of the day, which not even priority 0 may use: `outbox_claim` stops
priority 0 at the daily quota minus 5 (round M1b-8; the floor is written in the
SQL, not in `outbox.ts`). Before it priority 0 could spend the whole 100, and on
a launch day with 80 to 100 receipts, owner alerts and shipping mails Resend
would have refused a staff sign-in code until 00:00 UTC (03:00 in Riyadh): Auth sends it
straight through Resend, outside the outbox, so it is refused, not queued like a
receipt (DB-POST-04). Five is a floor, not a budget: if sign-in volume grows, raise it in
the SQL. **Open decision for the owner (E07):** whether the site launches on
Resend's Free plan (100 a day) or on a plan without a daily quota
(docs/costs.md lists one); `DAILY_QUOTA` in `supabase/functions/_shared/outbox.ts`
is raised when the plan changes. If Supabase Auth ever changes its sending path
(a different provider or subaccount), this shared-limit assumption breaks
silently — re-check I28's mail routing then.

A 429 from Resend for its daily or monthly quota (`daily_quota_exceeded`,
`monthly_quota_exceeded`) is a `QUOTA` retry: it does not use an attempt, it
stops the run, and the row waits until the next 00:00 UTC (a monthly quota is
probed once a day), so a quota outage does not use up the retry budget. If an
earlier attempt may have reached Resend, the row becomes `uncertain` instead of
`pending`: whatever the wait when that attempt was of unknown outcome
(`possibly_sent`), and when the wait would outlast the 23-hour idempotency
window for any other earlier attempt. The claim's 23-hour guard then applies,
so a person confirms the duplicate risk before a replay past the window. Any
other 429 is an ordinary `retry` with backoff.

### Suppression

Resend documents three bounce types: Permanent, Transient and Undetermined
(its bounce page, read by the audit on 2026-10-07). A bounce typed Permanent,
one with no type and one with a type the code does not know (`email.bounced`,
the type read from the event's evidence) add the recipient's hash to
`finance.email_suppressions`, as does a complaint (`email.complained`) or a
provider suppression (`email.suppressed`). A Transient or Undetermined bounce
only records the event (round M2): the address may deliver later, Resend itself
suppresses only after a permanent rejection, and a real hard bounce on the next
send arrives as Permanent and suppresses then. The buyer-facing senders consult
the list: mail to a suppressed buyer address is never claimed again (the row
ends `suppressed`), and replaying a suppressed row is refused. **Staff mail is
not held back by the list** (round M1b): a `contact_notice` or an `owner_alert`
to an active owner or operations member goes out whatever the list says, so one
bounce of the owner's own address no longer ends every later notice
`suppressed` unseen. A later `delivered` never clears a suppression, and never
overwrites a bounce or complaint on a row. Nothing lifts a suppression by
itself: see "Lifting a suppression" below.

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
ignored): complaints, suppressions and every bounce except a Transient or
Undetermined one (or one typed with the older spellings temporary or soft)
suppress the recipient — Resend documents `bounce.type` as Permanent, Transient
or Undetermined (its bounce page, read by the audit on 2026-10-07; the P06 note
`artifacts/acceptance/P06/source-resend-bounced.md` recorded only Permanent and
Temporary), so a missing or unknown type still suppresses conservatively; a
Transient or Undetermined bounce records the event (and sets the row's
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
secret unset the endpoint answers 404 — it does not exist. After a restore into
a new project the address changes with the project reference (see "A real
restore into a new hosted project", step 12); to change the signing secret see
"Rotating a secret".

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
These are the first-time lines: `vault.create_secret` fails for a name that
already exists, so a value that is already there is changed with
`vault.update_secret` (see "Rotating a secret").
The same Vault holds `pages_deploy_hook`, the Cloudflare Pages deploy hook
that `site_build_trigger()` calls after a publish. The payment job
(`payments-reconcile`) uses the same two secrets, `functions_url` and
`jobs_secret`; without them nothing reconciles on its own. The Moyasar secrets
and the webhook registered in Moyasar's dashboard are in
[payments-runbook](payments-runbook.md#switching-from-the-emulator-to-the-real-sandbox-then-to-live).

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
enabled flag, sort order and, since P08, the preorder flag, date and note;
stock, the preorder capacity, the low-stock threshold and the digital asset are
not public. Before, every variant save (a stock correction, an
unchanged save, even a lost version conflict) started a Pages build, which
counts against the 500 builds a month of the Free plan (docs/costs.md).
Inserts and deletes of variants still rebuild. Since round R2a a product is
treated the same way: the row trigger compares the slug, title, summary, body,
cover image, status and sort order, and asks only when one changed and the
product is or was published (so the save of a draft, an unchanged save and a
lost version conflict ask for nothing), a variant of a product that is not
published asks for nothing when it changes, and inserts and deletes of products
still rebuild.
A library image's alt text or caption also asks for a build (round M2) when a
published document or a published product uses the image, because the static
pages print them; an edit of an image nobody shows, or of its name, folder or
rights, asks for none.

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
expire after 30 minutes). Storage refuses direct deletes from
`storage.objects`, and one would orphan the stored bytes, so the removal
never runs in SQL. The run is recorded as `media_sweep`; the owner home
flags it when the last run is over 26 hours old. Public derivatives that
outlive a deleted media row (I34's residual) are not swept yet, and neither
is an orphaned original under `media-private/originals/`. The same run (P08)
also removes the paid files' upload parts that were never completed:
`paid-files` objects under `incoming/` older than 24 hours, counted as
`paidFiles` in the run's record. It never lists or removes anything under
`assets/`, where a recorded paid file lives (see "Residuals and ceilings").

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
(`https://resend.com/emails`) for the recipient, then either replays with
`accept_duplicate_risk` or closes the row with «إغلاق» (`outbox_close`): it
leaves the list and the home's count, is never claimed again and is written to
`audit_events` as `email.closed`. Before round M2 nothing closed an uncertain
or exhausted mail, so each one the owner had verified and let go stayed in the
home's count for good. «إغلاق» does not apply to a `suppressed` row, whose mail
is not coming back by itself (see "Lifting a suppression").

### Every pg_cron job (the restore checklist)

Fifteen jobs exist, each created by a `select cron.schedule('<name>', ...)` in a
migration; the times are UTC. `pnpm restore-check` derives the same list from
`supabase/migrations` (every `cron.schedule('<name>'` call; a name scheduled
twice, `job-runs-purge`, keeps the later definition), so a new job is checked
without editing the script. Keep this table in step. P08 added the last five.

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
| `payments-reconcile` | every minute | `public.payments_kick()`, which calls the `outbox` function's `payments_reconcile` job while an attempt, a webhook event or an in-flight refund is due | `20261002100000_payment_core` |
| `availability-sweep` | every minute | `finance.availability_sweep()` | `20261002150000_notifications` |
| `notifications-purge` | 03:37 daily | `finance.notifications_purge()` | `20261002150000_notifications` |
| `notify-confirm-backlog` | 17 minutes past every hour | `finance.notify_confirm_backlog()` | `20261002150000_notifications` |
| `payment-events-purge` | 03:47 daily | `finance.payment_events_purge()` | `20261002170000_stats_disputes` |

pg_cron records every run in `cron.job_run_details` and never purges it; six
jobs run every minute (`content-publish-due`, `site-build-trigger`,
`email-outbox`, `checkout-expire`, `payments-reconcile` and
`availability-sweep`), about 3 million rows a year. `cron-run-details-purge`
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
- **Commerce** (the «المتجر» block) shows the ledger's own figures for the
  site's mode (`owner_commerce_stats`, read on every call; only the analytics
  part is cached) over a range of Riyadh days, the last 30 days by default and
  at most 366: «طلبات مدفوعة», «إجمالي المدفوع», «الاستردادات المؤكدة»,
  «الصافي بعد الاستردادات», «العملاء», «دفعات قيد المراجعة» and «النزاعات»,
  with «بيانات بيئة الاختبار» on a test site and the sentence that the net is
  the total paid less the confirmed refunds, excludes gateway fees,
  chargebacks and payout timing, and is neither cash settled at the bank nor
  profit. Test and live never mix, and review payments and disputes are in
  neither the total nor the net. While payments are not configured it says
  «غير مُعدّ بعد. تظهر أرقامه عند افتتاح المتجر.» (the home says «المتجر غير مُهيأ
  بعد. تظهر أرقامه عند افتتاحه.»), never an invented zero.

## Commerce settings

`/admin/settings` carries an «إعدادات المتجر» section (owner only): the
seller's legal name, address and freelance-certificate registration, the
currency (SAR, fixed, read-only), the approved policy revisions
(read-only; «لم تُعتمد بعد» until the owner approves them) and the «الشراء»
box with the payments status line and the checkout switch (see "The checkout
switch"). `checkout_enabled` is `false` on every database the migrations
create; the owner's switch is the only API path that sets it (locally the demo
seed and the tests set it directly). There is no tax field anywhere (D34):
prices are what the buyer pays.

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

## Checkout holds and limits (P07, P08)

The `checkout` Edge Function is the only buyer-facing path to an order: a
`quote` prices the live cart, a `create` opens one pending order with its
holds behind Turnstile and then makes its invoice (P08), a `pay` makes the
invoice again for a retry or a reload, and a `cancel` releases the holds. The
SQL contract is `supabase/migrations/20260927160000_catalog_and_checkout.sql`,
changed by `20261002110000_checkout_payment.sql`.

- **Holds last 20 minutes.** A created order holds its physical and signed
  stock (the digital lines of a preorder too) and its coupon use for 20
  minutes, with at most one unexpired pending order per checkout session,
  enforced under a transaction-scoped advisory lock, so two concurrent requests
  cannot both pass. P08 removed the per-email limit (see "Residuals and
  ceilings"). A second `create` from a session that already holds an order
  answers `ACTIVE_HOLD`: the tab that made the order gets its access token
  back (its request's email must match the held order's), anyone else is only
  told that the session holds an order. A new idempotency key neither adds a
  hold nor refreshes one; a buyer who changed their mind cancels the held order
  first.
- **Throttles** (secondary, so shared networks stay usable): 10 creates per
  hour per salted IP hash, 500 per day in total, and quotes 300 per hour per
  salted IP hash. The daily total is taken only when an order is actually
  created, after every refusal, so refused requests no longer spend it. A
  throttle answers HTTP 429 «أرسلت طلبات كثيرة؛ حاول لاحقًا.»
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
  with the two counts. Open holds are never touched, and paid orders keep the
  accounting retention E08 sets. P08 also deletes the payment attempts and
  webhook events of the orders it removes, and skips an order that still has
  money or work attached (an attempt creating, pending, uncertain, paid or in
  review, one marked `UNVERIFIED` or still due for a check, a review payment of
  any state, or a dispute).
- **A buyer cancels** with the order number and the access token the create
  replied with (`{"action":"cancel"}`): the holds release at once, and a
  wrong token answers 404, revealing nothing about the order. While a payment
  attempt is active (`creating`, `pending` or `uncertain`) the database cancels
  nothing (`PAYMENT_ACTIVE`; each such cancel counts against 30 an hour per
  order, then the answer is 429) and the function decides from the attempt:
  - A `pending` attempt, the usual case once the invoice exists: the function
    cancels the invoice at Moyasar. An answer of `canceled` that lists no
    charged payment (`paid`, `refunded` or `captured`; a declined card is not
    one) closes the attempt and cancels the order, so the held stock is free at
    once. Any other answer sends it to read the invoice, and one that is
    `canceled` or `expired` with no charged payment is closed and cancelled the
    same way.
  - A charged payment listed in the cancel's answer or in the invoice read
    after it is settled first, so a buyer who has just paid is never cancelled: the answer
    is then the order's own state (`paid`, `paid_needs_resolution`, `refunded`
    or `review`).
  - Otherwise the answer is 409 `PAYMENT_ACTIVE`, «الدفع قيد المعالجة؛ حاول بعد
    لحظات.», and nothing is cancelled: an attempt in `creating` or `uncertain`
    (the payment job's), a provider that cannot be reached, a settle that leaves
    the order unsettled, or an invoice that is still payable.
- **Residual risk (the recorded acceptance understated it; the owner has not
  accepted these numbers, open decision DB-COMMERCE-02):** nothing limits the
  units that unpaid holds take of one variant. A checkout session holds one
  unexpired order, but the session id is a UUID the browser chooses, so what
  binds is the IP throttle (10 creates an hour per salted IP hash, an IPv6
  caller keyed by its /64, so a /48 is 65,536 keys), Turnstile and the 500
  orders a day for the whole store. An order may hold up to 20 units of a line
  (a digital line only one). So one address that passes Turnstile in a real
  browser holds up to 200 units of one variant per 20-minute window, or about 67
  continuously by spreading its 10 creates; three addresses hold 200 units
  around the clock and, at 10 creates an hour each, spend the day's 500 in about
  17 hours, which closes checkout for every buyer until 00:00 UTC. A buyer then
  reads «الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.». A ceiling on the units
  unpaid orders may hold of one variant (a share of the stock, or a per-order
  cap such as 5 units of a physical or signed one) and, or, a cap of active
  holds per address is not built; whether to build one is a business choice for
  the owner. Nothing is charged while a hold is open: the buyer pays on
  Moyasar's page, and a payment that lands after the hold ended is a late
  payment (the payments runbook). The 500-per-day budget counts only real
  orders, so refused requests cannot drain it.
- **Checkout is off until the owner turns it on.** `checkout_enabled` is false
  on every database the migrations create; only the owner's switch (see "The
  checkout switch") sets it through the API, and locally the demo seed
  (`pnpm db:demo-catalog`) and the tests set it directly.

## Store admin (P07)

`/admin/store` (owner and operations; editors see nothing of the store):
المنتجات, التوصيل, أكواد الخصم (owner only — RLS refuses coupons to anyone
else) and العملاء, plus «طلبات الإشعار» (P08, a read-only list) and السياسات,
which links to the policy documents under
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
writes one audit row. It approves the revisions the owner was shown, not whatever is
published when he presses: above the button the screen lists each policy the approval
covers as «<العنوان>: نُشرت <الوقت بتوقيت الرياض>» (`publishedPolicies` of
`commerce_settings_get`), and sends exactly those revisions (`revisions` of the action;
`commerce_policies_approve(p_actor, p_expected_version, p_revisions)`). When a policy was
published since the page was read, or the set of published policies changed (a privacy
policy published for the first time, say), nothing is approved: the action answers 409
`POLICIES_CHANGED` («تغيّرت السياسات منذ فتحت الصفحة. راجعها ثم اعتمدها من جديد.»), the screen
reads the settings again and the owner approves from the new list. Unpublished required policies answer «انشر سياسات
المتجر والتوصيل والاسترجاع أولًا.», and a version changed in another
session answers 409 like the seller save (the SQL raises the same 23505). The checkout compares the buyer's
accepted revisions with the approved ones and refuses a mismatch. Buying
itself opens only when the owner turns the checkout switch on, which also needs
working payment settings (see "The checkout switch"). Publishing a new
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
  hold shows its order number, the total, the time the hold ends as a plain
  clock time in Riyadh («محجوز حتى 14:35», never a ticking countdown), «ادفع
  الآن» (a plain link to Moyasar's hosted page) and «إلغاء الطلب» from the
  tab's sessionStorage copy of the access token. The cart is kept until the
  return page shows the order paid, and it is cleared only in the tab that
  holds that order.
- **Screens:** the store pages link to the cart themselves; a site-nav entry
  for the store is Anas's to add in the site settings.

## Orders after the sale (P08)

P08 turns a held order into a paid one and runs everything after it: the invoice
and its verification (the mechanics are in [payments-runbook](payments-runbook.md)),
the buyer's order page, the paid file, shipping, returns, refunds, availability
notices and the money figures. This part is the owner's side. The agreement
between the layers is `PLANS/P08-CONTRACT.md`; each round's file under
`artifacts/acceptance/P08/rounds/` records what was built and what was ruled.
Checkout is closed on every database the migrations create, and nothing here
claims a real payment: E02 and E03 are open.

### What the buyer has

After paying on Moyasar's page the buyer returns to `/checkout/return`, which
asks the `payments` function for the order's state and says one thing: «تم
الدفع. رقم الطلب …» (with a link to the order when the tab holds the order's
token), «وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.» for a payment
under review, or the order's real state. A receipt follows by email («إيصال
طلبك رقم …», never called a tax invoice) with a personal link to
`/orders#<order number>.<token>`. The page moves the token into the tab's
`sessionStorage` and out of the address bar, is `no-store` and `noindex` and
sends no Referer, and the link works for 7 days from payment (renewed by a
recovery, when a file is attached, by «إكمال الطلب», by the shipped and refunded
mails, and by the owner's «إعادة إرسال رابط الطلب», which also replaces the
token). On it the buyer sees the status, the
lines, the totals, the payment state, shipping with carrier and tracking, a
download button for each digital item, a form to ask for a return and the
refunded total.

- **A lost link.** The buyer asks for a new one on the same page (an address and
  Turnstile). The answer is always the same sentence, whether or not the address
  has orders. Up to 5 of the address's latest paid, under-review or refunded
  orders are looked at: a link that still works keeps working, with a fresh 7
  days, and is mailed again; an expired one is replaced by the next version's.
  The limits are 3 requests an hour per address, 10 an hour per caller, 20
  `order_link` mails a day in all and one per order per day.
  The owner can also send a link again, to the same address or a corrected one
  ("A leaked order link").
- **A download** takes two steps: `issue` mints a token that lives 15 minutes and
  serves 3 downloads (at most 10 tokens per file per day), and `redeem` answers a
  signed Storage link that lives 60 seconds. A refund that revokes the file, a
  dispute decision `entitlement_revoked` or a refunded order stops new links at
  once.
- **A return request** can be filed for a physical or signed line already shipped
  or delivered, with a reason, at most 5 a day for one order. It never issues a
  refund. The order page sends a key with the request, kept until the form changes:
  a press repeated after a reply that was lost is answered with the request already
  filed and files nothing more.

### The owner's daily routine for orders

1. **The home, «الطلبات».** «تحتاج حلًا» counts paid orders that cannot be
   delivered as they stand. «للشحن» counts the paid orders that still have a line
   being prepared (a fully refunded line does not count). «دفعات قيد المراجعة» counts open review
   payments, with or without an order. For the owner, «تحتاج مطابقة» adds the
   refunds that are uncertain (or still submitting with no check scheduled), the
   attempts that could not be verified, the paid payments Moyasar no longer
   calls paid or refunded (a void), the webhook events the job gave up on and
   the refunds made at Moyasar that the ledger does not hold, and opens the
   reconciliation screen. It leaves to the screen the rows the job is still
   working on (an attempt whose creation is uncertain, a refund with a check
   scheduled, a webhook event not yet processed), so the screen can list a row
   that the number does not count yet. «مخزون منخفض»
   lists up to ten variants at or under their alert threshold, fewest first,
   with the SKU and the threshold. Every number is a live query: a failed one
   says «تعذّر التحميل», never 0. The owners also get an email for each alert
   (below).
2. **`/admin/orders`** (the nav entry «الطلبات», after «المتجر», for the owner and
   operations). The filter buttons «الكل», «المدفوعة», «للشحن», «تحتاج
   حلًا», «بانتظار الدفع», «المُعادة» and «قيد المراجعة»; a search by an exact
   order number or an email address («بحث برقم الطلب أو البريد», «بحث», «مسح»;
   anything else is refused with «أدخل رقم طلب كاملًا أو بريدًا إلكترونيًا.»);
   50 rows to a page with «المزيد»; «تحديث»; and, for the owner, «المطابقة». A row
   shows the number, the date, the status, the total, the name, the email, the
   line count, the lines still to ship and the refunded total, with «تجريبي» on
   a test order. The customers list's «طلباته» opens the orders of that address.
   Orders of both modes are listed.
3. **One order** (`/admin/orders/view?id=…`), top to bottom: «العميل والتوصيل»;
   «العناصر» with the totals and what was refunded; «الدفع» (each attempt with
   its status, amount, Moyasar's invoice and payment numbers, Moyasar's last
   status and refunded total, the captured amount, the fee, the source, the
   times and the last error code, with «أعد الفحص» and, on a paid attempt,
   «تسجيل اعتراض» for the owner); the review payments; «إشعارات الدفع» (the
   newest 100 webhook events: type, outcome, times, attempts, error); «الشحن»;
   «الملفات» (each file's state: «ممنوح», «مسحوب» with its reason, «بانتظار
   الملف»); «الإرجاع»; for the owner «إكمال الطلب» when it applies, «النزاعات»,
   «السجل» (the newest 200 audit rows) and «الاستردادات». Operations see all of
   it except the disputes and the audit rows, and cannot refund, complete an
   order or close a review payment.
4. **Shipping and the signed checklist.** «الشحن» takes controls while the
   order is «مدفوع». Select the lines to move (a line that can no longer move,
   because it was refunded meanwhile, is shown unchecked), type «شركة الشحن» and
   «رقم التتبع», and press «تم الشحن»; a shipped line moves on with «تم التسليم»,
   one step at a time. «تم الشحن» needs both fields («أدخل شركة الشحن ورقم
   التتبع.»). A signed edition has a checklist step: «تم الإهداء» ticks that the
   dedication is written, and «تم الشحن» is refused until it is («أكمل الإهداء
   قبل الشحن.»). A fully refunded line is not shipped («عنصر مُعاد مبلغه بالكامل
   لا يُشحن.») and an unpaid order refuses («الطلب غير مدفوع، فلا يُشحن.»). Each
   «تم الشحن» that moves a line queues one `order_shipped` mail with the carrier
   and the tracking number; «تم التسليم» and «تم الإهداء» send nothing, and a
   repeat of what already holds changes and queues nothing.
   Digital lines have no steps: the buyer's order page serves them.
   A line a dispute stopped («إيقاف الشحن») is shown with the badge «موقوف
   بنزاع» and cannot be chosen; «تم الشحن» for it is refused: «أُوقف شحن هذه
   الأصناف بقرار نزاع.» (`FULFILLMENT_STOPPED`; a later row of the same
   reference with another decision lifts the stop). A line that a refund in
   flight allocates is refused: «استرداد قيد التنفيذ على هذه الأصناف؛ انتظر
   نتيجته.» (`REFUND_IN_FLIGHT`). A second «تم الشحن» with another carrier or
   tracking number for a line already shipped is refused (`BAD_TRANSITION`);
   when every chosen line has shipped the same button reads «تصحيح بيانات
   الشحن» and corrects the carrier and tracking of those lines instead
   (`fulfillment_correct`, round M2: no mail, one audit row
   `fulfillment.corrected` with the ids and never the text typed). The mail
   «تم الشحن» queues renews the order's link to at least 7 days from the send,
   so the link in it opens (`fulfillment_update`, round M1b).
5. **The alert emails** go to every active owner (not to operations), each with
   a link to the admin page it concerns, «لوحة الطلبات» for all but two kinds:

| Subject | Alert | Meaning and what to do |
| --- | --- | --- |
| «تنبيه: طلب مدفوع يحتاج قرارك» | `needs_resolution` | The payment arrived and a line cannot be delivered. See "An order that needs a decision". |
| «تنبيه: دفعة تحتاج مراجعة» | `payment_review` | A charged payment could not settle an order. See "Review payments". |
| «تنبيه: مخزون منخفض» | `low_stock` | A variant crossed its threshold when an order was paid. Restock. |
| «تنبيه: استرداد غير مسجّل» | `external_refund` | Moyasar's refunded total is above the ledger's. Record it with «تسجيل استرداد خارجي». |
| «تنبيه: تغيّرت حالة دفعة» | `provider_status` | A paid payment is no longer `paid` or `refunded` at Moyasar (a void, for instance). Look in Moyasar's dashboard; «تسجيل استرداد خارجي» records a void. |
| «تنبيه: تعذّرت معالجة حدث دفع» | `event_exhausted` | A webhook event failed ten times. Look at the payment in Moyasar's dashboard, then «تمت المراجعة» on the reconciliation screen. |
| «تنبيه: دفعة لم يتم التحقق منها» | `attempt_unverified` | Twenty-four hours after the invoice expired the last check still failed. «أعد الفحص». |
| «تنبيه: أكثر من فاتورة دفع للطلب» | `attempt_duplicate_invoices` | An uncertain creation found several invoices for one attempt. In Moyasar's dashboard, cancel the unpaid extras; a payment on one the ledger does not map becomes a review payment. |
| «تنبيه: اختلاف في استرداد» | `refund_mismatch` | Our refund call succeeded after the ledger had closed that refund as failed. The same money shows as «استرداد لدى Moyasar غير مسجّل»; record it. |
| «تنبيه: انخفض إجمالي المسترد لدى مزوّد الدفع» | `refund_total_decreased` | Moyasar's refunded total went down, which should not happen. Look at the payment in the dashboard. |
| «تنبيه: استرداد لم يتم التحقق منه» | `refund_unverified` | A refund has been in flight for more than 24 hours. «أعد الفحص». |
| «تنبيه: دفعة من وضع آخر تحتاج متابعة» | `attempt_mode_changed` | `PAYMENTS_MODE` was changed while a payment attempt that has an invoice was still open, and the job parked it. Once per attempt. See "Changing the payment mode" in the payments runbook. |
| «تنبيه: استرداد من وضع آخر يحتاج متابعة» | `refund_mode_changed` | The same for a refund in flight: it stays for a person to settle in Moyasar's dashboard. Once per refund. |
| «تنبيه: بوابة الدفع ترفض إنشاء الفواتير» | `payment_create_refused` | Moyasar refused to create an invoice (a revoked or wrong key, an account that is not active): no buyer can pay until it is fixed. The mail names the code the refusal was recorded with (`CREATE_REFUSED_401`, for instance). At most one a UTC day. Check the key and the mode ([payments-runbook](payments-runbook.md#the-settings-names-only)). |
| «تنبيه: أُلغي اعتماد السياسات» | `policies_reset` | A policy change reset the approval while the checkout switch was on, so checkout is closed (`POLICIES_NOT_CONFIGURED`) until the owner approves again. Approve the policies on «الإعدادات» («إعدادات المتجر»); the mail's link is «صفحة الإعدادات» (`/admin/settings`). |
| «تنبيه: أوقفنا رسائل التأكيد مؤقتًا» | `confirm_mail_braked` | More than 3 confirmation mails of the last 7 days bounced or drew a complaint, so no more are queued until the count falls (the sign-ups wait in their rows). Once a UTC day while it holds. The mail says how many (`bounced`, from the alert's payload through `alert_email_data`) and that sending returns by itself when fewer than 4 do in 7 days; its link is «صفحة البريد» (`/admin/email`). An alert kind with no wording of its own still gets «تنبيه جديد في المتجر», which names the code. |

### Returns and the restock rule

A buyer's request appears in «الإرجاع» as «مطلوب». «قبول» or «رفض», with an
optional note («ملاحظة (اختياري)»), decides it, and an accepted return waits for
the goods: «تم الاستلام» records that they arrived (owner or operations).

**Goods come back on sale only through a received return, and a refund never
restocks.** At «تم الاستلام» the owner can type, for each line, how many units go
back to stock («يعود إلى المخزون»): at most the quantity of that return, applied
once, with the variant's stock before and after written to the audit row.
Operations mark the goods received but cannot put stock back, because only the
owner says they are sellable, and a preorder line has no such field. Never add
the returned units by hand in the variant form as well: the return's restock is
bounded by the return, not by a stock corrected by hand, so both would count. A
refund moves no stock at all. When the owner refunds an order that was never
shipped, the copy is still on his shelf: raise that variant's stock by hand in
the variant form. A return becomes «أُعيد المبلغ» when a refund linked to it
succeeds.

### An order that needs a decision

«مدفوع: يحتاج حلًا» means the payment arrived and a line can no longer be
delivered: the owner lowered the stock meanwhile, or the hold had expired and the
copy went. Nothing was committed, granted or taken, and the owner got
«تنبيه: طلب مدفوع يحتاج قرارك». He has two ways, and the money is never
relabelled as failed. «إكمال الطلب» then «تأكيد إكمال الطلب» takes the stock for
the lines not refunded, grants the files and sends a receipt, but only when every
such line is available now (`STOCK_UNAVAILABLE`: «المخزون لا يكفي لعنصر في هذا
الطلب؛ عدّل المخزون أو أعد مبلغ العنصر أولًا.») and not while a refund of the
order is in flight (`REFUND_IN_FLIGHT`: «استرداد قيد المعالجة؛ أعد المحاولة بعد
دقائق.»). Or he refunds the line that cannot be delivered first (a fully refunded
line is skipped) and then completes the rest. «إكمال الطلب» is refused when the
money has gone back at Moyasar (`PAYMENT_REVERSED`: «الدفعة مستردّة أو ملغاة
لدى بوابة الدفع؛ سجّل الاسترداد بدل التسليم.»): the payment was voided, or its
refunded total has reached what was captured. A partial refund, such as the
refund of the line that cannot be delivered, does not trigger it (round M2).
Record the refund with «تسجيل استرداد خارجي» instead.

### Refunds and the step-up

The mechanics are in [payments-runbook](payments-runbook.md#refunds). What the
owner does and sees:

- **«إعادة المبلغ»** in the order view (or «استرداد هذه الدفعة» for a review
  payment): an amount in riyals for each line and for the shipping, never above
  what is left of it («المتبقي»), a reason (up to 300 characters, the owner's own
  note, so keep the buyer's name out of it) and, when a received return has no
  refund yet, «ربط بطلب الإرجاع». A bad amount is refused under its field
  («المبلغ أكبر من المتبقي.»). The confirmation then repeats the total and says
  «سيُعاد المبلغ إلى وسيلة دفع العميل عبر Moyasar، ولا يمكن التراجع عنه.».
  **«تأكيد الاسترداد»** is the only thing that sends; the confirmation takes the
  focus itself, so a held Enter cannot confirm, and «رجوع» goes back with the
  amounts kept.
- **The step-up.** A refund, an external refund, a dispute row, saving the
  seller, approving the policies and the checkout switch all need a TOTP verified
  in the last five minutes. Without one the function answers 403
  `STEP_UP_REQUIRED` and the screen opens the dialog «يلزم رمز تطبيق المصادقة
  لإكمال هذا الإجراء.» («رمز التحقق», «تحقق», «إلغاء»); after a good code the same
  request is sent again with the same idempotency key, so nothing is done twice.
  An owner who has not enrolled an authenticator does that in «الأمان» first.
- **What can come back.** «تم» (succeeded). «لم يتم» (failed): Moyasar refused (a
  4xx), nothing moved and the balance is free again. «غير مؤكد» (uncertain): the
  call may have happened, so leave it; the job settles it from Moyasar's own total
  within about 15 minutes, or press «أعد الفحص» on that refund. Pressing
  «إعادة المبلغ» again for the same money is refused while one is in flight
  (`REFUND_IN_FLIGHT`). When Moyasar cannot be reached before anything is
  written, the screen says «تعذّر الوصول إلى بوابة الدفع الآن. لم يتغيّر شيء؛
  حاول بعد قليل.», and when Moyasar already holds a refund the ledger does not
  (`PROVIDER_AHEAD`), the screen offers «تسجيل استرداد خارجي» first.
- **Partial refunds** leave the order «مدفوع»; it becomes «مُعاد» when the
  confirmed refunds equal what was captured. A refunded digital item stops its
  downloads. A refunded unit never goes back on stock by itself (see "Returns
  and the restock rule").
- **A stale screen.** The request carries the confirmed refunded total the
  screen was built from (`expectedRefunded`). If another refund was confirmed
  since, the function answers 409 `STALE` — «تغيّر المسترد منذ فتحت هذه الصفحة؛
  راجع جدول الاستردادات ثم أعد المحاولة.» — before anything is written, and the
  screen reads the order again, so a stale page never refunds the same money
  twice (`refund_request`, round M2; `tests/unit/admin-refunds.test.ts`,
  `tests/unit/admin-money.test.ts`).
- **A chargeback the seller lost.** A refund is refused with `CHARGEBACK_RECORDED`
  — «سُجّل استرجاع بنكي على هذه الدفعة؛ لا يمكن الاسترداد منها.» — while the
  latest row of a `chargeback` reference of the payment is `against_seller`
  (round M1b). A refund already made in Moyasar's dashboard can still be recorded
  with «تسجيل استرداد خارجي». Whether this refusal is the right policy is
  flagged for the owner.

### The reconciliation screen

`/admin/orders/reconciliation` («المطابقة», owner only, opened from the orders
list and from «تحتاج مطابقة» on the home) lists what the ledger and Moyasar still
have to agree on, the newest 100 of each; «تحديث» reloads it. A test row on a
live site is labelled «تجريبي». Each section and what to do:

| Section | What it lists | What to do |
| --- | --- | --- |
| «محاولات تحتاج فحصًا» | Attempts with a reason: «إنشاء غير مؤكد» (`UNCERTAIN`: the invoice creation's outcome is unknown), «لم يُتحقق منها» (`UNVERIFIED`: 24 hours after the invoice expired the last check still failed), «حالة مختلفة لدى Moyasar» (`PROVIDER_STATUS`: a paid payment that is no longer `paid` or `refunded`, a void for instance) and «استرداد لدى Moyasar غير مسجّل» (`EXTERNAL_REFUND`: Moyasar's refunded total is above the ledger's), or «تغيّر وضع الدفع» (`MODE_CHANGED`: `PAYMENTS_MODE` was changed while the attempt, which has an invoice, was still open, and the job parked it; round M1a) | «أعد الفحص» asks Moyasar now (it resolves an uncertain creation by listing the invoices, or settles from the invoice) and says «الحالة الآن: …»; an answered check clears `UNVERIFIED`. For the last two reasons look at the payment in Moyasar's dashboard, then «تسجيل استرداد خارجي» records the refund or the void. For `MODE_CHANGED` the card says «دفعة من وضع الدفع الآخر؛ تُدار من لوحة Moyasar.» in place of «أعد الفحص» and offers «إغلاق بعد المراجعة» (`attempt_dismiss`) once you have looked at the invoice in that mode's dashboard; the attempt then leaves this screen and «تحتاج مطابقة». See "Changing the payment mode" in the payments runbook. |
| «دفعات قيد المراجعة» | Open review payments, with or without an order | See "Review payments". |
| «دفعات بلا طلب أُغلقت مراجعتها» | Review payments with no order that the owner closed by hand and that are not refunded in full, the newest closed 50 (`closedReviews`) | They are still refundable: «استرداد هذه الدفعة» and «تسجيل استرداد خارجي», as on an open one. A payment refunded in full leaves the list. See "Review payments". |
| «استردادات قيد المعالجة» | Refunds in flight, with their status and error code | «أعد الفحص» settles one from a fresh fetch. The job does it by itself; one in flight for more than 24 hours has no due time and waits for this button. A refund of the other payment mode shows the sentence «دفعة من وضع الدفع الآخر؛ تُدار من لوحة Moyasar.» instead of the button, and the job fails one it parks (`MODE_CHANGED`), so it does not stay here. |
| «إشعارات الدفع» | Webhook events not processed, or exhausted after ten tries, that still need a person | Look at the payment in Moyasar's dashboard; when it is settled or nothing is owed, «تمت المراجعة» files the event («سُجّلت المراجعة.»). An exhausted event whose payment the ledger has since settled leaves the list by itself. |
| «النزاعات» | Every reference with its rows | «تسجيل فرق» for a payout or fee difference, «إضافة متابعة» under a reference (see "Disputes and payouts"). |

The screen compares Moyasar's total with the confirmed plus the in-flight
refunds, so our own refund is never shown as an outside one, and it does not
raise a status change once all the money has been refunded (how a void ends).

### Review payments

A review payment is money Moyasar holds for a payment that could not settle an
order: «مبلغ مختلف», «عملة مختلفة», «حالة غير متوقعة», «دفعة ثانية على فاتورة
مدفوعة», «الطلب مدفوع بدفعة أخرى», «فاتورة غير مرتبطة بطلب» or «مستردّة قبل التسوية» (the
payment was already refunded in full at Moyasar when it was first verified, so
nothing is fulfilled for money that went back; a refund in part seen at that
moment is recorded with the payment instead, round M1a). The owners get
«تنبيه: دفعة تحتاج مراجعة». The order is never fulfilled from it and, while it
is open, cannot start another invoice. It shows in the order view (when it has an
order) and on the reconciliation screen. Open the payment in Moyasar's dashboard,
decide, then either:

- **«استرداد هذه الدفعة»**: refund it by its own payment number (the same
  confirmation and step-up as any refund; it never moves the order or its files);
  a payment refunded in full closes by itself; or
- **«إغلاق المراجعة»** with a reason («سبب الإغلاق», one line up to 300
  characters) when the money is already gone elsewhere, a bank reversal for
  instance. Closing is the owner's deliberate act. The reason may not be the word
  `refunded`, which is the refund path's own («لا يُقبل هذا السبب؛ اكتب سببًا
  آخر.»); a closed payment can still be refunded; and a payment with no order
  stays on the reconciliation screen once closed, under «دفعات بلا طلب أُغلقت
  مراجعتها» (the screen says so beside the button: «بعد الإغلاق تبقى هذه الدفعة في
  «دفعات بلا طلب أُغلقت مراجعتها» أدناه، ويمكن إعادتها من هناك.»), the newest 50 that
  are not refunded in full, each with «استرداد هذه الدفعة» and «تسجيل استرداد خارجي» (the
  refund and the external record refuse only a payment closed as `refunded`). A payment
  with an order stays on its order's screen. The count «تحتاج مطابقة» is the open ones only.

### Disputes and payouts

Moyasar's API shows none, so the owner records them by hand from Moyasar's
emails and settlement files (the mechanics and the refusals are in
[payments-runbook](payments-runbook.md#disputes-and-payouts)): «تسجيل اعتراض» on a
payment (from its attempt in the order view, or from a review payment), «تسجيل
فرق» for a payout or a fee difference (no payment) and «إضافة متابعة» for the next
row of a reference. The form asks for the reference exactly as Moyasar writes it
(«المرجع»), the kind («النوع»: «اعتراض بطاقة», «فرق تحويل», «فرق رسوم» or «أخرى»),
the amount in riyals, the direction («الاتجاه»: «على البائع» or «لصالح البائع»),
the day (not in the future), the reason, an optional resolution («الحل (اختياري)»)
and a decision («القرار»): «بلا إجراء», «سحب الملفات» (the named items' downloads
stop), «إبقاء الملفات» or «إيقاف الشحن» (recorded only, for lines still being
prepared). The owner and a fresh TOTP are needed. Rows are append-only: nothing
edits or deletes one, a correction is a new row, and recording the same row twice
changes nothing. A dispute never refunds, never changes the order and never calls
Moyasar: refund separately when money is returned. The statistics show the latest
row of each reference, beside the money and in neither the total nor the net.

**Recording is not answering.** Moyasar's platform terms (the audit read the
English page, last revised 14 April 2026, on 2026-10-07: sections 7.2, 9.1 and
7.6; the account's own agreement may differ, so Anas confirms them with Moyasar)
give the merchant three business days from the notice to answer an inquiry or an
information request, charge 200 SAR when no answer or too little documentation
comes within them, and treat a charge as final when no written objection reaches
Moyasar within 30 days of the statement. The settlement file the owner records
from can arrive after the three days, so a claim is answered when Moyasar's email
arrives, and recorded afterwards:

- **Answer with the order's evidence:** the order number, the items, the receipt
  mail, the carrier and tracking number («الشحن» in the order view) and, for a
  digital item, what the system recorded of the downloads, which the order view
  does not show. In the SQL editor:

  ```sql
  select o.order_number, e.granted_at, e.revoked_at,
         t.created_at as link_issued, t.uses, t.max_uses, t.last_used_at
    from finance.entitlements e
    join finance.orders o on o.id = e.order_id
    left join finance.download_tokens t on t.entitlement_id = e.id
   where o.order_number = '<number>'
   order by t.created_at;
  ```

  A token's `uses` and `last_used_at` say when signed file links were issued, not
  that the buyer's device received the file.
- **Object in writing within 30 days** to a payout or fee difference, before
  recording it with «تسجيل فرق»: a difference nobody objected to becomes final.

**SADAD bills cannot be refunded through the API.** Moyasar's SADAD guide (read
by the audit on 2026-10-07) says that SADAD appears on the hosted invoice page
automatically when it is enabled; that the invoice stays `on_hold` while the bill
awaits payment and then becomes `paid`; that refund, capture and void return
`unsupported_operation` for a SADAD bill; and that SADAD is on by default in test
mode and enabled for live by contacting support. So in the sandbox a tester who
picks SADAD leaves an `on_hold` invoice, and a refund of that order answers «لم
يتم». If SADAD were enabled live, a SADAD buyer could never be refunded from the
admin; a bill paid after the 20-minute hold lands as a late payment whose usual
resolution, a refund, is impossible through Moyasar; and a refund made outside
Moyasar cannot be recorded, because «تسجيل استرداد خارجي» answers `NO_DELTA`
unless Moyasar's refunded total rose. **Open decision for the owner:** whether
SADAD is enabled on the live account (keep it off unless Anas accepts refunds
made outside the system, which the ledger cannot record), and whether an owner
action that records a refund made outside Moyasar is built before launch (it is
not built).

### The paid file

A digital variant's file is uploaded in its variant form («الملف المدفوع», owner
only): «رفع الملف المدفوع», a PDF or an EPUB up to 100 MiB (the `paid-files`
bucket's own limit, 104857600 bytes; the screen says «PDF أو EPUB، حتى 100
ميغابايت.»; on a Free project the platform's own limit is 50 MB, see "Hosted
checks still owed (I32)"). The browser uploads straight to Storage under
`incoming/<ticket>`.
The `admin` function then checks what arrived and refuses a stored type that is
not the declared one (`TYPE_MISMATCH`), a size over the limit (`TOO_LARGE`), a PDF
that does not start with `%PDF-` (`NOT_A_PDF`) and an EPUB that is not a ZIP whose
first entry is `mimetype` holding `application/epub+zip` (`NOT_AN_EPUB`); a file
that was never uploaded is `MISSING_FILE`. These are header checks, not a scan. A
refusal removes the upload and says why. A good file moves to
`assets/<variant id>/<asset id>`, where `paid_asset_set` records it. `BUSY` (409:
orders waiting for this file are being processed) keeps the upload under its
ticket, and the screen offers «أعد المحاولة».

**What happens to waiting orders.** A digital item paid before its file existed
(a digital preorder) has an entitlement with no file. When the file is recorded,
every such granted entitlement gets it, its order's link is renewed for 7 days and
one `order_ready` mail goes to that buyer. An entitlement that already has a file
keeps it («يحل الملف الجديد محل الحالي في الطلبات الجديدة؛ الطلبات التي استلمت
ملفًا تبقى عليه.»), and a revoked one gets nothing. An abandoned upload is removed
by the daily media sweep once it is 24 hours old. The bucket is private with no
policy, and the files are in every backup.

### Availability sign-ups and notices

On a product page a variant that is out of stock shows «غير متوفر حاليًا» and a
form (an address, Turnstile and the privacy revision the page rendered) with the
button «أخبرني عند توفره». Whatever the outcome, the visitor reads the same
sentence («إن لم تكن مشتركًا من قبل فستصلك رسالة لتأكيد الاشتراك.»), so the page
says nothing about any address. A sign-up starts `pending`; the mail «أكّد طلب
التنبيه» carries a link, valid for 7 days from the moment the mail was queued,
that confirms it; a confirmed subscriber stays one until he unsubscribes through
the link every notice carries. `availability-sweep` runs every minute: when a
variant becomes sellable again (published, enabled, priced, and in stock, or a
preorder with room; other orders' unpaid holds never flap it) it adds one to the
variant's revision and queues one «توفّر …» mail for each confirmed subscriber not
yet told that revision, once per revision. **While checkout is switched off the
sweep does nothing at all**: nobody is told that something is back while nothing
can be bought, so opening the shop is what tells the subscribers of what came back
meanwhile, and closing and opening it again tells nobody twice.

The owner reads the sign-ups in `/admin/store/notifications` («طلبات الإشعار»,
read-only, with no «جديد»): the address, the SKU, the status («بانتظار التأكيد»,
«مؤكَّد» or «ألغى الاشتراك»), the consent revision (the privacy-policy revision
the visitor's page showed, or «بلا») and the times. To restock, the owner raises
the variant's stock in the variant form. The caps are all silent, so the page's
sentence is never a lie: 5 sign-ups an hour per caller, one confirmation mail per
address per UTC day across variants, five per address in 30 days, 30 in all per
day; `notify-confirm-backlog` runs hourly and queues, longest waiting first, what
a cap held back, so a visitor told «sent» gets the mail the next day at the latest
unless the address's own caps hold it. `notifications-purge` deletes a pending
sign-up 7 days after its last request or after the confirmation mail queued for
it, whichever is later (the link lives 7 days from that mail), and an
unsubscribed one 30 days after it unsubscribed, with their unsent mail; a
confirmed one is never purged. An address in the suppression list (a bounce, a
complaint) is sent neither the confirmation nor the notice that the item is back:
the sign-up is stored, and nothing is queued or counted against the day's 30.

### Preorders

Anas's answer (questionnaire Q05, 2026-10-01): no preorder at opening; the sale
starts once the copies arrive. The capability is built and off: a variant is a
preorder only when the owner switches it on in its variant form, and no seed or
migration sets that on a real variant. To turn one on, open the variant (store,
the product, the variant), switch «طلب مسبق» on and fill «سعة الطلب المسبق» (how
many may be sold, at least 1), «موعد التسليم» (a day that has not passed) and
«ملاحظة الطلب المسبق» (one line, up to 300 characters, shown to the buyer before
paying: «تظهر للمشتري قبل الدفع.»). Saving with any of them empty is refused,
naming the field. While it is a preorder the product page shows «اطلب مسبقًا»
with the delivery date and the note, and the cart and the checkout repeat them.
Its **stock is ignored and never decremented**: what can be sold is the capacity
less the units of committed preorder reservations less other orders' unpaid
holds. A preorder whose delivery day has passed is not for sale (the form refuses
a past date for the same reason), so change the date or switch it off. A digital
preorder's file is uploaded later, and the waiting orders get it (see "The paid
file"). A refund of a preorder item frees its capacity again only for a line
that has not shipped; for a line that has shipped or been delivered the
capacity stays spent (the copy has left), and a copy that comes back is counted
by raising the capacity by hand.

**Net confirmed preorders out of real stock.** When the copies arrive and the
preorder is switched off, the stock the owner types must be the real stock minus
the confirmed preorders not yet shipped. The variant form shows «طلبات مسبقة
مؤكدة لم تُشحن» with that count and, for a physical or signed variant, the
sentence «أدخل المخزون الفعلي بعد طرح هذه الطلبات.». Shipped copies have already
left the stock he counts, so they are not in the number (the capacity rule still
counts every committed one).

### The checkout switch

`finance.commerce_settings.checkout_enabled` is false on every database the
migrations create. In `/admin/settings` the «الشراء» box shows the payments state
(«الدفع غير مضبوط», «الدفع مضبوط: وضع تجريبي، محاكٍ محلي», «الدفع مضبوط: وضع
تجريبي» or «الدفع مضبوط: وضع حي»), whether buying is open («الشراء مفتوح» or
«الشراء مغلق») and one button, «افتح الشراء» or «أغلق الشراء», which needs a TOTP
verified in the last five minutes. Opening is refused while the payment settings
are not working (`PAYMENTS_NOT_CONFIGURED`, so it cannot be turned on for a
project without keys) and while the seller is not named or the policies are not
approved (`NOT_READY`: «أكمل بيانات البائع واعتمد السياسات أولًا.»), and the quote
offers checkout only while all of that holds. The box says what it does: «يتحكم
المفتاح في استقبال الطلبات الجديدة فقط؛ الطلبات القائمة تُدفع وتُلغى كما هي.»
That is, an order that already exists can still be paid, cancelled and settled
after the switch is closed or the policy approval is reset. Publishing a new
revision of an approved policy resets the approval and so closes checkout until
the owner approves again. The box says so: it reads «الشراء مفتوح» only while the
store really takes orders; with the switch on and the seller unset or the
policies unapproved it reads «الشراء مغلق: بيانات البائع ناقصة» or «الشراء مغلق:
السياسات تحتاج اعتمادًا (انظر «اعتماد السياسات» أعلاه)», and «الشراء مغلق» with
the switch off (`checkoutOpen` and `checkoutClosedReason` of
`commerce_settings_get`, round M1b). A policy change that closes a switched-on
checkout also queues the owner alert `policies_reset`. On a hosted site in test
mode the sandbox fence also
applies ([payments-runbook](payments-runbook.md#the-sandbox-fence)). Opening the
shop also lets the availability sweep tell subscribers of what came back
meanwhile.

### The mail budget

Resend's free plan sends 100 a day and 3,000 a month (UTC days and months; see
"Quota"). P08 makes three tiers of the day's 100, so that what a visitor can
trigger waits before what a payment or a staff action causes:

| Priority | Kinds | Sent while the day's sends are under |
| --- | --- | --- |
| 0 | `receipt`, `order_shipped`, `order_refunded`, `order_ready`, `owner_alert` | 95 (the last five sends of the day are kept for sign-in codes) |
| 1 | `contact_notice`, `order_link` (at most 20 sends a day) | 80 |
| 2 | `notify_confirm` (at most 30 sends a day), `availability` | 50 |

So availability notices wait before recovery links and contact notices, and those
before receipts. Priority 0 holds only mail that a payment or a staff action
causes, and nothing a visitor can trigger is in it. Contact notices have no cap in
the claim: `contact_submit` already takes 40 messages a day, and one message is
one notice for each active owner or operations member. The 20 sends held back from
everything but priority 0 are the room for receipts and alerts; the last five of
the day, which priority 0 may not use either, are the room for sign-in codes,
which share the Resend account. A row closed because the state moved on after it was queued
(`NOT_PENDING`, `NOT_CONFIRMED`, `NO_FILE`) or because its recipient is no longer
an active owner (`RECIPIENT_INACTIVE`) does not show in the email screen, since
nothing is left for a person to do; the others (`GONE`, `NO_SHIPMENT`,
`NO_REFUND`, `RENDER_FAILED`) do. While email, `SITE_URL` or the token pepper is
not configured the whole run is skipped before any claim (`EMAIL_NOT_CONFIGURED`,
`SITE_NOT_CONFIGURED`): the rows wait and no attempt is spent. When mail is held
the home says «بريد محجوز بسبب حدّ الإرسال. يُرسل تلقائيًا عند تجدّد الحد.»

### Reading the payment job

The home lists the reconciliation job as «مطابقة المدفوعات» (its last run, and the
line «مدفوعات تنتظر المطابقة…» when work has been due for more than 10 minutes
with no run since). When something sticks and the line says too little, read the
run in the SQL editor: `select status, detail, finished_at from finance.job_runs where job =
'payments_reconcile' order by finished_at desc limit 5;`. `detail` holds counts
only (`attempts`, `events`, `refunds`, `settled`, `cancelled`, `errors`,
`skipped`; `{"reason": "PAYMENTS_NOT_CONFIGURED"}` for a skipped run).
`select count(*) from finance.payment_attempts where next_check_at <= now();`
counts the attempts that are due. No run for a long while with something due
means pg_cron or the Vault secrets (`functions_url`, `jobs_secret`) are missing,
and then nothing reconciles on its own; the webhook, the callback and the return
page still settle what they are asked about. Run records are purged after 30 days
like the others.

### Residuals and ceilings (accepted)

- **No per-email hold** (`PLANS/P08-CONTRACT.md`, section 13.1, which recorded the
  acceptance of less than the numbers under "Checkout holds and limits"). P07 limited
  active holds per normalized email. P08 removed it: anyone could hold a known
  address, the refusal confirmed that a live order exists, and it never bound an
  abuser, who rotates emails freely, while it only ever stopped the address's real
  owner. What remains is one hold per checkout session, 10 creates an hour per
  salted IP hash, Turnstile and the 500 orders a day. Residual: no limit on the
  units unpaid holds take of one variant, so one address can hold 200 units per
  20-minute window (the arithmetic and the open decision are under "Checkout
  holds and limits").
- **An asset left under `assets/` with no row.** A paid file's object can stay
  under `assets/` with no `finance.paid_assets` row (a completion whose outcome was
  unknown and did not commit, or two Storage failures in a row). Nothing removes it
  automatically: a sweep of `assets/` could race a completion, and a paid file must
  never be removed by a job. It is private and rare. List the strays when nobody is
  uploading a file:

  ```sql
  select o.name, o.created_at, (o.metadata->>'size')::bigint as bytes
    from storage.objects o
   where o.bucket_id = 'paid-files' and o.name like 'assets/%'
     and not exists (select 1 from finance.paid_assets a where a.storage_key = o.name)
   order by o.created_at;
  ```

  An object listed on two runs a minute apart is an orphan. Remove it in the
  dashboard's Storage browser, never with SQL: Storage refuses direct deletes, and
  one would orphan the bytes. The command line form,
  `supabase storage rm --linked --experimental ss:///paid-files/<name>` (the path
  form `pnpm backup` uses with `storage cp`), has not been run, so prefer the
  dashboard, and if you use the command, list the object again to confirm that it
  is gone.
- **The checkout page's budget.** `checkout.html` is at 149.7 of the 150 KiB
  public JavaScript budget, 0.3 KiB of headroom (`pnpm check:budgets` on the
  owner's machine on 2026-10-14, as in CI on `b3fa932`; ISSUES I50). The next
  change to the checkout page, `quote.ts` or `cart.ts` that needs room loads the
  checkout form body on demand, about 5 KiB.
- **Recovery and confirmation mail can be spent by others.** Someone who knows 20
  customer addresses can use the day's 20 `order_link` mails, and someone else can
  spend one address's 3 requests an hour. Someone with 30 addresses and 30
  Turnstile passes can use the day's 30 `notify_confirm` mails, after which
  sign-ups wait for the next day's backlog. The caps protect the 100 a day, not
  any one person.
- **Mail limits and links.** Two dispatcher runs at the same moment can pass a tier
  or a cap by one mail; an unsubscribe or a revoked owner that lands between the
  claim and the provider call still sends that one mail; a link mailed more than 7
  days late is dead.
- **Sandbox leftovers on a live site.** The staff functions take no mode, so a
  sandbox order can still be shipped or completed after going live (the list
  labels it «تجريبي»). Settle or ignore them first (the payments runbook, "Before
  live").
- **A review payment with no order** leaves every screen once the owner closes it
  by hand (ISSUES I50).
- **An interrupted backup rehearsal is not proven on Windows.** The rehearsal
  with a paid file passes on the owner's machine (Docker Desktop 4.91.0,
  2026-10-15, after the fix of ISSUES I56: 66 tables, 223 storage objects with
  the paid file and 15 schedules verified, every published port on 127.0.0.1;
  `artifacts/acceptance/I56/RECORD.md`). A Ctrl+C is meant to clean up, and
  closing the console can cut the stop short; neither has been tried there yet
  (ISSUES I53 (3) names the commands that look for a leftover).
- **Other P08 residuals** are in ISSUES I50: the variant form reads the paid
  file's storage key, which the private bucket makes harmless on its own, and
  `create`'s own `OUT_OF_STOCK` refusal carries no «الكمية محجوزة مؤقتًا لطلب
  آخر؛ حاول بعد قليل.» wording (only the quote does).
- **Anyone can spend the project's invocations and egress (open: the owner's
  decision, EF-ACCESS-14).** `contact`, `checkout`, `payments`, `orders`,
  `download`, `notify`, `outbox` and `resend-webhook` run with `verify_jwt =
  false` and check the method, the origin and their own secrets themselves;
  every throttle sits in SQL, after the invocation. Supabase bills an invocation
  whatever status it answers, preflight requests aside (the audit's reading of
  Supabase's usage page, 2026-10-07), and its Functions limits page documents no
  per-caller limit. A loop of `curl -X POST` against the function addresses needs
  no Turnstile token to be billed, and can pass the Free plan's 500,000
  invocations (docs/costs.md); Supabase's Fair Use Policy then lets it restrict
  the organization — it names pausing projects, switching databases to read-only
  and answering 402 to every API request until the next billing cycle or an
  upgrade (the audit's reading of its billing page, 2026-10-07). The same holds
  for Storage egress: a signed paid-file link can be fetched again while it lives.
  Nothing in the repository measures invocations or egress. The response is not
  decided: a usage alert on both (P10's monitoring) and a flood step in this file
  (upgrade, or turn Pro's spend cap off for the rest of the cycle and accept the
  per-million price; docs/costs.md) are to be chosen before launch. A Cloudflare
  front would not remove the risk, because the project's own function and Storage
  addresses stay public.

### Hosted checks still owed (I32)

The local stack cannot make these. They are P11's, to be added to I32 at the
close; whether each one blocks launch is decided when it is added there.

- **CORS of `orders` and `download`.** The local gateway answers preflights itself
  and rewrites the allowed origin, so the functions' own CORS answer is proven only
  in process. On the hosted project a preflight and a POST from a foreign origin
  to `orders` and to `download` must be answered with the site's origin
  (`SITE_URL`) only.
- **Range and `nosniff` on the file reply.** Whether Storage's own response to the
  60-second signed link honours a `Range` request (the paid-file check reads the
  first bytes that way) and carries `X-Content-Type-Options: nosniff`. The
  `download` reply itself sends `Referrer-Policy: no-referrer`.
- **The `_headers` rules of `/orders`, `/checkout/return` and `/notify/*`.** In
  `public/_headers` each is `Referrer-Policy: no-referrer`, `Cache-Control:
  no-store` and `X-Robots-Tag: noindex`. Pages must serve all three; on
  `/checkout/return`, check that Pages' joining of the `Referrer-Policy` values
  leaves `no-referrer` in force (round 4b expects the browser to take the last
  valid token of the joined values, which is the check's question).
- **The paid files' limit: 50 MB on a Free project.** The bucket's own limit and
  the local stack's are 100 MiB (`supabase/config.toml`), and the variant form
  says «PDF أو EPUB، حتى 100 ميغابايت.». Supabase's documentation (read by the
  audit on 2026-10-07, supabase.com/docs/guides/storage/uploads/file-limits) says
  that a Free project's global file size limit cannot exceed 50 MB, that a
  bucket's own limit cannot be higher than the global one, and that a paid plan
  can raise it; docs/costs.md lists the same 50 MB for Free. So on the Free
  project a paid file between 50 MB and 100 MiB is refused by Storage although
  the form promised 100: keep a paid file under 50 MB while the project is Free,
  and on Pro set the project's global limit to 100 MiB in its Storage settings (a
  hosted setup step for P11 and E07). Unverified on the hosted project: the limit
  it really applies.
- **Hosted Auth settings (I28).** `supabase/config.toml` turns Turnstile on for
  the sign-in code request and makes the code eight digits; the hosted project
  needs the same two settings in its own dashboard (the Turnstile secret, the
  code length). Until they are set there, the sign-in page's widget and its
  eight-digit field meet a hosted Auth that asks for neither, and the request
  for a code is not protected. Unverified on the hosted project.
- **The functions' database key (I28, EF-ADMIN-01).** `supabase/functions/_shared/db.ts`
  takes the key from `SUPABASE_SECRET_KEYS` (the dictionary Supabase now
  provides) before the legacy `SUPABASE_SERVICE_ROLE_KEY`, because a project
  created or restored after the legacy keys went away has none
  (`tests/unit/env.test.ts`). Prove one function against the hosted project, with
  the legacy keys disabled if the dashboard allows it (the owner home loading is
  enough). Unverified on the hosted project.

## When something goes wrong

Procedures for what the daily routine does not cover. Each one says what the
repository records and what it does not: a step that rests on a hosted setting
nobody has checked says "unverified on the hosted project", and a step that was
never run on a real project says so. A key, a secret or a link never goes into a
document, a chat, a commit or a log. The restore of a lost project is under
"Backups (D35)".

### Rotating a secret

Nothing in the repository rotates a secret, and the one Vault line the setup
gives, `vault.create_secret`, fails for a name that already exists. A Vault
value that is already there is changed in place. The form below is the one the
audit read in Supabase's Vault guide on 2026-10-07, which says that a secret's
name is unique and that changes go through `vault.update_secret`; it has not
been run here:

```sql
select vault.update_secret((select id from vault.secrets where name = '<name>'), '<new value>');
```

A function secret is changed with `supabase secrets set NAME=<new value>`, with
the CLI linked to the hosted project. How soon a running function sees a changed
secret has not been measured (unverified on the hosted project), so confirm each
change with the check in its entry instead of assuming it. Four values have a
second copy somewhere else (`JOBS_SECRET`, `MOYASAR_WEBHOOK_SECRET`,
`RESEND_WEBHOOK_SECRET` and the Pages deploy hook): a rotation that changes one
side only breaks the link until the other side follows, so change both within
the same few minutes.

- **`JOBS_SECRET` and the Vault `jobs_secret`** (a long random value of the
  owner's choosing). Set both: `supabase secrets set JOBS_SECRET=…` and
  `vault.update_secret` on `jobs_secret`. Until they match, every pg_cron kick
  (`outbox_kick`, `payments_kick`, `media_sweep_kick`) is refused with 401 by the
  `outbox` function: no mail is sent, nothing is reconciled and the media sweep
  does not run. Nothing is lost, the rows wait; the webhook, the callback and the
  return page still settle payments. Check: the next row of
  `select job, status, finished_at from finance.job_runs order by finished_at desc limit 5;`
  after something is due.
- **`MOYASAR_WEBHOOK_SECRET` and the Secret Token on the webhook in Moyasar's
  dashboard** (at least 32 characters). Set both. Until they match, every webhook
  answers 401 and leaves the log line `payments: webhook refused UNAUTHORIZED`.
  Moyasar retries a refused delivery (the schedule is in the payments runbook,
  "Sources"), so a gap of minutes loses nothing the retries do not bring back, and
  the return page and the job settle payments meanwhile; a refund or void made in
  the dashboard during the gap reaches the ledger through a retry or the owner's
  «أعد الفحص». Check: the next payment, or a test event from the dashboard, leaves
  a new row in `finance.payment_events`.
- **`MOYASAR_SECRET_KEY`.** Regenerated in Moyasar's dashboard (a secret key is
  shown once). Its prefix must match `PAYMENTS_MODE` (`KEY_MODE_MISMATCH`
  otherwise). Until the function holds the new key every call to Moyasar is
  refused: invoice creation fails and the buyer reads «تعذّر تجهيز الدفع؛ حاول
  بعد لحظات.», the attempt closes as `CREATE_REFUSED_401`, and the owners get
  «تنبيه: بوابة الدفع ترفض إنشاء الفواتير» (once a UTC day). If the key leaked,
  regenerate at once and close «الشراء» for the minutes in between. Whether
  Moyasar keeps the old key working for a time is not recorded here
  (unverified). Check: «أعد الفحص» on an attempt answers «الحالة الآن: …», and the
  next invoice is created.
- **`RESEND_API_KEY`.** Create the new key in Resend's dashboard first, set it as
  the function secret, then delete the old one. A key Resend refuses (401 or 403)
  is `PROVIDER_CONFIG`: the outbox stops the run and gives the attempt back, the
  row waits 15 minutes and nothing is exhausted while the owner fixes the account
  (rounds F1 and M1b; `tests/unit/outbox.test.ts`, `tests/unit/email.test.ts`), and
  the run is recorded `failed` with that reason in its detail
  (`select detail from finance.job_runs where job = 'email_outbox' order by finished_at desc limit 1;`).
  Supabase Auth's SMTP on the hosted project uses a Resend key as its password
  (I28); if it is this key, change it in the dashboard's Auth SMTP settings too,
  or sign-in codes stop. Which key I28 uses is not recorded (unverified on the
  hosted project).
- **`RESEND_WEBHOOK_SECRET`.** Resend shows the endpoint's signing secret
  (`whsec_…`) on the endpoint's page; set the function secret to it. Until the two
  agree the endpoint answers 401 to Resend's events (404 if the secret is unset):
  bounces and complaints in the gap may never be recorded as suppressions, and
  whether Resend redelivers them is unverified. The settings screen's «أحداث تسليم البريد
  (Webhook)» says مضبوط only for a secret the verifier can read, `whsec_` followed by base64
  that decodes to a key: a value pasted with a stray or missing character shows غير مضبوط. A
  well-formed but wrong secret still shows مضبوط (no time of a last verified event is kept),
  so check: a mail to yourself leaves a
  `delivered` row in `select type, received_at from finance.email_delivery_events order by received_at desc limit 5;`.
- **`TURNSTILE_SECRET_KEY`.** Rotated on the widget in Cloudflare's dashboard;
  set the function secret. Once Cloudflare no longer accepts the old secret every
  contact, checkout, orders and notify request that carries a token answers 503
  `TURNSTILE_UNAVAILABLE` (siteverify answers `invalid-input-secret`, see "The
  contact flow"). If the staff sign-in's CAPTCHA uses the same widget, the hosted
  Auth setting holds a copy too (I28, unverified on the hosted project): change it
  there as well, or the request for a sign-in code is refused.
- **`ANALYTICS_TOKEN`** (a read-only Cloudflare token). Create the new token, set
  the function secret, delete the old token. Meanwhile the statistics screen says
  «غير متاح…»; nothing else depends on it. `CLOUDFLARE_ZONE_ID` is an id, not a
  secret.
- **The Pages deploy hook (Vault `pages_deploy_hook`).** The hook address is the
  secret: anyone who has it can spend the 500 builds a month of the Free plan
  (docs/costs.md). Delete the leaked hook and create a new one in the Pages
  project's settings, then in the SQL editor
  `select vault.update_secret((select id from vault.secrets where name = 'pages_deploy_hook'), '<new hook address>');`
  and `select public.site_build_request();`, so that the next minute's
  `site_build_trigger()` builds without waiting for a publish. Until the new
  address is in, the calls fail and, after five tries, the home says «بناء الموقع:
  فاشل»; the same steps repair a hook that broke.
- **`PAYMENTS_TEST_ACCESS_CODE`** (hosted test mode only). Choose a new value (16
  characters or more), set it, and give it to the testers again; nothing stored
  depends on it.
- **Supabase's own keys.** The project's keys are regenerated in the dashboard's
  API settings. The functions read the key Supabase provides to them
  (`SUPABASE_SECRET_KEYS`, else the legacy `SUPABASE_SERVICE_ROLE_KEY`,
  `supabase/functions/_shared/db.ts`); the publishable key is built into the
  static site (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), so a new one needs a
  rebuild. Not rehearsed (unverified on the hosted project).
- **`TOKEN_HASH_PEPPER` is not rotated.** Every order's access token is derived
  from it and the database keeps only a hash made with it; so are the
  confirmation and unsubscribe links, the download tokens' stored hashes and the
  throttles' caller keys (`supabase/functions/_shared/tokens.ts`). A new value
  makes every stored order link and every link already mailed stop matching. If
  it leaks, that is a decision for the owner, not a procedure: nothing re-issues
  links in bulk, and the owner's «إعادة إرسال رابط الطلب» does one order at a time
  ("A leaked order link"). A buyer who asks again through «استعادة رابط الطلب» is
  repaired the same way, one order at a time: recovery compares the hash the order
  stored with the one the current pepper makes of its link's token and, when they
  differ, mails the next version's link, which matches (the links already in
  mailboxes stay dead). After a restore reuse the original.

### After a webhook outage, or when a buyer says he paid twice

Moyasar's webhook is the only thing that looks at a payment after it is paid. A
paid attempt is never scheduled for a check again (`next_check_at` is null once it
is paid), and the callback, the return page and the job ask only about attempts
that are not paid. So a second payment on an invoice that is already paid, a
payment on an invoice no attempt maps, and a refund or a void made in Moyasar's
dashboard reach the ledger through the webhook, or through the owner's «أعد الفحص»
on the paid attempt. Moyasar retries a refused delivery 5 more times, after waits
of 1 minute, 10 minutes, 30 minutes, 1 hour and 2 hours, and then drops it (its
webhook reference, read 2026-10-02). An outage longer than that leaves such events
unrecorded: no review payment, no owner alert, money at Moyasar that the admin
does not show.

**Noticing an outage.**

- The function's log has one line for each refused delivery: `payments: webhook
  refused` and a code, `METHOD_NOT_ALLOWED`, `TOO_LARGE`, `BAD_JSON`, `INVALID` or
  `UNAUTHORIZED` (round F1; nothing else is logged, never a body, a token or an id;
  `tests/unit/payments.test.ts`). A run of `UNAUTHORIZED` is a Secret Token that
  differs between Moyasar and `MOYASAR_WEBHOOK_SECRET`.
- A paid order whose «إشعارات الدفع» list in the order view has no `payment_paid`
  event, or `select event_id, type, live, received_at, outcome from finance.payment_events order by received_at desc limit 10;`
  showing nothing recent after payments, means the webhook did not arrive.
- Moyasar's own record of deliveries: the audit read in Moyasar's API pages that a
  webhook's attempts can be listed (`GET /v1/webhooks/attempts`, 2026-10-07);
  this repository has not used it, and whether the dashboard shows the same is
  unverified.

**After an outage, or for a buyer who writes "I was charged twice".**

1. In Moyasar's dashboard list the payments of the window, or of the buyer. Every
   invoice the store makes carries the order number in its description «طلب
   <number>» and in its metadata.
2. For each payment find the order in `/admin/orders` (search by the number) and
   open its «الدفع» block. On the paid attempt press «أعد الفحص»: it fetches the
   invoice and settles every payment the invoice lists, oldest first. A second
   charged payment becomes a review payment (`SECOND_PAYMENT`, «دفعة ثانية على
   فاتورة مدفوعة») with the owner alert «تنبيه: دفعة تحتاج مراجعة»; a payment that
   was voided or refunded in the dashboard is applied as well, so a changed
   status or an unrecorded refund raises its alert («تنبيه: تغيّرت حالة دفعة»,
   «تنبيه: استرداد غير مسجّل»). Since round F1 the recheck also reads voided
   payments (`supabase/functions/_shared/payments.ts`); before it a void was
   missed.
3. A refund or a void made in the dashboard that the ledger does not show:
   «تسجيل استرداد خارجي» (it fetches the payment itself and records the
   difference; a void records the whole unrefunded amount).
4. A duplicate charge is returned from its review payment: «استرداد هذه الدفعة»
   (the same confirmation and step-up as any refund).
5. A payment on an invoice no order maps (the store did not make it, or its
   attempt is gone) is out of reach of «أعد الفحص», which works from an attempt:
   decide it in Moyasar's dashboard. Whether the account is dedicated to the store
   is an open decision for the owner (EF-MONEY-01): any invoice made by hand in the
   dashboard, a payment link or another shop on the account arrives as a review
   payment `UNMAPPED_INVOICE` with an owner alert, and could be refunded from the
   admin by mistake.
6. Afterwards open the reconciliation screen and the home's «تحتاج مطابقة»: both
   should be empty, or hold only what a person has decided to leave.

### The project was paused

A Free Supabase project with too little database activity for a week is paused
(Supabase's page on pausing, read by the audit on 2026-10-07,
supabase.com/docs/guides/platform/free-project-pausing); the plan forbids keep-alive
traffic ("no fake heartbeats", DECISIONS). The static pages still load, but
everything that talks to the project fails: library images (their addresses are
built on the project), the contact form, availability sign-ups, the cart's live
prices, checkout and payment, the order pages, staff sign-in and the admin,
scheduled publishing, the outbox and every pg_cron job, and every rebuild (a build
reads the database; the last good deploy stays live). The owner home cannot say so,
because it is down too, and the payments Moyasar sends meanwhile are refused (see
"After a webhook outage"). ARCHITECTURE once called a pause harmless before
orders; it is not harmless once the site is live.

To resume, press «Resume project» in the Supabase dashboard; how long Supabase
allows for it is not recorded here (read the dashboard's note). Then check, in this
order:

1. `select jobname, schedule from cron.job order by 1;` (fifteen rows) and
   `select name from vault.secrets order by 1;` (`functions_url`, `jobs_secret`,
   `pages_deploy_hook`).
2. One function call that needs the database key: the owner home loads (it calls
   `admin`), or a contact-form message arrives as a notice. The functions take
   `SUPABASE_SECRET_KEYS` before the legacy key (`supabase/functions/_shared/db.ts`,
   `tests/unit/env.test.ts`), which matters for a project resumed after the legacy
   keys went away (the audit's EF-ADMIN-01 evidence: Supabase retires them by the
   end of 2026); unverified on the hosted project.
3. The home's job lines «إرسال البريد», «مطابقة المدفوعات» and «بناء الموقع» run
   again within minutes; the mail and the reconciliation work held during the
   pause are picked up by themselves.
4. Payments made during the pause: the webhook procedure above.

**Open decision for the owner (E07):** accept pauses on the Free plan until
Supabase Pro, or move to Pro before launch, or watch Supabase's pause mails
(docs/costs.md).

### Removing access in a hurry

**A member who is not the only owner.** In the team screen press «إيقاف» (it asks
«إيقاف <name>؟»; owner at aal2, with an authenticator code from the last five
minutes). The revoke sets `active = false`, so RLS and every staff function refuse
the member from then on, bans the Auth account for good, and ends the member's
Auth sessions and refresh tokens (`public.staff_sessions_end`, rounds M1b and F1;
before it a later restore brought every old session back).
An access token already issued lives until it expires (`jwt_expiry` is 3600 seconds
in the local config; the hosted value is I28, unverified) but cannot act. «استعادة»
lifts the ban and the member signs in again with a new code. If a step fails the
screen says which, and what it offers:

| The answer | What it means | What the screen offers |
| --- | --- | --- |
| «تعذّر إيقاف الدخول؛ لم تتغيّر حالة العضو. حاول مرة أخرى.» (`BAN_FAILED`) | The ban failed and the change this call made was undone: the member is as before. | «إيقاف» again. |
| «حُدّثت الحالة لكن تعذّر إيقاف الدخول. حاول مرة أخرى.» (`ROLLBACK_FAILED`) | The ban failed and the undo did not hold: the member is revoked in the staff table, but the Auth account is not banned and the sessions are not ended. | «حاول مرة أخرى» beside «استعادة». |
| «لم يكتمل إيقاف الدخول؛ العضو ما زال موقوفًا. حاول مرة أخرى.» (`BAN_INCOMPLETE`) | A retry for a member already revoked failed at the ban again; the member stays revoked. | «حاول مرة أخرى» beside «استعادة». |
| «أُوقف الدخول لكن تعذّر إنهاء الجلسات المفتوحة. حاول مرة أخرى.» (`SESSIONS_FAILED`) | The member is revoked and banned, but the open sessions could not be ended. | «حاول مرة أخرى» beside «استعادة». |
| «تم الإجراء لكن تعذّر تسجيله في سجل التدقيق.» (`AUDIT_FAILED`) | The change was made; only its audit row failed. | The directory shows the member as they are. |
| «يجب أن يبقى مالك نشط واحد على الأقل.» (`LAST_OWNER`) | The member is the last active owner. | See below. |

«حاول مرة أخرى» asks for the same revoke again. That is safe: the ban and the end
of the sessions are idempotent, and a revoke undoes only a change it made itself,
so a member already revoked stays revoked (`supabase/functions/staff-admin/index.ts`,
`src/components/admin/TeamView.tsx`; `tests/unit/staff-admin-function.test.ts`,
`tests/unit/admin-ops.test.ts`).

**An owner, when a second owner remains.** The other owner does the same in the
team screen. If the account's mailbox is the thing that was taken, the ban is what
stops sign-in (a code is sent to the address, so whoever reads the mailbox could
otherwise sign in): invite the person again at an address only they control, then
revoke the old account.

**The only owner (a compromised account, or an owner who must be removed).** The
trigger `staff_keep_an_owner` refuses any change that leaves no active owner
(`LAST_OWNER`), so the team screen cannot revoke him. The steps below are for the
Supabase SQL editor and have never been run on a real project:

1. Make a trusted second owner first: an Auth user for an address only the real
   owner controls (the dashboard's Authentication page), then
   `insert into public.staff (user_id, display_name, role) values ('<that user id>', '<name>', 'owner');`
   (the row the invite function writes). That owner signs in with the emailed
   code, enrols an authenticator in «الأمان», and can use the team screen.
2. If the intruder must be cut off before that, end the account's sessions at once:
   `select public.staff_sessions_end('<user id>');` (it answers how many sessions it
   ended; an access token already issued lives until it expires).
3. From the new owner's session revoke the old account in the team screen.

**A lost authenticator.** A verified authenticator can be removed only from a
session at aal2 (Supabase Auth's code, read by the audit on 2026-10-07), and the
admin has no screen for it: once one is verified, «الأمان» says only «تطبيق
المصادقة مفعّل.». An owner who lost the phone cannot refund, record an external
refund or a dispute, save the seller, approve the policies, switch checkout,
invite, change a role or revoke: each answers `STEP_UP_REQUIRED` and the dialog
cannot be satisfied. Content and the order screens still work at aal1. Whoever
holds the Supabase project removes the factor: in the SQL editor
`delete from auth.mfa_factors where user_id = '<owner user id>';` (the repository's
own `privacy_erase_staff` deletes factors the same way; the dashboard's user page
may offer the same, not opened here). The owner then signs in again and enrols
the new device in «الأمان». Anas keeps the authenticator's backup or export.

**Open decision for the owner (OPS-PRIVACY-12):** a second owner account. With one,
a lost authenticator and a compromised account depend on whoever holds the Supabase
project, and the sole-owner steps above.

### A leaked order link

A buyer's order link is a bearer token: whoever holds it reads the order (the
lines, the carrier and tracking number), files return requests and mints download
tokens for the paid file (3 downloads per token, 10 tokens per file a day). It
lives 7 days from payment, and a recovery, a file attached, the shipped and
refunded mails and «إكمال الطلب» each renew it, so waiting does not end it. A buyer
who forwarded the mail, posted a screenshot or had his mailbox read asks the owner
to stop it; the owner first checks that the request comes from the order's address
(docs/privacy-data-map.md, "Handling a request").

The owner's **«إعادة إرسال رابط الطلب»** does it (the order view, «العميل
والتوصيل»; owner only; for a paid, a «مدفوع: يحتاج حلًا» or a refunded order). The
function reads the order's next token version, derives that token and hands only
its peppered hash to `order_link_reissue`, which, under the order's lock, stores
it, so the old link stops opening at once, gives the new one 7 days and queues one
`order_link` mail with it. The optional field «بريد جديد (اختياري)» corrects a
mistyped or taken-over address: the order's address and its hash are replaced and
the mail goes to the new one. Because that changes where the buyer's mail goes, it
needs a fresh authenticator code (the step-up dialog) and a confirmation, «سيُغيّر
بريد الطلب ويُبطل الرابط القديم. متابعة؟»; without a new address no code is needed.
The screen says «أُرسل رابط جديد إلى عنوان الطلب.» or «غُيّر البريد وأُرسل رابط
جديد.»; an order that changed meanwhile answers «تغيّر الطلب؛ أعد التحميل.», an
order in another state «لا يمكن إرسال رابط لهذا الطلب في حالته.». One audit row,
`order.link_reissued`, names the order number and whether the address changed,
never the address (`supabase/functions/_shared/admin.ts`,
`supabase/migrations/20261007110000_fable_audit_operations.sql`;
`tests/unit/admin-function.test.ts`, `tests/unit/admin-orders.test.ts`).

What it does not do: the mail is an ordinary priority-1 `order_link` mail, so it
counts against the day's 20 such mails and waits when the day's sends are at 80
(see "The mail budget"); the old link is dead from the moment of the action even
if the mail waits. A download token minted before lives out its 15 minutes, and a
file already downloaded cannot be recalled.

### Lifting a suppression

`finance.email_suppressions` has no screen and no function that removes a row. A
hash enters it on a bounce typed Permanent (or untyped), a complaint or a provider
suppression, and stays until someone deletes it. Since round M1b a staff address on
the list no longer silences owner alerts or contact notices when the outbox sends
them (`outbox_claim` holds back buyer mail only), but a replay is refused for any
address on the list, staff included (`outbox_replay`; the mail screen answers
«المستلم محظور بعد ارتداد أو شكوى؛ لا يمكن الإرسال إليه.»). So the recipe is for a
buyer whose address bounced once and should get mail again, and for a staff
address to clear before a replay.

In the SQL editor, as the migration role (a deliberate manual action; the system
writes no audit row for it, so note it in your own log):

```sql
select reason, created_at from finance.email_suppressions
 where recipient_hash = finance.recipient_hash('<address>');
delete from finance.email_suppressions
 where recipient_hash = finance.recipient_hash('<address>');
```

`finance.recipient_hash` lower-cases and trims the address, so capital letters do
not matter; an international domain is given in its ASCII (punycode) form, as
checkout stores it.

What the deletion does not do. A row already `suppressed` stays `suppressed`:
`outbox_replay` takes only exhausted, uncertain and sent-then-failed rows, so the
mail that was held does not come back by itself. For a buyer, a new link goes by
the owner's «إعادة إرسال رابط الطلب», which queues a fresh `order_link` mail; a
receipt cannot be sent again. For a staff address, contact messages whose notice
ended `suppressed` before round M1b sit in `public.contacts`, which no screen
reads; this lists them in the SQL editor (a message none of whose notices was
sent reached no one, so the 90-day purge never takes it, D36):

```sql
select distinct c.* from public.contacts c
  join finance.email_outbox o
    on o.kind = 'contact_notice' and o.payload->>'contactId' = c.id::text
 where o.status = 'suppressed';
```

Resend keeps its own suppression list, separate from ours, and Supabase Auth's
sign-in codes meet it too; removing an address from it is a step in Resend's
dashboard that this repository has not checked.

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
- `storage/media-private/...`, `storage/media-public/...` and
  `storage/paid-files/...` — every object of the three Storage buckets (the paid
  files are the product: a restore without them is not a restore), with the
  `storage.objects` rows (so metadata and content types) inside `data.sql`.
- `manifest.json` — format version, creation time, source (`linked` or
  `local`) and every file's size and sha256.

What a file deliberately does **not** hold: Vault secrets (`functions_url`,
`jobs_secret`, `pages_deploy_hook`), Edge Function secrets (`supabase
secrets`; step 9 below names every one, and `TOKEN_HASH_PEPPER` is in no
backup at all), the deployed Edge Functions themselves, Auth settings and email
templates, the project's encryption root key, the database password, and what
lives outside the project: the Pages build variables and the Resend and Moyasar
webhook registrations. All of these are re-created by hand after a real restore
(below).

What a file cannot be trusted to bring back: the **pg_cron schedules**. They
exist only as `cron.schedule(...)` calls inside the migrations, and the
restored migration history marks every migration applied without running it.
Whether `data.sql` carries the `cron.job` rows depends on the CLI: in the CLI
source read on 2026-10-01 (`supabase/cli`, branch `develop`,
`apps/cli-go/pkg/migration/dump.go`), the schema dump excludes the `cron`
schema, and the data dump excludes `vault` but, unlike the other extension
schemas, no longer excludes `cron`. A newer CLI's `data.sql` may therefore
carry the rows and an older one not; this was not checked against the pinned
2.106.0 (docs/development.md). The runbook never assumes either: step 8 lists
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

- `pnpm backup` — the five dumps of the linked project plus the three buckets'
  objects, written to `~/ANASAQ-backups/anasaq-backup-<UTC yyyymmdd-hhmmss>.enc`
  (created if missing). `--linked`, the default, needs `supabase link` first
  (or `SUPABASE_PROJECT_ID` exported in the shell: the script does not read
  `.env`, and the variable takes precedence over the link) and stops before
  writing anything without one of them.
  `--local` backs up the development stack instead;
  `--out <dir>` picks another directory, refused when the path, or any folder it
  passes through, resolves into the repository (compared by real path: a link or
  junction into the repository counts as inside). The
  passphrase is typed twice, hidden (minimum 12 characters), or read from
  `ANASAQ_BACKUP_PASSPHRASE` for unattended runs. Each run is recorded in
  `finance.job_runs` as `backup` with numbers only (files, objects, bytes);
  a failed record never invalidates the file. The owner home flags the job
  after 30 days («آخر نسخة احتياطية أقدم من 30 يومًا.»).
- `pnpm restore-check <file>` — proves a file end to end: it restores into a
  throwaway local stack (its own workdir under the OS temp dir, every port
  moved by +1000, studio/inbucket/analytics/realtime/edge runtime off; the
  development stack is untouched), reloads every table with the guide's psql
  invocation, re-uploads every object (all three buckets; its scratch stack's
  file-size limit is raised to the project's 100 MiB so that a paid file fits)
  with its original content type, then
  compares every table's row count and every object's sha256, and prints the
  elapsed time. It then re-runs every `cron.schedule(...)` statement of
  `supabase/migrations` (printed as «Caveat applied (runbook)», with how many
  of the fifteen jobs `cron.job` already held, which shows whether the dump
  carried them) and requires all fifteen in `cron.job`, listing each as `ok` or
  `MISSING`: a missing job, or pg_cron missing from the restored database,
  fails the rehearsal. The fifteen names are derived from the migrations (see
  "Every pg_cron job"). `--extract <dir>` only decrypts the files for a manual
  restore. The files are unencrypted, so it refuses any path inside the
  repository (compared by real path, as for `pnpm backup --out`): use a folder
  outside the project.

### What the rehearsal guarantees about its scratch stack (round S)

The scratch stack holds the whole restored database behind the Supabase CLI's
public default credentials, so the script limits what can reach it and what it
leaves behind:

- **Where it listens.** The Supabase CLI publishes every port with no host
  address, so on every address of the machine. The stack's Docker network
  (`supabase_network_anasaq-restore-check`) is still created first with
  127.0.0.1 as its default binding and handed to `supabase start` with
  `--network-id`, which keeps the stack on 127.0.0.1 on a Linux engine; Docker
  Desktop does not apply that default. So `supabase start`, and only it, talks
  to Docker through a relay (`scripts/lib/docker-loopback-relay.mjs`) on a named
  pipe on Windows or a socket in a private folder elsewhere, never a TCP port.
  The relay writes 127.0.0.1 into every published port of each container the CLI
  creates; a create that asks for another address, for every port
  (`PublishAllPorts`) or for another network is refused, so the start fails
  closed. It forwards to the Docker endpoint plain `docker` uses (`DOCKER_HOST`,
  or else the current context), relays a local pipe or socket only, and is
  closed as soon as the start returns (and again on the way out). Every other
  call goes to Docker directly. The restore is then refused unless `docker port`
  shows at least one binding on the database container and on Kong (an empty
  answer is refused too: it would pass for nothing), and every binding of every
  container found by the CLI's project label or by name is on 127.0.0.1; a
  `docker ps` or `docker port` that fails is refused as well.
- **Which versions.** A backup of the linked project is rehearsed on the service
  versions `supabase link` recorded in `supabase/.temp` (Postgres, PostgREST,
  GoTrue, Storage). The run prints them, or says it found none, in which case the
  scratch stack runs the CLI's default versions and a newer hosted Auth or
  Storage schema can fail the restore of a good backup.
- **Where files may go.** `--extract` and `pnpm backup --out` refuse any path
  inside the repository. The path and every folder it passes through are compared
  by real path, so a link or junction into the repository counts as inside, and
  so does a path that passes through the repository and leaves it again by a link
  inside it (Git for Windows treats a junction as a plain folder and would stage
  what lies behind it).
- **What it leaves behind.** After the stop, the run looks for any container or
  volume that carries the CLI's project label for `anasaq-restore-check`. One that
  remains, or a Docker that cannot answer, makes the run exit non-zero. With a
  leftover it prints "plaintext restored data is still on disk", what is left, and
  the command that removes it, `supabase stop --no-backup --project-id
  anasaq-restore-check`; with a Docker that does not answer it says it could not
  check, and names the two `docker ... --filter
  label=com.supabase.cli.project=anasaq-restore-check` commands to check by hand.
  Each cleanup step (the decrypted dumps, the relay, the stop, the network, the
  leftover check, the workdir) runs on its own: one that throws is reported and
  also makes the run exit non-zero, and the others still run. The stop's and the
  network removal's own exit codes are not checked; the leftover check after them
  is what fails the run if a container or volume of the stack remains.
- **A network left from an earlier run** stops the rehearsal before anything
  starts, with the remedy: `docker network inspect
  supabase_network_anasaq-restore-check` lists what uses it, and `docker network
  rm supabase_network_anasaq-restore-check` removes it.

`tests/unit/restore-check.test.ts` proves the rehearsal's decisions against
stand-ins for Docker and the Supabase CLI placed on the PATH; those cases run on
POSIX machines only and are skipped on Windows, where Anas works. Among them is
a `supabase start` that sends a real container create through the relay to a
fake Docker, which must receive 127.0.0.1.
`tests/unit/docker-loopback-relay.test.ts` runs the relay itself against a fake
Docker on every platform, Windows included, over a real named pipe there. The
`--extract`, argument and path-guard cases of
`tests/unit/restore-check.test.ts`, and all of `tests/unit/backup-cli.test.ts`,
run on every platform, their link cases where the machine can make a link (a
junction on Windows). The tests prove what the scripts decide, not what Docker
does: only a real `pnpm restore-check` on Anas's machine proves the Docker side
— the loopback binding (the CLI reaching Docker through the relay's
`DOCKER_HOST`, and Docker Desktop keeping the 127.0.0.1 it writes; an IPv6
`[::]` line would make the script refuse), `--network-id`, the project label on
every container and volume, and the stop by project id leaving the development
stack alone. The first such run, on the owner's machine on 2026-10-14 (Docker
Desktop 4.91.0), refused before restoring anything: Docker Desktop does not
apply the network's option, and there was no relay yet. The second, on
2026-10-15 with the relay, passed: the start went through the relay, `docker
port` showed the database and Kong on 127.0.0.1 only, the five containers and
two volumes of the stack carried the label (the same by name), every table,
object and schedule was verified, and nothing of the stack remained
(`PLANS/ISSUES.md`, I53 (3); `artifacts/acceptance/I56/RECORD.md`).

### A real restore into a new hosted project

A restore is not finished at the database. The new project has no functions, no
secrets, no Vault values and no schedules until the steps below create them; the
static site and the admin still name the old project until the site is rebuilt;
and Resend and Moyasar still send to the old address. The order is the point:
nothing may sell or talk to Moyasar before the store is closed on the restored
project and the whole deletion ledger, its revokes included, is back (step 5):
Auth and its users come back with the database at step 4, so a member revoked
after the backup is active again from then until the ledger revokes them; nothing
may send mail through the outbox before every step is done, which is why the
functions' `RESEND_API_KEY` comes last (step 17); and only one project may ever do
any of it (step 1). Nobody has
run these steps end to end on a real hosted project; `pnpm restore-check` proves
the dumps, the objects and the schedules, not what follows them.

1. **If the old project still runs** (a restore after a bad migration or a
   corrupted table, not after a loss), stop it acting first, so that only one
   project sends mail and talks to Moyasar. Close «الشراء» in its settings and
   wait until no hold or unpaid invoice is open (a hold lasts 20 minutes and
   `checkout-expire` ends it): a buyer who pays into the old project during the
   restore pays into a database that is about to be replaced. Once SITE-STATE-1 is
   built, put the site in «صيانة» as well (`PLANS/SITE-STATE-CONTRACT.md`). Then
   pause the old project in the Supabase dashboard (or at least remove its Vault
   `jobs_secret` and its `RESEND_API_KEY`, `MOYASAR_SECRET_KEY` and
   `MOYASAR_WEBHOOK_SECRET` function secrets). Pause it, do not delete it: it may
   hold orders and messages newer than the backup (step 19).
2. `pnpm restore-check <file> --extract <empty dir outside the project>` on any
   machine with the file and the passphrase (this yields the five dump files, the
   storage objects and `manifest.json`). Note the manifest's `createdAt`: step 19
   needs it.
3. Create the new Supabase project, and enable the extensions `pg_cron` and
   `pg_net` in it (Database, Extensions) before restoring anything. Supabase's
   guide (read by the audit on 2026-10-07) lists a non-default extension in use
   among the things to enable first; `pnpm restore-check` creates the two itself in
   the rehearsal when the restore reports them missing.
4. Run the guide's psql restore (PostgreSQL's `psql` client) against the new
   project's connection string: `psql --single-transaction --variable
   ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET
   session_replication_role = "replica"' --file data.sql`, then
   `history_schema.sql` and `history_data.sql` the same way. If a
   `supabase_admin` owner or `cli_login_postgres` grant error appears,
   comment out those lines (the guide's documented caveats); never edit data.
5. **Replay the deletion ledger now, all of it, in the SQL editor.** Run every
   `privacy_erase_contacts` and `privacy_buyer_erase` line of the deletion ledger
   in the SQL editor (docs/privacy-data-map.md, "The deletion ledger and
   restores"). A restored older backup brings erased contacts and buyers back with
   their unsent mail `pending` and their notifications `confirmed`. This step comes
   before any Vault value, function secret or deployed function exists, so nothing
   can have sent that mail: the first mail can leave only once steps 7, 9 and 10
   have given the `email-outbox` schedule a function to call and its secret, and
   step 17 Resend's key.

   **Revoke again, in the same editor, every member a `revoke` line lists, then
   erase the staff the ledger erased.** A restored older backup has them active
   and unbanned, and the team screen cannot wait: Auth and its users are back
   since step 4, and from step 11 the rebuilt site's sign-in reaches this project.
   For each `revoke <user id>` line:
   `update public.staff set active = false where user_id = '<user id>';`
   From the next query, RLS and every staff function refuse an inactive member
   (`20260924130000_staff_and_app_server.sql`), so whatever Auth does later, the
   member reaches nothing. Then
   `update auth.users set banned_until = now() + interval '876000 hours' where id = '<user id>';`
   (the ban the team screen's «إيقاف» sets through Auth's admin API, `ban_duration`
   876000h; written here directly, which nobody has tried on a hosted project, so
   the inactive row above is what to rely on) and
   `select public.staff_sessions_end('<user id>');` (it ends their sessions and
   refresh tokens; a backup older than round M1b has no such function: run this
   line right after step 6). If a `revoke` line names the only active owner the
   backup holds (the shop changed hands after the backup), its first update is
   refused with «At least one active owner is required.» (the
   `staff_keep_an_owner` trigger): make the current owner first, as "Removing
   access in a hurry" does for the only owner (an Auth user, then the
   `public.staff` row), then run the line. Then run every `privacy_erase_staff`
   line (it refuses an active member, so it comes after the revokes). The team screen will show each
   of them «موقوف». These direct updates write no audit event: note them in your
   own log.

   **Close the store on the restored project, in the same editor.** The backup
   brought «الشراء» back as it was when the backup was taken, and from step 11 the
   site sells through this project, before its paid files (step 16), its Moyasar
   webhook (step 13) and its stock (step 19) are right:
   `update finance.commerce_settings set checkout_enabled = false, version = version + 1 where id = 1;`
   This direct update writes no audit event (the admin's switch does), so note it
   in your own log; while the store is closed the availability notices stop too.
   Step 20 opens it again.
6. `supabase link --project-ref <the new project's reference>`, then
   `supabase db push` for the migrations in `supabase/migrations` that are newer
   than the backup: the restored `supabase_migrations` history says which ones the
   database already has. Without them the code runs against an older schema.
   Not run on a real restore (unverified).
7. Re-create the Vault secrets: `select vault.create_secret(...)` for
   `functions_url` (`https://<new project-ref>.supabase.co/functions/v1`),
   `jobs_secret` and `pages_deploy_hook` (docs/operations.md, "The outbox
   schedule"; the hook is a new one if the Pages project changed). From here, once
   the functions exist, the schedules can reach them.
8. Check the pg_cron jobs. A restore never runs a migration's
   `cron.schedule(...)` call again, and `data.sql` may or may not carry the
   `cron.job` rows (see "What a file holds"). List what the new project has:
   `select jobname, schedule from cron.job order by 1;` and compare it with
   the fifteen names of "Every pg_cron job": `content-publish-due`,
   `rate-limits-purge`, `job-runs-purge`, `cron-run-details-purge`,
   `contacts-purge`, `media-sweep`, `buyer-retention`, `checkout-expire`,
   `site-build-trigger`, `email-outbox`, `payments-reconcile`,
   `availability-sweep`, `notifications-purge`, `notify-confirm-backlog` and
   `payment-events-purge`. For every missing one (with an
   empty `cron.job`, all fifteen) run its `select cron.schedule(...)` statement
   from `supabase/migrations`; for a name scheduled twice (`job-runs-purge`)
   take the later migration's. From the repository root, this prints all fifteen,
   ready for psql (node writes the file itself: a shell `>` redirect would
   save UTF-16 under Windows PowerShell 5.1, which psql cannot read):
   `node -e "import('./scripts/lib/cron-jobs.mjs').then(m => require('fs').writeFileSync('cron-schedules.sql', [...m.cronScheduleStatements('supabase/migrations').values()].join('\n')))"`
   then `psql "<connection string>" --single-transaction --variable
   ON_ERROR_STOP=1 --file cron-schedules.sql`, and delete `cron-schedules.sql`
   (it lands in the repository root). Scheduling a name that already
   exists replaces its schedule and command (the migration
   `20260930120000_audit_fixes.sql` relies on this for `job-runs-purge`), so
   running all fifteen is safe. Repeat the `select` and expect fifteen rows.
   `pnpm restore-check` does the same in its rehearsal and fails while any job
   is missing. Without the jobs the project has every function and no schedule:
   no email is sent, no publish triggers a rebuild, scheduled posts never go
   live, holds never expire, payments and refunds are never reconciled,
   availability notices never go and the retention purges never run, while
   the owner home only says «لم يعمل بعد».
9. Re-set the Edge Function secrets with `supabase secrets set`, because no
   backup holds any: every one of them but `RESEND_API_KEY`, which waits for step
   17: `SITE_URL`, `JOBS_SECRET` (the same value as the Vault `jobs_secret` of step 7),
   `TOKEN_HASH_PEPPER`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET` (replaced again in step 12),
   `TURNSTILE_SECRET_KEY`, `ANALYTICS_TOKEN` and `CLOUDFLARE_ZONE_ID`, and the
   payment settings: `MOYASAR_API_BASE_URL`, `MOYASAR_SECRET_KEY`,
   `MOYASAR_WEBHOOK_SECRET`, `PAYMENTS_MODE` and `FUNCTIONS_PUBLIC_URL` (with
   `PAYMENTS_TEST_ACCESS_CODE` on a hosted site in test mode). A new project has a
   new `<project-ref>`, so `FUNCTIONS_PUBLIC_URL` is the new
   `https://<project-ref>.supabase.co/functions/v1`
   ([payments-runbook](payments-runbook.md)). **`TOKEN_HASH_PEPPER` is not
   a throwaway value: reuse the original, and keep a copy with the backup
   passphrase.** It salts the throttles' caller keys and derives each order's
   access token, of which the database keeps only a peppered hash
   (`orders.access_token_hash`); a new pepper makes every stored order link and
   cancel call stop matching (404), and every mailed order, download,
   confirmation and unsubscribe link with them (their tokens are derived from
   it, and the download tokens' stored hashes use it). A missing
   `TOKEN_HASH_PEPPER` makes `contact` answer 500 and `checkout` 503, and a
   missing `SITE_URL` makes `contact` answer 403 to every origin.
10. Deploy the Edge Functions: `supabase functions deploy` from the repository
    root, which Supabase's migration guide ends its Edge Functions section with and
    which names no function (read by the audit on 2026-10-07). The repository holds
    ten: `admin`, `checkout`, `contact`, `download`, `notify`, `orders`, `outbox`,
    `payments`, `resend-webhook` and `staff-admin`; no backup holds any. The
    gateway's JWT check is set per function in `supabase/config.toml` (off for the
    eight public ones, which check their callers themselves; on for `admin` and
    `staff-admin`): never pass a flag that overrides it, and afterwards check that
    a call to `admin` and to `staff-admin` without a token is refused. The functions
    get their database key from Supabase: `SUPABASE_SECRET_KEYS`, else the legacy
    `SUPABASE_SERVICE_ROLE_KEY` (`supabase/functions/_shared/db.ts`; nothing to set
    by hand). A project created or restored after Supabase retired the legacy keys
    has only the first (Supabase's announcement, read by the audit on 2026-10-07),
    and before round F1 every function failed there; step 18 proves one call.
11. **Point the static site at the new project.** The site and the admin are one
    static export with the project's address and publishable key built into every
    bundle and page (`NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the library images, the contact form,
    the cart and checkout and the staff sign-in all use them). In the Pages
    project's settings set both to the new project's URL and publishable key, for
    production and for preview, then build: with the Vault `pages_deploy_hook` set
    (step 7) run `select public.site_build_request();` in the SQL editor, or start a
    deploy in the Pages dashboard, and wait for it to finish there (a build that
    fails after the hook answered shows only in the Pages dashboard, see "Site
    rebuilds"). Until this is done the site still talks to the old project, and if
    that one still answers the smoke test passes against it.
12. **Move the Resend webhook.** In the Resend dashboard (`https://resend.com/webhooks`)
    edit the endpoint to `https://<new project-ref>.supabase.co/functions/v1/resend-webhook`,
    read its signing secret on the endpoint's page and set `RESEND_WEBHOOK_SECRET`
    again with `supabase secrets set` (Resend may have issued a new one). Until then
    bounce and complaint events go to the old address and suppression stops
    updating.
13. **Move the Moyasar webhook** (once payments are configured). `FUNCTIONS_PUBLIC_URL`
    (step 9) is the new project's address. In Moyasar's dashboard change the
    webhook's endpoint to `<FUNCTIONS_PUBLIC_URL>/payments/webhook`, keeping its
    Secret Token equal to `MOYASAR_WEBHOOK_SECRET`
    ([payments-runbook](payments-runbook.md#the-three-steps)). New invoices carry
    the new callback address; an invoice made before the restore still carries the
    old one, which only matters for a prompt: the webhook, the return page and the
    job settle without the callback.
14. **The site-state gate** (`PLANS/SITE-STATE-CONTRACT.md`; planned, not built):
    when it exists, the Worker or Pages Function in front of the site reads the
    project's `site_state` through two variables of its own, the project's address
    and its publishable key; change both. Until it exists the domain follows the
    Worker's `MODE` only, and there is nothing to change.
15. Re-apply the Auth settings (I28): SMTP for Resend, the site URL and redirect
    URLs, the Arabic sign-in email template, the Custom Access Token hook
    (`public.deny_password_tokens`), `secure_password_change = true`, **Turnstile as
    the CAPTCHA on the sign-in code request and an eight-digit code** (both are in
    `supabase/config.toml` for the local stack; the hosted project's own settings are
    unverified), and Google's authorised redirect URI if Google sign-in has ever been
    turned on (it is off today); re-check with a password grant, which must return
    403.
16. Upload the objects from `storage/<bucket>/...` back to their buckets with
   their original content types (read from
   `storage.objects.metadata->>'mimetype'` in the restored data), with upsert: the
   restored data already holds their `storage.objects` rows (step 4), so a plain
   upload is refused as already existing. The repository has no command for this
   on a hosted project; `uploadObjects` in `scripts/restore-check.mjs` shows the
   calls the rehearsal makes (the Storage API's upload with `upsert: true` and the
   content type). Nothing here waits for step 11 (the rows are back from step 4,
   the buckets with the schema), so do it before step 11, and the rebuilt site
   never shows the library images broken.
17. **Check the ledger, then set Resend's key.** The team screen works now (the
    functions are deployed, the site is rebuilt and sign-in is set): every member
    a `revoke` line lists shows «موقوف» since step 5 (docs/privacy-data-map.md,
    "The deletion ledger and restores"). Only now set `RESEND_API_KEY` with
    `supabase secrets set`. Until it is set the outbox claims nothing and
    sends nothing (its runs are recorded as skipped, `EMAIL_NOT_CONFIGURED`), and
    staff mail goes to active members only, so a notice queued for a member revoked
    at step 5 is closed `RECIPIENT_INACTIVE` instead of sent.
18. **Smoke test, and show that it reached the new project.** Send one real message
    through the contact form of the rebuilt site. It must answer «received» (201),
    and the notice must reach the mailbox within a few minutes (this proves
    Turnstile, the secrets, the functions, Resend, the outbox and the step 8 jobs
    together). That the request went to the new project and not the old one is
    shown, not assumed: in the browser's network panel the POST goes to
    `https://<new project-ref>.supabase.co/functions/v1/contact`; the message is the
    newest row of `select id, created_at from public.contacts order by created_at desc limit 1;`
    in the new project's SQL editor; and a library image on the page has the new
    reference in its address. The old project, if it still exists, must not hold
    that message. Then sign in to the admin and load the owner home, which calls
    `admin` with the database key (step 10). The test message stays in
    `public.contacts` until the 90-day purge.
19. **Reconcile Moyasar against the restored ledger.** An order made or paid after
    the backup has no row in the restored database: its invoice maps to no attempt,
    and the buyer's name, address and phone exist nowhere else on our side (Moyasar
    is never sent them). In Moyasar's dashboard list the payments created since the
    manifest's `createdAt` (step 2). Every invoice the store made carries the order
    number in its description «طلب <number>» and in its metadata. For each payment
    whose order number is not in `/admin/orders` of the restored project, find the
    buyer in Resend's sent receipts «إيصال طلبك رقم …», or «وصلتنا دفعتك للطلب رقم …»
    for an order that waited for the owner's resolution (Resend keeps sent mail 30
    days on the Free plan, docs/privacy-data-map.md) and decide with him: refund the
    payment in Moyasar's dashboard, or fulfil the sale by hand outside the system
    (the admin has no order entry, so a hand-fulfilled sale is not in the ledger).
    For a payment whose order is in the restored database but unpaid or expired, press
    «أعد الفحص» on its attempt: a late payment settles as `paid` or
    `paid_needs_resolution`. If the old project still holds the data (step 1), its
    orders and messages since the backup can be read there. If step 1 paused it
    with its secrets in place, take them away before it can act: first
    `supabase secrets unset RESEND_API_KEY MOYASAR_SECRET_KEY MOYASAR_WEBHOOK_SECRET --project-ref <the old project's reference>`
    (whether Supabase accepts this while the project is paused is unverified),
    then resume it and at once remove its Vault `jobs_secret` (its database, and
    so its Vault, is down while it is paused). If the secrets cannot be unset
    first, resuming lets its schedules send its held mail and run a reconciliation
    within the first minute: decide with the owner whether reading it is worth
    that. A payment that reaches the
    restored project's webhook for an invoice it does not know is filed as a review
    payment `UNMAPPED_INVOICE` with an owner alert, and is never fulfilled.
20. Open «الشراء» again in the admin's settings (step 5 closed it; leave it closed
    only if it was already closed before step 1), and take the site out of «صيانة»
    if it was put there, only after steps 17 to 19 are done and the home's job lines («إرسال البريد»,
    «مطابقة المدفوعات», «بناء الموقع») show runs of the new project.
21. Once the restore is verified, delete the extracted directory, which is
    unencrypted and holds every personal record and the Auth secrets, and the
    `cron-schedules.sql` of step 8 if it is still in the repository root. Keep the
    old project, paused or without its secrets, until step 19 is finished, then decide with the owner whether
    to delete it.

### Accepted risks (D35)

- Anything entered after the last backup is lost if the project is lost:
  Supabase Free keeps no backups, so the recovery point is the owner's own
  cadence. **Sales are part of it.** An order made, paid or shipped after the last
  backup is not in the file: the buyer's name, address and phone exist nowhere
  else on our side (Moyasar is never sent them), the file's grant and the stock
  change are gone, and only Moyasar's records (restore step 19) and Resend's sent
  receipts (30 days on the Free plan) show that the sale happened. The owner
  revisits the cadence with E07, when Supabase Pro's daily backups (kept 7 days,
  docs/costs.md) are weighed against the money at stake (open decision, the
  owner's).
- A lost machine loses its copies unless the encrypted file was also copied
  to a USB drive or a cloud drive (safe: the file is encrypted).
- A forgotten passphrase makes every file unreadable. There is no reset.
- Before live orders, E07's Supabase Pro adds the platform's daily backups;
  the cadence is revisited then.
