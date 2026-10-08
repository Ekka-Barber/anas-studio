// P08 round 12a e2e: the journeys of contract section 11's last row, end to end in the browser on `next dev`, against the
// real local stack: the real Edge Functions, the real database, the real Storage and Mailpit, and the local Moyasar
// emulator (a test harness that Playwright's webServer starts beside the dev server; nothing here reaches Moyasar).
// There is no `page.route` mock of any function or Data API call: a buyer and the owner use the real pages, and
// everything an assertion reads is what a page shows or what the ledger holds (read-only queries, or the emulator's
// own state). Ten journeys, each at 360 and at 1440, each on products seeded for its width so that the two never share
// stock: a book bought and downloaded, a signed and a plain paper edition shipped and returned, a failed payment,
// 3-D Secure, a cancel and a late payment, a refund through the step-up, the availability notice, a preorder, a
// dispute, and the owner's switch.
//
// The owner signs in once by email code (the session is saved before the authenticator is enrolled, so every test that
// starts from it must answer the step-up dialog with a real code); an operations member signs in once too. Mail is sent
// by calling the `outbox` jobs endpoint, as the cron does, and read in Mailpit by the run's own buyer addresses. The
// spec brings its own policies when none are live, restores the commerce settings (the harness's `stop()`), archives
// what it seeded and removes the paid files it uploaded; its orders stay, as in every other spec. Screenshots land in
// orders-*.png under shotsDir('P08'): the accepted evidence folder only for an ACCEPTANCE_PACKAGE=P08 run,
// test-results/ otherwise.
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test'

import { formatDate, formatMoney } from '../../src/lib/format'
import { commerceHarness, type Harness, type Row } from '../integration/support'
import {
  armEmulator,
  emulatorControl,
  emulatorState,
  functionUrl,
  localEnv,
  mailsTo,
  runOutbox,
  serviceClient,
  signInByCode,
  SITE_ORIGIN,
  totpCode,
  waitForMail,
} from './helpers'
import { shotsDir } from './shots'

const SHOTS = shotsDir('P08')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const STATES = { owner: 'test-results/orders/owner.json', operations: 'test-results/orders/operations.json' }

// What a tab keeps in storage.
const CART_KEY = 'anasaq:cart:v1'
const PENDING_KEY = 'anasaq:pending-order'
const IDEMPOTENCY_KEY = 'anasaq:idempotency'
const ACCESS_KEY = 'anasaq:order-access'

const INVOICE_PAGE = /^http:\/\/127\.0\.0\.1:54390\/invoices\/[0-9a-f-]{36}$/
const TEST_MODE = 'وضع تجريبي: لا يُخصم أي مبلغ حقيقي'
const SENT = 'إن لم تكن مشتركًا من قبل فستصلك رسالة لتأكيد الاشتراك.'
const HELD = 'الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.'
const OFF = 'الشراء غير متاح حاليًا، ويفتح قريبًا.'
const PAY_OK = 'دفع ناجح'
const PAY_FAIL = 'دفع مرفوض'
const PAY_3DS = 'دفع بتحقق 3-D Secure'
const MONEY_BUTTONS = ['إعادة المبلغ', 'استرداد هذه الدفعة', 'أعد الفحص', 'تسجيل استرداد خارجي', 'تسجيل اعتراض', 'تسجيل فرق', 'إضافة متابعة']
const FEE = 1130
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
)
// Every browser request reaches the functions from the gateway's one address, so the orders, payments, links and
// sign-ups of one run would trip the per-IP and per-day throttles; the throttles themselves are proven in the
// integration tests.
const BUCKETS = [
  'checkout-quote:ip',
  'checkout:ip',
  'checkout:all',
  'checkout-cancel:order',
  'payment-pay:ip',
  'payment-check:ip',
  'payment-callback:ip',
  'order-access:ip',
  'download-issue:ip',
  'download-redeem:ip',
  'return-request:ip',
  'notify:ip',
  'notify-link:ip',
  'notify-confirm:email',
  'notify-confirm:all',
  'order-link:day',
]

type Staff = { userId: string; email: string }
type V = { id: string; sku: string; title: string; price: number; fulfillment: 'digital' | 'physical' | 'signed'; preorder?: boolean }
type CartLine = { v: V; quantity?: number; dedication?: string }
interface Seed {
  width: number
  slug: string
  productId: string
  productTitle: string
  digital: V
  physical: V
  signed: V
  scarce: V
  soldOut: V
  preorder: V
  /** The preorder's delivery day (YYYY-MM-DD, Riyadh) and note. */
  shipsOn: string
  note: string
  fileName: string
}

let h: Harness
let owner: Staff
let operations: Staff
let totpSecret = ''
let cityKey = ''
/** Policies `checkoutOn()` published because none were live; afterAll removes them again. */
const publishedPolicies: string[] = []

// A journey goes browser, function, emulator and back several times; an action that cannot be done fails after 30 seconds, not at the end of the test.
test.describe.configure({ timeout: 180_000 })
test.use({ actionTimeout: 30_000 })

// ---- small helpers -----------------------------------------------------------------------------------------------------

const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const riyals = (halalas: number): string => (halalas / 100).toFixed(2)
const buyer = (width: number, label: string): string => `buyer-orders-${marker}-${width}-${label}@example.com`
const main = (page: Page): Locator => page.locator('main')
const totalRow = (page: Page, label: string): Locator => page.locator('dl > div', { hasText: label })
const button = (scope: Locator | Page, name: string): Locator => scope.getByRole('button', { name, exact: true })
const statusLine = (page: Page): Locator => main(page).getByRole('status')
const section = (page: Page, name: string): Locator =>
  main(page).locator('section').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
const rowOf = (page: Page, number: string): Locator =>
  main(page).locator('tbody tr').filter({ has: page.getByRole('link', { name: number, exact: true }) })
const kept = (page: Page, key: string): Promise<string | null> => page.evaluate((name) => sessionStorage.getItem(name), key)
const stored = (page: Page, key: string): Promise<string | null> => page.evaluate((name) => localStorage.getItem(name), key)

/** The uncaught exceptions of a page (a render that throws); a failed request or a refused call is not one. */
function pageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/**
 * Notes, in the page's own document, whether «جارٍ التحقق من الدفع…» was ever on screen: the return page says it until
 * the first answer arrives, which is too short a moment to catch with a one-off assertion. The recorder looks every
 * 15 ms; it replaces nothing and changes nothing.
 */
async function watchVerifying(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = window as unknown as { __verifying: boolean }
    seen.__verifying = false
    setInterval(() => {
      if (document.body?.innerText.includes('جارٍ التحقق من الدفع')) seen.__verifying = true
    }, 15)
  })
}
const sawVerifying = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { __verifying?: boolean }).__verifying === true)

/** The page does not scroll sideways. */
async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(1)
}

/** A full-page capture of a key screen (the sticky header is static for it), after the overflow check of our own pages. */
async function snap(page: Page, name: string, width: number, ours = true): Promise<void> {
  if (ours) await expectNoOverflow(page, `${name} ${width}`)
  await page.addStyleTag({ content: 'body > header { position: static !important; }' })
  await page.screenshot({ path: `${SHOTS}/orders-${name}-${width}.png`, fullPage: true })
}

/** A fresh browser, as a buyer on another device has: no cart, no stored order. */
function buyerContext(browser: Browser, width: number): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', viewport: { width, height: 1000 } })
}

/** The owner or the operations member, from the session saved at the start (the owner's holds no fresh authenticator code). */
async function asStaff(browser: Browser, who: keyof typeof STATES, width: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', viewport: { width, height: 1000 }, storageState: STATES[who] })
  return { page: await context.newPage(), close: () => context.close() }
}

