// P08 round 11b e2e: the owner's money actions in the browser on `next dev`, against the real local stack with real
// sign-in (an email code read from Mailpit, once per role) and a real TOTP enrolment for the owner, so the step-up
// dialog really verifies a code. The orders are real too (made through `checkout_create` and paid through
// `apply_verified_payment` by the integration harness), so every screen reads what the SQL really answers. What is
// mocked is the `admin` function's replies (`page.route` on `**/functions/v1/admin`): the real refund journey against
// the Moyasar emulator is round 12's. Every request body the screens send is asserted exactly, field by field. The
// reconciliation screen reads a mocked `reconciliation_list` and `disputes_list` (the Data API,
// `**/rest/v1/rpc/...`). Each test runs at 360 and at 1440, on orders seeded for that width. Screenshots land in
// admin-money-*.png under shotsDir('P08'): the accepted evidence folder only for an ACCEPTANCE_PACKAGE=P08 run,
// test-results/ otherwise.
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

import { expect, test, type Locator, type Page, type Request } from '@playwright/test'

import { EXTERNAL_SENTENCE, REFUND_FAILED, REFUND_UNCERTAIN, REFUND_WARNING, REREAD_FAILED, riyadhToday } from '../../src/lib/admin-money'
import { formatMoney } from '../../src/lib/format'
import { commerceHarness, sha256, type Harness, type Paid } from '../integration/support'
import { localEnv, signInByCode, totpCode } from './helpers'
import { shotsDir } from './shots'

const SHOTS = shotsDir('P08')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const STATES = {
  owner: 'test-results/orders-money/owner.json',
  operations: 'test-results/orders-money/operations.json',
  editor: 'test-results/orders-money/editor.json',
}
const NO_ACCESS = 'لا تملك صلاحية الوصول'
const BAD_REPLY = 'تعذّر قراءة الرد؛ حدّث الصفحة.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ADMIN = '**/functions/v1/admin'
const MONEY_BUTTONS = ['إعادة المبلغ', 'استرداد هذه الدفعة', 'أعد الفحص', 'تسجيل استرداد خارجي', 'تسجيل اعتراض', 'تسجيل فرق', 'إضافة متابعة']

type Member = { userId: string; email: string }
let h: Harness
let owner: Member
let operations: Member
let editor: Member
let secret = ''
const events: string[] = []

test.describe.configure({ timeout: 120_000 })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  h = await commerceHarness(localEnv().TOKEN_HASH_PEPPER ?? `orders-money-pepper-${randomUUID()}`)
  owner = await h.makeStaff('owner')
  operations = await h.makeStaff('operations')
  editor = await h.makeStaff('editor')
  for (const [role, member] of [
    ['owner', owner],
    ['operations', operations],
    ['editor', editor],
  ] as const) {
    // An empty state of its own: a context made here would otherwise start from the state a test group names.
    const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await signInByCode(page, member.email)
    if (role === 'owner') {
      // The owner enrols an authenticator the way the security page does: the step-up dialog then verifies a real code.
      await page.locator('nav').getByRole('link', { name: 'الأمان' }).click()
      await expect(page).toHaveURL(/\/admin\/security$/)
      secret = await page.locator('[class*="secret"]').innerText()
      await page.getByLabel('رمز التحقق').fill(totpCode(secret))
      await page.getByRole('button', { name: 'تفعيل' }).click()
      await expect(page.getByText('تطبيق المصادقة مفعّل')).toBeVisible()
    }
    await context.storageState({ path: STATES[role] })
    await context.close()
  }
  // `next dev` compiles a page on its first request: do it once, before any test has a clock running.
  for (const route of ['/admin/sign-in', '/admin', '/admin/orders', '/admin/orders/view', '/admin/orders/reconciliation']) {
    await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
  }
})

test.afterAll(async () => {
  rmSync('test-results/orders-money', { recursive: true, force: true })
  if (events.length > 0) await h?.postgres.query('delete from finance.payment_events where event_id = any($1::text[])', [events])
  await h?.stop()
})

// ---- seeds --------------------------------------------------------------------------------------------------------

/** A variant as the screens name it: its SKU, and «product: variant» for the line that carries it. */
type Variant = { id: string; sku: string; name: string }
async function variant(make: Promise<string>): Promise<Variant> {
  const id = await make
  const row = await h.row('select v.sku, v.title, p.title as product from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1', [id])
  return { id, sku: row.sku as string, name: `${row.product}: ${row.title}` }
}

/** A refund asked for and, when `result` is given, answered by the provider's new total (what the owner's screen will do from here on). */
async function askRefund(order: Paid, amount: number, allocation: Record<string, unknown>, result: { providerRefunded: number } | null): Promise<string> {
  const key = randomUUID()
  const asked = await h.call('refund_request', {
    p_actor: owner.userId,
    p_order: order.id,
    p_attempt: order.attemptId,
    p_review_payment: null,
    p_amount: amount,
    p_reason: 'استرداد سابق',
    p_allocation: allocation,
    p_idempotency_key: key,
    p_request_hash: sha256(`hash:${key}`),
    p_return: null,
    p_provider_refunded: 0,
  })
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
  if (result !== null) {
    const done = await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: result.providerRefunded, p_error: null })
    expect(done, JSON.stringify(done)).toMatchObject({ ok: true, status: 'succeeded' })
  }
  return asked.refundId as string
}

interface Seed {
  /** Two physical lines and a digital one with shipping; 25.00 of the first line and 10.00 of the shipping are already refunded; a received return of the second line has no refund. */
  form: { order: Paid; x: Variant; y: Variant; digital: Variant; returnId: string }
  /** A refund in flight. */
  inflight: { order: Paid; refundId: string }
  /** A paid order with a second payment on its invoice: one review payment. */
  reviewed: { order: Paid; paymentId: string }
  refunded: Paid
}

async function seed(): Promise<Seed> {
  const x = await variant(h.physical(6000, 10))
  const y = await variant(h.physical(4000, 10))
  const digital = await variant(h.digital(3500))
  const order = await h.paid([
    { variantId: x.id, quantity: 1 },
    { variantId: y.id, quantity: 1 },
    { variantId: digital.id, quantity: 1 },
  ])
  await askRefund(order, 3500, { items: [{ itemId: order.items[0]!.id, amount: 2500 }], shipping: 1000 }, { providerRefunded: 3500 })
  // Shipped lines can be returned: the second line comes back and its goods arrive, with no refund linked yet.
  await h.postgres.query("update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-' || left(order_item_id::text, 8), shipped_at = now() where order_id = $1", [order.id])
  const request = await h.call('return_request_create', {
    p_order_number: order.number,
    p_access_token_hash: order.hash,
    p_items: [{ itemId: order.items[1]!.id, quantity: 1 }],
    p_reason: 'سبب الإرجاع',
    p_ip_hash: h.ipHash(),
    p_mode: 'test',
  })
  expect(request, JSON.stringify(request)).toMatchObject({ ok: true })
  await h.postgres.query("update finance.return_requests set state = 'received' where id = $1", [request.returnId])
  // The webhook events of its payment, as the order screen lists them (a processed one that was refused, and one that was not).
  const ids = [`evt-money-${randomUUID()}`, `evt-money-${randomUUID()}`]
  events.push(...ids)
  await h.postgres.query(
    `insert into finance.payment_events (event_id, type, live, provider_payment_id, received_at, processed_at, outcome, error, attempts)
     values ($1, 'payment_paid', false, $3, now() - interval '2 hours', now() - interval '2 hours', 'paid', null, 1),
            ($2, 'payment_refunded', false, $3, now() - interval '1 hour', now() - interval '1 hour', 'ignored', 'NO_DELTA', 3)`,
    [ids[0], ids[1], order.paymentId],
  )

  const inflightOrder = await h.paid([{ variantId: (await variant(h.physical(4000, 10))).id, quantity: 1 }])
  const refundId = await askRefund(inflightOrder, 4000, { items: [{ itemId: inflightOrder.items[0]!.id, amount: 4000 }] }, null)

  const reviewedOrder = await h.paid([{ variantId: (await variant(h.digital(3500))).id, quantity: 1 }])
  const paymentId = randomUUID()
  const second = await h.applyPayment(reviewedOrder, { invoiceId: reviewedOrder.invoiceId, paymentId })
  expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'review', reason: 'SECOND_PAYMENT' })

  const refunded = await h.paid([{ variantId: (await variant(h.physical(4000, 10))).id, quantity: 1 }])
  await h.refundFully(refunded, owner.userId)

  return { form: { order, x, y, digital, returnId: request.returnId as string }, inflight: { order: inflightOrder, refundId }, reviewed: { order: reviewedOrder, paymentId }, refunded }
}

// ---- helpers ------------------------------------------------------------------------------------------------------

const main = (page: Page): Locator => page.locator('main')
const section = (page: Page, name: string): Locator => main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
const card = (page: Page, text: string): Locator => main(page).locator('[class*="listItem"]').filter({ hasText: text })
const statusLine = (page: Page): Locator => main(page).getByRole('status')
const alertLine = (page: Page): Locator => main(page).getByRole('alert')
const viewOf = (order: { id: string }): string => `/admin/orders/view?id=${order.id}`
const button = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true })
/** The field of a form that carries a label: its input, its remainder and its refusal. */
const fieldOf = (scope: Locator, name: string): Locator => scope.locator('[class*="field"]').filter({ has: scope.page().getByLabel(name, { exact: true }) })

/** The Data API calls a page makes, by function (what a screen asked, and whether it asked at all). */
function watchRpc(page: Page) {
  const calls: Array<{ fn: string; body: Record<string, unknown> | null }> = []
  page.on('request', (request) => {
    const match = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(request.url())
    if (match === null || request.method() !== 'POST') return
    let body: Record<string, unknown> | null = null
    try {
      body = request.postDataJSON() as Record<string, unknown>
    } catch {
      // Not JSON: nothing to read.
    }
    calls.push({ fn: match[1]!, body })
  })
  return {
    count: (fn: string): number => calls.filter((call) => call.fn === fn).length,
    bodies: (fn: string): Array<Record<string, unknown> | null> => calls.filter((call) => call.fn === fn).map((call) => call.body),
  }
}

