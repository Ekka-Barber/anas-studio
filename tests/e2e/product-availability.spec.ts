// P08 round 10b e2e: the product page's availability and preorder states, the availability sign-up form, and the
// preorder and held notes of the cart and the checkout, in the browser on `next dev` (fixtures made here appear
// because dev renders pages live). The spec brings its own product (a variant for each state of a row), saves
// nothing it does not put back, and mocks the Data API read `catalog_availability()` and the `notify` function with
// `page.route` so every request and its body can be asserted (their own behaviour is proven by the integration tests
// of rounds 4 and 8); one test reads the real function instead, to prove the strict parser accepts what the database
// really answers. Cloudflare's Turnstile script is replaced by a stub that hands out numbered tokens, so the action,
// the moment it loads and the fresh token of each retry can be asserted. The cart and the checkout use the real
// `quote` function, whose reply the spec patches only where it says so (the switch, the held refusal). Each test runs
// at 360 and at 1440. Screenshots land in availability-*.png under shotsDir('P08'): the accepted evidence folder only
// for an ACCEPTANCE_PACKAGE=P08 run, test-results/ otherwise.
import { mkdirSync } from 'node:fs'

import { expect, test, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'

import { readStatus } from './helpers'
import { shotsDir } from './shots'

const status = readStatus()
const SHOTS = shotsDir('P08')
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const slug = `e2e-avail-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
const TITLE = 'كتاب اختبار التوفر'

// One variant for each thing a row can be, with prices no other spec uses.
const T_AVAIL = 'النسخة الورقية'
const T_PRE = 'النسخة المسبقة'
const T_OOS = 'النسخة الموقعة'
const T_UNP = 'النسخة الخاصة'
const T_GONE = 'النسخة القديمة'
const T_NOPRICE = 'النسخة المرتقبة'
// The longest a note may be is 300 characters; this one carries a word that never breaks (a link), to prove it wraps in a row, in the cart and in the summary.
const NOTE =
  'تُشحن النسخ بعد وصولها من المطبعة وتُسلَّم بالترتيب، وتفاصيل الطباعة والغلاف على الرابط: https://example.com/preorder/khous-first-edition-notes-and-schedule-0123456789-abcdefghijklmnopqrstuvwxyz ويصلك بريد عند خروج النسخة من المطبعة.'

const CART_KEY = 'anasaq:cart:v1'
const SENT = 'إن لم تكن مشتركًا من قبل فستصلك رسالة لتأكيد الاشتراك.'
const NETWORK = 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.'
const HELD = 'الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.'
const EMAIL_ERROR = 'أدخل بريدًا إلكترونيًا صحيحًا.'

let db: Client
let productId = ''
let ids = { avail: '', pre: '', oos: '', unp: '', gone: '', noprice: '' }
/** The preorder's delivery date as the database holds it, and its day and year as the page writes them. */
let ships = { iso: '', day: '', year: '' }

type Reply = { status: number; body: unknown }
type Answer = Reply | 'abort'
type Handler = (nth: number) => Answer | Promise<Answer>

const API_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  'content-type': 'application/json',
}
const FN_CORS = { ...API_CORS, 'access-control-allow-headers': 'content-type' }

const ok = (data: unknown, status = 200): Reply => ({ status, body: { ok: true, data } })
const refused = (status: number, code: string, message: string): Reply => ({ status, body: { ok: false, error: { code, message } } })

/** What `catalog_availability()` answers for the fixture: every state of a row, the gone variant with no entry at all. */
const mixed = (): Reply => ({
  status: 200,
  body: [
    { variant_id: ids.avail, state: 'available' },
    { variant_id: ids.pre, state: 'preorder' },
    { variant_id: ids.oos, state: 'out_of_stock' },
    { variant_id: ids.unp, state: 'unpriced' },
    { variant_id: ids.noprice, state: 'unpriced' },
  ],
})
/** Only the out-of-stock variant matters to the form tests. */
const outOfStockOnly = (): Reply => ({ status: 200, body: [{ variant_id: ids.oos, state: 'out_of_stock' }] })

/** Mocks the Data API read; returns how many reads the page made. A handler may wait, or answer 'abort' (a lost connection). */
async function mockAvailability(page: Page, handler: Handler): Promise<() => number> {
  let reads = 0
  await page.route('**/rest/v1/rpc/catalog_availability', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: API_CORS })
    reads += 1
    const answer = await handler(reads)
    if (answer === 'abort') return route.abort('failed')
    return route.fulfill({ status: answer.status, headers: API_CORS, body: JSON.stringify(answer.body) })
  })
  return () => reads
}

type Calls = Array<Record<string, unknown>>
type NotifyHandler = (body: Record<string, unknown>, nth: number) => Answer | Promise<Answer>

/** Mocks `notify`; returns the bodies the page sent, in order. */
async function mockNotify(page: Page, handler: NotifyHandler): Promise<Calls> {
  const calls: Calls = []
  await page.route('**/functions/v1/notify', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: FN_CORS })
    const body = request.postDataJSON() as Record<string, unknown>
    calls.push(body)
    const answer = await handler(body, calls.length)
    if (answer === 'abort') return route.abort('failed')
    return route.fulfill({ status: answer.status, headers: FN_CORS, body: JSON.stringify(answer.body) })
  })
  return calls
}

const turnstileStub = (solves: boolean) => `(() => {
  const state = { issued: 0, resets: 0, actions: [], last: '' }
  const widgets = {}
  const solve = (id) => ${solves ? 'setTimeout' : '((fn) => 0)'}(() => {
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

/** Replaces Cloudflare's Turnstile script with one that solves itself (or never does) with numbered tokens; returns how many times the page asked for the script. */
async function stubTurnstile(page: Page, solves = true): Promise<() => number> {
  let requests = 0
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => {
    requests += 1
    return route.fulfill({ contentType: 'text/javascript', body: turnstileStub(solves) })
  })
  return () => requests
}
/** The stub's state; empty until the page has loaded the (stubbed) script. */
const turnstile = (page: Page) =>
  page.evaluate(() => (window as unknown as { __turnstile?: TurnstileState }).__turnstile ?? { issued: 0, resets: 0, actions: [], last: '' })

/** The console errors and uncaught exceptions of the page: what a hydration mismatch or a render that throws looks like in `next dev`. A request a test fails on purpose is not one. */
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
      ...[...document.querySelectorAll<HTMLElement>('main [class*="variant"], main [class*="lineCard"], main [class*="summaryLines"] li')].map(
        (card) => card.scrollWidth - card.clientWidth,
      ),
    ),
  }))
  expect(pageOverflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1)
  expect(cardOverflow, `${label}: card overflow`).toBeLessThanOrEqual(1)
}

