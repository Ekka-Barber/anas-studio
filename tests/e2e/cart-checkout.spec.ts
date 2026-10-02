// P07 e2e: the public store, cart and checkout in the browser on `next dev`
// (fixtures made here appear because dev renders pages live). The spec brings
// its own product (digital + physical + signed variants), city rate and
// coupon through the database like checkout-api.spec.ts, saves
// finance.commerce_settings in beforeAll and restores it in afterAll, and
// each test that depends on the store switch sets it itself. Screenshots land
// in store-*.png at 360 and 1440 under shotsDir('P07'): the accepted evidence
// folder only for an ACCEPTANCE_PACKAGE=P07 run, test-results/ otherwise.
//
// P08 round 4b: `create` also makes the invoice, on the Moyasar emulator that
// Playwright's webServer runs beside the dev server (`pnpm emulator`; a test
// harness, never Moyasar), so the hold view, the payment link, the return page
// and the cancel run against the real local functions. The emulator's own
// stand-in for the hosted invoice page is how a buyer pays; its `/__emulator/*`
// control routes make the failures (a dropped reply, a throttle) and the
// payments made behind the page's back.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import { Client } from 'pg'
import { expect, test, type Page } from '@playwright/test'

import { readStatus, SITE_ORIGIN } from './helpers'
import { shotsDir } from './shots'

