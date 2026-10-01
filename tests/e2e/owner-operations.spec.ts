// P06 e2e: the `contact`, `outbox` and `resend-webhook` Edge Functions
// (round 1, API-level, D32), plus the owner home, email problems, statistics,
// settings and role boundaries (round 2, browser) — against `next dev`
// (`PLAYWRIGHT_BASE_URL=http://localhost:3000`) and the functions the local
// stack serves. Local-only values come from `.env.local` (never `.env`);
// Turnstile uses Cloudflare's always-pass test secret and the dummy token, so
// no real challenge is solved and no real provider is called — email lands in
// the local stack's Mailpit.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { expect, test, type Locator } from '@playwright/test'

import {
  createStaff,
  functionUrl,
  localEnv,
  readCodeFromMailpit,
  restoreLive,
  SENT_MESSAGE,
  signInByCode,
  SITE_ORIGIN,
  staffAccessToken,
  status,
  svixHeaders,
  totpCode,
} from './helpers'
import { shotsDir } from './shots'

const env = localEnv()

let db: Client
let ownerEmail: string
let marker: string
let contactId: string
let noticeProviderId: string
let noticeRecipient: string

// Round 2 (browser) state: the email fixture rows this spec inserts (removed
// in afterAll).
const fixtureRecipients: string[] = []
// The store settings row the seller-save test overwrites, restored in afterAll
// (the local demo seed fills it, D37).
let savedSettings: Record<string, unknown>

/**
 * Inserts one attention-worthy outbox row directly (local postgres fixture).
 * Its kind is `receipt`: a contact notice may only be replayed to an active
 * owner or operations member (S03.5), and these recipients are made up.
 */
async function insertOutboxRow(rowStatus: string, firstAttemptAgoSeconds: number | null): Promise<string> {
  const recipient = `p06r2-${rowStatus}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await db.query(
    `insert into finance.email_outbox
       (dedupe_key, kind, priority, recipient, payload, status, attempts, max_attempts, last_error, first_attempt_at)
     values ($1, 'receipt', 1, $2, '{"contactId":"00000000-0000-0000-0000-000000000000"}'::jsonb,
             $3::text, 5, 5, 'HTTP_422', $4)`,
    [
      `p06r2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      recipient,
      rowStatus,
      firstAttemptAgoSeconds === null ? null : new Date(Date.now() - firstAttemptAgoSeconds * 1000).toISOString(),
    ],
  )
  fixtureRecipients.push(recipient)
  return recipient
}

// What the settings test must undo whether it passes or fails (S21.2): it
// registers the SQL that puts the site settings back, and afterEach runs it.
const cleanups: Array<() => Promise<void>> = []
test.afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((run) => run()))
})

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  savedSettings = (
    await db.query(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  ).rows[0]!
  // Guarantees at least one active notice recipient for every submission.
  const owner = await createStaff('owner')
  ownerEmail = owner.email
  // Park every older due notice so the single jobs run below dispatches only
  // this spec's notice (the shared local database has pending rows from the
  // integration suites; the claim takes at most 10 rows per run). Only rows
  // due right now can be claimed, so only those are touched — other suites'
  // parked or backed-off fixtures stay as they are.
  await db.query(
    `update finance.email_outbox set next_at = now() + interval '1 day',
       first_attempt_at = now() - interval '2 days'
     where status in ('pending', 'uncertain', 'sending') and next_at <= now()`,
  )
})

test.afterAll(async () => {
  if (fixtureRecipients.length > 0) {
    await db.query('delete from finance.email_outbox where recipient = any($1::text[])', [fixtureRecipients])
    await db.query(
      'delete from finance.email_suppressions where recipient_hash in (select encode(sha256(convert_to(lower(r), \'UTF8\')), \'hex\') from unnest($1::text[]) r)',
      [fixtureRecipients],
    )
  }
  await db.query(
    `update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_address = $3,
       seller_registration = $4, policy_revisions = $5::jsonb, version = $6, configured_at = $7, approved_by = $8
     where id = 1`,
    [
      savedSettings.checkout_enabled,
      savedSettings.seller_legal_name,
      savedSettings.seller_address,
      savedSettings.seller_registration,
      JSON.stringify(savedSettings.policy_revisions),
      savedSettings.version,
      savedSettings.configured_at,
      savedSettings.approved_by,
    ],
  )
  await db.end()
})

