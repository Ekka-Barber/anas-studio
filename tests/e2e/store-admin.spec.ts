// P07 round 2 e2e: the store admin (products, variants, shipping rates,
// coupons, customers) against `next dev` and the local stack, plus the
// "without code changes" proof — a non-book product, a physical variant and a
// city rate created entirely through the admin screens, then priced by the
// `checkout` function's own `quote` and ordered with `create` while checkout
// is on (a fixture, restored). The spec removes or retires everything it
// creates in afterAll: orders are deleted, the products archived, the rates
// and coupons disabled (no deletes — orders reference rows).
// P08 round 4b: the owner's checkout switch in the commerce settings form, with
// the step-up dialog, and an operations member who does not see it.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { expect, test, type Locator } from '@playwright/test'

import { createStaff, readCodeFromMailpit, readStatus, SENT_MESSAGE, signInByCode, SITE_ORIGIN, totpCode } from './helpers'
import { shotsDir } from './shots'

const status = readStatus()
const CHECKOUT = `${status.FUNCTIONS_URL}/checkout`

const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const slug = `p07-e2e-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const sku = `P07E2E-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')
const cityKey = `p07city${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const couponCode = `P07${Date.now()}`
const buyerEmail = `buyer-${marker}@example.com`
const productTitle = `منتج اختبار المتجر ${marker}`

let db: Client
let owner: { userId: string; email: string }
let saved: Record<string, unknown>
let productId: string
let variantId: string
let orderId: string | null = null

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  owner = await createStaff('owner')
  saved = (
    await db.query(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  ).rows[0]!
  await db.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
})

test.afterAll(async () => {
  // The settings first: a later failure must never leave the shared database with checkout off.
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
  if (orderId) {
    await db.query('delete from finance.payment_attempts where order_id = $1', [orderId])
    await db.query('delete from finance.order_items where order_id = $1', [orderId])
    await db.query('delete from finance.inventory_reservations where order_id = $1', [orderId])
    await db.query('delete from finance.coupon_redemptions where order_id = $1', [orderId])
    await db.query('delete from finance.orders where id = $1', [orderId])
    await db.query('delete from public.customers where email = $1', [buyerEmail])
  }
  // Retire, never delete: orders and audit reference the rows.
  await db.query("update public.products set status = 'archived' where slug = $1", [slug])
  await db.query('update public.shipping_rates set enabled = false where city_key = $1', [cityKey])
  await db.query('update public.coupons set enabled = false where code = $1', [couponCode])
  await db.end()
})

test('the owner creates a product, a variant and a city rate without code changes', async ({ page }) => {
  await signInByCode(page, owner.email)

  // The product.
  await page.goto('/admin/store')
  await expect(page.getByRole('heading', { name: 'المتجر' })).toBeVisible()
  await page.getByRole('link', { name: 'المنتجات' }).click()
  await page.getByRole('button', { name: 'جديد' }).click()
  await expect(page).toHaveURL(/\/admin\/store\/products\/edit\?id=new$/)
  await page.getByLabel('المعرّف').fill(slug)
  await page.getByLabel('العنوان').fill(productTitle)
  await page.getByLabel('الملخص').fill('ملخص منتج الاختبار')
  await page.getByLabel('الحالة').selectOption({ label: 'منشور' })
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/admin/store/products/edit\\?id=[0-9a-f-]{36}$`))
  productId = (
    await db.query<{ id: string }>('select id from public.products where slug = $1', [slug])
  ).rows[0]!.id

  // One physical variant at 45.50 with stock 3, from the product's own page.
  await page.getByRole('link', { name: 'إضافة خيار' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/store/variants/edit\\?id=new&product=${productId}$`))
  await page.getByLabel('رمز SKU').fill(sku.toLowerCase())
  await page.getByLabel('العنوان').fill('نسخة ورقية')
  await page.getByLabel('نوع التنفيذ').selectOption({ label: 'ورقي' })
  await expect(page.getByLabel('المخزون')).toBeVisible()
  await page.getByLabel('السعر').fill('45.50')
  await page.getByLabel('المخزون').fill('3')
  await page.getByLabel('معروض للبيع').check()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()

  const variant = (
    await db.query<{ id: string; price_halalas: number; stock: number; fulfillment: string }>(
      'select id, price_halalas, stock, fulfillment from public.product_variants where sku = $1',
      [sku],
    )
  ).rows[0]!
  expect(variant).toMatchObject({ price_halalas: 4550, stock: 3, fulfillment: 'physical' })
  variantId = variant.id

  // The product's page lists the variant with its price.
  await page.getByRole('link', { name: 'المنتج' }).click()
  await expect(page.getByRole('heading', { name: productTitle })).toBeVisible()
  await expect(page.getByText('45.50 ر.س').first()).toBeVisible()

  // A served city.
  await page.goto('/admin/store/shipping-rates')
  await page.getByRole('button', { name: 'جديد' }).click()
  await page.getByLabel('المعرّف').fill(cityKey)
  await page.getByLabel('اسم المدينة').fill(`مدينة الاختبار ${marker}`)
  await page.getByLabel('رسوم التوصيل').fill('25.00')
  await page.getByLabel('مفعّلة').check()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  const rate = (
    await db.query<{ fee_halalas: number; enabled: boolean }>('select fee_halalas, enabled from public.shipping_rates where city_key = $1', [
      cityKey,
    ])
  ).rows[0]!
  expect(rate).toEqual({ fee_halalas: 2500, enabled: true })
})

/** Posts one checkout action with the site origin and a per-run visitor IP. */
async function post(request: import('@playwright/test').APIRequestContext, body: unknown, origin = SITE_ORIGIN) {
  return request.post(CHECKOUT, {
    headers: { origin, 'cf-connecting-ip': `198.51.100.${(Math.random() * 254 | 0) + 1}` },
    data: body,
  })
}

test('the checkout function prices the admin-created catalog: total is price plus fee', async ({ request }) => {
  const response = await post(request, { action: 'quote', lines: [{ variantId, quantity: 1 }], cityKey })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    ok: boolean
    data: { ok: boolean; subtotal: number; shipping: number; total: number }
  }
  expect(body.ok).toBe(true)
  expect(body.data.ok).toBe(true)
  expect(body.data.subtotal).toBe(4550)
  expect(body.data.shipping).toBe(2500)
  expect(body.data.total).toBe(7050)
})

test('with checkout on (a fixture), a create reaches a persisted pending order', async ({ request }) => {
  // The demo policy revisions already in the row (D37); checkout on only here.
  await db.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار',
       seller_address = 'تبوك', seller_registration = 'P07-E2E', version = version + 1
     where id = 1`,
  )
  const quoted = (await (await post(request, { action: 'quote', lines: [{ variantId, quantity: 1 }], cityKey })).json()) as {
    data: { quoteHash: string }
  }
  const created = await post(request, {
    action: 'create',
    idempotencyKey: randomUUID(),
    checkoutSession: randomUUID(),
    lines: [{ variantId, quantity: 1 }],
    cityKey,
    address: 'تبوك شارع الرئيسي',
    email: buyerEmail,
    name: 'مشترٍ',
    phone: '0501234567',
    policyRevisions: saved.policy_revisions,
    quoteHash: quoted.data.quoteHash,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  })
  const createdBody = (await created.json()) as { ok: boolean; data: { order: { id: string; status: string } } }
  // Before any assertion: afterAll must find the order (and free its stock reservation) even when one fails.
  orderId = createdBody.data?.order?.id ?? null
  expect(created.status()).toBe(201)
  expect(createdBody.ok).toBe(true)
  expect(createdBody.data.order.status).toBe('pending_payment')
  const persisted = (
    await db.query<{ status: string }>('select status from finance.orders where id = $1', [createdBody.data.order.id])
  ).rows[0]!
  expect(persisted.status).toBe('pending_payment')

  // Leave the row off for the rest of the spec; afterAll restores the saved one.
  await db.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
})