const status = readStatus()
const CHECKOUT = `${status.FUNCTIONS_URL}/checkout`
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const slug = `e2e-store-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const couponCode = `E2ESTORE${marker}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32)
const cityKey = `e2ecity${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const buyers = `buyer-${marker}-%`
const TITLE = 'كتاب الاختبار للمتجر'
const SHOTS = shotsDir('P07')

// The Moyasar emulator, as the browser reaches it, and what a tab keeps in storage.
const EMULATOR = 'http://127.0.0.1:54390'
const CART_KEY = 'anasaq:cart:v1'
const PENDING_KEY = 'anasaq:pending-order'
const IDEMPOTENCY_KEY = 'anasaq:idempotency'
const TEST_ACCESS_KEY = 'anasaq:test-access'

// Prices no demo product or rate uses (D37's demo catalog sells at 15.00,
// 35.00, 45.00, 69.00 and 99.00 and delivers for 25.00 to 35.00), and every
// total below is distinct from every line on its page: e-book 12.40, paper
// 23.60, signed 51.70, delivery 11.30, a 10% coupon.
const EBOOK = 1240
const PAPER = 2360
const SIGNED = 5170
const FEE = 1130

// A paid journey goes browser, function, emulator and back; a cold dev compile of each page adds to it.
test.describe.configure({ timeout: 150_000 })

let db: Client
let saved: Record<string, unknown>
let productId: string
let ebookId: string
let paperId: string
let startedAt: Date
/** Policies checkoutOn() published because none were live; afterAll removes them again. */
const publishedPolicies: string[] = []

/** One row of the quote's totals: «المجموع الفرعي», «الخصم», «التوصيل» or «الإجمالي». */
function totalRow(page: Page, label: string) {
  return page.locator('dl > div', { hasText: label })
}

/** Adds the fixture line-up to the cart from the fixture product page. */
async function addFixtures(page: Page, lines: Array<{ row: string; quantity: number }>) {
  await page.goto(`/store/${slug}`)
  for (const line of lines) {
    const row = page.locator('li', { hasText: line.row })
    await row.getByLabel('الكمية').fill(String(line.quantity))
    await row.getByRole('button', { name: 'أضف إلى السلة' }).click()
    await expect(row.getByText('أُضيف إلى السلة.')).toBeVisible()
  }
}

/** The page-level and in-card overflow an owner-operations screenshot pass checks. */
async function expectNoOverflow(page: Page, label: string) {
  const { page: pageOverflow, cardOverflow } = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cardOverflow: Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>('[class*="lineCard"], [class*="variant"], [class*="form"]')].map(
        (card) => card.scrollWidth - card.clientWidth,
      ),
    ),
  }))
  expect(pageOverflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1)
  expect(cardOverflow, `${label}: card overflow`).toBeLessThanOrEqual(1)
}

/** Fills the checkout form of a physical cart and gives consent. */
async function fillCheckout(page: Page, email: string) {
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByLabel('الاسم').fill('مشترٍ')
  await page.getByLabel('رقم الجوال').fill('0501234567')
  await page.getByLabel('عنوان التوصيل').fill('تبوك شارع الرئيسي 12')
  await page.getByRole('checkbox').check()
}

/** Fills the checkout form of a digital-only cart (no phone, city or address) and gives consent. */
async function fillDigital(page: Page, email: string) {
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByLabel('الاسم').fill('مشترٍ')
  await page.getByRole('checkbox').check()
}

/** Confirms the order once the always-pass test widget has solved itself (a press before it has waits for its token). */
async function confirmOrder(page: Page) {
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()
  await submit.click()
}

/** A digital cart through the checkout form to the hold view; returns the order number. */
async function placeOrder(page: Page, email: string): Promise<string> {
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  await page.goto('/checkout')
  await expect(totalRow(page, 'الإجمالي')).toContainText('12.40 ر.س')
  await fillDigital(page, email)
  await confirmOrder(page)
  await expect(page.locator('#checkout-order-number')).toBeVisible()
  return (await page.locator('#checkout-order-number span').innerText()).trim()
}

/** What this tab keeps in sessionStorage under `key`. */
const kept = (page: Page, key: string) => page.evaluate((name) => sessionStorage.getItem(name), key)

/** A control call to the Moyasar emulator (the test harness of contract section 9). */
async function emulatorControl(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${EMULATOR}/__emulator/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status, `emulator ${path}`).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

type EmulatorInvoice = { id: string; status: string; url: string; metadata: Record<string, string> }

/** The invoices the emulator holds, in the order they were made. */
async function emulatorInvoices(): Promise<EmulatorInvoice[]> {
  const response = await fetch(`${EMULATOR}/__emulator/state`)
  return ((await response.json()) as { invoices: EmulatorInvoice[] }).invoices
}

/** Pays on the invoice page the «ادفع الآن» link leads to; the provider then sends the buyer back to the return page. */
async function payOnInvoicePage(page: Page) {
  await page.getByRole('link', { name: 'ادفع الآن' }).click()
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:54390\/invoices\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: 'دفع ناجح' }).click()
}

/** An order made with the two calls the page makes, straight at the function: one this test's browser never saw. */
async function apiOrder(email: string): Promise<{ orderNumber: string; accessToken: string; invoiceUrl: string; invoiceId: string }> {
  const call = async (body: unknown) => {
    const response = await fetch(CHECKOUT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: SITE_ORIGIN,
        'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 254) + 1}`,
      },
      body: JSON.stringify(body),
    })
    return (await response.json()) as { ok: boolean; data: any }
  }
  const lines = [{ variantId: ebookId, quantity: 1 }]
  const quoted = await call({ action: 'quote', lines })
  const revisions = (await db.query('select policy_revisions from finance.commerce_settings where id = 1')).rows[0]!.policy_revisions
  const created = await call({
    action: 'create',
    idempotencyKey: randomUUID(),
    checkoutSession: randomUUID(),
    lines,
    email,
    name: 'مشترٍ',
    policyRevisions: revisions,
    quoteHash: quoted.data.quoteHash,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  })
  expect(created.ok, JSON.stringify(created)).toBe(true)
  expect(created.data.payment.state).toBe('ready')
  const invoiceUrl = created.data.payment.url as string
  const invoice = (await emulatorInvoices()).find((entry) => entry.url === invoiceUrl)
  return {
    orderNumber: created.data.order.orderNumber,
    accessToken: created.data.accessToken,
    invoiceUrl,
    invoiceId: invoice!.id,
  }
}

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  startedAt = (await db.query<{ t: Date }>('select now() as t')).rows[0]!.t
  saved = (
    await db.query(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  ).rows[0]!

  productId = (
    await db.query<{ id: string }>(
      `insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي للاختبار', 'published') returning id`,
      [slug, TITLE],
    )
  ).rows[0]!.id
  const sku = (kind: string) => `E2E-${kind}-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const variantIds = await db.query<{ id: string; fulfillment: string }>(
    `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock) values
       ($1, $2, 'النسخة الإلكترونية', 'digital', $5, true, null),
       ($1, $3, 'النسخة الورقية', 'physical', $6, true, 10),
       ($1, $4, 'النسخة الموقعة', 'signed', $7, true, 5)
     returning id, fulfillment`,
    [productId, sku('D'), sku('P'), sku('S'), EBOOK, PAPER, SIGNED],
  )
  ebookId = variantIds.rows.find((row) => row.fulfillment === 'digital')!.id
  paperId = variantIds.rows.find((row) => row.fulfillment === 'physical')!.id
  await db.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [
    cityKey,
    `مدينة الاختبار ${marker}`,
    FEE,
  ])
  await db.query('insert into public.coupons (code, kind, percent_bp, enabled) values ($1, $2, 1000, true)', [couponCode, 'percent'])
  mkdirSync(SHOTS, { recursive: true })

  // I38: `next dev` answers a generateStaticParams page from the static
  // params it cached for that route and refreshes them in the background
  // (getStaticPaths in next/dist/server/dev/next-dev-server.js), so with
  // dynamicParams = false the first request for a slug made after the cache
  // was filled is a 404. A new worker makes a new slug, so wait until the dev
  // server has seen this one. The static export has no such cache.
  await expect
    .poll(async () => (await fetch(`${SITE_ORIGIN}/store/${slug}`)).status, { timeout: 60_000 })
    .toBe(200)
})

test.beforeEach(async () => {
  // Every browser request reaches the functions from the gateway's one
  // address, so the orders and payments of one run would trip the per-IP
  // throttles; the throttles themselves are proven in the integration tests.
  await db.query(
    "delete from finance.rate_limits where bucket in ('checkout-quote:ip', 'checkout:ip', 'checkout:all', 'payment-pay:ip', 'payment-check:ip', 'payment-callback:ip')",
  )
  // Each test starts from an empty emulator, with the configuration it started with.
  await emulatorControl('reset')
})

test.afterAll(async () => {
  // The settings first: a later failure must never leave the shared database with the test seller.
  await db.query(
    `update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_address = $3,
       seller_registration = $4, policy_revisions = $5::jsonb, version = $6, configured_at = $7, approved_by = $8
     where id = 1`,
    [
      saved.checkout_enabled,
      saved.seller_legal_name,
      saved.seller_address,
      saved.seller_registration,
      JSON.stringify(saved.policy_revisions),
      saved.version,
      saved.configured_at,
      saved.approved_by,
    ],
  )
  // The next spec finds the emulator as it started (a failed test may have left a switch or a fault).
  await emulatorControl('reset').catch(() => undefined)
  // The fixture's orders (cancelled, pending or paid) reference the fixture variants. A paid order has more
  // rows than a cancelled one: its entitlement and fulfilment rows, its receipt in the outbox, and the
  // webhook events and review rows of its payment (payment_core.sql); they go before the order and its attempts.
  const orders = `(select id from finance.orders where customer_email like $1)`
  await db.query(
    `delete from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' in (select id::text from finance.orders where customer_email like $1)`,
    [buyers],
  )
  await db.query(
    `delete from finance.payment_events where provider_payment_id in (
       select provider_payment_id from finance.payment_attempts where order_id in ${orders}
       union select provider_payment_id from finance.payment_reviews where order_id in ${orders})`,
    [buyers],
  )
  await db.query(`delete from finance.download_tokens where entitlement_id in (select id from finance.entitlements where order_id in ${orders})`, [buyers])
  await db.query(`delete from finance.entitlements where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.fulfillments where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.payment_reviews where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.payment_attempts where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.coupon_redemptions where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.inventory_reservations where order_id in ${orders}`, [buyers])
  await db.query(`delete from finance.order_items where order_id in ${orders}`, [buyers])
  await db.query('delete from finance.orders where customer_email like $1', [buyers])
  await db.query('delete from public.customers where email like $1', [buyers])
  await db.query('delete from public.product_variants where product_id = $1', [productId])
  await db.query('delete from public.products where id = $1', [productId])
  await db.query('delete from public.shipping_rates where city_key = $1', [cityKey])
  await db.query('delete from public.coupons where code = $1', [couponCode])
  // archive_document refuses `policies` (and needs a publisher's JWT), so the
  // test policies are removed with SQL, live copy and versions both.
  if (publishedPolicies.length > 0) {
    await db.query("delete from public.published_documents where collection = 'policies' and doc_id = any($1::text[])", [publishedPolicies])
    await db.query("delete from public.content_versions where collection = 'policies' and doc_id = any($1::text[])", [publishedPolicies])
  }
  await db.end()
})

async function checkoutOff() {
  await db.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
}

