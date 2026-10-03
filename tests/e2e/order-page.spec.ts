// P08 round 10a e2e: the buyer's order page (`/orders`) and the two notification link pages
// (`/notify/confirm`, `/notify/unsubscribe`) in the browser on `next dev`. The Edge Functions are mocked with
// `page.route` (their own behaviour is proven by the integration tests of rounds 7 and 8), so every request
// and its body can be asserted; Cloudflare's Turnstile script is replaced by a stub that hands out numbered
// tokens, so the widget's action and the fresh token of each retry can be asserted too. Each test runs at
// 360 and at 1440. Screenshots land in order-*.png under shotsDir('P08'): the accepted evidence folder only for
// an ACCEPTANCE_PACKAGE=P08 run, test-results/ otherwise.
import { mkdirSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

import { shotsDir } from './shots'

const SHOTS = shotsDir('P08')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

const NUMBER = 'ABCD2345'
const SECOND_NUMBER = 'KMNP6789'
// 43 characters of base64url, as the function issues them.
const TOKEN = 'Ab3-_'.repeat(9).slice(0, 43)
const SECOND_TOKEN = 'Qw7_-'.repeat(9).slice(0, 43)
const DOWNLOAD_TOKEN = 'Zy9_-'.repeat(9).slice(0, 43)
const NOTIFY_TOKEN = `0f3c8a1e-5b2d-4c6a-9e47-1a2b3c4d5e6f.${'Mn8_-'.repeat(9).slice(0, 43)}`
const ACCESS_KEY = 'anasaq:order-access'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const NETWORK = 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.'
const TEST_MODE = 'وضع تجريبي: لا يُخصم أي مبلغ حقيقي'
const RECOVERED = 'إن وُجدت طلبات بهذا البريد فسنرسل روابطها إليه.'
const NOT_FOUND = 'لم نجد هذا الطلب، أو انتهت صلاحية رابطه.'

type Reply = { status: number; body: unknown }
type Answer = Reply | 'abort'
/** Answers one call: the body the page sent and which call of this function it is (1, 2, ...). */
type Handler = (body: Record<string, unknown>, nth: number) => Answer | Promise<Answer>
type Calls = Array<{ fn: string; body: Record<string, unknown> }>

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json',
}

const ok = (data: unknown, status = 200): Reply => ({ status, body: { ok: true, data } })
const refused = (status: number, code: string, message: string): Reply => ({ status, body: { ok: false, error: { code, message } } })

/** Mocks the functions the pages call; returns every call made, in order. A handler may delay its answer or answer 'abort' (a lost connection). */
async function mock(page: Page, handlers: Partial<Record<'orders' | 'download' | 'notify', Handler>>): Promise<Calls> {
  const calls: Calls = []
  for (const [fn, handler] of Object.entries(handlers)) {
    if (handler === undefined) continue
    await page.route(`**/functions/v1/${fn}`, async (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      const body = request.postDataJSON() as Record<string, unknown>
      calls.push({ fn, body })
      const answer = await handler(body, calls.filter((call) => call.fn === fn).length)
      if (answer === 'abort') return route.abort('failed')
      return route.fulfill({ status: answer.status, headers: CORS, body: JSON.stringify(answer.body) })
    })
  }
  return calls
}

/** The bodies of the calls to one function. */
const bodies = (calls: Calls, fn: string) => calls.filter((call) => call.fn === fn).map((call) => call.body)

/** Answers in turn from a list (the last repeats). */
const scripted =
  (...answers: Answer[]): Handler =>
  (_body, nth) =>
    answers[Math.min(nth, answers.length) - 1]!

const TURNSTILE_STUB = `(() => {
  const state = { issued: 0, resets: 0, actions: [], last: '' }
  const widgets = {}
  const solve = (id) => setTimeout(() => {
    if (!widgets[id]) return
    state.issued += 1
    state.last = 'stub-token-' + state.issued
    widgets[id].callback(state.last)
  }, 20)
  window.__turnstile = state
  window.turnstile = {
    render(el, options) { const id = 'stub-' + Object.keys(widgets).length; widgets[id] = options; state.actions.push(options.action); solve(id); return id },
    reset(id) { state.resets += 1; solve(id) },
    remove(id) { delete widgets[id] },
  }
  if (window.__anasaqTurnstileOnload) window.__anasaqTurnstileOnload()
})()`

type TurnstileState = { issued: number; resets: number; actions: string[]; last: string }

/** Replaces Cloudflare's Turnstile script with one that solves itself with numbered tokens. */
async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
}
/** The stub's state; empty until the page has loaded the (stubbed) script. */
const turnstile = (page: Page) =>
  page.evaluate(() => (window as unknown as { __turnstile?: TurnstileState }).__turnstile ?? { issued: 0, resets: 0, actions: [], last: '' })
/** Waits until the widget has handed out `n` tokens (the page has one in hand after the render that follows). */
const tokens = (page: Page, n: number) => expect.poll(async () => (await turnstile(page)).issued).toBe(n)

/** An item of the buyer's view; `state`, `carrier`, `tracking` and `download` appear only when given, as the function leaves them out. */
function item(over: Record<string, unknown> = {}) {
  return { itemId: A, title: 'كتاب الاختبار', variantTitle: 'النسخة الورقية', quantity: 2, fulfillment: 'physical', preorder: null, returnable: 0, ...over }
}

/** The `data` of a `get` reply. */
function view(over: { order?: Record<string, unknown>; payment?: Record<string, unknown>; items?: unknown[]; returns?: unknown[] } = {}) {
  return {
    order: {
      id: '99999999-9999-4999-8999-999999999999',
      orderNumber: NUMBER,
      status: 'paid',
      holdExpiresAt: '2026-10-03T12:00:00.123456+00:00',
      subtotal: 4720,
      discount: 0,
      shipping: 1130,
      total: 5850,
      currency: 'SAR',
      environment: 'test',
      lines: [],
      paidAt: '2026-10-03T11:45:00.123456+00:00',
      refunded: 0,
      testMode: true,
      ...over.order,
    },
    payment: over.payment ?? { state: 'paid' },
    items: over.items ?? [item({ state: 'shipped', carrier: 'SMSA', tracking: 'TRK123456' })],
    returns: over.returns ?? [],
  }
}

const returnRequest = (id: string, state = 'requested', createdAt = '2026-10-03T12:30:00.123456+00:00') => ({ id, state, createdAt })

/** What this tab keeps in sessionStorage under `key`. */
const kept = (page: Page, key: string) => page.evaluate((name) => sessionStorage.getItem(name), key)
/** Everything this tab keeps in either storage, as one string. */
const storages = (page: Page) => page.evaluate(() => JSON.stringify([{ ...sessionStorage }, { ...localStorage }]))

/** The order page's own status line (the first live region of the main area). */
const status = (page: Page) => page.locator('main').getByRole('status').first()

/**
 * The console errors and uncaught exceptions of the page: what a hydration mismatch or a render that throws
 * looks like in `next dev`. A request a test aborts on purpose is not one.
 */
function watchProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(`console: ${message.text().slice(0, 200)}`)
  })
  return problems
}

/** The page-level and in-card overflow a screenshot pass checks. */
async function expectNoOverflow(page: Page, label: string) {
  const { page: pageOverflow, cardOverflow } = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cardOverflow: Math.max(
      0,
      ...[...document.querySelectorAll<HTMLElement>('main [class*="lineCard"], main [class*="smallForm"], main [class*="orderBox"], main [class*="totals"]')].map(
        (card) => card.scrollWidth - card.clientWidth,
      ),
    ),
  }))
  expect(pageOverflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1)
  expect(cardOverflow, `${label}: card overflow`).toBeLessThanOrEqual(1)
}

