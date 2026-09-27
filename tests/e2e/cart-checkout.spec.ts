// P07 e2e: the public store, cart and checkout in the browser on `next dev`
// (fixtures made here appear because dev renders pages live). The spec brings
// its own product (digital + physical + signed variants), city rate and
// coupon through the database like checkout-api.spec.ts, saves
// finance.commerce_settings in beforeAll and restores it in afterAll, and
// switches checkout on only for the on-tests. Screenshots land in
// artifacts/acceptance/P07/screenshots/store-*.png at 360 and 1440.
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { expect, test } from '@playwright/test'

import { readStatus } from './helpers'

const status = readStatus()
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const slug = `e2e-store-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const couponCode = `E2ESTORE${marker}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32)
const cityKey = `e2ecity${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const SHOTS = 'artifacts/acceptance/P07/screenshots'

let db: Client
let saved: Record<string, unknown>
let productId: string
let paperId: string

/** Adds the fixture line-up to the cart from the fixture product page. */
async function addFixtures(page: import('@playwright/test').Page, lines: Array<{ row: string; quantity: number }>) {
  await page.goto(`/store/${slug}`)
  for (const line of lines) {
    const row = page.locator('li', { hasText: line.row })
    await row.getByLabel('الكمية').fill(String(line.quantity))
    await row.getByRole('button', { name: 'أضف إلى السلة' }).click()
    await expect(row.getByText('أُضيف إلى السلة.')).toBeVisible()
  }
}

/** The page-level and in-card overflow an owner-operations screenshot pass checks. */
async function expectNoOverflow(page: import('@playwright/test').Page, label: string) {
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
      `insert into public.products (slug, title, summary, status) values ($1, 'كتاب الاختبار للمتجر', 'ملخص تجريبي للاختبار', 'published') returning id`,
      [slug],
    )
  ).rows[0]!.id
  const variantIds = await db.query<{ id: string; fulfillment: string }>(
    `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock) values
       ($1, $2, 'النسخة الإلكترونية', 'digital', 1500, true, null),
       ($1, $3, 'النسخة الورقية', 'physical', 2500, true, 10),
       ($1, $4, 'النسخة الموقعة', 'signed', 5000, true, 5)
     returning id, fulfillment`,
    [productId, `E2E-D-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''), `E2E-P-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, ''), `E2E-S-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')],
  )
  paperId = variantIds.rows.find((row) => row.fulfillment === 'physical')!.id
  await db.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, 2000, true)', [
    cityKey,
    `مدينة الاختبار ${marker}`,
  ])
  await db.query('insert into public.coupons (code, kind, percent_bp, enabled) values ($1, $2, 1000, true)', [couponCode, 'percent'])
  // The off-tests run first; the on-tests switch it inside their own body.
  await db.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
  mkdirSync(SHOTS, { recursive: true })
})

test.afterAll(async () => {
  // The fixture product's orders (cancelled or not) reference the fixtures.
  await db.query(
    `delete from finance.coupon_redemptions where order_id in (select id from finance.orders where customer_email like $1)`,
    [`%-${marker}@%`],
  )
  await db.query(
    `delete from finance.inventory_reservations where order_id in (select id from finance.orders where customer_email like $1)`,
    [`%-${marker}@%`],
  )
  await db.query(
    `delete from finance.order_items where order_id in (select id from finance.orders where customer_email like $1)`,
    [`%-${marker}@%`],
  )
  await db.query(`delete from finance.orders where customer_email like $1`, [`%-${marker}@%`])
  await db.query(`delete from public.customers where email like $1`, [`%-${marker}@%`])
  await db.query('delete from public.product_variants where product_id = $1', [productId])
  await db.query('delete from public.products where id = $1', [productId])
  await db.query('delete from public.shipping_rates where city_key = $1', [cityKey])
  await db.query('delete from public.coupons where code = $1', [couponCode])
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
  await db.end()
})

/** Turns checkout on with the seller fixture and the currently published policy revisions. */
async function enableCheckout() {
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
      await db.query('select public.content_go_live($1, $2)', ['policies', id])
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

test('the store lists the fixture product and its page prices every variant', async ({ page }) => {
  await page.goto('/store')
  await expect(page.getByRole('heading', { name: 'المتجر' })).toBeVisible()
  const card = page.locator('li', { hasText: 'كتاب الاختبار للمتجر' })
  await expect(card).toBeVisible()
  await expect(card.getByText(/من 15\.00 ر\.س/)).toBeVisible()

  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'كتاب الاختبار للمتجر', exact: true })).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الإلكترونية' }).getByText('15.00 ر.س')).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الورقية' }).getByText('25.00 ر.س')).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الموقعة' }).getByText('50.00 ر.س')).toBeVisible()
})

test('while checkout is off, the cart and the checkout say so', async ({ page }) => {
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
  await expect(paper).toBeVisible()
  await expect(ebook).toBeVisible()
  // 2 × 25.00 + 15.00 = 65.00, before a city is chosen: subtotal and total.
  await expect(page.getByText('65.00 ر.س')).toHaveCount(2)

  await page.reload()
  await expect(page.locator('li', { hasText: 'النسخة الورقية' })).toBeVisible()
  await expect(page.locator('li', { hasText: 'النسخة الإلكترونية' })).toBeVisible()

  // A physical line asks for a city.
  await expect(page.getByLabel('مدينة التوصيل')).toBeVisible()
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(page.getByText('20.00 ر.س')).toBeVisible() // the delivery line
  await expect(page.getByText('85.00 ر.س')).toBeVisible() // 65.00 + 20.00

  // Change a quantity: the totals follow the fresh quote.
  await paper.getByRole('button', { name: 'إنقاص الكمية' }).click()
  await expect(page.getByText('60.00 ر.س')).toBeVisible() // 25.00 + 15.00 + 20.00

  // Remove a line.
  await ebook.getByRole('button', { name: 'حذف' }).click()
  await expect(page.locator('li', { hasText: 'النسخة الإلكترونية' })).toHaveCount(0)
  await expect(page.getByText('45.00 ر.س')).toBeVisible() // 25.00 + 20.00
})