/** Turns checkout on with the seller fixture and the currently published policy revisions. */
async function checkoutOn() {
  const revisions = await db.query<{ revisions: string }>(
    `select coalesce(jsonb_object_agg(doc_id, seq), '{}'::jsonb)::text as revisions from public.published_documents where collection = 'policies'`,
  )
  let revisionsText = revisions.rows[0]!.revisions
  if (revisionsText === '{}') {
    // No published policies yet: publish the three minimal ones like the demo seed.
    for (const id of ['store', 'delivery', 'refund']) {
      const seq = (
        await db.query<{ seq: number }>(
          'select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = $1 and doc_id = $2',
          ['policies', id],
        )
      ).rows[0]!.seq
      await db.query(
        `insert into public.content_versions (collection, doc_id, seq, data) values ('policies', $1, $2, $3::jsonb)`,
        [id, seq, JSON.stringify({ title: id, body: { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'نص سياسة الاختبار.', version: 1 }], version: 1 }] } } })],
      )
      await db.query('select public.content_go_live($1, $2, $3)', ['policies', id, seq])
      publishedPolicies.push(id)
    }
    revisionsText = (
      await db.query<{ revisions: string }>(
        `select coalesce(jsonb_object_agg(doc_id, seq), '{}'::jsonb)::text as revisions from public.published_documents where collection = 'policies'`,
      )
    ).rows[0]!.revisions
  }
  await db.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار',
       seller_address = 'تبوك', seller_registration = 'E2E-REG', policy_revisions = $1::jsonb,
       version = version + 1, configured_at = now()
     where id = 1`,
    [revisionsText],
  )
}

async function orderRow(email: string) {
  return (await db.query<{ status: string; total_halalas: number }>('select status, total_halalas from finance.orders where customer_email = $1', [email])).rows
}

test('the store lists the fixture product and its page prices every variant', async ({ page }) => {
  await page.goto('/store')
  await expect(page.getByRole('heading', { name: 'المتجر' })).toBeVisible()
  const card = page.locator('li', { hasText: TITLE })
  await expect(card.getByText('من 12.40 ر.س')).toBeVisible()

  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الإلكترونية' }).getByText('12.40 ر.س')).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الورقية' }).getByText('23.60 ر.س')).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الموقعة' }).getByText('51.70 ر.س')).toBeVisible()
})

test('while checkout is off, the cart and the checkout say so', async ({ page }) => {
  await checkoutOff()
  await addFixtures(page, [{ row: 'النسخة الورقية', quantity: 1 }])
  await page.goto('/cart')
  await expect(page.getByText('الشراء غير متاح حاليًا، ويفتح قريبًا.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toHaveCount(0)

  await page.goto('/checkout')
  await expect(page.getByText('الشراء غير متاح حاليًا، ويفتح قريبًا.')).toBeVisible()
})

test('the cart persists across reload, follows the live quote and removes a line', async ({ page }) => {
  await addFixtures(page, [
    { row: 'النسخة الورقية', quantity: 2 },
    { row: 'النسخة الإلكترونية', quantity: 1 },
  ])
  await page.goto('/cart')
  const paper = page.locator('li', { hasText: 'النسخة الورقية' })
  const ebook = page.locator('li', { hasText: 'النسخة الإلكترونية' })
  await expect(paper).toContainText('47.20 ر.س') // 2 × 23.60
  await expect(ebook).toContainText('12.40 ر.س')
  await expect(totalRow(page, 'الإجمالي')).toContainText('59.60 ر.س')

  await page.reload()
  // The quantity field is named after its line («الكمية: <product>: <variant>», X3.11).
  await expect(paper.getByLabel(/^الكمية/)).toHaveValue('2')
  await expect(ebook.getByLabel(/^الكمية/)).toHaveValue('1')

  // A physical line needs a city; choosing one adds its fee.
  await expect(page.getByText('اختر مدينة التوصيل.')).toBeVisible()
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(totalRow(page, 'التوصيل')).toContainText('11.30 ر.س')
  await expect(totalRow(page, 'الإجمالي')).toContainText('70.90 ر.س')

  // Change a quantity: the totals follow the fresh quote.
  await paper.getByRole('button', { name: 'إنقاص الكمية' }).click()
  await expect(totalRow(page, 'الإجمالي')).toContainText('47.30 ر.س') // 23.60 + 12.40 + 11.30

  // Remove a line.
  await ebook.getByRole('button', { name: 'حذف' }).click()
  await expect(ebook).toHaveCount(0)
  await expect(totalRow(page, 'الإجمالي')).toContainText('34.90 ر.س') // 23.60 + 11.30
})

test('a digital-only cart shows no city; the coupon applies and the discount shows', async ({ page }) => {
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 2 }])
  await page.goto('/cart')
  await expect(totalRow(page, 'الإجمالي')).toContainText('24.80 ر.س')
  await expect(page.getByLabel('مدينة التوصيل')).toHaveCount(0)

  await page.getByLabel('كود الخصم').fill(couponCode)
  await page.getByRole('button', { name: 'تطبيق' }).click()
  await expect(totalRow(page, 'الخصم')).toContainText('2.48 ر.س')
  await expect(totalRow(page, 'الإجمالي')).toContainText('22.32 ر.س')
})

test('a signed line gets its dedication field in the cart', async ({ page }) => {
  await addFixtures(page, [{ row: 'النسخة الموقعة', quantity: 1 }])
  await page.goto('/cart')
  const signed = page.locator('li', { hasText: 'النسخة الموقعة' })
  await expect(signed.getByLabel('نص الإهداء')).toBeVisible()
  await signed.getByLabel('نص الإهداء').fill('لأنس مع التحية')
  await expect(signed.getByLabel('نص الإهداء')).toHaveValue('لأنس مع التحية')
})

test('with checkout on: order, hold view with its payment link, kept cart, reload and cancel', async ({ page }) => {
  await checkoutOn()
  await addFixtures(page, [
    { row: 'النسخة الورقية', quantity: 2 },
    { row: 'النسخة الإلكترونية', quantity: 1 },
  ])
  await page.goto('/cart')
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(totalRow(page, 'الإجمالي')).toContainText('70.90 ر.س')
  await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()

  // The summary the buyer confirms is the same live quote.
  await expect(totalRow(page, 'الإجمالي')).toContainText('70.90 ر.س')
  const email = `buyer-${marker}-full@example.com`
  await fillCheckout(page, email)
  // The always-pass test widget solves itself; a press before it has waits for its token.
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()
  const creating = page.waitForRequest((request) => request.url() === CHECKOUT && request.method() === 'POST' && request.postDataJSON()?.action === 'create')
  await submit.click()

  // The page sent the revisions its build rendered, for the policies the quote lists (the ones the owner approved).
  const sent = (await creating).postDataJSON() as { policyRevisions: Record<string, number> }
  const built = (
    await db.query<{ revisions: Record<string, number> }>(
      `select jsonb_object_agg(p.doc_id, p.seq) as revisions
         from public.published_documents p, finance.commerce_settings s
        where p.collection = 'policies' and s.id = 1 and s.policy_revisions ? p.doc_id`,
    )
  ).rows[0]!.revisions
  expect(sent.policyRevisions).toEqual(built)

  // The hold view: the order, its total, when the hold ends, and the way to pay (a plain link, same tab).
  const pay = page.getByRole('link', { name: 'ادفع الآن' })
  await expect(pay).toBeVisible()
  const invoiceUrl = (await pay.getAttribute('href'))!
  expect(invoiceUrl).toMatch(/^http:\/\/127\.0\.0\.1:54390\/invoices\/[0-9a-f-]{36}$/)
  await expect(pay).not.toHaveAttribute('target', /.+/)
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  await expect(page.getByText('الإجمالي: 70.90 ر.س')).toBeVisible()
  const holdEnds = (
    await db.query<{ t: string }>(
      `select to_char(hold_expires_at at time zone 'Asia/Riyadh', 'HH24:MI') as t from finance.orders where customer_email = $1`,
      [email],
    )
  ).rows[0]!.t
  await expect(page.getByText(`محجوز حتى ${holdEnds}`)).toBeVisible()
  await expect(page.getByText('وضع تجريبي: لا يُخصم أي مبلغ حقيقي')).toBeVisible()
  // P07's sentence about the payment coming in the next phase is gone.
  await expect(page.getByText('الدفع يُضاف في المرحلة القادمة')).toHaveCount(0)
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 7090 }])
  expect((await emulatorInvoices()).map((invoice) => invoice.url)).toEqual([invoiceUrl])

  // DATA step 5: the cart survives the hold; nothing is settled yet.
  await page.goto('/cart')
  await expect(page.locator('li', { hasText: 'النسخة الورقية' })).toBeVisible()

  // Back on the checkout, a reload restores the hold view through `pay`: the same invoice, not a second one.
  await page.goto('/checkout')
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  await expect(pay).toBeVisible()
  await expect(pay).toHaveAttribute('href', invoiceUrl)
  expect(await emulatorInvoices()).toHaveLength(1)

  // A cancel with the invoice live cancels it at the provider too.
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toBeVisible()
  await expect(pay).toHaveCount(0)
  expect(await orderRow(email)).toEqual([{ status: 'cancelled', total_halalas: 7090 }])
  expect((await emulatorInvoices()).map((invoice) => invoice.status)).toEqual(['canceled'])
  // The order is over: its token and its key are forgotten, and the cart is still the buyer's.
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":2')
})

test('a price change between the quote and the submit asks for confirmation, then succeeds', async ({ page }) => {
  await checkoutOn()
  await addFixtures(page, [{ row: 'النسخة الورقية', quantity: 1 }])
  await page.goto('/cart')
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(totalRow(page, 'الإجمالي')).toContainText('34.90 ر.س') // 23.60 + 11.30
  await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()

  const email = `buyer-${marker}-price@example.com`
  await fillCheckout(page, email)
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()

  // The owner reprices the paper edition while the buyer is on the form.
  await db.query('update public.product_variants set price_halalas = 3070 where id = $1', [paperId])
  try {
    await submit.click()
    await expect(page.getByText('تغيّر السعر أو التوفر؛ راجع الملخص المحدث.')).toBeVisible()
    await expect(totalRow(page, 'الإجمالي')).toContainText('42.00 ر.س') // 30.70 + 11.30
    expect(await orderRow(email)).toEqual([])

    // A Turnstile token is single-use: the confirmation waits for a fresh one.
    await submit.click()
    await expect(page.getByRole('link', { name: 'ادفع الآن' })).toBeVisible()
    expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 4200 }])
    await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
    await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  } finally {
    // The later tests assert the fixture price.
    await db.query('update public.product_variants set price_halalas = $2 where id = $1', [paperId, PAPER])
  }
})

test('paying on the invoice page brings the buyer back to «تم الدفع», and only then are the cart and the stored order cleared', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-paid@example.com`
  const number = await placeOrder(page, email)
  expect(await kept(page, PENDING_KEY)).not.toBeNull()

  await payOnInvoicePage(page)
  // The provider sends the buyer back with the order number; `verify` says what the ledger holds.
  await expect(page).toHaveURL(new RegExp(`/checkout/return\\?order=${number}$`))
  await expect(page.getByText('تم الدفع.')).toBeVisible()
  await expect(page.getByText(`رقم الطلب ${number}`)).toBeVisible()
  await expect(page.getByText('أرسلنا رابط الطلب إلى بريدك.')).toBeVisible()
  await expect(page.getByText('وضع تجريبي: لا يُخصم أي مبلغ حقيقي')).toBeVisible()
  // This tab holds the token, so the order link is here: the number and the token, in the fragment.
  await expect(page.getByRole('link', { name: 'عرض الطلب' })).toHaveAttribute('href', new RegExp(`^/orders#${number}\\.[A-Za-z0-9_-]{43}$`))
  expect(await orderRow(email)).toEqual([{ status: 'paid', total_halalas: 1240 }])

  // The cart, the stored order and the key are spent, and the cart link says so.
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBe('{"version":1,"lines":[]}')
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
  // Nothing on the page asks again once the state is final.
  await expect(page.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
  await page.goto('/store')
  await expect(page.getByRole('link', { name: 'السلة', exact: true })).toBeVisible()
})