test('a contact submission is stored and its notices queued', async ({ request }) => {
  marker = `p06-e2e-${Date.now()}`
  const submissionKey = randomUUID()
  // A unique visitor IP per run, so repeated runs inside one hour never share
  // a throttle bucket (5 per hour, fixed window). `cf-connecting-ip` is the
  // key's first source (Cloudflare sets it on the hosted project); locally
  // nothing sets it, so the test can, and the local gateway's own
  // x-forwarded-for hop no longer decides the bucket.
  const visitorIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`
  const response = await request.post(functionUrl('contact'), {
    headers: { origin: SITE_ORIGIN, 'cf-connecting-ip': visitorIp },
    data: {
      name: 'زائر',
      email: `guest-${marker}@example.com`,
      message: `رسالة اختبار ${marker}`,
      submissionKey,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    },
  })
  expect(response.status()).toBe(201)
  expect(await response.json()).toEqual({ ok: true, data: { received: true } })

  const contact = (
    await db.query<{ id: string }>('select id from public.contacts where submission_key = $1', [submissionKey])
  ).rows[0]
  expect(contact).toBeDefined()
  contactId = contact!.id

  const notices = (
    await db.query<{ status: string }>(
      "select status from finance.email_outbox where payload->>'contactId' = $1 and recipient = $2",
      [contactId, ownerEmail.toLowerCase()],
    )
  ).rows
  expect(notices.length).toBe(1)
  expect(notices[0]!.status).toBe('pending')
})

test('with no jobs run the message is stored and its notice waits, so an email outage loses nothing', async () => {
  // D31: the notice is the owner's inbox. Until a jobs run sends it, the
  // message sits in the database and its notice stays queued for the retry.
  const stored = (await db.query<{ n: number }>('select count(*)::int as n from public.contacts where id = $1', [contactId]))
    .rows[0]!
  expect(stored.n).toBe(1)
  const waiting = (
    await db.query<{ n: number }>(
      "select count(*)::int as n from finance.email_outbox where payload->>'contactId' = $1 and status = 'pending'",
      [contactId],
    )
  ).rows[0]!
  expect(waiting.n).toBeGreaterThanOrEqual(1)
})

test('a jobs run delivers the notices through Mailpit, sent but not yet delivered', async ({ request }) => {
  const response = await request.post(functionUrl('outbox'), {
    headers: { authorization: `Bearer ${env.JOBS_SECRET}` },
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { ok: boolean; data: Array<{ job: string; accepted: number }> }
  expect(body.ok).toBe(true)
  expect(body.data[0]!.job).toBe('email_outbox')
  expect(body.data[0]!.accepted).toBeGreaterThanOrEqual(1)

  // One claim takes at most 10 rows and orders by id, so this run may not
  // reach every recipient of the contact yet — any sent row proves the path.
  const sent = (
    await db.query<{ status: string; provider_id: string | null; delivery: string | null; recipient: string }>(
      "select status, provider_id, delivery, recipient from finance.email_outbox where payload->>'contactId' = $1 and status = 'sent' limit 1",
      [contactId],
    )
  ).rows[0]
  expect(sent).toBeDefined()
  expect(sent!.provider_id).not.toBeNull()
  expect(sent!.delivery).toBeNull()
  noticeProviderId = sent!.provider_id!
  noticeRecipient = sent!.recipient

  // The notice itself is in Mailpit: search for the unique marker. It carries
  // the whole message and replies to the visitor (D31: no admin inbox).
  // The functions reach Mailpit through host.docker.internal; the test uses
  // the host address the stack reports.
  const mailpit = status.MAILPIT_URL
  let found = false
  for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
    const search = (await (
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(marker)}`)
    ).json()) as { messages?: Array<{ ID: string }> }
    const latest = search.messages?.[0]
    if (latest) {
      const message = (await (await fetch(`${mailpit}/api/v1/message/${latest.ID}`)).json()) as {
        Text?: string
        ReplyTo?: Array<{ Address?: string }>
      }
      expect(message.Text ?? '').toContain(`رسالة اختبار ${marker}`)
      expect(message.Text ?? '').not.toContain('/admin')
      expect(message.ReplyTo?.map((address) => address.Address)).toEqual([`guest-${marker}@example.com`])
      found = true
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  expect(found).toBe(true)
})

