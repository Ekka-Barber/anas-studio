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
// P08 round 11c (the block at the end): the variant form's preorder fields, the count of
// confirmed preorders and the paid-file upload, the read-only sign-ups list and the
// statistics screen's commerce figures, each test at 360 and 1440.
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'

import { formatDate, formatMoney, formatNumber } from '../../src/lib/format'
import { commerceHarness, type Harness, type Paid } from '../integration/support'
import { createStaff, localEnv, readCodeFromMailpit, readStatus, SENT_MESSAGE, serviceClient, signInByCode, SITE_ORIGIN, totpCode } from './helpers'
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

// =====================================================================================================================
// P08 round 11c: the variant form's preorder fields, the count of confirmed preorders and the paid file, the read-only
// list of availability sign-ups, and the statistics screen's commerce figures. Real sign-in (an email code per role, once),
// real stack, no mock except where a test says so: the orders come from the integration harness
// (tests/integration/support.ts: `checkout_create`, `apply_verified_payment`), the upload goes through the real `admin`
// function and the real Storage, the figures are compared with `owner_commerce_stats` called as the service role for the
// same days. Each test runs at 360 and at 1440, on variants seeded for that width. The statistics days are one old day
// (2002 to 2024: a dispute cannot be dated in the future) that holds nothing yet (its paid orders, refund, review payment and
// two disputes are this run's: disputes cannot be deleted). Screenshots land in admin-*.png under shotsDir('P08'). The block retires what it made with the harness's
// `stop()` and removes the paid files it uploaded from Storage.
// =====================================================================================================================

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const SHOTS = shotsDir('P08')
const STATES = { owner: 'test-results/store-admin/owner.json', operations: 'test-results/store-admin/operations.json' }
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
)
const PREORDER_NAMES = ['سعة الطلب المسبق', 'موعد التسليم', 'ملاحظة الطلب المسبق'] as const
const NO_FILE = 'لا يوجد ملف بعد'
const REPLACE_NOTE = 'يحل الملف الجديد محل الحالي في الطلبات الجديدة؛ الطلبات التي استلمت ملفًا تبقى عليه.'
const BUSY_MESSAGE = 'الطلبات المرتبطة بهذا الملف قيد المعالجة؛ أعد المحاولة بعد لحظات.'
const COMMERCE_NOTE =
  'الصافي هنا هو إجمالي المدفوع ناقص الاستردادات المؤكدة. لا يشمل رسوم بوابة الدفع ولا الاعتراضات ولا توقيت التحويل، وليس نقدًا مُسوّى في البنك ولا ربحًا.'
const NOT_CONFIGURED = 'غير مُعدّ بعد. تظهر أرقامه عند افتتاح المتجر.'
const BAD_REPLY = 'تعذّر قراءة الرد؛ حدّث الصفحة.'

type Member = { userId: string; email: string }
type Variant = { id: string; sku: string; title: string }
type Ledger = {
  environment: string
  paidOrders: number
  grossPaid: number
  refundsConfirmed: number
  netCollected: number
  customers: number
  review: { open: number; captured: number; refunded: number }
  disputes: { count: number; againstSeller: number; forSeller: number }
}
interface Seed {
  product: string
  newSku: string
  newTitle: string
  preorder: Variant
  plain: Variant
  waiting: { variant: Variant; order: Paid }
  busy: Variant
  empty: Variant
  saves: Variant
  clash: Variant
  refused: Variant
  stale: Variant
  filed: { variant: Variant; filename: string }
  signups: { variant: Variant; confirmed: string; pending: string; gone: string }
}

let h: Harness
let owner11c: Member
let operations11c: Member
let statsDay = ''

const pad = (n: number): string => String(n).padStart(2, '0')
const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
const riyadhToday = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const variantUrl = (id: string): string => `/admin/store/variants/edit?id=${id}`

/** `owner_commerce_stats` as the `admin` function calls it, as the service role: what the screen must show for the same days. */
async function ledger(from: string, to: string): Promise<Ledger> {
  const { data, error } = await serviceClient.rpc('owner_commerce_stats', {
    p_from: `${from}T00:00:00+03:00`,
    p_to: `${dayAfter(to)}T00:00:00+03:00`,
    p_environment: 'test',
  })
  if (error) throw new Error(`owner_commerce_stats: ${error.message}`)
  return data as Ledger
}

/** A day between 2002 and 2024 that the ledger holds nothing for: this run's figures are the only ones on it. */
async function emptyDay(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const day = `${2002 + Math.floor(Math.random() * 23)}-${pad(1 + Math.floor(Math.random() * 12))}-${pad(1 + Math.floor(Math.random() * 28))}`
    const found = await ledger(day, day)
    if (found.paidOrders === 0 && found.refundsConfirmed === 0 && found.review.captured === 0 && found.disputes.count === 0) return day
  }
  throw new Error('no empty day found in the local ledger')
}

/** Two paid orders, a full refund of the first, a review payment on the second and two disputes, all dated `day`. */
async function seedStats(day: string): Promise<void> {
  const noon = `${day}T09:00:00Z`
  const variant = await h.physical(4000, 50)
  const first = await h.paid([{ variantId: variant, quantity: 1 }])
  const second = await h.paid([{ variantId: variant, quantity: 1 }])
  for (const order of [first, second]) {
    await h.postgres.query('update finance.payment_attempts set paid_at = $2 where id = $1', [order.attemptId, noon])
    await h.postgres.query('update finance.orders set paid_at = $2 where id = $1', [order.id, noon])
  }
  await h.refundFully(first, owner11c.userId)
  await h.postgres.query('update finance.refunds set succeeded_at = $2 where attempt_id = $1', [first.attemptId, noon])
  // A second payment on a paid invoice is money in review.
  const extra = randomUUID()
  expect(await h.applyPayment(second, { invoiceId: second.invoiceId, paymentId: extra })).toMatchObject({ outcome: 'review' })
  await h.postgres.query('update finance.payment_reviews set created_at = $2 where provider_payment_id = $1', [extra, noon])
  for (const [kind, direction, amount] of [
    ['payout_difference', 'against_seller', 3000],
    ['fee_difference', 'for_seller', 500],
  ] as const) {
    const recorded = await h.call('dispute_record', {
      p_actor: owner11c.userId,
      p_kind: kind,
      p_provider_ref: `E2E-${marker}-${kind}`,
      p_follows: 0,
      p_attempt: null,
      p_review_payment: null,
      p_amount: amount,
      p_direction: direction,
      p_occurred_on: day,
      p_reason: 'فرق من كشف التسوية',
      p_resolution: null,
      p_decision: 'none',
      p_item_ids: '{}',
      p_environment: 'test',
    })
    expect(recorded, JSON.stringify(recorded)).toMatchObject({ ok: true })
  }
}