/** Every button, field and link button of the main area is at least 44px high (the smallest touch target). */
async function expectTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main input:not([type="hidden"]), main textarea, main a[href]')]
      .map((el) => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 1 && box.height > 1 && box.height < 44)
      .map(({ name, box }) => `${name} (${Math.round(box.height)}px)`),
  )
  expect(small, `${label}: targets under 44px`).toEqual([])
}

/** A full-page capture draws the sticky header wherever the page is scrolled: it is static for the capture. */
async function shoot(page: Page, name: string, width: number) {
  await page.addStyleTag({ content: 'body > header { position: static !important; }' })
  await page.screenshot({ path: `${SHOTS}/order-${name}-${width}.png`, fullPage: true })
}

test.describe.configure({ timeout: 120_000 })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  mkdirSync(SHOTS, { recursive: true })
  // `next dev` compiles a page on its first request: do it once, before any test has a clock running.
  for (const route of ['/orders', '/notify/confirm', '/notify/unsubscribe', '/cart']) {
    await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
  }
})

for (const width of [360, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    // ---- the link ----

    test('order page: the link\'s fragment is stored, leaves the address bar and reaches no later page', async ({ page }) => {
      const problems = watchProblems(page)
      const calls = await mock(page, { orders: () => ok(view()) })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      // Gone from the address bar (the path stays), kept for this tab only, and asked once.
      expect(new URL(page.url()).hash).toBe('')
      expect(new URL(page.url()).pathname).toBe('/orders')
      expect(JSON.parse((await kept(page, ACCESS_KEY))!)).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
      expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(TOKEN)
      expect(bodies(calls, 'orders')).toEqual([{ action: 'get', orderNumber: NUMBER, accessToken: TOKEN }])

      // A reload has no fragment: the page uses what the tab kept.
      await page.reload()
      await expect(status(page)).toHaveText('مدفوع.')
      expect(bodies(calls, 'orders')).toHaveLength(2)
      expect(bodies(calls, 'orders')[1]).toEqual({ action: 'get', orderNumber: NUMBER, accessToken: TOKEN })

      // A later full navigation carries neither the fragment in the address nor the token in its referrer.
      await page.evaluate((destination) => location.assign(destination), '/cart')
      await page.waitForURL('**/cart')
      const referrer = await page.evaluate(() => document.referrer)
      expect(referrer).not.toContain(TOKEN)
      expect(referrer).not.toContain('#')
      expect(page.url()).not.toContain(TOKEN)
      expect(problems).toEqual([])
    })

    test('order page: a lower-case number in the link is folded, a link that is not one is ignored and still leaves the address bar', async ({ page }) => {
      const calls = await mock(page, { orders: () => ok(view()) })
      await page.goto(`/orders#${NUMBER.toLowerCase()}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      expect(bodies(calls, 'orders')).toEqual([{ action: 'get', orderNumber: NUMBER, accessToken: TOKEN }])

      // Not a link (a short token, a third part): nothing is asked, nothing is stored, the address bar is cleaned, and the form is offered.
      for (const bad of [`#${NUMBER}.${TOKEN.slice(1)}`, `#${NUMBER}.${TOKEN}.x`]) {
        const fresh = await page.context().newPage()
        const freshCalls = await mock(fresh, { orders: () => ok(view()) })
        await stubTurnstile(fresh)
        await fresh.goto(`/orders${bad}`)
        await expect(fresh.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
        expect(new URL(fresh.url()).hash).toBe('')
        expect(freshCalls).toHaveLength(0)
        expect(await kept(fresh, ACCESS_KEY)).toBeNull()
        await fresh.close()
      }
    })

    test('order page: a second link opened in the same tab replaces the first', async ({ page }) => {
      const calls = await mock(page, { orders: (body) => ok(view({ order: { orderNumber: body.orderNumber } })) })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toBeVisible()
      await page.evaluate((hash) => {
        location.hash = hash
      }, `#${SECOND_NUMBER}.${SECOND_TOKEN}`)
      await expect(page.getByText(`رقم الطلب: ${SECOND_NUMBER}`)).toBeVisible()
      expect(new URL(page.url()).hash).toBe('')
      expect(bodies(calls, 'orders')).toEqual([
        { action: 'get', orderNumber: NUMBER, accessToken: TOKEN },
        { action: 'get', orderNumber: SECOND_NUMBER, accessToken: SECOND_TOKEN },
      ])
      expect(JSON.parse((await kept(page, ACCESS_KEY))!)).toEqual({ orderNumber: SECOND_NUMBER, accessToken: SECOND_TOKEN })
    })

    // ---- what an order says ----

    const STATES = [
      { name: 'paid', status: 'paid', payment: { state: 'paid' }, text: 'مدفوع.' },
      { name: 'pending', status: 'pending_payment', payment: { state: 'pending', invoiceUrl: 'https://pay.example.test/invoices/abc' }, text: 'بانتظار الدفع.' },
      { name: 'pending with no invoice link', status: 'pending_payment', payment: { state: 'pending' }, text: 'بانتظار الدفع.' },
      { name: 'needs resolution', status: 'paid_needs_resolution', payment: { state: 'needs_resolution' }, text: 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.' },
      { name: 'a payment under review', status: 'pending_payment', payment: { state: 'review' }, text: 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.' },
      { name: 'refunded', status: 'refunded', payment: { state: 'refunded' }, text: 'أُعيد مبلغ هذا الطلب.' },
      { name: 'expired', status: 'expired', payment: { state: 'expired' }, text: 'انتهت مدة حجز الطلب.' },
      { name: 'cancelled', status: 'cancelled', payment: { state: 'cancelled' }, text: 'أُلغي الطلب.' },
    ]
    test('order page: an order whose hold ended while its payment is still open offers no invoice: the invoice ended with the hold', async ({ page }) => {
      await mock(page, { orders: () => ok(view({ order: { status: 'expired' }, payment: { state: 'pending', invoiceUrl: 'https://pay.example.test/invoices/abc' }, items: [item()] })) })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('بانتظار الدفع.')
      await expect(page.getByRole('link', { name: 'متابعة الدفع' })).toHaveCount(0)
    })

    for (const state of STATES) {
      test(`order page: a ${state.name} order says «${state.text}»`, async ({ page }) => {
        await mock(page, { orders: () => ok(view({ order: { status: state.status }, payment: state.payment, items: [item()] })) })
        await page.goto(`/orders#${NUMBER}.${TOKEN}`)
        await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toBeVisible()
        await expect(status(page)).toHaveText(state.text)
        const link = page.getByRole('link', { name: 'متابعة الدفع' })
        const invoiceUrl = (state.payment as { invoiceUrl?: string }).invoiceUrl
        if (invoiceUrl === undefined) await expect(link).toHaveCount(0)
        else await expect(link).toHaveAttribute('href', invoiceUrl)
        await expect(page.getByText(TEST_MODE)).toBeVisible()
        await expectNoOverflow(page, state.name)
      })
    }

    test('order page: a live order shows no test-mode note, and the totals read as the cart shows them', async ({ page }) => {
      await mock(page, {
        orders: () => ok(view({ order: { testMode: false, discount: 472, subtotal: 4720, shipping: 1130, total: 5378, refunded: 1000 }, items: [item({ state: 'shipped', carrier: 'SMSA', tracking: 'T1' })] })),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await expect(page.getByText(TEST_MODE)).toHaveCount(0)
      const row = (label: string) => page.locator('dl > div', { hasText: label })
      await expect(row('المجموع الفرعي')).toContainText('47.20 ر.س')
      await expect(row('الخصم')).toContainText('4.72 ر.س')
      await expect(row('التوصيل')).toContainText('11.30 ر.س')
      await expect(row('الإجمالي')).toContainText('53.78 ر.س')
      await expect(row('المبلغ المُعاد')).toContainText('10.00 ر.س')
    })

    test('order page: no discount, no refund and a digital-only order show no such row and no delivery row', async ({ page }) => {
      await mock(page, {
        orders: () => ok(view({ order: { subtotal: 1240, shipping: 0, total: 1240 }, items: [item({ itemId: B, title: 'كتاب إلكتروني', variantTitle: '', fulfillment: 'digital', quantity: 1, download: { available: false, revoked: false } })] })),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await expect(page.locator('dl > div', { hasText: 'الإجمالي' })).toContainText('12.40 ر.س')
      for (const label of ['الخصم', 'التوصيل', 'المبلغ المُعاد']) await expect(page.locator('dl > div', { hasText: label })).toHaveCount(0)
    })

    test('order page: a shipped line shows its carrier and tracking as plain selectable text; long titles and tracking wrap', async ({ page }) => {
      const tracking = `SA${'1234567890'.repeat(8)}`
      const title = 'عنوان طويل جدًا لكتاب الاختبار الذي يتجاوز عرض البطاقة على الهاتف ويجب أن يلتف إلى أسطر عدة دون أن يتسع الصفحة'
      await mock(page, {
        orders: () =>
          ok(
            view({
              items: [
                item({ itemId: A, title, variantTitle: 'النسخة الورقية الموقعة', state: 'shipped', carrier: 'SMSA Express', tracking }),
                item({ itemId: B, title: 'منتج ثانٍ', state: 'preparing' }),
                item({ itemId: C, title: 'منتج ثالث', state: 'delivered', carrier: 'Aramex', tracking: 'AR-5' }),
              ],
            }),
          ),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      for (const label of ['قيد التجهيز', 'شُحن', 'سُلّم']) await expect(page.getByText(label, { exact: true })).toBeVisible()
      await expect(page.getByText('شركة الشحن: SMSA Express')).toBeVisible()

      const value = page.locator('span[dir="ltr"]', { hasText: tracking })
      await expect(value).toHaveText(tracking)
      // Plain text: no link to a carrier's site (ours is not to guess it), and selectable.
      await expect(page.locator('a', { hasText: tracking })).toHaveCount(0)
      expect(await value.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none')
      // A preparing line shows no shipment.
      await expect(page.locator('li', { hasText: 'منتج ثانٍ' }).getByText('شركة الشحن')).toHaveCount(0)
      // The long values wrap inside the card.
      const box = (await value.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(-1)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
      await expectNoOverflow(page, 'shipped')
      await shoot(page, 'shipped', width)
    })

    test('order page: a preorder line says when it ships and shows its stored note under it', async ({ page }) => {
      await mock(page, {
        orders: () => ok(view({ items: [item({ preorder: { shipsOn: '2026-12-01', note: 'يصل بعد الطباعة الأولى؛ قد يتأخر أسبوعًا.' } })] })),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      const date = await page.evaluate(() =>
        new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date('2026-12-01')),
      )
      const shipsOn = page.getByText(`طلب مسبق: يُسلَّم في ${date}`)
      await expect(shipsOn).toBeVisible()
      const note = page.getByText('يصل بعد الطباعة الأولى؛ قد يتأخر أسبوعًا.')
      await expect(note).toBeVisible()
      // The note sits under the date.
      const [one, two] = [(await shipsOn.boundingBox())!, (await note.boundingBox())!]
      expect(two.y).toBeGreaterThan(one.y)
    })

    // ---- the files ----

    const DIGITAL = (over: Record<string, unknown>) => item({ fulfillment: 'digital', quantity: 1, ...over })

    test('order page: a digital line offers «تنزيل» only when its file is ready, and says why not otherwise', async ({ page }) => {
      await mock(page, {
        orders: () =>
          ok(
            view({
              items: [
                DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: true, revoked: false } }),
                DIGITAL({ itemId: B, title: 'كتاب لم يُرفع ملفه', variantTitle: '', download: { available: false, revoked: false } }),
                DIGITAL({ itemId: C, title: 'كتاب أُلغي حقه', variantTitle: '', download: { available: false, revoked: true } }),
              ],
            }),
          ),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await expect(page.getByRole('button', { name: /^تنزيل/ })).toHaveCount(1)
      await expect(page.locator('li', { hasText: 'كتاب جاهز' }).getByRole('button', { name: /^تنزيل/ })).toBeVisible()
      await expect(page.locator('li', { hasText: 'كتاب لم يُرفع ملفه' })).toContainText('الملف غير جاهز بعد؛ سنراسلك عند توفره.')
      await expect(page.locator('li', { hasText: 'كتاب لم يُرفع ملفه' }).getByRole('button')).toHaveCount(0)
      await expect(page.locator('li', { hasText: 'كتاب أُلغي حقه' })).toContainText('أُلغي حق التنزيل.')
      await expect(page.locator('li', { hasText: 'كتاب أُلغي حقه' }).getByRole('button')).toHaveCount(0)
    })

    test('order page: «تنزيل» issues then redeems with the right bodies, and the browser is sent the file link', async ({ page }) => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const calls = await mock(page, {
        orders: () => ok(view({ items: [DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: true, revoked: false } })] })),
        download: async (body) => {
          if (body.action === 'issue') {
            await gate
            return ok({ downloadToken: DOWNLOAD_TOKEN, expiresAt: '2026-10-03T12:15:00.000Z' })
          }
          return ok({ url: `${new URL(page.url()).origin}/__file/book.pdf` })
        },
      })
      // The file reply is an attachment, as the real Storage answers: the page stays where it is.
      await page.route('**/__file/book.pdf', (route) =>
        route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="book.pdf"' }, body: '%PDF-1.4' }),
      )
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      const button = page.getByRole('button', { name: /^(تنزيل|جارٍ التجهيز)/ })
      await expect(button).toContainText('تنزيل')
      const downloading = page.waitForEvent('download')
      await button.click()

      // While it runs the button says so, is aria-disabled and keeps the focus; a second press asks nothing.
      await expect(button).toContainText('جارٍ التجهيز…')
      await expect(button).toHaveAttribute('aria-disabled', 'true')
      await expect(button).toBeFocused()
      await button.click({ force: true })
      release()
      const download = await downloading
      expect(download.suggestedFilename()).toBe('book.pdf')

      expect(bodies(calls, 'download')).toEqual([
        { action: 'issue', orderNumber: NUMBER, accessToken: TOKEN, itemId: A },
        { action: 'redeem', downloadToken: DOWNLOAD_TOKEN },
      ])
      // The page stays, reads the order again, and neither token nor url is kept or shown.
      expect(new URL(page.url()).pathname).toBe('/orders')
      await expect.poll(() => bodies(calls, 'orders').length).toBe(2)
      await expect(button).toContainText('تنزيل')
      await expect(button).not.toHaveAttribute('aria-disabled', 'true')
      expect(await storages(page)).not.toContain(DOWNLOAD_TOKEN)
      expect(await storages(page)).not.toContain('__file')
      await expect(page.locator('main')).not.toContainText(DOWNLOAD_TOKEN)
      await expect(page.locator('main')).not.toContainText('__file')
    })

    test('order page: a refused download says why and keeps the button; a 404 reads the order again', async ({ page }) => {
      const calls = await mock(page, {
        orders: () => ok(view({ items: [DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: true, revoked: false } })] })),
        download: scripted(
          refused(429, 'TOO_MANY_DOWNLOADS', 'طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.'),
          refused(404, 'NOT_FOUND', 'تعذّر تنزيل الملف؛ اطلب رابطًا جديدًا من صفحة الطلب.'),
          'abort',
          refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.'),
          refused(500, 'FAILED', 'تعذّر إكمال الإجراء.'),
        ),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      const card = page.locator('li', { hasText: 'كتاب جاهز' })
      const button = card.getByRole('button')
      const alert = card.getByRole('alert')
      await expect(alert).toHaveText('')

      await button.click()
      await expect(alert).toHaveText('طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.')
      expect(bodies(calls, 'orders')).toHaveLength(1)

      // 404: its own words, and the order is read again (a refund or a revocation may have happened).
      await button.click()
      await expect(alert).toHaveText('تعذّر تنزيل الملف.')
      await expect.poll(() => bodies(calls, 'orders').length).toBe(2)

      await button.click()
      await expect(alert).toHaveText(NETWORK)
      await button.click()
      await expect(alert).toHaveText('حاول بعد قليل.')
      await button.click()
      await expect(alert).toHaveText(NETWORK)
      // Only the issue was ever asked: a refusal there never reaches `redeem`.
      expect(bodies(calls, 'download').every((body) => body.action === 'issue')).toBe(true)
      await expect(button).toBeVisible()
      await expect(button).not.toHaveAttribute('aria-disabled', 'true')
      await expectNoOverflow(page, 'download refusals')
    })

    test('order page: a redeem that the function refuses says so, and never navigates', async ({ page }) => {
      await mock(page, {
        orders: () => ok(view({ items: [DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: true, revoked: false } })] })),
        download: (body) =>
          body.action === 'issue' ? ok({ downloadToken: DOWNLOAD_TOKEN, expiresAt: '2026-10-03T12:15:00.000Z' }) : refused(429, 'TOO_MANY_DOWNLOADS', 'طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.'),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      const card = page.locator('li', { hasText: 'كتاب جاهز' })
      await card.getByRole('button').click()
      await expect(card.getByRole('alert')).toHaveText('طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.')
      expect(new URL(page.url()).pathname).toBe('/orders')
    })

    test('order page: a download that finds the file gone keeps its words and the focus when the order is read again and the button goes', async ({ page }) => {
      const calls = await mock(page, {
        orders: scripted(
          ok(view({ items: [DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: true, revoked: false } })] })),
          // The second read: the right was revoked meanwhile.
          ok(view({ items: [DIGITAL({ itemId: A, title: 'كتاب جاهز', variantTitle: '', download: { available: false, revoked: true } })] })),
        ),
        download: () => refused(404, 'NOT_FOUND', 'تعذّر تنزيل الملف؛ اطلب رابطًا جديدًا من صفحة الطلب.'),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      const card = page.locator('li', { hasText: 'كتاب جاهز' })
      const button = card.getByRole('button')
      const alert = card.getByRole('alert')
      await expect(alert).toHaveText('')

      // Pressed with the keyboard, so the focus is on the button when the file turns out to be gone.
      await button.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => bodies(calls, 'orders').length).toBe(2)
      await expect(card).toContainText('أُلغي حق التنزيل.')
      await expect(button).toHaveCount(0)
      // The words did not go with the button, and the focus did not fall to the page: it is on them.
      await expect(alert).toHaveText('تعذّر تنزيل الملف.')
      await expect(alert).toBeFocused()
      expect(bodies(calls, 'download')).toEqual([{ action: 'issue', orderNumber: NUMBER, accessToken: TOKEN, itemId: A }])
      await expectNoOverflow(page, 'download gone')
      await shoot(page, 'download-gone', width)
    })

    // ---- the return request ----

    const RETURNABLE = () => [
      item({ itemId: A, title: 'كتاب الاختبار', variantTitle: 'النسخة الورقية', quantity: 3, state: 'delivered', carrier: 'SMSA', tracking: 'T1', returnable: 2 }),
      item({ itemId: B, title: 'ملحق الكتاب', variantTitle: '', quantity: 1, state: 'shipped', carrier: 'SMSA', tracking: 'T2', returnable: 1 }),
      item({ itemId: C, title: 'كتاب لا يُرجع', variantTitle: '', quantity: 1, state: 'preparing', returnable: 0 }),
    ]
    const form = (page: Page) => page.getByRole('form', { name: 'طلب إرجاع' })
    /** The form's own alert line (the reason's field error is a span; this is the paragraph). */
    const formAlert = (page: Page) => form(page).locator('p[role="alert"]')

    test('order page: the return form asks for a quantity per returnable line and a reason, and files a request', async ({ page }) => {
      let filed = false
      const calls = await mock(page, {
        orders: (body) => {
          if (body.action === 'return-request') {
            filed = true
            return ok({ returnId: '44444444-4444-4444-8444-444444444444' }, 201)
          }
          return ok(view({ items: RETURNABLE(), returns: filed ? [returnRequest(A), returnRequest(B, 'approved', '2026-10-04T09:00:00.000000+00:00')] : [returnRequest(A)] }))
        },
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')

      // The existing request: its label, its date and its state.
      const when = await page.evaluate(() =>
        new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date('2026-10-03T12:30:00Z')),
      )
      const returns = page.getByRole('list', { name: 'طلبات الإرجاع' })
      await expect(returns.getByRole('listitem')).toHaveCount(1)
      await expect(returns.getByRole('listitem').first()).toContainText(`طلب إرجاع ${when}`)
      await expect(returns.getByRole('listitem').first()).toContainText('قيد المراجعة')

      // One field per returnable line, from 0 to what is returnable, at 0; nothing for the line with nothing to return.
      const first = page.getByRole('spinbutton', { name: /^الكمية: كتاب الاختبار: النسخة الورقية/ })
      const second = page.getByRole('spinbutton', { name: /^الكمية: ملحق الكتاب/ })
      await expect(page.getByRole('spinbutton')).toHaveCount(2)
      await expect(first).toHaveValue('0')
      await expect(first).toHaveAttribute('min', '0')
      await expect(first).toHaveAttribute('max', '2')
      await expect(second).toHaveAttribute('max', '1')
      const reason = page.getByLabel('سبب الإرجاع')
      await expect(reason).toHaveAttribute('maxlength', '500')
      await expect(reason).toHaveAttribute('required', '')
      const policy = page.getByRole('link', { name: /^سياسة الاسترجاع/ })
      await expect(policy).toHaveAttribute('href', '/policies/refund')
      await expect(policy).toHaveAttribute('target', '_blank')
      const submit = page.getByRole('button', { name: 'إرسال طلب الإرجاع' })

      // Nothing chosen: the form says so, asks nothing, and the first quantity takes the focus.
      await submit.click()
      await expect(formAlert(page)).toHaveText('اختر كمية واحدة على الأقل.')
      await expect(first).toBeFocused()
      expect(bodies(calls, 'orders').filter((body) => body.action === 'return-request')).toEqual([])

      // A quantity but no reason: the field says so and takes the focus.
      await first.fill('1')
      await submit.click()
      await expect(page.locator('#order-return-reason-error')).toHaveText('اكتب سبب الإرجاع.')
      await expect(reason).toBeFocused()
      await expect(reason).toHaveAttribute('aria-invalid', 'true')
      await expect(formAlert(page)).toHaveText('')
      expect(bodies(calls, 'orders').filter((body) => body.action === 'return-request')).toEqual([])

      // A quantity above what is returnable is brought back to it.
      await first.fill('9')
      await first.blur()
      await expect(first).toHaveValue('2')
      await first.fill('1')
      await second.fill('1')
      await reason.fill('وصل تالفًا\n\nوالغلاف   ممزق')
      await submit.click()

      // The request: the chosen lines only, the reason as one line; then the page says so, takes the focus, and reads the order again.
      await expect(status(page)).toHaveText('مدفوع.')
      const note = page.locator('main').getByRole('status').nth(1)
      await expect(note).toHaveText('وصلنا طلب الإرجاع.')
      await expect(note).toBeFocused()
      expect(bodies(calls, 'orders').filter((body) => body.action === 'return-request')).toEqual([
        {
          action: 'return-request',
          orderNumber: NUMBER,
          accessToken: TOKEN,
          items: [
            { itemId: A, quantity: 1 },
            { itemId: B, quantity: 1 },
          ],
          reason: 'وصل تالفًا والغلاف ممزق',
        },
      ])
      await expect.poll(() => bodies(calls, 'orders').filter((body) => body.action === 'get').length).toBe(2)
      await expect(returns.getByRole('listitem')).toHaveCount(2)
      await expect(returns.getByRole('listitem').nth(1)).toContainText('مقبول')
      // The form starts over.
      await expect(first).toHaveValue('0')
      await expect(second).toHaveValue('0')
      await expect(reason).toHaveValue('')
      await expectNoOverflow(page, 'return form')
      await expectTargets(page, 'return form')
    })

    test('order page: each refusal of a return request shows its words in the form and keeps what was typed', async ({ page }) => {
      let filings = 0
      const calls = await mock(page, {
        orders: (body) => {
          if (body.action !== 'return-request') return ok(view({ items: RETURNABLE() }))
          filings += 1
          return [
            refused(409, 'NOT_RETURNABLE', 'لا يمكن طلب إرجاع هذه المنتجات الآن.'),
            refused(422, 'INVALID_ITEMS', 'تحقق من المنتجات والكميات المطلوب إرجاعها.'),
            refused(429, 'TOO_MANY_REQUESTS', 'أرسلت طلبات إرجاع كثيرة اليوم؛ حاول غدًا.'),
            refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.'),
            refused(422, 'INVALID', 'بيانات غير صالحة.'),
            'abort' as const,
          ][filings - 1]!
        },
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await page.getByRole('spinbutton', { name: /^الكمية: كتاب الاختبار/ }).fill('2')
      await page.getByLabel('سبب الإرجاع').fill('سبب الإرجاع هنا')
      const submit = page.getByRole('button', { name: 'إرسال طلب الإرجاع' })
      for (const words of [
        'لا يمكن طلب إرجاع هذه المنتجات الآن.',
        'تحقق من المنتجات والكميات المطلوب إرجاعها.',
        'أرسلت طلبات إرجاع كثيرة اليوم؛ حاول غدًا.',
        'أرسلت طلبات كثيرة؛ حاول لاحقًا.',
        'بيانات غير صالحة.',
        NETWORK,
      ]) {
        await submit.click()
        await expect(formAlert(page)).toHaveText(words)
        await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
        // Nothing typed is lost, and no success is claimed.
        await expect(page.getByLabel('سبب الإرجاع')).toHaveValue('سبب الإرجاع هنا')
        await expect(page.getByRole('spinbutton', { name: /^الكمية: كتاب الاختبار/ })).toHaveValue('2')
        await expect(page.getByText('وصلنا طلب الإرجاع.')).toHaveCount(0)
      }
      // The order was read once (the load); a refusal does not read it again.
      expect(bodies(calls, 'orders').filter((body) => body.action === 'get')).toHaveLength(1)
      await expectNoOverflow(page, 'return refusals')
    })

    test('order page: a return request that finds the order gone forgets the link and offers the recovery form', async ({ page }) => {
      await stubTurnstile(page)
      let gone = false
      await mock(page, {
        orders: (body) => (body.action === 'return-request' || (body.action === 'get' && gone) ? refused(404, 'NOT_FOUND', 'لم نجد هذا الطلب.') : ok(view({ items: RETURNABLE() }))),
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await page.getByRole('spinbutton', { name: /^الكمية: كتاب الاختبار/ }).fill('1')
      await page.getByLabel('سبب الإرجاع').fill('سبب')
      gone = true
      await page.getByRole('button', { name: 'إرسال طلب الإرجاع' }).click()
      // The refused call's words, then the page reads the order again, finds it gone, and says so; the sentence takes the focus.
      await expect(status(page)).toHaveText(NOT_FOUND)
      await expect(status(page)).toBeFocused()
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
      await expect(page.getByRole('form', { name: 'طلب إرجاع' })).toHaveCount(0)
      expect(await kept(page, ACCESS_KEY)).toBeNull()
    })

    // ---- recovery ----

    test('order page: with no link the recovery form gives the same sentence for every address', async ({ page }) => {
      const problems = watchProblems(page)
      await stubTurnstile(page)
      const calls = await mock(page, { orders: () => ok({ sent: true }) })
      await page.goto('/orders')
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
      // No order is asked for, and nothing else is offered.
      expect(calls).toHaveLength(0)
      await expect(page.locator('main').getByRole('list')).toHaveCount(0)
      const email = page.getByLabel('البريد الإلكتروني')
      const send = page.getByRole('button', { name: 'أرسل الرابط' })
      await expect(email).toHaveAttribute('type', 'email')
      await expectNoOverflow(page, 'recovery')
      await expectTargets(page, 'recovery')
      await shoot(page, 'recover', width)

      // The widget is Turnstile's, for the action the function checks.
      await tokens(page, 1)
      expect((await turnstile(page)).actions).toEqual(['order-recover'])

      // A malformed address is refused on the page: the field says so, nothing is sent.
      await email.fill('not-an-address')
      await send.click()
      await expect(page.locator('#order-recover-email-error')).toHaveText('أدخل بريدًا إلكترونيًا صحيحًا.')
      await expect(email).toBeFocused()
      expect(calls).toHaveLength(0)

      await email.fill('first@example.com')
      await send.click()
      await expect(status(page)).toHaveText(RECOVERED)
      await expect(status(page)).toBeFocused()
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toHaveCount(0)
      await expect(page.getByLabel('البريد الإلكتروني')).toHaveCount(0)
      expect(bodies(calls, 'orders')).toEqual([{ action: 'recover', email: 'first@example.com', turnstileToken: 'stub-token-1' }])

      // Another address, the same one sentence.
      await page.reload()
      await tokens(page, 1)
      await page.getByLabel('البريد الإلكتروني').fill('someone-else@example.org')
      await page.getByRole('button', { name: 'أرسل الرابط' }).click()
      await expect(status(page)).toHaveText(RECOVERED)
      expect(bodies(calls, 'orders')[1]).toMatchObject({ action: 'recover', email: 'someone-else@example.org' })
      expect(problems).toEqual([])
    })

    test('order page: a recovery that is refused says so, keeps the form, and retries with a fresh Turnstile token', async ({ page }) => {
      await stubTurnstile(page)
      const calls = await mock(page, {
        orders: scripted(
          refused(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.'),
          refused(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.'),
          refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.'),
          'abort',
          refused(422, 'INVALID', 'بيانات غير صالحة.'),
          ok({ sent: true }),
        ),
      })
      await page.goto('/orders')
      await tokens(page, 1)
      const email = page.getByLabel('البريد الإلكتروني')
      await email.fill('buyer@example.com')
      const send = page.getByRole('button', { name: 'أرسل الرابط' })
      const alert = send.locator('xpath=..').locator('p[role="alert"]')
      await expect(alert).toHaveText('')

      let issued = 1
      for (const words of ['تعذّر التحقق من أنك إنسان.', 'تعذّر التحقق من الطلب.', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.', NETWORK]) {
        await send.click()
        await expect(alert).toHaveText(words)
        // The form stays with its address; the spent token is replaced before the next try.
        await expect(email).toHaveValue('buyer@example.com')
        issued += 1
        await tokens(page, issued)
      }
      // The function's own refusal of the address (422) goes to the field, not the alert.
      await send.click()
      await expect(page.locator('#order-recover-email-error')).toHaveText('أدخل بريدًا إلكترونيًا صحيحًا.')
      issued += 1
      await tokens(page, issued)
      await send.click()
      await expect(status(page)).toHaveText(RECOVERED)

      // Every try carried a token that no earlier try had used.
      const sent = bodies(calls, 'orders').map((body) => body.turnstileToken)
      expect(sent).toHaveLength(6)
      expect(new Set(sent).size).toBe(6)
      expect(sent.every((token) => /^stub-token-\d+$/.test(String(token)))).toBe(true)
      expect((await turnstile(page)).resets).toBeGreaterThanOrEqual(5)
    })

    test('order page: a 404 forgets the stored link, says so and offers the recovery form', async ({ page }) => {
      await stubTurnstile(page)
      const calls = await mock(page, { orders: () => refused(404, 'NOT_FOUND', 'لم نجد هذا الطلب.') })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText(NOT_FOUND)
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
      await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toHaveCount(0)
      expect(await kept(page, ACCESS_KEY)).toBeNull()
      expect(new URL(page.url()).hash).toBe('')
      // Nothing is kept to ask with: a reload asks nothing and offers the form.
      await page.reload()
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
      expect(calls).toHaveLength(1)
      await expectNoOverflow(page, 'not found')
    })

    test('order page: a link that is dead, opened after a recovery was sent, says so and offers the form again', async ({ page }) => {
      await stubTurnstile(page)
      await mock(page, { orders: (body) => (body.action === 'recover' ? ok({ sent: true }) : refused(404, 'NOT_FOUND', 'لم نجد هذا الطلب.')) })
      await page.goto('/orders')
      await tokens(page, 1)
      await page.getByLabel('البريد الإلكتروني').fill('a@example.com')
      await page.getByRole('button', { name: 'أرسل الرابط' }).click()
      await expect(status(page)).toHaveText(RECOVERED)
      // A second link opened in the same tab: the sentence about the mail is not its answer.
      await page.evaluate((hash) => {
        location.hash = hash
      }, `#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText(NOT_FOUND)
      await expect(page.getByRole('heading', { level: 2, name: 'استعادة رابط الطلب' })).toBeVisible()
      expect(await kept(page, ACCESS_KEY)).toBeNull()
    })

    // ---- a throttle and a lost connection ----

    test('order page: a throttle and a lost connection show their sentence and «تحديث», which is aria-disabled while it asks and hands the focus to the order\'s sentence', async ({ page }) => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const calls = await mock(page, {
        orders: async (_body, nth) => {
          if (nth === 1) return refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
          if (nth === 2) return 'abort'
          if (nth === 3) return refused(503, 'UNAVAILABLE', 'تعذّر إكمال الإجراء.')
          await gate
          return ok(view())
        },
      })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('حاول بعد قليل.')
      const refresh = page.getByRole('button', { name: 'تحديث' })
      await expect(refresh).toBeVisible()
      await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toHaveCount(0)

      await refresh.click()
      await expect(status(page)).toHaveText(NETWORK)
      await expect(refresh).toBeFocused()
      await refresh.click()
      await expect(status(page)).toHaveText(NETWORK)
      expect(calls).toHaveLength(3)

      // The fourth ask waits: the button is aria-disabled (and keeps the focus), the sentence says it is loading, and pressing again asks nothing.
      await refresh.click()
      await expect(refresh).toHaveAttribute('aria-disabled', 'true')
      await expect(status(page)).toHaveText('جارٍ تحميل الطلب…')
      await expect(refresh).toBeFocused()
      await refresh.click({ force: true })
      expect(calls).toHaveLength(4)
      release()
      await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toBeVisible()
      await expect(status(page)).toHaveText('مدفوع.')
      await expect(refresh).toHaveCount(0)
      // The button went with the problem: the sentence that answers it has the focus, which did not fall to the page.
      await expect(status(page)).toBeFocused()
      expect(calls).toHaveLength(4)
    })

    test('order page: a reply that does not fit is shown as the network sentence, never as an order', async ({ page }) => {
      await mock(page, { orders: scripted(ok({ ...view(), extra: 1 }), ok({ ...view(), order: { ...view().order, status: 'shipped' } }), ok(view({ payment: { state: 'paid', invoiceUrl: 'javascript:alert(1)' } }))) })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText(NETWORK)
      await expect(page.getByText(`رقم الطلب: ${NUMBER}`)).toHaveCount(0)
      await page.getByRole('button', { name: 'تحديث' }).click()
      await expect(status(page)).toHaveText(NETWORK)
      await page.getByRole('button', { name: 'تحديث' }).click()
      await expect(status(page)).toHaveText(NETWORK)
      // A refused reply never keeps the link from the next try, and nothing was followed.
      expect(await kept(page, ACCESS_KEY)).not.toBeNull()
      expect(new URL(page.url()).pathname).toBe('/orders')
    })

    // ---- the page as a whole ----

    const FULL = () =>
      view({
        order: { discount: 472, total: 5378, refunded: 1000 },
        items: [
          item({ itemId: A, title: 'كتاب الاختبار', variantTitle: 'النسخة الورقية', quantity: 3, state: 'delivered', carrier: 'SMSA Express', tracking: 'SA1234567890', returnable: 2 }),
          item({ itemId: B, title: 'كتاب إلكتروني', variantTitle: '', fulfillment: 'digital', quantity: 1, download: { available: true, revoked: false } }),
          item({ itemId: C, title: 'كتاب قيد الطباعة', variantTitle: 'نسخة موقعة', fulfillment: 'signed', quantity: 1, preorder: { shipsOn: '2026-12-01', note: 'يصل بعد الطباعة الأولى.' }, state: 'preparing' }),
        ],
        returns: [returnRequest('55555555-5555-4555-8555-555555555555', 'approved')],
      })

    test('order page: the whole order has one h1, labelled fields, 44px targets and no horizontal overflow', async ({ page }) => {
      const problems = watchProblems(page)
      await mock(page, { orders: () => ok(FULL()) })
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك')
      // Every field has a visible label.
      const unlabelled = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main input:not([type="hidden"]), main textarea, main select')]
          .filter((field) => !(field as HTMLInputElement).labels?.length)
          .map((field) => field.outerHTML.slice(0, 60)),
      )
      expect(unlabelled).toEqual([])
      // The numbers are left to right.
      await expect(page.locator('p', { hasText: 'رقم الطلب:' }).locator('span[dir="ltr"]')).toHaveText(NUMBER)
      // The status and alert regions are in the page before they have words.
      expect(await page.locator('main [role="status"]').count()).toBeGreaterThanOrEqual(2)
      expect(await page.locator('main [role="alert"]').count()).toBeGreaterThanOrEqual(3)
      await expectNoOverflow(page, 'full order')
      await expectTargets(page, 'full order')
      await shoot(page, 'full', width)
      expect(problems).toEqual([])
    })

    // ---- calm ----

    // The owner's rule for the money pages (D38, DESIGN.md "Motion"): no reveal, no countdown, only the title's short
    // fade. `motion.spec.ts` holds the same line for the cart, the checkout and the policies. A reveal is held below the
    // fold with a 1ms `Element.animate` and played with a longer one, so the page is scrolled to its end and counted.
    /** Counts the reveals a page holds and plays (the same wrapper `motion.spec.ts` uses). */
    async function countReveals(page: Page) {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.addInitScript(() => {
        const reveals = { held: new Set<Element>(), played: new Set<Element>() }
        Object.assign(window, { reveals })
        const animate = Element.prototype.animate
        Element.prototype.animate = function (keyframes, options) {
          const duration = typeof options === 'number' ? options : options?.duration
          if (duration === 1) reveals.held.add(this)
          else if (typeof duration === 'number' && duration > 1) reveals.played.add(this)
          return animate.call(this, keyframes, options)
        }
      })
    }
    /** Scrolls to the end of the page as a reader would, in steps, and says what was held and played. */
    async function scrolledReveals(page: Page) {
      for (let step = 0; step < 60; step += 1) {
        const end = await page.evaluate(() => {
          const bottom = document.documentElement.scrollHeight - window.innerHeight
          if (window.scrollY >= bottom - 1) return true
          window.scrollTo({ top: Math.min(window.scrollY + window.innerHeight * 0.6, bottom), behavior: 'instant' })
          return false
        })
        if (end) break
        await page.waitForTimeout(150)
      }
      return page.evaluate(() => {
        const { held, played } = (window as unknown as { reveals: { held: Set<Element>; played: Set<Element> } }).reveals
        return { holds: held.size, plays: played.size }
      })
    }

    test('order page: the reveal detector sees a reveal on a story page (the control of the calm checks)', async ({ page }) => {
      await countReveals(page)
      await page.goto('/contact')
      await expect.poll(async () => (await page.evaluate(() => (window as unknown as { reveals: { held: Set<Element> } }).reveals.held.size))).toBeGreaterThan(0)
      expect((await scrolledReveals(page)).plays).toBeGreaterThan(0)
    })

    const CALM_PAGES = [
      { name: 'the order page', route: `/orders#${NUMBER}.${TOKEN}`, ready: (page: Page) => expect(status(page)).toHaveText('مدفوع.') },
      { name: 'the confirmation page', route: `/notify/confirm#${NOTIFY_TOKEN}`, ready: (page: Page) => expect(page.getByRole('button', { name: 'تأكيد' })).toBeVisible() },
      { name: 'the unsubscribe page', route: `/notify/unsubscribe#${NOTIFY_TOKEN}`, ready: (page: Page) => expect(page.getByRole('button', { name: 'إلغاء الاشتراك' })).toBeVisible() },
    ]
    // A reveal is held only below the fold: at 1000px high none of these short pages has anything below it, so the
    // check also runs at the height of a real phone (about 640px), where the end of the page is out of sight.
    for (const height of [1000, 640]) {
      test.describe(`at ${height}px high`, () => {
        test.use({ viewport: { width, height } })
        for (const calm of CALM_PAGES) {
          test(`order page: ${calm.name} is calm: no reveal is held or played, and the title only fades in briefly`, async ({ page }) => {
            await countReveals(page)
            await mock(page, { orders: () => ok(FULL()), notify: () => ok({ status: 'confirmed' }) })
            await page.goto(calm.route)
            await calm.ready(page)
            expect(await scrolledReveals(page)).toEqual({ holds: 0, plays: 0 })
            const title = page.locator('main h1')
            await expect(title).toHaveAttribute('data-enter', '')
            await expect(title).toHaveAttribute('data-fx', 'fade')
            const animation = await title.evaluate((h1) => {
              const style = getComputedStyle(h1)
              return { name: style.animationName, seconds: parseFloat(style.animationDuration) }
            })
            expect(animation.name).toBe('motion-fade')
            expect(animation.seconds).toBeGreaterThan(0)
            expect(animation.seconds).toBeLessThanOrEqual(0.3)
          })
        }
      })
    }

    // ---- the keyboard ----

    test('order page: every control is reachable and operable with the keyboard alone', async ({ page }) => {
      const calls = await mock(page, {
        orders: (body) => {
          if (body.action === 'return-request') return ok({ returnId: '44444444-4444-4444-8444-444444444444' }, 201)
          return ok(
            view({
              items: [
                DIGITAL({ itemId: B, title: 'كتاب إلكتروني', variantTitle: '', download: { available: true, revoked: false } }),
                item({ itemId: A, title: 'كتاب الاختبار', variantTitle: 'النسخة الورقية', quantity: 2, state: 'delivered', carrier: 'SMSA', tracking: 'T1', returnable: 2 }),
              ],
            }),
          )
        },
        download: (body) =>
          body.action === 'issue' ? ok({ downloadToken: DOWNLOAD_TOKEN, expiresAt: '2026-10-03T12:15:00.000Z' }) : ok({ url: `${new URL(page.url()).origin}/__file/book.pdf` }),
      })
      await page.route('**/__file/book.pdf', (route) =>
        route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="book.pdf"' }, body: '%PDF-1.4' }),
      )
      await page.goto(`/orders#${NUMBER}.${TOKEN}`)
      await expect(status(page)).toHaveText('مدفوع.')

      // Pass one: Tab from the title reaches every control of the main area, once each, in the order of the page.
      const focusables = 'main a[href], main button, main input:not([type="hidden"]), main textarea, main select'
      const total = await page.locator(focusables).count()
      expect(total).toBe(5)
      await page.getByRole('heading', { level: 1 }).click()
      const reached: number[] = []
      for (let press = 0; press < total; press += 1) {
        await page.keyboard.press('Tab')
        reached.push(await page.evaluate((selector) => [...document.querySelectorAll(selector)].indexOf(document.activeElement!), focusables))
      }
      expect(reached).toEqual([0, 1, 2, 3, 4])

      // Pass two: operate them. The download button, with Enter.
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: /^(تنزيل|جارٍ التجهيز)/ })).toBeFocused()
      const downloading = page.waitForEvent('download')
      await page.keyboard.press('Enter')
      expect((await downloading).suggestedFilename()).toBe('book.pdf')
      expect(bodies(calls, 'download').map((body) => body.action)).toEqual(['issue', 'redeem'])

      // The quantity, the reason, the policy link, and the submit with Enter.
      await page.keyboard.press('Tab')
      await expect(page.getByRole('spinbutton')).toBeFocused()
      await page.keyboard.type('1')
      await page.keyboard.press('Tab')
      await expect(page.getByLabel('سبب الإرجاع')).toBeFocused()
      await page.keyboard.type('وصل تالفًا')
      await page.keyboard.press('Tab')
      await expect(page.getByRole('link', { name: /^سياسة الاسترجاع/ })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'إرسال طلب الإرجاع' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('main').getByRole('status').nth(1)).toHaveText('وصلنا طلب الإرجاع.')
      expect(bodies(calls, 'orders').filter((body) => body.action === 'return-request')).toEqual([
        { action: 'return-request', orderNumber: NUMBER, accessToken: TOKEN, items: [{ itemId: A, quantity: 1 }], reason: 'وصل تالفًا' },
      ])
    })

    test('order page: the recovery form is operable with the keyboard alone', async ({ page }) => {
      await stubTurnstile(page)
      const calls = await mock(page, { orders: () => ok({ sent: true }) })
      await page.goto('/orders')
      await tokens(page, 1)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('Tab')
      await expect(page.getByLabel('البريد الإلكتروني')).toBeFocused()
      await page.keyboard.type('keys@example.com')
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'أرسل الرابط' })).toBeFocused()
      await page.keyboard.press('Space')
      await expect(status(page)).toHaveText(RECOVERED)
      expect(bodies(calls, 'orders')).toEqual([{ action: 'recover', email: 'keys@example.com', turnstileToken: 'stub-token-1' }])
    })

    // ---- the availability mail's two links ----

    const NOTIFY = [
      {
        kind: 'confirm',
        route: '/notify/confirm',
        title: 'تأكيد الإشعار',
        prompt: 'أكّد رغبتك في إشعارك عند توفر المنتج.',
        button: 'تأكيد',
        done: 'تم التأكيد. سنراسلك عند توفر المنتج.',
        status: 'confirmed',
      },
      {
        kind: 'unsubscribe',
        route: '/notify/unsubscribe',
        title: 'إلغاء الإشعار',
        prompt: 'أوقف إشعارات توفر هذا المنتج.',
        button: 'إلغاء الاشتراك',
        done: 'أُلغي الاشتراك.',
        status: 'unsubscribed',
      },
    ]
    for (const variant of NOTIFY) {
      test(`notify ${variant.kind}: a second link opened in the same tab replaces the first and leaves the address bar too`, async ({ page }) => {
        const calls = await mock(page, { notify: () => ok({ status: variant.status }) })
        await page.goto(`${variant.route}#${NOTIFY_TOKEN}`)
        await expect(page.getByRole('button', { name: variant.button })).toBeVisible()
        const second = `${NOTIFY_TOKEN.slice(0, 36)}.${'Zz9-_'.repeat(9).slice(0, 43)}`
        await page.evaluate((hash) => {
          window.location.hash = hash
        }, second)
        await expect.poll(() => new URL(page.url()).hash).toBe('')
        await page.getByRole('button', { name: variant.button }).click()
        await expect(page.locator('main').getByRole('status')).toHaveText(variant.done)
        expect(bodies(calls, 'notify')).toEqual([{ action: variant.kind, token: second }])
      })

      test(`notify ${variant.kind}: nothing is sent before the press, then one call and the sentence that ends the page`, async ({ page }) => {
        const problems = watchProblems(page)
        const calls = await mock(page, { notify: () => ok({ status: variant.status }) })
        await page.goto(`${variant.route}#${NOTIFY_TOKEN}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(variant.title)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.locator('main').getByRole('status')).toHaveText(variant.prompt)
        const button = page.getByRole('button', { name: variant.button })
        await expect(button).toBeVisible()
        // The token left the address bar and is kept nowhere: not in either storage, not in the page.
        expect(new URL(page.url()).hash).toBe('')
        expect(new URL(page.url()).pathname).toBe(variant.route)
        expect(await storages(page)).not.toContain(NOTIFY_TOKEN.slice(0, 20))
        await expect(page.locator('main')).not.toContainText(NOTIFY_TOKEN.slice(0, 20))
        await expectNoOverflow(page, `notify ${variant.kind}`)
        await expectTargets(page, `notify ${variant.kind}`)
        await shoot(page, `notify-${variant.kind}`, width)
        // Nothing happens before the click, however long the page is open.
        await page.waitForTimeout(800)
        expect(calls).toHaveLength(0)

        await button.click()
        await expect(page.locator('main').getByRole('status')).toHaveText(variant.done)
        await expect(page.locator('main').getByRole('status')).toBeFocused()
        await expect(page.locator('main').getByRole('button')).toHaveCount(0)
        expect(bodies(calls, 'notify')).toEqual([{ action: variant.kind, token: NOTIFY_TOKEN }])

        // The token was in memory only: a reload has no link.
        await page.reload()
        await expect(page.locator('main').getByRole('status')).toHaveText('الرابط غير مكتمل.')
        await expect(page.locator('main').getByRole('button')).toHaveCount(0)
        expect(calls).toHaveLength(1)
        expect(problems).toEqual([])
      })

      test(`notify ${variant.kind}: a throttle and a lost connection keep the button, a dead link ends the page`, async ({ page }) => {
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))
        const calls = await mock(page, {
          notify: async (_body, nth) => {
            if (nth === 1) return refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
            if (nth === 2) return 'abort'
            if (nth === 3) return ok({ status: variant.kind === 'confirm' ? 'unsubscribed' : 'confirmed' })
            if (nth === 4) {
              await gate
              return refused(404, 'NOT_FOUND', 'الرابط غير صالح أو انتهت صلاحيته.')
            }
            return ok({ status: variant.status })
          },
        })
        await page.goto(`${variant.route}#${NOTIFY_TOKEN}`)
        const line = page.locator('main').getByRole('status')
        const button = page.getByRole('button', { name: variant.button })
        await button.click()
        await expect(line).toHaveText('حاول بعد قليل.')
        await expect(button).toBeVisible()
        await button.click()
        await expect(line).toHaveText(NETWORK)
        await expect(button).toBeFocused()
        // A success that is not the one asked for is not read as one.
        await button.click()
        await expect(line).toHaveText(NETWORK)
        await expect(button).toBeVisible()

        // While a press is answered the button is aria-disabled and says so; a second press sends nothing.
        await button.click()
        const busy = page.getByRole('button', { name: 'جارٍ الإرسال…' })
        await expect(busy).toHaveAttribute('aria-disabled', 'true')
        await expect(busy).toBeFocused()
        await busy.click({ force: true })
        expect(calls).toHaveLength(4)
        release()
        // 404: the link is dead, said once, and the button goes with it.
        await expect(line).toHaveText('الرابط غير صالح أو انتهت صلاحيته.')
        await expect(line).toBeFocused()
        await expect(page.locator('main').getByRole('button')).toHaveCount(0)
        expect(bodies(calls, 'notify').every((body) => body.token === NOTIFY_TOKEN && body.action === variant.kind)).toBe(true)
      })

      test(`notify ${variant.kind}: a link with no token says it is incomplete and offers no button`, async ({ page }) => {
        const calls = await mock(page, { notify: () => ok({ status: variant.status }) })
        await page.goto(variant.route)
        await expect(page.locator('main').getByRole('status')).toHaveText('الرابط غير مكتمل.')
        await expect(page.locator('main').getByRole('button')).toHaveCount(0)
        await page.waitForTimeout(500)
        expect(calls).toHaveLength(0)
        await expectNoOverflow(page, `notify ${variant.kind} without a token`)
      })
    }
  })
}