test('the daily media sweep removes day-old quarantine parts through Storage and records the run (I29)', async ({
  request,
}) => {
  // Every quarantine part left on this stack counts as day-old, plus one
  // planted row so the run always has something to remove.
  const planted = `quarantine/${randomUUID()}/original`
  await db.query(
    "insert into storage.objects (bucket_id, name, created_at) values ('media-private', $1, now() - interval '25 hours')",
    [planted],
  )
  await db.query(
    "update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'media-private' and name like 'quarantine/%'",
  )
  const response = await request.post(functionUrl('outbox'), {
    headers: { authorization: `Bearer ${env.JOBS_SECRET}`, 'content-type': 'application/json' },
    data: { job: 'media_sweep' },
  })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { ok: boolean; data: Array<{ job: string; status: string; objects: number }> }
  expect(body.data[0]).toMatchObject({ job: 'media_sweep', status: 'ok' })
  expect(body.data[0]!.objects).toBeGreaterThanOrEqual(1)
  const left = await db.query(
    "select 1 from storage.objects where bucket_id = 'media-private' and name like 'quarantine/%' and created_at < now() - interval '1 day'",
  )
  expect(left.rowCount).toBe(0)
  const run = await db.query<{ status: string }>(
    "select status from finance.job_runs where job = 'media_sweep' order by id desc limit 1",
  )
  expect(run.rows[0]?.status).toBe('ok')
})

test('a signed delivered webhook marks delivery; a forged signature is 401', async ({ request }) => {
  const rawBody = JSON.stringify({
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: { email_id: noticeProviderId, to: [noticeRecipient] },
  })
  const response = await request.post(functionUrl('resend-webhook'), {
    headers: { 'content-type': 'application/json', ...svixHeaders(env.RESEND_WEBHOOK_SECRET, rawBody) },
    data: rawBody,
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ ok: true })

  const row = (
    await db.query<{ delivery: string | null }>('select delivery from finance.email_outbox where provider_id = $1', [
      noticeProviderId,
    ])
  ).rows[0]!
  expect(row.delivery).toBe('delivered')

  const forgedSecret = `whsec_${Buffer.from('a-forged-secret').toString('base64')}`
  const forged = await request.post(functionUrl('resend-webhook'), {
    headers: { 'content-type': 'application/json', ...svixHeaders(forgedSecret, rawBody) },
    data: rawBody,
  })
  expect(forged.status()).toBe(401)
})

test('the honeypot answers success and stores nothing', async ({ request }) => {
  const submissionKey = randomUUID()
  const response = await request.post(functionUrl('contact'), {
    headers: { origin: SITE_ORIGIN },
    data: {
      name: 'بوت',
      email: `bot-${Date.now()}@example.com`,
      message: 'محاولة',
      submissionKey,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      website: 'http://spam.example',
    },
  })
  expect(response.status()).toBe(201)
  const row = (await db.query('select 1 from public.contacts where submission_key = $1', [submissionKey])).rows
  expect(row).toEqual([])
})