async function seed(width: number): Promise<Seed> {
  const tag = `${width}-${marker}`
  const variantOf = async (id: string): Promise<Variant> => {
    const found = await h.row('select sku, title from public.product_variants where id = $1', [id])
    return { id, sku: found.sku as string, title: found.title as string }
  }
  const product = await h.makeProduct()
  // A physical preorder with two confirmed units, an ordinary variant, and three digital ones: a preorder whose buyer
  // waits for the file, one with no order at all, and a preorder whose file is already recorded.
  const preorder = await variantOf(await h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0, preorder: { capacity: 20 } }))
  await h.paid([{ variantId: preorder.id, quantity: 2 }])
  const plain = await variantOf(await h.physical(4000, 5))
  const waiting = await variantOf(await h.makeVariant({ fulfillment: 'digital', price: 3500, preorder: { capacity: 5 } }))
  const waitingOrder = await h.paid([{ variantId: waiting.id, quantity: 1 }])
  const busy = await variantOf(await h.digital())
  const empty = await variantOf(await h.digital())
  // Three more with no file: the saves that follow an upload (the version the record bumps) and the reading that fails after one are tried on them.
  const saves = await variantOf(await h.digital())
  const clash = await variantOf(await h.digital())
  const refused = await variantOf(await h.digital())
  const stale = await variantOf(await h.digital())
  const filed = await variantOf(await h.makeVariant({ fulfillment: 'digital', price: 3500, preorder: { capacity: 5 } }))
  await h.paid([{ variantId: filed.id, quantity: 1 }])
  const filename = `filed-${tag}.pdf`
  const set = await h.call('paid_asset_set', {
    p_actor: owner11c.userId,
    p_variant: filed.id,
    p_storage_key: `assets/${filed.id}/${randomUUID()}`,
    p_filename: filename,
    p_mime: 'application/pdf',
    p_bytes: 2048,
  })
  expect(set, JSON.stringify(set)).toMatchObject({ ok: true })
  // Three sign-ups for a variant that is out of stock (the only state one is taken for), made as the `notify` function
  // makes them, as the service role: confirmed, then one that left, then one still waiting for its confirmation (the newest).
  const signups = {
    variant: await variantOf(await h.physical(4000, 0)),
    confirmed: `signup-confirmed-${tag}@example.com`,
    pending: `signup-pending-${tag}@example.com`,
    gone: `signup-gone-${tag}@example.com`,
  }
  const subscribe = async (email: string, consent: number | null): Promise<{ id: string; version: number }> => {
    await h.call('notify_subscribe', { p_ip_hash: h.ipHash(), p_email: email, p_variant: signups.variant.id, p_consent_revision: consent })
    const row = await h.row('select id, token_version from public.notifications where email = $1 and variant_id = $2', [email, signups.variant.id])
    return { id: row.id as string, version: Number(row.token_version) }
  }
  const confirmed = await subscribe(signups.confirmed, 3)
  await h.call('notify_confirm', { p_id: confirmed.id, p_token_version: confirmed.version })
  const gone = await subscribe(signups.gone, null)
  await h.call('notify_unsubscribe', { p_id: gone.id, p_token_version: gone.version })
  await subscribe(signups.pending, null)
  const states = await h.rows('select email, status from public.notifications where variant_id = $1', [signups.variant.id])
  expect(Object.fromEntries(states.map((row) => [row.email, row.status]))).toEqual({
    [signups.confirmed]: 'confirmed',
    [signups.gone]: 'unsubscribed',
    [signups.pending]: 'pending',
  })
  return { product, newSku: `P11C${width}${Date.now()}`, newTitle: `خيار طلب مسبق ${tag}`, preorder, plain, waiting: { variant: waiting, order: waitingOrder }, busy, empty, saves, clash, refused, stale, filed: { variant: filed, filename }, signups }
}

