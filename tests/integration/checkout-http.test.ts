// P08 round 4: the REAL local `checkout` Edge Function over HTTP, with the Moyasar
// emulator started in this process on port 54390. The function runs in Docker and
// reaches the emulator as host.docker.internal:54390 (its MOYASAR_API_BASE_URL);
// the emulator sends the webhook and the invoice callback to the `payments`
// function. Nothing here reaches Moyasar. Turnstile runs with the local
// always-pass test secret, so any non-empty token works. The unit tests
// (tests/unit/checkout.test.ts) prove every branch of the handler with stubs; this
// file proves the layers fit: the SQL, the invoice step, the provider's own
// objects and the settle that follows a payment. What only the database could
// write (an aged attempt) is written as the local `postgres` superuser. This file
// switches `finance.commerce_settings.checkout_enabled` on, saved in beforeAll and
// restored in afterAll.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { startEmulator, type Emulator } from '../support/moyasar-emulator.ts'
import { localEnv, status, uniqueEmail } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const env = localEnv()
const FUNCTIONS_URL = status.FUNCTIONS_URL
const CHECKOUT = `${FUNCTIONS_URL}/checkout`
const SITE = env.SITE_URL!
const EMULATOR_PORT = 54390
const REV = { store: 1, delivery: 1, refund: 1 }
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const NAME = 'مشترٍ كريم'
const PHONE = '0501234567'
const ADDRESS = 'تبوك شارع الرئيسي'
const INVOICE_URL = new RegExp(`^http://127\\.0\\.0\\.1:${EMULATOR_PORT}/invoices/[0-9a-f-]{36}$`)

type Row = Record<string, any>
type Reply = { status: number; body: any }

let postgres: Client
let emulator: Emulator
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''
let counter = 0
const unique = (label: string): string => `${label}-${Date.now()}-${process.pid}-${(counter += 1)}`
const created = { products: [] as string[], rates: [] as string[], orders: [] as string[] }

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await postgres.query(sql, params)).rows
}
async function row(sql: string, params: unknown[] = []): Promise<Row> {
  const found = await rows(sql, params)
  expect(found, sql).toHaveLength(1)
  return found[0]!
}
const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await row(sql, params)).n)
const orderOf = (id: string): Promise<Row> => row('select * from finance.orders where id = $1', [id])
const attemptOf = (id: string): Promise<Row> => row('select * from finance.payment_attempts where id = $1', [id])
const attemptsOf = (orderId: string): Promise<Row[]> => rows('select * from finance.payment_attempts where order_id = $1 order by created_at', [orderId])
const reservationStates = async (orderId: string): Promise<string[]> =>
  (await rows('select state from finance.inventory_reservations where order_id = $1', [orderId])).map((entry) => entry.state)
const stockOf = async (variantId: string): Promise<number | null> => (await row('select stock from public.product_variants where id = $1', [variantId])).stock
const receipts = (orderId: string): Promise<number> =>
  count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and dedupe_key = $1", [`receipt:${orderId}`])