/** The console errors and uncaught exceptions of the page: what a React warning or a render that throws looks like in `next dev`. */
function watchProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(`console: ${message.text().slice(0, 300)}`)
  })
  return problems
}

/** The headers a fulfilled cross-origin answer needs (the Data API and the functions are other origins than the site). */
const cors = (request: Request): Record<string, string> => ({
  'access-control-allow-origin': request.headers().origin ?? '*',
  'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
})

type Step = { status?: number; body: unknown; delayMs?: number } | 'abort'
const ok = (data: unknown): Step => ({ body: { ok: true, data } })
const refused = (status: number, code: string, message: string): Step => ({ status, body: { ok: false, error: { code, message }, requestId: randomUUID() } })
const STEP_UP = refused(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
const made = (refundId: string, status: string, amount: number): Step => ok({ refundId, status, amount })

/** Answers each call of the `admin` function with the next step (the last repeats) and gives back the bodies it was sent, in order. */
async function mockAdmin(page: Page, steps: Step[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = []
  await page.route(ADMIN, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(request) })
    bodies.push(request.postDataJSON() as Record<string, unknown>)
    const step = steps[Math.min(bodies.length - 1, steps.length - 1)]!
    if (step === 'abort') return route.abort('failed')
    if (step.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
    return route.fulfill({ status: step.status ?? 200, headers: cors(request), body: JSON.stringify(step.body) })
  })
  return bodies
}

/** Answers a Data API function with `body` instead of the stack. */
async function answer(page: Page, fn: string, body: unknown): Promise<void> {
  await page.route(`**/rest/v1/rpc/${fn}`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route.request()) })
    return route.fulfill({ status: 200, headers: cors(route.request()), body: JSON.stringify(body) })
  })
}

/** Once `down` is set, the next POST of a Data API function fails like a dropped connection (the reading that follows a failed call); the stack answers again after it. */
async function failOnce(page: Page, fn: string): Promise<{ down: boolean }> {
  const outage = { down: false }
  await page.route(`**/rest/v1/rpc/${fn}`, (route) => {
    if (route.request().method() === 'POST' && outage.down) {
      outage.down = false
      return route.abort('failed')
    }
    return route.continue()
  })
  return outage
}

/** The page does not scroll sideways (and at 360 no table needs to: its rows are cards). */
async function expectNoOverflow(page: Page, label: string, width: number): Promise<void> {
  const { pageOverflow, tableOverflow } = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tableOverflow: Math.max(0, ...[...document.querySelectorAll<HTMLElement>('main [class*="tableWrap"]')].map((wrap) => wrap.scrollWidth - wrap.clientWidth)),
  }))
  expect(pageOverflow, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(1)
  if (width <= 480) expect(tableOverflow, `${label}: a table scrolls inside its box on a phone`).toBeLessThanOrEqual(1)
}