test('a cancel that finds the invoice paid says a payment arrived and clears nothing; the return page then tells the rest', async ({ page }) => {
  await checkoutOn()
  // The provider charges the card but we hear nothing (no webhook, no callback): only the cancel finds out.
  await emulatorControl('config', { autoWebhook: false, autoCallback: false })
  const email = `buyer-${marker}-late@example.com`
  const number = await placeOrder(page, email)
  const [invoice] = await emulatorInvoices()
  await emulatorControl('pay', { invoiceId: invoice!.id, status: 'paid' })
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 1240 }])

  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('وصلتنا دفعة هذا الطلب.')).toBeVisible()
  await expect(page.getByText('أُلغي الطلب.')).toHaveCount(0)
  // The cancel settled the payment; the cart and the stored order stay for the return page.
  expect(await orderRow(email)).toEqual([{ status: 'paid', total_halalas: 1240 }])
  expect(await kept(page, PENDING_KEY)).not.toBeNull()
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')
  const statusLink = page.getByRole('link', { name: 'عرض حالة الطلب' })
  await expect(statusLink).toHaveAttribute('href', `/checkout/return?order=${number}`)

  await statusLink.click()
  await expect(page.getByText('تم الدفع.')).toBeVisible()
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBe('{"version":1,"lines":[]}')
})

