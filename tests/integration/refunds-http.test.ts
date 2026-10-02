// P08 round 6: the owner's refund actions through the REAL local `admin` Edge
// Function (Docker) and the reconciliation job through the real `outbox`
// function, against the Moyasar emulator started in this process on port 54390
// (the functions reach it as host.docker.internal:54390). Every owner is a real
// staff member with a real session: the money actions are called at aal2 with a
// fresh TOTP, enrolled and verified exactly as staff-admin.test.ts does (`stepUp`).
// The orders are created by SQL (`checkout_create`), bound to an emulator invoice
// and paid on the emulator, whose webhook settles them through the real
// `payments` function. What only the database could write (an aged refund, a due
// time) is written as the local `postgres` superuser. Nothing here reaches Moyasar.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved in
// beforeAll and restored in afterAll.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { moyasarClient, type MoyasarClient, type PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { orderAccessToken, orderAccessTokenHash, sha256Hex } from '../../supabase/functions/_shared/tokens.ts'
import { startEmulator, type Emulator } from '../support/moyasar-emulator.ts'
import { createStaff, localEnv, pgRpc, serviceRoleDb, signIn, status, stepUp, uniqueEmail, type Role } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const env = localEnv()
const FUNCTIONS_URL = status.FUNCTIONS_URL
const SITE = env.SITE_URL!
const PEPPER = env.TOKEN_HASH_PEPPER!
const WEBHOOK_SECRET = env.MOYASAR_WEBHOOK_SECRET!
const EMULATOR_PORT = 54390
const REV = { store: 1, delivery: 1, refund: 1 }
const OLDEST = "now() - interval '100 years'"
const REFUND_ROUTE = 'POST /v1/payments/:id/refund'

type Row = Record<string, any>

let postgres: Client
const pool: Client[] = []
let emulator: Emulator
let provider: MoyasarClient
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''
let counter = 0
const unique = (label: string): string => `${label}-${Date.now()}-${process.pid}-${(counter += 1)}`
const ipHash = (): Promise<string> => sha256Hex(unique('ip'))

type Member = { userId: string; email: string }
const staffMade: string[] = []
async function makeStaff(role: Role): Promise<Member> {
  const member = await createStaff(role)
  staffMade.push(member.userId)
  return member
}

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
const orderOf = (id: string): Promise<Row> => row('select * from finance.orders where id = $1', [id])
const attemptOf = (id: string): Promise<Row> => row('select * from finance.payment_attempts where id = $1', [id])
const refundOf = (id: string): Promise<Row> => row('select * from finance.refunds where id = $1', [id])
const refundsOf = (attemptId: string): Promise<Row[]> => rows('select * from finance.refunds where attempt_id = $1 order by created_at, id', [attemptId])
const confirmed = async (attemptId: string): Promise<number> =>
  count("select coalesce(sum(amount_halalas), 0)::int as n from finance.refunds where attempt_id = $1 and status = 'succeeded'", [attemptId])
const entitlementsOf = (orderId: string): Promise<Row[]> => rows('select * from finance.entitlements where order_id = $1', [orderId])
const mailsOf = (refundId: string): Promise<Row[]> => rows('select * from finance.email_outbox where dedupe_key = $1', [`order_refunded:${refundId}`])
const reviewOf = (paymentId: string): Promise<Row> => row('select * from finance.payment_reviews where provider_payment_id = $1', [paymentId])
/** The refund calls the emulator received, with the body each carried. */
const refundCalls = () => emulator.state().calls.filter((entry) => entry.route === REFUND_ROUTE)
const paymentOnEmulator = (paymentId: string) => emulator.state().payments.find((entry) => entry.id === paymentId)!

