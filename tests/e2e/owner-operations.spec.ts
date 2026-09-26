// P06 e2e: the contact API, the jobs run and the delivery webhook (round 1,
// API-level), plus the owner home, inbox, email problems, statistics,
// settings and role boundaries (round 2, browser) — against `next dev`
// (`PLAYWRIGHT_BASE_URL=http://localhost:3000`). Local-only values come from
// `.env.local` (never `.env`); Turnstile uses Cloudflare's always-pass test
// secret and the dummy token, so no real challenge is solved and no real
// provider is called — email lands in the local stack's Mailpit.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { createStaff, localEnv, signInByCode, staffAccessToken, status, svixHeaders } from './helpers'

const env = localEnv()

let db: Client
let ownerEmail: string
let marker: string
let contactId: string
let noticeProviderId: string
let noticeRecipient: string

// Round 2 (browser) state: the message the home test submits and the email
// fixture rows this spec inserts (removed in afterAll).
let round2Marker = ''
const fixtureRecipients: string[] = []

/** Parses the digits out of a Latin-digit home count line like «رسائل جديدة: 1,234». */
async function homeCount(page: Page, label: string): Promise<number> {
  const text = (await page.getByText(label, { exact: false }).first().textContent()) ?? ''
  const digits = text.replace(/,/g, '').match(/\d+/)
  if (!digits) throw new Error(`No count found in: ${text}`)
  return Number(digits[0])
}