test('«نجهّز صفحة الدفع…» when the first call is lost after the provider made the invoice, and the retry finds that one invoice', async ({ page }) => {
  await checkoutOn()
  // The invoice is made and the connection is cut before the reply: the outcome is unknown.
  await emulatorControl('fault', { route: 'POST /v1/invoices', mode: 'drop_after_commit', times: 1 })
  await placeOrder(page, `buyer-${marker}-preparing@example.com`)
  await expect(page.getByText('نجهّز صفحة الدفع…')).toBeVisible()
  await expect(page.getByText(/^محجوز حتى \d{2}:\d{2}$/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إلغاء الطلب' })).toBeVisible()

  await page.getByRole('button', { name: 'أعد المحاولة' }).click()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toBeVisible()
  await expect(page.getByText('نجهّز صفحة الدفع…')).toHaveCount(0)
  // One invoice for the one attempt: the retry listed, found and adopted it; it did not make another.
  expect(await emulatorInvoices()).toHaveLength(1)
})

test('«تعذّر تجهيز الدفع؛ حاول بعد لحظات.» when the provider refuses, and the retry makes the invoice', async ({ page }) => {
  await checkoutOn()
  await emulatorControl('fault', { route: 'POST /v1/invoices', mode: '429', times: 1 })
  await placeOrder(page, `buyer-${marker}-unavailable@example.com`)
  await expect(page.getByText('تعذّر تجهيز الدفع؛ حاول بعد لحظات.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
  expect(await emulatorInvoices()).toHaveLength(0)

  await page.getByRole('button', { name: 'أعد المحاولة' }).click()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toBeVisible()
  await expect(page.getByText('تعذّر تجهيز الدفع؛ حاول بعد لحظات.')).toHaveCount(0)
  expect(await emulatorInvoices()).toHaveLength(1)
})

test('a stored order whose `pay` the function refuses (closed store, throttle) shows its words with the retry, and the retry works', async ({ page }) => {
  await checkoutOn()
  const placed = await apiOrder(`buyer-${marker}-closed@example.com`)
  await page.addInitScript(
    ([key, order]) => sessionStorage.setItem(key!, order!),
    [PENDING_KEY, JSON.stringify({ orderNumber: placed.orderNumber, accessToken: placed.accessToken })],
  )
  // Payments stop being configured while the buyer is away: `pay` answers 503 CHECKOUT_DISABLED; then the throttle: 429.
  const refusals = {
    closed: { status: 503, code: 'CHECKOUT_DISABLED', message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
    throttled: { status: 429, code: 'RATE_LIMITED', message: 'أرسلت طلبات كثيرة؛ حاول لاحقًا.' },
  }
  let refusing: keyof typeof refusals | null = 'closed'
  await page.route('**/functions/v1/checkout', async (route) => {
    const request = route.request()
    if (refusing !== null && request.method() === 'POST' && request.postDataJSON()?.action === 'pay') {
      const { status: code, ...error } = refusals[refusing]
      return route.fulfill({
        status: code,
        headers: { 'access-control-allow-origin': SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error }),
      })
    }
    return route.continue()
  })
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  await page.goto('/checkout')
  await expect(page.getByText('الشراء غير متاح حاليًا، ويفتح قريبًا.')).toBeVisible()
  await expect(page.getByText('تعذّر تجهيز الدفع؛ حاول بعد لحظات.')).toBeVisible()
  // The order is kept: the buyer can still try again, or cancel.
  expect(await kept(page, PENDING_KEY)).not.toBeNull()
  await expect(page.getByRole('button', { name: 'إلغاء الطلب' })).toBeVisible()

  // The throttle says its own words, in place of the earlier ones.
  refusing = 'throttled'
  await page.getByRole('button', { name: 'أعد المحاولة' }).click()
  await expect(page.getByText('أرسلت طلبات كثيرة؛ حاول لاحقًا.')).toBeVisible()
  await expect(page.getByText('الشراء غير متاح حاليًا، ويفتح قريبًا.')).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).not.toBeNull()

  refusing = null
  await page.getByRole('button', { name: 'أعد المحاولة' }).click()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveAttribute('href', placed.invoiceUrl)
})

test('a cancel the function refuses (a payment under way, the throttle) shows its words and keeps the hold view', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-refused@example.com`
  const placed = await apiOrder(email)
  await page.addInitScript(
    ([key, order]) => sessionStorage.setItem(key!, order!),
    [PENDING_KEY, JSON.stringify({ orderNumber: placed.orderNumber, accessToken: placed.accessToken })],
  )
  let refusal = { status: 409, code: 'PAYMENT_ACTIVE', message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' }
  await page.route('**/functions/v1/checkout', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'cancel') {
      const { status: code, ...error } = refusal
      return route.fulfill({
        status: code,
        headers: { 'access-control-allow-origin': SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error }),
      })
    }
    return route.continue()
  })
  await page.goto('/checkout')
  const pay = page.getByRole('link', { name: 'ادفع الآن' })
  await expect(pay).toHaveAttribute('href', placed.invoiceUrl)
  const cancel = page.getByRole('button', { name: 'إلغاء الطلب' })

  await cancel.click()
  await expect(page.getByText('الدفع قيد المعالجة؛ حاول بعد لحظات.')).toBeVisible()
  await expect(pay).toBeVisible()
  await expect(cancel).toBeEnabled()
  expect(await kept(page, PENDING_KEY)).not.toBeNull()

  refusal = { status: 429, code: 'RATE_LIMITED', message: 'أرسلت طلبات كثيرة؛ حاول لاحقًا.' }
  await cancel.click()
  await expect(page.getByText('أرسلت طلبات كثيرة؛ حاول لاحقًا.')).toBeVisible()
  await expect(page.getByText('الدفع قيد المعالجة؛ حاول بعد لحظات.')).toHaveCount(0)
  await expect(pay).toBeVisible()
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 1240 }])
  expect(await kept(page, PENDING_KEY)).not.toBeNull()

  // The function no longer knows the order (or the token): the view goes and the stored order with it.
  refusal = { status: 404, code: 'NOT_FOUND', message: 'لم نجد هذا الطلب.' }
  await cancel.click()
  await expect(page.getByText('رقم الطلب:')).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
})

test('a stored order that cannot be paid here: a payment under review says so and keeps the order; another payment mode claims no payment and offers the cancel', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-blocked@example.com`
  const placed = await apiOrder(email)
  await page.addInitScript(
    ([key, order]) => sessionStorage.setItem(key!, order!),
    [PENDING_KEY, JSON.stringify({ orderNumber: placed.orderNumber, accessToken: placed.accessToken })],
  )
  const order = (await db.query('select id, total_halalas from finance.orders where customer_email = $1', [email])).rows[0]!

  // A charged payment of the order waits for the owner (UNDER_REVIEW).
  const reviewId = randomUUID()
  await db.query(
    `insert into finance.payment_reviews (provider_payment_id, provider_invoice_id, order_id, environment, amount_halalas, currency, provider_status, reason)
     values ($1, $2, $3, 'test', $4, 'SAR', 'paid', 'SECOND_PAYMENT')`,
    [reviewId, randomUUID(), order.id, order.total_halalas],
  )
  await page.goto('/checkout')
  await expect(page.getByText('وصلتنا دفعة هذا الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'عرض حالة الطلب' })).toHaveAttribute('href', `/checkout/return?order=${placed.orderNumber}`)
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).not.toBeNull()
  await db.query('delete from finance.payment_reviews where provider_payment_id = $1', [reviewId])

  // The order was made in another payment mode (MODE_CHANGED): no payment is claimed, and the cancel frees the hold.
  await db.query(`update finance.orders set environment = 'live' where id = $1`, [order.id])
  await page.goto('/checkout')
  await expect(page.getByText('تعذّر تجهيز الدفع لهذا الطلب. ألغِ الطلب ثم اطلب من جديد.')).toBeVisible()
  await expect(page.getByText('وصلتنا دفعة هذا الطلب.')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).not.toBeNull()
  await db.query(`update finance.orders set environment = 'test' where id = $1`, [order.id])
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  expect(await orderRow(email)).toEqual([{ status: 'cancelled', total_halalas: 1240 }])
  expect(await kept(page, PENDING_KEY)).toBeNull()
})

test('a stored order the function does not know is forgotten, and the form is shown again', async ({ page }) => {
  await checkoutOn()
  await page.addInitScript(
    ([key, order]) => sessionStorage.setItem(key!, order!),
    [PENDING_KEY, JSON.stringify({ orderNumber: 'ABCD2345', accessToken: 'A'.repeat(43) })],
  )
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  await page.goto('/checkout')
  // `pay` answered NOT_FOUND: the stored order and the key are cleared and the form is back, with the function's words.
  await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible()
  await expect(page.getByText('لم نجد هذا الطلب.')).toBeVisible()
  expect(await kept(page, PENDING_KEY)).toBeNull()
  await expect(page.getByText('رقم الطلب:')).toHaveCount(0)
})

test('at the hold\'s end the view asks the function: a device clock that runs ahead ends nothing, and a hold that is over ends the view', async ({ page }) => {
  await checkoutOn()
  // The hold lasts about twenty minutes: catch that one timer, so the test fires it itself. Nothing else is touched.
  await page.addInitScript(() => {
    const real = window.setTimeout.bind(window)
    const hold = window as unknown as { __holdDelays: number[]; __holdFire?: () => void }
    hold.__holdDelays = []
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof handler === 'function' && typeof ms === 'number' && ms > 1_000_000 && ms <= 1_260_000) {
        hold.__holdDelays.push(ms)
        hold.__holdFire = () => handler(...args)
        return 0
      }
      return real(handler, ms, ...args)
    }) as typeof window.setTimeout
  })
  const fire = () => page.evaluate(() => (window as unknown as { __holdFire: () => void }).__holdFire())
  const email = `buyer-${marker}-timer@example.com`
  await placeOrder(page, email)
  const pay = page.getByRole('link', { name: 'ادفع الآن' })
  await expect(pay).toBeVisible()
  const delays = await page.evaluate(() => (window as unknown as { __holdDelays: number[] }).__holdDelays)
  expect(delays.length).toBeGreaterThan(0)
  // One timer to the hold's end: a little under the 20 minutes the hold lasts, never an interval.
  for (const delay of delays) {
    expect(delay).toBeGreaterThan(1_100_000)
    expect(delay).toBeLessThanOrEqual(1_200_000)
  }

  // The device says the time has passed while the function still holds the order (a clock that runs ahead):
  // the view asks, and stays as it is.
  const asked = page.waitForResponse(
    (response) => response.url().endsWith('/functions/v1/checkout') && response.request().postDataJSON()?.action === 'pay',
  )
  await fire()
  expect((await asked).status()).toBe(200)
  await expect(pay).toBeVisible()
  await expect(page.getByText('انتهت مدة حجز الطلب.')).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).not.toBeNull()

  // The hold is over at the function (under a minute left: no payment can begin on it): now the view ends.
  await db.query(`update finance.orders set hold_expires_at = now() + interval '20 seconds' where customer_email = $1`, [email])
  await fire()
  await expect(page.getByText('انتهت مدة حجز الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toBeVisible()
  await expect(pay).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إلغاء الطلب' })).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')
})