// A 400 TURNSTILE cannot be produced locally: the always-pass test secret
// accepts ANY token, not just the dummy one (verified live 2026-09-26,
// artifacts/acceptance/P06/siteverify-live-non-dummy-token.json). The 400
// mapping is therefore covered by tests/unit/turnstile.test.ts; here the
// schema still refuses an over-length token before anything is stored.
test('an over-length Turnstile token is refused by the schema', async ({ request }) => {
  const response = await request.post(functionUrl('contact'), {
    headers: { origin: SITE_ORIGIN },
    data: {
      name: 'زائر',
      email: `bad-token-${Date.now()}@example.com`,
      message: 'رسالة',
      submissionKey: randomUUID(),
      turnstileToken: 'X'.repeat(2049),
    },
  })
  expect(response.status()).toBe(422)
  const body = (await response.json()) as { ok: boolean; error: { code: string } }
  expect(body.error.code).toBe('INVALID')
})

test('a non-JSON content type is refused with 415', async ({ request }) => {
  const response = await request.post(functionUrl('contact'), {
    headers: { origin: SITE_ORIGIN, 'content-type': 'text/plain' },
    data: 'not json',
  })
  expect(response.status()).toBe(415)
})

test('an oversized body is refused with 413', async ({ request }) => {
  const response = await request.post(functionUrl('contact'), {
    headers: { origin: SITE_ORIGIN },
    data: { junk: 'x'.repeat(9_000) },
  })
  expect(response.status()).toBe(413)
})

test('the jobs endpoint refuses a missing or wrong bearer', async ({ request }) => {
  const missing = await request.post(functionUrl('outbox'), {})
  expect(missing.status()).toBe(401)
  const wrong = await request.post(functionUrl('outbox'), { headers: { authorization: 'Bearer wrong-secret' } })
  expect(wrong.status()).toBe(401)
})

// ---------------------------------------------------------------------------
// Round 2: the admin screens (owner home, email problems, stats, settings,
// role boundaries). Browser tests against `next dev`. There is no inbox
// screen (D31): contact messages reach the owner's mailbox.

test('the owner home shows real counts and no inbox (D31)', async ({ page }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByText(/مشكلات تحتاج انتباهًا: [\d,]+\+?/)).toBeVisible()
  // The other real blocks answer too: no invented numbers, no error state.
  await expect(page.getByText('تعذّر التحميل')).toHaveCount(0)
  await expect(page.getByText('مهام التشغيل')).toBeVisible()
  await expect(page.getByText('إرسال البريد:')).toBeVisible()
  await expect(page.getByText('بناء الموقع:')).toBeVisible()
  // The sweep test above recorded a run, so the daily job shows its status.
  await expect(page.getByText(/تنظيف الوسائط: سليم/)).toBeVisible()
  await expect(page.getByText('غير متاحة', { exact: false })).toBeVisible() // analytics: not configured locally
  // Contact messages are not an admin concern any more.
  await expect(page.getByText('رسائل جديدة', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'الوارد' })).toHaveCount(0)
})

test('the owner home shows the backup job: never run, ok, then stale after 30 days (D35)', async ({ page }) => {
  const owner = await createStaff('owner')
  // A manual job with no schedule: never-run, ok and stale each have their
  // own backup wording on the home.
  await db.query("delete from finance.job_runs where job = 'backup'")
  await signInByCode(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByText('النسخ الاحتياطي: لا توجد نسخة بعد.')).toBeVisible()

  await db.query(
    "insert into finance.job_runs (job, status, detail, started_at, finished_at) values ('backup', 'ok', '{\"files\": 6, \"objects\": 2, \"bytes\": 1234}'::jsonb, now() - interval '1 minute', now())",
  )
  await page.goto('/admin')
  await expect(page.getByText(/النسخ الاحتياطي: سليم/)).toBeVisible()

  await db.query("update finance.job_runs set finished_at = now() - interval '31 days' where job = 'backup'")
  // The nightly purge keeps each job's newest run, so the warning outlives it (S17.1).
  const purge = await db.query<{ command: string }>("select command from cron.job where jobname = 'job-runs-purge'")
  await db.query(purge.rows[0]!.command)
  await page.goto('/admin')
  await expect(page.getByText('آخر نسخة احتياطية أقدم من 30 يومًا.')).toBeVisible()

  await db.query("delete from finance.job_runs where job = 'backup'")
})