test.describe('round 11c: the catalog and the figures', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000)
    mkdirSync(SHOTS, { recursive: true })
    h = await commerceHarness(localEnv().TOKEN_HASH_PEPPER ?? `store-admin-pepper-${randomUUID()}`)
    owner11c = await h.makeStaff('owner')
    operations11c = await h.makeStaff('operations')
    // One real sign-in per role; the tests start from the session it left.
    for (const [role, member] of [
      ['owner', owner11c],
      ['operations', operations11c],
    ] as const) {
      const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', storageState: { cookies: [], origins: [] } })
      await signInByCode(await context.newPage(), member.email)
      await context.storageState({ path: STATES[role] })
      await context.close()
    }
    statsDay = await emptyDay()
    await seedStats(statsDay)
    // `next dev` compiles a page on its first request: do it once, before any test has a clock running.
    for (const route of ['/admin/sign-in', '/admin', '/admin/store', '/admin/store/notifications', '/admin/store/variants/edit', '/admin/stats']) {
      await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
    }
  })

  test.afterAll(async () => {
    rmSync('test-results/store-admin', { recursive: true, force: true })
    // The paid files this run recorded: the ledger keeps its rows (orders reference them), the objects are what takes room.
    const keys = (
      await h.rows('select a.storage_key from finance.paid_assets a join public.product_variants v on v.id = a.variant_id where v.product_id = any($1::uuid[])', [h.created.products])
    ).map((row) => row.storage_key as string)
    if (keys.length > 0) await serviceClient.storage.from('paid-files').remove(keys)
    await h?.stop()
  })

  for (const width of [360, 1440]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 1000 } })

      let s: Seed
      test.beforeAll(async () => {
        test.setTimeout(300_000)
        s = await seed(width)
      })

      const main = (page: Page): Locator => page.locator('main')
      const button = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true })
      const shoot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${SHOTS}/admin-${name}-${width}.png`, fullPage: true })

      /** The console errors and uncaught exceptions of the page: what a React warning or a render that throws looks like in `next dev`. */
      function watchProblems(page: Page): string[] {
        const problems: string[] = []
        page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(`console: ${message.text().slice(0, 300)}`)
        })
        return problems
      }

      /** The bodies the page posts to the `admin` function, in order. */
      function watchAdmin(page: Page): Array<Record<string, unknown>> {
        const bodies: Array<Record<string, unknown>> = []
        page.on('request', (request) => {
          if (request.method() !== 'POST' || !request.url().includes('/functions/v1/admin')) return
          try {
            bodies.push(request.postDataJSON() as Record<string, unknown>)
          } catch {
            // Not JSON: nothing to read.
          }
        })
        return bodies
      }

      /** The headers a fulfilled cross-origin answer needs (the functions are another origin than the site). */
      const cors = (request: Request): Record<string, string> => ({
        'access-control-allow-origin': request.headers().origin ?? '*',
        'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'content-type': 'application/json',
      })

      /** The page does not scroll sideways, and no table scrolls the page. */
      async function expectNoOverflow(page: Page, label: string): Promise<void> {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(1)
      }

      /** Each control is at least 44px high: the smallest touch target. */
      async function expectTargets(controls: Locator[], label: string): Promise<void> {
        for (const control of controls) {
          const box = await control.boundingBox()
          expect(box, `${label}: a control is not drawn`).not.toBeNull()
          expect(box!.height, `${label}: ${await control.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName)} is under 44px`).toBeGreaterThanOrEqual(43.9)
        }
      }

      // ================================================================================================ the owner
      test.describe('the owner', () => {
        test.use({ storageState: STATES.owner })

        test('shows the preorder fields only while «طلب مسبق» is on, refuses a missing note and a past date, and reads a saved preorder back', async ({ page }) => {
          const problems = watchProblems(page)
          await page.goto(`/admin/store/variants/edit?id=new&product=${s.product}`)
          const area = main(page)
          const preorder = area.getByLabel('طلب مسبق', { exact: true })
          const list = area.locator('#table-form-problems')
          await expect(area.getByLabel('رمز SKU')).toBeVisible()
          // Off: none of the three, and no count of preorders for a variant that is not saved yet.
          for (const name of PREORDER_NAMES) await expect(area.getByLabel(name)).toHaveCount(0)
          await expect(preorder).not.toBeChecked()
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)

          await area.getByLabel('رمز SKU').fill(s.newSku.toLowerCase())
          await area.getByLabel('العنوان').fill(s.newTitle)
          await area.getByLabel('نوع التنفيذ').selectOption({ label: 'ورقي' })
          await area.getByLabel('السعر').fill('45.50')
          await area.getByLabel('المخزون').fill('0')
          await area.getByLabel('معروض للبيع').check()
          await expect(list).toHaveText('')

          // On: the three appear empty, the note with its hint, and each is required: the problems name them.
          await preorder.check()
          for (const name of PREORDER_NAMES) await expect(area.getByLabel(name)).toBeVisible()
          await expect(area.getByLabel('سعة الطلب المسبق')).toHaveValue('')
          await expect(area.getByLabel('موعد التسليم')).toHaveValue('')
          await expect(area.getByLabel('ملاحظة الطلب المسبق')).toHaveValue('')
          await expect(area.getByText('تظهر للمشتري قبل الدفع.')).toBeVisible()
          await expect(list).toContainText('سعة الطلب المسبق: أدخل رقمًا.')
          await expect(list).toContainText('موعد التسليم: اختر يومًا.')
          await expect(list).toContainText('ملاحظة الطلب المسبق: لا يمكن أن يكون فارغًا.')
          // Save is refused: while the values are invalid it is aria-disabled, not disabled, so a keyboard press reaches it and the
          // focus goes to the problems; nothing is written.
          await button(area, 'حفظ').focus()
          await page.keyboard.press('Enter')
          await expect(list).toBeFocused()
          expect(await h.count('select count(*)::int as n from public.product_variants where sku = $1', [s.newSku])).toBe(0)

          // A past date (it would take the variant off sale) and a note of blanks are refused by name; today is allowed.
          await area.getByLabel('سعة الطلب المسبق').fill('25')
          await area.getByLabel('موعد التسليم').fill('2020-01-01')
          await area.getByLabel('ملاحظة الطلب المسبق').fill('   ')
          await expect(list).toContainText('موعد التسليم: يجب ألا يكون قبل اليوم، وإلا خرج الخيار من البيع.')
          await expect(list).toContainText('ملاحظة الطلب المسبق: لا يمكن أن يكون فارغًا.')
          await expect(list).not.toContainText('سعة الطلب المسبق')
          await area.getByLabel('موعد التسليم').fill(riyadhToday())
          await expect(list).not.toContainText('موعد التسليم')
          await area.getByLabel('موعد التسليم').fill('2030-05-20')
          await area.getByLabel('ملاحظة الطلب المسبق').fill('يصلك بعد الطباعة، قرابة شهرين.')
          await expect(list).toHaveText('')
          await expectNoOverflow(page, 'the variant form, preorder on')
          await expectTargets([area.getByLabel('سعة الطلب المسبق'), area.getByLabel('موعد التسليم'), area.getByLabel('ملاحظة الطلب المسبق'), button(area, 'حفظ')], 'the preorder fields')
          await shoot(page, 'variant-preorder')

          await button(area, 'حفظ').click()
          await expect(area.getByText('تم الحفظ.')).toBeVisible()
          const saved = await h.row(
            "select preorder, preorder_capacity, to_char(preorder_ships_on, 'YYYY-MM-DD') as day, preorder_note, stock, fulfillment from public.product_variants where sku = $1",
            [s.newSku],
          )
          expect(saved).toEqual({ preorder: true, preorder_capacity: 25, day: '2030-05-20', preorder_note: 'يصلك بعد الطباعة، قرابة شهرين.', stock: 0, fulfillment: 'physical' })

          // Read back after a reload: the flag, the three values, and the (empty) count a preorder always shows.
          await page.reload()
          await expect(area.getByRole('heading', { level: 1, name: s.newTitle })).toBeVisible()
          await expect(preorder).toBeChecked()
          await expect(area.getByLabel('سعة الطلب المسبق')).toHaveValue('25')
          await expect(area.getByLabel('موعد التسليم')).toHaveValue('2030-05-20')
          await expect(area.getByLabel('ملاحظة الطلب المسبق')).toHaveValue('يصلك بعد الطباعة، قرابة شهرين.')
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 0', { exact: true })).toBeVisible()
          await expect(area.getByText('أدخل المخزون الفعلي بعد طرح هذه الطلبات.')).toBeVisible()

          // Switched off: the three go, the save sends false and null for them, and the empty count goes with the flag.
          await preorder.uncheck()
          for (const name of PREORDER_NAMES) await expect(area.getByLabel(name)).toHaveCount(0)
          await button(area, 'حفظ').click()
          await expect(area.getByText('تم الحفظ.')).toBeVisible()
          expect(
            await h.row('select preorder, preorder_capacity, preorder_ships_on, preorder_note from public.product_variants where sku = $1', [s.newSku]),
          ).toEqual({ preorder: false, preorder_capacity: null, preorder_ships_on: null, preorder_note: null })
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          expect(problems).toEqual([])
        })

        test('shows the confirmed preorders of a preorder variant, none for an ordinary one, and keeps showing them once it is switched off', async ({ page }) => {
          const problems = watchProblems(page)
          const area = main(page)
          await page.goto(variantUrl(s.preorder.id))
          await expect(area.getByRole('heading', { level: 1, name: s.preorder.title })).toBeVisible()
          // The two units a paid order confirmed, and what the owner does with them.
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 2', { exact: true })).toBeVisible()
          await expect(area.getByText('أدخل المخزون الفعلي بعد طرح هذه الطلبات.')).toBeVisible()
          // The saved preorder, read back (what the harness wrote).
          await expect(area.getByLabel('طلب مسبق', { exact: true })).toBeChecked()
          await expect(area.getByLabel('سعة الطلب المسبق')).toHaveValue('20')
          await expect(area.getByLabel('موعد التسليم')).toHaveValue('2030-01-01')
          await expect(area.getByLabel('ملاحظة الطلب المسبق')).toHaveValue('يصلك بعد الطباعة')
          // A physical variant has no paid file section, and the panel's two lines are mounted all the same (nothing is said there).
          await expect(area.getByText('الملف المدفوع')).toHaveCount(0)
          await expect(page.locator('#variant-commerce-status')).toHaveText('')
          await expect(page.locator('#variant-commerce-alert')).toHaveText('')
          await expectNoOverflow(page, 'a preorder variant')

          // An ordinary variant that sold nothing as a preorder: no count, no sentence.
          await page.goto(variantUrl(s.plain.id))
          await expect(area.getByRole('heading', { level: 1, name: s.plain.title })).toBeVisible()
          await expect(area.getByLabel('طلب مسبق', { exact: true })).not.toBeChecked()
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          await expect(area.getByText('أدخل المخزون الفعلي بعد طرح هذه الطلبات.')).toHaveCount(0)

          // Switched off with the units still confirmed (the copies arrived): the count stays, to net out of the stock.
          await h.postgres.query('update public.product_variants set preorder = false, preorder_capacity = null, preorder_ships_on = null, preorder_note = null, stock = 5 where id = $1', [s.preorder.id])
          await page.goto(variantUrl(s.preorder.id))
          await expect(area.getByLabel('طلب مسبق', { exact: true })).not.toBeChecked()
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 2', { exact: true })).toBeVisible()
          for (const name of PREORDER_NAMES) await expect(area.getByLabel(name)).toHaveCount(0)
          expect(problems).toEqual([])
        })

        test('says it could not read the variant, never a zero, offers «تحديث», puts what a new reading finds on a line that takes the focus, and says when the variant is gone', async ({ page }) => {
          const problems = watchProblems(page)
          const failure = { status: 500, body: { code: 'XX000', message: 'boom', details: null, hint: null } }
          let reply: { status: number; body: unknown } | null = failure
          // What the Data API answers `variant_admin_info` instead of the stack; null lets the real one through.
          await page.route('**/rest/v1/rpc/variant_admin_info', (route) => {
            const request = route.request()
            if (request.method() === 'OPTIONS' || reply === null) return route.continue()
            return route.fulfill({ status: reply.status, headers: cors(request), body: JSON.stringify(reply.body) })
          })
          const area = main(page)
          const alertLine = page.locator('#variant-commerce-alert')
          const statusLine = page.locator('#variant-commerce-status')
          await page.goto(variantUrl(s.preorder.id))
          // A failed read: said on the alert line (mounted before, so it is announced when filled; the first reading takes no focus), no
          // count (never a zero in its place), and the form itself is there.
          await expect(alertLine).toHaveText('تعذّر التحميل.')
          await expect(alertLine).not.toBeFocused()
          await expect(area.getByLabel('رمز SKU')).toBeVisible()
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          await expectTargets([button(area, 'تحديث')], 'the refresh button')
          // A reply that is not the shape of the answer is no answer either: the button stays, and the alert line takes the focus.
          reply = { status: 200, body: { ok: true, preorderUnits: 'many', file: null } }
          await button(area, 'تحديث').click()
          await expect(alertLine).toBeFocused()
          await expect(alertLine).toHaveText('تعذّر التحميل.')
          await expect(statusLine).toHaveText('')
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          await expect(button(area, 'تحديث')).toBeVisible()
          // The variant gone: said on the alert line, which takes the focus; there is nothing left to refresh.
          reply = { status: 200, body: { ok: false, code: 'NOT_FOUND' } }
          await button(area, 'تحديث').click()
          await expect(alertLine).toHaveText('لم نجد هذا الخيار.')
          await expect(alertLine).toBeFocused()
          await expect(area.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
          // The real answer after «تحديث»: «تم التحديث.» on the status line, which takes the focus from the button that went with it.
          reply = failure
          await page.reload()
          await expect(alertLine).toHaveText('تعذّر التحميل.')
          reply = null
          await button(area, 'تحديث').click()
          await expect(statusLine).toHaveText('تم التحديث.')
          await expect(statusLine).toBeFocused()
          await expect(alertLine).toHaveText('')
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 2', { exact: true })).toBeVisible()
          await expect(area.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
          // A variant that is gone on the first reading is said in the function's own words, and takes no focus.
          reply = { status: 200, body: { ok: false, code: 'NOT_FOUND' } }
          await page.goto(variantUrl(s.preorder.id))
          await expect(alertLine).toHaveText('لم نجد هذا الخيار.')
          await expect(alertLine).not.toBeFocused()
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          expect(problems).toEqual([])
        })

        test('refuses before any call what is not a PDF or an EPUB, an empty file and a bad name, and shows the function\'s refusal of a text file renamed .pdf', async ({ page }) => {
          const problems = watchProblems(page)
          const bodies = watchAdmin(page)
          await page.goto(variantUrl(s.busy.id))
          const area = main(page)
          const input = area.getByLabel('رفع الملف المدفوع')
          const alertLine = page.locator('#variant-commerce-alert')
          await expect(area.getByRole('heading', { level: 2, name: 'الملف المدفوع' })).toBeVisible()
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          await expect(input).toHaveAttribute('accept', '.pdf,.epub')
          await expect(input).toBeEnabled()
          await expect(area.getByText(REPLACE_NOTE)).toHaveCount(0)
          await expectTargets([input], 'the upload input')

          const refused = async (file: { name: string; mimeType: string; buffer: Buffer }, sentence: string): Promise<void> => {
            await input.setInputFiles(file)
            await expect(alertLine).toHaveText(sentence)
            await expect(alertLine).toBeFocused()
          }
          await refused({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, 'اختر ملف PDF أو EPUB.')
          await refused({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }, 'الملف فارغ.')
          await refused(
            { name: `${'a'.repeat(120)}.pdf`, mimeType: 'application/pdf', buffer: PDF_BYTES },
            'اسم الملف غير صالح؛ يجب ألا يزيد على 120 حرفًا ولا يحوي شرطة مائلة.',
          )
          await refused({ name: 'dir\\book.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES }, 'اسم الملف غير صالح؛ يجب ألا يزيد على 120 حرفًا ولا يحوي شرطة مائلة.')
          // None of it reached the function, and the variant is still without a file.
          expect(bodies.filter((body) => String(body.action).startsWith('paid-file'))).toEqual([])
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()

          // A text file that says it is a PDF passes the browser's checks and is refused by the function, in its words.
          const completion = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              response.url().includes('/functions/v1/admin') &&
              (response.request().postDataJSON() as { action?: string } | null)?.action === 'paid-file-complete',
          )
          await input.setInputFiles({ name: `fake-${marker}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('this is plain text, not a PDF') })
          const refusal = await completion
          expect(refusal.status()).toBe(422)
          expect(((await refusal.json()) as { error?: { code?: string } }).error?.code).toBe('NOT_A_PDF')
          await expect(alertLine).toHaveText('الملف ليس بصيغة PDF صالحة.')
          await expect(alertLine).toBeFocused()
          await expect(input).toBeEnabled()
          await expect(page.locator('#variant-commerce-status')).toHaveText('')
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          expect(bodies.map((body) => body.action)).toEqual(['paid-file-ticket', 'paid-file-complete'])
          expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.busy.id])).toBe(0)
          expect(problems).toEqual([])
        })

        test('uploads a real PDF, shows it, hands it to the order that waited for it, and a second file replaces it for new orders only', async ({ page }) => {
          const problems = watchProblems(page)
          await page.goto(variantUrl(s.waiting.variant.id))
          const area = main(page)
          const input = area.getByLabel('رفع الملف المدفوع')
          const statusLine = page.locator('#variant-commerce-status')
          const name = `e2e-${width}-${marker}.pdf`
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 1', { exact: true })).toBeVisible()
          const orderId = s.waiting.order.id
          expect((await h.row('select asset_id from finance.entitlements where order_id = $1', [orderId])).asset_id).toBeNull()

          await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(statusLine).toHaveText('رُفع الملف. وأُرسل رابط التنزيل إلى 1 من الطلبات المنتظرة.')
          await expect(statusLine).toBeFocused()
          await expect(page.locator('#variant-commerce-alert')).toHaveText('')
          await expect(area.getByText(new RegExp(`${esc(name)}، 1 كيلوبايت، رُفع .*\\d{4}`))).toBeVisible()
          await expect(area.getByText(NO_FILE, { exact: true })).toHaveCount(0)
          await expect(area.getByText(REPLACE_NOTE)).toBeVisible()
          await expect(input).toBeEnabled()
          await expectNoOverflow(page, 'a digital variant with its file')
          await shoot(page, 'variant-file')

          // The ledger: the asset, the variant pointing at it, the waiting entitlement filled, the buyer's mail queued, the object stored.
          const first = await h.row(
            'select a.id, a.filename, a.mime, a.bytes, a.storage_key, v.digital_asset from finance.paid_assets a join public.product_variants v on v.id = a.variant_id where a.variant_id = $1',
            [s.waiting.variant.id],
          )
          expect(first).toMatchObject({ filename: name, mime: 'application/pdf' })
          expect(Number(first.bytes)).toBe(PDF_BYTES.length)
          expect(first.digital_asset).toBe(first.storage_key)
          expect((first.storage_key as string).startsWith(`assets/${s.waiting.variant.id}/`)).toBe(true)
          expect((await h.row('select asset_id from finance.entitlements where order_id = $1', [orderId])).asset_id).toBe(first.id)
          expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'order_ready' and payload ->> 'orderId' = $1", [orderId])).toBe(1)
          const stored = await serviceClient.storage.from('paid-files').list(`assets/${s.waiting.variant.id}`)
          expect(stored.error).toBeNull()
          expect(stored.data?.map((object) => object.name)).toEqual([first.id])

          // A second file is the same upload: nobody waits any more, so only «رُفع الملف.»; the first buyer keeps the first file.
          const second = `second-${width}-${marker}.pdf`
          await input.setInputFiles({ name: second, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(statusLine).toHaveText('رُفع الملف.')
          await expect(area.getByText(new RegExp(`${esc(second)}، 1 كيلوبايت، رُفع `))).toBeVisible()
          await expect(area.getByText(name)).toHaveCount(0)
          expect((await h.row('select asset_id from finance.entitlements where order_id = $1', [orderId])).asset_id).toBe(first.id)
          expect((await h.row('select a.filename from finance.paid_assets a join public.product_variants v on v.digital_asset = a.storage_key where v.id = $1', [s.waiting.variant.id])).filename).toBe(second)
          expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.waiting.variant.id])).toBe(2)
          expect(problems).toEqual([])
        })

        test('keeps the ticket when the function answers BUSY, and «أعد المحاولة» completes the same ticket again', async ({ page }) => {
          const problems = watchProblems(page)
          const completes: Array<Record<string, unknown>> = []
          let served = false
          // The first completion is answered BUSY by this stand-in (the real function would have put the object back under its ticket,
          // which is where it still is: nothing reached the function); every other call is the real one.
          await page.route('**/functions/v1/admin', async (route) => {
            const request = route.request()
            const body = request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown> | null) : null
            if (body?.action !== 'paid-file-complete') return route.continue()
            completes.push(body)
            if (served) return route.continue()
            served = true
            return route.fulfill({ status: 409, headers: cors(request), body: JSON.stringify({ ok: false, error: { code: 'BUSY', message: BUSY_MESSAGE }, requestId: randomUUID() }) })
          })
          // How many times the panel read the variant (a preflight is not a reading).
          let reads = 0
          await page.route('**/rest/v1/rpc/variant_admin_info', (route) => {
            if (route.request().method() === 'POST') reads += 1
            return route.continue()
          })
          await page.goto(variantUrl(s.busy.id))
          const area = main(page)
          const input = area.getByLabel('رفع الملف المدفوع')
          const alertLine = page.locator('#variant-commerce-alert')
          const name = `busy-${width}-${marker}.pdf`
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          await expect(area.getByRole('button', { name: 'أعد المحاولة' })).toHaveCount(0)
          // The first reading (`next dev` runs its effect twice, so it may be two calls).
          const opened = reads

          await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(alertLine).toHaveText(BUSY_MESSAGE)
          await expect(alertLine).toBeFocused()
          // A refusal may hide a file that is recorded (the function keeps the object when it cannot tell): the panel was read again.
          expect(reads).toBe(opened + 1)
          await expect(input).toBeEnabled()
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          const retry = button(area, 'أعد المحاولة')
          await expect(retry).toBeVisible()
          await expectTargets([retry], 'the retry button')

          await retry.click()
          await expect(page.locator('#variant-commerce-status')).toHaveText('رُفع الملف.')
          await expect(page.locator('#variant-commerce-status')).toBeFocused()
          await expect(alertLine).toHaveText('')
          await expect(retry).toHaveCount(0)
          await expect(area.getByText(new RegExp(`${esc(name)}، 1 كيلوبايت، رُفع `))).toBeVisible()
          expect(reads).toBe(opened + 2)
          // The same ticket, name and type were sent twice; only the second reached the function.
          expect(completes).toHaveLength(2)
          expect(completes[1]).toEqual(completes[0])
          expect(completes[0]).toMatchObject({ action: 'paid-file-complete', variantId: s.busy.id, filename: name, mime: 'application/pdf' })
          expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.busy.id])).toBe(1)
          expect(problems).toEqual([])
        })

        test('saves the form after a paid file was uploaded: the version the record bumped is taken, also when the reply to the completion was lost', async ({ page }) => {
          const problems = watchProblems(page)
          let lose = false
          // With `lose` on, the real completion runs, so the file is recorded, and the browser is told 500: an outcome it cannot know.
          await page.route('**/functions/v1/admin', async (route) => {
            const request = route.request()
            const body = request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown> | null) : null
            if (body?.action !== 'paid-file-complete' || !lose) return route.continue()
            lose = false
            await route.fetch()
            return route.fulfill({ status: 500, headers: cors(request), body: JSON.stringify({ ok: false, error: { code: 'FAILED', message: 'تعذّر إكمال الإجراء.' }, requestId: randomUUID() }) })
          })
          await page.goto(variantUrl(s.saves.id))
          const area = main(page)
          const input = area.getByLabel('رفع الملف المدفوع')
          const title = area.getByLabel('العنوان')
          const statusLine = page.locator('#variant-commerce-status')
          const alertLine = page.locator('#variant-commerce-alert')
          const stored = async (): Promise<{ title: string; version: number }> => {
            const found = await h.row('select title, version from public.product_variants where id = $1', [s.saves.id])
            return { title: found.title as string, version: Number(found.version) }
          }
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          const start = await stored()
          expect(start.title).toBe(s.saves.title)

          // An upload, then an edit and a save: the record's own step of the version is not another session's change.
          await input.setInputFiles({ name: `saves-${width}-${marker}.pdf`, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(statusLine).toHaveText('رُفع الملف.')
          await expect(alertLine).toHaveText('')
          expect((await stored()).version).toBe(start.version + 1)
          await title.fill(`${s.saves.title} saved once`)
          await button(area, 'حفظ').click()
          await expect(area.getByText('تم الحفظ.')).toBeVisible()
          await expect.poll(stored).toEqual({ title: `${s.saves.title} saved once`, version: start.version + 2 })

          // A second file whose reply is lost: the browser is told the completion failed, the file is recorded all the same. The panel says
          // the function's sentence and shows the file (it read the variant again), and the save that follows is still no conflict.
          lose = true
          const lost = `lost-${width}-${marker}.pdf`
          await input.setInputFiles({ name: lost, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(alertLine).toHaveText('تعذّر إكمال الإجراء.')
          await expect(alertLine).toBeFocused()
          await expect(area.getByText(new RegExp(`${esc(lost)}، 1 كيلوبايت، رُفع `))).toBeVisible()
          await expect(area.getByText(NO_FILE, { exact: true })).toHaveCount(0)
          expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.saves.id])).toBe(2)
          expect((await stored()).version).toBe(start.version + 3)
          await title.fill(`${s.saves.title} saved twice`)
          await button(area, 'حفظ').click()
          await expect(area.getByText('تم الحفظ.')).toBeVisible()
          await expect.poll(stored).toEqual({ title: `${s.saves.title} saved twice`, version: start.version + 4 })
          await expect(area.getByText('تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.')).toHaveCount(0)
          expect(problems).toEqual([])
        })

        test('still ends in the conflict message when another session changed the variant as well as the upload', async ({ page }) => {
          const problems = watchProblems(page)
          await page.goto(variantUrl(s.clash.id))
          const area = main(page)
          const title = area.getByLabel('العنوان')
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          // Another session saves this variant after the form read it, then the owner uploads a file here: the version is two steps on.
          const theirs = `${s.clash.title} theirs`
          await h.postgres.query('update public.product_variants set title = $2 where id = $1', [s.clash.id, theirs])
          await area.getByLabel('رفع الملف المدفوع').setInputFiles({ name: `clash-${width}-${marker}.pdf`, mimeType: 'application/pdf', buffer: PDF_BYTES })
          await expect(page.locator('#variant-commerce-status')).toHaveText('رُفع الملف.')
          // Only the upload's own step is taken, so this save is the conflict: what was typed stays, nothing of the other session's is overwritten.
          const typed = `${s.clash.title} typed`
          await title.fill(typed)
          await button(area, 'حفظ').click()
          await expect(area.getByText('تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.')).toBeVisible()
          await expect(title).toHaveValue(typed)
          await expect(area.getByText('تم الحفظ.')).toHaveCount(0)
          expect((await h.row('select title from public.product_variants where id = $1', [s.clash.id])).title).toBe(theirs)
          expect(problems).toEqual([])
        })

        test('a refused upload takes no version: a save made meanwhile by another session still ends in the conflict, never overwritten', async ({ page }) => {
          const problems = watchProblems(page)
          await page.goto(variantUrl(s.refused.id))
          const area = main(page)
          const title = area.getByLabel('العنوان')
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          // Another session saves this variant (one version on), then the owner's upload is refused by the function: it recorded nothing.
          const theirs = `${s.refused.title} theirs`
          await h.postgres.query('update public.product_variants set title = $2 where id = $1', [s.refused.id, theirs])
          await area.getByLabel('رفع الملف المدفوع').setInputFiles({ name: `refused-${width}-${marker}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('plain text, not a PDF') })
          await expect(page.locator('#variant-commerce-alert')).toHaveText('الملف ليس بصيغة PDF صالحة.')
          // The form did not take the other session's version as the upload's: this save is the conflict, and their title stays.
          const typed = `${s.refused.title} typed`
          await title.fill(typed)
          await button(area, 'حفظ').click()
          await expect(area.getByText('تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.')).toBeVisible()
          await expect(title).toHaveValue(typed)
          await expect(area.getByText('تم الحفظ.')).toHaveCount(0)
          expect((await h.row('select title from public.product_variants where id = $1', [s.refused.id])).title).toBe(theirs)
          expect(problems).toEqual([])
        })

        test('keeps what it showed and says the page may be behind when the variant cannot be read again after an upload', async ({ page }) => {
          const problems = watchProblems(page)
          let fail = false
          // With `fail` on, the Data API answers `variant_admin_info` with an error; the upload itself is the real one.
          await page.route('**/rest/v1/rpc/variant_admin_info', (route) => {
            const request = route.request()
            if (request.method() === 'OPTIONS' || !fail) return route.continue()
            return route.fulfill({ status: 500, headers: cors(request), body: JSON.stringify({ code: 'XX000', message: 'boom', details: null, hint: null }) })
          })
          await page.goto(variantUrl(s.stale.id))
          const area = main(page)
          const alertLine = page.locator('#variant-commerce-alert')
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          fail = true
          await area.getByLabel('رفع الملف المدفوع').setInputFiles({ name: `stale-${width}-${marker}.pdf`, mimeType: 'application/pdf', buffer: PDF_BYTES })
          // The file is recorded, the sentence of the upload and the one that says the page may be behind are on the alert line, which
          // takes the focus; the panel keeps what it showed (a failed reading is not drawn as a variant with nothing in it) and offers no refresh.
          await expect(alertLine).toHaveText('رُفع الملف. تعذّر تحديث الصفحة؛ قد لا تظهر آخر البيانات.')
          await expect(alertLine).toBeFocused()
          await expect(page.locator('#variant-commerce-status')).toHaveText('')
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          await expect(area.getByRole('button', { name: 'تحديث' })).toHaveCount(0)
          expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.stale.id])).toBe(1)
          // A reading that works shows the file.
          fail = false
          await page.reload()
          await expect(area.getByText(new RegExp(`stale-${width}-${marker}\\.pdf، 1 كيلوبايت، رُفع `))).toBeVisible()
          expect(problems).toEqual([])
        })

        test('lists the availability sign-ups read-only, newest first, with no link on a row, no «جديد» and no edit page', async ({ page }) => {
          const problems = watchProblems(page)
          const area = main(page)
          await page.goto('/admin/store')
          await expect(area.getByRole('heading', { level: 1, name: 'المتجر' })).toBeVisible()
          await area.getByRole('link', { name: 'طلبات الإشعار', exact: true }).click()
          await expect(page).toHaveURL(/\/admin\/store\/notifications$/)
          await expect(area.getByRole('heading', { level: 1, name: 'طلبات الإشعار' })).toBeVisible()
          await expect(area.getByRole('button', { name: 'جديد' })).toHaveCount(0)
          const rowOf = (email: string): Locator => area.locator('tbody tr').filter({ hasText: email })
          await expect(rowOf(s.signups.pending)).toBeVisible()
          await expect(area.locator('thead th')).toHaveText(['البريد الإلكتروني', 'رمز SKU', 'الحالة', 'نسخة الموافقة', 'تاريخ الطلب', 'تاريخ التأكيد'])

          // Each row: the address and the SKU left to right, the status in words, the consent revision or «بلا», the times.
          const confirmed = rowOf(s.signups.confirmed)
          await expect(confirmed.locator('td[data-label="البريد الإلكتروني"]')).toHaveText(s.signups.confirmed)
          await expect(confirmed.locator('td[data-label="البريد الإلكتروني"]')).toHaveAttribute('dir', 'ltr')
          await expect(confirmed.locator('td[data-label="رمز SKU"]')).toHaveText(s.signups.variant.sku)
          await expect(confirmed.locator('td[data-label="رمز SKU"]')).toHaveAttribute('dir', 'ltr')
          await expect(confirmed.locator('td[data-label="الحالة"]')).toHaveText('مؤكَّد')
          await expect(confirmed.locator('td[data-label="نسخة الموافقة"]')).toHaveText('3')
          await expect(confirmed.locator('td[data-label="تاريخ الطلب"]')).toHaveText(/\d{4}/)
          await expect(confirmed.locator('td[data-label="تاريخ التأكيد"]')).toHaveText(/\d{4}/)
          const pending = rowOf(s.signups.pending)
          await expect(pending.locator('td[data-label="الحالة"]')).toHaveText('بانتظار التأكيد')
          await expect(pending.locator('td[data-label="نسخة الموافقة"]')).toHaveText('بلا')
          await expect(pending.locator('td[data-label="تاريخ التأكيد"]')).toHaveText('لا يوجد')
          await expect(rowOf(s.signups.gone).locator('td[data-label="الحالة"]')).toHaveText('ألغى الاشتراك')
          // Newest first: the pending one (a minute old), then the one that left, then the confirmed one.
          const emails = (await area.locator('tbody tr td[data-label="البريد الإلكتروني"]').allTextContents()).filter((email) => email.includes(`-${width}-${marker}@`))
          expect(emails).toEqual([s.signups.pending, s.signups.gone, s.signups.confirmed])
          // Read-only: no link anywhere in the rows, no input, no button.
          await expect(area.locator('tbody a')).toHaveCount(0)
          await expect(area.locator('tbody button, tbody input')).toHaveCount(0)
          await expectNoOverflow(page, 'the sign-ups list')
          await shoot(page, 'notifications')

          // No edit page: the export has none (`pnpm check:export` fails when one exists), and `next dev` answers the route with an error:
          // a 404, or its refusal of a path the export does not generate (a 500). Never a form.
          const id = (await h.row('select id from public.notifications where email = $1', [s.signups.confirmed])).id as string
          for (const path of [`/admin/store/notifications/edit?id=${id}`, '/admin/store/notifications/edit']) {
            const response = await page.goto(path)
            expect(response?.status(), path).toBeGreaterThanOrEqual(400)
            await expect(page.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
          }
          expect(problems).toEqual([])
        })

        test('shows the ledger figures of a range of days equal to the function\'s, with the sentence, and refuses a reversed or too long range before any call', async ({ page }) => {
          const problems = watchProblems(page)
          const bodies = watchAdmin(page)
          await page.goto('/admin/stats')
          const section = main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name: 'المتجر', exact: true }) })
          const statusLine = page.locator('#stats-status')
          const alertLine = page.locator('#stats-alert')
          const from = section.getByLabel('من', { exact: true })
          const to = section.getByLabel('إلى', { exact: true })
          const show = button(section, 'عرض')

          // Loaded with the function's own thirty days: the first call carries no range, the environment is labelled, the sentence is there.
          await expect(section.getByText(/^طلبات مدفوعة: [\d,]+$/)).toBeVisible()
          expect(bodies[0]).toEqual({ action: 'stats' })
          await expect(section.getByText('بيانات بيئة الاختبار', { exact: true })).toBeVisible()
          await expect(section.getByText(COMMERCE_NOTE, { exact: true })).toBeVisible()
          await expect(section.getByText('اترك الحقلين فارغين لآخر 30 يومًا.')).toBeVisible()
          // The figures say which days they cover.
          await expect(section.getByText('الأرقام لآخر 30 يومًا.', { exact: true })).toBeVisible()
          for (const label of ['إجمالي المدفوع', 'الاستردادات المؤكدة', 'الصافي بعد الاستردادات', 'العملاء', 'دفعات قيد المراجعة', 'النزاعات']) {
            await expect(section.getByText(new RegExp(`^${label}: `))).toBeVisible()
          }
          await expect(statusLine).toHaveText('')
          await expect(alertLine).toHaveText('')

          // The seeded day, both ends: the lines are what the function's SQL answers for it, never a number written here.
          const lines = async (day: string, last = day): Promise<string[]> => {
            const f = await ledger(day, last)
            return [
              `طلبات مدفوعة: ${formatNumber(f.paidOrders)}`,
              `إجمالي المدفوع: ${formatMoney(f.grossPaid)}`,
              `الاستردادات المؤكدة: ${formatMoney(f.refundsConfirmed)}`,
              `الصافي بعد الاستردادات: ${f.netCollected < 0 ? '‎' : ''}${formatMoney(f.netCollected)}`,
              `العملاء: ${formatNumber(f.customers)}`,
              `دفعات قيد المراجعة: مفتوحة ${formatNumber(f.review.open)}، مبالغها ${formatMoney(f.review.captured)}، المسترد منها ${formatMoney(f.review.refunded)}`,
              `النزاعات: ${formatNumber(f.disputes.count)}، على البائع ${formatMoney(f.disputes.againstSeller)}، لصالح البائع ${formatMoney(f.disputes.forSeller)}`,
            ]
          }
          const expected = await lines(statsDay)
          // The seeded figures are not all zero (the day holds this run's orders, refund, review payment and disputes).
          const day = await ledger(statsDay, statsDay)
          expect(day.paidOrders).toBe(2)
          expect(day.refundsConfirmed).toBeGreaterThan(0)
          expect(day.review.open).toBe(1)
          expect(day.disputes).toMatchObject({ count: 2, againstSeller: 3000, forSeller: 500 })
          await from.fill(statsDay)
          await to.fill(statsDay)
          await show.click()
          await expect(statusLine).toHaveText('تم تحديث الأرقام.')
          await expect(statusLine).toBeFocused()
          for (const line of expected) await expect(section.getByText(line, { exact: true })).toBeVisible()
          expect(bodies.at(-1)).toEqual({ action: 'stats', from: `${statsDay}T00:00:00+03:00`, to: `${dayAfter(statsDay)}T00:00:00+03:00` })
          // The covered days follow the figures, not the fields: the line names the day just shown.
          await expect(section.getByText(/^الأرقام من .+ إلى .+.$/)).toBeVisible()
          await expect(section.getByText('الأرقام لآخر 30 يومًا.', { exact: true })).toHaveCount(0)
          await expect(section.getByText(COMMERCE_NOTE, { exact: true })).toBeVisible()
          await expectNoOverflow(page, 'the statistics')
          await expectTargets([from, to, show], 'the range form')
          await shoot(page, 'stats-commerce')

          // A range that ends before it starts, and one of 367 days: refused by the form, with no call and the figures kept.
          const before = bodies.length
          await from.fill(dayAfter(statsDay))
          await to.fill(statsDay)
          await show.click()
          await expect(alertLine).toHaveText('يوم «إلى» قبل يوم «من».')
          await expect(alertLine).toBeFocused()
          await expect(statusLine).toHaveText('')
          await from.fill('2099-01-01')
          await to.fill('2100-01-02')
          await show.click()
          await expect(alertLine).toHaveText('المدى أطول من 366 يومًا.')
          expect(bodies.length).toBe(before)
          for (const line of expected) await expect(section.getByText(line, { exact: true })).toBeVisible()

          // 366 days is the longest there is: it is asked, and the answer is the function's again.
          await to.fill('2100-01-01')
          await show.click()
          await expect(statusLine).toHaveText('تم تحديث الأرقام.')
          await expect(alertLine).toHaveText('')
          expect(bodies.length).toBe(before + 1)
          expect(bodies.at(-1)).toEqual({ action: 'stats', from: '2099-01-01T00:00:00+03:00', to: '2100-01-02T00:00:00+03:00' })
          for (const line of await lines('2099-01-01', '2100-01-01')) await expect(section.getByText(line, { exact: true })).toBeVisible()
          expect(problems).toEqual([])
        })

        test('says «غير مُعدّ بعد» for no commerce, cannot read a reply that is not the figures, and keeps the figures when a range fails', async ({ page }) => {
          const problems = watchProblems(page)
          let next: { status: number; body: unknown } | null = null
          // What the next `stats` call gets instead of the stack's answer; null lets the real one through.
          await page.route('**/functions/v1/admin', async (route) => {
            const request = route.request()
            const body = request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown> | null) : null
            if (body?.action !== 'stats' || next === null) return route.continue()
            return route.fulfill({ status: next.status, headers: cors(request), body: JSON.stringify(next.body) })
          })
          const answer = (commerce: unknown) => ({
            status: 200,
            body: { ok: true, data: { generatedAt: new Date().toISOString(), commerce, analytics: { status: 'unavailable', reason: 'NOT_CONFIGURED' } } },
          })
          const section = (): Locator => main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name: 'المتجر', exact: true }) })

          // Payments not configured: today's sentence, and no range to ask for.
          next = answer(null)
          await page.goto('/admin/stats')
          await expect(section().getByText(NOT_CONFIGURED)).toBeVisible()
          await expect(section().getByRole('button', { name: 'عرض' })).toHaveCount(0)
          await expect(section().getByLabel('من', { exact: true })).toHaveCount(0)
          await expect(section().getByText('طلبات مدفوعة')).toHaveCount(0)

          // A commerce that is not the figures: said so on the alert line, no figure drawn.
          next = answer({ environment: 'test', paidOrders: 'many' })
          await page.goto('/admin/stats')
          await expect(page.locator('#stats-alert')).toHaveText(BAD_REPLY)
          await expect(section().getByText('طلبات مدفوعة')).toHaveCount(0)
          await expect(section().getByRole('button', { name: 'عرض' })).toBeVisible()

          // The real figures, then a range whose call fails and one whose reply is not the figures: the figures stay.
          next = null
          await page.goto('/admin/stats')
          await expect(section().getByText(/^طلبات مدفوعة: [\d,]+$/)).toBeVisible()
          const drawn = await section().locator('p:not([role])').allTextContents()
          await section().getByLabel('من', { exact: true }).fill(statsDay)
          await section().getByLabel('إلى', { exact: true }).fill(statsDay)
          next = { status: 500, body: { ok: false, error: { code: 'FAILED', message: 'تعذّر إكمال الإجراء.' }, requestId: randomUUID() } }
          await button(section(), 'عرض').click()
          await expect(page.locator('#stats-alert')).toHaveText('تعذّر إكمال الإجراء.')
          await expect(page.locator('#stats-alert')).toBeFocused()
          await expect(page.locator('#stats-status')).toHaveText('')
          next = answer({ environment: 'test' })
          await button(section(), 'عرض').click()
          await expect(page.locator('#stats-alert')).toHaveText(BAD_REPLY)
          expect(await section().locator('p:not([role])').allTextContents()).toEqual(drawn)
          expect(problems).toEqual([])
        })
      })

      // ============================================================================================ operations
      test.describe('operations', () => {
        test.use({ storageState: STATES.operations })

        test('sees the count and the file of a variant, and no upload, no form, no save', async ({ page }) => {
          const problems = watchProblems(page)
          await page.goto(variantUrl(s.filed.variant.id))
          const area = main(page)
          await expect(area.getByRole('heading', { level: 1, name: s.filed.variant.title })).toBeVisible()
          await expect(area.getByText('طلبات مسبقة مؤكدة لم تُشحن: 1', { exact: true })).toBeVisible()
          // A digital variant has no stock field: no stock sentence under its count.
          await expect(area.getByText('أدخل المخزون الفعلي بعد طرح هذه الطلبات.')).toHaveCount(0)
          await expect(area.getByRole('heading', { level: 2, name: 'الملف المدفوع' })).toBeVisible()
          await expect(area.getByText(new RegExp(`${esc(s.filed.filename)}، 2 كيلوبايت، رُفع .*\\d{4}`))).toBeVisible()
          // The two lines are mounted for operations too (nothing is said there), so a reading that fails is announced when it is filled.
          await expect(page.locator('#variant-commerce-status')).toHaveText('')
          await expect(page.locator('#variant-commerce-alert')).toHaveText('')
          // Read-only: the preorder fields as values (the date as a date), and nothing to upload or save.
          await expect(area.getByText(formatDate('2030-01-01'))).toBeVisible()
          await expect(area.getByLabel('رفع الملف المدفوع')).toHaveCount(0)
          await expect(area.getByRole('button', { name: 'حفظ' })).toHaveCount(0)
          await expect(area.locator('input')).toHaveCount(0)
          await expect(area.getByText('هذه الصفحة للقراءة فقط.')).toBeVisible()
          await expectNoOverflow(page, 'a variant, read by operations')

          // A digital variant with no file says so, and still offers no upload.
          await page.goto(variantUrl(s.empty.id))
          await expect(area.getByText(NO_FILE, { exact: true })).toBeVisible()
          await expect(area.getByLabel('رفع الملف المدفوع')).toHaveCount(0)
          await expect(area.getByText('طلبات مسبقة مؤكدة')).toHaveCount(0)
          expect(problems).toEqual([])
        })

        test('reads the availability sign-ups too, from the store home, with nothing to change', async ({ page }) => {
          const problems = watchProblems(page)
          const area = main(page)
          await page.goto('/admin/store')
          await area.getByRole('link', { name: 'طلبات الإشعار', exact: true }).click()
          await expect(page).toHaveURL(/\/admin\/store\/notifications$/)
          await expect(area.getByRole('heading', { level: 1, name: 'طلبات الإشعار' })).toBeVisible()
          const row = area.locator('tbody tr').filter({ hasText: s.signups.pending })
          await expect(row.locator('td[data-label="الحالة"]')).toHaveText('بانتظار التأكيد')
          await expect(row.locator('td[data-label="رمز SKU"]')).toHaveText(s.signups.variant.sku)
          await expect(area.getByRole('button', { name: 'جديد' })).toHaveCount(0)
          await expect(area.locator('tbody a')).toHaveCount(0)
          await expectNoOverflow(page, 'the sign-ups list, read by operations')
          expect(problems).toEqual([])
        })
      })
    })
  }
})

function mkdirScreenshots(): string {
  const dir = shotsDir('P07')
  mkdirSync(dir, { recursive: true })
  return dir
}
