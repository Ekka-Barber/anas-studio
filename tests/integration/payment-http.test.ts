// P08 round 3: the REAL local Edge Functions over HTTP (`payments`, `outbox`,
// `admin`) with the Moyasar emulator started in this process on port 54390. The
// functions run in Docker and reach it as host.docker.internal:54390 (their
// MOYASAR_API_BASE_URL); the emulator sends the webhook and the invoice callback
// to the functions. Nothing here reaches Moyasar. The orders are created by SQL
// (`checkout_create`, like payment.test.ts); an attempt is bound to an emulator
// invoice by creating the invoice on the emulator and `payment_attempt_created`
// through SQL, except in the startPayment cases, which call the real invoice
// step in this process against the same emulator. What only the owner or the
// database could write (an aged row, a due time) is written as the local
// `postgres` superuser. The claim of the reconciliation job is shared with
// every other writer of due rows, so every assertion is about rows this file
// made, and each row it wants the job to take is made the oldest due one.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved in
// beforeAll and restored in afterAll.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { startPayment, type PaymentDeps } from '../../supabase/functions/_shared/payments.ts'
import { moyasarClient, type MoyasarClient, type PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { orderAccessToken, orderAccessTokenHash, sha256Hex } from '../../supabase/functions/_shared/tokens.ts'
import { startEmulator, type Emulator } from '../support/moyasar-emulator.ts'
import { createStaff, localEnv, pgRpc, serviceRoleDb, signIn, status, uniqueEmail, type Role } from './support'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const env = localEnv()
const FUNCTIONS_URL = status.FUNCTIONS_URL
const SITE = env.SITE_URL!
const PEPPER = env.TOKEN_HASH_PEPPER!
const WEBHOOK_SECRET = env.MOYASAR_WEBHOOK_SECRET!
const EMULATOR_PORT = 54390
const REV = { store: 1, delivery: 1, refund: 1 }
const OLDEST = "now() - interval '100 years'"

type Row = Record<string, any>

let postgres: Client
const pool: Client[] = []
let emulator: Emulator
let provider: MoyasarClient
let emulatorConfig: PaymentsConfigOk
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''
let counter = 0
const unique = (label: string): string => `${label}-${Date.now()}-${process.pid}-${(counter += 1)}`
const sha = async (text: string): Promise<string> => sha256Hex(text)
const ipHash = (): Promise<string> => sha(unique('ip'))

type Member = { userId: string; email: string }
const staffMade: string[] = []
async function makeStaff(role: Role): Promise<Member> {
  const member = await createStaff(role)
  staffMade.push(member.userId)
  return member
}
let ownerUser: Member
let editorUser: Member
let operationsUser: Member

const created = { products: [] as string[], rates: [] as string[], orders: [] as string[] }

const call = (fn: string, args: Record<string, unknown>): Promise<any> => pgRpc(pool[0]!)(fn, args) as Promise<any>
async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await postgres.query(sql, params)).rows
}
async function row(sql: string, params: unknown[] = []): Promise<Row> {
  const found = await rows(sql, params)
  expect(found, sql).toHaveLength(1)
  return found[0]!
}
const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await row(sql, params)).n)
const attemptOf = (id: string): Promise<Row> => row('select * from finance.payment_attempts where id = $1', [id])
const orderOf = (id: string): Promise<Row> => row('select * from finance.orders where id = $1', [id])
const stockOf = async (variantId: string): Promise<number | null> =>
  (await row('select stock from public.product_variants where id = $1', [variantId])).stock
const receipts = (orderId: string): Promise<number> =>
  count("select count(*)::int as n from finance.email_outbox where kind = 'receipt' and dedupe_key = $1", [`receipt:${orderId}`])
const entitlements = (orderId: string): Promise<number> =>
  count('select count(*)::int as n from finance.entitlements where order_id = $1', [orderId])
const reviewOf = (paymentId: string): Promise<Row[]> => rows('select * from finance.payment_reviews where provider_payment_id = $1', [paymentId])
const eventOf = (eventId: string): Promise<Row[]> => rows('select * from finance.payment_events where event_id = $1', [eventId])

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  for (let i = 0; i < 2; i += 1) pool.push(await serviceRoleDb())
  startedAt = (await row('select now() as t')).t

  try {
    emulator = await startEmulator({
      port: EMULATOR_PORT,
      webhookUrl: `${FUNCTIONS_URL}/payments/webhook`,
      webhookSecret: WEBHOOK_SECRET,
      secretKey: env.MOYASAR_SECRET_KEY!,
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'EADDRINUSE') {
      throw new Error(`Port ${EMULATOR_PORT} is busy: stop whatever holds it (a running \`pnpm emulator\`?) and run this file again.`)
    }
    throw error
  }
  // The invoice step runs in this process (startPayment), so it reads the site from the environment like the functions do.
  vi.stubEnv('SITE_URL', SITE)
  emulatorConfig = {
    ok: true,
    baseUrl: `${emulator.url}/v1`,
    secretKey: env.MOYASAR_SECRET_KEY!,
    webhookSecret: WEBHOOK_SECRET,
    mode: 'test',
    callbackBase: env.FUNCTIONS_PUBLIC_URL!,
    storageBase: `${new URL(env.FUNCTIONS_PUBLIC_URL!).origin}/storage/v1`,
  }
  provider = moyasarClient(emulatorConfig)

  ownerUser = await makeStaff('owner')
  editorUser = await makeStaff('editor')
  operationsUser = await makeStaff('operations')
  settingsSaved = await row(
    'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
  )
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع', seller_address = 'تبوك',
       seller_registration = 'REG-P08', policy_revisions = $1::jsonb where id = 1`,
    [JSON.stringify(REV)],
  )
  // The buckets the functions take from: the whole-store daily one, and the callback, verify and pay throttles of this machine's address.
  await postgres.query("delete from finance.rate_limits where bucket in ('checkout:all', 'payment-callback:ip', 'payment-check:ip', 'payment-pay:ip')")
  city = await makeRate(2500)
})

afterAll(async () => {
  await emulator?.close()
  vi.unstubAllEnvs()
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  // Nothing of this run is left due for the reconciliation job or waiting in the outbox.
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  await postgres.query('delete from finance.payment_events where received_at >= $1', [startedAt])
  await postgres.query(
    `update public.staff set active = false
      where user_id = any($1::uuid[])
        and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> all($1::uuid[]))`,
    [staffMade],
  )
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
  for (const client of pool) await client.end()
  await postgres.end()
})

beforeEach(() => {
  // Every test starts from an empty emulator with the configuration it was started with: the webhook goes to the real
  // function, with the right secret, and every payment sends it and the invoice callback.
  emulator.reset()
})

// --- fixtures ------------------------------------------------------------------------------------------------

async function makeProduct(): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const id = (
    await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [
      slug,
      `منتج ${slug}`,
    ])
  ).id as string
  created.products.push(id)
  return id
}

async function makeVariant(fulfillment: 'digital' | 'physical', price: number, stock: number | null): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock)
       values ($1, $2, $3, $4, $5, true, $6) returning id`,
      [await makeProduct(), sku, `خيار ${sku}`, fulfillment, price, stock],
    )
  ).id as string
}