/** The step-up dialog answered with a real code from the owner's authenticator. */
async function enterCode(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رمز التحقق').fill(totpCode(totpSecret))
  await dialog.getByRole('button', { name: 'تحقق', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** After a second money action of the same session: the code verified a moment ago still counts (5 minutes), but if it is asked for again it is given. */
async function answerIfAsked(page: Page, done: Locator): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog.or(done)).toBeVisible()
  if (await dialog.isVisible()) await enterCode(page)
}

const stockOf = async (variantId: string): Promise<number> => Number((await h.row('select stock from public.product_variants where id = $1', [variantId])).stock)
const orderOf = (number: string): Promise<Row> =>
  h.row('select id, status, total_halalas, paid_at, customer_email from finance.orders where order_number = $1', [number])
const states = async (orderId: string): Promise<string[]> =>
  (await h.rows('select state from finance.fulfillments where order_id = $1', [orderId])).map((entry) => entry.state as string).sort()

/** The emulator's own copy of an order's invoice and payments, found by the order number it was made with. */
async function emulatorOf(number: string) {
  const state = await emulatorState()
  const invoice = state.invoices.find((entry) => entry.metadata.order_number === number)
  return { state, invoice, payments: state.payments.filter((payment) => payment.invoice_id === invoice?.id) }
}

type Ledger = { paidOrders: number; refundsConfirmed: number; review: { captured: number }; disputes: { count: number; againstSeller: number; forSeller: number } }
const pad = (n: number): string => String(n).padStart(2, '0')
const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

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

// ---- the buyer's side ----------------------------------------------------------------------------------------------------

/** Puts the lines in the cart from the product page. */
async function addLines(page: Page, s: Seed, lines: CartLine[]): Promise<void> {
  await page.goto(`/store/${s.slug}`)
  for (const line of lines) {
    const row = page.locator('li', { hasText: line.v.title })
    if (line.quantity !== undefined) await row.getByLabel('الكمية').fill(String(line.quantity))
    await row.getByRole('button', { name: line.v.preorder === true ? 'اطلب مسبقًا' : 'أضف إلى السلة' }).click()
    await expect(row.getByText('أُضيف إلى السلة.')).toBeVisible()
  }
}

/** Adds the lines, opens the cart, chooses the city and the dedications; returns the total the cart shows. */
async function fillCart(page: Page, s: Seed, lines: CartLine[]): Promise<number> {
  await addLines(page, s, lines)
  await page.goto('/cart')
  const physical = lines.some((line) => line.v.fulfillment !== 'digital')
  if (physical) await page.getByLabel('مدينة التوصيل').selectOption(cityKey)
  for (const line of lines) {
    if (line.dedication !== undefined) await page.locator('li', { hasText: line.v.title }).getByLabel('نص الإهداء').fill(line.dedication)
  }
  const total = lines.reduce((sum, line) => sum + line.v.price * (line.quantity ?? 1), 0) + (physical ? FEE : 0)
  await expect(totalRow(page, 'الإجمالي')).toContainText(formatMoney(total))
  return total
}

/** From the cart to the checkout form, filled and confirmed (the always-pass test widget solves itself); returns the order number of the hold view. */
async function placeOrder(page: Page, input: { email: string; physical: boolean }): Promise<string> {
  await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()
  await submitCheckout(page, input)
  // A press before Cloudflare's test widget has its token waits for it (over the network, like journey 7's), then `create` verifies it.
  await expect(page.locator('#checkout-order-number')).toBeVisible({ timeout: 60_000 })
  return (await page.locator('#checkout-order-number span').innerText()).trim()
}

async function submitCheckout(page: Page, input: { email: string; physical: boolean }): Promise<void> {
  await page.getByLabel('البريد الإلكتروني').fill(input.email)
  await page.getByLabel('الاسم').fill('مشترٍ')
  if (input.physical) {
    await page.getByLabel('رقم الجوال').fill('0501234567')
    await page.getByLabel('عنوان التوصيل').fill('تبوك شارع الرئيسي 12')
  }
  await page.getByRole('checkbox').check()
  const submit = page.getByRole('button', { name: 'تأكيد الطلب' })
  await expect(submit).toBeEnabled()
  await submit.click()
}

/** «ادفع الآن» to the emulator's stand-in invoice page, and one of its buttons. */
async function payOnStandIn(page: Page, buttonName: string): Promise<void> {
  await page.getByRole('link', { name: 'ادفع الآن' }).click()
  await expect(page).toHaveURL(INVOICE_PAGE)
  await page.getByRole('button', { name: buttonName, exact: true }).click()
}

/** The provider sends the buyer back with the order number; the return page says what the ledger holds. */
async function expectPaidReturn(page: Page, number: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/checkout/return\\?order=${number}$`))
  await expect(page.getByText('تم الدفع.')).toBeVisible()
  await expect(page.getByText(`رقم الطلب ${number}`)).toBeVisible()
}

// ---- the setup ---------------------------------------------------------------------------------------------------------

/** Turns checkout on with the seller fixture and the currently published policy revisions (publishing the three minimal ones when none are live). */
async function checkoutOn(): Promise<void> {
  const revisionsOf = async (): Promise<string> =>
    (await h.row(`select coalesce(jsonb_object_agg(doc_id, seq), '{}'::jsonb)::text as revisions from public.published_documents where collection = 'policies'`)).revisions as string
  let revisions = await revisionsOf()
  if (revisions === '{}') {
    for (const id of ['store', 'delivery', 'refund']) {
      const seq = Number((await h.row(`select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = 'policies' and doc_id = $1`, [id])).seq)
      const body = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'نص سياسة الاختبار.', version: 1 }], version: 1 }] } }
      await h.postgres.query(`insert into public.content_versions (collection, doc_id, seq, data) values ('policies', $1, $2, $3::jsonb)`, [id, seq, JSON.stringify({ title: id, body })])
      await h.postgres.query(`select public.content_go_live('policies', $1, $2)`, [id, seq])
      publishedPolicies.push(id)
    }
    revisions = await revisionsOf()
  }
  await h.postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار', seller_address = 'تبوك',
       seller_registration = 'E2E-ORDERS', policy_revisions = $1::jsonb, version = version + 1, configured_at = now()
     where id = 1`,
    [revisions],
  )
}

/**
 * One product page for a width with every variant the journeys need, seeded through the database: the digital book (its
 * file uploaded through the admin's real paid-file flow before any purchase), paper and signed editions, a single
 * scarce copy, an item that is out of stock, and a preorder of capacity 3 thirty days out in Riyadh.
 */