beforeAll(async () => {
  postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
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
  const emulatorConfig: PaymentsConfigOk = {
    ok: true,
    baseUrl: `${emulator.url}/v1`,
    secretKey: env.MOYASAR_SECRET_KEY!,
    webhookSecret: WEBHOOK_SECRET,
    mode: 'test',
    callbackBase: env.FUNCTIONS_PUBLIC_URL!,
    storageBase: `${new URL(env.FUNCTIONS_PUBLIC_URL!).origin}/storage/v1`,
  }
  provider = moyasarClient(emulatorConfig)

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
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  // Nothing of this run is left due for the reconciliation job or waiting in the outbox.
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  // By order and by review payment, not by date: a test that ages a refund moves its `created_at` before `startedAt`.
  await postgres.query(
    `delete from finance.refunds
      where created_at >= $2 or order_id = any($1::uuid[])
         or review_payment_id in (select provider_payment_id from finance.payment_reviews where created_at >= $2)`,
    [created.orders, startedAt],
  )
  await postgres.query('delete from finance.payment_events where received_at >= $1', [startedAt])
  await postgres.query(
    `update public.staff set active = false
      where user_id = any($1::uuid[])
        and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> all($1::uuid[]))`,
    [staffMade],
  )
  await postgres.query(
    "update finance.payment_reviews set closed_at = coalesce(closed_at, now()), closed_reason = coalesce(closed_reason, 'test cleanup') where created_at >= $1",
    [startedAt],
  )
  await postgres.query("delete from finance.email_outbox where kind = 'owner_alert' and created_at >= $1", [startedAt])
  await postgres.query("delete from finance.email_outbox where kind in ('receipt', 'order_refunded') and payload ->> 'orderId' = any($1::text[])", [created.orders])
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
  // Every test starts from an empty emulator with the configuration it was started with; a payment sends the webhook
  // (the real `payments` function settles the order from it) and no invoice callback.
  emulator.reset()
  emulator.config({ autoWebhook: true, autoCallback: false })
})

afterEach(async () => {
  // A refund a test left in flight must not wait for a later job run: its payment is gone from the emulator.
  await postgres.query("update finance.refunds set next_check_at = null where (created_at >= $1 or order_id = any($2::uuid[])) and status in ('submitting', 'uncertain')", [startedAt, created.orders])
})

// --- fixtures ------------------------------------------------------------------------------------------------