test('a stale save shows the conflict and keeps the typed values', async ({ page }) => {
  await signInByCode(page, owner.email)
  const editUrl = `/admin/store/products/edit?id=${productId}`
  const second = await page.context().newPage()
  await page.goto(editUrl)
  await page.getByLabel('العنوان').waitFor()
  await second.goto(editUrl)
  await second.getByLabel('العنوان').waitFor()

  // The first page saves (the version bumps); the second one, still on the
  // old version, must be refused without losing its text.
  await page.getByLabel('العنوان').fill(`عنوان أول ${marker}`)
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()

  await second.getByLabel('العنوان').fill(`عنوان ثانٍ ${marker}`)
  await second.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(second.getByText('تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.')).toBeVisible()
  await expect(second.getByLabel('العنوان')).toHaveValue(`عنوان ثانٍ ${marker}`)
  await second.close()
})

test('a percentage coupon typed as 12.5 is stored as 1250 basis points', async ({ page }) => {
  await signInByCode(page, owner.email)
  await page.goto('/admin/store/coupons')
  await page.getByRole('button', { name: 'جديد' }).click()
  await page.getByLabel('الكود').fill(couponCode)
  await page.getByLabel('نوع الخصم').selectOption({ label: 'نسبة' })
  await page.getByLabel('النسبة المئوية').fill('12.5')
  await page.getByLabel('مفعّل').check()
  await page.getByRole('button', { name: 'حفظ', exact: true }).click()
  await expect(page.getByText('تم الحفظ.')).toBeVisible()
  const coupon = (
    await db.query<{ percent_bp: number; kind: string }>('select percent_bp, kind from public.coupons where code = $1', [couponCode])
  ).rows[0]!
  expect(coupon).toEqual({ percent_bp: 1250, kind: 'percent' })
})