async function makeRate(fee: number): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [
    key,
    `مدينة ${key}`,
    fee,
  ])
  created.rates.push(key)
  return key
}

type Placed = { id: string; number: string; total: number; token: string; hash: string; variantId: string }

/** Quotes the cart, then creates the order with the access token the running functions would derive (their pepper). */
async function place(variantId: string): Promise<Placed> {
  const lines = [{ variantId, quantity: 1 }]
  const priced = await call('checkout_quote', { p_ip_hash: await ipHash(), p_lines: lines, p_city_key: city, p_coupon_code: null })
  expect(priced.ok, JSON.stringify(priced)).toBe(true)
  const key = randomUUID()
  const token = await orderAccessToken(PEPPER, key)
  const hash = await orderAccessTokenHash(PEPPER, token)
  const result = await call('checkout_create', {
    p_idempotency_key: key,
    p_request_hash: await sha(`request:${key}`),
    p_checkout_session: randomUUID(),
    p_ip_hash: await ipHash(),
    p_email: uniqueEmail('payer'),
    p_name: 'مشترٍ',
    p_phone: '966501234567',
    p_lines: lines,
    p_city_key: city,
    p_address: 'تبوك شارع الرئيسي',
    p_coupon_code: null,
    p_policy_revisions: REV,
    p_quote_hash: priced.quoteHash,
    p_access_token_hash: hash,
    p_environment: 'test',
  })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  created.orders.push(result.order.id)
  return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, token, hash, variantId }
}
/** One digital line: an order with nothing to count but its entitlement. */
const digital = async (): Promise<Placed> => place(await makeVariant('digital', 3500, null))
/** One physical line with stock, so a settle that ran twice would show in the stock. */
const physical = async (): Promise<Placed> => place(await makeVariant('physical', 4000, 10))

type Bound = { attemptId: string; invoiceId: string; invoiceUrl: string; placed: Placed }

const invoiceInput = (placed: Placed, attemptId: string, amount: number, expiresAt: string) => ({
  amount,
  currency: 'SAR',
  description: `طلب ${placed.number}`,
  callback_url: `${env.FUNCTIONS_PUBLIC_URL}/payments/callback`,
  success_url: `${SITE}/checkout/return?order=${placed.number}`,
  back_url: `${SITE}/checkout/return?order=${placed.number}`,
  expired_at: new Date(expiresAt).toISOString(),
  metadata: { order_number: placed.number, attempt_id: attemptId },
})

const begin = (placed: Placed): Promise<any> =>
  call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })

/** An attempt bound to an invoice on the emulator: the state `startPayment` leaves after a good create. */
async function bind(placed: Placed): Promise<Bound> {
  const begun = await begin(placed)
  expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, state: 'new' })
  const invoice = await provider.createInvoice(invoiceInput(placed, begun.attemptId, begun.amount, begun.expiresAt))
  if (!invoice.ok) throw new Error(`the emulator refused the invoice: ${invoice.kind}`)
  const mapped = await call('payment_attempt_created', {
    p_attempt: begun.attemptId,
    p_invoice_id: invoice.data.id,
    p_invoice_url: invoice.data.url,
    p_expires_at: null,
  })
  expect(mapped).toEqual({ ok: true })
  return { attemptId: begun.attemptId, invoiceId: invoice.data.id, invoiceUrl: invoice.data.url, placed }
}

async function control(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${emulator.url}/__emulator${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
/** A payment on the emulator, as the hosted page would make it; the emulator sends the webhook and the callback as configured. */
async function payOnEmulator(invoiceId: string, extra: Record<string, unknown> = {}): Promise<any> {
  const paid = await control('/pay', { invoiceId, status: 'paid', ...extra })
  expect(paid.status, JSON.stringify(paid.body)).toBe(200)
  return paid.body
}
const prompts = (autoWebhook: boolean, autoCallback: boolean): void => void emulator.config({ autoWebhook, autoCallback })

/** The reconciliation job, as `payments_kick` calls it. */
async function runJob(): Promise<{ status: number; body: any }> {
  const response = await fetch(`${FUNCTIONS_URL}/outbox`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.JOBS_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ job: 'payments_reconcile' }),
  })
  return { status: response.status, body: await response.json() }
}
/** Makes this file's attempt the oldest due row of the whole table, so the job's claim takes it first. */
const makeDue = (attemptId: string): Promise<unknown> =>
  postgres.query(`update finance.payment_attempts set next_check_at = ${OLDEST} where id = $1`, [attemptId])