beforeAll(async () => {
  postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  await postgres.connect()
  startedAt = (await row('select now() as t')).t

  try {
    emulator = await startEmulator({
      port: EMULATOR_PORT,
      webhookUrl: `${FUNCTIONS_URL}/payments/webhook`,
      webhookSecret: env.MOYASAR_WEBHOOK_SECRET!,
      secretKey: env.MOYASAR_SECRET_KEY!,
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'EADDRINUSE') {
      throw new Error(`Port ${EMULATOR_PORT} is busy: stop whatever holds it (a running \`pnpm emulator\`?) and run this file again.`)
    }
    throw error
  }

  settingsSaved = await row(
    'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
  )
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع', seller_address = 'تبوك',
       seller_registration = 'REG-P08', policy_revisions = $1::jsonb where id = 1`,
    [JSON.stringify(REV)],
  )
  // The buckets the functions take from: the whole-store daily one, and the callback, verify and pay throttles of this machine's address.
  await postgres.query(
    "delete from finance.rate_limits where bucket in ('checkout:all', 'payment-callback:ip', 'payment-check:ip', 'payment-pay:ip')",
  )
  city = await makeRate(2500)
})

afterAll(async () => {
  await emulator?.close()
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  // Nothing of this run is left due for the reconciliation job or waiting in the outbox.
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  await postgres.query('delete from finance.payment_events where received_at >= $1', [startedAt])
  await postgres.query(
    "update finance.payment_reviews set closed_at = now(), closed_reason = 'test cleanup' where created_at >= $1 and closed_at is null",
    [startedAt],
  )
  await postgres.query("delete from finance.email_outbox where kind = 'owner_alert' and created_at >= $1", [startedAt])
  await postgres.query("delete from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = any($1::text[])", [created.orders])
  if (settingsSaved) {
    await postgres.query(
      `update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_address = $3,
         seller_registration = $4, policy_revisions = $5::jsonb, version = $6, configured_at = $7, approved_by = $8
       where id = 1`,
      [
        settingsSaved.checkout_enabled,
        settingsSaved.seller_legal_name,
        settingsSaved.seller_address,
        settingsSaved.seller_registration,
        JSON.stringify(settingsSaved.policy_revisions),
        settingsSaved.version,
        settingsSaved.configured_at,
        settingsSaved.approved_by,
      ],
    )
  }
  await postgres.end()
})

beforeEach(() => {
  // Every test starts from an empty emulator with the configuration it was started with: the webhook goes to the real
  // function, with the right secret, and every payment sends it and the invoice callback.
  emulator.reset()
})

// --- fixtures ------------------------------------------------------------------------------------------------

async function makeVariant(fulfillment: 'digital' | 'physical', price: number, stock: number | null): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const product = (
    await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [slug, `منتج ${slug}`])
  ).id as string
  created.products.push(product)
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock)
       values ($1, $2, $3, $4, $5, true, $6) returning id`,
      [product, sku, `خيار ${sku}`, fulfillment, price, stock],
    )
  ).id as string
}

async function makeRate(fee: number): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [key, `مدينة ${key}`, fee])
  created.rates.push(key)
  return key
}

// --- the function, over HTTP -----------------------------------------------------------------------------------