test('an editor gets no store link', async ({ page }) => {
  const editor = await createStaff('editor')
  await signInByCode(page, editor.email)
  await page.goto('/admin')
  await expect(page.locator('nav').getByRole('link', { name: 'المتجر' })).toHaveCount(0)
})

test('an operations member sees the products list, no «جديد», and cannot save', async ({ page }) => {
  const operations = await createStaff('operations')
  await signInByCode(page, operations.email)
  await page.goto('/admin/store/products')
  await expect(page.getByRole('heading', { name: 'المنتجات' })).toBeVisible()
  await expect(page.getByText(slug)).toBeVisible()
  await expect(page.getByRole('button', { name: 'جديد' })).toHaveCount(0)

  // The edit page shows the values without inputs and without a save button.
  await page.goto(`/admin/store/products/edit?id=${productId}`)
  await expect(page.getByRole('heading', { name: new RegExp(marker) })).toBeVisible()
  await expect(page.getByLabel('العنوان')).toHaveCount(0)
  await expect(page.getByText('منشور')).toBeVisible()
  await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
})

test('the policies collection lists its four fixed documents', async ({ page }) => {
  await signInByCode(page, owner.email)
  await page.goto('/admin/content/policies')
  await expect(page.getByRole('heading', { name: 'السياسات' })).toBeVisible()
  for (const name of ['سياسة المتجر', 'سياسة التوصيل', 'سياسة الاسترجاع', 'سياسة الخصوصية']) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
  }
})