async function seed(width: number, browser: Browser): Promise<Seed> {
  const tag = `${width}-${marker}`
  const slug = `e2e-orders-${tag}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  // The title ends in one long unbreakable run (an ISBN-like code): every page that shows it must wrap it, never scroll sideways at 360px.
  const productTitle = `كتاب رحلة الأنساق ${width} ISBN-978-603-${marker}`
  const productId = (
    await h.row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي للاختبار', 'published') returning id`, [slug, productTitle])
  ).id as string
  h.created.products.push(productId)
  const shipsOn = (await h.row(`select to_char((now() at time zone 'Asia/Riyadh')::date + 30, 'YYYY-MM-DD') as d`)).d as string
  const note = 'يصلك بعد الطباعة الأولى، وقد يتأخر أسبوعًا.'
  const variant = async (kind: string, title: string, fulfillment: V['fulfillment'], price: number, stock: number | null, order: number, preorder = false): Promise<V> => {
    const sku = `E2E-ORD-${kind}-${tag}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    const made = await h.row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, sort_order, preorder, preorder_capacity, preorder_ships_on, preorder_note)
       values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10::date, $11) returning id`,
      [productId, sku, title, fulfillment, price, stock, order, preorder, preorder ? 3 : null, preorder ? shipsOn : null, preorder ? note : null],
    )
    return { id: made.id as string, sku, title, price, fulfillment, ...(preorder ? { preorder: true } : {}) }
  }
  const s: Seed = {
    width,
    slug,
    productId,
    productTitle,
    digital: await variant('D', 'النسخة الإلكترونية', 'digital', 1240, null, 1),
    physical: await variant('P', 'النسخة الورقية', 'physical', 2360, 20, 2),
    signed: await variant('S', 'النسخة الموقعة', 'signed', 5170, 20, 3),
    scarce: await variant('C', 'النسخة المحدودة', 'physical', 3180, 1, 4),
    soldOut: await variant('O', 'النسخة النافدة', 'physical', 4450, 0, 5),
    preorder: await variant('R', 'النسخة المسبقة', 'physical', 6020, 0, 6, true),
    shipsOn,
    note,
    fileName: `book-${tag}.pdf`,
  }

  // `next dev` answers a generateStaticParams page from the static params it cached for that route, so the first request for
  // a slug made after the cache was filled can be a 404 (I38): wait until the dev server has seen this one.
  await expect.poll(async () => (await fetch(`${SITE_ORIGIN}/store/${slug}`)).status, { timeout: 90_000 }).toBe(200)

  // The book's file, through the admin's own upload (a signed upload to Storage, then the completion).
  const staff = await asStaff(browser, 'owner', width)
  try {
    await staff.page.goto(`/admin/store/variants/edit?id=${s.digital.id}`)
    await staff.page.getByLabel('رفع الملف المدفوع').setInputFiles({ name: s.fileName, mimeType: 'application/pdf', buffer: PDF_BYTES })
    await expect(staff.page.locator('#variant-commerce-status')).toHaveText('رُفع الملف.', { timeout: 60_000 })
  } finally {
    await staff.close()
  }
  expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [s.digital.id])).toBe(1)
  return s
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000)
  mkdirSync(SHOTS, { recursive: true })
  h = await commerceHarness(localEnv().TOKEN_HASH_PEPPER ?? `orders-pepper-${randomUUID()}`, 1)
  owner = await h.makeStaff('owner')
  operations = await h.makeStaff('operations')
  await checkoutOn()
  // A city of this run's own, so a physical cart never depends on the demo rates.
  cityKey = `e2eorders${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  await h.postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [cityKey, `مدينة الاختبار ${marker}`, FEE])
  h.created.rates.push(cityKey)

  // `next dev` compiles a page on its first request: do it once, all together, before any test has a clock running.
  const routes = [
    '/store',
    '/cart',
    '/checkout',
    '/checkout/return',
    '/orders',
    '/notify/confirm',
    '/notify/unsubscribe',
    '/admin/sign-in',
    '/admin',
    '/admin/orders',
    '/admin/orders/view',
    '/admin/orders/reconciliation',
    '/admin/store/variants/edit',
    '/admin/settings',
    '/admin/stats',
    '/admin/security',
  ]
  await Promise.all(routes.map((route) => expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 240_000 }).toBe(200)))

  // One real sign-in per role. The owner's session is saved before the authenticator is enrolled: every test that starts
  // from it has no fresh code, so each money action really asks for one through the step-up dialog.
  for (const [who, member] of [
    ['owner', owner],
    ['operations', operations],
  ] as const) {
    const context = await browser.newContext({ baseURL: BASE, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await signInByCode(page, member.email)
    await context.storageState({ path: STATES[who] })
    if (who === 'owner') {
      await page.locator('nav').getByRole('link', { name: 'الأمان' }).click()
      await expect(page).toHaveURL(/\/admin\/security$/)
      totpSecret = await page.locator('[class*="secret"]').innerText()
      await page.getByLabel('رمز التحقق').fill(totpCode(totpSecret))
      await page.getByRole('button', { name: 'تفعيل' }).click()
      await expect(page.getByText('تطبيق المصادقة مفعّل')).toBeVisible()
    }
    await context.close()
  }
})

test.beforeEach(async () => {
  await h.postgres.query('delete from finance.rate_limits where bucket = any($1::text[])', [BUCKETS])
  // Each test starts from an empty emulator whose webhook goes to the local `payments` function.
  await armEmulator()
})

test.afterAll(async () => {
  // A setup that failed before the harness existed has nothing to retire.
  if ((h as Harness | undefined) === undefined) return
  // This run's orders stay whole, with their refunds and returns (deleting a refund the provider made would leave its
  // attempt's provider total above the ledger's, a phantom external refund). Only what keeps working on them is retired:
  // the reconciliation job's due checks, and the sent mail rows that count against the day's send caps.
  const orders = (await h.rows('select id from finance.orders where customer_email like $1', [`buyer-orders-${marker}-%`])).map((entry) => entry.id as string)
  await h.postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [orders])
  await h.postgres.query("delete from finance.email_outbox where payload ->> 'orderId' = any($1::text[])", [orders])
  // The paid files this run recorded: the ledger keeps its rows (orders reference them), the objects are what takes room.
  const keys = (
    await h.rows('select a.storage_key from finance.paid_assets a join public.product_variants v on v.id = a.variant_id where v.product_id = any($1::uuid[])', [h.created.products])
  ).map((entry) => entry.storage_key as string)
  if (keys.length > 0) await serviceClient.storage.from('paid-files').remove(keys)
  // archive_document refuses `policies` (and needs a publisher's JWT), so the policies published here go with SQL.
  if (publishedPolicies.length > 0) {
    await h.postgres.query("delete from public.published_documents where collection = 'policies' and doc_id = any($1::text[])", [publishedPolicies])
    await h.postgres.query("delete from public.content_versions where collection = 'policies' and doc_id = any($1::text[])", [publishedPolicies])
  }
  await emulatorControl('reset').catch(() => undefined)
  rmSync('test-results/orders', { recursive: true, force: true })
  await h.stop()
})

// ---- the journeys ------------------------------------------------------------------------------------------------------

for (const width of [360, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    let s: Seed
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(480_000)
      s = await seed(width, browser)
    })

    test('1. a book: the product page to the receipt, the order link, a real download and the owner\'s order view', async ({ page, browser, request }) => {
      const errors = pageErrors(page)
      const email = buyer(width, 'book')
      await watchVerifying(page)
      await page.goto(`/store/${s.slug}`)
      await expect(page.locator('li', { hasText: s.digital.title }).getByText(formatMoney(s.digital.price))).toBeVisible()
      await snap(page, 'book-product', width)
      await fillCart(page, s, [{ v: s.digital }])
      const number = await placeOrder(page, { email, physical: false })
      const order = await orderOf(number)
      expect(order).toMatchObject({ status: 'pending_payment', total_halalas: s.digital.price })

      // The hold view: the total, until when, the test notice, and a plain link to the invoice.
      const pay = page.getByRole('link', { name: 'ادفع الآن' })
      await expect(pay).toHaveAttribute('href', INVOICE_PAGE)
      await expect(page.getByText(`الإجمالي: ${formatMoney(s.digital.price)}`)).toBeVisible()
      await expect(page.getByText(/^محجوز حتى \d{2}:\d{2} بتوقيت الرياض$/)).toBeVisible()
      await expect(page.getByText(TEST_MODE)).toBeVisible()
      await snap(page, 'book-hold', width)

      // The stand-in invoice page, «دفع ناجح», and back on the return page through the verification to «تم الدفع».
      await payOnStandIn(page, PAY_OK)
      await expectPaidReturn(page, number)
      expect(await sawVerifying(page)).toBe(true)
      await expect(page.getByText('أرسلنا رابط الطلب إلى بريدك.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'عرض الطلب' })).toHaveAttribute('href', new RegExp(`^/orders#${number}\\.[A-Za-z0-9_-]{43}$`))
      expect(await stored(page, CART_KEY)).toBe('{"version":1,"lines":[]}')
      expect(await kept(page, PENDING_KEY)).toBeNull()
      expect(await kept(page, IDEMPOTENCY_KEY)).toBeNull()
      await snap(page, 'book-return', width)

      // The ledger and the emulator agree: one paid attempt, one invoice made for it, one payment, both messages delivered.
      expect(await orderOf(number)).toMatchObject({ status: 'paid', total_halalas: s.digital.price })
      const attempt = await h.row('select id, status, provider_invoice_id, provider_payment_id, captured_halalas, amount_halalas from finance.payment_attempts where order_id = $1', [order.id])
      expect(attempt).toMatchObject({ status: 'paid', captured_halalas: s.digital.price, amount_halalas: s.digital.price })
      const provider = await emulatorOf(number)
      expect(provider.state.invoices).toHaveLength(1)
      expect(provider.invoice).toMatchObject({ id: attempt.provider_invoice_id, status: 'paid', metadata: { order_number: number, attempt_id: attempt.id } })
      expect(provider.payments).toHaveLength(1)
      expect(provider.payments[0]).toMatchObject({ id: attempt.provider_payment_id, status: 'paid', amount: s.digital.price })
      expect(provider.state.calls.filter((call) => call.route === 'POST /v1/invoices')).toHaveLength(1)
      expect(provider.state.deliveries.map((delivery) => `${delivery.kind}:${delivery.status}`)).toEqual(['webhook:200', 'callback:200'])
      expect(await h.count('select count(*)::int as n from finance.entitlements where order_id = $1 and revoked_at is null and asset_id is not null', [order.id])).toBe(1)

      // The receipt arrives with the order link, the total, the file note and the seller.
      const receipt = await waitForMail(email, 'إيصال طلبك رقم')
      expect(receipt).toContain(`الإجمالي المدفوع: ${formatMoney(s.digital.price)}`)
      expect(receipt).toContain('الملف الرقمي: تجده في صفحة طلبك.')
      expect(receipt).toContain('بائع الاختبار')
      const link = receipt.match(new RegExp(`${esc(SITE_ORIGIN)}/orders#${number}\\.[A-Za-z0-9_-]{43}`))?.[0]
      expect(link, 'the receipt carries the order link').toBeDefined()

      // The link, opened on another device: the token leaves the address bar, and «تنزيل» issues and redeems a real download.
      const reader = await buyerContext(browser, width)
      try {
        const orderPage = await reader.newPage()
        await orderPage.goto(link!)
        await expect(orderPage.getByText(`رقم الطلب: ${number}`)).toBeVisible()
        await expect(statusLine(orderPage).first()).toHaveText('مدفوع.')
        expect(new URL(orderPage.url()).hash).toBe('')
        expect(new URL(orderPage.url()).pathname).toBe('/orders')
        await expect(totalRow(orderPage, 'الإجمالي')).toContainText(formatMoney(s.digital.price))
        await snap(orderPage, 'book-order', width)

        const redeemed = orderPage.waitForResponse((response) => response.request().method() === 'POST' && response.url() === functionUrl('download') && response.request().postDataJSON()?.action === 'redeem')
        const [download] = await Promise.all([
          orderPage.waitForEvent('download'),
          orderPage.locator('li', { hasText: s.digital.title }).getByRole('button', { name: /^تنزيل/ }).click(),
        ])
        expect(download.suggestedFilename()).toBe(s.fileName)
        const reply = (await (await redeemed).json()) as { ok: boolean; data: { url: string } }
        expect(reply.ok).toBe(true)
        // The signed Storage URL, asked for with `request` and not opened: the file's own bytes, as a PDF attachment.
        const file = await request.get(reply.data.url)
        expect(file.status()).toBe(200)
        expect(file.headers()['content-type']).toContain('application/pdf')
        expect(file.headers()['content-disposition']).toContain('attachment')
        expect(Buffer.compare(await file.body(), PDF_BYTES)).toBe(0)
        // The page stays, and neither the download token nor the file address is kept or shown.
        expect(new URL(orderPage.url()).pathname).toBe('/orders')
        expect(await orderPage.evaluate(() => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]))).not.toContain('/storage/v1/')
        const tokens = await h.rows('select t.uses, t.max_uses from finance.download_tokens t join finance.entitlements e on e.id = t.entitlement_id where e.order_id = $1', [order.id])
        expect(tokens.map((token) => [Number(token.uses), Number(token.max_uses)])).toEqual([[1, 3]])
      } finally {
        await reader.close()
      }

      // The owner's list shows the order as paid, and its view shows the verified evidence of the payment.
      const staff = await asStaff(browser, 'owner', width)
      try {
        const admin = staff.page
        await admin.goto('/admin/orders')
        await expect(admin.getByRole('heading', { level: 1, name: 'الطلبات' })).toBeVisible()
        await admin.getByLabel('بحث برقم الطلب أو البريد').fill(number)
        await button(admin, 'بحث').click()
        const row = rowOf(admin, number)
        await expect(row).toBeVisible()
        await expect(row.locator('td[data-label="الحالة"]')).toHaveText('مدفوع')
        await expect(row.locator('td[data-label="الإجمالي"]')).toHaveText(formatMoney(s.digital.price))
        await expect(row.locator('td[data-label="البريد"]')).toHaveText(email)
        await row.getByRole('link', { name: number, exact: true }).click()
        await expect(admin.getByRole('heading', { level: 1 })).toHaveText(number)
        const payment = section(admin, 'الدفع')
        const evidence = payment.locator('[class*="listItem"]').filter({ hasText: String(attempt.provider_invoice_id) })
        await expect(evidence.getByText(`رقم الفاتورة لدى Moyasar: ${attempt.provider_invoice_id}`)).toBeVisible()
        await expect(evidence.getByText(`رقم الدفعة لدى Moyasar: ${attempt.provider_payment_id}`)).toBeVisible()
        await expect(evidence.getByText('حالة المزوّد: paid')).toBeVisible()
        await expect(evidence.getByText(`المقبوض: ${formatMoney(s.digital.price)}`)).toBeVisible()
        await expect(evidence.getByText('الحالة: مدفوع')).toBeVisible()
        const event = await h.row('select outcome from finance.payment_events where provider_payment_id = $1', [attempt.provider_payment_id])
        const eventRow = payment.locator('tbody tr').filter({ hasText: 'payment_paid' })
        await expect(eventRow).toHaveCount(1)
        await expect(eventRow.locator('td[data-label="النتيجة"]')).toHaveText(String(event.outcome))
        await expect(section(admin, 'الملفات').getByText('ممنوح')).toBeVisible()
        await snap(admin, 'book-admin', width)
      } finally {
        await staff.close()
      }
      expect(errors).toEqual([])
    })

    test('2. paper and signed editions: paid, shipped with a tracking number, delivered, returned and restocked', async ({ page, browser }) => {
      const errors = pageErrors(page)
      const email = buyer(width, 'paper')
      const stock0 = await stockOf(s.physical.id)
      const total = await fillCart(page, s, [{ v: s.physical, quantity: 2 }, { v: s.signed, dedication: 'إلى أنس مع المحبة' }])
      expect(total).toBe(2 * s.physical.price + s.signed.price + FEE)
      const number = await placeOrder(page, { email, physical: true })
      await payOnStandIn(page, PAY_OK)
      await expectPaidReturn(page, number)
      const order = await orderOf(number)
      expect(order).toMatchObject({ status: 'paid', total_halalas: total })
      expect(await stockOf(s.physical.id)).toBe(stock0 - 2)
      expect(await states(order.id)).toEqual(['preparing', 'preparing'])

      // The receipt, once: both lines with their quantities, the delivery fee and the total paid. The mail isolates each
      // stored text in its own direction (U+2068 … U+2069).
      const receipt = await waitForMail(email, 'إيصال طلبك رقم')
      const isolated = (text: string): string => `⁨${text}⁩`
      expect(receipt).toContain(`- ${isolated(s.productTitle)} (${isolated(s.physical.title)}) × 2: ${formatMoney(2 * s.physical.price)}`)
      expect(receipt).toContain(`- ${isolated(s.productTitle)} (${isolated(s.signed.title)}) × 1: ${formatMoney(s.signed.price)}`)
      expect(receipt).toContain(`التوصيل: ${formatMoney(FEE)}`)
      expect(receipt).toContain(`الإجمالي المدفوع: ${formatMoney(total)}`)
      expect((await mailsTo(email)).filter((mail) => mail.subject.includes('إيصال طلبك'))).toHaveLength(1)
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = $1", [order.id])).toBe(1)

      // The buyer's order page, from the return page's own link: both lines are being prepared.
      await page.getByRole('link', { name: 'عرض الطلب' }).click()
      await expect(page).toHaveURL(/\/orders$/)
      await expect(statusLine(page).first()).toHaveText('مدفوع.')
      const paperLine = page.locator('main li', { hasText: s.physical.title })
      const signedLine = page.locator('main li', { hasText: s.signed.title })
      await expect(paperLine).toContainText('قيد التجهيز')
      await expect(signedLine).toContainText('قيد التجهيز')
      await expect(page.getByText('رقم التتبع')).toHaveCount(0)

      // The owner: the dedication is ticked first (a signed line cannot ship before it), then both ship with a carrier and a
      // tracking number, then both are delivered.
      const tracking = `TRK-${marker}`
      const staff = await asStaff(browser, 'owner', width)
      try {
        const admin = staff.page
        await admin.goto(`/admin/orders/view?id=${order.id}`)
        await expect(admin.getByRole('heading', { level: 1 })).toHaveText(number)
        const shipping = section(admin, 'الشحن')
        const lineBox = (v: V): Locator => shipping.getByRole('checkbox', { name: `${s.productTitle}: ${v.title}`, exact: true })
        await lineBox(s.signed).check()
        await button(shipping, 'تم الإهداء').click()
        await expect(shipping.locator('td[data-label="الإهداء"]').filter({ hasText: 'نعم' })).toHaveCount(1)
        await lineBox(s.physical).check()
        await shipping.getByLabel('شركة الشحن', { exact: true }).fill('SMSA')
        await shipping.getByLabel('رقم التتبع', { exact: true }).fill(tracking)
        await button(shipping, 'تم الشحن').click()
        await expect.poll(() => states(order.id)).toEqual(['shipped', 'shipped'])
        await expect(shipping.locator('td[data-label="رقم التتبع"]').filter({ hasText: tracking })).toHaveCount(2)
        await lineBox(s.signed).check()
        await lineBox(s.physical).check()
        await button(shipping, 'تم التسليم').click()
        await expect.poll(() => states(order.id)).toEqual(['delivered', 'delivered'])
        await expect(statusLine(admin)).toHaveText('تم التحديث.')
      } finally {
        await staff.close()
      }

      // One `order_shipped` mail for the shipment, with the carrier and the tracking number.
      const shipped = await waitForMail(email, 'شحنة جديدة من طلبك رقم')
      expect(shipped).toContain('SMSA')
      expect(shipped).toContain(tracking)
      expect((await mailsTo(email)).filter((mail) => mail.subject.includes('شحنة جديدة'))).toHaveLength(1)

      // The buyer's page shows the tracking and the delivery, and offers a return of each line.
      await page.reload()
      await expect(statusLine(page).first()).toHaveText('مدفوع.')
      await expect(paperLine).toContainText('سُلّم')
      await expect(paperLine.getByText('شركة الشحن: SMSA')).toBeVisible()
      await expect(paperLine.getByText(`رقم التتبع: ${tracking}`)).toBeVisible()
      await snap(page, 'paper-tracking', width)

      // The buyer files a return of one copy of the paper edition.
      const form = page.getByRole('form', { name: 'طلب إرجاع' })
      await form.getByRole('spinbutton', { name: new RegExp(`^الكمية: ${esc(s.productTitle)}: ${esc(s.physical.title)}`) }).fill('1')
      await form.getByLabel('سبب الإرجاع').fill('وصلت بغلاف تالف')
      await button(form, 'إرسال طلب الإرجاع').click()
      await expect(page.getByText('وصلنا طلب الإرجاع.')).toBeVisible()
      await expect(page.getByRole('list', { name: 'طلبات الإرجاع' }).getByRole('listitem')).toContainText('قيد المراجعة')
      const request1 = await h.row('select id, state, items from finance.return_requests where order_id = $1', [order.id])
      expect(request1).toMatchObject({ state: 'requested' })

      // The owner approves it and receives the goods back with a restock: the stock rises by one.
      const before = await stockOf(s.physical.id)
      const owner2 = await asStaff(browser, 'owner', width)
      try {
        const admin = owner2.page
        await admin.goto(`/admin/orders/view?id=${order.id}`)
        const returns = section(admin, 'الإرجاع')
        await expect(returns.getByText('الحالة: مطلوب')).toBeVisible()
        await button(returns, 'قبول').click()
        await expect(statusLine(admin)).toHaveText('تم تسجيل القرار.')
        await expect(returns.getByText('الحالة: مقبول')).toBeVisible()
        await returns.getByLabel(`يعود إلى المخزون: ${s.productTitle}: ${s.physical.title}`).fill('1')
        await button(returns, 'تم الاستلام').click()
        await expect(statusLine(admin)).toContainText('تم تسجيل الاستلام.')
        await expect(statusLine(admin)).toContainText(`${s.physical.sku} من ${before} إلى ${before + 1}`)
        await expect(returns.getByText('الحالة: مُستلَم')).toBeVisible()
        await snap(admin, 'paper-return', width)
      } finally {
        await owner2.close()
      }
      expect(await stockOf(s.physical.id)).toBe(before + 1)
      expect((await h.row('select state from finance.return_requests where order_id = $1', [order.id])).state).toBe('received')
      await page.reload()
      await expect(page.getByRole('list', { name: 'طلبات الإرجاع' }).getByRole('listitem')).toContainText('استُلم')
      expect(errors).toEqual([])
    })

    test('3. a failed payment leaves the invoice payable; the return page says pending; the second try settles it once', async ({ page }) => {
      const email = buyer(width, 'failed')
      await fillCart(page, s, [{ v: s.digital }])
      const number = await placeOrder(page, { email, physical: false })
      await payOnStandIn(page, PAY_FAIL)

      // «دفع مرفوض»: the stand-in page stays, says so, and still offers the payment.
      await expect(page.getByText('فشل الدفع: رصيد غير كافٍ (محاكاة). يمكنك المحاولة مرة أخرى.')).toBeVisible()
      await expect(button(page, PAY_OK)).toBeVisible()
      await snap(page, 'failed-standin', width, false)
      const order = await orderOf(number)
      expect(order.status).toBe('pending_payment')
      const failed = await emulatorOf(number)
      expect(failed.invoice?.status).toBe('initiated')
      expect(failed.payments.map((payment) => payment.status)).toEqual(['failed'])

      // «رجوع»: the return page shows the payment still pending, with the way back to the invoice.
      await button(page, 'رجوع').click()
      await expect(page).toHaveURL(new RegExp(`/checkout/return\\?order=${number}$`))
      const resume = page.getByRole('link', { name: 'متابعة الدفع' })
      await expect(resume).toHaveAttribute('href', INVOICE_PAGE)
      await expect(page.getByText('جارٍ التحقق من الدفع…')).toBeVisible()
      await expect(page.getByText('تم الدفع.')).toHaveCount(0)
      expect(await kept(page, PENDING_KEY)).not.toBeNull()
      expect(await stored(page, CART_KEY)).toContain('"quantity":1')
      await snap(page, 'failed-return', width)
      expect((await orderOf(number)).status).toBe('pending_payment')

      // The second try, «دفع ناجح», settles the order once: one paid attempt, one receipt.
      await resume.click()
      await expect(page).toHaveURL(INVOICE_PAGE)
      await button(page, PAY_OK).click()
      await expectPaidReturn(page, number)
      expect((await orderOf(number)).status).toBe('paid')
      const attempts = await h.rows('select status, provider_payment_id from finance.payment_attempts where order_id = $1', [order.id])
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({ status: 'paid' })
      const settled = await emulatorOf(number)
      expect(settled.payments.map((payment) => payment.status)).toEqual(['failed', 'paid'])
      expect(attempts[0]!.provider_payment_id).toBe(settled.payments[1]!.id)
      const events = await h.rows('select type, outcome from finance.payment_events where provider_payment_id = any($1::text[]) order by received_at', [settled.payments.map((payment) => payment.id)])
      expect(events.map((event) => `${event.type}:${event.outcome}`)).toEqual(['payment_failed:not_paid', 'payment_paid:paid'])

      await waitForMail(email, 'إيصال طلبك رقم')
      await runOutbox()
      expect((await mailsTo(email)).filter((mail) => mail.subject.includes('إيصال طلبك'))).toHaveLength(1)
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = $1", [order.id])).toBe(1)
    })

    test('4. 3-D Secure: the challenge, then success; and a second order whose challenge is rejected stays unpaid', async ({ page }) => {
      // The first order: the 3-D Secure step, «موافقة».
      const approved = await (async () => {
        await fillCart(page, s, [{ v: s.digital }])
        const number = await placeOrder(page, { email: buyer(width, '3ds-ok'), physical: false })
        await payOnStandIn(page, PAY_3DS)
        await expect(page.getByRole('heading', { name: 'التحقق 3-D Secure (محاكاة)' })).toBeVisible()
        await snap(page, '3ds-challenge', width, false)
        await button(page, 'موافقة').click()
        await expectPaidReturn(page, number)
        return number
      })()
      expect((await orderOf(approved)).status).toBe('paid')
      const ok = await emulatorOf(approved)
      expect(ok.payments.map((payment) => payment.status)).toEqual(['paid'])
      expect(ok.invoice?.status).toBe('paid')

      // The second order: the same step, «رفض»: the page says it failed, the invoice stays payable, nothing is paid.
      await fillCart(page, s, [{ v: s.digital }])
      const rejectedEmail = buyer(width, '3ds-no')
      const rejected = await placeOrder(page, { email: rejectedEmail, physical: false })
      await payOnStandIn(page, PAY_3DS)
      await button(page, 'رفض').click()
      await expect(page.getByText('فشل التحقق من 3-D Secure (محاكاة). يمكنك المحاولة مرة أخرى.')).toBeVisible()
      await expect(button(page, PAY_OK)).toBeVisible()
      const order = await orderOf(rejected)
      expect(order.status).toBe('pending_payment')
      const no = await emulatorOf(rejected)
      expect(no.invoice?.status).toBe('initiated')
      expect(no.payments.map((payment) => payment.status)).toEqual(['failed'])
      await button(page, 'رجوع').click()
      await expect(page.getByRole('link', { name: 'متابعة الدفع' })).toHaveAttribute('href', INVOICE_PAGE)
      await expect(page.getByText('تم الدفع.')).toHaveCount(0)
      expect((await orderOf(rejected)).status).toBe('pending_payment')
      expect(await h.count("select count(*)::int as n from finance.payment_attempts where order_id = $1 and status = 'paid'", [order.id])).toBe(0)
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = $1", [order.id])).toBe(0)
    })

    test('5. a cancel frees the held stock at once; a payment forced on the cancelled invoice lands as a late payment and is never lost', async ({ page, browser }) => {
      // Buyer A takes the only copy and holds it.
      const emailA = buyer(width, 'cancel-a')
      await fillCart(page, s, [{ v: s.scarce }])
      const number = await placeOrder(page, { email: emailA, physical: true })
      const order = await orderOf(number)
      expect(await stockOf(s.scarce.id)).toBe(1)
      expect(await h.count("select count(*)::int as n from finance.inventory_reservations where order_id = $1 and state = 'held'", [order.id])).toBe(1)

      // Buyer B, on another device, is told that the copy is held for another order, not that it is gone.
      const other = await buyerContext(browser, width)
      try {
        const pageB = await other.newPage()
        await addLines(pageB, s, [{ v: s.scarce }])
        await pageB.goto('/cart')
        await expect(pageB.getByText(HELD, { exact: true })).toBeVisible()
        await expect(pageB.getByText(/المتاح:/)).toHaveCount(0)
        await expect(button(pageB, 'إزالة غير المتاح')).toBeVisible()
        // No way on to the checkout while the only line is refused.
        await expect(pageB.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toHaveCount(0)
        await expect(pageB.getByText('أزل غير المتاح أو عدّل الكمية لإتمام الطلب.', { exact: true })).toBeVisible()
        await snap(pageB, 'cancel-held', width)

        // A cancels from the hold view: the order is cancelled, the invoice is cancelled at the provider, the copy is free.
        await button(page, 'إلغاء الطلب').click()
        await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
        await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveCount(0)
        expect(await kept(page, PENDING_KEY)).toBeNull()
        expect((await orderOf(number)).status).toBe('cancelled')
        expect((await emulatorOf(number)).invoice?.status).toBe('canceled')
        expect(await h.count("select count(*)::int as n from finance.inventory_reservations where order_id = $1 and state = 'held'", [order.id])).toBe(0)
        expect(await stockOf(s.scarce.id)).toBe(1)

        // B can order the same quantity at once: the cart quotes it, and the order is made (then B cancels it too).
        await pageB.reload()
        await pageB.getByLabel('مدينة التوصيل').selectOption(cityKey)
        await expect(pageB.getByText(HELD, { exact: true })).toHaveCount(0)
        await expect(totalRow(pageB, 'الإجمالي')).toContainText(formatMoney(s.scarce.price + FEE))
        const numberB = await placeOrder(pageB, { email: buyer(width, 'cancel-b'), physical: true })
        expect((await orderOf(numberB)).status).toBe('pending_payment')
        await button(pageB, 'إلغاء الطلب').click()
        await expect(pageB.getByText('أُلغي الطلب.')).toBeVisible()
        expect((await orderOf(numberB)).status).toBe('cancelled')
      } finally {
        await other.close()
      }

      // The provider charges A's cancelled invoice after all (forced: the stand-in page would refuse it). The webhook finds the
      // attempt by its invoice: the payment is recorded, and since the copy is free the order is paid; nothing is lost.
      const invoice = (await emulatorOf(number)).invoice
      expect(invoice).toBeDefined()
      await emulatorControl('pay', { invoiceId: invoice!.id, status: 'paid', force: true })
      await expect.poll(async () => (await orderOf(number)).status).toBe('paid')
      const attempt = await h.row('select status, captured_halalas, provider_payment_id, paid_at from finance.payment_attempts where order_id = $1', [order.id])
      expect(attempt).toMatchObject({ status: 'paid', captured_halalas: s.scarce.price + FEE })
      expect(attempt.paid_at).not.toBeNull()
      expect((await emulatorOf(number)).payments.map((payment) => payment.id)).toEqual([attempt.provider_payment_id])
      expect(await stockOf(s.scarce.id)).toBe(0)
      expect(await states(order.id)).toEqual(['preparing'])
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = $1", [order.id])).toBe(1)
      // A buyer who comes back to the return page is told it is paid.
      await page.goto(`/checkout/return?order=${number}`)
      await expect(page.getByText('تم الدفع.')).toBeVisible()
    })

    test('6. a refund of one line through the step-up: the provider, the ledger, the mail, the buyer\'s page and the download agree', async ({ page, browser, request }) => {
      const email = buyer(width, 'refund')
      await fillCart(page, s, [{ v: s.digital }, { v: s.physical }])
      const number = await placeOrder(page, { email, physical: true })
      await payOnStandIn(page, PAY_OK)
      await expectPaidReturn(page, number)
      const orderHref = await page.getByRole('link', { name: 'عرض الطلب' }).getAttribute('href')
      expect(orderHref).toMatch(new RegExp(`^/orders#${number}\\.`))
      const order = await orderOf(number)
      const attempt = await h.row('select id, provider_payment_id from finance.payment_attempts where order_id = $1', [order.id])
      const digitalItem = (await h.row("select id from finance.order_items where order_id = $1 and fulfillment = 'digital'", [order.id])).id as string

      // The owner opens the order and refunds the digital line in full; the session holds no fresh code, so the first call
      // is refused for it, the dialog takes a real one, and the same call (the same key) goes through.
      const staff = await asStaff(browser, 'owner', width)
      // What the page's own `refund-create` calls were and answered, kept for the assertions and for the replay below.
      const seen: { replay?: { headers: Record<string, string>; body: Record<string, unknown> }; first?: { refundId: string; status: string; amount: number } } = {}
      const calls: Array<{ key: unknown; status: number }> = []
      try {
        const admin = staff.page
        const requests = new Map<Request, Record<string, unknown>>()
        admin.on('request', (req) => {
          if (req.method() === 'POST' && req.url() === functionUrl('admin') && req.postDataJSON()?.action === 'refund-create') requests.set(req, req.postDataJSON() as Record<string, unknown>)
        })
        admin.on('response', async (response) => {
          const body = requests.get(response.request())
          if (body === undefined) return
          calls.push({ key: body.idempotencyKey, status: response.status() })
          if (response.status() === 200) {
            seen.first = ((await response.json()) as { data: { refundId: string; status: string; amount: number } }).data
            const sent = await response.request().allHeaders()
            seen.replay = { headers: { authorization: sent.authorization ?? '', apikey: sent.apikey ?? '', 'content-type': 'application/json', origin: SITE_ORIGIN }, body }
          }
        })
        await admin.goto(`/admin/orders/view?id=${order.id}`)
        await expect(admin.getByRole('heading', { level: 1 })).toHaveText(number)
        const refunds = section(admin, 'الاستردادات')
        await refunds.getByLabel(`${s.productTitle}: ${s.digital.title}`, { exact: true }).fill(riyals(s.digital.price))
        await refunds.getByLabel('السبب', { exact: true }).fill('استرداد الكتاب الإلكتروني')
        await button(refunds, 'إعادة المبلغ').click()
        await expect(refunds.getByText(`الإجمالي: ${formatMoney(s.digital.price)}`)).toBeVisible()
        await snap(admin, 'refund-confirm', width)
        await button(refunds, 'تأكيد الاسترداد').click()
        await enterCode(admin)
        await expect(statusLine(admin)).toHaveText(`تمت إعادة ${formatMoney(s.digital.price)}.`)
        await snap(admin, 'refund-done', width)
      } finally {
        await staff.close()
      }
      await expect.poll(() => seen.replay !== undefined).toBe(true)
      expect(calls.map((call) => call.status)).toEqual([403, 200])
      expect(calls[0]!.key).toBe(calls[1]!.key)
      expect(seen.first).toMatchObject({ status: 'succeeded', amount: s.digital.price })

      // The provider's refunded total, the attempt's and the refund rows' agree; the order stays paid for the paper line.
      const provider = await emulatorOf(number)
      expect(provider.payments).toHaveLength(1)
      expect(provider.payments[0]).toMatchObject({ id: attempt.provider_payment_id, refunded: s.digital.price })
      const refundCalls = (state: Awaited<ReturnType<typeof emulatorState>>) => state.calls.filter((call) => call.route === 'POST /v1/payments/:id/refund')
      expect(refundCalls(provider.state)).toHaveLength(1)
      expect(refundCalls(provider.state)[0]).toMatchObject({ status: 200, body: { amount: s.digital.price } })
      const ledgerTotal = Number((await h.row("select coalesce(sum(amount_halalas), 0)::int as n from finance.refunds where attempt_id = $1 and status = 'succeeded'", [attempt.id])).n)
      expect(ledgerTotal).toBe(s.digital.price)
      expect(Number((await h.row('select provider_refunded_halalas from finance.payment_attempts where id = $1', [attempt.id])).provider_refunded_halalas)).toBe(ledgerTotal)
      expect(provider.payments[0]!.refunded).toBe(ledgerTotal)
      expect((await orderOf(number)).status).toBe('paid')
      expect(await h.count('select count(*)::int as n from finance.entitlements where order_id = $1 and revoked_at is not null', [order.id])).toBe(1)

      // A replay of the same call (the same idempotency key) is answered with the stored refund and never reaches the provider.
      const again = await request.post(functionUrl('admin'), { headers: seen.replay!.headers, data: seen.replay!.body })
      expect(again.status()).toBe(200)
      expect(((await again.json()) as { data: unknown }).data).toEqual(seen.first)
      expect(refundCalls(await emulatorState())).toHaveLength(1)
      expect(await h.count('select count(*)::int as n from finance.refunds where attempt_id = $1', [attempt.id])).toBe(1)

      // The mail, and the buyer's page: the refunded amount, no download for the refunded book, the paper line untouched.
      const mail = await waitForMail(email, 'استرداد من طلبك رقم')
      expect(mail).toContain(`تم استرداد ${formatMoney(s.digital.price)} من طلبك رقم`)
      expect(mail).toContain(`إجمالي ما استُرد من هذا الطلب حتى الآن: ${formatMoney(s.digital.price)}.`)
      await page.goto(orderHref!)
      await expect(statusLine(page).first()).toHaveText('مدفوع.')
      await expect(totalRow(page, 'المبلغ المُعاد')).toContainText(formatMoney(s.digital.price))
      const bookLine = page.locator('main li', { hasText: s.digital.title })
      await expect(bookLine).toContainText('أُلغي حق التنزيل.')
      await expect(bookLine.getByRole('button')).toHaveCount(0)
      await expect(page.locator('main li', { hasText: s.physical.title })).toContainText('قيد التجهيز')
      await snap(page, 'refund-buyer', width)
      const access = JSON.parse((await kept(page, ACCESS_KEY))!) as { orderNumber: string; accessToken: string }
      const issue = await request.post(functionUrl('download'), {
        headers: { origin: SITE_ORIGIN, 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 254) + 1}` },
        data: { action: 'issue', orderNumber: access.orderNumber, accessToken: access.accessToken, itemId: digitalItem },
      })
      expect(issue.status()).toBe(404)

      // Operations see the same order with none of the money controls.
      const ops = await asStaff(browser, 'operations', width)
      try {
        await ops.page.goto(`/admin/orders/view?id=${order.id}`)
        await expect(ops.page.getByRole('heading', { level: 1 })).toHaveText(number)
        await expect(section(ops.page, 'الاستردادات')).toBeVisible()
        for (const name of MONEY_BUTTONS) await expect(button(ops.page, name)).toHaveCount(0)
      } finally {
        await ops.close()
      }
    })

    test('7. the availability notice: a real sign-up, the confirmation, a restock, one notice, the unsubscribe', async ({ page, browser }) => {
      const email = buyer(width, 'notify')
      await page.goto(`/store/${s.slug}`)
      const row = page.locator('li', { hasText: s.soldOut.title })
      await expect(row.getByText('غير متوفر حاليًا', { exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: 'أضف إلى السلة' })).toHaveCount(0)
      const form = row.getByRole('form')
      await form.scrollIntoViewIfNeeded()
      await form.getByLabel('بريدك الإلكتروني').fill(email)
      // The real widget (Cloudflare's always-pass test key) solves itself a moment after the form comes into view; a press
      // before that is answered with its own sentence, so the press is repeated until the one sentence of a sign-up shows.
      const sent = row.getByText(SENT, { exact: true })
      await expect(async () => {
        if (await sent.isVisible()) return
        await form.getByRole('button', { name: 'أخبرني عند توفره' }).click({ timeout: 2_000 })
        await expect(sent).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 60_000 })
      await snap(page, 'notify-sent', width)

      // The real `notify` stored a pending row and queued one confirmation; the privacy revision is the one the page rendered.
      const privacy = await h.rows("select seq from public.published_documents where collection = 'policies' and doc_id = 'privacy'")
      const note = await h.row('select id, status, token_version, consent_revision from public.notifications where email = $1 and variant_id = $2', [email, s.soldOut.id])
      expect(note).toMatchObject({ status: 'pending', token_version: 1, consent_revision: privacy[0]?.seq ?? null })
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'notify_confirm' and payload ->> 'notificationId' = $1", [note.id])).toBe(1)

      // The confirmation mail, its link on /notify/confirm, «تأكيد».
      const confirmMail = await waitForMail(email, 'أكّد طلب التنبيه')
      const confirmLink = confirmMail.match(new RegExp(`${esc(SITE_ORIGIN)}/notify/confirm#\\S+`))?.[0]
      expect(confirmLink, 'the confirmation mail carries its link').toBeDefined()
      await page.goto(confirmLink!)
      await expect(statusLine(page).first()).toHaveText('أكّد رغبتك في إشعارك عند توفر المنتج.')
      expect(new URL(page.url()).hash).toBe('')
      await button(page, 'تأكيد').click()
      await expect(statusLine(page).first()).toHaveText('تم التأكيد. سنراسلك عند توفر المنتج.')
      expect((await h.row('select status from public.notifications where id = $1', [note.id])).status).toBe('confirmed')
      await snap(page, 'notify-confirmed', width)

      // A second reader of the same item, signed up and confirmed through the same functions the `notify` function calls
      // (only while the item is out of stock): still subscribed after the first leaves, so the later restock has someone to tell.
      const stays = buyer(width, 'notify-stays')
      expect(await h.call('notify_subscribe', { p_ip_hash: h.ipHash(), p_email: stays, p_variant: s.soldOut.id, p_consent_revision: note.consent_revision })).toMatchObject({ ok: true })
      const second = await h.row('select id, token_version from public.notifications where email = $1 and variant_id = $2', [stays, s.soldOut.id])
      expect(await h.call('notify_confirm', { p_id: second.id, p_token_version: second.token_version })).toMatchObject({ ok: true })

      // Nothing is sent while the item is out of stock; the owner raises the stock in the variant form.
      await h.postgres.query('select finance.availability_sweep()')
      expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'availability' and payload ->> 'notificationId' = $1", [note.id])).toBe(0)
      const staff = await asStaff(browser, 'owner', width)
      try {
        const admin = staff.page
        await admin.goto(`/admin/store/variants/edit?id=${s.soldOut.id}`)
        await admin.getByLabel('المخزون').fill('5')
        await button(admin, 'حفظ').click()
        await expect(admin.getByText('تم الحفظ.')).toBeVisible()
      } finally {
        await staff.close()
      }
      expect(await stockOf(s.soldOut.id)).toBe(5)
      await page.goto(`/store/${s.slug}`)
      await expect(row.getByRole('button', { name: 'أضف إلى السلة' })).toBeVisible()
      await expect(row.getByRole('form')).toHaveCount(0)

      // The sweep (called now instead of waiting a minute) queues one notice; a second sweep queues nothing more. Its EXECUTE is
      // revoked from service_role (it is the cron's), so it is called as the local migration role, like the integration tests do.
      const sweep = (): Promise<unknown> => h.postgres.query('select finance.availability_sweep()')
      await sweep()
      await sweep()
      const notices = () => h.rows("select status from finance.email_outbox where kind = 'availability' and payload ->> 'notificationId' = $1", [note.id])
      expect(await notices()).toHaveLength(1)
      const notice = await waitForMail(email, 'توفّر')
      await sweep()
      await runOutbox()
      expect(await notices()).toHaveLength(1)
      expect((await mailsTo(email)).filter((mail) => mail.subject.includes('توفّر'))).toHaveLength(1)

      // The notice's unsubscribe link on /notify/unsubscribe works.
      const leaveLink = notice.match(new RegExp(`${esc(SITE_ORIGIN)}/notify/unsubscribe#\\S+`))?.[0]
      expect(leaveLink, 'the notice carries its unsubscribe link').toBeDefined()
      expect(notice).toContain(`${SITE_ORIGIN}/store/${s.slug}`)
      await page.goto(leaveLink!)
      await expect(statusLine(page).first()).toHaveText('أوقف إشعارات توفر هذا المنتج.')
      await button(page, 'إلغاء الاشتراك').click()
      await expect(statusLine(page).first()).toHaveText('أُلغي الاشتراك.')
      await snap(page, 'notify-left', width)
      expect((await h.row('select status from public.notifications where id = $1', [note.id])).status).toBe('unsubscribed')

      // A later restock mails the one who left nothing: the owner sells the item out and brings it back through the same form;
      // the reader who stayed is told again, the one who left is not.
      const again = await asStaff(browser, 'owner', width)
      try {
        const admin = again.page
        await admin.goto(`/admin/store/variants/edit?id=${s.soldOut.id}`)
        const stock = admin.getByLabel('المخزون')
        await expect(stock).toHaveValue('5')
        await stock.fill('0')
        await button(admin, 'حفظ').click()
        await expect.poll(() => stockOf(s.soldOut.id)).toBe(0)
        await sweep()
        await stock.fill('5')
        await button(admin, 'حفظ').click()
        await expect.poll(() => stockOf(s.soldOut.id)).toBe(5)
      } finally {
        await again.close()
      }
      await sweep()
      const stayed = () => h.rows("select dedupe_key from finance.email_outbox where kind = 'availability' and payload ->> 'notificationId' = $1 order by dedupe_key", [second.id])
      expect((await stayed()).map((row) => row.dedupe_key)).toEqual([`availability:${s.soldOut.id}:1:${second.id}`, `availability:${s.soldOut.id}:2:${second.id}`])
      await expect
        .poll(async () => {
          await runOutbox()
          return (await mailsTo(stays)).filter((mail) => mail.subject.includes('توفّر')).length
        })
        .toBe(2)
      expect(await notices()).toHaveLength(1)
      expect((await mailsTo(email)).filter((mail) => mail.subject.includes('توفّر'))).toHaveLength(1)
    })

    test('8. a preorder: the date and the note before paying, on the order page and in the receipt; the capacity ends the next quote', async ({ page, browser, request }) => {
      const errors = pageErrors(page)
      const email = buyer(width, 'preorder')
      const date = `طلب مسبق: يُسلَّم في ${formatDate(s.shipsOn)}`

      // The product page, the cart and the checkout all show the delivery day and the note before the buyer pays.
      await page.goto(`/store/${s.slug}`)
      const row = page.locator('li', { hasText: s.preorder.title })
      await expect(row.getByText(date, { exact: true })).toBeVisible()
      await expect(row.getByText(s.note, { exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: 'اطلب مسبقًا' })).toBeVisible()
      await snap(page, 'preorder-product', width)
      const total = await fillCart(page, s, [{ v: s.preorder }])
      const line = page.locator('main li', { hasText: s.preorder.title })
      await expect(line.getByText(date, { exact: true })).toBeVisible()
      await expect(line.getByText(s.note, { exact: true })).toBeVisible()
      await snap(page, 'preorder-cart', width)
      await page.getByRole('link', { name: 'المتابعة لإتمام الطلب' }).click()
      const summary = page.locator('main fieldset', { hasText: 'ملخص الطلب' })
      await expect(summary.getByText(date, { exact: true })).toBeVisible()
      await expect(summary.getByText(s.note, { exact: true })).toBeVisible()
      await submitCheckout(page, { email, physical: true })
      await expect(page.locator('#checkout-order-number')).toBeVisible({ timeout: 60_000 })
      const number = (await page.locator('#checkout-order-number span').innerText()).trim()
      await payOnStandIn(page, PAY_OK)
      await expectPaidReturn(page, number)
      const order = await orderOf(number)
      expect(order).toMatchObject({ status: 'paid', total_halalas: total })
      expect(await stockOf(s.preorder.id)).toBe(0)
      expect(await h.count("select count(*)::int as n from finance.inventory_reservations where order_id = $1 and state = 'committed' and preorder", [order.id])).toBe(1)

      // The order page and the receipt carry the stored note.
      await page.getByRole('link', { name: 'عرض الطلب' }).click()
      await expect(statusLine(page).first()).toHaveText('مدفوع.')
      await expect(page.getByText(date, { exact: true })).toBeVisible()
      await expect(page.getByText(s.note, { exact: true })).toBeVisible()
      await snap(page, 'preorder-order', width)
      const receipt = await waitForMail(email, 'إيصال طلبك رقم')
      expect(receipt).toContain('طلب مسبق: التسليم المتوقع')
      expect(receipt).toContain(s.note)

      // The owner's variant form counts the confirmed preorder.
      const staff = await asStaff(browser, 'owner', width)
      try {
        await staff.page.goto(`/admin/store/variants/edit?id=${s.preorder.id}`)
        await expect(main(staff.page).getByText('طلبات مسبقة مؤكدة لم تُشحن: 1', { exact: true })).toBeVisible()
        await snap(staff.page, 'preorder-admin', width, false)
      } finally {
        await staff.close()
      }

      // A buyer who asks for more than what is left of the capacity (3, one taken) is refused by the quote.
      const quote = await request.post(functionUrl('checkout'), {
        headers: { origin: SITE_ORIGIN, 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 254) + 1}` },
        data: { action: 'quote', lines: [{ variantId: s.preorder.id, quantity: 3 }], cityKey },
      })
      const refusal = ((await quote.json()) as { data: { ok: boolean; errors: Array<Record<string, unknown>> } }).data
      expect(refusal.ok).toBe(false)
      expect(refusal.errors[0]).toMatchObject({ code: 'OUT_OF_STOCK', variantId: s.preorder.id, available: 2 })
      const other = await buyerContext(browser, width)
      try {
        const pageB = await other.newPage()
        await pageB.goto(`/store/${s.slug}`)
        const rowB = pageB.locator('li', { hasText: s.preorder.title })
        await rowB.getByLabel('الكمية').fill('3')
        await rowB.getByRole('button', { name: 'اطلب مسبقًا' }).click()
        await expect(rowB.getByText('أُضيف إلى السلة.')).toBeVisible()
        await pageB.goto('/cart')
        await expect(pageB.getByText('الكمية المطلوبة غير متوفرة؛ المتاح: 2.', { exact: true })).toBeVisible()
        await expect(button(pageB, 'إزالة غير المتاح')).toBeVisible()
        await expect(pageB.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toHaveCount(0)
        await snap(pageB, 'preorder-refused', width)
      } finally {
        await other.close()
      }
      expect(errors).toEqual([])
    })

    test('9. a dispute: a chargeback recorded through the step-up, a repeat answered as a duplicate, a follow-up; the figures and the ledger agree', async ({ page, browser }) => {
      const email = buyer(width, 'dispute')
      await fillCart(page, s, [{ v: s.digital }])
      const number = await placeOrder(page, { email, physical: false })
      await payOnStandIn(page, PAY_OK)
      await expectPaidReturn(page, number)
      const order = await orderOf(number)
      const attempt = await h.row('select id, provider_payment_id from finance.payment_attempts where order_id = $1', [order.id])
      const day = await emptyDay()
      const reference = `CB-${marker}-${width}`
      const amount = riyals(s.digital.price)

      const staff = await asStaff(browser, 'owner', width)
      try {
        const admin = staff.page
        await admin.goto(`/admin/orders/view?id=${order.id}`)
        await expect(admin.getByRole('heading', { level: 1 })).toHaveText(number)
        const record = async (): Promise<void> => {
          const card = section(admin, 'الدفع').locator('[class*="listItem"]').filter({ hasText: String(attempt.provider_payment_id) })
          await button(card, 'تسجيل اعتراض').click()
          const form = admin.getByRole('form', { name: 'تسجيل اعتراض' })
          await form.getByLabel('المرجع', { exact: true }).fill(reference)
          await form.getByLabel('المبلغ', { exact: true }).fill(amount)
          await form.getByLabel('التاريخ', { exact: true }).fill(day)
          await form.getByLabel('السبب', { exact: true }).fill('اعتراض من حامل البطاقة')
          await button(form, 'تأكيد التسجيل').click()
        }
        // The chargeback: the session holds no fresh code, so the dialog asks for one; then «سُجّل.».
        await record()
        await enterCode(admin)
        await expect(statusLine(admin)).toHaveText('سُجّل.')
        const disputes = section(admin, 'النزاعات')
        await expect(disputes.getByText(`المرجع: ${reference}`)).toBeVisible()
        await expect(disputes.getByText(`المبلغ: ${formatMoney(s.digital.price)}`)).toBeVisible()
        await snap(admin, 'dispute-recorded', width)
        expect(await h.count('select count(*)::int as n from finance.disputes where provider_ref = $1', [reference])).toBe(1)

        // The same row again is answered as a duplicate, and nothing changes.
        await record()
        const duplicate = admin.getByText('هذا السجل مسجّل من قبل؛ لم يتغير شيء.')
        await answerIfAsked(admin, duplicate)
        await expect(duplicate).toBeVisible()
        expect(await h.count('select count(*)::int as n from finance.disputes where provider_ref = $1', [reference])).toBe(1)

        // The follow-up, from the reconciliation screen: the dispute is won, so the same amount turns to the seller's side.
        await admin.goto('/admin/orders/reconciliation')
        const card = main(admin).locator('[class*="listItem"]').filter({ hasText: reference })
        await expect(card).toBeVisible()
        await button(card, 'إضافة متابعة').click()
        const follow = admin.getByRole('form', { name: 'إضافة متابعة' })
        await follow.getByLabel('المبلغ', { exact: true }).fill(amount)
        await follow.getByLabel('الاتجاه', { exact: true }).selectOption({ label: 'لصالح البائع' })
        await follow.getByLabel('التاريخ', { exact: true }).fill(day)
        await follow.getByLabel('السبب', { exact: true }).fill('قُبل اعتراض البائع')
        await follow.getByLabel('الحل (اختياري)').fill('أُعيد المبلغ إلى البائع')
        await button(follow, 'تأكيد التسجيل').click()
        await answerIfAsked(admin, statusLine(admin).filter({ hasText: 'سُجّل.' }))
        await expect(statusLine(admin)).toHaveText('سُجّل.')
        await expect(card.getByText('التسلسل: 2')).toBeVisible()
        await snap(admin, 'dispute-followed', width, false)
        const rows = await h.rows('select seq, direction, amount_halalas, occurred_on::text as day from finance.disputes where provider_ref = $1 order by seq', [reference])
        expect(rows.map((entry) => [Number(entry.seq), entry.direction, Number(entry.amount_halalas), entry.day])).toEqual([
          [1, 'against_seller', s.digital.price, day],
          [2, 'for_seller', s.digital.price, day],
        ])

        // The statistics screen's dispute figures are the ledger's: one dispute, now on the seller's side.
        const figures = await ledger(day, day)
        expect(figures.disputes).toEqual({ count: 1, againstSeller: 0, forSeller: s.digital.price })
        await admin.goto('/admin/stats')
        await expect(admin.getByRole('heading', { level: 1, name: 'الإحصاءات' })).toBeVisible()
        await admin.getByLabel('من', { exact: true }).fill(day)
        await admin.getByLabel('إلى', { exact: true }).fill(day)
        await button(admin, 'عرض').click()
        await expect(admin.getByText(`الأرقام من ${formatDate(day)} إلى ${formatDate(day)}.`)).toBeVisible()
        await expect(admin.getByText(`النزاعات: 1، على البائع ${formatMoney(0)}، لصالح البائع ${formatMoney(s.digital.price)}`, { exact: true })).toBeVisible()
        await snap(admin, 'dispute-stats', width, false)
      } finally {
        await staff.close()
      }

      // No refund was made or asked for: the order, the attempt, the files and the provider are as they were.
      expect(await h.count('select count(*)::int as n from finance.refunds where order_id = $1', [order.id])).toBe(0)
      expect(Number((await h.row('select provider_refunded_halalas from finance.payment_attempts where id = $1', [attempt.id])).provider_refunded_halalas)).toBe(0)
      expect((await orderOf(number)).status).toBe('paid')
      expect(await h.count('select count(*)::int as n from finance.entitlements where order_id = $1 and revoked_at is null', [order.id])).toBe(1)
      expect((await emulatorOf(number)).payments[0]).toMatchObject({ refunded: 0, status: 'paid' })
    })

    test('10. the owner\'s switch: closed through the commerce settings, the checkout refuses a new order; opened again, one goes through', async ({ page, browser, request }) => {
      const email = buyer(width, 'switch')
      const total = await fillCart(page, s, [{ v: s.digital }])
      const staff = await asStaff(browser, 'owner', width)
      try {
        const admin = staff.page
        await admin.goto('/admin/settings')
        await expect(admin.getByRole('heading', { name: 'إعدادات المتجر' })).toBeVisible()
        const purchase = admin.getByRole('group', { name: 'الشراء' })
        await expect(purchase.getByText('الشراء مفتوح')).toBeVisible()

        // Closing asks for a code: the dialog, a real one, and the same call goes through.
        await button(purchase, 'أغلق الشراء').click()
        await enterCode(admin)
        await expect(admin.getByText('تم إغلاق الشراء.')).toBeVisible()
        await expect(purchase.getByText('الشراء مغلق')).toBeVisible()
        await snap(admin, 'switch-closed', width, false)
        expect((await h.row('select checkout_enabled from finance.commerce_settings where id = 1')).checkout_enabled).toBe(false)

        // The cart and the checkout page refuse a new order: no way to continue, no form.
        await page.goto('/cart')
        await expect(page.getByText(OFF)).toBeVisible()
        await expect(page.getByRole('link', { name: 'المتابعة لإتمام الطلب' })).toHaveCount(0)
        await snap(page, 'switch-cart', width)
        await page.goto('/checkout')
        await expect(page.getByText(OFF)).toBeVisible()
        await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toHaveCount(0)
        await expect(page.getByLabel('البريد الإلكتروني')).toHaveCount(0)
        // And the function itself refuses a `create` that was never offered: nothing is stored.
        const post = (body: unknown) =>
          request.post(functionUrl('checkout'), { headers: { origin: SITE_ORIGIN, 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 254) + 1}` }, data: body })
        const lines = [{ variantId: s.digital.id, quantity: 1 }]
        const quoted = (await (await post({ action: 'quote', lines })).json()) as { data: { checkoutEnabled: boolean; quoteHash: string } }
        expect(quoted.data.checkoutEnabled).toBe(false)
        expect(quoted.data.quoteHash).toMatch(/^[0-9a-f]{64}$/)
        const revisions = (await h.row('select policy_revisions from finance.commerce_settings where id = 1')).policy_revisions
        const refused = await post({
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
        expect(refused.status()).toBe(503)
        expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'CHECKOUT_DISABLED', message: OFF } })
        expect(await h.count('select count(*)::int as n from finance.orders where customer_email = $1', [email])).toBe(0)

        // Opening again goes through (the code is still fresh), and a new order is made.
        await button(purchase, 'افتح الشراء').click()
        await answerIfAsked(admin, admin.getByText('تم فتح الشراء.'))
        await expect(admin.getByText('تم فتح الشراء.')).toBeVisible()
        await expect(purchase.getByText('الشراء مفتوح')).toBeVisible()
        expect((await h.row('select checkout_enabled from finance.commerce_settings where id = 1')).checkout_enabled).toBe(true)
      } finally {
        await staff.close()
        await h.postgres.query('update finance.commerce_settings set checkout_enabled = true where id = 1')
      }
      await page.goto('/cart')
      await expect(totalRow(page, 'الإجمالي')).toContainText(formatMoney(total))
      const number = await placeOrder(page, { email, physical: false })
      await expect(page.getByRole('link', { name: 'ادفع الآن' })).toHaveAttribute('href', INVOICE_PAGE)
      expect(await orderOf(number)).toMatchObject({ status: 'pending_payment', total_halalas: total })
      await button(page, 'إلغاء الطلب').click()
      await expect(page.getByText('أُلغي الطلب.')).toBeVisible()
    })
  })
}