/** A random visitor address per request: the function throttles by it, and every test is its own visitor. */
const visitorIp = (): string => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function post(body: unknown, origin: string = SITE): Promise<Reply> {
  const response = await fetch(CHECKOUT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': visitorIp() },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

type Buyer = { key: string; session: string; email: string }
const newBuyer = (over: Partial<Buyer> = {}): Buyer => ({ key: randomUUID(), session: randomUUID(), email: uniqueEmail('buyer'), ...over })

/** The request a buyer's page sends, with the hash of the quote the function itself just gave. */
async function createBody(variantId: string, buyer: Buyer, quantity = 1): Promise<Record<string, unknown>> {
  const lines = [{ variantId, quantity }]
  const quoted = await post({ action: 'quote', lines, cityKey: city })
  expect(quoted.status, JSON.stringify(quoted.body)).toBe(200)
  expect(quoted.body.data.ok, JSON.stringify(quoted.body)).toBe(true)
  return {
    action: 'create',
    idempotencyKey: buyer.key,
    checkoutSession: buyer.session,
    lines,
    cityKey: city,
    address: ADDRESS,
    email: buyer.email,
    name: NAME,
    phone: PHONE,
    policyRevisions: REV,
    quoteHash: quoted.body.data.quoteHash,
    turnstileToken: TURNSTILE_TOKEN,
  }
}

type Placed = { reply: Reply; buyer: Buyer; body: Record<string, unknown>; orderId: string; number: string; token: string; total: number; payment: any }

/** Quotes, then creates: what the checkout page does. The order (when one is made) is remembered for the cleanup. */
async function place(variantId: string, over: Partial<Buyer> = {}): Promise<Placed> {
  const buyer = newBuyer(over)
  const body = await createBody(variantId, buyer)
  const reply = await post(body)
  const data = reply.body.data
  if (data?.order?.id) created.orders.push(data.order.id)
  return { reply, buyer, body, orderId: data?.order?.id, number: data?.order?.orderNumber, token: data?.accessToken, total: data?.order?.total, payment: data?.payment }
}
/** A create that must have made an order whose invoice exists. */
async function placeReady(variantId: string, over: Partial<Buyer> = {}): Promise<Placed> {
  const placed = await place(variantId, over)
  expect(placed.reply.status, JSON.stringify(placed.reply.body)).toBe(201)
  expect(placed.payment).toMatchObject({ state: 'ready' })
  return placed
}

const pay = (placed: Pick<Placed, 'number' | 'token'>, over: Record<string, unknown> = {}): Promise<Reply> =>
  post({ action: 'pay', orderNumber: placed.number, accessToken: placed.token, ...over })
const cancel = (placed: Pick<Placed, 'number' | 'token'>): Promise<Reply> =>
  post({ action: 'cancel', orderNumber: placed.number, accessToken: placed.token })

async function control(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${emulator.url}/__emulator${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
const emulatorCalls = (route: string): number => emulator.state().calls.filter((entry) => entry.route === route).length
const CREATE_INVOICE = 'POST /v1/invoices'
const CANCEL_INVOICE = 'PUT /v1/invoices/:id/cancel'
const FETCH_PAYMENT = 'GET /v1/payments/:id'

// --- quote and the closed store -----------------------------------------------------------------------------------

describe('quote, and a store that is closed', () => {
  it('the quote says open and in test mode; the cart errors and totals come from the database', async () => {
    const variant = await makeVariant('physical', 4000, 5)
    const quoted = await post({ action: 'quote', lines: [{ variantId: variant, quantity: 2 }], cityKey: city })
    expect(quoted.status).toBe(200)
    expect(quoted.body.data).toMatchObject({ ok: true, subtotal: 8000, shipping: 2500, total: 10_500, checkoutEnabled: true, testMode: true, policyRevisions: REV })
    expect(quoted.body.data.lines[0]).toHaveProperty('preorder', null)
  })

  it('with the switch off the quote is closed and create answers 503 CHECKOUT_DISABLED, with no order', async () => {
    const variant = await makeVariant('physical', 4000, 5)
    const buyer = newBuyer()
    const body = await createBody(variant, buyer)
    await postgres.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
    try {
      const quoted = await post({ action: 'quote', lines: [{ variantId: variant, quantity: 1 }], cityKey: city })
      expect(quoted.body.data).toMatchObject({ ok: true, checkoutEnabled: false, testMode: true })
      const refused = await post(body)
      expect(refused.status).toBe(503)
      expect(refused.body.error.code).toBe('CHECKOUT_DISABLED')
    } finally {
      await postgres.query('update finance.commerce_settings set checkout_enabled = true where id = 1')
    }
    expect(await count('select count(*)::int as n from finance.orders where idempotency_key = $1', [buyer.key])).toBe(0)
    expect(emulator.state().calls).toHaveLength(0)
  })

  it('a total under the minimum is refused in the quote and in create; a name with a control character names its field', async () => {
    const tiny = await makeVariant('digital', 99, null)
    const buyer = newBuyer()
    const quoted = await post({ action: 'quote', lines: [{ variantId: tiny, quantity: 1 }] })
    expect(quoted.body.data).toMatchObject({ ok: false, errors: [{ code: 'TOTAL_BELOW_MINIMUM', minimum: 100 }] })
    const refused = await post({
      action: 'create',
      idempotencyKey: buyer.key,
      checkoutSession: buyer.session,
      lines: [{ variantId: tiny, quantity: 1 }],
      email: buyer.email,
      name: NAME,
      policyRevisions: REV,
      quoteHash: quoted.body.data.quoteHash,
      turnstileToken: TURNSTILE_TOKEN,
    })
    expect(refused.status).toBe(422)
    expect(refused.body.error).toMatchObject({ code: 'TOTAL_BELOW_MINIMUM', message: 'قيمة الطلب أقل من الحد الأدنى للدفع.' })
    expect(await count('select count(*)::int as n from finance.orders where idempotency_key = $1', [buyer.key])).toBe(0)

    const variant = await makeVariant('digital', 3500, null)
    const bad = { ...(await createBody(variant, newBuyer())), name: 'زا\u0007ئر' }
    const named = await post(bad)
    expect(named.status).toBe(422)
    expect(named.body.error.code).toBe('INVALID')
    expect(named.body.error.fields.fieldErrors.name).toEqual(['لا يُقبل اسم فيه رموز تحكم.'])
    expect(emulator.state().calls).toHaveLength(0)
  })
})

// --- create: the order and its invoice -------------------------------------------------------------------------------

describe('create makes the order and its invoice', () => {
  it('answers 201 with a ready payment on the emulator, and the emulator holds exactly one invoice with the documented fields and no buyer data', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await place(variant)
    expect(placed.reply.status, JSON.stringify(placed.reply.body)).toBe(201)
    expect(placed.reply.body.ok).toBe(true)
    expect(placed.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(placed.payment).toEqual({ state: 'ready', url: expect.stringMatching(INVOICE_URL) })
    expect(placed.reply.body.data.order).toMatchObject({ status: 'pending_payment', total: 6500, currency: 'SAR', environment: 'test' })

    const order = await orderOf(placed.orderId)
    const attempts = await attemptsOf(placed.orderId)
    expect(attempts).toHaveLength(1)
    const invoices = emulator.state().invoices
    expect(invoices).toHaveLength(1)
    const [invoice] = invoices
    expect(invoice).toMatchObject({
      amount: order.total_halalas,
      currency: 'SAR',
      description: `طلب ${order.order_number}`,
      status: 'initiated',
      url: placed.payment.url,
      callback_url: `${env.FUNCTIONS_PUBLIC_URL}/payments/callback`,
      success_url: `${SITE}/checkout/return?order=${order.order_number}`,
      back_url: `${SITE}/checkout/return?order=${order.order_number}`,
    })
    expect(invoice!.callback_url!.endsWith('/payments/callback')).toBe(true)
    // The invoice ends when the hold does (to the millisecond a JSON date keeps).
    expect(Math.abs(Date.parse(invoice!.expired_at!) - order.hold_expires_at.getTime())).toBeLessThanOrEqual(1)
    // The order number and the attempt id only.
    expect(invoice!.metadata).toEqual({ order_number: order.order_number, attempt_id: attempts[0]!.id })
    expect(attempts[0]).toMatchObject({
      status: 'pending',
      provider_invoice_id: invoice!.id,
      invoice_url: invoice!.url,
      amount_halalas: order.total_halalas,
      currency: 'SAR',
      environment: 'test',
    })
    // Nothing about the buyer reaches the provider.
    const text = JSON.stringify(invoice)
    for (const secret of [placed.buyer.email, NAME, PHONE, '966501234567', ADDRESS, 'تبوك']) expect(text).not.toContain(secret)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
    // The order's hold and the stock are exactly what the checkout alone made: nothing was sold.
    expect(await reservationStates(placed.orderId)).toEqual(['held'])
    expect(await stockOf(variant)).toBe(10)
  })

  it('the same idempotency key again answers the same order, token and URL, and creates no second invoice', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const again = await post(placed.body)
    expect(again.status).toBe(200)
    expect(again.body.data.order.orderNumber).toBe(placed.number)
    expect(again.body.data.accessToken).toBe(placed.token)
    expect(again.body.data.payment).toEqual({ state: 'ready', url: placed.payment.url })
    expect(emulator.state().invoices).toHaveLength(1)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
    expect(await attemptsOf(placed.orderId)).toHaveLength(1)
    expect(await count('select count(*)::int as n from finance.orders where idempotency_key = $1', [placed.buyer.key])).toBe(1)
  })

  it('two concurrent creates with one key make one order and one invoice; both name the order, and a pay returns the one URL', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const buyer = newBuyer()
    const body = await createBody(variant, buyer)
    const [first, second] = await Promise.all([post(body), post(body)])
    for (const reply of [first, second]) created.orders.push(reply.body.data?.order?.id)
    expect([first.status, second.status].sort()).toEqual([200, 201])
    expect(first.body.data.order.orderNumber).toBe(second.body.data.order.orderNumber)
    expect(first.body.data.accessToken).toBe(second.body.data.accessToken)
    // One of them made the invoice; the other either saw it already or was told it is being prepared.
    const states = [first.body.data.payment.state, second.body.data.payment.state]
    expect(states.every((state) => state === 'ready' || state === 'preparing')).toBe(true)
    expect(states).toContain('ready')

    expect(await count('select count(*)::int as n from finance.orders where idempotency_key = $1', [buyer.key])).toBe(1)
    const orderId = first.body.data.order.id
    expect(await attemptsOf(orderId)).toHaveLength(1)
    expect(emulator.state().invoices).toHaveLength(1)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)

    const paid = await pay({ number: first.body.data.order.orderNumber, token: first.body.data.accessToken })
    expect(paid.body.data.payment).toEqual({ state: 'ready', url: emulator.state().invoices[0]!.url })
  })
})

describe('pay', () => {
  it('answers the order and the same URL again, creating nothing; a wrong token or an unknown order is 404', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const again = await pay(placed)
    expect(again.status).toBe(200)
    expect(again.body.data.payment).toEqual({ state: 'ready', url: placed.payment.url })
    expect(again.body.data.order).toMatchObject({ orderNumber: placed.number, status: 'pending_payment', total: placed.total })
    expect(again.body.data).not.toHaveProperty('accessToken')
    expect(emulator.state().invoices).toHaveLength(1)

    const wrong = await pay({ number: placed.number, token: 'W'.repeat(43) })
    expect(wrong.status).toBe(404)
    expect(wrong.body.error.code).toBe('NOT_FOUND')
    const unknown = await pay({ number: 'ZZZZ2345', token: placed.token })
    expect(unknown.status).toBe(404)
    expect((await pay({ number: placed.number, token: 'short' })).status).toBe(422)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
  })
})