const inProcess = (): PaymentDeps => ({ rpc: pgRpc(pool[1]!), client: provider, config: emulatorConfig })
const startFor = (placed: Placed) =>
  startPayment(inProcess(), { orderNumber: placed.number, accessTokenHash: placed.hash, ipHash: null })

async function postWebhook(body: unknown): Promise<Response> {
  return fetch(`${FUNCTIONS_URL}/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function verify(placed: Placed, withToken: boolean): Promise<{ status: number; body: any }> {
  const response = await fetch(`${FUNCTIONS_URL}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body: JSON.stringify({ action: 'verify', orderNumber: placed.number, ...(withToken ? { accessToken: placed.token } : {}) }),
  })
  return { status: response.status, body: await response.json() }
}
/** The 5-second rule keeps a second caller from fetching what the first just fetched; a test that verifies twice in a row lifts it. */
const liftFetchedRule = (attemptId: string): Promise<unknown> =>
  postgres.query('update finance.payment_attempts set fetched_at = null where id = $1', [attemptId])

async function adminCall(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const { data } = await client.auth.getSession()
  const response = await fetch(`${FUNCTIONS_URL}/admin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: status.PUBLISHABLE_KEY,
      authorization: `Bearer ${data.session!.access_token}`,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

// --- the webhook ---------------------------------------------------------------------------------------------

describe('the webhook, from the emulator, to the real function', () => {
  it('a paid payment through the emulator\'s own webhook settles the order: one attempt paid, one receipt, the stock down once', async () => {
    prompts(true, false)
    const placed = await physical()
    const bound = await bind(placed)
    const before = (await stockOf(placed.variantId))!
    const paid = await payOnEmulator(bound.invoiceId)

    expect(paid.deliveries).toHaveLength(1)
    expect(paid.deliveries[0]).toMatchObject({ kind: 'webhook', type: 'payment_paid', status: 200 })
    expect(await orderOf(placed.id)).toMatchObject({ status: 'paid' })
    expect(await attemptOf(bound.attemptId)).toMatchObject({
      status: 'paid',
      provider_invoice_id: bound.invoiceId,
      provider_payment_id: paid.payment.id,
      captured_halalas: placed.total,
      provider_status: 'paid',
    })
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(before - 1)
    // The event is durable and closed with what happened; the webhook was only a prompt: the provider was asked.
    const event = (await eventOf(paid.deliveries[0].eventId))[0]!
    expect(event).toMatchObject({ outcome: 'paid', live: false, type: 'payment_paid', provider_payment_id: paid.payment.id })
    expect(event.processed_at).not.toBeNull()
    expect(event.payload_hash).toMatch(/^[0-9a-f]{64}$/)
    const routes = emulator.state().calls.map((entry) => entry.route)
    expect(routes).toEqual(expect.arrayContaining(['GET /v1/payments/:id', 'GET /v1/invoices/:id']))
  })

  it('a forged secret_token is 401 and records no event; a body missing a field is 422 and records none', async () => {
    const paymentId = randomUUID()
    const forgedId = unique('forged')
    const forged = await control('/webhook', { paymentId, type: 'payment_paid', secretToken: 'forged-secret', eventId: forgedId })
    expect(forged.body.deliveries[0].status).toBe(401)
    expect(await eventOf(forgedId)).toHaveLength(0)

    const missingId = unique('malformed')
    const malformed = await postWebhook({ id: missingId, type: 'payment_paid', live: false })
    expect(malformed.status).toBe(422)
    const wrongType = await postWebhook({ id: missingId, type: 'payment_paid', secret_token: 5, live: false })
    expect(wrongType.status).toBe(422)
    expect(await eventOf(missingId)).toHaveLength(0)
    expect(emulator.state().calls).toHaveLength(0)
  })

  it('a forged webhook for a real payment settles nothing: the order stays unpaid', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    const forged = await control('/webhook', { paymentId: paid.payment.id, type: 'payment_paid', secretToken: 'forged-secret', eventId: unique('forged') })
    expect(forged.body.deliveries[0].status).toBe(401)
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    expect((await attemptOf(bound.attemptId)).status).toBe('pending')
  })

  it('a wrong live flag never settles: the event is closed mode_mismatch, and the provider is not asked', async () => {
    emulator.config({ live: true, autoCallback: false })
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    expect(paid.deliveries[0]).toMatchObject({ kind: 'webhook', status: 200 })
    const event = (await eventOf(paid.deliveries[0].eventId))[0]!
    expect(event).toMatchObject({ outcome: 'mode_mismatch', live: true })
    expect(event.processed_at).not.toBeNull()
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    expect((await attemptOf(bound.attemptId)).status).toBe('pending')
    expect(await receipts(placed.id)).toBe(0)
    expect(emulator.state().calls.filter((entry) => entry.route.startsWith('GET /v1/payments'))).toHaveLength(0)
  })

  it('a webhook for a payment id the emulator does not hold is closed unknown_payment', async () => {
    const eventId = unique('unknown')
    const sent = await control('/webhook', { paymentId: randomUUID(), type: 'payment_paid', eventId })
    expect(sent.body.deliveries[0].status).toBe(200)
    const event = (await eventOf(eventId))[0]!
    expect(event).toMatchObject({ outcome: 'unknown_payment' })
    expect(event.processed_at).not.toBeNull()
  })

  it('an event with no payment id, or another type, is closed without the provider', async () => {
    const noPayment = unique('nopay')
    expect((await control('/webhook', { type: 'payment_paid', eventId: noPayment })).body.deliveries[0].status).toBe(200)
    expect((await eventOf(noPayment))[0]).toMatchObject({ outcome: 'no_payment_id' })
    const other = unique('other')
    expect((await control('/webhook', { paymentId: randomUUID(), type: 'balance_transferred', eventId: other })).body.deliveries[0].status).toBe(200)
    expect((await eventOf(other))[0]).toMatchObject({ outcome: 'ignored' })
    expect(emulator.state().calls).toHaveLength(0)
  })

  it.each([
    ['amount', (total: number) => ({ amount: total - 100 }), 'AMOUNT_MISMATCH'],
    ['currency', () => ({ currency: 'USD' }), 'CURRENCY_MISMATCH'],
  ])('a payment with another %s becomes a review payment, never a paid order', async (_label, override, reason) => {
    prompts(true, false)
    const placed = await physical()
    const bound = await bind(placed)
    const before = await stockOf(placed.variantId)
    const paid = await payOnEmulator(bound.invoiceId, override(placed.total))
    expect(paid.deliveries[0].status).toBe(200)
    expect((await eventOf(paid.deliveries[0].eventId))[0]).toMatchObject({ outcome: 'review' })
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    expect(await attemptOf(bound.attemptId)).toMatchObject({ status: 'review', provider_payment_id: paid.payment.id })
    const review = (await reviewOf(paid.payment.id))[0]!
    expect(review).toMatchObject({ reason, order_id: placed.id, attempt_id: bound.attemptId })
    expect(review.closed_at).toBeNull()
    expect(await receipts(placed.id)).toBe(0)
    expect(await stockOf(placed.variantId)).toBe(before)
  })

  it.each(['initiated', 'authorized', 'verified', 'failed', 'voided'])('a payment that is %s never marks the order paid', async (statusName) => {
    prompts(true, false)
    const placed = await digital()
    const bound = await bind(placed)
    const sent = await payOnEmulator(bound.invoiceId, { status: statusName })
    // `initiated` makes no webhook of its own: send it, as the provider could.
    const eventId = sent.deliveries[0]?.eventId ?? unique('initiated')
    if (sent.deliveries.length === 0) {
      expect((await control('/webhook', { paymentId: sent.payment.id, type: 'payment_initiated', eventId })).body.deliveries[0].status).toBe(200)
    }
    expect((await eventOf(eventId))[0]).toMatchObject({ outcome: 'not_paid' })
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    expect((await attemptOf(bound.attemptId)).status).toBe('pending')
    expect(await reviewOf(sent.payment.id)).toHaveLength(0)
    expect(await receipts(placed.id)).toBe(0)
    expect(await entitlements(placed.id)).toBe(0)
  })

  it('the same webhook sent five times settles once', async () => {
    prompts(false, false)
    const placed = await physical()
    const bound = await bind(placed)
    const before = (await stockOf(placed.variantId))!
    const paid = await payOnEmulator(bound.invoiceId)
    const eventId = unique('five')
    const sent = await control('/webhook', { paymentId: paid.payment.id, type: 'payment_paid', eventId, times: 5 })
    expect(sent.body.deliveries.map((delivery: Row) => delivery.status)).toEqual([200, 200, 200, 200, 200])
    expect(await eventOf(eventId)).toHaveLength(1)
    expect((await eventOf(eventId))[0]).toMatchObject({ outcome: 'paid' })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(before - 1)
    // Only the first delivery asked the provider.
    expect(emulator.state().calls.filter((entry) => entry.route === 'GET /v1/payments/:id')).toHaveLength(1)
  })

  it('the same webhook sent five times at once settles once', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    const eventId = unique('atonce')
    const body = { id: eventId, type: 'payment_paid', created_at: new Date().toISOString(), secret_token: WEBHOOK_SECRET, account_name: 'x', live: false, data: paid.payment }
    const answers = await Promise.all(Array.from({ length: 5 }, () => postWebhook(body)))
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200])
    expect(await eventOf(eventId)).toHaveLength(1)
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await attemptOf(bound.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id })
    expect(await receipts(placed.id)).toBe(1)
    expect(await entitlements(placed.id)).toBe(1)
  })

  it('five different events for one payment at once, the callback and a verify besides, still settle once', async () => {
    prompts(false, false)
    const placed = await physical()
    const bound = await bind(placed)
    const before = (await stockOf(placed.variantId))!
    const paid = await payOnEmulator(bound.invoiceId)
    const hook = (): Promise<Response> =>
      postWebhook({ id: unique('burst'), type: 'payment_paid', secret_token: WEBHOOK_SECRET, live: false, data: { id: paid.payment.id } })
    const callback = (): Promise<Response> =>
      fetch(`${FUNCTIONS_URL}/payments/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: bound.invoiceId }) })
    const [h1, h2, h3, h4, h5, cb, check] = await Promise.all([hook(), hook(), hook(), hook(), hook(), callback(), verify(placed, true)])
    expect([h1, h2, h3, h4, h5, cb].map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(check.status).toBe(200)
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(before - 1)
    expect(await count("select count(*)::int as n from finance.payment_attempts where order_id = $1 and status = 'paid'", [placed.id])).toBe(1)
  })

  it('a failed event arriving after the paid one changes nothing', async () => {
    prompts(true, false)
    const placed = await physical()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    expect((await orderOf(placed.id)).status).toBe('paid')
    const attemptBefore = await attemptOf(bound.attemptId)
    const stockBefore = await stockOf(placed.variantId)

    const failed = await payOnEmulator(bound.invoiceId, { status: 'failed', force: true })
    expect(failed.deliveries[0]).toMatchObject({ type: 'payment_failed', status: 200 })
    expect((await eventOf(failed.deliveries[0].eventId))[0]).toMatchObject({ outcome: 'not_paid' })
    expect(await orderOf(placed.id)).toMatchObject({ status: 'paid' })
    const attemptAfter = await attemptOf(bound.attemptId)
    expect(attemptAfter).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id, provider_status: 'paid' })
    expect(attemptAfter.updated_at).toEqual(attemptBefore.updated_at)
    expect(attemptAfter.paid_at).toEqual(attemptBefore.paid_at)
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(stockBefore)
  })
})