test('the email job warns only when a row has waited more than 10 minutes (I35)', async ({ page }) => {
  // Premise: locally the Vault values are unset, so pg_cron's kick calls
  // nothing and a planted due row stays due.
  const vault = await db.query<{ n: number }>(
    "select count(*)::int as n from vault.decrypted_secrets where name in ('functions_url', 'jobs_secret')",
  )
  expect(vault.rows[0]!.n).toBe(0)

  // Park every due row (the beforeAll park misses expired sending leases,
  // which count now) and leave one healthy run three hours old: on a quiet
  // site an old last run is not a warning.
  await db.query(
    `update finance.email_outbox set next_at = now() + interval '1 day'
       where status in ('pending', 'uncertain') and next_at <= now()`,
  )
  await db.query(
    `update finance.email_outbox set lease_until = now() + interval '1 day'
       where status = 'sending' and lease_until < now()`,
  )
  await db.query("delete from finance.job_runs where job = 'email_outbox'")
  await db.query(
    "insert into finance.job_runs (job, status, detail, started_at, finished_at) values ('email_outbox', 'ok', '{\"claimed\": 0, \"accepted\": 0}'::jsonb, now() - interval '3 hours', now() - interval '3 hours')",
  )

  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByText(/إرسال البريد: سليم/)).toBeVisible()
  await expect(page.getByText('بريد ينتظر الإرسال منذ أكثر من 10 دقائق. تأكد من الجدولة.')).toHaveCount(0)

  // A row that has waited 15 minutes with no run in those 10 minutes warns.
  const dedupeKey = `p06-i35-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const recipient = `${dedupeKey}@example.com`
  await db.query(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, next_at)
     values ($1, 'contact_notice', 1, $2, '{"contactId":"00000000-0000-0000-0000-000000000000"}'::jsonb,
             now() - interval '15 minutes')`,
    [dedupeKey, recipient],
  )
  fixtureRecipients.push(recipient)
  await page.goto('/admin')
  await expect(page.getByText('بريد ينتظر الإرسال منذ أكثر من 10 دقائق. تأكد من الجدولة.')).toBeVisible()

  // Leave the site quiet for the later screens.
  await db.query('delete from finance.email_outbox where recipient = $1', [recipient])
})

test('an operations member sees email but not stats or settings, and there is no inbox', async ({ page, request }) => {
  const operations = await createStaff('operations')
  await signInByCode(page, operations.email)
  await page.goto('/admin')
  await expect(page.getByRole('link', { name: 'البريد', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'الوارد' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'الإحصاءات' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'الإعدادات' })).toHaveCount(0)

  // D31: the inbox screen is gone, not hidden.
  const inbox = await page.goto('/admin/inbox')
  expect(inbox?.status()).toBe(404)
  await page.goto('/admin/email')
  await expect(page.getByRole('heading', { name: 'البريد' })).toBeVisible()

  const token = await staffAccessToken(operations.email)
  const response = await request.post(functionUrl('admin'), {
    headers: { authorization: `Bearer ${token}`, apikey: status.PUBLISHABLE_KEY },
    data: { action: 'stats' },
  })
  expect(response.status()).toBe(403)
})

test('an editor gets no email RPC', async ({ page }) => {
  const editor = await createStaff('editor')
  await signInByCode(page, editor.email)
  // The screen knows the role from the shell and does not ask (AUDIT-2 ADMIN-ops-5);
  // the RPC itself is refused for an editor too (tests/integration).
  const emailRpcs: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/rpc/outbox_attention')) emailRpcs.push(request.url())
  })
  await page.goto('/admin/email')
  await expect(page.getByText('لا تملك صلاحية الوصول')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  expect(emailRpcs).toEqual([])
})