// --- the provider failing -----------------------------------------------------------------------------------

describe('create when the provider fails', () => {
  it('a creation cut after the provider committed is preparing; the next pay adopts that invoice: exactly one invoice, mapped', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    await control('/fault', { route: CREATE_INVOICE, mode: 'drop_after_commit', times: 1 })
    const placed = await place(variant)
    expect(placed.reply.status).toBe(201)
    expect(placed.payment).toEqual({ state: 'preparing' })
    expect(placed.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [attempt] = await attemptsOf(placed.orderId)
    expect(attempt).toMatchObject({ status: 'uncertain', last_error: 'CREATE_UNCERTAIN', provider_invoice_id: null })
    expect(emulator.state().invoices).toHaveLength(1)

    const retried = await pay(placed)
    expect(retried.status).toBe(200)
    const [invoice] = emulator.state().invoices
    expect(retried.body.data.payment).toEqual({ state: 'ready', url: invoice!.url })
    expect(await attemptOf(attempt!.id)).toMatchObject({ status: 'pending', provider_invoice_id: invoice!.id })
    expect(emulator.state().invoices).toHaveLength(1)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
  })

  it('a 500 (nothing was made) is preparing; a pay too soon waits; once the attempt is old enough it is abandoned and a new invoice is made: exactly one payable', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    await control('/fault', { route: CREATE_INVOICE, mode: '500', times: 1 })
    const placed = await place(variant)
    expect(placed.reply.status).toBe(201)
    expect(placed.payment).toEqual({ state: 'preparing' })
    const [first] = await attemptsOf(placed.orderId)
    expect(first).toMatchObject({ status: 'uncertain', provider_invoice_id: null })
    expect(emulator.state().invoices).toHaveLength(0)

    // The first call may still land: it is not declared absent yet.
    expect((await pay(placed)).body.data.payment).toEqual({ state: 'preparing' })
    expect(emulator.state().invoices).toHaveLength(0)

    await postgres.query("update finance.payment_attempts set created_at = now() - interval '5 minutes' where id = $1", [first!.id])
    const recreated = await pay(placed)
    expect(recreated.status).toBe(200)
    expect(recreated.body.data.payment).toEqual({ state: 'ready', url: expect.stringMatching(INVOICE_URL) })
    const attempts = await attemptsOf(placed.orderId)
    expect(attempts.map((attempt) => attempt.status)).toEqual(['abandoned', 'pending'])
    const payable = emulator.state().invoices.filter((invoice) => invoice.status === 'initiated')
    expect(payable).toHaveLength(1)
    expect(payable[0]!.metadata.attempt_id).toBe(attempts[1]!.id)
    expect(attempts[1]!.provider_invoice_id).toBe(payable[0]!.id)
  })

  it('a 429 is unavailable and the attempt is failed; the next pay makes the invoice', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    await control('/fault', { route: CREATE_INVOICE, mode: '429', times: 1 })
    const placed = await place(variant)
    expect(placed.reply.status).toBe(201)
    expect(placed.payment).toEqual({ state: 'unavailable' })
    const [failed] = await attemptsOf(placed.orderId)
    expect(failed).toMatchObject({ status: 'failed', last_error: 'CREATE_RATE_LIMITED', provider_invoice_id: null })
    expect(failed!.next_check_at).toBeNull()
    expect(emulator.state().invoices).toHaveLength(0)
    // The order is still held and payable.
    expect((await orderOf(placed.orderId)).status).toBe('pending_payment')

    const retried = await pay(placed)
    expect(retried.body.data.payment).toEqual({ state: 'ready', url: expect.stringMatching(INVOICE_URL) })
    expect((await attemptsOf(placed.orderId)).map((attempt) => attempt.status)).toEqual(['failed', 'pending'])
    expect(emulator.state().invoices).toHaveLength(1)
  })
})

