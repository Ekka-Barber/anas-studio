// P07 e2e: the public store, cart and checkout in the browser on `next dev`
// (fixtures made here appear because dev renders pages live). The spec brings
// its own product (digital + physical + signed variants), city rate and
// coupon through the database like checkout-api.spec.ts, saves
// finance.commerce_settings in beforeAll and restores it in afterAll, and
// each test that depends on the store switch sets it itself. Screenshots land
// in store-*.png at 360 and 1440 under shotsDir('P07'): the accepted evidence
// folder only for an ACCEPTANCE_PACKAGE=P07 run, test-results/ otherwise.
import { mkdirSync } from 'node:fs'

import { Client } from 'pg'
import { expect, test, type Page } from '@playwright/test'

import { readStatus, SITE_ORIGIN } from './helpers'
import { shotsDir } from './shots'

const status = readStatus()
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const slug = `e2e-store-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const couponCode = `E2ESTORE${marker}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32)
const cityKey = `e2ecity${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const buyers = `buyer-${marker}-%`
const TITLE = 'كتاب الاختبار للمتجر'
const SHOTS = shotsDir('P07')

// Prices no demo product or rate uses (D37's demo catalog sells at 15.00,
// 35.00, 45.00, 69.00 and 99.00 and delivers for 25.00 to 35.00), and every
// total below is distinct from every line on its page: e-book 12.40, paper
// 23.60, signed 51.70, delivery 11.30, a 10% coupon.
const EBOOK = 1240
const PAPER = 2360
const SIGNED = 5170
const FEE = 1130

let db: Client
let saved: Record<string, unknown>
let productId: string
let paperId: string
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

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
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
  paperId = variantIds.rows.find((row) => row.fulfillment === 'physical')!.id
  await db.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [
    cityKey,
    `مدينة الاختبار ${marker}`,
    FEE,
  ])
  await db.query('insert into public.coupons (code, kind, percent_bp, enabled) values ($1, $2, 1000, true)', [couponCode, 'percent'])
  // Every browser request reaches the functions from the gateway's one
  // address, so reruns within the hour would trip the per-IP throttles; the
  // throttles themselves are proven in tests/integration/checkout.test.ts.
  await db.query("delete from finance.rate_limits where bucket in ('checkout-quote:ip', 'checkout:ip', 'checkout:all')")
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

test.afterAll(async () => {
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
  // The fixture's orders (cancelled or not) reference the fixture variants.
  const orders = `(select id from finance.orders where customer_email like $1)`
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

test('with checkout on: order, hold message, kept cart and cancel', async ({ page }) => {
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
  await submit.click()

  await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  await expect(page.getByText('الإجمالي: 70.90 ر.س')).toBeVisible()
  expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 7090 }])

  // DATA step 5: the cart survives the hold; nothing is settled yet.
  await page.goto('/cart')
  await expect(page.locator('li', { hasText: 'النسخة الورقية' })).toBeVisible()

  // Back on the checkout, the pending order (and its cancel) survives the reload.
  await page.goto('/checkout')
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  expect(await orderRow(email)).toEqual([{ status: 'cancelled', total_halalas: 7090 }])
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
    await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
    expect(await orderRow(email)).toEqual([{ status: 'pending_payment', total_halalas: 4200 }])
    await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
    await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  } finally {
    // The later tests assert the fixture price.
    await db.query('update public.product_variants set price_halalas = $2 where id = $1', [paperId, PAPER])
  }
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
    await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
    await expectNoOverflow(page, `order ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-order-${width}.png`, fullPage: true })

    await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
    await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  })
}