test('a digital-only cart shows no city; the coupon applies and the discount shows', async ({ page }) => {
  await addFixtures(page, [{ row: 'النسخة الإلكترونية', quantity: 2 }])
  await page.goto('/cart')
  await expect(page.getByLabel('مدينة التوصيل')).toHaveCount(0)
  await expect(page.getByText('30.00 ر.س')).toHaveCount(2) // subtotal and total

  await page.getByLabel('كود الخصم').fill(couponCode)
  await page.getByRole('button', { name: 'تطبيق' }).click()
  await expect(page.getByText('الخصم')).toBeVisible()
  await expect(page.getByText('27.00 ر.س')).toBeVisible()
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
  await enableCheckout()
  await addFixtures(page, [
    { row: 'النسخة الورقية', quantity: 2 },
    { row: 'النسخة الإلكترونية', quantity: 1 },
  ])
  await page.goto('/cart')
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(page.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toBeVisible()
  await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()

  const email = `buyer-${marker}-full@example.com`
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByLabel('الاسم').fill('مشترٍ')
  await page.getByLabel('رقم الجوال').fill('0501234567')
  await page.getByLabel('عنوان التوصيل').fill('تبوك شارع الرئيسي 12')
  await page.getByRole('checkbox').check()
  // The always-pass test widget solves itself; submission opens with the token.
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  // DATA step 5: the cart survives the hold; nothing is settled yet.
  await page.goto('/cart')
  await expect(page.locator('li', { hasText: 'النسخة الورقية' })).toBeVisible()

  // Back on the checkout, the pending order (and its cancel) survives the reload.
  await page.goto('/checkout')
  await expect(page.getByText('رقم الطلب:')).toBeVisible()
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
})

test('a price change between the quote and the submit asks for confirmation, then succeeds', async ({ page }) => {
  await addFixtures(page, [{ row: 'النسخة الورقية', quantity: 1 }])
  await page.goto('/cart')
  await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  await expect(page.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toBeVisible()
  await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()

  const email = `buyer-${marker}-price@example.com`
  await page.getByLabel('البريد الإلكتروني').fill(email)
  await page.getByLabel('الاسم').fill('مشترٍ')
  await page.getByLabel('رقم الجوال').fill('0501234567')
  await page.getByLabel('عنوان التوصيل').fill('تبوك شارع الرئيسي 12')
  await page.getByRole('checkbox').check()
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()

  // The owner reprices the paper edition while the buyer is on the form.
  await db.query('update public.product_variants set price_halalas = 3000 where id = $1', [paperId])
  await submit.click()
  await expect(page.getByText('تغيّر السعر أو التوفر؛ راجع الملخص المحدث.')).toBeVisible()
  await expect(page.getByText('50.00 ر.س')).toBeVisible() // 30.00 + 20.00

  await submit.click()
  await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
  await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
  await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  // Restore the fixture price the later tests assert against.
  await db.query('update public.product_variants set price_halalas = 2500 where id = $1', [paperId])
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
  await expect(page.getByText('كتاب الاختبار للمتجر')).toBeVisible()
  await expect(page.getByText(/من 15\.00 ر\.س/)).toBeVisible()
  await page.goto(`/store/${slug}`)
  await expect(page.getByText('25.00 ر.س')).toBeVisible()
  await context.close()
})

for (const width of [360, 1440]) {
  test(`screenshots and overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })

    await page.goto('/store')
    await expect(page.getByText('كتاب الاختبار للمتجر')).toBeVisible()
    await expectNoOverflow(page, `store ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-list-${width}.png`, fullPage: true })

    await page.goto(`/store/${slug}`)
    await expect(page.getByText('25.00 ر.س')).toBeVisible()
    await expectNoOverflow(page, `product ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-product-${width}.png`, fullPage: true })

    await addFixtures(page, [
      { row: 'النسخة الورقية', quantity: 2 },
      { row: 'النسخة الإلكترونية', quantity: 1 },
    ])
    await page.goto('/cart')
    await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
    await expect(page.getByText('85.00 ر.س')).toBeVisible()
    await expectNoOverflow(page, `cart ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-cart-${width}.png`, fullPage: true })

    await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()
    const email = `buyer-${marker}-shot-${width}@example.com`
    await page.getByLabel('البريد الإلكتروني').fill(email)
    await page.getByLabel('الاسم').fill('مشترٍ')
    await page.getByLabel('رقم الجوال').fill('0501234567')
    await page.getByLabel('عنوان التوصيل').fill('تبوك شارع الرئيسي 12')
    await expectNoOverflow(page, `checkout ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-checkout-${width}.png`, fullPage: true })

    await page.getByRole('checkbox').check()
    const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByText('حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.')).toBeVisible()
    await expectNoOverflow(page, `order ${width}`)
    await page.screenshot({ path: `${SHOTS}/store-order-${width}.png`, fullPage: true })

    await page.getByRole('button', { name: 'إلغاء الطلب' }).click()
    await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
  })
}