test('when the function says the hold is over, a reload ends the view the same way', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-holdover@example.com`
  await placeOrder(page, email)
  // The hold has under a minute left: no payment can begin on it any more (HOLD_EXPIRED).
  await db.query(`update finance.orders set hold_expires_at = now() + interval '20 seconds' where customer_email = $1`, [email])
  await page.goto('/checkout')
  await expect(page.getByText('انتهت مدة حجز الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
})

test('ACTIVE_HOLD hands the held order back to the same email when the tab lost it, and not to another email', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-active@example.com`
  const number = await placeOrder(page, email)

  // The tab loses its pending order and its key but keeps its checkout session (and the cart).
  await page.evaluate(([pending, idempotency]) => {
    sessionStorage.removeItem(pending!)
    sessionStorage.removeItem(idempotency!)
  }, [PENDING_KEY, IDEMPOTENCY_KEY])

  // Another address: the function only says the session holds an order, and until when. Nothing is handed over.
  await page.goto('/checkout')
  await fillDigital(page, `buyer-${marker}-elsewhere@example.com`)
  await confirmOrder(page)
  await expect(page.getByText('لديك طلب قيد الانتظار؛ أكمله أو ألغه أولًا.')).toBeVisible()
  await expect(page.getByText(/^لديك طلب محجوز من هذه الجلسة حتى \d{2}:\d{2}\.$/)).toBeVisible()
  await expect(page.getByText('رقم الطلب:')).toHaveCount(0)
  expect(await kept(page, PENDING_KEY)).toBeNull()
  expect(await orderRow(`buyer-${marker}-elsewhere@example.com`)).toEqual([])

  // The same address: the held order and its token come back, the hold view shows, and `pay` gives its payment.
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await confirmOrder(page)
  await expect(page.locator('#checkout-order-number span')).toHaveText(number)
  await expect(page.getByRole('link', { name: 'ادفع الآن' })).toBeVisible()
  const handedBack = JSON.parse((await kept(page, PENDING_KEY))!) as { orderNumber: string }
  expect(handedBack.orderNumber).toBe(number)
  // Still the one order, and the one invoice.
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 1240 }])
  expect(await emulatorInvoices()).toHaveLength(1)
})