// --- paying -----------------------------------------------------------------------------------------------------

describe('the paid journey', () => {
  it('create, pay on the emulator, the webhook settles: the order is paid, the stock down once, one receipt; then pay and cancel only report it', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices

    const paid = await control('/pay', { invoiceId: invoice!.id, status: 'paid' })
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)
    expect(paid.body.deliveries.map((delivery: Row) => [delivery.kind, delivery.status])).toEqual([
      ['webhook', 200],
      ['callback', 200],
    ])
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'paid' })
    const [attempt] = await attemptsOf(placed.orderId)
    expect(attempt).toMatchObject({ status: 'paid', provider_payment_id: paid.body.payment.id, provider_invoice_id: invoice!.id, captured_halalas: placed.total })
    expect(await reservationStates(placed.orderId)).toEqual(['committed'])
    expect(await stockOf(variant)).toBe(9)
    expect(await receipts(placed.orderId)).toBe(1)

    // The page asking again is told the order is no longer payable, and the provider is not asked to do anything.
    const closed = await pay(placed)
    expect(closed.status).toBe(200)
    expect(closed.body.data.payment).toEqual({ state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'paid' })
    const cancelled = await cancel(placed)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data).toEqual({ status: 'paid' })
    expect(emulatorCalls(CANCEL_INVOICE)).toBe(0)
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
    expect(await stockOf(variant)).toBe(9)
  })
})