test('the owner closes and reopens checkout with the switch, through the step-up dialog', async ({ page }) => {
  const switcher = await createStaff('owner')
  // The store is ready to open: the seller named, the policies approved, checkout on.
  await db.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار', seller_address = 'تبوك',
       seller_registration = 'P08-E2E', policy_revisions = '{"store":1,"delivery":1,"refund":1}'::jsonb, version = version + 1
     where id = 1`,
  )

  // Sign in by email code and enrol TOTP (the auth.spec.ts way), then sign out and in again by code (aal1):
  // enrolment itself verified a TOTP, and the switch below must ask for one.
  await page.goto('/admin/sign-in')
  await page.getByLabel('البريد الإلكتروني').fill(switcher.email)
  await page.getByRole('button', { name: 'أرسل الرمز' }).click()
  await expect(page.getByText(SENT_MESSAGE)).toBeVisible()
  const firstCode = await readCodeFromMailpit(switcher.email)
  await page.getByLabel('رمز الدخول').fill(firstCode)
  await page.getByRole('button', { name: 'تحقق' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.locator('nav').getByRole('link', { name: 'الأمان' }).click()
  await expect(page).toHaveURL(/\/admin\/security$/)
  const secret = await page.locator('[class*="secret"]').innerText()
  await page.getByLabel('رمز التحقق').fill(totpCode(secret))
  await page.getByRole('button', { name: 'تفعيل' }).click()
  await expect(page.getByText('تطبيق المصادقة مفعّل')).toBeVisible()
  await page.locator('nav').getByRole('button', { name: 'تسجيل الخروج' }).click()
  await expect(page).toHaveURL(/\/admin\/sign-in$/)
  await signInByCode(page, switcher.email, firstCode)

  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'إعدادات المتجر' })).toBeVisible()
  const purchase = page.getByRole('group', { name: 'الشراء' })
  // The payments sentence is what `status` says, nothing more: here the emulator, in test mode.
  await expect(purchase.getByText('الدفع مضبوط: وضع تجريبي، محاكٍ محلي')).toBeVisible()
  await expect(purchase.getByText('الشراء مفتوح')).toBeVisible()

  // Closing asks for a fresh TOTP: the dialog opens, and the same call goes through after it.
  await purchase.getByRole('button', { name: 'أغلق الشراء' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رمز التحقق').fill(totpCode(secret))
  await dialog.getByRole('button', { name: 'تحقق' }).click()
  await expect(page.getByText('تم إغلاق الشراء.')).toBeVisible()
  await expect(purchase.getByText('الشراء مغلق')).toBeVisible()
  await expect(purchase.getByRole('button', { name: 'افتح الشراء' })).toBeVisible()
  expect((await db.query('select checkout_enabled from finance.commerce_settings where id = 1')).rows[0]).toEqual({ checkout_enabled: false })

  // Reopening goes through with the fresh TOTP still valid, and the state and the version update without a reload.
  const closedVersion = (await db.query<{ version: number }>('select version from finance.commerce_settings where id = 1')).rows[0]!.version
  await expect(page.getByText(`إصدار الإعدادات: ${closedVersion}`)).toBeVisible()
  await purchase.getByRole('button', { name: 'افتح الشراء' }).click()
  await expect(page.getByText('تم فتح الشراء.')).toBeVisible()
  await expect(purchase.getByText('الشراء مفتوح')).toBeVisible()
  await expect(purchase.getByRole('button', { name: 'أغلق الشراء' })).toBeVisible()
  expect((await db.query('select checkout_enabled from finance.commerce_settings where id = 1')).rows[0]).toEqual({ checkout_enabled: true })
  await expect(page.getByText(`إصدار الإعدادات: ${closedVersion + 1}`)).toBeVisible()

  // A change made elsewhere meanwhile: the stale version is refused with the function's words, and nothing changes.
  await db.query('update finance.commerce_settings set version = version + 1 where id = 1')
  await purchase.getByRole('button', { name: 'أغلق الشراء' }).click()
  await expect(page.getByText('تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.')).toBeVisible()
  expect((await db.query('select checkout_enabled from finance.commerce_settings where id = 1')).rows[0]).toEqual({ checkout_enabled: true })

  // Opening with no seller named is refused too, in the function's words, and the store stays closed.
  await db.query('update finance.commerce_settings set checkout_enabled = false, seller_legal_name = null, version = version + 1 where id = 1')
  await page.reload()
  await expect(purchase.getByText('الشراء مغلق')).toBeVisible()
  await purchase.getByRole('button', { name: 'افتح الشراء' }).click()
  await expect(page.getByText('أكمل بيانات البائع واعتمد السياسات أولًا.')).toBeVisible()
  await expect(purchase.getByText('الشراء مغلق')).toBeVisible()
  expect((await db.query('select checkout_enabled from finance.commerce_settings where id = 1')).rows[0]).toEqual({ checkout_enabled: false })
  // The later screenshots find the store as it was ready to open (afterAll restores what the database held before).
  await db.query(
    "update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار', version = version + 1 where id = 1",
  )
})

test('an operations member does not see the checkout switch', async ({ page }) => {
  const operations = await createStaff('operations')
  await signInByCode(page, operations.email)
  await page.goto('/admin/settings')
  await expect(page.getByText('هذه الصفحة للمالك فقط.')).toBeVisible()
  await expect(page.getByRole('group', { name: 'الشراء' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(افتح|أغلق) الشراء$/ })).toHaveCount(0)
})

test('screenshots at 360 and 1440 with no horizontal overflow', async ({ page }) => {
  await signInByCode(page, owner.email)
  const shots = mkdirScreenshots()
  // Waits are the DATA, not the chrome, and must be visible at both widths.
  const targets: Array<{ name: string; path: string; wait: string | Locator }> = [
    { name: 'store-home', path: '/admin/store', wait: page.getByRole('link', { name: 'المنتجات' }) },
    { name: 'products', path: '/admin/store/products', wait: page.getByText(slug) },
    { name: 'product', path: `/admin/store/products/edit?id=${productId}`, wait: page.getByText('45.50 ر.س').first() },
    { name: 'rates', path: '/admin/store/shipping-rates', wait: page.getByText(`مدينة الاختبار ${marker}`) },
    { name: 'coupon-form', path: '/admin/store/coupons/edit?id=new', wait: page.getByLabel('نوع الخصم') },
    { name: 'settings-policies', path: '/admin/settings', wait: page.getByText('ريال سعودي').first() },
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
      expect(scroll, `${target.name}-${viewport.width}: scrollWidth ${scroll}, innerWidth ${inner}`).toBeLessThanOrEqual(inner)
      expect(tableOverflow, `${target.name}-${viewport.width}: a table scrolls sideways by ${tableOverflow}px`).toBe(0)
      expect(offscreenControls, `${target.name}-${viewport.width}: row controls off screen`).toBe(0)
      await page.screenshot({ path: join(shots, `${target.name}-${viewport.width}.png`), fullPage: true })
    }
  }
})

function mkdirScreenshots(): string {
  const dir = shotsDir('P07')
  mkdirSync(dir, { recursive: true })
  return dir
}
