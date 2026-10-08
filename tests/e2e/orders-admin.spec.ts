// P08 round 11a e2e: the staff's order screens (`/admin/orders`, `/admin/orders/view`, the home's
// alerts, the customers list's link) in the browser on `next dev`, against the real local stack with real
// sign-in (an email code read from Mailpit, once per role). The orders are real too: made through
// `checkout_create` and paid through `apply_verified_payment` by the integration harness
// (tests/integration/support.ts), so every screen reads what the round 7b SQL really answers and every
// action calls the real function. Only what the seed cannot make cheaply is mocked with `page.route` on
// `/rest/v1/rpc/...`: a second page of the list, the owner's disputes and a failure of the Data API (a
// refusal for lack of rights, a server error, a reply that is not what it should be). Each test runs at 360
// and at 1440, on orders seeded for that width. Screenshots land in admin-*.png under shotsDir('P08'): the
// accepted evidence folder only for an ACCEPTANCE_PACKAGE=P08 run, test-results/ otherwise. The spec
// retires what it made with the harness's `stop()`.
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

import { expect, test, type Locator, type Page, type Request } from '@playwright/test'

import { formatDate, formatMoney, formatNumber } from '../../src/lib/format'
import { commerceHarness, pgRpc, sha256, staffDb, uniqueEmail, type Harness, type Paid, type PaidItem, type Placed } from '../integration/support'
import { localEnv, signInByCode } from './helpers'
import { shotsDir } from './shots'

const SHOTS = shotsDir('P08')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const STATES = {
  owner: 'test-results/orders-admin/owner.json',
  operations: 'test-results/orders-admin/operations.json',
  editor: 'test-results/orders-admin/editor.json',
}

const NO_ACCESS = 'لا تملك صلاحية الوصول'
const BAD_QUERY = 'أدخل رقم طلب كاملًا أو بريدًا إلكترونيًا.'
const LOAD_FAILED = 'تعذّر التحميل.'
const SAVE_FAILED = 'تعذّر الحفظ. حاول مرة أخرى.'
const NO_PERMISSION = 'لا تملك صلاحية هذا الإجراء.'
const SEARCH = 'بحث برقم الطلب أو البريد'

type Member = { userId: string; email: string }
let h: Harness
let owner: Member
let operations: Member
let editor: Member

test.describe.configure({ timeout: 120_000 })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  h = await commerceHarness(localEnv().TOKEN_HASH_PEPPER ?? `orders-admin-pepper-${randomUUID()}`)
  owner = await h.makeStaff('owner')
  operations = await h.makeStaff('operations')
  editor = await h.makeStaff('editor')
  // One real sign-in per role; the tests start from the session it left, so the stack sends three codes, not one per test.
  for (const [role, member] of [
    ['owner', owner],
    ['operations', operations],
    ['editor', editor],
  ] as const) {
    // An empty state of its own: a context made here would otherwise start from the state a test group names, which this loop is making.
    const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', storageState: { cookies: [], origins: [] } })
    await signInByCode(await context.newPage(), member.email)
    await context.storageState({ path: STATES[role] })
    await context.close()
  }
  // `next dev` compiles a page on its first request: do it once, before any test has a clock running.
  for (const route of ['/admin/sign-in', '/admin', '/admin/orders', '/admin/orders/view', '/admin/store/customers']) {
    await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
  }
})

test.afterAll(async () => {
  // The saved sessions are of users made for this run: they go with it.
  rmSync('test-results/orders-admin', { recursive: true, force: true })
  await h?.stop()
})

// ---- seeds --------------------------------------------------------------------------------------------------------

const stockOf = async (variantId: string): Promise<number> => Number((await h.row('select stock from public.product_variants where id = $1', [variantId])).stock)
const stateOf = async (itemId: string): Promise<Record<string, unknown>> => h.row('select * from finance.fulfillments where order_item_id = $1', [itemId])

/** A variant as the screens name it: its SKU, and «product: variant» for the line that carries it. */
type Variant = { id: string; sku: string; name: string }
async function variant(make: Promise<string>): Promise<Variant> {
  const id = await make
  const row = await h.row('select v.sku, v.title, p.title as product from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1', [id])
  return { id, sku: row.sku as string, name: `${row.product}: ${row.title}` }
}

interface Seed {
  buyer: string
  physical: Variant
  signed: Variant
  digital: Variant
  mixed: Paid
  ship: { order: Paid; physical: Variant; signed: Variant }
  pending: Placed
  pendingLive: Placed
  refunded: Paid
  partial: { order: Paid; refunded: Variant; open: Variant }
  late: { order: Paid; goods: Variant }
  reviewed: { order: Paid; payments: string[] }
  stuck: { order: Placed; variant: Variant }
  stuckOps: Placed
  stuckRefund: { order: Placed; variant: Variant; attemptId: string }
  preorder: { order: Paid; preorder: Variant; normal: Variant; returnId: string }
  returnOwner: { order: Paid; variant: Variant; acceptId: string; staleId: string; declineId: string }
  returnOps: { order: Paid; variant: Variant; rejectId: string; receiveId: string }
}

/** The buyer's return request for `quantity` of each of `lines` (the first line by default) of a paid order whose lines are shipped, which a return needs. */
async function requestReturn(order: Paid, quantity: number, reason: string, lines: PaidItem[] = [order.items[0]!]): Promise<string> {
  const reply = await h.call('return_request_create', {
    p_order_number: order.number,
    p_access_token_hash: order.hash,
    p_items: lines.map((line) => ({ itemId: line.id, quantity })),
    p_reason: reason,
    p_ip_hash: h.ipHash(),
    p_mode: 'test',
  })
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true })
  return reply.returnId as string
}
async function shipped(order: Paid): Promise<void> {
  await h.postgres.query(
    "update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-' || left(order_item_id::text, 8), shipped_at = now() where order_id = $1",
    [order.id],
  )
}

/** A refund of one line's whole price, requested and confirmed by the provider's total (what the owner's refund screen of round 11b will do). */
async function refundLine(order: Paid, item: PaidItem): Promise<void> {
  const key = randomUUID()
  const asked = await h.call('refund_request', {
    p_actor: owner.userId,
    p_order: order.id,
    p_attempt: order.attemptId,
    p_review_payment: null,
    p_amount: item.paid,
    p_reason: 'استرداد عنصر',
    p_allocation: { items: [{ itemId: item.id, amount: item.paid }] },
    p_idempotency_key: key,
    p_request_hash: sha256(`hash:${key}`),
    p_return: null,
    p_provider_refunded: 0,
  })
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
  const done = await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: item.paid, p_error: null })
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true, status: 'succeeded' })
}

/** An order paid when its stock was gone: placed and invoiced, the stock emptied, then paid. */
async function stuckOrder(): Promise<{ order: Placed; variant: Variant; attemptId: string }> {
  const goods = await variant(h.physical(4000, 5))
  const placed = await h.place([{ variantId: goods.id, quantity: 1 }])
  const started = await h.startPayment(placed)
  await h.postgres.query('update public.product_variants set stock = 0 where id = $1', [goods.id])
  expect(await h.applyPayment(placed, started)).toMatchObject({ outcome: 'paid_needs_resolution' })
  return { order: placed, variant: goods, attemptId: started.attemptId }
}