/** Every button, field and link of the main area is at least 44px high (the smallest touch target). */
async function expectTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main input:not([type="hidden"]), main textarea, main a[href]')]
      .map((el) => ({ name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 1 && box.height > 1 && box.height < 44)
      .map(({ name, box }) => `${name} (${Math.round(box.height)}px)`),
  )
  expect(small, `${label}: targets under 44px`).toEqual([])
}

/** A capture of the page (or of one part of it: the product page's description is long) draws the sticky header wherever the page is scrolled: it is static for the capture. */
async function shoot(page: Page, name: string, width: number, part?: Locator) {
  await page.addStyleTag({ content: 'body > header { position: static !important; }' })
  const path = `${SHOTS}/availability-${name}-${width}.png`
  if (part) await part.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
}

const row = (page: Page, title: string): Locator => page.locator('main ul li', { hasText: title })
const addButton = (scope: Locator | Page) => scope.getByRole('button', { name: 'أضف إلى السلة' })
const preorderButton = (scope: Locator | Page) => scope.getByRole('button', { name: 'اطلب مسبقًا' })
const emailField = (scope: Locator | Page) => scope.getByLabel('بريدك الإلكتروني')
const signUp = (scope: Locator | Page) => scope.getByRole('button', { name: 'أخبرني عند توفره' })
const PREORDER_SENTENCE = () => new RegExp(`^طلب مسبق: يُسلَّم في ${ships.day} \\S+ ${ships.year}$`)

/** Opens the product page and waits for the one read of the states to be answered and the rows to settle. */
async function openProduct(page: Page) {
  await page.goto(`/store/${slug}`)
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
}

/** The out-of-stock row's form, scrolled to and with the (stubbed) widget handing out its first token. */
async function openForm(page: Page): Promise<Locator> {
  await openProduct(page)
  const form = row(page, T_OOS).getByRole('form')
  await form.scrollIntoViewIfNeeded()
  await expect(emailField(form)).toBeVisible()
  await expect.poll(async () => (await turnstile(page)).issued).toBeGreaterThanOrEqual(1)
  return form
}

/** The seq of the published privacy policy, or null. */
async function privacySeq(): Promise<number | null> {
  const found = await db.query<{ seq: number }>("select seq from public.published_documents where collection = 'policies' and doc_id = 'privacy'")
  return found.rows[0]?.seq ?? null
}

/** Patches the real `quote` reply the page gets: the switch forced on, and what `patch` changes. */
async function patchQuote(page: Page, patch: (data: Record<string, unknown>) => void) {
  await page.route('**/functions/v1/checkout', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || (request.postDataJSON() as { action?: string } | null)?.action !== 'quote') return route.continue()
    const response = await route.fetch()
    const json = (await response.json()) as { data: Record<string, unknown> }
    json.data.checkoutEnabled = true
    patch(json.data)
    return route.fulfill({ response, json })
  })
}