/** Every button, text field and link of `scope` (and every checkbox with its words) is at least 44px high: the smallest touch target. */
async function expectTargets(page: Page, label: string, scope: Locator = main(page)): Promise<void> {
  const small = await scope.evaluate((root) => {
    const found = [...root.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]):not([type="checkbox"]), select, a[href], label:has(input[type="checkbox"])')]
    return found
      .map((el) => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 1 && box.height > 1 && box.height < 43.9)
      .map(({ name, box }) => `${name} (${Math.round(box.height)}px)`)
  })
  expect(small, `${label}: targets under 44px`).toEqual([])
}

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/admin-money-${name}-${width}.png`, fullPage: true })
}

/** The step-up dialog answered with a real code from the enrolled authenticator. */
async function enterCode(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رمز التحقق').fill(totpCode(secret))
  await dialog.getByRole('button', { name: 'تحقق', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The refund form of an order: the amounts of the lines and of the shipping by label, and the reason. */
async function fillRefund(refunds: Locator, amounts: Array<[string, string]>, reason = 'استرداد جزئي'): Promise<void> {
  for (const [label, text] of amounts) await refunds.getByLabel(label, { exact: true }).fill(text)
  await refunds.getByLabel('السبب', { exact: true }).fill(reason)
}

const yesterday = (): string => riyadhToday(Date.now() - 86_400_000)
const tomorrow = (): string => riyadhToday(Date.now() + 86_400_000)

// ---- reconciliation fixtures: the exact keys of round 7b and round 9 ----------------------------------------------

const ISO = '2026-10-03T08:00:00.123456+00:00'
const attemptJson = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  orderId: randomUUID(),
  status: 'paid',
  environment: 'test',
  amount: 10600,
  currency: 'SAR',
  providerInvoiceId: randomUUID(),
  providerPaymentId: randomUUID(),
  providerStatus: 'paid',
  providerRefunded: 0,
  captured: 10600,
  fee: 150,
  sourceType: 'creditcard',
  sourceCompany: 'mada',
  invoiceExpiresAt: ISO,
  paidAt: ISO,
  fetchedAt: ISO,
  checkCount: 1,
  errorCount: 0,
  lastError: null,
  createdAt: ISO,
  orderNumber: 'ABCD2345',
  refunded: 0,
  reasons: ['UNCERTAIN'],
  ...over,
})
const reviewJson = (over: Record<string, unknown> = {}) => ({
  paymentId: randomUUID(),
  invoiceId: randomUUID(),
  attemptId: null,
  orderId: null,
  environment: 'test',
  amount: 10600,
  currency: 'SAR',
  providerStatus: 'paid',
  reason: 'UNMAPPED_INVOICE',
  providerRefunded: 0,
  refunded: 1000,
  closedAt: null,
  closedReason: null,
  createdAt: ISO,
  orderNumber: null,
  ...over,
})
const refundJson = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  orderId: randomUUID(),
  attemptId: randomUUID(),
  reviewPaymentId: null,
  returnId: null,
  status: 'uncertain',
  amount: 4000,
  reason: 'استرداد',
  source: 'admin',
  allocation: {},
  providerRefundedBefore: 0,
  providerRefundedAfter: null,
  error: 'REFUND_TIMEOUT',
  nextCheckAt: ISO,
  createdAt: ISO,
  succeededAt: null,
  orderNumber: 'EFGH6789',
  ...over,
})
const eventJson = (over: Record<string, unknown> = {}) => ({
  eventId: `evt-${randomUUID()}`,
  type: 'payment_paid',
  live: false,
  paymentId: randomUUID(),
  receivedAt: ISO,
  processedAt: null,
  outcome: null,
  error: null,
  attempts: 2,
  nextCheckAt: null,
  ...over,
})
const disputeJson = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  kind: 'chargeback',
  providerRef: 'CB-2026-0007',
  seq: 1,
  attemptId: null,
  reviewPaymentId: null,
  environment: 'test',
  amount: 4500,
  direction: 'against_seller',
  occurredOn: '2026-10-02',
  reason: 'اعتراض من حامل البطاقة',
  resolution: null,
  decision: 'none',
  itemIds: [],
  createdAt: ISO,
  orderNumber: null,
  ...over,
})
const emptyReconciliation = { attempts: [], reviews: [], refunds: [], events: [] }

// ---- the specs ----------------------------------------------------------------------------------------------------

for (const width of [360, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    let s: Seed
    test.beforeAll(async () => {
      test.setTimeout(300_000)
      s = await seed()
    })

    // ======================================================================================================== the owner
    test.describe('the owner', () => {
      test.use({ storageState: STATES.owner })

      test('the order view: the payment’s events, and the owner’s money controls where they belong', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, x, y, digital } = s.form
        await page.goto(viewOf(order))
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(order.number)
        await expect(main(page).locator('h2')).toHaveText(['العميل والتوصيل', 'العناصر', 'الدفع', 'الشحن', 'الملفات', 'الإرجاع', 'النزاعات', 'السجل', 'الاستردادات'])
        // The events of the payment, newest first: type and outcome as codes left to right, the times, the attempts, the error.
        const payment = section(page, 'الدفع')
        await expect(payment.getByRole('heading', { level: 3, name: 'إشعارات الدفع', exact: true })).toBeVisible()
        const rows = payment.locator('tbody tr')
        await expect(rows).toHaveCount(2)
        await expect(rows.first().locator('td[data-label="النوع"] span[dir="ltr"]')).toHaveText('payment_refunded')
        await expect(rows.first().locator('td[data-label="النتيجة"] span[dir="ltr"]')).toHaveText('ignored')
        await expect(rows.first().locator('td[data-label="المحاولات"]')).toHaveText('3')
        await expect(rows.first().locator('td[data-label="الخطأ"] span[dir="ltr"]')).toHaveText('NO_DELTA')
        await expect(rows.last().locator('td[data-label="النوع"] span[dir="ltr"]')).toHaveText('payment_paid')
        await expect(rows.last().locator('td[data-label="الخطأ"]')).toHaveText('')
        await expect(rows.first().locator('td[data-label="وقت الاستلام"]')).toHaveText(/\d{4}/)
        await expect(rows.first().locator('td[data-label="وقت المعالجة"]')).toHaveText(/\d{4}/)
        // The paying attempt carries the recheck and the dispute; the refunds section carries the form and the external record.
        const attempt = card(page, order.invoiceId)
        await expect(button(attempt, 'أعد الفحص')).toBeVisible()
        await expect(button(attempt, 'تسجيل اعتراض')).toBeVisible()
        const refunds = section(page, 'الاستردادات')
        // The refund made earlier, and what is left of every line and of the shipping: the line's total less what was refunded of it.
        await expect(refunds.locator('td[data-label="المبلغ"]')).toHaveText([formatMoney(3500)])
        await expect(fieldOf(refunds, x.name)).toContainText(`المتبقي: ${formatMoney(3500)}`)
        await expect(fieldOf(refunds, y.name)).toContainText(`المتبقي: ${formatMoney(4000)}`)
        await expect(fieldOf(refunds, digital.name)).toContainText(`المتبقي: ${formatMoney(3500)}`)
        await expect(fieldOf(refunds, 'الشحن')).toContainText(`المتبقي: ${formatMoney(1500)}`)
        await expect(button(refunds, 'إعادة المبلغ')).toBeVisible()
        await expect(button(refunds, 'تسجيل استرداد خارجي')).toBeVisible()
        // The received return with no refund is offered to link; nothing in flight, so no recheck of a refund.
        await expect(refunds.getByLabel('ربط بطلب الإرجاع')).toBeVisible()
        await expect(refunds.locator('th')).toHaveCount(7)
        await expect(refunds.locator('td[data-label="إجراء"]')).toHaveCount(0)
        await expectNoOverflow(page, 'order view', width)
        await expectTargets(page, 'order view')
        expect(problems).toEqual([])
      })

      test('the refund form: what is left, the refusals under the fields, the confirmation, and one request that carries one key through the step-up', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, x, y, returnId } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [STEP_UP, made(refundId, 'succeeded', 5000)])
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await expect(button(refunds, 'إعادة المبلغ')).toBeVisible()

        // Above what is left, below zero, no amount at all: each refused by the form, with no request.
        await fillRefund(refunds, [[x.name, '36']])
        await expect(fieldOf(refunds, x.name)).toContainText('المبلغ أكبر من المتبقي.')
        await button(refunds, 'إعادة المبلغ').click()
        await expect(alertLine(page)).toHaveText('المبلغ أكبر من المتبقي.')
        await expect(alertLine(page)).toBeFocused()
        await refunds.getByLabel(x.name, { exact: true }).fill('-1')
        await expect(fieldOf(refunds, x.name)).toContainText('أدخل مبلغًا صحيحًا بالريال')
        await refunds.getByLabel(x.name, { exact: true }).fill('')
        await button(refunds, 'إعادة المبلغ').click()
        await expect(alertLine(page)).toHaveText('أدخل مبلغًا لعنصر أو للشحن.')
        await refunds.getByLabel(x.name, { exact: true }).fill('10')
        await refunds.getByLabel('السبب', { exact: true }).fill('   ')
        await button(refunds, 'إعادة المبلغ').click()
        await expect(alertLine(page)).toHaveText('اكتب سبب الاسترداد في 300 حرف أو أقل.')
        await expect(button(refunds, 'تأكيد الاسترداد')).toHaveCount(0)
        expect(bodies).toHaveLength(0)

        // A line and the shipping, a reason with spaces round it, the received return: the total is the sum, shown as it is typed.
        await fillRefund(refunds, [[x.name, '35'], [y.name, ''], ['الشحن', '15']], '  استرداد العنصر والشحن  ')
        await refunds.getByLabel('ربط بطلب الإرجاع').selectOption(returnId)
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(5000)}`)).toBeVisible()
        // The sentence of the last refusal is still on the alert line until the form is sent on.
        await expect(alertLine(page)).toHaveText('اكتب سبب الاسترداد في 300 حرف أو أقل.')
        await expectNoOverflow(page, 'refund form', width)
        await expectTargets(page, 'refund form', refunds)
        await shoot(page, 'refund-form', width)

        // The confirmation repeats the total, the lines and the shipping and says it cannot be undone; nothing is sent before «تأكيد الاسترداد».
        // Enter in a field opens it (the keyboard's way).
        await refunds.getByLabel('السبب', { exact: true }).press('Enter')
        await expect(alertLine(page)).toHaveText('')
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(5000)}`)).toBeVisible()
        await expect(refunds.getByText(`${x.name}: ${formatMoney(3500)}`)).toBeVisible()
        await expect(refunds.getByText(`الشحن: ${formatMoney(1500)}`)).toBeVisible()
        await expect(refunds.getByText(REFUND_WARNING)).toBeVisible()
        await expect(refunds.getByText('سيُعاد المبلغ إلى وسيلة دفع العميل عبر Moyasar، ولا يمكن التراجع عنه.')).toBeVisible()
        // The focus is on the confirmation itself, never on the irreversible button: a second Enter (or a held one) confirms nothing.
        const group = refunds.getByRole('group', { name: /الإجمالي/ })
        await expect(group).toBeFocused()
        await expect(button(refunds, 'تأكيد الاسترداد')).not.toBeFocused()
        await page.keyboard.press('Enter')
        await expect(group).toBeVisible()
        await expect(button(refunds, 'رجوع')).toBeVisible()
        await expect(refunds.getByLabel(x.name, { exact: true })).toHaveCount(0)
        expect(bodies).toHaveLength(0)
        await expectNoOverflow(page, 'refund confirmation', width)
        await expectTargets(page, 'refund confirmation', refunds)
        await shoot(page, 'refund-confirm', width)

        // «رجوع» goes back to the form with what was typed, and the focus to the button that opened the confirmation (the pressed one is gone); the confirmation again, and then the code.
        await button(refunds, 'رجوع').click()
        await expect(refunds.getByLabel(x.name, { exact: true })).toHaveValue('35')
        await expect(button(refunds, 'إعادة المبلغ')).toBeFocused()
        await button(refunds, 'إعادة المبلغ').click()
        const before = rpc.count('order_detail')
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect.poll(() => bodies.length).toBe(1)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(5000)}.`)
        await expect(statusLine(page)).toBeFocused()
        await expect(alertLine(page)).toHaveText('')

        // The request: field by field, the key of the first call is the key of the second, and it is a UUID.
        const key = bodies[0]!.idempotencyKey
        expect(key).toEqual(expect.stringMatching(UUID))
        expect(bodies).toEqual([
          {
            action: 'refund-create',
            orderId: order.id,
            attemptId: order.attemptId,
            amount: 5000,
            reason: 'استرداد العنصر والشحن',
            allocation: { items: [{ itemId: order.items[0]!.id, amount: 3500 }], shipping: 1500 },
            returnId,
            idempotencyKey: key,
          },
          {
            action: 'refund-create',
            orderId: order.id,
            attemptId: order.attemptId,
            amount: 5000,
            reason: 'استرداد العنصر والشحن',
            allocation: { items: [{ itemId: order.items[0]!.id, amount: 3500 }], shipping: 1500 },
            returnId,
            idempotencyKey: key,
          },
        ])
        // Nothing is shown as refunded before the data says so: the order was read again, and the form was emptied.
        expect(rpc.count('order_detail')).toBe(before + 1)
        await expect(button(refunds, 'إعادة المبلغ')).toBeVisible()
        await expect(refunds.getByLabel(x.name, { exact: true })).toHaveValue('')
        await expect(refunds.getByLabel('السبب', { exact: true })).toHaveValue('')
        expect(problems).toEqual([])
      })

      test('every answer of a refund: made, sent and not yet confirmed, refused by the gateway, refused by the function, a refund the ledger lacks, a reply that cannot be read', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, y } = s.form
        const refundId = randomUUID()
        const steps: Step[] = [
          made(refundId, 'succeeded', 4000),
          made(refundId, 'uncertain', 4000),
          made(refundId, 'submitting', 4000),
          made(refundId, 'failed', 4000),
          refused(409, 'EXCEEDS_BALANCE', 'المبلغ أكبر من المتبقي للاسترداد.'),
          refused(409, 'PROVIDER_AHEAD', 'سُجّل لدى بوابة الدفع استرداد لا يظهر في السجل. سجّله أولًا ثم أعد المحاولة.'),
          ok({ status: 'paid' }),
          made(refundId, 'succeeded', 4000),
          // A 200 that says «ok: false» and carries no refusal.
          { body: { ok: false } },
        ]
        const bodies = await mockAdmin(page, steps)
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await expect(button(refunds, 'إعادة المبلغ')).toBeVisible()

        /** One refund of the second line, from the form to the answer. */
        const refund = async (): Promise<void> => {
          await fillRefund(refunds, [[y.name, '40']])
          await button(refunds, 'إعادة المبلغ').click()
          await button(refunds, 'تأكيد الاسترداد').click()
        }
        const sent = (n: number) => expect.poll(() => bodies.length, { message: `request ${n}` }).toBe(n)

        // Made: the amount, on the status line, and the form is spent.
        await refund()
        await sent(1)
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        await expect(statusLine(page)).toBeFocused()
        await expect(refunds.getByLabel(y.name, { exact: true })).toHaveValue('')
        // Sent and not yet confirmed: the same sentence for `uncertain` and for `submitting`.
        for (const n of [2, 3]) {
          await refund()
          await sent(n)
          await expect(statusLine(page)).toHaveText(REFUND_UNCERTAIN)
          await expect(statusLine(page)).toBeFocused()
          await expect(alertLine(page)).toHaveText('')
          await expect(refunds.getByLabel(y.name, { exact: true })).toHaveValue('')
        }
        // Refused by the gateway: nothing was taken, on the alert line, and the form keeps what was typed.
        await refund()
        await sent(4)
        await expect(alertLine(page)).toHaveText(REFUND_FAILED)
        await expect(alertLine(page)).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        await expect(refunds.getByLabel(y.name, { exact: true })).toHaveValue('40')
        await expect(button(refunds, 'تأكيد الاسترداد')).toHaveCount(0)
        // Refused by the function: its own words, nothing else.
        await refund()
        await sent(5)
        await expect(alertLine(page)).toHaveText('المبلغ أكبر من المتبقي للاسترداد.')
        await expect(refunds.getByLabel(y.name, { exact: true })).toHaveValue('40')
        // A refund the provider holds and the ledger does not: its message and, beside it, the way to record it.
        await refund()
        await sent(6)
        await expect(alertLine(page)).toContainText('سُجّل لدى بوابة الدفع استرداد لا يظهر في السجل.')
        const record = alertLine(page).getByRole('button', { name: 'تسجيل استرداد خارجي' })
        await expect(record).toBeVisible()
        await record.click()
        await expect(refunds.getByText(EXTERNAL_SENTENCE)).toBeVisible()
        await expect(refunds.getByRole('textbox', { name: 'السبب', exact: true }).last()).toBeFocused()
        await button(refunds, 'رجوع').click()
        // The record's form went with the button that was pressed: the focus is on the button that opens it.
        await expect(button(refunds, 'تسجيل استرداد خارجي')).toBeFocused()
        await expect(refunds.getByText(EXTERNAL_SENTENCE)).toHaveCount(0)
        // A reply that is not {refundId, status, amount}: never read as made or as failed; the order is read again, and the request stays.
        const reads = rpc.count('order_detail')
        await refund()
        await sent(7)
        await expect(alertLine(page)).toHaveText(BAD_REPLY)
        await expect.poll(() => rpc.count('order_detail')).toBe(reads + 1)
        await expect(statusLine(page)).toHaveText('')
        await expect(button(refunds, 'تأكيد الاسترداد')).toBeVisible()
        // ...so pressing it again is the same request, and this time it is answered.
        await button(refunds, 'تأكيد الاسترداد').click()
        await sent(8)
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        // A 200 that says «no» and names no refusal is as unreadable as any other reply: never the generic «تعذّر الحفظ», and the request stays.
        await refund()
        await sent(9)
        await expect(alertLine(page)).toHaveText(BAD_REPLY)
        await expect(button(refunds, 'تأكيد الاسترداد')).toBeVisible()

        // Every request is the same refund of the same line; a key lives from its confirmation to its final answer.
        for (const body of bodies) {
          expect(body).toMatchObject({ action: 'refund-create', orderId: order.id, attemptId: order.attemptId, amount: 4000, allocation: { items: [{ itemId: order.items[1]!.id, amount: 4000 }] } })
        }
        const keys = bodies.map((body) => body.idempotencyKey as string)
        expect(keys.every((key) => UUID.test(key))).toBe(true)
        expect(new Set(keys.slice(0, 7)).size).toBe(7)
        expect(keys[7]).toBe(keys[6])
        expect(problems).toEqual([])
      })

      test('a network failure keeps the confirmation and the key, a change renews the key, and a double press sends one request', async ({ page }) => {
        const { order, y } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, ['abort', 'abort', 'abort', made(refundId, 'succeeded', 4000), { body: { ok: true, data: { refundId, status: 'succeeded', amount: 5000 } }, delayMs: 800 }])
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await fillRefund(refunds, [[y.name, '40']])
        await button(refunds, 'إعادة المبلغ').click()
        await button(refunds, 'تأكيد الاسترداد').click()
        // The call never arrived: said in the function client's words, the confirmation stays so that a repeat is possible.
        await expect(alertLine(page)).toHaveText('تعذّر الاتصال بالخادم.')
        await expect(button(refunds, 'تأكيد الاسترداد')).toBeVisible()
        // The order was read again meanwhile; the confirmation still shows the very request that may have been sent.
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(4000)}`)).toBeVisible()
        await expect(statusLine(page)).toHaveText('')
        // The very same request again: the same key (so, if the first had landed, the stored refund is answered and the provider is not asked twice).
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect.poll(() => bodies.length).toBe(2)
        await expect(alertLine(page)).toHaveText('تعذّر الاتصال بالخادم.')
        expect(bodies[1]).toEqual(bodies[0])
        // The owner changes the form: another request, another key, kept through its own retry.
        await button(refunds, 'رجوع').click()
        await refunds.getByLabel(y.name, { exact: true }).fill('39.50')
        await button(refunds, 'إعادة المبلغ').click()
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect.poll(() => bodies.length).toBe(3)
        await expect(alertLine(page)).toHaveText('تعذّر الاتصال بالخادم.')
        expect(bodies[2]).toMatchObject({ amount: 3950, allocation: { items: [{ itemId: order.items[1]!.id, amount: 3950 }] } })
        expect(bodies[2]!.idempotencyKey).not.toBe(bodies[0]!.idempotencyKey)
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        expect(bodies[3]).toEqual(bodies[2])

        // A double press: the button is off while the call is in flight, and one request goes.
        await fillRefund(refunds, [[y.name, '40']])
        await button(refunds, 'إعادة المبلغ').click()
        const confirm = button(refunds, 'تأكيد الاسترداد')
        await confirm.dblclick()
        await expect(confirm).toBeDisabled()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(5000)}.`)
        expect(bodies).toHaveLength(5)
      })

      test('an outage that takes the re-read down with the call leaves the order drawn with its confirmation and key, and the repeat is the same request', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, y } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, ['abort', made(refundId, 'succeeded', 4000)])
        const outage = await failOnce(page, 'order_detail')
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await fillRefund(refunds, [[y.name, '40']])
        await button(refunds, 'إعادة المبلغ').click()
        outage.down = true
        await button(refunds, 'تأكيد الاسترداد').click()
        // Said: what the call said, then that the page could not be refreshed. The order stays drawn, with the very request that may have been sent.
        await expect(alertLine(page)).toHaveText(`تعذّر الاتصال بالخادم. ${REREAD_FAILED}`)
        await expect(alertLine(page)).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(order.number)
        await expect(main(page).getByRole('button', { name: 'تحديث', exact: true })).toHaveCount(0)
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(4000)}`)).toBeVisible()
        await expect(button(refunds, 'تأكيد الاسترداد')).toBeEnabled()
        // The network is back: the very same request, with the same key (so a refund that did land is answered, not made twice), and the data read again.
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        await expect(alertLine(page)).toHaveText('')
        expect(bodies).toHaveLength(2)
        expect(bodies[1]).toEqual(bodies[0])
        expect(bodies[0]!.idempotencyKey).toEqual(expect.stringMatching(UUID))
        await expect(refunds.getByLabel(y.name, { exact: true })).toHaveValue('')
        expect(problems).toEqual([])
      })

      test('a reading that fails after any other action leaves the order drawn too, so a refund waiting for its repeat keeps its key', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, x, y } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, ['abort', made(refundId, 'succeeded', 4000)])
        // The fulfilment is a mock (nothing moves); its reading is the one that fails.
        await answer(page, 'fulfillment_update', { ok: true, changed: 1 })
        const outage = await failOnce(page, 'order_detail')
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await fillRefund(refunds, [[y.name, '40']])
        await button(refunds, 'إعادة المبلغ').click()
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect(alertLine(page)).toHaveText('تعذّر الاتصال بالخادم.')
        const shipping = section(page, 'الشحن')
        await shipping.getByRole('checkbox', { name: x.name, exact: true }).check()
        outage.down = true
        await button(shipping, 'تم التسليم').click()
        await expect(alertLine(page)).toHaveText(`تم التحديث. ${REREAD_FAILED}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(order.number)
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(4000)}`)).toBeVisible()
        await button(refunds, 'تأكيد الاسترداد').click()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        expect(bodies).toHaveLength(2)
        expect(bodies[1]).toEqual(bodies[0])
        expect(problems).toEqual([])
      })

      test('closing the code dialog says nothing and gives the focus back to the control that asked for it, the refund and the external record, and a repeat is the same request', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, y } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [STEP_UP, STEP_UP, made(refundId, 'succeeded', 4000), STEP_UP])
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        await fillRefund(refunds, [[y.name, '40']])
        await button(refunds, 'إعادة المبلغ').click()
        const confirm = button(refunds, 'تأكيد الاسترداد')
        await confirm.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
        await expect(dialog).toBeHidden()
        // The button was off while the call was in flight, so the browser could not give the focus back: the screen does.
        await expect(confirm).toBeEnabled()
        await expect(confirm).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        await expect(alertLine(page)).toHaveText('')
        expect(bodies).toHaveLength(1)
        // Pressed again: the same body with the same key, and this time the code is entered.
        await confirm.click()
        await expect.poll(() => bodies.length).toBe(2)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        expect(bodies).toHaveLength(3)
        expect(bodies[1]).toEqual(bodies[0])
        expect(bodies[2]).toEqual(bodies[0])
        expect(bodies[0]!.idempotencyKey).toEqual(expect.stringMatching(UUID))

        // The external record: the same way, the focus on the button that asked for the code.
        await button(refunds, 'تسجيل استرداد خارجي').click()
        await refunds.getByRole('textbox', { name: 'السبب', exact: true }).last().fill('استرداد من لوحة Moyasar')
        const record = button(refunds, 'تأكيد التسجيل')
        await record.click()
        await expect.poll(() => bodies.length).toBe(4)
        await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click()
        await expect(dialog).toBeHidden()
        await expect(record).toBeEnabled()
        await expect(record).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        await expect(alertLine(page)).toHaveText('')
        // Escape closes the dialog the same way.
        await record.click()
        await expect.poll(() => bodies.length).toBe(5)
        await expect(dialog).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(record).toBeFocused()
        expect(problems).toEqual([])
      })

      test('a review payment: refunded for what is left of it, with an empty allocation, the order named when it has one', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, paymentId } = s.reviewed
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [STEP_UP, made(refundId, 'succeeded', 2500)])
        await page.goto(viewOf(order))
        const review = card(page, paymentId)
        await expect(review).toContainText(`المبلغ: ${formatMoney(order.total)}`)
        await expect(review.getByLabel('المبلغ', { exact: true })).toBeVisible()
        await expect(fieldOf(review, 'المبلغ')).toContainText(`المتبقي: ${formatMoney(order.total)}`)
        // More than what is left of the payment: refused under the field.
        await review.getByLabel('المبلغ', { exact: true }).fill(`${order.total / 100 + 1}`)
        await expect(fieldOf(review, 'المبلغ')).toContainText('المبلغ أكبر من المتبقي.')
        await button(review, 'استرداد هذه الدفعة').click()
        await expect(alertLine(page)).toHaveText('المبلغ أكبر من المتبقي.')
        await review.getByLabel('المبلغ', { exact: true }).fill('25')
        await review.getByLabel('السبب', { exact: true }).first().fill('دفعة مكررة')
        await expect(review.getByText(`الإجمالي: ${formatMoney(2500)}`)).toBeVisible()
        await button(review, 'استرداد هذه الدفعة').click()
        await expect(review.getByText(`الإجمالي: ${formatMoney(2500)}`)).toBeVisible()
        await expect(review.getByText(REFUND_WARNING)).toBeVisible()
        expect(bodies).toHaveLength(0)
        await button(review, 'تأكيد الاسترداد').click()
        await expect.poll(() => bodies.length).toBe(1)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(2500)}.`)
        const key = bodies[0]!.idempotencyKey
        expect(key).toEqual(expect.stringMatching(UUID))
        const expected = { action: 'refund-create', orderId: order.id, reviewPaymentId: paymentId, amount: 2500, reason: 'دفعة مكررة', allocation: {}, idempotencyKey: key }
        expect(bodies).toEqual([expected, expected])
        // Not the paying attempt's way: no line, no shipping, no return, no attempt.
        expect(Object.keys(bodies[0]!).sort()).toEqual(['action', 'allocation', 'amount', 'idempotencyKey', 'orderId', 'reason', 'reviewPaymentId'])
        expect(problems).toEqual([])
      })

      test('the rechecks: an attempt and a refund in flight, no code asked, and the order read again', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order } = s.inflight
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [ok({ status: 'paid' }), made(refundId, 'succeeded', 4000), made(refundId, 'uncertain', 4000), made(refundId, 'failed', 4000), refused(404, 'NOT_FOUND', 'لم نجد عملية الاسترداد هذه.')])
        await page.goto(viewOf(order))
        const attempt = card(page, order.invoiceId)
        // The order is on screen: the reading that follows the recheck is counted from here (the first one may be asked twice in development).
        await expect(button(attempt, 'أعد الفحص')).toBeVisible()
        const reads = rpc.count('order_detail')
        await button(attempt, 'أعد الفحص').click()
        await expect(statusLine(page)).toHaveText('الحالة الآن: مدفوع.')
        await expect(statusLine(page)).toBeFocused()
        await expect(page.getByRole('dialog')).toBeHidden()
        expect(bodies).toEqual([{ action: 'payment-recheck', attemptId: order.attemptId }])
        await expect.poll(() => rpc.count('order_detail')).toBe(reads + 1)

        // The refund in flight is listed with its own «أعد الفحص»; its answer is worded like a refund's.
        const refunds = section(page, 'الاستردادات')
        await expect(refunds.locator('td[data-label="الحالة"]')).toHaveText(['قيد الإرسال'])
        await expect(refunds.locator('th')).toHaveCount(8)
        const recheck = refunds.locator('td[data-label="إجراء"]').getByRole('button', { name: 'أعد الفحص', exact: true })
        await expect(recheck).toHaveCount(1)
        await recheck.click()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        await recheck.click()
        await expect(statusLine(page)).toHaveText(REFUND_UNCERTAIN)
        await recheck.click()
        await expect(alertLine(page)).toHaveText(REFUND_FAILED)
        await recheck.click()
        await expect(alertLine(page)).toHaveText('لم نجد عملية الاسترداد هذه.')
        expect(bodies.slice(1)).toEqual(Array.from({ length: 4 }, () => ({ action: 'refund-recheck', refundId: s.inflight.refundId })))
        await expect(page.getByRole('dialog')).toBeHidden()
        expect(problems).toEqual([])
      })

      test('a refund made at Moyasar’s own dashboard is recorded through the step-up, for the paying attempt and for a review payment', async ({ page }) => {
        const problems = watchProblems(page)
        const { order } = s.form
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [STEP_UP, made(refundId, 'succeeded', 2500), refused(409, 'NO_DELTA', 'لا يوجد فرق بين ما لدى بوابة الدفع وما في السجل.'), made(refundId, 'succeeded', 2500)])
        await page.goto(viewOf(order))
        const refunds = section(page, 'الاستردادات')
        const open = button(refunds, 'تسجيل استرداد خارجي')
        await expect(open).toHaveAttribute('aria-expanded', 'false')
        await open.click()
        await expect(open).toHaveAttribute('aria-expanded', 'true')
        await expect(refunds.getByText(EXTERNAL_SENTENCE)).toBeVisible()
        await expect(refunds.getByText('سجّل هنا استردادًا أو إلغاءً تمّ من لوحة Moyasar؛ يُقرأ المبلغ من Moyasar نفسها.')).toBeVisible()
        // The form of the refund comes first and the record's after it: the record's reason is the last field of that name.
        const reason = refunds.getByRole('textbox', { name: 'السبب', exact: true }).last()
        await expect(reason).toBeFocused()
        // No reason: refused by the form, nothing sent.
        await button(refunds, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اكتب سبب التسجيل في 300 حرف أو أقل.')
        expect(bodies).toHaveLength(0)
        await reason.fill('  استرداد من لوحة Moyasar  ')
        await button(refunds, 'تأكيد التسجيل').click()
        await expect.poll(() => bodies.length).toBe(1)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(`سُجّل استرداد خارجي بمبلغ ${formatMoney(2500)}.`)
        await expect(statusLine(page)).toBeFocused()
        await expect(refunds.getByText(EXTERNAL_SENTENCE)).toHaveCount(0)
        expect(bodies).toEqual([
          { action: 'refund-record-external', attemptId: order.attemptId, reason: 'استرداد من لوحة Moyasar' },
          { action: 'refund-record-external', attemptId: order.attemptId, reason: 'استرداد من لوحة Moyasar' },
        ])
        // Nothing to record: the function's own message.
        await open.click()
        await refunds.getByRole('textbox', { name: 'السبب', exact: true }).last().fill('مرة أخرى')
        await button(refunds, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('لا يوجد فرق بين ما لدى بوابة الدفع وما في السجل.')
        await expect(refunds.getByText(EXTERNAL_SENTENCE)).toBeVisible()

        // A review payment is recorded by its own id and names no order.
        const reviewed = s.reviewed
        await page.goto(viewOf(reviewed.order))
        const review = card(page, reviewed.paymentId)
        await button(review, 'تسجيل استرداد خارجي').click()
        await review.getByRole('textbox', { name: 'السبب', exact: true }).last().fill('إلغاء من اللوحة')
        await button(review, 'تأكيد التسجيل').click()
        await expect(statusLine(page)).toHaveText(`سُجّل استرداد خارجي بمبلغ ${formatMoney(2500)}.`)
        expect(bodies.at(-1)).toEqual({ action: 'refund-record-external', reviewPaymentId: reviewed.paymentId, reason: 'إلغاء من اللوحة' })
        expect(problems).toEqual([])
      })

      test('a dispute from the order: the paying attempt’s form, the item decision needing lines, the day not after today, recorded then repeated', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, digital } = s.form
        const row = { id: randomUUID(), kind: 'chargeback', providerRef: 'CB-2026-0007', seq: 1, attemptId: order.attemptId, reviewPaymentId: null, environment: 'test', amount: 4500, direction: 'against_seller', occurredOn: yesterday(), reason: 'اعتراض', resolution: null, decision: 'none', itemIds: [], createdAt: ISO }
        const bodies = await mockAdmin(page, [STEP_UP, STEP_UP, { status: 201, body: { ok: true, data: { duplicate: false, dispute: row } } }, ok({ duplicate: true, dispute: row }), refused(409, 'NOT_DISPUTABLE', 'لا يمكن تسجيل نزاع على محاولة دفع غير مدفوعة.')])
        await page.goto(viewOf(order))
        const attempt = card(page, order.invoiceId)
        const open = button(attempt, 'تسجيل اعتراض')
        await open.click()
        const form = attempt.getByRole('form', { name: 'تسجيل اعتراض' })
        await expect(form).toBeVisible()
        // «رجوع» goes with the form, and the focus to the button that opened it.
        await button(form, 'رجوع').click()
        await expect(form).toHaveCount(0)
        await expect(open).toBeFocused()
        await open.click()
        await expect(form).toBeVisible()
        // The kinds of a payment, the day capped at today, and no refund to create anywhere.
        await expect(form.getByLabel('النوع', { exact: true }).locator('option')).toHaveText(['اعتراض بطاقة', 'أخرى'])
        await expect(form.getByLabel('التاريخ', { exact: true })).toHaveAttribute('max', riyadhToday())
        await expect(form.getByText(/استرداد/)).toHaveCount(0)
        await expect(form.getByRole('button')).toHaveText(['تأكيد التسجيل', 'رجوع'])
        await expectNoOverflow(page, 'dispute form', width)
        await expectTargets(page, 'dispute form', form)

        // Each refusal of the form, in turn, with no request.
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('أدخل مرجع النزاع كما في رسالة Moyasar، حتى 120 حرفًا.')
        await form.getByLabel('المرجع', { exact: true }).fill('  CB-2026-0007  ')
        await expect(form.getByLabel('المرجع', { exact: true })).toHaveAttribute('dir', 'ltr')
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('أدخل مبلغًا أكبر من صفر بالريال، مثل 69 أو 69.50.')
        await form.getByLabel('المبلغ', { exact: true }).fill('0')
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('أدخل مبلغًا أكبر من صفر بالريال، مثل 69 أو 69.50.')
        await form.getByLabel('المبلغ', { exact: true }).fill('45')
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اختر يومًا لا يتجاوز اليوم.')
        await form.getByLabel('التاريخ', { exact: true }).fill(tomorrow())
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اختر يومًا لا يتجاوز اليوم.')
        await form.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اكتب سبب النزاع في 500 حرف أو أقل.')
        await form.getByLabel('السبب', { exact: true }).fill('اعتراض من حامل البطاقة')
        expect(bodies).toHaveLength(0)

        // The item decisions name lines: only the ones that decision can act on, and at least one.
        const decision = form.getByLabel('القرار', { exact: true })
        await expect(decision.locator('option')).toHaveText(['بلا إجراء', 'سحب الملفات', 'إبقاء الملفات', 'إيقاف الشحن'])
        await decision.selectOption('entitlement_revoked')
        await expect(form.getByRole('checkbox')).toHaveCount(1)
        await expect(form.getByRole('checkbox', { name: digital.name, exact: true })).toBeVisible()
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اختر بندًا واحدًا على الأقل.')
        await decision.selectOption('fulfillment_stopped')
        await expect(form.getByRole('checkbox')).toHaveCount(0)
        await expect(form.getByText('لا توجد بنود في هذا الطلب يناسبها هذا القرار.')).toBeVisible()
        await decision.selectOption('entitlement_revoked')
        await form.getByRole('checkbox', { name: digital.name, exact: true }).check()
        await shoot(page, 'dispute-form', width)
        await button(form, 'تأكيد التسجيل').click()
        await expect.poll(() => bodies.length).toBe(1)
        // Closing the code dialog says nothing, gives the focus back to the button that asked for it, and the form keeps what was typed.
        await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click()
        await expect(button(form, 'تأكيد التسجيل')).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        await expect(alertLine(page)).toHaveText('')
        await expect(form.getByLabel('المرجع', { exact: true })).toHaveValue(/CB-2026-0007/)
        await button(form, 'تأكيد التسجيل').click()
        await expect.poll(() => bodies.length).toBe(2)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText('سُجّل.')
        await expect(statusLine(page)).toBeFocused()
        await expect(attempt.getByRole('form')).toHaveCount(0)
        const body = {
          action: 'dispute-record',
          kind: 'chargeback',
          providerRef: 'CB-2026-0007',
          follows: 0,
          attemptId: order.attemptId,
          amount: 4500,
          direction: 'against_seller',
          occurredOn: yesterday(),
          reason: 'اعتراض من حامل البطاقة',
          decision: 'entitlement_revoked',
          itemIds: [order.items[2]!.id],
        }
        expect(bodies).toEqual([body, body, body])
        // The order was read again after the answer.
        expect(rpc.count('order_detail')).toBeGreaterThanOrEqual(2)

        // Recorded before: «هذا السجل مسجّل من قبل؛ لم يتغير شيء.»; and a refusal of the function in its own words.
        await open.click()
        await form.getByLabel('المرجع', { exact: true }).fill('CB-2026-0007')
        await form.getByLabel('المبلغ', { exact: true }).fill('45')
        await form.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await form.getByLabel('السبب', { exact: true }).fill('اعتراض من حامل البطاقة')
        await button(form, 'تأكيد التسجيل').click()
        await expect(statusLine(page)).toHaveText('هذا السجل مسجّل من قبل؛ لم يتغير شيء.')
        await open.click()
        await form.getByLabel('المرجع', { exact: true }).fill('CB-2026-0008')
        await form.getByLabel('المبلغ', { exact: true }).fill('45')
        await form.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await form.getByLabel('السبب', { exact: true }).fill('اعتراض آخر')
        await form.getByLabel('النوع', { exact: true }).selectOption('other')
        await button(form, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('لا يمكن تسجيل نزاع على محاولة دفع غير مدفوعة.')
        expect(bodies.at(-1)).toMatchObject({ kind: 'other', providerRef: 'CB-2026-0008', follows: 0, attemptId: order.attemptId, decision: 'none' })
        expect(problems).toEqual([])
      })

      test('the reconciliation screen: every section from the lists, its caps and empty lists, the rechecks, the review payment’s own controls and a dismissed event', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order } = s.form
        const uncertain = attemptJson({ status: 'uncertain', reasons: ['UNCERTAIN', 'UNVERIFIED'], orderId: order.id, orderNumber: order.number, providerPaymentId: null })
        const external = attemptJson({ providerRefunded: 2500, reasons: ['EXTERNAL_REFUND', 'PROVIDER_STATUS'], orderNumber: 'EFGH6789' })
        // A void in Moyasar's dashboard: the provider's status differs and its refunded total need not rise.
        const voided = attemptJson({ providerStatus: 'voided', reasons: ['PROVIDER_STATUS'], orderNumber: 'JKLM2345' })
        const withOrder = reviewJson({ reason: 'SECOND_PAYMENT', orderId: order.id, orderNumber: order.number, attemptId: order.attemptId, refunded: 0 })
        const noOrder = reviewJson({ reason: 'UNMAPPED_INVOICE' })
        const inflight = refundJson({ orderId: order.id, orderNumber: order.number })
        const exhausted = eventJson({ eventId: 'evt-exhausted-1', outcome: 'exhausted', error: 'FETCH_FAILED', attempts: 10, processedAt: ISO })
        const waiting = eventJson({ eventId: 'evt-waiting-1', type: 'payment_refunded', outcome: null })
        await answer(page, 'reconciliation_list', {
          attempts: [uncertain, external, voided],
          reviews: [withOrder, noOrder],
          refunds: [inflight],
          events: [exhausted, waiting, ...Array.from({ length: 98 }, () => eventJson())],
        })
        await answer(page, 'disputes_list', { references: [] })
        const bodies = await mockAdmin(page, [ok({ status: 'paid' }), made(inflight.id, 'succeeded', 4000)])
        await page.goto('/admin/orders/reconciliation')
        await expect(page.getByRole('heading', { level: 1, name: 'المطابقة', exact: true })).toBeVisible()
        await expect(main(page).locator('h2')).toHaveText(['محاولات تحتاج فحصًا', 'دفعات قيد المراجعة', 'استردادات قيد المعالجة', 'إشعارات الدفع', 'النزاعات'])

        // The attempts: the order's number as a link to its view, the status, the amount, both provider ids, every reason in words.
        const attempts = section(page, 'محاولات تحتاج فحصًا')
        const first = card(page, uncertain.providerInvoiceId)
        await expect(first.getByRole('link', { name: order.number, exact: true })).toHaveAttribute('href', viewOf(order))
        await expect(first).toContainText('الحالة: غير مؤكد')
        await expect(first).toContainText(`المبلغ: ${formatMoney(10600)}`)
        await expect(first.locator('span[dir="ltr"]', { hasText: uncertain.providerInvoiceId })).toBeVisible()
        await expect(first).toContainText('الأسباب: إنشاء غير مؤكد، لم يُتحقق منها')
        const second = card(page, external.providerPaymentId)
        await expect(second.locator('span[dir="ltr"]', { hasText: external.providerPaymentId })).toBeVisible()
        await expect(second).toContainText('الأسباب: استرداد لدى Moyasar غير مسجّل، حالة مختلفة لدى Moyasar')
        // «تسجيل استرداد خارجي» where Moyasar holds a refund the ledger lacks, or a status that differs (a void): never on an uncertain creation.
        await expect(attempts.getByRole('button', { name: 'تسجيل استرداد خارجي' })).toHaveCount(2)
        await expect(button(second, 'تسجيل استرداد خارجي')).toBeVisible()
        await expect(button(card(page, voided.providerPaymentId), 'تسجيل استرداد خارجي')).toBeVisible()
        await expect(button(first, 'تسجيل استرداد خارجي')).toHaveCount(0)
        await expect(attempts.getByRole('button', { name: 'أعد الفحص', exact: true })).toHaveCount(3)
        // The review payments: the reason, the amount, what was refunded, the order or «بلا طلب», the payment's id, all three controls.
        const reviews = section(page, 'دفعات قيد المراجعة')
        await expect(reviews).toContainText('السبب: دفعة ثانية على فاتورة مدفوعة')
        await expect(reviews).toContainText('السبب: فاتورة غير مرتبطة بطلب')
        await expect(reviews).toContainText('الطلب: بلا طلب')
        await expect(card(page, withOrder.paymentId).getByRole('link', { name: order.number, exact: true })).toHaveAttribute('href', viewOf(order))
        await expect(card(page, noOrder.paymentId)).toContainText(`المُعاد: ${formatMoney(1000)}`)
        // A test-mode review payment is labelled like a test order; one with no order warns that closing it removes it from the admin.
        await expect(card(page, noOrder.paymentId).getByText('تجريبي', { exact: true })).toBeVisible()
        await expect(card(page, noOrder.paymentId)).toContainText('دفعة بلا طلب تختفي من اللوحة بعد إغلاقها ولا تُعاد منها؛ أعدها قبل الإغلاق إن لزم.')
        await expect(card(page, withOrder.paymentId).getByText('دفعة بلا طلب تختفي', { exact: false })).toHaveCount(0)
        for (const name of ['إغلاق المراجعة', 'استرداد هذه الدفعة', 'تسجيل اعتراض', 'تسجيل استرداد خارجي']) await expect(reviews.getByRole('button', { name, exact: true })).toHaveCount(2)
        // The refunds in flight: the order, the status, the time, the error code.
        const refunds = section(page, 'استردادات قيد المعالجة')
        await expect(refunds).toContainText('الحالة: غير مؤكد')
        await expect(refunds.locator('span[dir="ltr"]', { hasText: 'REFUND_TIMEOUT' })).toBeVisible()
        await expect(refunds).toContainText(`المبلغ: ${formatMoney(4000)}`)
        // The events: a list that reaches 100 says it shows the newest 100; the lists with less say nothing of the kind; the empty ones say so.
        const eventsSection = section(page, 'إشعارات الدفع')
        await expect(eventsSection.getByText('تُعرض أحدث 100.')).toBeVisible()
        await expect(main(page).getByText('تُعرض أحدث 100.')).toHaveCount(1)
        await expect(attempts.getByText('لا شيء هنا.')).toHaveCount(0)
        await expect(section(page, 'النزاعات').getByText('لا شيء هنا.')).toBeVisible()
        await expect(main(page).getByText('لا شيء هنا.')).toHaveCount(1)
        // Only an exhausted event can be filed, with the sentence that says where it was reviewed.
        await expect(eventsSection.getByRole('button', { name: 'تمت المراجعة', exact: true })).toHaveCount(1)
        await expect(eventsSection.locator('[class*="listItem"]').filter({ hasText: 'FETCH_FAILED' }).getByRole('button', { name: 'تمت المراجعة', exact: true })).toBeVisible()
        await expect(eventsSection.getByText('بعد مراجعتها في لوحة Moyasar.')).toHaveCount(1)
        await expectNoOverflow(page, 'reconciliation', width)
        await expectTargets(page, 'reconciliation')
        await shoot(page, 'reconciliation', width)

        // «أعد الفحص» of an attempt: no code, its status in words, both lists read again.
        const reads = rpc.count('reconciliation_list')
        await button(first, 'أعد الفحص').click()
        await expect(statusLine(page)).toHaveText('الحالة الآن: مدفوع.')
        await expect(statusLine(page)).toBeFocused()
        await expect(page.getByRole('dialog')).toBeHidden()
        expect(bodies).toEqual([{ action: 'payment-recheck', attemptId: uncertain.id }])
        await expect.poll(() => rpc.count('reconciliation_list')).toBe(reads + 1)
        await expect.poll(() => rpc.count('disputes_list')).toBe(reads + 1)
        // «أعد الفحص» of a refund in flight.
        await button(refunds, 'أعد الفحص').click()
        await expect(statusLine(page)).toHaveText(`تمت إعادة ${formatMoney(4000)}.`)
        expect(bodies[1]).toEqual({ action: 'refund-recheck', refundId: inflight.id })

        // The review payment that has no order: closed with a reason (the SQL function), and the reason `refunded` is refused before any call.
        await answer(page, 'review_close', { ok: true, paymentId: noOrder.paymentId, closedAt: ISO })
        const bare = card(page, noOrder.paymentId)
        await button(bare, 'إغلاق المراجعة').click()
        await expect(alertLine(page)).toHaveText('أدخل سبب الإغلاق.')
        await bare.getByLabel('سبب الإغلاق').fill('Refunded')
        await button(bare, 'إغلاق المراجعة').click()
        await expect(alertLine(page)).toHaveText('لا يُقبل هذا السبب؛ اكتب سببًا آخر.')
        expect(rpc.count('review_close')).toBe(0)
        await bare.getByLabel('سبب الإغلاق').fill('عكسها البنك')
        await button(bare, 'إغلاق المراجعة').click()
        await expect(statusLine(page)).toHaveText('أُغلقت المراجعة.')
        expect(rpc.bodies('review_close')).toEqual([{ p_payment: noOrder.paymentId, p_reason: 'عكسها البنك' }])

        // An exhausted event, once looked at in Moyasar's dashboard. A reply that is not a reply is never read as done or as refused.
        await answer(page, 'event_dismiss', { eventId: 'evt-exhausted-1' })
        await button(eventsSection, 'تمت المراجعة').click()
        await expect(alertLine(page)).toHaveText(BAD_REPLY)
        await page.unroute('**/rest/v1/rpc/event_dismiss')
        await answer(page, 'event_dismiss', { ok: true, eventId: 'evt-exhausted-1' })
        await button(eventsSection, 'تمت المراجعة').click()
        await expect(statusLine(page)).toHaveText('سُجّلت المراجعة.')
        expect(rpc.bodies('event_dismiss')).toEqual([{ p_event: 'evt-exhausted-1' }, { p_event: 'evt-exhausted-1' }])
        expect(problems).toEqual([])
      })

      test('the reconciliation screen: the external record of an attempt, the refund of a review payment that has no order, both through the step-up', async ({ page }) => {
        const problems = watchProblems(page)
        const external = attemptJson({ providerRefunded: 2500, reasons: ['EXTERNAL_REFUND'] })
        const noOrder = reviewJson({ amount: 10600, refunded: 1000 })
        await answer(page, 'reconciliation_list', { ...emptyReconciliation, attempts: [external], reviews: [noOrder] })
        await answer(page, 'disputes_list', { references: [] })
        const refundId = randomUUID()
        const bodies = await mockAdmin(page, [STEP_UP, made(refundId, 'succeeded', 2500), STEP_UP, made(refundId, 'uncertain', 3000)])
        await page.goto('/admin/orders/reconciliation')
        const attempt = card(page, external.providerPaymentId)
        await button(attempt, 'تسجيل استرداد خارجي').click()
        await attempt.getByRole('textbox', { name: 'السبب', exact: true }).fill('استرداد من لوحة Moyasar')
        await button(attempt, 'تأكيد التسجيل').click()
        await expect.poll(() => bodies.length).toBe(1)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(`سُجّل استرداد خارجي بمبلغ ${formatMoney(2500)}.`)
        const record = { action: 'refund-record-external', attemptId: external.id, reason: 'استرداد من لوحة Moyasar' }
        expect(bodies).toEqual([record, record])

        // What is left of the payment is its amount less its refunds; the refund names no order, no line, no shipping.
        const review = card(page, noOrder.paymentId)
        await expect(fieldOf(review, 'المبلغ')).toContainText(`المتبقي: ${formatMoney(9600)}`)
        await review.getByLabel('المبلغ', { exact: true }).fill('96.01')
        await expect(fieldOf(review, 'المبلغ')).toContainText('المبلغ أكبر من المتبقي.')
        await review.getByLabel('المبلغ', { exact: true }).fill('30')
        await review.getByLabel('السبب', { exact: true }).first().fill('دفعة بلا طلب')
        await button(review, 'استرداد هذه الدفعة').click()
        await button(review, 'تأكيد الاسترداد').click()
        await expect.poll(() => bodies.length).toBe(3)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText(REFUND_UNCERTAIN)
        const key = bodies[2]!.idempotencyKey
        const refund = { action: 'refund-create', reviewPaymentId: noOrder.paymentId, amount: 3000, reason: 'دفعة بلا طلب', allocation: {}, idempotencyKey: key }
        expect(bodies.slice(2)).toEqual([refund, refund])
        expect(bodies[2]).not.toHaveProperty('orderId')
        expect(problems).toEqual([])
      })

      test('disputes on the reconciliation screen: a difference with no payment, a follow-up locked to its reference, recorded then repeated', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order } = s.form
        const first = disputeJson({ attemptId: order.attemptId, orderNumber: order.number, amount: 4500 })
        const second = disputeJson({ id: randomUUID(), attemptId: order.attemptId, orderNumber: order.number, seq: 2, amount: 4500, direction: 'for_seller', decision: 'entitlement_kept', resolution: 'حُسم لصالح البائع' })
        const payout = disputeJson({ kind: 'payout_difference', providerRef: 'PAYOUT-77', amount: 2500, direction: 'against_seller', reason: 'فرق في التحويل' })
        await answer(page, 'reconciliation_list', emptyReconciliation)
        await answer(page, 'disputes_list', { references: [{ kind: 'chargeback', providerRef: 'CB-2026-0007', rows: [first, second] }, { kind: 'payout_difference', providerRef: 'PAYOUT-77', rows: [payout] }] })
        const recorded = { duplicate: false, dispute: { ...payout, seq: 1 } }
        const bodies = await mockAdmin(page, [STEP_UP, { status: 201, body: { ok: true, data: recorded } }, ok({ duplicate: true, dispute: recorded.dispute }), ok({ duplicate: false, dispute: { ...second, seq: 3 } })])
        await page.goto('/admin/orders/reconciliation')
        const disputes = section(page, 'النزاعات')

        // Each reference with its rows in order, in words; the empty sections say so.
        const reference = card(page, 'CB-2026-0007')
        await expect(reference).toContainText('النوع: اعتراض بطاقة')
        await expect(reference).toContainText('الاتجاه: على البائع')
        await expect(reference).toContainText('الاتجاه: لصالح البائع')
        await expect(reference).toContainText('القرار: بلا إجراء')
        await expect(reference).toContainText('القرار: إبقاء الملفات')
        await expect(reference).toContainText('الحل: حُسم لصالح البائع')
        await expect(reference.locator('ul').filter({ hasText: 'التسلسل' })).toHaveCount(2)
        await expect(card(page, 'PAYOUT-77')).toContainText('النوع: فرق تحويل')
        await expect(button(disputes, 'إضافة متابعة')).toHaveCount(2)
        await expect(main(page).getByText('لا شيء هنا.')).toHaveCount(4)

        // «تسجيل فرق»: a payout or a fee difference, no payment, nothing that acts on lines.
        await button(disputes, 'تسجيل فرق').click()
        const difference = disputes.getByRole('form', { name: 'تسجيل فرق' })
        await expect(difference.getByLabel('النوع', { exact: true }).locator('option')).toHaveText(['فرق تحويل', 'فرق رسوم'])
        await expect(difference.getByLabel('القرار', { exact: true })).toHaveCount(0)
        await expect(difference.getByText(/استرداد/)).toHaveCount(0)
        await difference.getByLabel('المرجع', { exact: true }).fill('PAYOUT-78')
        await difference.getByLabel('النوع', { exact: true }).selectOption('fee_difference')
        await difference.getByLabel('المبلغ', { exact: true }).fill('12.5')
        await difference.getByLabel('الاتجاه', { exact: true }).selectOption('for_seller')
        await difference.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await difference.getByLabel('السبب', { exact: true }).fill('رسوم زائدة')
        await difference.getByLabel('الحل (اختياري)', { exact: true }).fill('سوّتها Moyasar')
        await button(difference, 'تأكيد التسجيل').click()
        await expect.poll(() => bodies.length).toBe(1)
        await enterCode(page)
        await expect(statusLine(page)).toHaveText('سُجّل.')
        const body = {
          action: 'dispute-record',
          kind: 'fee_difference',
          providerRef: 'PAYOUT-78',
          follows: 0,
          amount: 1250,
          direction: 'for_seller',
          occurredOn: yesterday(),
          reason: 'رسوم زائدة',
          resolution: 'سوّتها Moyasar',
          decision: 'none',
        }
        expect(bodies).toEqual([body, body])
        expect(bodies[0]).not.toHaveProperty('attemptId')
        expect(bodies[0]).not.toHaveProperty('reviewPaymentId')
        // The lists were read again after it.
        expect(rpc.count('reconciliation_list')).toBeGreaterThanOrEqual(2)
        expect(rpc.count('disputes_list')).toBeGreaterThanOrEqual(2)
        await expect(difference).toHaveCount(0)

        // Entered again: a repeat answers the stored row, and changes nothing.
        await button(disputes, 'تسجيل فرق').click()
        await difference.getByLabel('المرجع', { exact: true }).fill('PAYOUT-78')
        await difference.getByLabel('المبلغ', { exact: true }).fill('12.5')
        await difference.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await difference.getByLabel('السبب', { exact: true }).fill('رسوم زائدة')
        await button(difference, 'تأكيد التسجيل').click()
        await expect(statusLine(page)).toHaveText('هذا السجل مسجّل من قبل؛ لم يتغير شيء.')
        await expect(statusLine(page)).toBeFocused()

        // «إضافة متابعة» on the chargeback: its reference, kind and payment are those of its first row and cannot be edited; it follows its latest row.
        await button(card(page, 'CB-2026-0007'), 'إضافة متابعة').click()
        const follow = card(page, 'CB-2026-0007').getByRole('form', { name: 'إضافة متابعة' })
        await expect(follow).toBeVisible()
        await expect(follow.getByLabel('المرجع', { exact: true })).toHaveCount(0)
        await expect(follow.getByLabel('النوع', { exact: true })).toHaveCount(0)
        await expect(follow).toContainText('المرجع: CB-2026-0007')
        await expect(follow).toContainText('النوع: اعتراض بطاقة')
        await expect(follow).toContainText(`الطلب: ${order.number}`)
        // The lines of its order are read for the decisions that name some: the digital line has a file to withdraw.
        const decision = follow.getByLabel('القرار', { exact: true })
        await expect(decision.locator('option')).toHaveText(['بلا إجراء', 'سحب الملفات', 'إبقاء الملفات', 'إيقاف الشحن'])
        await follow.getByLabel('المبلغ', { exact: true }).fill('45')
        await follow.getByLabel('التاريخ', { exact: true }).fill(yesterday())
        await follow.getByLabel('السبب', { exact: true }).fill('متابعة')
        await decision.selectOption('entitlement_revoked')
        await button(follow, 'تأكيد التسجيل').click()
        await expect(alertLine(page)).toHaveText('اختر بندًا واحدًا على الأقل.')
        await expect(follow.getByRole('checkbox')).toHaveCount(1)
        await follow.getByRole('checkbox').check()
        await expectNoOverflow(page, 'follow-up form', width)
        await shoot(page, 'dispute-follow-up', width)
        await button(follow, 'تأكيد التسجيل').click()
        await expect(statusLine(page)).toHaveText('سُجّل.')
        expect(bodies.at(-1)).toEqual({
          action: 'dispute-record',
          kind: 'chargeback',
          providerRef: 'CB-2026-0007',
          follows: 2,
          attemptId: order.attemptId,
          amount: 4500,
          direction: 'against_seller',
          occurredOn: yesterday(),
          reason: 'متابعة',
          decision: 'entitlement_revoked',
          itemIds: [order.items[2]!.id],
        })
        // The payout difference has no payment: a follow-up of it offers no decision that names lines.
        await button(card(page, 'PAYOUT-77'), 'إضافة متابعة').click()
        await expect(card(page, 'PAYOUT-77').getByLabel('القرار', { exact: true })).toHaveCount(0)
        expect(problems).toEqual([])
      })

      test('the owner’s count of what needs matching is a link to the reconciliation screen, on the list and on the home', async ({ page }) => {
        const problems = watchProblems(page)
        await mockAdmin(page, [ok({ analytics: { status: 'unavailable' }, commerce: null })])
        await answer(page, 'reconciliation_list', emptyReconciliation)
        await answer(page, 'disputes_list', { references: [] })
        await page.goto('/admin/orders')
        const count = main(page).getByRole('link', { name: /^تحتاج مطابقة: [\d,]+$/ })
        await expect(count).toHaveAttribute('href', '/admin/orders/reconciliation')
        await expect(main(page).getByText(/^تحتاج حلًا: [\d,]+ · للشحن: [\d,]+ · دفعات قيد المراجعة: [\d,]+ · تحتاج مطابقة: [\d,]+$/)).toBeVisible()
        await expect(main(page).getByRole('link', { name: 'المطابقة', exact: true })).toHaveAttribute('href', '/admin/orders/reconciliation')
        await expectNoOverflow(page, 'orders list', width)
        await expectTargets(page, 'orders list')
        await count.click()
        await expect(page).toHaveURL(/\/admin\/orders\/reconciliation$/)
        await expect(page.getByRole('heading', { level: 1, name: 'المطابقة', exact: true })).toBeVisible()
        await expect(section(page, 'النزاعات')).toBeVisible()
        await page.goto('/admin')
        const home = section(page, 'الطلبات')
        await expect(home.getByRole('link', { name: /^تحتاج مطابقة: [\d,]+$/ })).toHaveAttribute('href', '/admin/orders/reconciliation')
        await expect(home.getByRole('link', { name: /^تحتاج حلًا/ })).toHaveCount(0)
        await expectTargets(page, 'the orders section of the home', home)
        expect(problems).toEqual([])
      })

      test('a refunded order has no refund form and no external record, only the recheck and the dispute of its attempt', async ({ page }) => {
        await page.goto(viewOf(s.refunded))
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مُعاد')
        const refunds = section(page, 'الاستردادات')
        await expect(refunds.getByRole('button')).toHaveCount(0)
        await expect(main(page).getByRole('button', { name: 'إعادة المبلغ' })).toHaveCount(0)
        await expect(main(page).getByRole('button', { name: 'تسجيل استرداد خارجي' })).toHaveCount(0)
        // The attempt can still be rechecked, and a dispute recorded about it.
        await expect(main(page).getByRole('button', { name: 'أعد الفحص', exact: true })).toHaveCount(1)
        await expect(main(page).getByRole('button', { name: 'تسجيل اعتراض', exact: true })).toHaveCount(1)
      })
    })

    // ================================================================================================= operations
    test.describe('an operations member', () => {
      test.use({ storageState: STATES.operations })

      test('sees the payment’s events and the refunds read-only, no money control, and no reconciliation: no call is made', async ({ page }) => {
        const rpc = watchRpc(page)
        const problems = watchProblems(page)
        await page.goto(viewOf(s.form.order))
        // The events are verified evidence for operations too, read-only.
        const rows = section(page, 'الدفع').locator('tbody tr')
        await expect(rows).toHaveCount(2)
        await expect(rows.first().locator('td[data-label="النوع"] span[dir="ltr"]')).toHaveText('payment_refunded')
        await expect(section(page, 'الاستردادات').locator('tbody tr')).toHaveCount(1)
        for (const name of MONEY_BUTTONS) await expect(main(page).getByRole('button', { name })).toHaveCount(0)
        await expect(main(page).getByLabel('ربط بطلب الإرجاع')).toHaveCount(0)
        await expect(main(page).locator('td[data-label="إجراء"]')).toHaveCount(0)
        await page.goto(viewOf(s.reviewed.order))
        await expect(card(page, s.reviewed.paymentId)).toBeVisible()
        for (const name of MONEY_BUTTONS) await expect(main(page).getByRole('button', { name })).toHaveCount(0)
        await page.goto(viewOf(s.inflight.order))
        await expect(section(page, 'الاستردادات').locator('td[data-label="الحالة"]')).toHaveText(['قيد الإرسال'])
        for (const name of MONEY_BUTTONS) await expect(main(page).getByRole('button', { name })).toHaveCount(0)

        // The list says nothing of matching and links nowhere; the screen refuses and asks for nothing.
        await page.goto('/admin/orders')
        await expect(main(page).getByText('تحتاج مطابقة')).toHaveCount(0)
        await expect(main(page).getByRole('link', { name: 'المطابقة', exact: true })).toHaveCount(0)
        await page.goto('/admin/orders/reconciliation')
        await expect(main(page).getByText(NO_ACCESS)).toBeVisible()
        await expect(main(page).locator('section')).toHaveCount(0)
        await expect(main(page).getByRole('button')).toHaveCount(0)
        expect(rpc.count('reconciliation_list')).toBe(0)
        expect(rpc.count('disputes_list')).toBe(0)
        await page.goto('/admin')
        await expect(section(page, 'الطلبات')).toBeVisible()
        await expect(section(page, 'الطلبات').getByRole('link', { name: /تحتاج مطابقة/ })).toHaveCount(0)
        expect(problems).toEqual([])
      })
    })

    // ==================================================================================================== an editor
    test.describe('an editor', () => {
      test.use({ storageState: STATES.editor })

      test('is refused the reconciliation screen and the order view, and nothing is asked', async ({ page }) => {
        const rpc = watchRpc(page)
        await page.goto('/admin/orders/reconciliation')
        await expect(main(page).getByText(NO_ACCESS)).toBeVisible()
        await expect(main(page).locator('section')).toHaveCount(0)
        await expect(main(page).getByRole('button')).toHaveCount(0)
        await page.goto(viewOf(s.form.order))
        await expect(main(page).getByText(NO_ACCESS)).toBeVisible()
        for (const name of MONEY_BUTTONS) await expect(main(page).getByRole('button', { name })).toHaveCount(0)
        for (const fn of ['reconciliation_list', 'disputes_list', 'order_detail', 'orders_list', 'orders_alerts']) expect(rpc.count(fn), fn).toBe(0)
      })
    })
  })
}