describe('cancel', () => {
  it('cancels a pending invoice at the provider: the invoice is canceled, the attempt cancelled, the order cancelled and its holds released', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices

    const cancelled = await cancel(placed)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(emulator.state().invoices.find((entry) => entry.id === invoice!.id)).toMatchObject({ status: 'canceled' })
    expect(emulatorCalls(CANCEL_INVOICE)).toBe(1)
    const [attempt] = await attemptsOf(placed.orderId)
    expect(attempt).toMatchObject({ status: 'cancelled', last_error: 'BUYER_CANCELLED', provider_invoice_id: invoice!.id })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'cancelled' })
    expect(await reservationStates(placed.orderId)).toEqual(['released'])
    expect(await stockOf(variant)).toBe(10)

    // Again: the same answer, and the provider is not asked again.
    expect((await cancel(placed)).body).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(emulatorCalls(CANCEL_INVOICE)).toBe(1)
    // A cancelled order cannot be paid: no invoice is made for it.
    expect((await pay(placed)).body.data.payment).toEqual({ state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'cancelled' })
    expect(emulatorCalls(CREATE_INVOICE)).toBe(1)
  })

  it('when the provider\'s cancel fails (500) the order stays held and payable: 409 PAYMENT_ACTIVE, nothing changed; a retry cancels', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices
    await control('/fault', { route: CANCEL_INVOICE, mode: '500', times: 1 })

    const busy = await cancel(placed)
    expect(busy.status).toBe(409)
    expect(busy.body.error).toEqual({ code: 'PAYMENT_ACTIVE', message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'pending_payment' })
    expect((await attemptsOf(placed.orderId))[0]).toMatchObject({ status: 'pending', provider_invoice_id: invoice!.id })
    expect(await reservationStates(placed.orderId)).toEqual(['held'])
    expect(emulator.state().invoices.find((entry) => entry.id === invoice!.id)).toMatchObject({ status: 'initiated' })
    // The buyer can still pay it.
    expect((await pay(placed)).body.data.payment).toEqual({ state: 'ready', url: placed.payment.url })

    expect((await cancel(placed)).body).toEqual({ ok: true, data: { status: 'cancelled' } })
    expect(emulator.state().invoices.find((entry) => entry.id === invoice!.id)).toMatchObject({ status: 'canceled' })
    expect(await reservationStates(placed.orderId)).toEqual(['released'])
  })

  it('an order whose invoice was just paid (no webhook, no callback) is settled by the cancel, which answers the paid status', async () => {
    emulator.config({ autoWebhook: false, autoCallback: false })
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices
    const paid = await control('/pay', { invoiceId: invoice!.id, status: 'paid' })
    expect(paid.body.deliveries).toEqual([])
    // Nobody told the store: it still believes the order waits.
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'pending_payment' })

    const answered = await cancel(placed)
    expect(answered.status).toBe(200)
    expect(answered.body).toEqual({ ok: true, data: { status: 'paid' } })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'paid' })
    expect((await attemptsOf(placed.orderId))[0]).toMatchObject({ status: 'paid', provider_payment_id: paid.body.payment.id, captured_halalas: placed.total })
    expect(await reservationStates(placed.orderId)).toEqual(['committed'])
    expect(await stockOf(variant)).toBe(9)
    expect(await receipts(placed.orderId)).toBe(1)
    // The provider refused the cancel of a paid invoice; the invoice is still paid, and nothing was cancelled.
    expect(emulator.state().invoices.find((entry) => entry.id === invoice!.id)).toMatchObject({ status: 'paid' })
    expect(emulatorCalls(CANCEL_INVOICE)).toBe(1)
    expect(emulator.state().calls.find((entry) => entry.route === CANCEL_INVOICE)?.status).toBe(400)
  })

  it('an invoice the provider calls canceled that still lists a paid payment is settled, never closed as cancelled: the answer is the paid status', async () => {
    emulator.config({ autoWebhook: false, autoCallback: false })
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices
    const paid = await control('/pay', { invoiceId: invoice!.id, status: 'paid' })
    // A payment that completed around the cancel: the cancel answers 200 canceled, and its reply lists the charge.
    await control('/invoice', { invoiceId: invoice!.id, status: 'canceled' })

    const answered = await cancel(placed)
    expect(answered.status).toBe(200)
    expect(answered.body).toEqual({ ok: true, data: { status: 'paid' } })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'paid' })
    expect((await attemptsOf(placed.orderId))[0]).toMatchObject({ status: 'paid', provider_payment_id: paid.body.payment.id, captured_halalas: placed.total })
    expect(await reservationStates(placed.orderId)).toEqual(['committed'])
    expect(await stockOf(variant)).toBe(9)
    expect(emulator.state().calls.find((entry) => entry.route === CANCEL_INVOICE)?.status).toBe(200)
  })

  it('a paid invoice whose payment cannot be fetched is neither cancelled nor answered as done: 409 PAYMENT_ACTIVE; the next cancel settles it', async () => {
    emulator.config({ autoWebhook: false, autoCallback: false })
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const [invoice] = emulator.state().invoices
    const paid = await control('/pay', { invoiceId: invoice!.id, status: 'paid' })
    await control('/fault', { route: FETCH_PAYMENT, mode: '500', times: 1 })

    // The payment is listed but the store could not read it, so nothing is settled: the buyer's card was charged and
    // the answer must not say the cancel went through.
    const busy = await cancel(placed)
    expect(busy.status).toBe(409)
    expect(busy.body.error).toEqual({ code: 'PAYMENT_ACTIVE', message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'pending_payment' })
    expect((await attemptsOf(placed.orderId))[0]).toMatchObject({ status: 'pending', provider_invoice_id: invoice!.id })
    expect(await reservationStates(placed.orderId)).toEqual(['held'])

    // The provider answers again: the same request settles the order and says what it is now.
    const settled = await cancel(placed)
    expect(settled.body).toEqual({ ok: true, data: { status: 'paid' } })
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'paid' })
    expect((await attemptsOf(placed.orderId))[0]).toMatchObject({ status: 'paid', provider_payment_id: paid.body.payment.id, captured_halalas: placed.total })
    expect(await stockOf(variant)).toBe(9)
  })

  it('a wrong token is 404 and cancels nothing', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const placed = await placeReady(variant)
    const wrong = await cancel({ number: placed.number, token: 'W'.repeat(43) })
    expect(wrong.status).toBe(404)
    expect(wrong.body.error.code).toBe('NOT_FOUND')
    expect(await orderOf(placed.orderId)).toMatchObject({ status: 'pending_payment' })
    expect(emulatorCalls(CANCEL_INVOICE)).toBe(0)
  })
})