test.describe.configure({ timeout: 120_000 })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  mkdirSync(SHOTS, { recursive: true })
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()

  // A body long enough that the variants start below the first screen at both widths: the form is then out of sight at load.
  const paragraph = (n: number) => ({
    type: 'paragraph',
    version: 1,
    children: [{ type: 'text', version: 1, text: `فقرة رقم ${n} من وصف الكتاب، وهي طويلة بما يكفي لتمتد على أكثر من سطر في شاشة الهاتف وفي شاشة الحاسوب معًا.` }],
  })
  const body = { root: { type: 'root', children: Array.from({ length: 30 }, (_, i) => paragraph(i + 1)) } }
  productId = (
    await db.query<{ id: string }>(
      `insert into public.products (slug, title, summary, status, body) values ($1, $2, 'ملخص تجريبي للاختبار', 'published', $3::jsonb) returning id`,
      [slug, TITLE, JSON.stringify(body)],
    )
  ).rows[0]!.id
  const sku = (kind: string) => `E2E-${kind}-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const shipsOn = (await db.query<{ d: string }>("select to_char((now() at time zone 'Asia/Riyadh')::date + 45, 'YYYY-MM-DD') as d")).rows[0]!.d
  const inserted = await db.query<{ id: string; sku: string }>(
    `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, sort_order) values
       ($1, $2, $7, 'physical', 1930, true, 7, 1),
       ($1, $3, $8, 'signed', 4450, true, 0, 3),
       ($1, $4, $9, 'physical', 3070, true, 3, 4),
       ($1, $5, $10, 'physical', 1500, true, 2, 5),
       ($1, $6, $11, 'physical', null, true, 1, 6)
     returning id, sku`,
    [productId, sku('AV'), sku('OS'), sku('UN'), sku('GO'), sku('NP'), T_AVAIL, T_OOS, T_UNP, T_GONE, T_NOPRICE],
  )
  const idOf = (kind: string) => inserted.rows.find((entry) => entry.sku === sku(kind))!.id
  // The preorder: a digital edition with its capacity, date and note (a digital variant has no stock).
  const pre = await db.query<{ id: string }>(
    `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, sort_order, preorder, preorder_capacity, preorder_ships_on, preorder_note)
     values ($1, $2, $3, 'digital', 2210, true, null, 2, true, 5, $4::date, $5) returning id`,
    [productId, sku('PR'), T_PRE, shipsOn, NOTE],
  )
  ids = { avail: idOf('AV'), pre: pre.rows[0]!.id, oos: idOf('OS'), unp: idOf('UN'), gone: idOf('GO'), noprice: idOf('NP') }
  const [year, , day] = shipsOn.split('-')
  ships = { iso: shipsOn, day: String(Number(day)), year: year! }

  // I38: `next dev` answers a generateStaticParams page from the static params it cached for that route, so the first
  // request for a slug made after the cache was filled can be a 404: wait until the dev server has seen this one.
  await expect.poll(async () => (await fetch(`${BASE}/store/${slug}`)).status, { timeout: 120_000 }).toBe(200)
  for (const route of ['/cart', '/checkout', '/policies/privacy']) {
    await expect.poll(async () => (await fetch(`${BASE}${route}`)).status, { timeout: 120_000 }).toBe(200)
  }
})

test.beforeEach(async () => {
  // The cart's and the checkout's quotes come from one address: the per-IP throttle is proven by the integration tests.
  await db.query("delete from finance.rate_limits where bucket in ('checkout-quote:ip', 'checkout:ip', 'checkout:all')")
})

test.afterAll(async () => {
  await db.query('delete from public.product_variants where product_id = $1', [productId])
  await db.query('delete from public.products where id = $1', [productId])
  await db.end()
})

for (const width of [360, 1440]) {
  test.describe(`at ${width}px`, () => {
    // Short enough that the form, below the long description, is out of sight until it is scrolled to.
    test.use({ viewport: { width, height: 700 } })

    // ---- the five states of a row ----

    test('a row is the add control, a preorder, out of stock with the sign-up, unpriced, or gone: each as the live state says', async ({ page }) => {
      const problems = watchProblems(page)
      await stubTurnstile(page)
      const reads = await mockAvailability(page, () => mixed())
      await openProduct(page)

      // Available: the price and today's add control, nothing about a preorder or a sign-up.
      const avail = row(page, T_AVAIL)
      await expect(avail.getByText('19.30 ر.س')).toBeVisible()
      await expect(addButton(avail)).toBeVisible()
      await expect(preorderButton(avail)).toHaveCount(0)
      await expect(avail.getByText(/طلب مسبق/)).toHaveCount(0)
      await expect(avail.getByRole('form')).toHaveCount(0)

      // A preorder: its delivery date and its note under it, and a button that says so.
      const pre = row(page, T_PRE)
      await expect(pre.getByText('22.10 ر.س')).toBeVisible()
      await expect(pre.getByText(PREORDER_SENTENCE())).toBeVisible()
      await expect(pre.getByText(NOTE, { exact: true })).toBeVisible()
      await expect(preorderButton(pre)).toBeVisible()
      await expect(addButton(pre)).toHaveCount(0)

      // Out of stock: the words and the sign-up; no way to add.
      const oos = row(page, T_OOS)
      await expect(oos.getByText('غير متوفر حاليًا', { exact: true })).toBeVisible()
      await expect(oos.getByText('44.50 ر.س')).toBeVisible()
      await expect(emailField(oos)).toBeVisible()
      await expect(signUp(oos)).toBeVisible()
      await expect(addButton(oos)).toHaveCount(0)

      // Unpriced by the live state (it was priced when built): the words, and no price and no control.
      const unp = row(page, T_UNP)
      await expect(unp.getByText('غير مسعّر', { exact: true })).toBeVisible()
      await expect(unp.getByText('30.70 ر.س')).toHaveCount(0)
      await expect(unp.getByRole('button')).toHaveCount(0)
      await expect(unp.getByRole('textbox')).toHaveCount(0)

      // No entry at all (disabled, or no longer published): «غير متاح حاليًا», and nothing to press.
      const gone = row(page, T_GONE)
      await expect(gone.getByText('غير متاح حاليًا', { exact: true })).toBeVisible()
      await expect(gone.getByText('15.00 ر.س')).toHaveCount(0)
      await expect(gone.getByRole('button')).toHaveCount(0)

      // Unpriced when built: «غير مسعّر» from the static page, whatever the read says.
      await expect(row(page, T_NOPRICE).getByText('غير مسعّر', { exact: true })).toBeVisible()
      await expect(row(page, T_NOPRICE).getByRole('button')).toHaveCount(0)

      // One read for the whole page, and no preorder wording in any row but the preorder's own.
      expect(reads()).toBe(1)
      await expect(page.getByText(/^طلب مسبق: يُسلَّم/)).toHaveCount(1)

      // Calm and official: the rows are in no reveal, and nothing animates once the states are in.
      const variants = page.locator('main ul[class*="variants"]')
      expect(await variants.evaluate((list) => list.closest('[data-reveal]') === null && list.querySelector('[data-reveal]') === null)).toBe(true)
      expect(await variants.evaluate((list) => list.getAnimations({ subtree: true }).length)).toBe(0)
      await expectNoOverflow(page, `product ${width}`)
      await expectTargets(page, `product ${width}`)
      expect(problems).toEqual([])
      await shoot(page, 'product', width, variants)

      // The preorder's button puts the same cart line in, and says so.
      await preorderButton(pre).click()
      await expect(pre.getByText('أُضيف إلى السلة.')).toBeVisible()
      expect(await page.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain(ids.pre)
    })

    test('the database\'s own answer reaches the rows: the strict parser accepts what the function really returns', async ({ page }) => {
      const problems = watchProblems(page)
      await stubTurnstile(page)
      const answered = page.waitForResponse((response) => response.url().endsWith('/rest/v1/rpc/catalog_availability'))
      await openProduct(page)
      const reply = await answered
      expect(reply.status()).toBe(200)
      // The real rows carry exactly these two keys and a state from the contract's four.
      const rows = (await reply.json()) as Array<{ variant_id: string; state: string }>
      for (const entry of rows) {
        expect(Object.keys(entry).sort()).toEqual(['state', 'variant_id'])
        expect(['available', 'preorder', 'out_of_stock', 'unpriced']).toContain(entry.state)
      }
      const stateOf = (id: string) => rows.find((entry) => entry.variant_id === id)?.state
      expect([stateOf(ids.avail), stateOf(ids.pre), stateOf(ids.oos), stateOf(ids.noprice)]).toEqual(['available', 'preorder', 'out_of_stock', 'unpriced'])

      // The rows say what the database said (the two variants the real function calls available stay the add control).
      await expect(preorderButton(row(page, T_PRE))).toBeVisible()
      await expect(row(page, T_PRE).getByText(PREORDER_SENTENCE())).toBeVisible()
      await expect(row(page, T_OOS).getByText('غير متوفر حاليًا', { exact: true })).toBeVisible()
      await expect(signUp(row(page, T_OOS))).toBeVisible()
      for (const title of [T_AVAIL, T_UNP, T_GONE]) await expect(addButton(row(page, title))).toBeVisible()
      await expect(row(page, T_NOPRICE).getByText('غير مسعّر', { exact: true })).toBeVisible()
      expect(problems).toEqual([])
    })

    // ---- before the states arrive, and when they never do ----

    test('before the states arrive every priced row is what the static page made it, and nothing sells what is not there', async ({ page }) => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await mockAvailability(page, async () => {
        await gate
        return mixed()
      })
      await openProduct(page)
      // The read is pending: the price and the add control of each priced row, and not a word of a preorder or a sign-up.
      for (const title of [T_AVAIL, T_PRE, T_OOS, T_UNP, T_GONE]) {
        await expect(addButton(row(page, title)), title).toBeVisible()
      }
      await expect(page.getByText(/طلب مسبق/)).toHaveCount(0)
      await expect(page.getByText('غير متوفر حاليًا')).toHaveCount(0)
      await expect(page.getByRole('form')).toHaveCount(0)
      await expect(row(page, T_OOS).getByText('44.50 ر.س')).toBeVisible()
      await expect(row(page, T_NOPRICE).getByText('غير مسعّر', { exact: true })).toBeVisible()

      release()
      await expect(emailField(row(page, T_OOS))).toBeVisible()
      await expect(row(page, T_PRE).getByText(PREORDER_SENTENCE())).toBeVisible()
      await expect(row(page, T_GONE).getByText('غير متاح حاليًا', { exact: true })).toBeVisible()
    })

    test('a read that fails, or that is not what the function says, leaves today\'s controls and no preorder wording; the add control still works', async ({ page }) => {
      const problems = watchProblems(page)
      const answers: Array<[string, Answer]> = [
        ['a server error', { status: 500, body: { message: 'down' } }],
        ['a lost connection', 'abort'],
        ['a reply that is not a list', { status: 200, body: { variant_id: ids.oos, state: 'out_of_stock' } }],
        ['a row with a number in it', { status: 200, body: [{ variant_id: ids.oos, state: 'out_of_stock', stock: 0 }] }],
        ['one row whose id is not a UUID', { status: 200, body: [{ variant_id: ids.oos, state: 'out_of_stock' }, { variant_id: 'not-a-uuid', state: 'available' }] }],
      ]
      let current: Answer = answers[0]![1]
      const reads = await mockAvailability(page, () => current)
      for (const [name, answer] of answers) {
        current = answer
        const before = reads()
        await openProduct(page)
        for (const title of [T_AVAIL, T_PRE, T_OOS, T_UNP, T_GONE]) {
          await expect(addButton(row(page, title)), `${name}: ${title}`).toBeVisible()
        }
        await expect(row(page, T_NOPRICE).getByText('غير مسعّر', { exact: true })).toBeVisible()
        await expect(page.getByText(/طلب مسبق/)).toHaveCount(0)
        await expect(page.getByText('غير متوفر حاليًا')).toHaveCount(0)
        await expect(page.getByText('غير متاح حاليًا')).toHaveCount(0)
        await expect(page.getByRole('form')).toHaveCount(0)
        // One try for the page, and no retry.
        await page.waitForTimeout(300)
        expect(reads() - before, name).toBe(1)
      }
      // Nothing is lost: the visitor can still put the item in the cart, and the quote decides at checkout.
      const avail = row(page, T_AVAIL)
      await addButton(avail).click()
      await expect(avail.getByText('أُضيف إلى السلة.')).toBeVisible()
      expect(problems).toEqual([])
    })

    test('a static product page, with JavaScript off, shows the price and the add control as before, and no preorder wording or form', async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 700 } })
      const page = await context.newPage()
      await page.goto(`/store/${slug}`)
      await expect(row(page, T_AVAIL).getByText('19.30 ر.س')).toBeVisible()
      await expect(addButton(row(page, T_AVAIL))).toBeVisible()
      await expect(row(page, T_PRE).getByText('22.10 ر.س')).toBeVisible()
      await expect(row(page, T_NOPRICE).getByText('غير مسعّر', { exact: true })).toBeVisible()
      await expect(page.getByText(/طلب مسبق/)).toHaveCount(0)
      await expect(page.getByRole('form')).toHaveCount(0)
      await expect(page.locator('noscript').first()).toBeAttached()
      await context.close()
    })

    // ---- the sign-up form ----

    test('Turnstile loads only when the form is focused or scrolled into view, with the action `notify`', async ({ page }) => {
      const scriptRequests = await stubTurnstile(page)
      await mockAvailability(page, () => outOfStockOnly())
      await openProduct(page)
      const form = row(page, T_OOS).getByRole('form')
      // The form is on the page, below the long description and out of sight: no widget, no script.
      await expect(form).toBeAttached()
      await expect(form).not.toBeInViewport()
      await page.waitForTimeout(500)
      expect(scriptRequests()).toBe(0)
      expect(await turnstile(page)).toEqual({ issued: 0, resets: 0, actions: [], last: '' })

      // Scrolled into view: the script loads and the widget renders for the action the function checks.
      await form.scrollIntoViewIfNeeded()
      await expect.poll(scriptRequests).toBe(1)
      await expect.poll(async () => (await turnstile(page)).actions).toEqual(['notify'])
      await expect.poll(async () => (await turnstile(page)).issued).toBe(1)

      // Focus alone does it too: a fresh page, the field focused without scrolling anywhere.
      const fresh = await page.context().newPage()
      await fresh.setViewportSize({ width, height: 700 })
      const freshRequests = await stubTurnstile(fresh)
      await mockAvailability(fresh, () => outOfStockOnly())
      await openProduct(fresh)
      const freshForm = row(fresh, T_OOS).getByRole('form')
      await expect(freshForm).toBeAttached()
      await expect(freshForm).not.toBeInViewport()
      expect(freshRequests()).toBe(0)
      await emailField(freshForm).evaluate((input) => (input as HTMLInputElement).focus({ preventScroll: true }))
      await expect(freshForm).not.toBeInViewport()
      await expect.poll(freshRequests).toBe(1)
      await expect.poll(async () => (await turnstile(fresh)).actions).toEqual(['notify'])
      await fresh.close()
    })

    test('with Cloudflare\'s own widget the sign-up fits the row (evidence for the picture; nothing here depends on the widget solving)', async ({ page }) => {
      await mockAvailability(page, () => outOfStockOnly())
      await openProduct(page)
      const oos = row(page, T_OOS)
      await oos.getByRole('form').scrollIntoViewIfNeeded()
      // The real widget draws itself in a frame inside a closed shadow root: its host element, in our box, has its size.
      const box = oos.locator('div[class*="turnstileBox"]')
      await expect.poll(() => box.evaluate((element) => element.childElementCount), { timeout: 15_000 }).toBeGreaterThan(0)
      await page.waitForTimeout(2000)
      const fit = await box.evaluate((element) => {
        const host = element.firstElementChild!.getBoundingClientRect()
        const card = element.closest('li')!.getBoundingClientRect()
        return { hostLeft: host.left, hostRight: host.right, hostWidth: host.width, cardLeft: card.left, cardRight: card.right }
      })
      expect(fit.hostLeft, 'the widget starts inside the row').toBeGreaterThanOrEqual(fit.cardLeft)
      expect(fit.hostRight, 'the widget ends inside the row').toBeLessThanOrEqual(fit.cardRight)
      await expectNoOverflow(page, `form with the widget ${width}`)
      await shoot(page, 'signup-widget', width, oos)
      console.log(`widget host ${Math.round(fit.hostWidth)}px wide in a row ${Math.round(fit.cardRight - fit.cardLeft)}px wide at ${width}px`)
    })

    test('a product page with no out-of-stock variant never loads Turnstile', async ({ page }) => {
      const scriptRequests = await stubTurnstile(page)
      await mockAvailability(page, () => ({ status: 200, body: [{ variant_id: ids.avail, state: 'available' }, { variant_id: ids.pre, state: 'preorder' }] }))
      await openProduct(page)
      await expect(preorderButton(row(page, T_PRE))).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(500)
      expect(scriptRequests()).toBe(0)
      await expect(page.getByRole('form')).toHaveCount(0)
    })

    test('the request: the variant, the normalized address, no privacy revision while none is published, and the token; then one sentence, with the focus', async ({ page }) => {
      test.skip((await privacySeq()) !== null, 'the database already has a published privacy policy')
      const problems = watchProblems(page)
      await stubTurnstile(page)
      await mockAvailability(page, () => mixed())
      const calls = await mockNotify(page, () => ok({ sent: true }))
      const form = await openForm(page)
      const oos = row(page, T_OOS)

      // With no privacy policy published: no link, no other text about data.
      await expect(oos.getByRole('link', { name: /سياسة الخصوصية/ })).toHaveCount(0)
      // The labels and the field's kinds.
      await expect(emailField(form)).toHaveAttribute('type', 'email')
      await expect(emailField(form)).toHaveAttribute('autocomplete', 'email')
      await expect(emailField(form)).toHaveAttribute('inputmode', 'email')
      // The status and alert regions are in the page before they have any words.
      await expect(oos.getByRole('status')).toHaveCount(1)
      await expect(oos.getByRole('status')).toHaveText('')
      await expect(oos.getByRole('alert')).toHaveCount(2)
      await expectNoOverflow(page, `form ${width}`)
      await expectTargets(page, `form ${width}`)

      await emailField(form).fill('  Reader@Example.COM ')
      await signUp(form).click()
      await expect(oos.getByText(SENT, { exact: true })).toBeVisible()
      expect(calls).toEqual([{ action: 'subscribe', variantId: ids.oos, email: 'reader@example.com', consentRevision: null, turnstileToken: 'stub-token-1' }])
      // The sentence replaced the form and took the focus; nothing else about the address is said.
      await expect(form).toHaveCount(0)
      await expect(oos.getByRole('status')).toBeFocused()
      await expect(oos.getByRole('status')).toHaveText(SENT)
      await expect(oos.getByText(/خصوصية|بياناتك|نستخدم/)).toHaveCount(0)
      await shoot(page, 'signup-sent', width, oos)
      expect(problems).toEqual([])
    })

    test('with a privacy policy published the form links it, and the request carries the revision this build rendered', async ({ page }) => {
      let seq = await privacySeq()
      const publishedHere = seq === null
      if (seq === null) {
        // Publish one the way the owner's publish does: a version, then it goes live.
        seq = (await db.query<{ seq: number }>("select coalesce(max(seq), 0) + 1 as seq from public.content_versions where collection = 'policies' and doc_id = 'privacy'")).rows[0]!.seq
        const data = { title: 'سياسة الخصوصية', body: { root: { type: 'root', children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text: 'نص سياسة الاختبار.' }] }] } } }
        await db.query("insert into public.content_versions (collection, doc_id, seq, data) values ('policies', 'privacy', $1, $2::jsonb)", [seq, JSON.stringify(data)])
        await db.query("select public.content_go_live('policies', 'privacy', $1)", [seq])
      }
      try {
        await stubTurnstile(page)
        await mockAvailability(page, () => outOfStockOnly())
        const calls = await mockNotify(page, () => ok({ sent: true }))
        const form = await openForm(page)
        // A plain link beside the button, to the policy page, in a new tab.
        const link = form.getByRole('link', { name: /سياسة الخصوصية/ })
        await expect(link).toHaveAttribute('href', '/policies/privacy')
        await expect(link).toHaveAttribute('target', '_blank')
        await expectNoOverflow(page, `form with policy ${width}`)
        await expectTargets(page, `form with policy ${width}`)
        // The link works: it opens the policy page in a tab of its own, and what is typed here stays.
        await emailField(form).fill('policy@example.com')
        const [policyTab] = await Promise.all([page.waitForEvent('popup'), link.click()])
        await expect(policyTab.getByRole('heading', { level: 1 })).toHaveText('سياسة الخصوصية')
        await policyTab.close()
        await expect(emailField(form)).toHaveValue('policy@example.com')
        await shoot(page, 'signup-form', width, row(page, T_OOS))
        await signUp(form).click()
        await expect(page.getByText(SENT, { exact: true })).toBeVisible()
        expect(calls).toEqual([{ action: 'subscribe', variantId: ids.oos, email: 'policy@example.com', consentRevision: seq, turnstileToken: 'stub-token-1' }])
      } finally {
        // archive_document refuses `policies` (and needs a publisher's JWT), so a policy published here goes with SQL:
        // only the version this test inserted, and the live copy only while it is still that version (drafts stay).
        if (publishedHere) {
          await db.query("delete from public.published_documents where collection = 'policies' and doc_id = 'privacy' and seq = $1", [seq])
          await db.query("delete from public.content_versions where collection = 'policies' and doc_id = 'privacy' and seq = $1", [seq])
        }
      }
    })

    test('every 200 is the same one sentence, whoever the address belongs to', async ({ page }) => {
      await stubTurnstile(page)
      await mockAvailability(page, () => outOfStockOnly())
      const calls = await mockNotify(page, () => ok({ sent: true }))
      const sentences: string[] = []
      for (const address of ['new@example.com', 'already-confirmed@example.com']) {
        const form = await openForm(page)
        await emailField(form).fill(address)
        // The first by the button, the second by Enter in the field: the form is a form.
        if (sentences.length === 0) await signUp(form).click()
        else await emailField(form).press('Enter')
        const status = row(page, T_OOS).getByRole('status')
        await expect(status).toHaveText(SENT)
        sentences.push((await status.textContent()) ?? '')
      }
      expect(new Set(sentences).size).toBe(1)
      expect(calls.map((body) => body.email)).toEqual(['new@example.com', 'already-confirmed@example.com'])
    })

    test('an address the function refuses (422) is named under the field, the form stays, and a fixed address goes through with a fresh token', async ({ page }) => {
      await stubTurnstile(page)
      await mockAvailability(page, () => outOfStockOnly())
      const calls = await mockNotify(page, (_body, nth) => (nth === 1 ? refused(422, 'INVALID', 'بيانات غير صالحة.') : ok({ sent: true })))
      const form = await openForm(page)
      await emailField(form).fill('a@b.c')
      await signUp(form).click()
      const error = form.locator('span[role="alert"]')
      await expect(error).toHaveText(EMAIL_ERROR)
      await expect(emailField(form)).toBeFocused()
      await expect(emailField(form)).toHaveAttribute('aria-invalid', 'true')
      await expect(emailField(form)).toHaveAccessibleDescription(EMAIL_ERROR)
      await expect(form).toBeVisible()
      await expect(page.getByText(SENT)).toHaveCount(0)
      await shoot(page, 'signup-error', width, row(page, T_OOS))
      // The spent token was reset: the retry carries the next one.
      await expect.poll(async () => (await turnstile(page)).resets).toBe(1)
      await expect.poll(async () => (await turnstile(page)).issued).toBe(2)
      await emailField(form).fill('fixed@example.com')
      await expect(error).toHaveText('')
      await signUp(form).click()
      await expect(page.getByText(SENT, { exact: true })).toBeVisible()
      expect(calls.map((body) => [body.email, body.turnstileToken])).toEqual([
        ['a@b.c', 'stub-token-1'],
        ['fixed@example.com', 'stub-token-2'],
      ])
    })

    for (const [name, answer, words] of [
      ['a throttle (429)', refused(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.'), 'أرسلت طلبات كثيرة؛ حاول لاحقًا.'],
      ['a failed Turnstile check (400)', refused(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.'), 'تعذّر التحقق من أنك إنسان.'],
      ['Turnstile unavailable (503)', refused(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.'), 'تعذّر التحقق من الطلب.'],
      ['a 429 with no words', { status: 429, body: { ok: false } }, 'حاول بعد قليل.'],
      ['a server error with no words', { status: 500, body: { ok: false } }, NETWORK],
    ] as Array<[string, Reply, string]>) {
      test(`${name} shows a short message in an alert, keeps the form, resets the spent token and lets the next try through`, async ({ page }) => {
        await stubTurnstile(page)
        await mockAvailability(page, () => outOfStockOnly())
        const calls = await mockNotify(page, (_body, nth) => (nth === 1 ? answer : ok({ sent: true })))
        const form = await openForm(page)
        await emailField(form).fill('try@example.com')
        await signUp(form).click()
        await expect(form.getByRole('alert').filter({ hasText: words })).toBeVisible()
        await expect(form).toBeVisible()
        await expect(emailField(form)).toHaveValue('try@example.com')
        await expect(page.getByText(SENT)).toHaveCount(0)
        await expect.poll(async () => (await turnstile(page)).resets).toBe(1)
        await expect.poll(async () => (await turnstile(page)).issued).toBe(2)
        // The button is usable again, with a fresh token.
        await expect(signUp(form)).not.toHaveAttribute('aria-disabled', 'true')
        await signUp(form).click()
        await expect(page.getByText(SENT, { exact: true })).toBeVisible()
        expect(calls.map((body) => body.turnstileToken)).toEqual(['stub-token-1', 'stub-token-2'])
      })
    }

    test('a lost connection, and a 200 that is not `{sent: true}`, are the network sentence and never the success one', async ({ page }) => {
      await stubTurnstile(page)
      await mockAvailability(page, () => outOfStockOnly())
      const answers: Answer[] = ['abort', ok({}), ok({ sent: true, extra: 1 }), ok({ sent: false }), { status: 200, body: { ok: true } }, ok({ sent: true })]
      const calls = await mockNotify(page, (_body, nth) => answers[nth - 1]!)
      const form = await openForm(page)
      await emailField(form).fill('net@example.com')
      for (let n = 1; n <= answers.length - 1; n += 1) {
        await signUp(form).click()
        await expect(form.getByRole('alert').filter({ hasText: NETWORK })).toBeVisible()
        await expect(page.getByText(SENT)).toHaveCount(0)
        await expect.poll(async () => (await turnstile(page)).issued).toBe(n + 1)
        await expect(emailField(form)).toBeVisible()
      }
      await signUp(form).click()
      await expect(page.getByText(SENT, { exact: true })).toBeVisible()
      expect(calls).toHaveLength(answers.length)
    })

    test('an address that is not one, or a check not yet solved, sends nothing and says what is missing', async ({ page }) => {
      await stubTurnstile(page, false)
      await mockAvailability(page, () => outOfStockOnly())
      const calls = await mockNotify(page, () => ok({ sent: true }))
      await openProduct(page)
      const form = row(page, T_OOS).getByRole('form')
      await form.scrollIntoViewIfNeeded()
      // The widget is rendered and never solves.
      await expect.poll(async () => (await turnstile(page)).actions).toEqual(['notify'])
      // Empty, then not an address: the words under the field, the focus on it, no request.
      await signUp(form).click()
      await expect(form.locator('span[role="alert"]')).toHaveText(EMAIL_ERROR)
      await expect(emailField(form)).toBeFocused()
      await emailField(form).fill('not-an-address')
      await signUp(form).click()
      await expect(form.locator('span[role="alert"]')).toHaveText(EMAIL_ERROR)
      // A good address but a widget that has not solved: asked to finish the check.
      await emailField(form).fill('slow@example.com')
      await expect(form.locator('span[role="alert"]')).toHaveText('')
      await signUp(form).click()
      await expect(form.getByRole('alert').filter({ hasText: 'أكمل التحقق من أنك لست آلياً، ثم أرسل.' })).toBeVisible()
      expect(calls).toEqual([])
    })

    // ---- the cart and the checkout ----

    test('the cart shows a preorder line\'s date and note under it, and a line that is not a preorder shows none', async ({ page }) => {
      const problems = watchProblems(page)
      await page.addInitScript(
        ([key, cart]) => localStorage.setItem(key!, cart!),
        [CART_KEY, JSON.stringify({ version: 1, lines: [{ variantId: ids.pre, quantity: 1 }, { variantId: ids.avail, quantity: 1 }] })],
      )
      await page.goto('/cart')
      const line = page.locator('main li', { hasText: T_PRE })
      await expect(line.getByText('22.10 ر.س', { exact: true })).toBeVisible()
      await expect(line.getByText(PREORDER_SENTENCE())).toBeVisible()
      await expect(line.getByText(NOTE, { exact: true })).toBeVisible()
      // Under the line: after its title and its controls.
      const box = async (locator: Locator) => (await locator.boundingBox())!
      expect((await box(line.getByText(PREORDER_SENTENCE()))).y).toBeGreaterThan((await box(line.getByRole('button', { name: /^حذف/ }))).y)
      // The other line is a plain one.
      const plain = page.locator('main li', { hasText: T_AVAIL })
      await expect(plain.getByText('19.30 ر.س', { exact: true })).toBeVisible()
      await expect(plain.getByText(/طلب مسبق/)).toHaveCount(0)
      await expect(page.getByText(/^طلب مسبق: يُسلَّم/)).toHaveCount(1)
      await expectNoOverflow(page, `cart ${width}`)
      await expectTargets(page, `cart ${width}`)
      await shoot(page, 'cart-preorder', width)
      expect(problems).toEqual([])
    })

    test('the checkout summary shows a preorder line\'s date and note before the buyer confirms', async ({ page }) => {
      const problems = watchProblems(page)
      await patchQuote(page, () => undefined)
      await stubTurnstile(page)
      await page.addInitScript(
        ([key, cart]) => localStorage.setItem(key!, cart!),
        [CART_KEY, JSON.stringify({ version: 1, lines: [{ variantId: ids.pre, quantity: 1 }] })],
      )
      await page.goto('/checkout')
      const summary = page.locator('main fieldset', { hasText: 'ملخص الطلب' })
      await expect(summary.getByText(`${TITLE}: ${T_PRE} × 1`)).toBeVisible()
      await expect(summary.getByText(PREORDER_SENTENCE())).toBeVisible()
      await expect(summary.getByText(NOTE, { exact: true })).toBeVisible()
      await expectNoOverflow(page, `checkout ${width}`)
      await shoot(page, 'checkout-preorder', width)
      expect(problems).toEqual([])
    })

    test('a quantity held for another order says so on the cart and on the checkout, not that the stock is short', async ({ page }) => {
      const held = { code: 'OUT_OF_STOCK', line: 0, variantId: ids.avail, available: 0, held: true }
      await patchQuote(page, (data) => {
        data.ok = false
        data.errors = [held]
        data.lines = []
        data.subtotal = 0
        data.total = 0
      })
      await stubTurnstile(page)
      await page.addInitScript(
        ([key, cart]) => localStorage.setItem(key!, cart!),
        [CART_KEY, JSON.stringify({ version: 1, lines: [{ variantId: ids.avail, quantity: 1 }] })],
      )
      await page.goto('/cart')
      const line = page.locator('main li').filter({ has: page.getByRole('button', { name: /^حذف/ }) })
      await expect(line.getByText(HELD, { exact: true })).toBeVisible()
      await expect(page.getByText(/المتاح:/)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'إزالة غير المتاح' })).toBeVisible()
      await expectNoOverflow(page, `held cart ${width}`)
      await shoot(page, 'cart-held', width)

      await page.goto('/checkout')
      await expect(page.getByText(HELD, { exact: true })).toBeVisible()
      await expect(page.getByText(/المتاح:/)).toHaveCount(0)
    })

    test('the return page offers «متابعة الدفع» only while the function gives the invoice link, and goes on verifying without it', async ({ page }) => {
      // `payment_view` stops giving the link once the invoice has expired (the browser sees `verify` answer without it).
      const invoice = 'https://pay.example.test/invoices/abc'
      let link: string | null = invoice
      await page.route('**/functions/v1/payments', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const data = { state: 'pending', hasToken: true, testMode: false, ...(link === null ? {} : { invoiceUrl: link }) }
        return route.fulfill({ status: 200, headers: FN_CORS, body: JSON.stringify(ok(data).body) })
      })
      await page.addInitScript(
        ([key, order]) => sessionStorage.setItem(key!, order!),
        ['anasaq:pending-order', JSON.stringify({ orderNumber: 'ABCD2345', accessToken: 'B'.repeat(43) })],
      )
      const continueLink = page.getByRole('link', { name: 'متابعة الدفع' })
      await page.goto('/checkout/return?order=ABCD2345')
      await expect(continueLink).toHaveAttribute('href', invoice)

      // The invoice has ended: the same state and the same words, and no link to follow.
      link = null
      const answered = page.waitForResponse((response) => response.url().endsWith('/functions/v1/payments') && response.request().method() === 'POST')
      await page.reload()
      await answered
      await expect(page.getByText('جارٍ التحقق من الدفع…')).toBeVisible()
      await page.waitForTimeout(300)
      await expect(continueLink).toHaveCount(0)
      await expectNoOverflow(page, `return without a link ${width}`)
    })
  })
}