test('email problems: replay exhausted, confirm uncertain, suppressed is refused', async ({ page }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)

  // 1. An exhausted row replays to pending without any confirmation.
  const exhaustedRecipient = await insertOutboxRow('exhausted', null)
  await page.goto('/admin/email')
  const exhaustedRow = page.getByRole('row').filter({ hasText: exhaustedRecipient })
  await expect(exhaustedRow).toBeVisible()
  await exhaustedRow.getByRole('button', { name: 'إعادة الإرسال' }).click()
  await expect(exhaustedRow).toHaveCount(0)
  const replayed = await db.query<{ status: string; attempts: number }>(
    'select status, attempts from finance.email_outbox where recipient = $1',
    [exhaustedRecipient],
  )
  expect(replayed.rows[0]).toEqual({ status: 'pending', attempts: 0 })

  // 2. An uncertain row past the idempotency window needs the checkbox dialog.
  const uncertainRecipient = await insertOutboxRow('uncertain', 24 * 60 * 60)
  await page.goto('/admin/email')
  const uncertainRow = page.getByRole('row').filter({ hasText: uncertainRecipient })
  await expect(uncertainRow).toBeVisible()
  await uncertainRow.getByRole('button', { name: 'إعادة الإرسال' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('قد تكون هذه الرسالة وصلت من قبل؛ إعادة إرسالها قد تكرّرها.')).toBeVisible()
  const confirmButton = dialog.getByRole('button', { name: 'إعادة الإرسال' })
  await expect(confirmButton).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()
  await expect(uncertainRow).toHaveCount(0)
  const confirmed = await db.query<{ status: string }>(
    'select status from finance.email_outbox where recipient = $1',
    [uncertainRecipient],
  )
  expect(confirmed.rows[0]!.status).toBe('pending')

  // 3. A suppressed recipient is refused with the Arabic message (23514).
  const suppressedRecipient = await insertOutboxRow('exhausted', null)
  await db.query(
    "insert into finance.email_suppressions (recipient_hash, reason) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'manual')",
    [suppressedRecipient],
  )
  await page.goto('/admin/email')
  const suppressedRow = page.getByRole('row').filter({ hasText: suppressedRecipient })
  await suppressedRow.getByRole('button', { name: 'إعادة الإرسال' }).click()
  await expect(suppressedRow.getByText('المستلم محظور بعد ارتداد أو شكوى؛ لا يمكن الإرسال إليه.')).toBeVisible()
  const still = await db.query<{ status: string }>(
    'select status from finance.email_outbox where recipient = $1',
    [suppressedRecipient],
  )
  expect(still.rows[0]!.status).toBe('exhausted')

  // 4. The filters follow the replay rule: «تحتاج تدخل» keeps the replayable
  //    rows (the still-exhausted one above), «انتهت» the rows with nothing left
  //    to do (a row already marked suppressed), which show no replay button.
  const endedRecipient = await insertOutboxRow('suppressed', null)
  await page.goto('/admin/email')
  const filters = page.getByRole('group', { name: 'تصفية المشكلات' })
  await filters.getByRole('button', { name: 'تحتاج تدخل' }).click()
  await expect(page.getByRole('row').filter({ hasText: suppressedRecipient })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: endedRecipient })).toHaveCount(0)
  await filters.getByRole('button', { name: 'انتهت' }).click()
  const endedRow = page.getByRole('row').filter({ hasText: endedRecipient })
  await expect(endedRow).toBeVisible()
  await expect(endedRow.getByRole('button', { name: 'إعادة الإرسال' })).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: suppressedRecipient })).toHaveCount(0)
})

test('an operations member can replay a failed outbox row through the risk-acceptance flow', async ({ page }) => {
  const operations = await createStaff('operations')
  await signInByCode(page, operations.email)

  // An uncertain row past the provider's idempotency window: replaying it
  // must demand the explicit duplicate-risk confirmation, from operations
  // just as from an owner.
  const recipient = await insertOutboxRow('uncertain', 24 * 60 * 60)
  await page.goto('/admin/email')
  const row = page.getByRole('row').filter({ hasText: recipient })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'إعادة الإرسال' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const confirmButton = dialog.getByRole('button', { name: 'إعادة الإرسال' })
  await expect(confirmButton).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await confirmButton.click()
  await expect(row).toHaveCount(0)

  const replayed = await db.query<{ status: string }>('select status from finance.email_outbox where recipient = $1', [
    recipient,
  ])
  expect(replayed.rows[0]!.status).toBe('pending')
})