async function makeProduct(): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const id = (await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [slug, `منتج ${slug}`])).id as string
  created.products.push(id)
  return id
}
async function makeVariant(fulfillment: 'digital' | 'physical', price: number, stock: number | null): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock) values ($1, $2, $3, $4, $5, true, $6) returning id`,
      [await makeProduct(), sku, `خيار ${sku}`, fulfillment, price, stock],
    )
  ).id as string
}
async function makeRate(fee: number): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [key, `مدينة ${key}`, fee])
  created.rates.push(key)
  return key
}

type Placed = { id: string; number: string; total: number; hash: string }
/** Quotes the cart, then creates the order with the access token the running functions would derive (their pepper). */
async function place(variantId: string): Promise<Placed> {
  const lines = [{ variantId, quantity: 1 }]
  const priced = await call('checkout_quote', { p_ip_hash: await ipHash(), p_lines: lines, p_city_key: city, p_coupon_code: null })
  expect(priced.ok, JSON.stringify(priced)).toBe(true)
  const key = randomUUID()
  const hash = await orderAccessTokenHash(PEPPER, await orderAccessToken(PEPPER, key))
  const result = await call('checkout_create', {
    p_idempotency_key: key,
    p_request_hash: await sha256Hex(`request:${key}`),
    p_checkout_session: randomUUID(),
    p_ip_hash: await ipHash(),
    p_email: uniqueEmail('refund-buyer'),
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
  return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, hash }
}

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

async function control(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${emulator.url}/__emulator${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
async function payOnEmulator(invoiceId: string): Promise<any> {
  const paid = await control('/pay', { invoiceId, status: 'paid' })
  expect(paid.status, JSON.stringify(paid.body)).toBe(200)
  return paid.body
}

type Item = { id: string }
type Paid = { placed: Placed; attemptId: string; paymentId: string; items: Item[]; total: number; shipping: number }

/** An order placed, bound to an emulator invoice and paid there: the emulator's webhook settles it through the real function. */
async function paid(kind: 'digital' | 'physical'): Promise<Paid> {
  const placed = await place(kind === 'digital' ? await makeVariant('digital', 3500, null) : await makeVariant('physical', 4000, 10))
  const begun = await call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })
  expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, state: 'new' })
  const invoice = await provider.createInvoice(invoiceInput(placed, begun.attemptId, begun.amount, begun.expiresAt))
  if (!invoice.ok) throw new Error(`the emulator refused the invoice: ${invoice.kind}`)
  expect(
    await call('payment_attempt_created', { p_attempt: begun.attemptId, p_invoice_id: invoice.data.id, p_invoice_url: invoice.data.url, p_expires_at: null }),
  ).toEqual({ ok: true })
  const payment = await payOnEmulator(invoice.data.id)
  expect(await orderOf(placed.id)).toMatchObject({ status: 'paid' })
  expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: payment.payment.id })
  const items = (await rows('select id from finance.order_items where order_id = $1 order by line_no', [placed.id])).map((item) => ({ id: item.id as string }))
  return { placed, attemptId: begun.attemptId, paymentId: payment.payment.id, items, total: placed.total, shipping: Number((await orderOf(placed.id)).shipping_halalas) }
}

/** A real owner with a real session; `fresh` also verifies a TOTP (aal2, as the step-up dialog does). */
async function owner(fresh = true): Promise<{ member: Member; client: SupabaseClient }> {
  const member = await makeStaff('owner')
  const client = await signIn(member.email)
  if (fresh) await stepUp(client)
  return { member, client }
}
/** The owner of most tests: one session at aal2, made again before its TOTP is five minutes old (the auth rate limits count each sign-in). */
let stepped: { client: SupabaseClient; at: number } | undefined
async function freshOwner(): Promise<SupabaseClient> {
  if (!stepped || Date.now() - stepped.at > 4 * 60_000) stepped = { client: (await owner()).client, at: Date.now() }
  return stepped.client
}
/** An owner who never verified a TOTP: every action that needs a fresh one refuses it. */
let unverified: SupabaseClient | undefined
async function lazyOwner(): Promise<SupabaseClient> {
  unverified ??= (await owner(false)).client
  return unverified
}
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

const refundBody = (p: Paid, amount: number, allocation: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  action: 'refund-create',
  orderId: p.placed.id,
  attemptId: p.attemptId,
  amount,
  reason: 'عيب في الطباعة',
  allocation,
  idempotencyKey: randomUUID(),
  ...over,
})
const itemOf = (p: Paid, amount: number, shipping = 0) => ({ items: [{ itemId: p.items[0]!.id, amount }], shipping })

/** The reconciliation job, as `payments_kick` calls it. */
async function runJob(): Promise<{ status: number; body: any }> {
  const response = await fetch(`${FUNCTIONS_URL}/outbox`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.JOBS_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ job: 'payments_reconcile' }),
  })
  return { status: response.status, body: await response.json() }
}
/** Makes this file's refund the oldest due row of the whole table, so the job's claim takes it first. */
const makeDue = (refundId: string): Promise<unknown> => postgres.query(`update finance.refunds set next_check_at = ${OLDEST} where id = $1`, [refundId])
const age = (refundId: string, interval: string): Promise<unknown> =>
  postgres.query('update finance.refunds set created_at = now() - $2::interval where id = $1', [refundId, interval])
const fault = (mode: string, over: Record<string, unknown> = {}) => control('/fault', { route: REFUND_ROUTE, mode, times: 1, ...over })

// --- a full refund and two partial ones -------------------------------------------------------------------------

describe('refund-create against the emulator', () => {
  it('a full refund: one provider call carrying the amount, the order refunded, the entitlement revoked, the mail queued, an answer with three fields', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    const reply = await adminCall(client, refundBody(p, p.total, itemOf(p, p.total)))
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    expect(reply.body).toEqual({ ok: true, data: { refundId: expect.any(String), status: 'succeeded', amount: p.total } })

    const calls = refundCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ body: { amount: p.total }, status: 200 })
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ status: 'refunded', refunded: p.total })
    const refundId = reply.body.data.refundId as string
    expect(await refundOf(refundId)).toMatchObject({
      status: 'succeeded',
      amount_halalas: p.total,
      provider_refunded_before: 0,
      provider_refunded_after: p.total,
      source: 'admin',
      next_check_at: null,
    })
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'refunded' })
    expect(await attemptOf(p.attemptId)).toMatchObject({ status: 'paid', provider_refunded_halalas: p.total })
    expect((await entitlementsOf(p.placed.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
    expect(await mailsOf(refundId)).toHaveLength(1)
    // The answer says nothing about the provider: no payment id, no key.
    const text = JSON.stringify(reply.body)
    for (const secret of [p.paymentId, env.MOYASAR_SECRET_KEY!, WEBHOOK_SECRET, p.attemptId]) expect(text).not.toContain(secret)
  })

  it('two partial refunds: each reads the provider total first, the second carries on from the first, and the order is refunded only at the end', async () => {
    const p = await paid('physical') // 4 000 and 2 500 of shipping
    const client = await freshOwner()
    const first = await adminCall(client, refundBody(p, 1500, itemOf(p, 1500)))
    expect(first.body).toEqual({ ok: true, data: { refundId: expect.any(String), status: 'succeeded', amount: 1500 } })
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'paid' })
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ refunded: 1500 })

    const second = await adminCall(client, refundBody(p, 5000, itemOf(p, 2500, 2500)))
    expect(second.body).toEqual({ ok: true, data: { refundId: expect.any(String), status: 'succeeded', amount: 5000 } })
    expect(refundCalls().map((entry) => (entry.body as { amount: number }).amount)).toEqual([1500, 5000])
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ status: 'refunded', refunded: 6500 })
    expect(await confirmed(p.attemptId)).toBe(6500)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'refunded' })
    const all = await refundsOf(p.attemptId)
    expect(all.map((refund) => [refund.provider_refunded_before, refund.provider_refunded_after])).toEqual([[0, 1500], [1500, 6500]])
    // The provider was read before each refund: two payment fetches at least, ahead of each refund call.
    const routes = emulator.state().calls.map((entry) => entry.route)
    expect(routes.indexOf('GET /v1/payments/:id')).toBeLessThan(routes.indexOf(REFUND_ROUTE))
    // Nothing is left to refund.
    const third = await adminCall(client, refundBody(p, 1, itemOf(p, 1)))
    expect(third.status).toBe(409)
    expect(third.body.error.code).toBe('EXCEEDS_BALANCE')
    expect(refundCalls()).toHaveLength(2)
  })

  it('a replayed request (the same idempotency key) answers the same refund and the provider is asked once; another request under that key is a conflict', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    const body = refundBody(p, 1000, itemOf(p, 1000))
    const first = await adminCall(client, body)
    const second = await adminCall(client, body)
    expect(first.status).toBe(200)
    expect(second).toEqual(first)
    expect(refundCalls()).toHaveLength(1)
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ refunded: 1000 })
    const conflict = await adminCall(client, { ...body, amount: 1100, allocation: itemOf(p, 1100) })
    expect(conflict.status).toBe(409)
    expect(conflict.body).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } })
    expect(refundCalls()).toHaveLength(1)
    // The replay of a failed or in-flight refund is as stored too, and never reaches the provider again.
    const replayAfterwards = await adminCall(client, body)
    expect(replayAfterwards.body.data.status).toBe('succeeded')
    expect(refundCalls()).toHaveLength(1)
  })

  it('the provider\'s total is read first: when it cannot be read nothing is written and no refund is made (503)', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    // A fetch of the payment that fails: the emulator answers 500 to the one read the action makes.
    await control('/fault', { route: 'GET /v1/payments/:id', mode: '500', times: 1 })
    const refused = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(refused.status).toBe(503)
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } })
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
    expect(refundCalls()).toHaveLength(0)
    // Once it can be read the same request goes through.
    const done = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(done.status).toBe(200)
    expect(refundCalls()).toHaveLength(1)
  })

  it('the SQL\'s refusals reach the owner as stable codes and the provider is never asked: an allocation that does not add up, more than was paid, a payment that is not paid', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    const bad = await adminCall(client, refundBody(p, 1000, itemOf(p, 999)))
    expect(bad).toMatchObject({ status: 422, body: { ok: false, error: { code: 'INVALID_ALLOCATION' } } })
    const over = await adminCall(client, refundBody(p, p.total + 1, itemOf(p, p.total + 1)))
    expect(over).toMatchObject({ status: 409, body: { error: { code: 'EXCEEDS_BALANCE' } } })
    // A pending attempt has no payment to refund.
    const pending = await place(await makeVariant('digital', 3500, null))
    const begun = await call('payment_attempt_begin', { p_order_number: pending.number, p_access_token_hash: pending.hash, p_mode: 'test', p_ip_hash: null })
    const notPaid = await adminCall(client, { ...refundBody(p, 100, itemOf(p, 100)), orderId: pending.id, attemptId: begun.attemptId })
    expect(notPaid).toMatchObject({ status: 409, body: { error: { code: 'NOT_REFUNDABLE' } } })
    expect(await adminCall(client, { ...refundBody(p, 100, itemOf(p, 100)), attemptId: randomUUID() })).toMatchObject({ status: 404 })
    expect(refundCalls()).toHaveLength(0)
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
  })
})

// --- when the provider does not answer or refuses -----------------------------------------------------------------

describe('a refund the provider answers badly', () => {
  it('a refund cut after the provider committed: uncertain, the next refund is blocked with no provider call, and the job settles it from the total', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    await fault('drop_after_commit')
    const cut = await adminCall(client, refundBody(p, 1500, itemOf(p, 1500)))
    expect(cut.status).toBe(200)
    expect(cut.body.data).toEqual({ refundId: expect.any(String), status: 'uncertain', amount: 1500 })
    const refundId = cut.body.data.refundId as string
    expect(await refundOf(refundId)).toMatchObject({ status: 'uncertain', error: 'REFUND_UNCERTAIN' })
    // The provider did refund: the connection was cut after the change.
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ refunded: 1500 })
    expect(refundCalls()).toHaveLength(1)

    // Until the job settles it, no other refund of the payment starts, and the provider is not asked again.
    const blocked = await adminCall(client, refundBody(p, 500, itemOf(p, 500)))
    expect(blocked).toMatchObject({ status: 409, body: { error: { code: 'REFUND_IN_FLIGHT' } } })
    expect(refundCalls()).toHaveLength(1)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'paid' })
    expect(await confirmed(p.attemptId)).toBe(0)

    await makeDue(refundId)
    const run = await runJob()
    expect(run.status).toBe(200)
    expect(run.body.data[0].refunds).toBeGreaterThanOrEqual(1)
    // The run is recorded with counts only, the refunds among them.
    const recorded = await row("select detail from finance.job_runs where job = 'payments_reconcile' order by id desc limit 1")
    expect(recorded.detail.refunds).toBeGreaterThanOrEqual(1)
    expect(Object.values(recorded.detail).every((value) => typeof value === 'number')).toBe(true)
    expect(await refundOf(refundId)).toMatchObject({ status: 'succeeded', provider_refunded_before: 0, provider_refunded_after: 1500, next_check_at: null })
    expect(await confirmed(p.attemptId)).toBe(1500)
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 1500 })
    expect(await mailsOf(refundId)).toHaveLength(1)
    // Settled once: another run changes nothing, and the next refund goes through from the new total.
    const settled = await refundOf(refundId)
    await runJob()
    expect(await refundOf(refundId)).toEqual(settled)
    expect(await mailsOf(refundId)).toHaveLength(1)
    const next = await adminCall(client, refundBody(p, 500, itemOf(p, 500)))
    expect(next.body.data).toMatchObject({ status: 'succeeded', amount: 500 })
    expect(refundCalls()).toHaveLength(2)
  })

  it('a refund that times out and lands late: still uncertain while it has not landed (the job only backs off), settled once it has', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    // The connection is cut at once and the provider applies the refund 6 seconds later.
    await fault('commit_after_delay', { delayMs: 6000 })
    const cut = await adminCall(client, refundBody(p, 1200, itemOf(p, 1200)))
    expect(cut.body.data).toMatchObject({ status: 'uncertain', amount: 1200 })
    const refundId = cut.body.data.refundId as string
    expect(paymentOnEmulator(p.paymentId).refunded).toBe(0)

    await makeDue(refundId)
    expect((await runJob()).status).toBe(200)
    // Not applied yet and the refund is young: nothing changes but the schedule.
    expect(await refundOf(refundId)).toMatchObject({ status: 'uncertain', check_count: 1, provider_refunded_before: 0 })
    expect(await confirmed(p.attemptId)).toBe(0)
    expect(await row('select next_check_at > now() as ahead from finance.refunds where id = $1', [refundId])).toEqual({ ahead: true })

    // It lands.
    await vi.waitFor(() => expect(paymentOnEmulator(p.paymentId).refunded).toBe(1200), { timeout: 20_000, interval: 100 })
    await makeDue(refundId)
    await runJob()
    expect(await refundOf(refundId)).toMatchObject({ status: 'succeeded', provider_refunded_after: 1200 })
    expect(await confirmed(p.attemptId)).toBe(1200)
    expect(refundCalls()).toHaveLength(1)
  })

  it('a refund the provider never applied (a 500, then a 429): uncertain, then NOT_APPLIED once it is 15 minutes old, and the balance is free again', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    await fault('500')
    const first = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(first.body.data).toMatchObject({ status: 'uncertain' })
    const refundId = first.body.data.refundId as string
    expect(await refundOf(refundId)).toMatchObject({ status: 'uncertain', error: 'REFUND_UNCERTAIN' })
    expect(paymentOnEmulator(p.paymentId).refunded).toBe(0)

    // Young: the job leaves it in flight.
    await makeDue(refundId)
    await runJob()
    expect((await refundOf(refundId)).status).toBe('uncertain')
    // Old: the provider never applied it.
    await age(refundId, '16 minutes')
    await makeDue(refundId)
    await runJob()
    expect(await refundOf(refundId)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED', next_check_at: null })
    expect(await confirmed(p.attemptId)).toBe(0)

    // A 429 is uncertain too (it is never read as a refusal).
    await fault('429')
    const limited = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(limited.body.data).toMatchObject({ status: 'uncertain' })
    expect(await refundOf(limited.body.data.refundId)).toMatchObject({ error: 'REFUND_RATE_LIMITED' })
    await age(limited.body.data.refundId, '16 minutes')
    await makeDue(limited.body.data.refundId)
    await runJob()
    expect(await refundOf(limited.body.data.refundId)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    // Free: the next refund goes through.
    const ok = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(ok.body.data).toMatchObject({ status: 'succeeded' })
    expect(refundCalls()).toHaveLength(3)
  })

  it('a refund the provider refuses (a 4xx) is failed at once, never uncertain: the balance is free, and a replay does not ask again', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    // A voided payment cannot be refunded: the emulator answers 400.
    expect((await control('/payment', { paymentId: p.paymentId, status: 'voided' })).status).toBe(200)
    const body = refundBody(p, 1000, itemOf(p, 1000))
    const refused = await adminCall(client, body)
    expect(refused.status).toBe(200)
    expect(refused.body.data).toEqual({ refundId: expect.any(String), status: 'failed', amount: 1000 })
    expect(await refundOf(refused.body.data.refundId)).toMatchObject({ status: 'failed', error: 'REFUND_REFUSED', next_check_at: null })
    expect(refundCalls()).toHaveLength(1)
    expect(refundCalls()[0]).toMatchObject({ status: 400 })
    expect(await confirmed(p.attemptId)).toBe(0)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'paid' })
    // The same key is the same refund: answered as failed, the provider is not asked again.
    const replay = await adminCall(client, body)
    expect(replay.body.data).toEqual(refused.body.data)
    expect(refundCalls()).toHaveLength(1)
    // Another key is a new refund: the balance is free, and the provider refuses it again.
    const again = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(again.body.data.status).toBe('failed')
    expect(refundCalls()).toHaveLength(2)
  })

  it('a provider that refuses a second refund of a payment already refunded: the second is failed, the ledger and the provider agree', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    emulator.config({ refuseSecondRefund: true })
    const first = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(first.body.data.status).toBe('succeeded')
    const second = await adminCall(client, refundBody(p, 500, itemOf(p, 500)))
    expect(second.body.data).toMatchObject({ status: 'failed', amount: 500 })
    expect(paymentOnEmulator(p.paymentId).refunded).toBe(1000)
    expect(await confirmed(p.attemptId)).toBe(1000)
    // With the switch off and a partial refund keeping the payment paid, the provider takes the third.
    emulator.config({ refuseSecondRefund: false, partialRefundKeepsPaid: true })
    const third = await adminCall(client, refundBody(p, 500, itemOf(p, 500)))
    expect(third.body.data).toMatchObject({ status: 'succeeded' })
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ refunded: 1500 })
    expect(await confirmed(p.attemptId)).toBe(1500)
  })

  it('the owner\'s recheck settles an uncertain refund at once, from a fresh fetch; a settled refund is answered as stored', async () => {
    const p = await paid('physical')
    const client = await freshOwner()
    await fault('drop_after_commit')
    const cut = await adminCall(client, refundBody(p, 2000, itemOf(p, 2000)))
    const refundId = cut.body.data.refundId as string
    expect(cut.body.data.status).toBe('uncertain')
    // No fresh TOTP is needed for a recheck: it only reads the provider and settles what it holds.
    const lazy = { client: await lazyOwner() }
    const rechecked = await adminCall(lazy.client, { action: 'refund-recheck', refundId })
    expect(rechecked).toEqual({ status: 200, body: { ok: true, data: { refundId, status: 'succeeded', amount: 2000 } } })
    expect(await confirmed(p.attemptId)).toBe(2000)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'paid' })
    expect(await mailsOf(refundId)).toHaveLength(1)
    // Again: as stored, nothing more happens.
    const again = await adminCall(lazy.client, { action: 'refund-recheck', refundId })
    expect(again.body.data).toEqual({ refundId, status: 'succeeded', amount: 2000 })
    expect(await mailsOf(refundId)).toHaveLength(1)
    expect((await adminCall(lazy.client, { action: 'refund-recheck', refundId: randomUUID() })).status).toBe(404)
    expect((await adminCall(lazy.client, { action: 'refund-recheck', refundId: 'nope' })).status).toBe(422)
    // A refund still in flight whose payment cannot be read stays in flight (503), and the recheck decides nothing.
    await fault('drop_after_commit')
    const second = await adminCall(client, refundBody(p, 500, itemOf(p, 500), { reason: 'مرة أخرى' }))
    const secondId = second.body.data.refundId as string
    await control('/fault', { route: 'GET /v1/payments/:id', mode: '500', times: 1 })
    const unreadable = await adminCall(lazy.client, { action: 'refund-recheck', refundId: secondId })
    expect(unreadable.status).toBe(503)
    expect((await refundOf(secondId)).status).toBe('uncertain')
  })
})

// --- a refund made behind our back --------------------------------------------------------------------------------

describe('a refund made at the provider behind our back', () => {
  it('PROVIDER_AHEAD blocks the next refund, the owner records it, then the refunds go on; a void is recorded for what is left', async () => {
    const p = await paid('digital') // 3 500
    const client = await freshOwner()
    // A refund of 1 200 from Moyasar's dashboard.
    expect((await control('/payment', { paymentId: p.paymentId, refunded: 1200 })).status).toBe(200)
    const blocked = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(blocked).toMatchObject({ status: 409, body: { error: { code: 'PROVIDER_AHEAD' } } })
    expect(refundCalls()).toHaveLength(0)
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 1200 })

    const recorded = await adminCall(client, { action: 'refund-record-external', attemptId: p.attemptId, reason: 'استرداد من لوحة بوابة الدفع' })
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
    expect(recorded.body.data).toEqual({ refundId: expect.any(String), status: 'succeeded', amount: 1200 })
    expect(await refundOf(recorded.body.data.refundId)).toMatchObject({ source: 'provider_dashboard', allocation: {}, amount_halalas: 1200, provider_refunded_before: 0, provider_refunded_after: 1200 })
    expect(await confirmed(p.attemptId)).toBe(1200)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'paid' })
    // Nothing more to record, and the provider was not asked to refund anything.
    const none = await adminCall(client, { action: 'refund-record-external', attemptId: p.attemptId, reason: 'مرة ثانية' })
    expect(none).toMatchObject({ status: 409, body: { error: { code: 'NO_DELTA' } } })
    expect(refundCalls()).toHaveLength(0)

    // Now the refunds go on from the provider's total.
    const next = await adminCall(client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(next.body.data).toMatchObject({ status: 'succeeded', amount: 1000 })
    expect(refundCalls().map((entry) => (entry.body as { amount: number }).amount)).toEqual([1000])
    expect(paymentOnEmulator(p.paymentId)).toMatchObject({ refunded: 2200 })

    // The rest is voided at the dashboard: recorded as the whole unrefunded amount, and the order is refunded.
    expect((await control('/payment', { paymentId: p.paymentId, status: 'voided' })).status).toBe(200)
    const voided = await adminCall(client, { action: 'refund-record-external', attemptId: p.attemptId, reason: 'أُلغيت الدفعة من لوحة بوابة الدفع' })
    expect(voided.body.data).toMatchObject({ status: 'succeeded', amount: 1300 })
    expect(await confirmed(p.attemptId)).toBe(3500)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'refunded' })
    expect((await entitlementsOf(p.placed.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
  })

  it('a refund that landed after it was declared NOT_APPLIED is adopted by the owner with its own allocation', async () => {
    const p = await paid('digital')
    const client = await freshOwner()
    await fault('500')
    const lost = await adminCall(client, refundBody(p, 3500, itemOf(p, 3500)))
    const refundId = lost.body.data.refundId as string
    await age(refundId, '16 minutes')
    await makeDue(refundId)
    await runJob()
    expect(await refundOf(refundId)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    // It lands after all (a dashboard-side retry of the call).
    expect((await control('/payment', { paymentId: p.paymentId, refunded: 3500 })).status).toBe(200)
    expect(await adminCall(client, refundBody(p, 100, itemOf(p, 100)))).toMatchObject({ status: 409, body: { error: { code: 'PROVIDER_AHEAD' } } })
    const adopted = await adminCall(client, { action: 'refund-record-external', attemptId: p.attemptId, reason: 'وصل الاسترداد متأخرًا' })
    expect(adopted.body.data).toEqual({ refundId, status: 'succeeded', amount: 3500 })
    expect(await refundOf(refundId)).toMatchObject({ status: 'succeeded', source: 'admin', allocation: itemOf(p, 3500) })
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(await orderOf(p.placed.id)).toMatchObject({ status: 'refunded' })
  })
})

// --- review payments ---------------------------------------------------------------------------------------------

describe('a payment that no order maps to', () => {
  it('the webhook files it as a review payment; the owner refunds it by its own id, in parts, and the review is closed when it is all refunded', async () => {
    // An invoice on the emulator that no attempt maps to, paid there: the real function files the payment for review.
    const invoice = await provider.createInvoice({
      amount: 4000,
      currency: 'SAR',
      description: 'دفعة بلا طلب',
      callback_url: `${env.FUNCTIONS_PUBLIC_URL}/payments/callback`,
      success_url: `${SITE}/checkout/return?order=ABCD2345`,
      back_url: `${SITE}/checkout/return?order=ABCD2345`,
      expired_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      metadata: {},
    })
    if (!invoice.ok) throw new Error('the emulator refused the invoice')
    const payment = await payOnEmulator(invoice.data.id)
    const paymentId = payment.payment.id as string
    expect(await reviewOf(paymentId)).toMatchObject({ reason: 'UNMAPPED_INVOICE', amount_halalas: 4000, order_id: null, closed_at: null })

    const client = await freshOwner()
    const first = await adminCall(client, { action: 'refund-create', reviewPaymentId: paymentId, amount: 1500, reason: 'دفعة بلا طلب', allocation: {}, idempotencyKey: randomUUID() })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.data).toEqual({ refundId: expect.any(String), status: 'succeeded', amount: 1500 })
    expect(refundCalls()).toHaveLength(1)
    expect(await refundOf(first.body.data.refundId)).toMatchObject({ review_payment_id: paymentId, attempt_id: null, order_id: null })
    expect(await reviewOf(paymentId)).toMatchObject({ provider_refunded_halalas: 1500, closed_at: null })
    expect(await mailsOf(first.body.data.refundId)).toHaveLength(0)

    const rest = await adminCall(client, { action: 'refund-create', reviewPaymentId: paymentId, amount: 2500, reason: 'الباقي', allocation: {}, idempotencyKey: randomUUID() })
    expect(rest.body.data).toMatchObject({ status: 'succeeded', amount: 2500 })
    expect(paymentOnEmulator(paymentId)).toMatchObject({ refunded: 4000, status: 'refunded' })
    const closed = await reviewOf(paymentId)
    expect(closed).toMatchObject({ provider_refunded_halalas: 4000, closed_reason: 'refunded' })
    expect(closed.closed_at).not.toBeNull()
    // A review payment's allocation is {}: items are refused, and a refund beyond its amount too.
    const items = await adminCall(client, { action: 'refund-create', reviewPaymentId: paymentId, amount: 1, reason: 'x', allocation: { shipping: 1 }, idempotencyKey: randomUUID() })
    expect(items.status).toBe(409)
    expect(items.body.error.code).toBe('NOT_REFUNDABLE')
  })
})

// --- who may ------------------------------------------------------------------------------------------------------

describe('who may refund', () => {
  it('an editor and operations are refused all three actions; an owner without a fresh TOTP is refused the two that move money; nothing is written or sent', async () => {
    const p = await paid('digital')
    const bodies = [
      refundBody(p, 1000, itemOf(p, 1000)),
      { action: 'refund-record-external', attemptId: p.attemptId, reason: 'استرداد يدوي' },
      { action: 'refund-recheck', refundId: randomUUID() },
    ]
    for (const role of ['editor', 'operations'] as const) {
      const member = await makeStaff(role)
      const client = await signIn(member.email)
      for (const body of bodies) {
        const refused = await adminCall(client, body)
        expect(refused.status, `${role} ${String(body.action)}`).toBe(403)
        expect(refused.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      }
    }
    const stale = await lazyOwner()
    for (const body of bodies.slice(0, 2)) {
      const refused = await adminCall(stale, body)
      expect(refused.status, String(body.action)).toBe(403)
      expect(refused.body).toMatchObject({ error: { code: 'STEP_UP_REQUIRED' } })
    }
    expect((await adminCall(stale, bodies[2]!)).status).toBe(404)
    expect(refundCalls()).toHaveLength(0)
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
    // No session at all.
    const anonymous = await fetch(`${FUNCTIONS_URL}/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: status.PUBLISHABLE_KEY },
      body: JSON.stringify(bodies[0]),
    })
    expect([401, 403]).toContain(anonymous.status)
    // An owner revoked a moment ago is refused at once, with the session still valid: the staff lookup gives no role.
    const revoked = await owner()
    await postgres.query('update public.staff set active = false where user_id = $1', [revoked.member.userId])
    const refused = await adminCall(revoked.client, refundBody(p, 1000, itemOf(p, 1000)))
    expect(refused.status).toBe(403)
    expect(refundCalls()).toHaveLength(0)
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
  })
})