test('the return page without the token says paid, offers no order link, and clears nothing it does not hold', async ({ browser }) => {
  await checkoutOn()
  const placed = await apiOrder(`buyer-${marker}-notoken@example.com`)
  await emulatorControl('pay', { invoiceId: placed.invoiceId, status: 'paid' })

  // Another browser: no stored order, a cart of its own.
  const context = await browser.newContext()
  const page = await context.newPage()
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  await page.goto(`/checkout/return?order=${placed.orderNumber.toLowerCase()}`)
  await expect(page.getByText('تم الدفع.')).toBeVisible()
  await expect(page.getByText(`رقم الطلب ${placed.orderNumber}`)).toBeVisible()
  await expect(page.getByText('أرسلنا رابط الطلب إلى بريدك.')).toBeVisible()
  await expect(page.locator('a[href^="/orders#"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'عرض الطلب' })).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')
  await context.close()
})

test('the return page ignores a forged status in the address: an unpaid order stays unpaid', async ({ page }) => {
  await checkoutOn()
  const email = `buyer-${marker}-forged@example.com`
  const placed = await apiOrder(email)
  // This tab holds the order (as after its own checkout) and a cart.
  await page.addInitScript(
    ([pendingKey, order, cartKey, cart]) => {
      sessionStorage.setItem(pendingKey!, order!)
      localStorage.setItem(cartKey!, cart!)
    },
    [
      PENDING_KEY,
      JSON.stringify({ orderNumber: placed.orderNumber, accessToken: placed.accessToken }),
      CART_KEY,
      JSON.stringify({ version: 1, lines: [{ variantId: ebookId, quantity: 1 }] }),
    ],
  )
  await page.goto(`/checkout/return?order=${placed.orderNumber}&status=paid&id=${randomUUID()}&message=APPROVED`)
  // `verify` says what the ledger holds: pending, with the way back to the invoice for the holder of the token.
  await expect(page.getByRole('link', { name: 'متابعة الدفع' })).toHaveAttribute('href', placed.invoiceUrl)
  await expect(page.getByText('جارٍ التحقق من الدفع…')).toBeVisible()
  await expect(page.getByText('تم الدفع.')).toHaveCount(0)
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 1240 }])
  expect(await kept(page, PENDING_KEY)).not.toBeNull()
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')
})

test('the return page keeps asking until the provider\'s payment is settled, then stops asking and only then clears the cart', async ({ page }) => {
  await checkoutOn()
  // The provider will charge the card without telling us: only the page's own later check can find out.
  await emulatorControl('config', { autoWebhook: false, autoCallback: false })
  const email = `buyer-${marker}-slow@example.com`
  const placed = await apiOrder(email)
  await page.addInitScript(
    ([pendingKey, order, cartKey, cart]) => {
      sessionStorage.setItem(pendingKey!, order!)
      localStorage.setItem(cartKey!, cart!)
    },
    [
      PENDING_KEY,
      JSON.stringify({ orderNumber: placed.orderNumber, accessToken: placed.accessToken }),
      CART_KEY,
      JSON.stringify({ version: 1, lines: [{ variantId: ebookId, quantity: 1 }] }),
    ],
  )
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/functions/v1/payments')) asked.push(request.url())
  })
  await page.goto(`/checkout/return?order=${placed.orderNumber}`)
  await expect(page.getByRole('link', { name: 'متابعة الدفع' })).toHaveAttribute('href', placed.invoiceUrl)
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')

  // A check within 5 seconds of the last is answered from the ledger without asking the provider (payment_check_begin),
  // so it is a later one of the schedule that finds the payment.
  await emulatorControl('pay', { invoiceId: placed.invoiceId, status: 'paid' })
  await expect(page.getByText('تم الدفع.')).toBeVisible({ timeout: 30_000 })
  expect(asked.length).toBeGreaterThan(1)
  expect(await orderRow(email)).toEqual([{ status: 'paid', total_halalas: 1240 }])
  await expect(page.getByRole('link', { name: 'عرض الطلب' })).toHaveAttribute('href', new RegExp(`^/orders#${placed.orderNumber}\\.`))
  await expect(page.getByRole('link', { name: 'متابعة الدفع' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toBe('{"version":1,"lines":[]}')
  expect(await kept(page, PENDING_KEY)).toBeNull()

  // Settled: the schedule is over, nothing asks again.
  const settled = asked.length
  await page.waitForTimeout(8_000)
  expect(asked.length).toBe(settled)
})

test('the return page tells a throttle from a lost connection from an unknown order, and «تحديث» asks once more', async ({ page }) => {
  let mode: 'limit' | 'lost' | 'real' = 'limit'
  let asked = 0
  await page.route('**/functions/v1/payments', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    asked += 1
    if (mode === 'lost') return route.abort('failed')
    if (mode === 'limit') {
      return route.fulfill({
        status: 429,
        headers: { 'access-control-allow-origin': SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: { code: 'RATE_LIMITED', message: 'أرسلت طلبات كثيرة؛ حاول لاحقًا.' } }),
      })
    }
    return route.continue()
  })

  // A throttle: «حاول بعد قليل.» and the button; the schedule stops there.
  await page.goto('/checkout/return?order=ABCD2345')
  await expect(page.getByText('حاول بعد قليل.')).toBeVisible()
  const refresh = page.getByRole('button', { name: 'تحديث' })
  await expect(refresh).toBeVisible()
  expect(asked).toBe(1)

  // A lost connection: its own words, and the button stays.
  mode = 'lost'
  await refresh.click()
  await expect(page.getByText('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')).toBeVisible()
  await expect(page.getByText('حاول بعد قليل.')).toHaveCount(0)
  await expect(refresh).toBeVisible()
  await expect(refresh).toBeFocused()
  expect(asked).toBe(2)

  // The real function: nothing is known of this number, and the page says so with the way to recovery.
  mode = 'real'
  await refresh.click()
  await expect(page.getByText('لم نجد هذا الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'استعادة رابط الطلب' })).toHaveAttribute('href', '/orders')
  await expect(page.getByText('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')).toHaveCount(0)
  await expect(refresh).toHaveCount(0)
  expect(asked).toBe(3)
})

// The state is the function's to say (what settles each one is proven by the integration tests); the page has to
// word it and treat the order right: an order that ended is forgotten and the cart kept for another try, any other
// stays, and a state that is final offers no refresh.
for (const [state, text, ended] of [
  ['needs_resolution', 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.', false],
  ['review', 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.', false],
  ['refunded', 'أُعيد مبلغ هذا الطلب.', false],
  ['expired', 'انتهت مدة حجز الطلب.', true],
  ['cancelled', 'أُلغي الطلب.', true],
] as const) {
  test(`the return page words a ${state} order, and ${ended ? 'forgets it, keeping the cart' : 'keeps it'}`, async ({ page }) => {
    await page.route('**/functions/v1/payments', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, data: { state, hasToken: true, testMode: true } }),
      })
    })
    await page.addInitScript(
      ([pendingKey, order, cartKey, cart]) => {
        sessionStorage.setItem(pendingKey!, order!)
        localStorage.setItem(cartKey!, cart!)
      },
      [
        PENDING_KEY,
        JSON.stringify({ orderNumber: 'ABCD2345', accessToken: 'B'.repeat(43) }),
        CART_KEY,
        JSON.stringify({ version: 1, lines: [{ variantId: ebookId, quantity: 1 }] }),
      ],
    )
    await page.goto('/checkout/return?order=ABCD2345')
    await expect(page.getByText(text)).toBeVisible()
    await expect(page.getByText('وضع تجريبي: لا يُخصم أي مبلغ حقيقي')).toBeVisible()
    // Not paid: no «تم الدفع»/order link; a final state: nothing to refresh.
    await expect(page.getByText('تم الدفع.')).toHaveCount(0)
    await expect(page.locator('a[href^="/orders#"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
    if (ended) {
      await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toHaveAttribute('href', '/cart')
      await expect.poll(() => kept(page, PENDING_KEY)).toBeNull()
    } else {
      await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toHaveCount(0)
      expect(await kept(page, PENDING_KEY)).not.toBeNull()
    }
    // Only a paid order empties the cart.
    expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain('"quantity":1')
  })
}