test('settings: SEO and WhatsApp persist, the preview normalizes, status shows no secrets', async ({ page }) => {
  // The version live before this test edits anything: the one it restores at
  // the end (the oldest row can predate the social links, C09).
  const live = await db.query<{ seq: number }>(
    "select seq from public.published_documents where collection = 'site_settings' and doc_id = 'site'",
  )
  const originalSeq = String(live.rows[0]!.seq)
  cleanups.push(() => restoreLive('site_settings', 'site', Number(originalSeq)))

  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin/content/site_settings/edit?id=site')

  await page.getByLabel('عنوان SEO').fill('استوديو أنس — الموقع الرسمي')
  await page.getByLabel('وصف SEO').fill('وصف الاختبار')
  await page.getByLabel('بريد التواصل').fill('hello@anas.studio')
  await page.getByLabel('رقم واتساب').fill('050-123-4567')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // Reload: the values persist in the form, and the preview normalizes.
  await page.goto('/admin/content/site_settings/edit?id=site')
  await expect(page.getByLabel('رقم واتساب')).toHaveValue('050-123-4567')
  await page.goto('/admin/settings')
  await expect(page.getByText('https://wa.me/966501234567')).toBeVisible()
  // D35: the backups section sits after the store section.
  await expect(page.getByRole('heading', { name: 'النسخ الاحتياطي' })).toBeVisible()
  await expect(page.getByText('مرة واحدة: ثبّت Docker Desktop و Node 24 و pnpm و Supabase CLI', { exact: false })).toBeVisible()

  // The configuration status renders (Mailpit locally) and carries no secrets.
  await expect(page.getByText('Mailpit (محلي)', { exact: false })).toBeVisible()
  const env = localEnv()
  const html = await page.content()
  expect(html).not.toContain(env.JOBS_SECRET)
  expect(html).not.toContain(env.RESEND_WEBHOOK_SECRET)

  // Restore the version that was live at the start, as cms.spec.ts does, and
  // publish it: the database is left as found.
  await page.goto('/admin/content/site_settings/edit?id=site')
  await page
    .locator('table tbody tr')
    .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${originalSeq}$`) }) })
    .getByRole('button', { name: 'استعادة' })
    .click()
  // The form reloads with the restored version; publishing before that would
  // publish this test's edit again.
  await expect(page.getByLabel('رقم واتساب')).toHaveValue('')
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  await page.goto('/admin/settings')
  await expect(page.getByText('غير مُعدّ بعد.')).toBeVisible()
})

test('the owner saves the store seller details through the step-up dialog', async ({ page }) => {
  const owner = await createStaff('owner')

  // Sign in once by email code (aal1) and enrol TOTP, the auth.spec.ts way.
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(owner.email)
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
  const firstCode = await readCodeFromMailpit(owner.email)
  await page.getByLabel('رمز الدخول').fill(firstCode)
  await page.getByRole('button', { name: 'تحقق' }).click()
  await expect(page).toHaveURL(/\/admin$/)

  await page.locator('nav').getByRole('link', { name: 'الأمان' }).click()
  await expect(page).toHaveURL(/\/admin\/security$/)
  const secret = await page.locator('[class*="secret"]').innerText()
  await page.getByLabel('رمز التحقق').fill(totpCode(secret))
  await page.getByRole('button', { name: 'تفعيل' }).click()
  await expect(page.getByText('تطبيق المصادقة مفعّل')).toBeVisible()

  // Enrolment itself verified a TOTP, which would pass the 5-minute check, so
  // sign out and back in with a fresh email code (aal1): the save below must
  // go through the step-up dialog.
  await page.locator('nav').getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await signInByCode(page, owner.email, firstCode)

  const marker = `${Date.now()}`
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'إعدادات المتجر' })).toBeVisible()
  await page.getByLabel('الاسم القانوني للبائع').fill(`بائع الاختبار ${marker}`)
  await page.getByLabel('عنوان البائع').fill(`الرياض ${marker}`)
  await page.getByLabel('رقم قيد شهادة العمل الحر').fill(marker)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رمز التحقق').fill(totpCode(secret))
  await dialog.getByRole('button', { name: 'تحقق' }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await expect(page.getByText(/إصدار الإعدادات: \d+/)).toBeVisible()

  // Reload: the values come back from the database.
  await page.reload()
  await expect(page.getByLabel('الاسم القانوني للبائع')).toHaveValue(`بائع الاختبار ${marker}`)
  await expect(page.getByLabel('عنوان البائع')).toHaveValue(`الرياض ${marker}`)
  await expect(page.getByLabel('رقم قيد شهادة العمل الحر')).toHaveValue(marker)
})

test('screenshots at 360 and 1440 with no horizontal overflow', async ({ page }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  // An attention row so the email screen shows data.
  await insertOutboxRow('exhausted', null)

  const shots = mkdirScreenshots()
  // Waits must be visible at BOTH widths: at 360px the responsive table hides
  // its `thead`, so column headers can't be wait targets. Every target waits
  // for the DATA, not the chrome: settings now loads two blocks (the status
  // and the store section), so its wait is the store row's own currency line
  // «ريال سعودي», which renders only once commerce_settings_get answered
  // (the resolved status is asserted in the settings test above); the home
  // count line reads «يحمّل...» until its query returns; and «إعادة الإرسال»
  // also matches the (hidden) replay dialog, so the email wait is a row's own
  // replay button.
  const targets: Array<{ name: string; path: string; wait: string | Locator }> = [
    { name: 'home', path: '/admin', wait: page.getByText(/مشكلات تحتاج انتباهًا: [\d,]+/) },
    {
      name: 'email',
      path: '/admin/email',
      wait: page.locator('tbody tr').getByRole('button', { name: 'إعادة الإرسال' }).first(),
    },
    // «المتجر» is also the nav link, which is always there; this line renders only once the stats answered.
    { name: 'stats', path: '/admin/stats', wait: 'وقت التوليد:' },
    { name: 'settings', path: '/admin/settings', wait: page.getByText('ريال سعودي').first() },
  ]
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    for (const target of targets) {
      await page.goto(target.path)
      const ready = typeof target.wait === 'string' ? page.getByText(target.wait, { exact: false }).first() : target.wait
      await ready.waitFor()
      const { scroll, inner, tableOverflow, offscreenControls } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        // A table that scrolls inside its own box hides columns even while the
        // page itself does not overflow — how the M5 regression passed the
        // page-level check below. Every row control must also sit on screen.
        tableOverflow: Math.max(
          0,
          ...[...document.querySelectorAll('table')].map(
            (table) => (table.parentElement?.scrollWidth ?? 0) - (table.parentElement?.clientWidth ?? 0),
          ),
        ),
        offscreenControls: [...document.querySelectorAll('tbody button')].filter((button) => {
          const box = button.getBoundingClientRect()
          return box.left < 0 || box.right > window.innerWidth
        }).length,
      }))
      // Recorded per page and viewport: scrollWidth must never exceed innerWidth.
      expect(scroll, `${target.name}-${viewport.width}: scrollWidth ${scroll}, innerWidth ${inner}`).toBeLessThanOrEqual(
        inner,
      )
      expect(tableOverflow, `${target.name}-${viewport.width}: a table scrolls sideways by ${tableOverflow}px`).toBe(0)
      expect(offscreenControls, `${target.name}-${viewport.width}: row controls off screen`).toBe(0)
      await page.screenshot({ path: join(shots, `${target.name}-${viewport.width}.png`), fullPage: true })
    }
  }
})

function mkdirScreenshots(): string {
  const dir = shotsDir('P06')
  mkdirSync(dir, { recursive: true })
  return dir
}