/** Fresh orders for one width: every state the screens draw, each in its own order so a test that changes one disturbs no other. */
async function seed(): Promise<Seed> {
  const buyer = uniqueEmail('orders-admin')
  const physical = await variant(h.physical(4000, 10))
  const signed = await variant(h.signed(9000, 10))
  const digital = await variant(h.digital(3500))
  // The order the view tests read: a physical line of two, a signed one with its dedication, a digital one.
  const mixed = await h.paid(
    [
      { variantId: physical.id, quantity: 2 },
      { variantId: signed.id, quantity: 1, dedication: 'إلى أنس مع المحبة' },
      { variantId: digital.id, quantity: 1 },
    ],
    { email: buyer },
  )
  const shipPhysical = await variant(h.physical(4000, 10))
  const shipSigned = await variant(h.signed(9000, 10))
  const ship = await h.paid([
    { variantId: shipPhysical.id, quantity: 1 },
    { variantId: shipSigned.id, quantity: 1, dedication: 'للإهداء' },
  ])
  const pending = await h.place([{ variantId: physical.id, quantity: 1 }], { email: buyer })
  const pendingLive = await h.place([{ variantId: (await variant(h.physical(4000, 10))).id, quantity: 1 }], { environment: 'live' })
  // Refunded in full: a physical line and a digital one (whose file is withdrawn with the refund).
  const refunded = await h.paid([
    { variantId: (await variant(h.physical(4000, 10))).id, quantity: 1 },
    { variantId: (await variant(h.digital(3500))).id, quantity: 1 },
  ])
  await h.refundFully(refunded, owner.userId)
  // One of two physical lines refunded in full: the order stays paid, the line still to be prepared cannot be shipped.
  const partialRefunded = await variant(h.physical(4000, 10))
  const partialOpen = await variant(h.physical(4000, 10))
  const partial = await h.paid([
    { variantId: partialRefunded.id, quantity: 1 },
    { variantId: partialOpen.id, quantity: 1 },
  ])
  await refundLine(partial, partial.items[0]!)
  const lateGoods = await variant(h.physical(4000, 10))
  const late = await h.paid([{ variantId: lateGoods.id, quantity: 1 }])

  // A paid order with three more charged payments on its invoice: three review payments, open until someone settles them.
  const reviewedOrder = await h.paid([{ variantId: (await variant(h.digital(3500))).id, quantity: 1 }])
  const payments = [randomUUID(), randomUUID(), randomUUID()]
  for (const paymentId of payments) {
    const reply = await h.applyPayment(reviewedOrder, { invoiceId: reviewedOrder.invoiceId, paymentId })
    expect(reply, JSON.stringify(reply)).toMatchObject({ outcome: 'review', reason: 'SECOND_PAYMENT' })
  }

  const stuck = await stuckOrder()
  const stuckOps = (await stuckOrder()).order
  const stuckRefund = await stuckOrder()

  // The owner's order: four units bought, three returns (2, 1 and 1) so that each test of the owner has its own.
  const ownerVariant = await variant(h.physical(4000, 10))
  const ownerOrder = await h.paid([{ variantId: ownerVariant.id, quantity: 4 }])
  await shipped(ownerOrder)
  const acceptId = await requestReturn(ownerOrder, 2, 'سبب الإرجاع الأول')
  const staleId = await requestReturn(ownerOrder, 1, 'سبب الإرجاع المتأخر')
  const declineId = await requestReturn(ownerOrder, 1, 'سبب الإرجاع المرفوض')

  // Operations' order: two units, one return to reject and one that is already approved, waiting for its goods.
  const opsVariant = await variant(h.physical(4000, 10))
  const opsOrder = await h.paid([{ variantId: opsVariant.id, quantity: 2 }])
  await shipped(opsOrder)
  const rejectId = await requestReturn(opsOrder, 1, 'سبب الرفض')
  const receiveId = await requestReturn(opsOrder, 1, 'سبب الاستلام')
  await h.postgres.query("update finance.return_requests set state = 'approved' where id = $1", [receiveId])

  // A preorder line and an ordinary one, both shipped, returned together and approved.
  const preorderGoods = await variant(h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0, preorder: { capacity: 5 } }))
  const normalGoods = await variant(h.physical(2500, 10))
  const preorderOrder = await h.paid([
    { variantId: preorderGoods.id, quantity: 2 },
    { variantId: normalGoods.id, quantity: 2 },
  ])
  await shipped(preorderOrder)
  const preorderReturn = await requestReturn(preorderOrder, 2, 'سبب الطلب المسبق', preorderOrder.items)
  await h.postgres.query("update finance.return_requests set state = 'approved' where id = $1", [preorderReturn])

  return {
    buyer,
    physical,
    signed,
    digital,
    mixed,
    ship: { order: ship, physical: shipPhysical, signed: shipSigned },
    pending,
    pendingLive,
    refunded,
    partial: { order: partial, refunded: partialRefunded, open: partialOpen },
    late: { order: late, goods: lateGoods },
    reviewed: { order: reviewedOrder, payments },
    stuck,
    stuckOps,
    stuckRefund,
    preorder: { order: preorderOrder, preorder: preorderGoods, normal: normalGoods, returnId: preorderReturn },
    returnOwner: { order: ownerOrder, variant: ownerVariant, acceptId, staleId, declineId },
    returnOps: { order: opsOrder, variant: opsVariant, rejectId, receiveId },
  }
}

// ---- helpers ------------------------------------------------------------------------------------------------------

const main = (page: Page): Locator => page.locator('main')
const rowOf = (page: Page, number: string): Locator => main(page).locator('tbody tr').filter({ has: page.getByRole('link', { name: number, exact: true }) })
const section = (page: Page, name: string): Locator =>
  main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
const card = (page: Page, text: string): Locator => main(page).locator('[class*="listItem"]').filter({ hasText: text })
const statusLine = (page: Page): Locator => main(page).getByRole('status')
const alertLine = (page: Page): Locator => main(page).getByRole('alert')
const search = (page: Page): Locator => main(page).getByLabel(SEARCH)
const viewOf = (order: { id: string }): string => `/admin/orders/view?id=${order.id}`
const button = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true })
/** The checkbox of a shipping line, named as the line is: «product: variant». */
const lineBox = (shipping: Locator, goods: Variant): Locator => shipping.getByRole('checkbox', { name: goods.name, exact: true })
/** The row of the shipping table that holds a line (found by its checkbox). */
const shippingRow = (shipping: Locator, goods: Variant): Locator =>
  shipping.locator('tbody tr').filter({ has: shipping.page().getByRole('checkbox', { name: goods.name, exact: true }) })

/** The Data API calls a page makes, by function, in order (what a screen asked, and whether it asked at all). */
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

/** The headers a fulfilled cross-origin answer needs (the Data API is another origin than the site). */
const cors = (request: Request): Record<string, string> => ({
  'access-control-allow-origin': request.headers().origin ?? '*',
  'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'content-type': 'application/json',
})