// --- the hold ------------------------------------------------------------------------------------------------------

describe('a second create in the same checkout session', () => {
  it('is 409 ACTIVE_HOLD with the order and a working token for the buyer whose email it is; for anyone else only when the hold ends', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const first = await placeReady(variant)

    // Another request from the same tab (a new key, say after a reload that lost the stored order).
    const mine = await place(variant, { session: first.buyer.session, email: first.buyer.email })
    expect(mine.reply.status, JSON.stringify(mine.reply.body)).toBe(409)
    expect(mine.reply.body.error.code).toBe('ACTIVE_HOLD')
    expect(mine.reply.body.error.message).toBe('لديك طلب قيد الانتظار؛ أكمله أو ألغه أولًا.')
    const fields = mine.reply.body.error.fields
    expect(fields.order).toMatchObject({ orderNumber: first.number, status: 'pending_payment' })
    expect(fields.accessToken).toBe(first.token)
    // The hold's end, to the millisecond a JSON date keeps.
    expect(Math.abs(Date.parse(fields.holdExpiresAt) - (await orderOf(first.orderId)).hold_expires_at.getTime())).toBeLessThanOrEqual(1)

    // The token it handed back works: the page calls pay with it and gets the invoice of the held order.
    const resumed = await pay({ number: fields.order.orderNumber, token: fields.accessToken })
    expect(resumed.status).toBe(200)
    expect(resumed.body.data.payment).toEqual({ state: 'ready', url: first.payment.url })

    const stranger = await place(variant, { session: first.buyer.session })
    expect(stranger.reply.status).toBe(409)
    expect(stranger.reply.body.error.code).toBe('ACTIVE_HOLD')
    expect(Object.keys(stranger.reply.body.error.fields)).toEqual(['holdExpiresAt'])
    expect(JSON.stringify(stranger.reply.body)).not.toContain(first.token)

    // Neither made an order or an invoice.
    expect(emulator.state().invoices).toHaveLength(1)
    expect(await count('select count(*)::int as n from finance.orders where checkout_session = $1', [first.buyer.session])).toBe(1)
  })

  it('the same address in another session is a new order with its own invoice: there is no per-email hold', async () => {
    const variant = await makeVariant('physical', 4000, 10)
    const first = await placeReady(variant)
    const second = await placeReady(variant, { email: first.buyer.email })
    expect(second.number).not.toBe(first.number)
    expect(emulator.state().invoices).toHaveLength(2)
  })
})