// --- the other prompts ---------------------------------------------------------------------------------------

describe('the invoice callback and the return page\'s verify', () => {
  it('with the webhook off, the invoice callback alone settles the order', async () => {
    prompts(false, true)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    expect(paid.deliveries).toHaveLength(1)
    expect(paid.deliveries[0]).toMatchObject({ kind: 'callback', status: 200 })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await attemptOf(bound.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id })
    expect(await entitlements(placed.id)).toBe(1)
    expect(await receipts(placed.id)).toBe(1)
  })

  it('a callback for an unknown invoice, or with a body that is not an invoice, is 200 and settles nothing', async () => {
    const answers = [
      await fetch(`${FUNCTIONS_URL}/payments/callback`, { method: 'POST', body: JSON.stringify({ id: randomUUID() }) }),
      await fetch(`${FUNCTIONS_URL}/payments/callback`, { method: 'POST', body: 'not json' }),
      await fetch(`${FUNCTIONS_URL}/payments/callback`, { method: 'POST', body: JSON.stringify({ id: 'x/../y' }) }),
    ]
    for (const answer of answers) {
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual({ ok: true })
    }
    expect(emulator.state().calls).toHaveLength(0)
  })

  it('with both prompts off, verify settles it and answers paid; without the token it answers the state only', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)

    const withToken = await verify(placed, true)
    expect(withToken).toEqual({
      status: 200,
      body: { ok: true, data: { state: 'pending', hasToken: true, invoiceUrl: bound.invoiceUrl, testMode: true } },
    })
    await liftFetchedRule(bound.attemptId)
    const withoutToken = await verify(placed, false)
    expect(withoutToken.body).toEqual({ ok: true, data: { state: 'pending', hasToken: false, testMode: true } })
    expect(withoutToken.body.data).not.toHaveProperty('invoiceUrl')

    await payOnEmulator(bound.invoiceId)
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    await liftFetchedRule(bound.attemptId)
    const settled = await verify(placed, false)
    expect(settled.status).toBe(200)
    expect(settled.body).toEqual({ ok: true, data: { state: 'paid', hasToken: false, testMode: true } })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await attemptOf(bound.attemptId)).toMatchObject({ status: 'paid' })
    expect(await receipts(placed.id)).toBe(1)

    const again = await verify(placed, true)
    expect(again.body).toEqual({ ok: true, data: { state: 'paid', hasToken: true, testMode: true } })
  })

  it('verify answers unknown for an order that does not exist, the same shape as for any other, and refuses a foreign origin', async () => {
    const placed = await digital()
    const ghost = await fetch(`${FUNCTIONS_URL}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify({ action: 'verify', orderNumber: 'ZZZZ2345' }),
    })
    expect(ghost.status).toBe(200)
    expect(await ghost.json()).toEqual({ ok: true, data: { state: 'unknown', hasToken: false, testMode: true } })
    const foreign = await fetch(`${FUNCTIONS_URL}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
      body: JSON.stringify({ action: 'verify', orderNumber: placed.number }),
    })
    expect(foreign.status).toBe(403)
    expect(emulator.state().calls).toHaveLength(0)
  })

  it('a wrong token is not a token: no invoice URL, hasToken false', async () => {
    prompts(false, false)
    const placed = await digital()
    await bind(placed)
    const response = await fetch(`${FUNCTIONS_URL}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify({ action: 'verify', orderNumber: placed.number, accessToken: 'W'.repeat(43) }),
    })
    expect(await response.json()).toEqual({ ok: true, data: { state: 'pending', hasToken: false, testMode: true } })
  })
})

// --- the reconciliation job ----------------------------------------------------------------------------------

describe('the reconciliation job (POST /outbox {"job":"payments_reconcile"})', () => {
  it('needs the jobs bearer, and answers the same shape as the other jobs', async () => {
    const forged = await fetch(`${FUNCTIONS_URL}/outbox`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ job: 'payments_reconcile' }),
    })
    expect(forged.status).toBe(401)
    const run = await runJob()
    expect(run.status).toBe(200)
    expect(run.body.ok).toBe(true)
    expect(run.body.data).toHaveLength(1)
    expect(run.body.data[0]).toMatchObject({ job: 'payments_reconcile' })
    expect(['ok', 'partial', 'failed']).toContain(run.body.data[0].status)
    for (const key of ['attempts', 'events', 'settled', 'cancelled', 'errors', 'skipped']) expect(typeof run.body.data[0][key]).toBe('number')
    // Recorded for the owner home, counts only.
    const recorded = await row("select * from finance.job_runs where job = 'payments_reconcile' and finished_at >= $1 order by id desc limit 1", [startedAt])
    expect(Object.values(recorded.detail).every((value) => typeof value === 'number')).toBe(true)
  })

  it('settles a pending attempt whose prompts were all lost, and running it again changes nothing', async () => {
    prompts(false, false)
    const placed = await physical()
    const bound = await bind(placed)
    const before = (await stockOf(placed.variantId))!
    const paid = await payOnEmulator(bound.invoiceId)
    expect(paid.deliveries).toHaveLength(0)
    expect((await orderOf(placed.id)).status).toBe('pending_payment')

    await makeDue(bound.attemptId)
    const first = await runJob()
    expect(first.status).toBe(200)
    expect((await orderOf(placed.id)).status).toBe('paid')
    const settledAttempt = await attemptOf(bound.attemptId)
    expect(settledAttempt).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id, captured_halalas: placed.total })
    expect(settledAttempt.next_check_at).toBeNull()
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(before - 1)

    const order = await orderOf(placed.id)
    const second = await runJob()
    expect(second.status).toBe(200)
    expect(await orderOf(placed.id)).toEqual(order)
    expect(await attemptOf(bound.attemptId)).toEqual(settledAttempt)
    expect(await receipts(placed.id)).toBe(1)
    expect(await stockOf(placed.variantId)).toBe(before - 1)
  })

  it('an event recorded but never processed is processed by the job', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    const eventId = unique('lost')
    expect(
      await call('payment_event_record', { p_event_id: eventId, p_type: 'payment_paid', p_live: false, p_payment_id: paid.payment.id, p_payload_hash: null }),
    ).toEqual({ state: 'recorded' })
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    await postgres.query(`update finance.payment_events set next_check_at = ${OLDEST} where event_id = $1`, [eventId])

    const run = await runJob()
    expect(run.status).toBe(200)
    const event = (await eventOf(eventId))[0]!
    expect(event).toMatchObject({ outcome: 'paid' })
    expect(event.processed_at).not.toBeNull()
    expect(event.next_check_at).toBeNull()
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await receipts(placed.id)).toBe(1)
  })

  it('an event of the other mode is closed by the job and settles nothing', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    const eventId = unique('otherlive')
    await call('payment_event_record', { p_event_id: eventId, p_type: 'payment_paid', p_live: true, p_payment_id: paid.payment.id, p_payload_hash: null })
    await postgres.query(`update finance.payment_events set next_check_at = ${OLDEST} where event_id = $1`, [eventId])
    await runJob()
    expect((await eventOf(eventId))[0]).toMatchObject({ outcome: 'mode_mismatch' })
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
  })

  it('adopts an uncertain attempt when the emulator holds its invoice: one invoice, mapped, never a second', async () => {
    const placed = await digital()
    const begun = await begin(placed)
    const invoice = await provider.createInvoice(invoiceInput(placed, begun.attemptId, begun.amount, begun.expiresAt))
    if (!invoice.ok) throw new Error('the emulator refused the invoice')
    // The creation call answered nothing: the attempt is uncertain and old enough to be resolved.
    await postgres.query("update finance.payment_attempts set status = 'uncertain', created_at = now() - interval '5 minutes' where id = $1", [begun.attemptId])
    await makeDue(begun.attemptId)

    expect((await runJob()).status).toBe(200)
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'pending', provider_invoice_id: invoice.data.id, invoice_url: invoice.data.url })
    expect(emulator.state().invoices.filter((entry) => entry.metadata.attempt_id === begun.attemptId)).toHaveLength(1)
    expect(emulator.state().calls.filter((entry) => entry.route === 'POST /v1/invoices')).toHaveLength(1)
  })

  it('abandons an uncertain attempt the emulator does not hold, and never begins a new one itself', async () => {
    const placed = await digital()
    const begun = await begin(placed)
    await postgres.query("update finance.payment_attempts set status = 'uncertain', created_at = now() - interval '5 minutes' where id = $1", [begun.attemptId])
    await makeDue(begun.attemptId)

    expect((await runJob()).status).toBe(200)
    const attempt = await attemptOf(begun.attemptId)
    expect(attempt).toMatchObject({ status: 'abandoned', provider_invoice_id: null })
    expect(attempt.next_check_at).toBeNull()
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [placed.id])).toBe(1)
    expect(emulator.state().calls.filter((entry) => entry.route === 'POST /v1/invoices')).toHaveLength(0)
    // The order can still be paid: the buyer's next `pay` begins a new attempt.
    expect(await begin(placed)).toMatchObject({ ok: true, state: 'new' })
  })

  it('leaves a young uncertain attempt alone: the creation may still land', async () => {
    const placed = await digital()
    const begun = await begin(placed)
    await postgres.query("update finance.payment_attempts set status = 'uncertain' where id = $1", [begun.attemptId])
    await makeDue(begun.attemptId)
    expect((await runJob()).status).toBe(200)
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'uncertain' })
  })

  it('cancels, at the provider, the pending invoice of an order another attempt already paid', async () => {
    prompts(false, false)
    const placed = await digital()
    const first = await bind(placed)
    // A second invoice for the same order, as a late 201 or a reissue would leave: map it to its own attempt.
    await postgres.query("update finance.payment_attempts set status = 'abandoned', next_check_at = null where id = $1", [first.attemptId])
    const second = await bind(placed)
    const paid = await payOnEmulator(first.invoiceId, { force: true })
    // The first attempt is abandoned but its invoice still pays (late payment): it settles the order, and the second is cancelled.
    await postgres.query(`update finance.payment_attempts set next_check_at = ${OLDEST} where id = $1`, [first.attemptId])
    await runJob()
    expect(await attemptOf(first.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id })
    expect((await orderOf(placed.id)).status).toBe('paid')
    // The paid apply made the other active attempt due at once; the job cancels its invoice.
    await makeDue(second.attemptId)
    await runJob()
    expect(await attemptOf(second.attemptId)).toMatchObject({ status: 'cancelled' })
    expect(emulator.state().invoices.find((entry) => entry.id === second.invoiceId)).toMatchObject({ status: 'canceled' })
    expect(await receipts(placed.id)).toBe(1)
  })
})

// --- the invoice step against the emulator -------------------------------------------------------------------

describe('startPayment against the emulator', () => {
  it('creates one invoice and returns its URL; asking again returns the same URL and creates nothing', async () => {
    const placed = await digital()
    const first = await startFor(placed)
    expect(first).toMatchObject({ kind: 'ok', payment: { state: 'ready' } })
    const url = (first as { payment: { url: string } }).payment.url
    const [invoice] = emulator.state().invoices
    expect(emulator.state().invoices).toHaveLength(1)
    expect(invoice).toMatchObject({
      amount: placed.total,
      currency: 'SAR',
      description: `طلب ${placed.number}`,
      callback_url: `${env.FUNCTIONS_PUBLIC_URL}/payments/callback`,
      success_url: `${SITE}/checkout/return?order=${placed.number}`,
      back_url: `${SITE}/checkout/return?order=${placed.number}`,
      metadata: { order_number: placed.number },
      url,
    })
    expect(Object.keys(invoice!.metadata).sort()).toEqual(['attempt_id', 'order_number'])
    const attempt = await row('select * from finance.payment_attempts where order_id = $1', [placed.id])
    expect(attempt).toMatchObject({ status: 'pending', provider_invoice_id: invoice!.id, invoice_url: url })
    expect(invoice!.metadata.attempt_id).toBe(attempt.id)

    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'ready', url } })
    expect(emulator.state().invoices).toHaveLength(1)
  })

  it('a wrong token is not found, and the provider is never called', async () => {
    const placed = await digital()
    expect(await startPayment(inProcess(), { orderNumber: placed.number, accessTokenHash: await sha('wrong'), ipHash: null })).toEqual({ kind: 'not_found' })
    expect(emulator.state().calls).toHaveLength(0)
  })

  it('a refused create (the provider says 4xx) closes the attempt failed: unavailable', async () => {
    const placed = await digital()
    // The emulator refuses an amount under 100 halalas; a 401 is the same kind of refusal.
    const badKey = moyasarClient({ baseUrl: `${emulator.url}/v1`, secretKey: 'sk_test_wrong' })
    const result = await startPayment({ ...inProcess(), client: badKey }, { orderNumber: placed.number, accessTokenHash: placed.hash, ipHash: null })
    expect(result).toMatchObject({ kind: 'ok', payment: { state: 'unavailable' } })
    const attempt = await row('select * from finance.payment_attempts where order_id = $1', [placed.id])
    expect(attempt).toMatchObject({ status: 'failed', last_error: 'CREATE_REFUSED', provider_invoice_id: null })
    expect(attempt.next_check_at).toBeNull()
  })

  it('a create the provider answers 429 closes the attempt failed: unavailable', async () => {
    const placed = await digital()
    await control('/fault', { route: 'POST /v1/invoices', mode: '429', times: 1 })
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'unavailable' } })
    expect(await row('select * from finance.payment_attempts where order_id = $1', [placed.id])).toMatchObject({ status: 'failed', last_error: 'CREATE_RATE_LIMITED' })
  })

  it('a create that is cut after the provider committed is preparing; the next call adopts that invoice: exactly one invoice for the attempt', async () => {
    const placed = await digital()
    await control('/fault', { route: 'POST /v1/invoices', mode: 'drop_after_commit', times: 1 })
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'preparing' } })
    const attempt = await row('select * from finance.payment_attempts where order_id = $1', [placed.id])
    expect(attempt).toMatchObject({ status: 'uncertain', last_error: 'CREATE_UNCERTAIN', provider_invoice_id: null })
    expect(emulator.state().invoices).toHaveLength(1)

    const second = await startFor(placed)
    expect(second).toMatchObject({ kind: 'ok', payment: { state: 'ready' } })
    const mine = emulator.state().invoices.filter((entry) => entry.metadata.attempt_id === attempt.id)
    expect(mine).toHaveLength(1)
    expect(emulator.state().invoices).toHaveLength(1)
    expect((second as { payment: { url: string } }).payment.url).toBe(mine[0]!.url)
    expect(await attemptOf(attempt.id)).toMatchObject({ status: 'pending', provider_invoice_id: mine[0]!.id })
    expect(emulator.state().calls.filter((entry) => entry.route === 'POST /v1/invoices')).toHaveLength(1)
  })

  it('a provider that drops the metadata is never trusted: its invoice is not adopted, and the old attempt is abandoned', async () => {
    emulator.config({ dropInvoiceMetadata: true })
    const placed = await digital()
    await control('/fault', { route: 'POST /v1/invoices', mode: 'drop_after_commit', times: 1 })
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'preparing' } })
    const attempt = await row('select * from finance.payment_attempts where order_id = $1', [placed.id])
    const orphan = emulator.state().invoices[0]!
    expect(orphan.metadata).toEqual({})

    // Young: the creation might still land, so nothing is decided.
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'preparing' } })
    expect(await attemptOf(attempt.id)).toMatchObject({ status: 'uncertain', provider_invoice_id: null })
    // Old: nothing claims to be this attempt's, so it is abandoned and a new one is begun.
    await postgres.query("update finance.payment_attempts set created_at = now() - interval '5 minutes' where id = $1", [attempt.id])
    const third = await startFor(placed)
    expect(third).toMatchObject({ kind: 'ok', payment: { state: 'ready' } })
    expect(await attemptOf(attempt.id)).toMatchObject({ status: 'abandoned', provider_invoice_id: null })
    const next = await row("select * from finance.payment_attempts where order_id = $1 and status = 'pending'", [placed.id])
    expect(next.id).not.toBe(attempt.id)
    expect(next.provider_invoice_id).not.toBe(orphan.id)
    expect(await count('select count(*)::int as n from finance.payment_attempts where provider_invoice_id = $1', [orphan.id])).toBe(0)
    expect(emulator.state().invoices).toHaveLength(2)
  })

  it('a provider that ignores the metadata filter is never trusted: foreign invoices are not adopted', async () => {
    emulator.config({ ignoreMetadataFilter: true })
    // Two other orders' invoices, with the very same amount, are on the account.
    const foreign = [await bind(await digital()), await bind(await digital())]
    const placed = await digital()
    await control('/fault', { route: 'POST /v1/invoices', mode: '500', times: 1 })
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'preparing' } })
    const attempt = await row('select * from finance.payment_attempts where order_id = $1', [placed.id])
    expect(attempt).toMatchObject({ status: 'uncertain' })
    expect(emulator.state().invoices).toHaveLength(2)

    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'preparing' } })
    expect(await attemptOf(attempt.id)).toMatchObject({ status: 'uncertain', provider_invoice_id: null })
    await postgres.query("update finance.payment_attempts set created_at = now() - interval '5 minutes' where id = $1", [attempt.id])
    expect(await startFor(placed)).toMatchObject({ kind: 'ok', payment: { state: 'ready' } })
    expect(await attemptOf(attempt.id)).toMatchObject({ status: 'abandoned', provider_invoice_id: null })
    // The foreign invoices stay with their own attempts.
    for (const other of foreign) {
      expect(await count('select count(*)::int as n from finance.payment_attempts where provider_invoice_id = $1', [other.invoiceId])).toBe(1)
      expect((await attemptOf(other.attemptId)).provider_invoice_id).toBe(other.invoiceId)
    }
    expect(emulator.state().invoices).toHaveLength(3)
  })
})

// --- the owner's recheck, through the real admin function ----------------------------------------------------

describe('payment-recheck through the real admin function', () => {
  it('an owner settles a pending attempt whose prompts were lost, and an editor or an operations member is refused', async () => {
    prompts(false, false)
    const placed = await digital()
    const bound = await bind(placed)
    const paid = await payOnEmulator(bound.invoiceId)
    expect((await orderOf(placed.id)).status).toBe('pending_payment')

    for (const member of [editorUser, operationsUser]) {
      const refused = await adminCall(await signIn(member.email), { action: 'payment-recheck', attemptId: bound.attemptId })
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    }
    expect((await orderOf(placed.id)).status).toBe('pending_payment')

    const owner = await signIn(ownerUser.email)
    const rechecked = await adminCall(owner, { action: 'payment-recheck', attemptId: bound.attemptId })
    expect(rechecked.status).toBe(200)
    expect(rechecked.body).toEqual({ ok: true, data: { status: 'paid' } })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await attemptOf(bound.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: paid.payment.id })
    expect(await receipts(placed.id)).toBe(1)

    // Again: nothing changes, the status is the same.
    expect((await adminCall(owner, { action: 'payment-recheck', attemptId: bound.attemptId })).body).toEqual({ ok: true, data: { status: 'paid' } })
    expect(await receipts(placed.id)).toBe(1)
  })

  it('an unknown attempt is 404, a malformed id is 422, and no session is 401', async () => {
    const owner = await signIn(ownerUser.email)
    expect((await adminCall(owner, { action: 'payment-recheck', attemptId: randomUUID() })).status).toBe(404)
    expect((await adminCall(owner, { action: 'payment-recheck', attemptId: 'nope' })).status).toBe(422)
    const anonymous = await fetch(`${FUNCTIONS_URL}/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: status.PUBLISHABLE_KEY },
      body: JSON.stringify({ action: 'payment-recheck', attemptId: randomUUID() }),
    })
    expect([401, 403]).toContain(anonymous.status)
  })

  it('an uncertain attempt is adopted by the recheck when the emulator holds its invoice, and abandoned when it does not', async () => {
    const adopted = await digital()
    const begun = await begin(adopted)
    const invoice = await provider.createInvoice(invoiceInput(adopted, begun.attemptId, begun.amount, begun.expiresAt))
    if (!invoice.ok) throw new Error('the emulator refused the invoice')
    await postgres.query("update finance.payment_attempts set status = 'uncertain', created_at = now() - interval '5 minutes' where id = $1", [begun.attemptId])
    const owner = await signIn(ownerUser.email)
    expect((await adminCall(owner, { action: 'payment-recheck', attemptId: begun.attemptId })).body).toEqual({ ok: true, data: { status: 'pending' } })
    expect(await attemptOf(begun.attemptId)).toMatchObject({ provider_invoice_id: invoice.data.id })

    const absent = await digital()
    const lost = await begin(absent)
    await postgres.query("update finance.payment_attempts set status = 'uncertain', created_at = now() - interval '5 minutes' where id = $1", [lost.attemptId])
    expect((await adminCall(owner, { action: 'payment-recheck', attemptId: lost.attemptId })).body).toEqual({ ok: true, data: { status: 'abandoned' } })
  })

  it('status tells the owner payments are configured, in test mode, on an emulator: booleans and the mode only', async () => {
    const owner = await signIn(ownerUser.email)
    const reply = await adminCall(owner, { action: 'status' })
    expect(reply.status).toBe(200)
    expect(reply.body.data.payments).toEqual({ configured: true, mode: 'test', emulator: true })
    const text = JSON.stringify(reply.body)
    for (const secret of [env.MOYASAR_SECRET_KEY!, WEBHOOK_SECRET, 'host.docker.internal']) expect(text).not.toContain(secret)
    expect((await adminCall(await signIn(editorUser.email), { action: 'status' })).status).toBe(403)
  })
})