/** Answers a Data API function with `reply` instead of the stack, whatever its status. */
async function answer(page: Page, fn: string, reply: { status?: number; body: unknown }): Promise<void> {
  await page.route(`**/rest/v1/rpc/${fn}`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route.request()) })
    return route.fulfill({ status: reply.status ?? 200, headers: cors(route.request()), body: JSON.stringify(reply.body) })
  })
}
const serverError = { status: 500, body: { code: 'XX000', message: 'boom', details: null, hint: null } }

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
    const found = [...root.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]):not([type="checkbox"]), a[href], label:has(input[type="checkbox"])')]
    return found
      .map((el) => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 1 && box.height > 1 && box.height < 43.9)
      .map(({ name, box }) => `${name} (${Math.round(box.height)}px)`)
  })
  expect(small, `${label}: targets under 44px`).toEqual([])
}

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/admin-${name}-${width}.png`, fullPage: true })
}

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

      test('the list: the alerts line, every filter that has data, the search by number and by email, the fields of a row', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        await page.goto('/admin/orders')
        await expect(page.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible()
        // The alerts line, from `orders_alerts()`: three counts and, for the owner alone, a fourth.
        await expect(main(page).getByText(/^تحتاج حلًا: [\d,]+ · للشحن: [\d,]+ · دفعات قيد المراجعة: [\d,]+ · تحتاج مطابقة: [\d,]+$/)).toBeVisible()
        // The list is as wide as a table of nine columns needs (the shell widens it), and low stock is not on this screen.
        if (width >= 1200) expect((await main(page).boundingBox())!.width).toBeGreaterThan(1100)
        await expect(main(page).getByText('مخزون منخفض')).toHaveCount(0)

        // The fields of a row: number (a link to the view), badges, status, total, name, email, lines, lines to ship, refunded.
        const mixed = rowOf(page, s.mixed.number)
        await expect(mixed).toBeVisible()
        await expect(mixed.getByRole('link', { name: s.mixed.number, exact: true })).toHaveAttribute('href', `/admin/orders/view?id=${s.mixed.id}`)
        await expect(mixed.getByRole('link', { name: s.mixed.number, exact: true })).toHaveAttribute('dir', 'ltr')
        await expect(mixed.getByText('تجريبي')).toBeVisible()
        await expect(mixed.getByText('قيد المراجعة')).toHaveCount(0)
        await expect(mixed.locator('td[data-label="الحالة"]')).toHaveText('مدفوع')
        await expect(mixed.locator('td[data-label="الإجمالي"]')).toHaveText(formatMoney(s.mixed.total))
        await expect(mixed.locator('td[data-label="التاريخ"]')).toHaveText(/\d{4}/)
        await expect(mixed.locator('td[data-label="الاسم"]')).toHaveText('مشترٍ')
        await expect(mixed.locator('td[data-label="البريد"]')).toHaveText(s.buyer)
        await expect(mixed.locator('td[data-label="البريد"]')).toHaveAttribute('dir', 'ltr')
        await expect(mixed.locator('td[data-label="العناصر"]')).toHaveText('3')
        await expect(mixed.locator('td[data-label="للشحن"]')).toHaveText('2')
        // Nothing refunded: the cell is empty, not a zero.
        await expect(mixed.locator('td[data-label="المُعاد"]')).toHaveText('')
        // A live order carries no badge; an order with an open review payment carries «قيد المراجعة»; a refunded one shows what was refunded.
        await expect(rowOf(page, s.pendingLive.number)).toBeVisible()
        await expect(rowOf(page, s.pendingLive.number).getByText('تجريبي')).toHaveCount(0)
        await expect(rowOf(page, s.pending.number).locator('td[data-label="الحالة"]')).toHaveText('بانتظار الدفع')
        await expect(rowOf(page, s.reviewed.order.number).getByText('قيد المراجعة')).toBeVisible()
        await expect(rowOf(page, s.refunded.number).locator('td[data-label="الحالة"]')).toHaveText('مُعاد')
        await expect(rowOf(page, s.refunded.number).locator('td[data-label="المُعاد"]')).toHaveText(formatMoney(s.refunded.total))
        await expect(rowOf(page, s.stuck.order.number).locator('td[data-label="الحالة"]')).toHaveText('مدفوع: يحتاج حلًا')

        // Every filter that has data keeps its orders and drops the others.
        const filters: Array<{ name: string; present: Placed[]; absent: Placed[] }> = [
          { name: 'المدفوعة', present: [s.mixed, s.ship.order, s.reviewed.order], absent: [s.pending, s.stuck.order, s.refunded] },
          { name: 'للشحن', present: [s.mixed, s.ship.order], absent: [s.pending, s.stuck.order, s.refunded, s.pendingLive] },
          { name: 'تحتاج حلًا', present: [s.stuck.order, s.stuckOps], absent: [s.mixed, s.pending, s.refunded] },
          { name: 'بانتظار الدفع', present: [s.pending, s.pendingLive], absent: [s.mixed, s.stuck.order] },
          { name: 'المُعادة', present: [s.refunded], absent: [s.mixed, s.pending, s.stuck.order] },
          { name: 'قيد المراجعة', present: [s.reviewed.order], absent: [s.mixed, s.pending] },
          { name: 'الكل', present: [s.mixed, s.pending, s.stuck.order, s.refunded, s.reviewed.order], absent: [] },
        ]
        const group = main(page).getByRole('group', { name: 'تصفية الطلبات' })
        await expect(group.getByRole('button')).toHaveText(['الكل', 'المدفوعة', 'للشحن', 'تحتاج حلًا', 'بانتظار الدفع', 'المُعادة', 'قيد المراجعة'])
        for (const filter of filters) {
          await button(group, filter.name).click()
          await expect(button(group, filter.name)).toHaveAttribute('aria-pressed', 'true')
          // The present rows prove the new page is drawn (the old one was cleared on the click), so the absences below mean something.
          for (const order of filter.present) await expect(rowOf(page, order.number)).toBeVisible()
          for (const order of filter.absent) await expect(rowOf(page, order.number)).toHaveCount(0)
          await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1)
        }

        // When this stack holds more than 50 orders, the real cursor works too: the next page is appended and no order shows twice.
        const more = button(main(page), 'المزيد')
        if ((await more.count()) > 0) {
          const numbers = main(page).locator('tbody tr td[data-label="رقم الطلب"]')
          const first = await numbers.count()
          await more.click()
          await expect.poll(() => numbers.count()).toBeGreaterThan(first)
          const shown = (await numbers.allTextContents()).map((text) => text.trim())
          expect(new Set(shown).size).toBe(shown.length)
        }

        // The search by number, typed in lower case: one order, asked for upper-cased, with the filter, no cursor and the page size.
        const asked = page.waitForRequest((request) => request.url().includes('/rpc/orders_list') && request.method() === 'POST')
        await search(page).fill(s.mixed.number.toLowerCase())
        await button(main(page), 'بحث').click()
        expect((await asked).postDataJSON()).toEqual({ p_filter: 'all', p_query: s.mixed.number, p_before: null, p_limit: 50 })
        await expect(main(page).locator('tbody tr')).toHaveCount(1)
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(button(main(page), 'مسح')).toBeVisible()

        // The search by email, typed in upper case: the customer's two orders here; with a filter, one.
        const byEmail = page.waitForRequest((request) => request.url().includes('/rpc/orders_list') && request.method() === 'POST')
        await search(page).fill(`  ${s.buyer.toUpperCase()} `)
        await button(main(page), 'بحث').click()
        expect((await byEmail).postDataJSON()).toEqual({ p_filter: 'all', p_query: s.buyer, p_before: null, p_limit: 50 })
        await expect(main(page).locator('tbody tr')).toHaveCount(2)
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(rowOf(page, s.pending.number)).toBeVisible()
        await button(group, 'بانتظار الدفع').click()
        await expect(main(page).locator('tbody tr')).toHaveCount(1)
        await expect(rowOf(page, s.pending.number)).toBeVisible()
        await button(group, 'الكل').click()
        await expect(main(page).locator('tbody tr')).toHaveCount(2)

        // Text that is neither: the screen says so and asks nothing.
        const before = rpc.count('orders_list')
        await search(page).fill('ABCD1234')
        await button(main(page), 'بحث').click()
        await expect(alertLine(page)).toHaveText(BAD_QUERY)
        expect(rpc.count('orders_list')).toBe(before)

        // «مسح» ends the search: the field empties, the whole list returns, and the button goes.
        await button(main(page), 'مسح').click()
        await expect(search(page)).toHaveValue('')
        await expect(alertLine(page)).toHaveText('')
        await expect(rowOf(page, s.stuck.order.number)).toBeVisible()
        await expect(button(main(page), 'مسح')).toHaveCount(0)
        expect(problems).toEqual([])
      })

      test("the customers list links to a customer's orders: the address goes in the fragment, fills the search and leaves the address bar", async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        await page.goto('/admin/store/customers')
        const row = main(page).locator('tbody tr').filter({ hasText: s.buyer })
        await expect(row).toBeVisible()
        const link = row.getByRole('link', { name: 'طلباته' })
        await expect(link).toHaveAttribute('href', `/admin/orders#q=${encodeURIComponent(s.buyer)}`)
        await link.click()
        await expect(page).toHaveURL(/\/admin\/orders$/)
        await expect(search(page)).toHaveValue(s.buyer)
        // Gone from the address bar at once, and never in a query string.
        expect(new URL(page.url()).hash).toBe('')
        expect(new URL(page.url()).search).toBe('')
        await expect(main(page).locator('tbody tr')).toHaveCount(2)
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(rowOf(page, s.pending.number)).toBeVisible()
        // One search, the customer's: no first page of everyone was asked for in between.
        expect(rpc.bodies('orders_list')).toEqual([{ p_filter: 'all', p_query: s.buyer, p_before: null, p_limit: 50 }])
        expect(problems).toEqual([])
      })

      test('«المزيد» appends the next page with the cursor the first one gave, until there is none', async ({ page }) => {
        const CURSOR = '2026-10-03T10:00:00.123456+00:00'
        const mock = (number: string) => ({
          id: randomUUID(),
          orderNumber: number,
          status: 'paid',
          environment: 'live',
          createdAt: '2026-10-03T10:00:00+00:00',
          paidAt: null,
          total: 5000,
          name: 'مشترٍ',
          email: 'later@example.com',
          items: 1,
          toShip: 0,
          refunded: 0,
          review: false,
        })
        const seen: Array<Record<string, unknown>> = []
        await page.route('**/rest/v1/rpc/orders_list', (route) => {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route.request()) })
          const body = route.request().postDataJSON() as Record<string, unknown>
          seen.push(body)
          const reply = body.p_before === null ? { rows: [mock('MNPQ2345'), mock('MNPQ2346')], next: CURSOR } : { rows: [mock('MNPQ2347')], next: null }
          return route.fulfill({ status: 200, headers: cors(route.request()), body: JSON.stringify(reply) })
        })
        await page.goto('/admin/orders')
        await expect(main(page).locator('tbody tr')).toHaveCount(2)
        const more = button(main(page), 'المزيد')
        await expect(more).toBeVisible()
        await more.click()
        await expect(main(page).locator('tbody tr')).toHaveCount(3)
        await expect(main(page).locator('tbody tr td[data-label="رقم الطلب"]')).toHaveText(['MNPQ2345', 'MNPQ2346', 'MNPQ2347'])
        await expect(more).toHaveCount(0)
        // The second page was asked with the first one's cursor, as it came.
        expect(seen).toEqual([
          { p_filter: 'all', p_query: null, p_before: null, p_limit: 50 },
          { p_filter: 'all', p_query: null, p_before: CURSOR, p_limit: 50 },
        ])
      })

      test('an empty list says so; a failed or unreadable one says it could not load, and «تحديث» asks again', async ({ page }) => {
        await page.route('**/rest/v1/rpc/orders_list', (route) => {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route.request()) })
          return route.fulfill({ status: 200, headers: cors(route.request()), body: JSON.stringify({ rows: [], next: null }) })
        })
        await page.goto('/admin/orders')
        await expect(main(page).getByText('لا توجد طلبات.')).toBeVisible()
        await expect(main(page).locator('table')).toHaveCount(0)
        await page.unroute('**/rest/v1/rpc/orders_list')

        // A server error.
        await answer(page, 'orders_list', serverError)
        await page.reload()
        await expect(alertLine(page)).toHaveText(LOAD_FAILED)
        await expect(main(page).locator('table')).toHaveCount(0)
        // A reply that is not a list is a failure too, never a half-drawn row.
        await page.unroute('**/rest/v1/rpc/orders_list')
        await answer(page, 'orders_list', { body: { rows: [{ id: 'not-an-id' }], next: null } })
        await page.reload()
        await expect(alertLine(page)).toHaveText(LOAD_FAILED)
        await expect(main(page).locator('table')).toHaveCount(0)
        // The stack answers again: «تحديث» asks again and the list is there.
        await page.unroute('**/rest/v1/rpc/orders_list')
        await button(main(page), 'تحديث').click()
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(alertLine(page)).toHaveText('')
        await expect(button(main(page), 'تحديث')).toHaveCount(0)
      })

      test('the view: every section in its order, the evidence of the payment, the lines, the shipping and the owner’s audit', async ({ page }) => {
        const problems = watchProblems(page)
        const reply = page.waitForResponse((response) => response.url().includes('/rpc/order_detail'))
        await page.goto(viewOf(s.mixed))
        const detail = (await (await reply).json()) as Record<string, unknown>
        // The owner's reply carries the disputes and the audit; no secret of the order is in it.
        expect(Object.keys(detail)).toEqual(expect.arrayContaining(['disputes', 'audit']))
        expect(JSON.stringify(detail)).not.toMatch(/token|invoiceUrl|idempotency|storage/i)

        await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.mixed.number)
        // The owner's money section comes last: the paying attempt can be refunded (round 11b); the payment's webhook events are its only subsection here.
        await expect(main(page).locator('h2')).toHaveText(['العميل والتوصيل', 'العناصر', 'الدفع', 'الشحن', 'الملفات', 'النزاعات', 'السجل', 'الاستردادات'])
        await expect(main(page).locator('h3')).toHaveText(['إشعارات الدفع'])
        // Header: status, badge, times (a paid order has no hold to show).
        const header = main(page).locator('ul').first()
        await expect(header).toContainText('الحالة: مدفوع')
        await expect(header.getByText('تجريبي')).toBeVisible()
        await expect(header).toContainText('وقت الإنشاء:')
        await expect(header).toContainText('وقت الدفع:')
        await expect(header).not.toContainText('ينتهي الحجز')
        await expect(main(page).getByRole('link', { name: 'العودة إلى الطلبات' })).toHaveAttribute('href', '/admin/orders')

        // The contact is for fulfilment: shown as text, never a mailto or tel link.
        const contact = section(page, 'العميل والتوصيل')
        await expect(contact).toContainText('الاسم: مشترٍ')
        await expect(contact.locator('span[dir="ltr"]', { hasText: s.buyer })).toBeVisible()
        await expect(contact.locator('span[dir="ltr"]', { hasText: '966501234567' })).toBeVisible()
        await expect(contact).toContainText('تبوك شارع الرئيسي')
        await expect(main(page).locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0)

        // The lines: SKU (left to right), kind, quantity, unit price, line total, the dedication of the signed one.
        const items = section(page, 'العناصر')
        const line = (goods: Variant): Locator => items.locator('tbody tr').filter({ has: page.locator('td[data-label="الرمز"]', { hasText: new RegExp(`^${goods.sku}$`) }) })
        await expect(line(s.physical).locator('td[data-label="الرمز"] span[dir="ltr"]')).toHaveText(s.physical.sku)
        await expect(line(s.physical)).toContainText(s.physical.name)
        await expect(line(s.physical).locator('td[data-label="النوع"]')).toHaveText('ورقي')
        await expect(line(s.physical).locator('td[data-label="الكمية"]')).toHaveText('2')
        await expect(line(s.physical).locator('td[data-label="السعر"]')).toHaveText(formatMoney(4000))
        await expect(line(s.physical).locator('td[data-label="الإجمالي"]')).toHaveText(formatMoney(8000))
        await expect(line(s.signed).locator('td[data-label="النوع"]')).toHaveText('موقّع')
        await expect(line(s.signed)).toContainText('الإهداء: إلى أنس مع المحبة')
        await expect(line(s.digital).locator('td[data-label="النوع"]')).toHaveText('رقمي')
        // The totals: subtotal, discount, shipping, total, refunded.
        await expect(items).toContainText(`المجموع الفرعي: ${formatMoney(8000 + 9000 + 3500)}`)
        await expect(items).toContainText(`الشحن: ${formatMoney(2500)}`)
        await expect(items).toContainText(`الإجمالي: ${formatMoney(s.mixed.total)}`)
        await expect(items).toContainText(`المُعاد: ${formatMoney(0)}`)

        // The payment: the provider's own ids under their labels (left to right and plain text, so they can be selected), its status, amounts, source.
        const payment = section(page, 'الدفع')
        await expect(payment).toContainText('الحالة: مدفوع')
        await expect(payment).toContainText(`المبلغ: ${formatMoney(s.mixed.total)}`)
        await expect(payment.getByText('رقم الفاتورة لدى Moyasar:')).toBeVisible()
        await expect(payment.locator('span[dir="ltr"]', { hasText: s.mixed.invoiceId })).toBeVisible()
        await expect(payment.getByText('رقم الدفعة لدى Moyasar:')).toBeVisible()
        await expect(payment.locator('span[dir="ltr"]', { hasText: s.mixed.paymentId })).toBeVisible()
        await expect(payment).toContainText('حالة المزوّد:')
        await expect(payment).toContainText(`المقبوض: ${formatMoney(s.mixed.total)}`)
        await expect(payment).toContainText(`الرسوم: ${formatMoney(150)}`)
        await expect(payment.locator('span[dir="ltr"]', { hasText: 'creditcard' })).toBeVisible()
        await expect(payment.locator('span[dir="ltr"]', { hasText: 'mada' })).toBeVisible()
        await expect(payment).toContainText('وقت الدفع:')
        await expect(payment).not.toContainText('دفعات قيد المراجعة')

        // The shipping: two lines to prepare (the digital one has none); the files: a digital line still waiting for its file.
        const shipping = section(page, 'الشحن')
        await expect(shipping.locator('tbody tr')).toHaveCount(2)
        await expect(shipping.locator('td[data-label="الحالة"]')).toHaveText(['قيد التجهيز', 'قيد التجهيز'])
        await expect(shippingRow(shipping, s.signed).locator('td[data-label="الإهداء"]')).toHaveText('لا')
        await expect(section(page, 'الملفات').locator('td[data-label="الحالة"]')).toHaveText('ممنوح')
        await expect(section(page, 'الملفات').locator('td[data-label="الملف"]')).toHaveText('بانتظار الملف')

        // The owner's parts, read-only: no disputes, and the audit of this order with its action codes left to right.
        await expect(section(page, 'النزاعات').getByText('لا توجد نزاعات.')).toBeVisible()
        await expect(section(page, 'السجل').locator('span[dir="ltr"]', { hasText: 'order.paid' })).toBeVisible()
        await expect(main(page).getByRole('button', { name: 'إغلاق المراجعة' })).toHaveCount(0)
        await expect(main(page).getByRole('heading', { level: 2, name: 'إكمال الطلب' })).toHaveCount(0)

        await expectNoOverflow(page, 'order view', width)
        await expectTargets(page, 'order view')
        await shoot(page, 'order-view', width)
        expect(problems).toEqual([])
      })

      test('the view of a refunded order: the line says «مُعاد بالكامل» and the refund is listed, read-only', async ({ page }) => {
        await page.goto(viewOf(s.refunded))
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.refunded.number)
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مُعاد')
        const line = section(page, 'العناصر').locator('tbody tr').first()
        await expect(line.locator('td[data-label="المُعاد"]')).toContainText(`${formatMoney(s.refunded.items[0]!.paid)} مُعاد بالكامل`)
        const refunds = section(page, 'الاستردادات')
        await expect(refunds.locator('td[data-label="الحالة"]')).toHaveText('تم')
        await expect(refunds.locator('td[data-label="المبلغ"]')).toHaveText(formatMoney(s.refunded.total))
        await expect(refunds.locator('td[data-label="المصدر"]')).toHaveText('من اللوحة')
        await expect(refunds.locator('td[data-label="السبب"]')).toHaveText('استرداد كامل')
        await expect(refunds.getByRole('button')).toHaveCount(0)
        // The digital line's file was withdrawn with the refund: «مسحوب», with the reason the refund wrote, left to right, and no file.
        const files = section(page, 'الملفات')
        await expect(files.locator('td[data-label="الحالة"]')).toContainText('مسحوب')
        await expect(files.locator('td[data-label="الحالة"] span[dir="ltr"]')).toHaveText('refund')
        await expect(files.locator('td[data-label="الملف"]')).toHaveText('')
        // The shipping lines of a refunded order are shown but can no longer be moved: no controls.
        await expect(section(page, 'الشحن').locator('tbody tr')).toHaveCount(1)
        await expect(main(page).getByRole('button', { name: 'تم الشحن', exact: true })).toHaveCount(0)
        await expect(main(page).getByRole('checkbox')).toHaveCount(0)
      })

      test('a pending order shows when its hold ends; a missing or malformed id is «لم نجد هذا الطلب.» and asks nothing', async ({ page }) => {
        await page.goto(viewOf(s.pending))
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.pending.number)
        await expect(main(page).locator('ul').first()).toContainText('الحالة: بانتظار الدفع')
        await expect(main(page).locator('ul').first()).toContainText('ينتهي الحجز:')
        await expect(main(page).locator('ul').first()).not.toContainText('وقت الدفع')
        await expect(section(page, 'الدفع').getByText('لا توجد محاولات دفع.')).toBeVisible()
        await expect(main(page).locator('h2').filter({ hasText: /^(الشحن|الملفات|الإرجاع)$/ })).toHaveCount(0)

        // An id that is no order: the sentence and the way back to the list.
        await page.goto(viewOf({ id: randomUUID() }))
        await expect(main(page).getByText('لم نجد هذا الطلب.')).toBeVisible()
        await expect(main(page).getByRole('link', { name: 'العودة إلى الطلبات' })).toBeVisible()
        // An id that is not shaped like one, or none at all: the same, and no call is made.
        for (const path of ['/admin/orders/view?id=not-an-id', '/admin/orders/view?id=', '/admin/orders/view']) {
          const fresh = await page.context().newPage()
          const rpc = watchRpc(fresh)
          await fresh.goto(path)
          await expect(main(fresh).getByText('لم نجد هذا الطلب.')).toBeVisible()
          await expect(main(fresh).getByRole('link', { name: 'العودة إلى الطلبات' })).toBeVisible()
          expect(rpc.count('order_detail'), path).toBe(0)
          await fresh.close()
        }
      })

      test('a failed or unreadable view says it could not load, and «تحديث» reads it again', async ({ page }) => {
        await answer(page, 'order_detail', serverError)
        await page.goto(viewOf(s.mixed))
        await expect(main(page).getByText(LOAD_FAILED)).toBeVisible()
        await expect(main(page).locator('section')).toHaveCount(0)
        await page.unroute('**/rest/v1/rpc/order_detail')
        // A reply that is not an order: never a half-drawn one.
        await answer(page, 'order_detail', { body: { ok: true, order: { id: s.mixed.id }, items: [] } })
        await button(main(page), 'تحديث').click()
        await expect(main(page).getByText(LOAD_FAILED)).toBeVisible()
        await expect(main(page).locator('section')).toHaveCount(0)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('الطلب')
        await page.unroute('**/rest/v1/rpc/order_detail')
        await button(main(page), 'تحديث').click()
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.mixed.number)
        await expect(section(page, 'العناصر')).toBeVisible()
      })

      test('the owner’s disputes and audit rows are drawn, read-only, with their codes left to right', async ({ page }) => {
        // What no seed makes cheaply (a dispute is append-only): the real reply with one dispute and one more audit row added.
        await page.route('**/rest/v1/rpc/order_detail', async (route) => {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route.request()) })
          const response = await route.fetch()
          const json = (await response.json()) as Record<string, unknown>
          json.disputes = [
            {
              id: randomUUID(),
              kind: 'chargeback',
              providerRef: 'CB-2026-0007',
              seq: 2,
              attemptId: null,
              reviewPaymentId: null,
              environment: 'test',
              amount: 4500,
              direction: 'against_seller',
              occurredOn: '2026-10-02',
              reason: 'اعتراض من حامل البطاقة',
              resolution: 'سُحب الملف',
              decision: 'entitlement_revoked',
              itemIds: [],
              createdAt: '2026-10-02T09:00:00+00:00',
            },
          ]
          // A status the screen has no word for is shown as its code, never blank.
          const attempts = json.attempts as Array<Record<string, unknown>>
          attempts[0]!.status = 'paused'
          json.audit = [
            { id: 99999, at: '2026-10-03T08:00:00+00:00', actor: null, action: 'refund.requested', entity: 'refund', entityId: null, summary: { amount: 4500, orderNumber: s.mixed.number } },
            ...(json.audit as unknown[]),
          ]
          return route.fulfill({ response, json })
        })
        await page.goto(viewOf(s.mixed))
        await expect(section(page, 'الدفع').locator('span[dir="ltr"]', { hasText: 'paused' })).toBeVisible()
        const disputes = section(page, 'النزاعات')
        await expect(disputes.locator('span[dir="ltr"]', { hasText: 'CB-2026-0007' })).toBeVisible()
        await expect(disputes).toContainText('التسلسل: 2')
        await expect(disputes).toContainText(`المبلغ: ${formatMoney(4500)}`)
        // The words round 11b gives the kind, the direction and the decision (a value it has none for stays its code).
        await expect(disputes).toContainText('النوع: اعتراض بطاقة')
        await expect(disputes).toContainText('الاتجاه: على البائع')
        await expect(disputes).toContainText('القرار: سحب الملفات')
        await expect(disputes).toContainText('اعتراض من حامل البطاقة')
        await expect(disputes).toContainText('سُحب الملف')
        await expect(disputes.getByRole('button')).toHaveCount(0)
        const audit = section(page, 'السجل')
        await expect(audit.locator('tbody tr').first().locator('td[data-label="الإجراء"] span[dir="ltr"]')).toHaveText('refund.requested')
        await expect(audit.locator('tbody tr').first().locator('td[data-label="التفاصيل"]')).toContainText(s.mixed.number)
        await expectNoOverflow(page, 'order view with disputes', width)
      })

      test('fulfilment: a form refusal, the signed line refused before its dedication then shipped after «تم الإهداء», delivery, and one request for a double press', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, physical, signed } = s.ship
        await page.goto(viewOf(order))
        const shipping = section(page, 'الشحن')
        const physicalBox = lineBox(shipping, physical)
        const signedBox = lineBox(shipping, signed)
        const carrier = shipping.getByLabel('شركة الشحن', { exact: true })
        const tracking = shipping.getByLabel('رقم التتبع', { exact: true })
        await expect(statusLine(page)).toHaveText('')
        await expect(alertLine(page)).toHaveText('')

        // «تم الإهداء» is offered only while a chosen line is signed and not yet done.
        await expect(button(shipping, 'تم الإهداء')).toHaveCount(0)
        await physicalBox.check()
        await expect(button(shipping, 'تم الإهداء')).toHaveCount(0)
        await signedBox.check()
        await expect(button(shipping, 'تم الإهداء')).toBeVisible()

        // Shipping with no carrier and no tracking is refused by the form: no request.
        await button(shipping, 'تم الشحن').click()
        await expect(alertLine(page)).toHaveText('أدخل شركة الشحن ورقم التتبع.')
        await expect(alertLine(page)).toBeFocused()
        expect(rpc.count('fulfillment_update')).toBe(0)
        await carrier.fill('SMSA')
        await button(shipping, 'تم الشحن').click()
        await expect(alertLine(page)).toHaveText('أدخل شركة الشحن ورقم التتبع.')
        expect(rpc.count('fulfillment_update')).toBe(0)

        // Both lines, before the dedication: the function refuses all of it and names the signed line; nothing moved.
        await tracking.fill(`TRK-${randomUUID().slice(0, 8)}`)
        await button(shipping, 'تم الشحن').click()
        await expect(alertLine(page)).toContainText('أكمل الإهداء قبل الشحن.')
        await expect(alertLine(page)).toContainText(signed.name)
        await expect(alertLine(page)).not.toContainText(physical.name)
        await expect(alertLine(page)).toBeFocused()
        await expect(statusLine(page)).toHaveText('')
        expect(rpc.count('fulfillment_update')).toBe(1)
        const [physicalItem, signedItem] = order.items
        expect(rpc.bodies('fulfillment_update')[0]).toMatchObject({ p_order: order.id, p_state: 'shipped', p_carrier: 'SMSA', p_dedication_done: null })
        expect(rpc.bodies('fulfillment_update')[0]!.p_item_ids).toEqual(expect.arrayContaining([physicalItem!.id, signedItem!.id]))
        expect((await stateOf(physicalItem!.id)).state).toBe('preparing')
        expect((await stateOf(signedItem!.id)).state).toBe('preparing')

        // «تم الإهداء» on the signed line ticks its checklist and moves nothing.
        await physicalBox.uncheck()
        await button(shipping, 'تم الإهداء').click()
        await expect(statusLine(page)).toHaveText('تم التحديث.')
        await expect(statusLine(page)).toBeFocused()
        await expect(alertLine(page)).toHaveText('')
        expect(rpc.bodies('fulfillment_update')[1]).toMatchObject({ p_state: 'preparing', p_dedication_done: true, p_carrier: null, p_tracking: null, p_item_ids: [signedItem!.id] })
        await expect(shippingRow(shipping, signed).locator('td[data-label="الإهداء"]')).toHaveText('نعم')
        await expect(button(shipping, 'تم الإهداء')).toHaveCount(0)
        expect(await stateOf(signedItem!.id)).toMatchObject({ state: 'preparing', dedication_done: true })

        // Both lines now ship: the order is read again, and the rows say what it says.
        await physicalBox.check()
        await button(shipping, 'تم الشحن').click()
        await expect(statusLine(page)).toHaveText('تم التحديث.')
        await expect(shipping.locator('td[data-label="الحالة"]')).toHaveText(['شُحن', 'شُحن'])
        await expect(shipping.locator('td[data-label="شركة الشحن"]')).toHaveText(['SMSA', 'SMSA'])
        await expect(shipping.locator('td[data-label="رقم التتبع"] span[dir="ltr"]')).toHaveCount(2)
        await expect(shipping.locator('td[data-label="وقت الشحن"]').first()).not.toHaveText('')
        await expect(signedBox).not.toBeChecked()
        await expect(carrier).toHaveValue('')
        expect(await stateOf(physicalItem!.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA' })
        expect(await stateOf(signedItem!.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA' })
        // One mail of the shipment, queued by the function.
        expect(await h.rows("select 1 from finance.email_outbox where kind = 'order_shipped' and payload ->> 'orderId' = $1", [order.id])).toHaveLength(1)

        // A double press sends one request. The answer is held back so that the second press lands while the first is in flight.
        let delivered = 0
        await page.route('**/rest/v1/rpc/fulfillment_update', async (route) => {
          if (route.request().method() === 'POST') delivered += 1
          await new Promise((resolve) => setTimeout(resolve, 600))
          await route.continue()
        })
        await physicalBox.check()
        await signedBox.check()
        await button(shipping, 'تم التسليم').dblclick()
        await expect(button(shipping, 'تم التسليم')).toBeDisabled()
        await expect(statusLine(page)).toHaveText('تم التحديث.')
        await expect(shipping.locator('td[data-label="الحالة"]')).toHaveText(['سُلِّم', 'سُلِّم'])
        expect(delivered).toBe(1)
        expect(rpc.count('fulfillment_update')).toBe(4)
        expect((await stateOf(physicalItem!.id)).state).toBe('delivered')
        expect((await stateOf(signedItem!.id)).state).toBe('delivered')

        // Delivering again changes nothing, and says so.
        await page.unroute('**/rest/v1/rpc/fulfillment_update')
        await physicalBox.check()
        await button(shipping, 'تم التسليم').click()
        await expect(statusLine(page)).toHaveText('لا تغيير.')
        // Shipping what was delivered is not a forward move: the sentence of the refusal and the line's title.
        await carrier.fill('SMSA')
        await tracking.fill('X1')
        await button(shipping, 'تم الشحن').click()
        await expect(alertLine(page)).toContainText('لا تنتقل هذه العناصر إلى هذه الحالة.')
        await expect(alertLine(page)).toContainText(physical.name)
        expect(problems).toEqual([])
      })

      test('a refusal for lack of rights, a server error and a reply that is not one are said as they are, and the order is not changed', async ({ page }) => {
        await page.goto(viewOf(s.mixed))
        const shipping = section(page, 'الشحن')
        await lineBox(shipping, s.physical).check()
        await shipping.getByLabel('شركة الشحن', { exact: true }).fill('SMSA')
        await shipping.getByLabel('رقم التتبع', { exact: true }).fill('MOCK-1')
        for (const [reply, expected] of [
          [{ status: 403, body: { code: '42501', message: 'permission denied', details: null, hint: null } }, NO_PERMISSION],
          [serverError, SAVE_FAILED],
          [{ status: 200, body: { ok: 'maybe' } }, SAVE_FAILED],
          [{ status: 200, body: { ok: false, code: 'SOMETHING_NEW' } }, SAVE_FAILED],
        ] as const) {
          await answer(page, 'fulfillment_update', reply)
          await button(shipping, 'تم الشحن').click()
          await expect(alertLine(page)).toHaveText(expected)
          await expect(alertLine(page)).toBeFocused()
          await expect(statusLine(page)).toHaveText('')
          await page.unroute('**/rest/v1/rpc/fulfillment_update')
        }
        // It was a mock, not the stack: nothing moved.
        expect((await stateOf(s.mixed.items[0]!.id)).state).toBe('preparing')
      })

      test('a return: the owner accepts it with a note, then receives it and puts one of two units back on the shelf', async ({ page }) => {
        const problems = watchProblems(page)
        const { order, variant: goods, acceptId } = s.returnOwner
        await page.goto(viewOf(order))
        const request = card(page, 'سبب الإرجاع الأول')
        await expect(request).toContainText('الحالة: مطلوب')
        await expect(request).toContainText(`${goods.name} × 2`)
        await expect(request).toContainText('وقت الطلب:')
        // Requested: the decision and its note; no restock yet.
        await expect(request.getByLabel('يعود إلى المخزون')).toHaveCount(0)
        await expect(button(request, 'تم الاستلام')).toHaveCount(0)
        await request.getByLabel('ملاحظة (اختياري)').fill('الصندوق سليم')
        await button(request, 'قبول').click()
        await expect(statusLine(page)).toHaveText('تم تسجيل القرار.')
        await expect(statusLine(page)).toBeFocused()
        await expect(request).toContainText('الحالة: مقبول')
        await expect(request).toContainText('ملاحظة الفريق: الصندوق سليم')
        expect(await h.row('select state, staff_note from finance.return_requests where id = $1', [acceptId])).toMatchObject({ state: 'approved', staff_note: 'الصندوق سليم' })

        // Approved: the owner's restock field, 0 by default and at most the quantity returned.
        const restock = request.getByLabel('يعود إلى المخزون')
        await expect(restock).toHaveCount(1)
        await expect(restock).toHaveValue('0')
        await expect(restock).toHaveAttribute('max', '2')
        await expect(restock).toHaveAttribute('min', '0')
        await expect(button(request, 'قبول')).toHaveCount(0)
        const before = await stockOf(goods.id)
        await restock.fill('1')
        await button(request, 'تم الاستلام').click()
        await expect(statusLine(page)).toContainText('تم تسجيل الاستلام.')
        await expect(statusLine(page)).toContainText(`أُعيد إلى المخزون: ${goods.sku} من ${formatNumber(before)} إلى ${formatNumber(before + 1)}`)
        await expect(statusLine(page)).toBeFocused()
        await expect(request).toContainText('الحالة: مُستلَم')
        await expect(request).toContainText(`أُعيد إلى المخزون: ${goods.name} × 1`)
        await expect(button(request, 'تم الاستلام')).toHaveCount(0)
        // The stock rose by what the owner put back, and the return says what was.
        expect(await stockOf(goods.id)).toBe(before + 1)
        expect((await h.row('select restocked from finance.return_requests where id = $1', [acceptId])).restocked).toEqual([{ itemId: order.items[0]!.id, quantity: 1 }])
        expect(problems).toEqual([])
      })

      test('a return still being decided: «رفض», a decision made too late, the layout of its card', async ({ page }) => {
        const { order, staleId, declineId } = s.returnOwner
        await page.goto(viewOf(order))
        const stale = card(page, 'سبب الإرجاع المتأخر')
        const declined = card(page, 'سبب الإرجاع المرفوض')
        await expect(stale).toContainText('الحالة: مطلوب')
        await expect(button(declined, 'قبول')).toBeVisible()
        await expect(button(declined, 'رفض')).toBeVisible()
        await expectNoOverflow(page, 'order view with returns', width)
        await expectTargets(page, 'order view with returns')
        await shoot(page, 'order-return', width)

        // «رفض» with no note: the state moves and no note is kept.
        await button(declined, 'رفض').click()
        await expect(statusLine(page)).toHaveText('تم تسجيل القرار.')
        await expect(declined).toContainText('الحالة: مرفوض')
        await expect(button(declined, 'قبول')).toHaveCount(0)
        expect(await h.row('select state, staff_note from finance.return_requests where id = $1', [declineId])).toMatchObject({ state: 'rejected', staff_note: null })

        // Another session accepted the other one meanwhile: the press is refused with its state, and the card shows that state now.
        await h.postgres.query("update finance.return_requests set state = 'approved' where id = $1", [staleId])
        await button(stale, 'رفض').click()
        await expect(alertLine(page)).toHaveText('لا يمكن هذا الإجراء؛ حالة طلب الإرجاع الآن: مقبول.')
        await expect(alertLine(page)).toBeFocused()
        await expect(stale).toContainText('الحالة: مقبول')
        await expect(button(stale, 'رفض')).toHaveCount(0)
        await expect(button(stale, 'تم الاستلام')).toBeVisible()
        expect((await h.row('select state from finance.return_requests where id = $1', [staleId])).state).toBe('approved')
      })

      test('a fully refunded line still being prepared is shown but cannot be chosen, and the order leaves «للشحن» once its other line ships', async ({ page }) => {
        const { order, refunded, open } = s.partial
        // The list counts what is left to ship: one line of the two, and what was refunded.
        await page.goto('/admin/orders')
        await expect(rowOf(page, order.number).locator('td[data-label="للشحن"]')).toHaveText('1')
        await expect(rowOf(page, order.number).locator('td[data-label="المُعاد"]')).toHaveText(formatMoney(order.items[0]!.paid))
        await page.goto(viewOf(order))
        const line = (goods: Variant): Locator =>
          section(page, 'العناصر').locator('tbody tr').filter({ has: page.locator('td[data-label="الرمز"]', { hasText: new RegExp(`^${goods.sku}$`) }) })
        await expect(line(refunded).locator('td[data-label="المُعاد"]')).toContainText('مُعاد بالكامل')
        await expect(line(open).locator('td[data-label="المُعاد"]')).not.toContainText('مُعاد بالكامل')
        const shipping = section(page, 'الشحن')
        await expect(shipping.locator('tbody tr')).toHaveCount(2)
        await expect(lineBox(shipping, refunded)).toBeDisabled()
        await expect(lineBox(shipping, open)).toBeEnabled()
        // The other line ships; the refunded one stays as it was.
        await lineBox(shipping, open).check()
        await shipping.getByLabel('شركة الشحن', { exact: true }).fill('SMSA')
        await shipping.getByLabel('رقم التتبع', { exact: true }).fill('PART-1')
        await button(shipping, 'تم الشحن').click()
        await expect(statusLine(page)).toHaveText('تم التحديث.')
        await expect(shippingRow(shipping, open).locator('td[data-label="الحالة"]')).toHaveText('شُحن')
        await expect(shippingRow(shipping, refunded).locator('td[data-label="الحالة"]')).toHaveText('قيد التجهيز')
        expect((await stateOf(order.items[0]!.id)).state).toBe('preparing')
        // Nothing is left to ship: the order is no longer in «للشحن», while one with a line to prepare still is.
        await page.goto('/admin/orders')
        await button(main(page).getByRole('group', { name: 'تصفية الطلبات' }), 'للشحن').click()
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(rowOf(page, order.number)).toHaveCount(0)
      })

      test('shipping an order that was refunded meanwhile is refused as unpaid, and the screen then shows what the order is', async ({ page }) => {
        const { order, goods } = s.late
        await page.goto(viewOf(order))
        const shipping = section(page, 'الشحن')
        await lineBox(shipping, goods).check()
        await shipping.getByLabel('شركة الشحن', { exact: true }).fill('SMSA')
        await shipping.getByLabel('رقم التتبع', { exact: true }).fill('LATE-1')
        // Another session refunds the whole order meanwhile; this page still has its controls.
        await h.refundFully(order, owner.userId)
        await button(shipping, 'تم الشحن').click()
        await expect(alertLine(page)).toHaveText('الطلب غير مدفوع، فلا يُشحن.')
        await expect(alertLine(page)).toBeFocused()
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مُعاد')
        await expect(main(page).getByRole('checkbox')).toHaveCount(0)
        await expect(button(main(page), 'تم الشحن')).toHaveCount(0)
        expect((await stateOf(order.items[0]!.id)).state).toBe('preparing')
      })

      test('a preorder line shows its delivery date and note, and has no restock field when it is returned', async ({ page }) => {
        const { order, preorder, normal, returnId } = s.preorder
        await page.goto(viewOf(order))
        const line = (goods: Variant): Locator =>
          section(page, 'العناصر').locator('tbody tr').filter({ has: page.locator('td[data-label="الرمز"]', { hasText: new RegExp(`^${goods.sku}$`) }) })
        await expect(line(preorder)).toContainText(`طلب مسبق: يُسلَّم في ${formatDate('2030-01-01')}`)
        await expect(line(preorder)).toContainText('يصلك بعد الطباعة')
        await expect(line(normal)).not.toContainText('طلب مسبق')
        // Both lines are in the approved return; only the ordinary one can go back on the shelf.
        const request = card(page, 'سبب الطلب المسبق')
        await expect(request).toContainText('الحالة: مقبول')
        await expect(request).toContainText(`${preorder.name} × 2`)
        await expect(request).toContainText(`${normal.name} × 2`)
        const fields = request.getByLabel('يعود إلى المخزون')
        await expect(fields).toHaveCount(1)
        await expect(request.getByLabel(`يعود إلى المخزون: ${normal.name}`, { exact: true })).toHaveCount(1)
        const before = await stockOf(normal.id)
        await fields.fill('2')
        await button(request, 'تم الاستلام').click()
        await expect(statusLine(page)).toContainText(`أُعيد إلى المخزون: ${normal.sku} من ${formatNumber(before)} إلى ${formatNumber(before + 2)}`)
        await expect(statusLine(page)).not.toContainText(preorder.sku)
        // The preorder's units are not stock: nothing of it came back, and the return says so.
        expect(await stockOf(preorder.id)).toBe(0)
        expect(await stockOf(normal.id)).toBe(before + 2)
        expect((await h.row('select restocked from finance.return_requests where id = $1', [returnId])).restocked).toEqual([{ itemId: order.items[1]!.id, quantity: 2 }])
      })

      test('«إكمال الطلب» is refused while a refund of the order is in flight, and says so when the order was completed from another session', async ({ page }) => {
        const { order, variant: goods, attemptId } = s.stuckRefund
        const line = await h.row('select id, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1', [order.id])
        const key = randomUUID()
        const asked = await h.call('refund_request', {
          p_actor: owner.userId,
          p_order: order.id,
          p_attempt: attemptId,
          p_review_payment: null,
          p_amount: Number(line.paid),
          p_reason: 'استرداد قيد المعالجة',
          p_allocation: { items: [{ itemId: line.id, amount: Number(line.paid) }] },
          p_idempotency_key: key,
          p_request_hash: sha256(`hash:${key}`),
          p_return: null,
          p_provider_refunded: 0,
        })
        expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
        await page.goto(viewOf(order))
        const resolution = section(page, 'إكمال الطلب')
        await button(resolution, 'إكمال الطلب').click()
        await button(resolution, 'تأكيد إكمال الطلب').click()
        await expect(alertLine(page)).toHaveText('استرداد قيد المعالجة؛ أعد المحاولة بعد دقائق.')
        // The refund the screen lists is the one in flight.
        await expect(section(page, 'الاستردادات').locator('td[data-label="الحالة"]')).toHaveText('قيد الإرسال')
        await expect(section(page, 'الاستردادات').locator('td[data-label="المبلغ"]')).toHaveText(formatMoney(Number(line.paid)))

        // The refund fails, the stock is raised and another session completes the order.
        expect(await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'failed', p_provider_refunded: 0, p_error: 'TEST' })).toMatchObject({ ok: true, status: 'failed' })
        await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [goods.id])
        const db = await staffDb(owner.userId)
        expect(await pgRpc(db)('order_resolve', { p_order: order.id })).toMatchObject({ ok: true, status: 'paid' })
        await db.end()
        // This page still offers it: the answer is what the order is now, and the screen shows that.
        await button(resolution, 'إكمال الطلب').click()
        await button(resolution, 'تأكيد إكمال الطلب').click()
        await expect(alertLine(page)).toHaveText('لا يمكن إكمال هذا الطلب؛ حالته الآن: مدفوع.')
        await expect(alertLine(page)).toBeFocused()
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مدفوع')
        await expect(main(page).getByRole('heading', { level: 2, name: 'إكمال الطلب' })).toHaveCount(0)
      })

      test('a paid order whose stock was gone: «إكمال الطلب» asks twice, is refused while the stock is short, and completes once it is raised', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, variant: goods } = s.stuck
        await page.goto(viewOf(order))
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مدفوع: يحتاج حلًا')
        const resolution = section(page, 'إكمال الطلب')
        await expect(resolution).toContainText('يُخصم المخزون للعناصر غير المعادة، وتُمنح الملفات، ويُرسل إيصال.')
        // No shipping controls before it is paid in full, and no confirmation before the first press.
        await expect(main(page).getByRole('checkbox')).toHaveCount(0)
        await expect(button(resolution, 'تأكيد إكمال الطلب')).toHaveCount(0)
        await button(resolution, 'إكمال الطلب').click()
        await expect(button(resolution, 'تأكيد إكمال الطلب')).toBeVisible()
        // The confirmation takes the focus itself (its sentence), never «تأكيد إكمال الطلب»: a held Enter must not complete the order (R11B-4).
        await expect(resolution.getByText('يُخصم المخزون للعناصر غير المعادة، وتُمنح الملفات، ويُرسل إيصال.')).toBeFocused()
        await expect(button(resolution, 'تأكيد إكمال الطلب')).not.toBeFocused()
        expect(rpc.count('order_resolve')).toBe(0)

        // Confirmed while the stock is short: refused in the function's words, nothing changed.
        await button(resolution, 'تأكيد إكمال الطلب').click()
        await expect(alertLine(page)).toHaveText('المخزون لا يكفي لعنصر في هذا الطلب؛ عدّل المخزون أو أعد مبلغ العنصر أولًا.')
        await expect(alertLine(page)).toBeFocused()
        expect(rpc.count('order_resolve')).toBe(1)
        expect((await h.row('select status from finance.orders where id = $1', [order.id])).status).toBe('paid_needs_resolution')
        await expect(button(resolution, 'تأكيد إكمال الطلب')).toHaveCount(0)

        // The owner raises the stock (the product form does that); the resolution then goes through.
        await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [goods.id])
        await button(resolution, 'إكمال الطلب').click()
        await button(resolution, 'تأكيد إكمال الطلب').click()
        await expect(statusLine(page)).toHaveText('تم إكمال الطلب.')
        await expect(statusLine(page)).toBeFocused()
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مدفوع')
        await expect(main(page).locator('ul').first()).not.toContainText('يحتاج حلًا')
        await expect(main(page).getByRole('heading', { level: 2, name: 'إكمال الطلب' })).toHaveCount(0)
        // What `paid` does: the stock is taken, the line is to prepare and can be shipped from this screen now.
        expect(await stockOf(goods.id)).toBe(4)
        expect((await h.row('select status from finance.orders where id = $1', [order.id])).status).toBe('paid')
        await expect(section(page, 'الشحن').locator('td[data-label="الحالة"]')).toHaveText('قيد التجهيز')
        await expect(section(page, 'الشحن').getByRole('checkbox')).toHaveCount(1)
        expect(problems).toEqual([])
      })

      test('review payments: listed with their reason, closed by the owner with a reason, and a payment closed meanwhile is said so', async ({ page }) => {
        const problems = watchProblems(page)
        const rpc = watchRpc(page)
        const { order, payments } = s.reviewed
        await page.goto(viewOf(order))
        await expect(main(page).getByRole('heading', { level: 3, name: 'دفعات قيد المراجعة' })).toBeVisible()
        const first = card(page, payments[0]!)
        const second = card(page, payments[1]!)
        await expect(first).toContainText('السبب: دفعة ثانية على فاتورة مدفوعة')
        await expect(first).toContainText(`المبلغ: ${formatMoney(order.total)}`)
        await expect(first.locator('span[dir="ltr"]', { hasText: payments[0]! })).toBeVisible()
        await expect(first).toContainText('الإغلاق: مفتوحة')
        await expect(first).toContainText('وقت الإنشاء:')
        await expect(page.getByRole('button', { name: 'إغلاق المراجعة' })).toHaveCount(3)

        // A reason is needed, and `refunded` is not one: the form refuses both, with no request.
        await button(first, 'إغلاق المراجعة').click()
        await expect(alertLine(page)).toHaveText('أدخل سبب الإغلاق.')
        await expect(alertLine(page)).toBeFocused()
        await first.getByLabel('سبب الإغلاق').fill('refunded')
        await button(first, 'إغلاق المراجعة').click()
        await expect(alertLine(page)).toHaveText('لا يُقبل هذا السبب؛ اكتب سببًا آخر.')
        expect(rpc.count('review_close')).toBe(0)

        // Closed with a reason: the card says so, its button goes, the other reviews are untouched, the audit has the row.
        await first.getByLabel('سبب الإغلاق').fill('عكسها البنك')
        await button(first, 'إغلاق المراجعة').click()
        await expect(statusLine(page)).toHaveText('أُغلقت المراجعة.')
        await expect(statusLine(page)).toBeFocused()
        await expect(alertLine(page)).toHaveText('')
        await expect(first).toContainText('الإغلاق: أُغلقت')
        await expect(first).toContainText('عكسها البنك')
        await expect(button(first, 'إغلاق المراجعة')).toHaveCount(0)
        await expect(button(second, 'إغلاق المراجعة')).toBeVisible()
        await expect(page.getByRole('button', { name: 'إغلاق المراجعة' })).toHaveCount(2)
        expect(rpc.bodies('review_close')).toEqual([{ p_payment: payments[0], p_reason: 'عكسها البنك' }])
        expect(await h.row('select closed_reason from finance.payment_reviews where provider_payment_id = $1', [payments[0]])).toMatchObject({ closed_reason: 'عكسها البنك' })
        await expect(section(page, 'السجل').locator('span[dir="ltr"]', { hasText: 'payment.review_closed' })).toBeVisible()

        // Closed behind this page's back: the press is answered «already closed» and the card shows what it is now.
        await h.postgres.query("update finance.payment_reviews set closed_at = now(), closed_reason = 'أُغلقت من جلسة أخرى' where provider_payment_id = $1", [payments[1]])
        await second.getByLabel('سبب الإغلاق').fill('سبب متأخر')
        await button(second, 'إغلاق المراجعة').click()
        await expect(alertLine(page)).toHaveText('أُغلقت هذه المراجعة من قبل.')
        await expect(alertLine(page)).toBeFocused()
        await expect(second).toContainText('أُغلقت من جلسة أخرى')
        await expect(button(second, 'إغلاق المراجعة')).toHaveCount(0)
        expect(problems).toEqual([])
      })

      test('the home: the counts of the orders section are the ones the function answers, with the low stock listed', async ({ page }) => {
        const problems = watchProblems(page)
        // One variant of this run is low on stock.
        await h.postgres.query('update public.product_variants set low_stock_threshold = 1000 where id = $1', [s.physical.id])
        const db = await staffDb(owner.userId)
        const alerts = (await pgRpc(db)('orders_alerts', {})) as Record<string, number> & { lowStock: Array<{ sku: string; title: string; stock: number; threshold: number }> }
        await db.end()
        const rpc = watchRpc(page)
        await page.goto('/admin')
        const orders = section(page, 'الطلبات')
        await expect(orders).toBeVisible()
        // The three counts, the owner's fourth, in this order.
        const reconcile = alerts.uncertainRefunds! + alerts.unverifiedAttempts! + alerts.exhaustedEvents! + alerts.externalRefunds!
        await expect(orders.locator('ul').first().locator('li')).toHaveText([
          `تحتاج حلًا: ${formatNumber(alerts.needsResolution!)}`,
          `للشحن: ${formatNumber(alerts.toShip!)}`,
          `دفعات قيد المراجعة: ${formatNumber(alerts.review!)}`,
          `تحتاج مطابقة: ${formatNumber(reconcile)}`,
        ])
        // The low stock: up to ten as «title (SKU): stock من حد threshold», and the rest counted.
        expect(alerts.lowStock.some((low) => low.sku === s.physical.sku)).toBe(true)
        await expect(orders.getByRole('heading', { level: 3, name: 'مخزون منخفض' })).toBeVisible()
        const shown = alerts.lowStock.slice(0, 10).map((low) => `${low.title} (${low.sku}): ${formatNumber(low.stock)} من حد ${formatNumber(low.threshold)}`)
        if (alerts.lowStock.length > 10) shown.push(`و${formatNumber(alerts.lowStock.length - 10)} غيرها`)
        await expect(orders.locator('ul').nth(1).locator('li')).toHaveText(shown)
        await expect(orders.getByRole('link', { name: 'فتح الطلبات' })).toHaveAttribute('href', '/admin/orders')
        expect(rpc.count('orders_alerts')).toBe(1)
        await expect(main(page).getByText('تعذّر التحميل')).toHaveCount(0)
        await expectNoOverflow(page, 'home', width)
        await expectTargets(page, 'the orders section of the home', orders)
        await shoot(page, 'home-orders', width)
        expect(problems).toEqual([])
      })

      test('the home says the orders could not load, never zero; the list says it too', async ({ page }) => {
        await answer(page, 'orders_alerts', serverError)
        await page.goto('/admin')
        await expect(section(page, 'الطلبات').getByText('تعذّر التحميل')).toBeVisible()
        await expect(section(page, 'الطلبات').locator('ul')).toHaveCount(0)
        await expect(section(page, 'الطلبات').getByRole('link', { name: 'فتح الطلبات' })).toBeVisible()
        await page.goto('/admin/orders')
        await expect(main(page).getByText(LOAD_FAILED).first()).toBeVisible()
        // The list itself still loads: the alerts line failed, not the orders.
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        // «تحديث» asks the alerts again: once the function answers, the counts line is there.
        await page.unroute('**/rest/v1/rpc/orders_alerts')
        await main(page).getByRole('button', { name: 'تحديث' }).click()
        await expect(main(page).getByText(/تحتاج حلًا: /)).toBeVisible()
        await expect(main(page).getByRole('button', { name: 'تحديث' })).toHaveCount(0)
      })

      test('the list at its width: no sideways page, 44px targets, the nav entry after «المتجر», a screenshot', async ({ page }) => {
        await page.goto('/admin/orders')
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expectNoOverflow(page, 'orders list', width)
        await expectTargets(page, 'orders list')
        await shoot(page, 'orders-list', width)
        const links = await page.locator('nav[aria-label="لوحة التحكم"] a').allTextContents()
        expect(links.indexOf('الطلبات')).toBe(links.indexOf('المتجر') + 1)
      })
    })

    // ================================================================================================= operations
    test.describe('an operations member', () => {
      test.use({ storageState: STATES.operations })

      test('sees the orders and the alerts line without the owner’s count, and an order without the owner’s parts', async ({ page }) => {
        const problems = watchProblems(page)
        await page.goto('/admin/orders')
        await expect(main(page).getByText(/^تحتاج حلًا: [\d,]+ · للشحن: [\d,]+ · دفعات قيد المراجعة: [\d,]+$/)).toBeVisible()
        await expect(main(page).getByText('تحتاج مطابقة')).toHaveCount(0)
        await expect(rowOf(page, s.mixed.number)).toBeVisible()
        await expect(page.locator('nav').getByRole('link', { name: 'الطلبات', exact: true })).toBeVisible()

        const reply = page.waitForResponse((response) => response.url().includes('/rpc/order_detail'))
        await page.goto(viewOf(s.reviewed.order))
        const detail = (await (await reply).json()) as Record<string, unknown>
        // The operations reply has neither of the owner's keys.
        expect(Object.keys(detail)).not.toContain('disputes')
        expect(Object.keys(detail)).not.toContain('audit')
        await expect(main(page).locator('h2')).toHaveText(['العميل والتوصيل', 'العناصر', 'الدفع', 'الملفات'])
        await expect(main(page).getByRole('heading', { level: 3, name: 'دفعات قيد المراجعة' })).toBeVisible()
        // Every review is shown, open ones with no closing control: it is the owner's.
        const open = card(page, s.reviewed.payments[2]!)
        await expect(open).toContainText('الإغلاق: مفتوحة')
        await expect(open.locator('span[dir="ltr"]', { hasText: s.reviewed.payments[2]! })).toBeVisible()
        await expect(main(page).getByRole('button', { name: 'إغلاق المراجعة' })).toHaveCount(0)
        await expect(main(page).getByLabel('سبب الإغلاق')).toHaveCount(0)
        expect(problems).toEqual([])
      })

      test('ships lines, decides a return and receives one with no restock field, and may not resolve an order', async ({ page }) => {
        const rpc = watchRpc(page)
        // Fulfilment is theirs too.
        await page.goto(viewOf(s.mixed))
        const shipping = section(page, 'الشحن')
        await lineBox(shipping, s.physical).check()
        await shipping.getByLabel('شركة الشحن', { exact: true }).fill('Aramex')
        await shipping.getByLabel('رقم التتبع', { exact: true }).fill('OPS-1')
        await button(shipping, 'تم الشحن').click()
        await expect(statusLine(page)).toHaveText('تم التحديث.')
        await expect(shippingRow(shipping, s.physical).locator('td[data-label="الحالة"]')).toHaveText('شُحن')

        // Returns: the request rejected by operations, then the approved one received with no restock field and none sent.
        const { order, variant: goods, rejectId, receiveId } = s.returnOps
        await page.goto(viewOf(order))
        const toReject = card(page, 'سبب الرفض')
        const toReceive = card(page, 'سبب الاستلام')
        await expect(toReject).toContainText('الحالة: مطلوب')
        await expect(toReceive).toContainText('الحالة: مقبول')
        await expect(main(page).getByLabel('يعود إلى المخزون')).toHaveCount(0)
        await button(toReject, 'رفض').click()
        await expect(statusLine(page)).toHaveText('تم تسجيل القرار.')
        await expect(toReject).toContainText('الحالة: مرفوض')
        const before = await stockOf(goods.id)
        await button(toReceive, 'تم الاستلام').click()
        await expect(statusLine(page)).toHaveText('تم تسجيل الاستلام.')
        await expect(toReceive).toContainText('الحالة: مُستلَم')
        expect(rpc.bodies('return_receive')).toEqual([{ p_return: receiveId, p_restock: [] }])
        expect(await stockOf(goods.id)).toBe(before)
        expect((await h.row('select restocked from finance.return_requests where id = $1', [receiveId])).restocked).toEqual([])
        expect((await h.row('select state from finance.return_requests where id = $1', [rejectId])).state).toBe('rejected')

        // An order waiting for resolution: the sentence and the button are the owner's.
        await page.goto(viewOf(s.stuckOps))
        await expect(main(page).locator('ul').first()).toContainText('الحالة: مدفوع: يحتاج حلًا')
        await expect(main(page).getByRole('heading', { level: 2, name: 'إكمال الطلب' })).toHaveCount(0)
        await expect(main(page).getByRole('button', { name: 'إكمال الطلب' })).toHaveCount(0)
        expect(rpc.count('order_resolve')).toBe(0)
      })

      test('the home counts three things, not the owner’s fourth', async ({ page }) => {
        await page.goto('/admin')
        const orders = section(page, 'الطلبات')
        await expect(orders.locator('ul').first().locator('li')).toHaveText([/^تحتاج حلًا: \d/, /^للشحن: \d/, /^دفعات قيد المراجعة: \d/])
        await expect(orders.getByText('تحتاج مطابقة')).toHaveCount(0)
        await expectNoOverflow(page, 'operations home', width)
      })
    })

    // ==================================================================================================== an editor
    test.describe('an editor', () => {
      test.use({ storageState: STATES.editor })

      test('is told there is no access, has no entry in the nav, and nothing is asked', async ({ page }) => {
        const rpc = watchRpc(page)
        await page.goto('/admin')
        await expect(page.locator('nav[aria-label="لوحة التحكم"]')).toBeVisible()
        await expect(page.locator('nav').getByRole('link', { name: 'الطلبات' })).toHaveCount(0)
        // The home has no orders section and makes no such call.
        await expect(main(page).getByRole('heading', { level: 2, name: 'المحتوى المجدول' })).toBeVisible()
        await expect(main(page).getByRole('heading', { level: 2, name: 'الطلبات' })).toHaveCount(0)
        expect(rpc.count('orders_alerts')).toBe(0)

        await page.goto('/admin/orders')
        await expect(main(page).getByText(NO_ACCESS)).toBeVisible()
        await expect(main(page).locator('table')).toHaveCount(0)
        await expect(search(page)).toHaveCount(0)
        await page.goto(viewOf(s.mixed))
        await expect(main(page).getByText(NO_ACCESS)).toBeVisible()
        await expect(main(page).locator('section')).toHaveCount(0)
        expect(rpc.count('orders_list')).toBe(0)
        expect(rpc.count('orders_alerts')).toBe(0)
        expect(rpc.count('order_detail')).toBe(0)
      })
    })
  })
}