/** Inserts one attention-worthy outbox row directly (local postgres fixture). */
async function insertOutboxRow(rowStatus: string, firstAttemptAgoSeconds: number | null): Promise<string> {
  const recipient = `p06r2-${rowStatus}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await db.query(
    `insert into finance.email_outbox
       (dedupe_key, kind, priority, recipient, payload, status, attempts, max_attempts, last_error, first_attempt_at)
     values ($1, 'contact_notice', 1, $2, '{"contactId":"00000000-0000-0000-0000-000000000000"}'::jsonb,
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

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  // Guarantees at least one active notice recipient for every submission.
  const owner = await createStaff('owner')
  ownerEmail = owner.email
  // Park every older due notice so the single jobs run below dispatches only
  // this spec's notice (the shared local database has pending rows from the
  // integration suites; the claim takes at most 10 rows per run).
  await db.query(
    `update finance.email_outbox set next_at = now() + interval '1 day',
       first_attempt_at = now() - interval '2 days'
     where status in ('pending', 'uncertain', 'sending')`,
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
  await db.end()
})

test('a contact submission is stored and its notices queued', async ({ request }) => {
  marker = `p06-e2e-${Date.now()}`
  const submissionKey = randomUUID()
  // A unique visitor IP per run: without Cloudflare, every dev submission
  // shares the literal `local` bucket (5 per hour, fixed window), which
  // repeated runs inside one hour would exhaust.
  const visitorIp = `198.51.100.${Math.floor(Math.random() * 254) + 1}`
  const response = await request.post('/api/contact', {
    headers: { 'cf-connecting-ip': visitorIp },
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
    await db.query<{ id: string; status: string }>('select id, status from public.contacts where submission_key = $1', [
      submissionKey,
    ])
  ).rows[0]
  expect(contact).toBeDefined()
  expect(contact!.status).toBe('new')
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

test('with no jobs run the message is still in the inbox, so the inbox survives an email outage', async () => {
  const row = (await db.query<{ status: string }>('select status from public.contacts where id = $1', [contactId])).rows[0]!
  expect(row.status).toBe('new')
})

test('a jobs run delivers the notices through Mailpit, sent but not yet delivered', async ({ request }) => {
  const response = await request.post('/api/jobs/run', {
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

  // The notice itself is in Mailpit: search for the unique marker.
  const mailpit = env.EMAIL_DEV_MAILPIT_URL ?? status.MAILPIT_URL
  let found = false
  for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
    const search = (await (
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(marker)}`)
    ).json()) as { messages?: Array<{ ID: string }> }
    const latest = search.messages?.[0]
    if (latest) {
      const message = (await (await fetch(`${mailpit}/api/v1/message/${latest.ID}`)).json()) as { Text?: string }
      expect(message.Text ?? '').toContain(marker)
      found = true
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  expect(found).toBe(true)
})

test('a signed delivered webhook marks delivery; a forged signature is 401', async ({ request }) => {
  const rawBody = JSON.stringify({
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: { email_id: noticeProviderId, to: [noticeRecipient] },
  })
  const response = await request.post('/api/email/resend/webhook', {
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
  const forged = await request.post('/api/email/resend/webhook', {
    headers: { 'content-type': 'application/json', ...svixHeaders(forgedSecret, rawBody) },
    data: rawBody,
  })
  expect(forged.status()).toBe(401)
})

test('the honeypot answers success and stores nothing', async ({ request }) => {
  const submissionKey = randomUUID()
  const response = await request.post('/api/contact', {
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
  const response = await request.post('/api/contact', {
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
  const response = await request.post('/api/contact', {
    headers: { 'content-type': 'text/plain' },
    data: 'not json',
  })
  expect(response.status()).toBe(415)
})

test('an oversized body is refused with 413', async ({ request }) => {
  const response = await request.post('/api/contact', {
    data: { junk: 'x'.repeat(9_000) },
  })
  expect(response.status()).toBe(413)
})

test('the jobs endpoint refuses a missing or wrong bearer', async ({ request }) => {
  const missing = await request.post('/api/jobs/run', {})
  expect(missing.status()).toBe(401)
  const wrong = await request.post('/api/jobs/run', { headers: { authorization: 'Bearer wrong-secret' } })
  expect(wrong.status()).toBe(401)
})

// ---------------------------------------------------------------------------
// Round 2: the admin screens (owner home, inbox, email problems, stats,
// settings, role boundaries). Browser tests against `next dev`.

test('the owner home shows real counts and rises after a contact submission', async ({ page, request }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin')
  await expect(page.getByText('رسائل جديدة:', { exact: false })).toBeVisible()
  const before = await homeCount(page, 'رسائل جديدة:')

  round2Marker = `p06r2-${Date.now()}`
  const response = await request.post('/api/contact', {
    headers: { 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 254) + 1}` },
    data: {
      name: `زائر ${round2Marker}`,
      email: `guest-${round2Marker}@example.com`,
      message: `رسالة الجولة الثانية ${round2Marker}`,
      submissionKey: randomUUID(),
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    },
  })
  expect(response.status()).toBe(201)

  await page.goto('/admin')
  await expect(page.getByText('رسائل جديدة:', { exact: false })).toBeVisible()
  await expect.poll(() => homeCount(page, 'رسائل جديدة:')).toBe(before + 1)
  // The other real blocks answer too: no invented numbers, no error state.
  await expect(page.getByText('تعذّر التحميل')).toHaveCount(0)
  await expect(page.getByText('مهام التشغيل')).toBeVisible()
  await expect(page.getByText('إرسال البريد:')).toBeVisible()
  await expect(page.getByText('غير متاحة', { exact: false })).toBeVisible() // analytics: not configured locally
})

test('the inbox: opening marks read, closing with a note persists', async ({ page }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin/inbox')

  const row = page.getByRole('button', { name: new RegExp(round2Marker) })
  await expect(row).toBeVisible()
  await row.click()

  // Everything shows: full message, mailto with the encoded reply subject and
  // the M1-encoded address (`@` arrives as %40 in the href).
  await expect(page.getByText(`رسالة الجولة الثانية ${round2Marker}`).last()).toBeVisible()
  const mailtoEmail = encodeURIComponent(`guest-${round2Marker}@example.com`)
  await expect(page.locator(`a[href^="mailto:${mailtoEmail}?subject="]`)).toHaveAttribute(
    'href',
    new RegExp(`mailto:${mailtoEmail}\\?subject=${encodeURIComponent('رد: رسالتك إلى أنس')}$`),
  )

  // Opening a new message marked it read automatically.
  await expect(page.getByLabel('الحالة', { exact: true })).toHaveValue('read')

  await page.getByLabel('الحالة', { exact: true }).selectOption('closed')
  await page.getByLabel('ملاحظات').fill('ملاحظة اختبار الجولة الثانية')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('حُفظ')).toBeVisible()

  // Reload: the values persist.
  await page.goto('/admin/inbox')
  await page.getByRole('button', { name: new RegExp(round2Marker) }).click()
  await expect(page.getByLabel('الحالة', { exact: true })).toHaveValue('closed')
  await expect(page.getByLabel('ملاحظات')).toHaveValue('ملاحظة اختبار الجولة الثانية')

  const saved = await db.query<{ status: string; notes: string | null; assigned_to: string | null }>(
    'select status, notes, assigned_to from public.contacts where email = $1',
    [`guest-${round2Marker}@example.com`],
  )
  expect(saved.rows[0]!.status).toBe('closed')
  expect(saved.rows[0]!.notes).toBe('ملاحظة اختبار الجولة الثانية')

  // Assignment: تعيين لي writes the signed-in user, إلغاء التعيين clears it.
  await page.getByRole('button', { name: 'تعيين لي' }).click()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('حُفظ')).toBeVisible()
  const assigned = await db.query<{ assigned_to: string | null }>(
    'select assigned_to from public.contacts where email = $1',
    [`guest-${round2Marker}@example.com`],
  )
  expect(assigned.rows[0]!.assigned_to).toBe(owner.userId)
  await page.getByRole('button', { name: 'إلغاء التعيين' }).click()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('حُفظ')).toBeVisible()
  const unassigned = await db.query<{ assigned_to: string | null }>(
    'select assigned_to from public.contacts where email = $1',
    [`guest-${round2Marker}@example.com`],
  )
  expect(unassigned.rows[0]!.assigned_to).toBeNull()
})

test('an operations member sees inbox and email but not stats or settings', async ({ page, request }) => {
  const operations = await createStaff('operations')
  await signInByCode(page, operations.email)
  await page.goto('/admin')
  await expect(page.getByRole('link', { name: 'الوارد' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'البريد', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'الإحصاءات' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'الإعدادات' })).toHaveCount(0)

  await page.goto('/admin/inbox')
  await expect(page.getByRole('heading', { name: 'الوارد' })).toBeVisible()
  await expect(page.getByText('تعذّر تحميل الرسائل.')).toHaveCount(0)
  await page.goto('/admin/email')
  await expect(page.getByRole('heading', { name: 'البريد' })).toBeVisible()

  const token = await staffAccessToken(operations.email)
  const response = await request.get('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } })
  expect(response.status()).toBe(403)
})

test('an editor sees neither inbox rows nor the email RPC', async ({ page }) => {
  const editor = await createStaff('editor')
  await signInByCode(page, editor.email)
  await page.goto('/admin/inbox')
  // RLS returns nothing: the role-aware empty state, not an error and not rows.
  await expect(page.getByText('لا توجد رسائل متاحة لك.')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.goto('/admin/email')
  // The RPC itself is refused for an editor.
  await expect(page.getByText('تعذّر تحميل مشكلات البريد.')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
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
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  await page.goto('/admin/content/site_settings/site')

  await page.getByLabel('عنوان SEO').fill('استوديو أنس — الموقع الرسمي')
  await page.getByLabel('وصف SEO').fill('وصف الاختبار')
  await page.getByLabel('بريد التواصل').fill('hello@anas.studio')
  await page.getByLabel('رقم واتساب').fill('050-123-4567')
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()

  // Reload: the values persist in the form, and the preview normalizes.
  await page.goto('/admin/content/site_settings/site')
  await expect(page.getByLabel('رقم واتساب')).toHaveValue('050-123-4567')
  await page.goto('/admin/settings')
  await expect(page.getByText('https://wa.me/966501234567')).toBeVisible()

  // The configuration status renders (Mailpit locally) and carries no secrets.
  await expect(page.getByText('Mailpit (محلي)', { exact: false })).toBeVisible()
  const env = localEnv()
  const html = await page.content()
  expect(html).not.toContain(env.JOBS_SECRET)
  expect(html).not.toContain(env.RESEND_WEBHOOK_SECRET)

  // Restore the settings document as cms.spec.ts does, and publish.
  await page.goto('/admin/content/site_settings/site')
  const historyTable = page.locator('table')
  await historyTable.locator('tbody tr').last().getByRole('button', { name: 'استعادة' }).click()
  await page.getByRole('button', { name: 'نشر' }).click()
  await expect(page.getByText('نشر: تم بنجاح.')).toBeVisible()
  await page.goto('/admin/settings')
  await expect(page.getByText('غير مُعدّ بعد.')).toBeVisible()
})

test('screenshots at 360 and 1440 with no horizontal overflow', async ({ page }) => {
  const owner = await createStaff('owner')
  await signInByCode(page, owner.email)
  // An attention row so the email screen shows data.
  await insertOutboxRow('exhausted', null)

  const shots = mkdirScreenshots()
  // Waits must be visible at BOTH widths: at 360px the responsive tables hide
  // their `thead`, so column headers like «أول الرسالة» can't be wait targets.
  // Two targets must wait for the DATA, not the chrome: the inbox's «الكل»
  // filter renders before its rows (an empty table would be screenshot), so
  // it waits for a row locator, and settings' «حالة الإعداد» renders while
  // the status still shows «يحمّل...», so it waits for the resolved status
  // (locally «Mailpit (محلي)»).
  // The home and email waits target data too: the home count line reads
  // «يحمّل...» until its query returns, and «إعادة الإرسال» also matches the
  // (hidden) replay dialog, so the email wait is a row's own replay button.
  const targets: Array<{ name: string; path: string; wait: string | Locator }> = [
    { name: 'home', path: '/admin', wait: page.getByText(/رسائل جديدة: [\d,]+/) },
    { name: 'inbox', path: '/admin/inbox', wait: page.locator('tbody tr').first() },
    {
      name: 'email',
      path: '/admin/email',
      wait: page.locator('tbody tr').getByRole('button', { name: 'إعادة الإرسال' }).first(),
    },
    { name: 'stats', path: '/admin/stats', wait: 'المتجر' },
    { name: 'settings', path: '/admin/settings', wait: 'Mailpit' },
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
    // The inbox with a message open.
    await page.goto('/admin/inbox')
    await page.locator('tbody tr').first().getByRole('button').click()
    await expect(page.getByLabel('الحالة', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(shots, `inbox-open-${viewport.width}.png`), fullPage: true })
  }
})

function mkdirScreenshots(): string {
  const dir = join('artifacts', 'acceptance', 'P06', 'screenshots')
  mkdirSync(dir, { recursive: true })
  return dir
}