test('a return page with no order number at all says so and links to the recovery page', async ({ page }) => {
  await page.goto('/checkout/return')
  await expect(page.getByText('لم نجد هذا الطلب.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'استعادة رابط الطلب' })).toHaveAttribute('href', '/orders')
  // What the payment page appends is read for nothing: a status alone is no order.
  await page.goto('/checkout/return?status=paid&id=1&message=APPROVED')
  await expect(page.getByText('لم نجد هذا الطلب.')).toBeVisible()
  await expect(page.getByText('تم الدفع.')).toHaveCount(0)
})

test('while the build\'s policy revisions differ from the quote\'s the form says so and stays off', async ({ page }) => {
  await checkoutOn()
  // The owner approved a newer revision of the store policy than the one this page was built from.
  await db.query(
    `update finance.commerce_settings
        set policy_revisions = jsonb_set(policy_revisions, '{store}', to_jsonb((policy_revisions ->> 'store')::int + 1))
      where id = 1`,
  )
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  await page.goto('/checkout')
  await fillDigital(page, `buyer-${marker}-stale@example.com`)
  await expect(page.getByText('نحدّث السياسات الآن؛ حاول بعد قليل.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toBeDisabled()

  // With the revisions equal again the form works.
  await checkoutOn()
  await page.reload()
  await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toBeEnabled()
  await expect(page.getByText('نحدّث السياسات الآن؛ حاول بعد قليل.')).toHaveCount(0)
})

test('a #test= fragment moves into sessionStorage, leaves the address bar, and rides the quote and nothing else', async ({ page }) => {
  await checkoutOn()
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 1 }])
  const quoting = page.waitForRequest((request) => request.url() === CHECKOUT && request.method() === 'POST' && request.postDataJSON()?.action === 'quote')
  await page.goto('/cart?from=e2e#test=sandbox-code-123456')
  await expect(totalRow(page, 'الإجمالي')).toContainText('12.40 ر.س')
  // Path and query stay; the fragment is gone, and the code is the tab's, never localStorage's.
  expect(page.url()).toBe(`${SITE_ORIGIN}/cart?from=e2e`)
  expect(await kept(page, TEST_ACCESS_KEY)).toBe('sandbox-code-123456')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sandbox-code')
  expect(((await quoting).postDataJSON() as { testAccess?: string }).testAccess).toBe('sandbox-code-123456')
  expect((await quoting).url()).not.toContain('sandbox-code')
})

test('storage denied still allows a session cart, with the honest note', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
  })
  const page = await context.newPage()
  await addFixtures(page, [{ row: 'النسخة الورقية', quantity: 1 }])
  // A client-side navigation keeps the module's memory cart for the tab.
  await page.getByRole('link', { name: 'عرض السلة' }).click()
  await expect(page.getByText('السلة مؤقتة في هذه الصفحة: المتصفح يمنع الحفظ.')).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الورقية' })).toBeVisible()
  await context.close()
})

test('the store and a product page read without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/store')
  await expect(page.getByRole('heading', { name: 'المتجر' })).toBeVisible()
  await expect(page.locator('li', { hasText: TITLE }).getByText('من 12.40 ر.س')).toBeVisible()
  await page.goto(`/store/${slug}`)
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الورقية' }).getByText('23.60 ر.س')).toBeVisible()
  await context.close()
})

for (const width of [360, 1440]) {
  test(`screenshots and overflow at ${width}`, async ({ page }) => {
    await checkoutOn()
    await page.setViewportSize({ width, height: 1000 })

    await page.goto('/store')
    await expect(page.locator('li', { hasText: TITLE }).getByText('من 12.40 ر.س')).toBeVisible()
    await expectNoOverflow(page, `store ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-list-${width}.png`, fullPage: true })

    await page.goto(`/store/${slug}`)
    await expect(page.locator('li', { hasText: 'النسخة الورقية' }).getByText('23.60 ر.س')).toBeVisible()
    await expectNoOverflow(page, `product ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-product-${width}.png`, fullPage: true })

    await addFixtures(page, [
      { row: 'النسخة الورقية', quantity: 2 },
      { row: 'النسخة الإلكترونية', quantity: 1 },
    ])
    await page.goto('/cart')
    await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
    await expect(totalRow(page, 'الإجمالي')).toContainText('70.90 ر.س')
    await expectNoOverflow(page, `cart ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-cart-${width}.png`, fullPage: true })

    await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()
    await fillCheckout(page, `buyer-${marker}-shot-${width}@example.com`)
    const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
    await expect(submit).toBeEnabled()
    await expectNoOverflow(page, `checkout ${width}`)
    // A full-page capture draws the sticky header wherever the page is
    // scrolled, and Chromium leaves the cross-origin Turnstile frame blank
    // outside the viewport: the header is static for this capture and the
    // widget in view.
    await page.addStyleTag({ content: 'body > header { position: static !important; }' })
    // The widget's frame sits in a closed shadow root; its box is ours.
    await page.locator('[class*="turnstileBox"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/store-checkout-${width}.png`, fullPage: true })

    await submit.click()
    // The hold view with its payment link.
    await expect(page.getByRole('link', { name: 'ادفع الآن' })).toBeVisible()
    await expect(page.getByText(/^محجوز حتى \d{2}:\d{2}$/)).toBeVisible()
    await expectNoOverflow(page, `order ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-order-${width}.png`, fullPage: true })

    // Paid on the invoice page, the buyer is back on the return page.
    await payOnInvoicePage(page)
    await expect(page.getByText('تم الدفع.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'عرض الطلب' })).toBeVisible()
    await expectNoOverflow(page, `return ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-return-${width}.png`, fullPage: true })
  })
}
