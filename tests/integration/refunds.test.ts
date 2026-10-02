// P08 round 6: the refund functions of `supabase/migrations/20261002130000_refunds.sql`
// against the real local database: `refund_request`, `refund_result`, `refund_settle`,
// `refund_checked`, `refund_record_external` and `refund_ref`, and the success effects
// they share. The server-only functions are called as `service_role` (the Edge
// Functions' role, D32) through direct sessions; every order goes through
// `checkout_create` and is paid by `apply_verified_payment`, like payment.test.ts.
// What only the owner or the database could write (an aged refund, a received
// return, a lowered stock) is written as the local `postgres` superuser. Nothing
// here reaches Moyasar: the provider's refunded total is a number the test hands over.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved in
// beforeAll and restored in afterAll; every fixture carries a per-run unique slug,
// SKU, code, email or payment id.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { anonClient, createStaff, pgRpc, serviceRoleDb, signIn, uniqueEmail, type Role } from './support'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const PEPPER = `refund-pepper-${randomUUID()}`
const REV = { store: 1, delivery: 1, refund: 1 }
const ZERO = '0'.repeat(64)

type Row = Record<string, any>

function tokenFor(idempotencyKey: string): string {
  return createHmac('sha256', PEPPER).update(`order-access:${idempotencyKey}`).digest('base64url')
}
const hashFor = (token: string): string => createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex')
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

let postgres: Client
/** Six `service_role` sessions: the main one plus the concurrency tests' own connections. */
const pool: Client[] = []
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''

type Member = { userId: string; email: string }
const staffMade: string[] = []
async function makeStaff(role: Role, overrides: { active?: boolean } = {}): Promise<Member> {
  const member = await createStaff(role, overrides)
  staffMade.push(member.userId)
  return member
}
let ownerUser: Member
let editorUser: Member
let operationsUser: Member
let revokedOwner: Member
let editorClient: SupabaseClient

const created = { products: [] as string[], rates: [] as string[], coupons: [] as string[], orders: [] as string[] }

let counter = 0
function unique(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}
const ipHash = (): string => sha256(unique('ip'))

const call = (fn: string, args: Record<string, unknown>, client: Client = pool[0]!): Promise<any> => pgRpc(client)(fn, args) as Promise<any>

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
const stockOf = async (variantId: string): Promise<number | null> => (await row('select stock from public.product_variants where id = $1', [variantId])).stock
const confirmed = async (attemptId: string): Promise<number> =>
  count("select coalesce(sum(amount_halalas), 0)::int as n from finance.refunds where attempt_id = $1 and status = 'succeeded'", [attemptId])
const secondsAhead = async (refundId: string): Promise<number> =>
  Number((await row('select extract(epoch from (next_check_at - now())) as s from finance.refunds where id = $1', [refundId])).s)
const age = (refundId: string, interval: string): Promise<unknown> =>
  postgres.query('update finance.refunds set created_at = now() - $2::interval where id = $1', [refundId, interval])
const mailsOf = (refundId: string): Promise<Row[]> => rows('select * from finance.email_outbox where dedupe_key = $1', [`order_refunded:${refundId}`])
const alerts = (alert: string, refundId: string): Promise<number> =>
  count("select count(*)::int as n from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1", [`${alert}:${refundId}:%`])
const audits = (action: string, refundId: string): Promise<Row[]> =>
  rows('select * from public.audit_events where action = $1 and entity = $2 and entity_id = $3 order by id', [action, 'refund', refundId])
const owners = (): Promise<number> =>
  count("select count(*)::int as n from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'owner' and u.email is not null")
const entitlementsOf = (orderId: string): Promise<Row[]> =>
  rows('select e.*, i.line_no from finance.entitlements e join finance.order_items i on i.id = e.order_item_id where e.order_id = $1 order by i.line_no', [orderId])

beforeAll(async () => {
  postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  await postgres.connect()
  for (let i = 0; i < 6; i += 1) pool.push(await serviceRoleDb())
  startedAt = (await row('select now() as t')).t
  ownerUser = await makeStaff('owner')
  editorUser = await makeStaff('editor')
  operationsUser = await makeStaff('operations')
  revokedOwner = await makeStaff('owner', { active: false })
  editorClient = await signIn(editorUser.email)
  settingsSaved = await row(
    'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
  )
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع', seller_address = 'تبوك',
       seller_registration = 'REG-P08', policy_revisions = $1::jsonb where id = 1`,
    [JSON.stringify(REV)],
  )
  // The whole-store daily bucket (500 a day) is shared by every run on this machine.
  await postgres.query("delete from finance.rate_limits where bucket = 'checkout:all'")
  city = await makeRate(2500)
})

afterAll(async () => {
  // Fixtures cannot be deleted (orders reference them), so they leave the local store: products archived, city rates
  // and coupons disabled, nothing of this run left due for the reconciliation job or waiting in the outbox.
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  await postgres.query('update public.coupons set enabled = false where id = any($1::uuid[])', [created.coupons])
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  await postgres.query('update finance.return_requests set refund_id = null where order_id = any($1::uuid[])', [created.orders])
  // By order and by review payment, not by date: a test that ages a refund moves its `created_at` before `startedAt`.
  await postgres.query(
    `delete from finance.refunds
      where created_at >= $2 or order_id = any($1::uuid[])
         or review_payment_id in (select provider_payment_id from finance.payment_reviews where created_at >= $2)`,
    [created.orders, startedAt],
  )
  await postgres.query('delete from finance.return_requests where order_id = any($1::uuid[])', [created.orders])
  await postgres.query(
    "update finance.payment_reviews set closed_at = coalesce(closed_at, now()), closed_reason = coalesce(closed_reason, 'test cleanup') where created_at >= $1",
    [startedAt],
  )
  await postgres.query("delete from finance.email_outbox where kind = 'owner_alert' and created_at >= $1", [startedAt])
  await postgres.query("delete from finance.email_outbox where kind in ('receipt', 'order_refunded') and payload ->> 'orderId' = any($1::text[])", [created.orders])
  // (Only while another owner remains: a database that has none keeps this run's.)
  await postgres.query(
    `update public.staff set active = false
      where user_id = any($1::uuid[])
        and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> all($1::uuid[]))`,
    [staffMade],
  )
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

// --- fixtures ---------------------------------------------------------------------------------------------------

async function makeProduct(): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const id = (await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [slug, `منتج ${slug}`])).id as string
  created.products.push(id)
  return id
}

type VariantSpec = { fulfillment: 'digital' | 'physical' | 'signed'; price: number; stock?: number | null; preorder?: { capacity: number } }

async function makeVariant(productId: string, spec: VariantSpec): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, preorder, preorder_capacity, preorder_ships_on, preorder_note)
       values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10) returning id`,
      [
        productId,
        sku,
        `خيار ${sku}`,
        spec.fulfillment,
        spec.price,
        spec.stock ?? null,
        spec.preorder !== undefined,
        spec.preorder?.capacity ?? null,
        spec.preorder ? '2030-01-01' : null,
        spec.preorder ? 'يصلك بعد الطباعة' : null,
      ],
    )
  ).id as string
}
const digital = async (price = 3500): Promise<string> => makeVariant(await makeProduct(), { fulfillment: 'digital', price })
const physical = async (price: number, stock: number): Promise<string> => makeVariant(await makeProduct(), { fulfillment: 'physical', price, stock })
const preorder = async (price: number, capacity: number): Promise<string> =>
  makeVariant(await makeProduct(), { fulfillment: 'physical', price, stock: 0, preorder: { capacity } })

async function makeRate(fee: number): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [key, `مدينة ${key}`, fee])
  created.rates.push(key)
  return key
}

/** A coupon of 100 % on the lines of one product: that line costs nothing. */
async function freeCoupon(productId: string): Promise<string> {
  const code = unique('CODE').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = (
    await row(`insert into public.coupons (code, kind, percent_bp, product_ids, enabled) values ($1, 'percent', 10000, $2::uuid[], true) returning id`, [code, [productId]])
  ).id as string
  created.coupons.push(id)
  return code
}

type Line = { variantId: string; quantity: number }
type Placed = { id: string; number: string; total: number; key: string; hash: string; email: string }

/** Quotes the cart, then creates the order with that quote's hash: a pending order holding its units. */
async function place(lines: Line[], opts: { couponCode?: string | null } = {}): Promise<Placed> {
  const priced = await call('checkout_quote', { p_ip_hash: ipHash(), p_lines: lines, p_city_key: city, p_coupon_code: opts.couponCode ?? null })
  expect(priced.ok, JSON.stringify(priced)).toBe(true)
  const key = randomUUID()
  const email = uniqueEmail('refund-buyer')
  const result = await call('checkout_create', {
    p_idempotency_key: key,
    p_request_hash: sha256(`request:${key}`),
    p_checkout_session: randomUUID(),
    p_ip_hash: ipHash(),
    p_email: email,
    p_name: 'مشترٍ',
    p_phone: '966501234567',
    p_lines: lines,
    p_city_key: city,
    p_address: 'تبوك شارع الرئيسي',
    p_coupon_code: opts.couponCode ?? null,
    p_policy_revisions: REV,
    p_quote_hash: priced.quoteHash,
    p_access_token_hash: hashFor(tokenFor(key)),
    p_environment: 'test',
  })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  created.orders.push(result.order.id)
  return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, key, hash: hashFor(tokenFor(key)), email }
}

type Started = { attemptId: string; invoiceId: string; paymentId: string; placed: Placed }

/** begin, then created: a pending attempt with an invoice. */
async function start(placed: Placed): Promise<Started> {
  const begun = await call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })
  expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, state: 'new' })
  const invoiceId = randomUUID()
  expect(
    await call('payment_attempt_created', {
      p_attempt: begun.attemptId,
      p_invoice_id: invoiceId,
      p_invoice_url: `http://127.0.0.1:54390/invoices/${invoiceId}`,
      p_expires_at: null,
    }),
  ).toEqual({ ok: true })
  return { attemptId: begun.attemptId, invoiceId, paymentId: randomUUID(), placed }
}

/** What the Edge Function hands `apply_verified_payment`: the payment and its invoice, normalized. */
function apply(s: Started, over: { amount?: number; status?: string } = {}): Promise<any> {
  const amount = over.amount ?? s.placed.total
  return call('apply_verified_payment', {
    p_invoice_id: s.invoiceId,
    p_payment: {
      id: s.paymentId,
      status: over.status ?? 'paid',
      amount,
      currency: 'SAR',
      fee: 150,
      refunded: 0,
      invoiceId: s.invoiceId,
      sourceType: 'creditcard',
      sourceCompany: 'mada',
    },
    p_invoice: { id: s.invoiceId, status: 'paid', amount, currency: 'SAR' },
    p_mode: 'test',
    p_live: null,
    p_event_id: null,
  })
}

type Item = { id: string; variantId: string; fulfillment: string; paid: number }
type Paid = Placed & { attemptId: string; paymentId: string; invoiceId: string; items: Item[]; shipping: number }

/** An order placed and paid: its paying attempt, its items with what each cost and the shipping. */
async function paid(lines: Line[], opts: { couponCode?: string | null } = {}): Promise<Paid> {
  const placed = await place(lines, opts)
  const started = await start(placed)
  expect(await apply(started), 'the payment settles the order').toMatchObject({ outcome: 'paid' })
  const items = (
    await rows('select id, variant_id, fulfillment, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1 order by line_no', [placed.id])
  ).map((item) => ({ id: item.id as string, variantId: item.variant_id as string, fulfillment: item.fulfillment as string, paid: Number(item.paid) }))
  const shipping = Number((await orderOf(placed.id)).shipping_halalas)
  return { ...placed, attemptId: started.attemptId, paymentId: started.paymentId, invoiceId: started.invoiceId, items, shipping }
}
/** One digital line of 3 500 halalas: an order with nothing to count but its entitlement. */
const plain = async (): Promise<Paid> => paid([{ variantId: await digital(), quantity: 1 }])
/** A physical line (6 900), a digital one (3 500), a digital one (2 000) and the shipping (2 500): 14 900. */
const three = async (): Promise<Paid> =>
  paid([
    { variantId: await physical(6900, 10), quantity: 1 },
    { variantId: await digital(3500), quantity: 1 },
    { variantId: await digital(2000), quantity: 1 },
  ])

const alloc = (item: Item, amount: number, shipping = 0) => ({ items: [{ itemId: item.id, amount }], shipping })

/** `refund_request` as the owner, with a sensible default of 1 000 halalas of the first item. */
function request(p: Paid, over: Record<string, unknown> = {}, client?: Client): Promise<any> {
  const key = (over.p_idempotency_key as string | undefined) ?? randomUUID()
  return call(
    'refund_request',
    {
      p_actor: ownerUser.userId,
      p_order: p.id,
      p_attempt: p.attemptId,
      p_review_payment: null,
      p_amount: 1000,
      p_reason: 'عيب في الطباعة',
      p_allocation: alloc(p.items[0]!, 1000),
      p_idempotency_key: key,
      p_request_hash: sha256(`hash:${key}`),
      p_return: null,
      p_provider_refunded: 0,
      ...over,
    },
    client,
  )
}
/** A refund in flight: the request's `new` answer, asserted. */
async function flight(p: Paid, over: Record<string, unknown> = {}): Promise<string> {
  const reply = await request(p, over)
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true, state: 'new' })
  return reply.refundId as string
}
/** An in-flight refund of the whole order, to be settled with the provider's total. */
const result = (refundId: string, outcome: string, total: number | null = null, error: string | null = null, client?: Client): Promise<any> =>
  call('refund_result', { p_refund: refundId, p_outcome: outcome, p_provider_refunded: total, p_error: error }, client)
const settle = (refundId: string, total: number, client?: Client): Promise<any> => call('refund_settle', { p_refund: refundId, p_provider_refunded: total }, client)
const checked = (refundId: string, error: string | null = 'PAYMENT_FETCH_UNAVAILABLE'): Promise<any> => call('refund_checked', { p_refund: refundId, p_error: error })
const external = (p: Paid, total: number, status: string | null = 'refunded', over: Record<string, unknown> = {}): Promise<any> =>
  call('refund_record_external', {
    p_actor: ownerUser.userId,
    p_attempt: p.attemptId,
    p_review_payment: null,
    p_provider_refunded: total,
    p_provider_status: status,
    p_reason: 'استرداد من لوحة بوابة الدفع',
    ...over,
  })

/** A charged payment that cannot settle an order: a review payment, mapped to an order or to no invoice at all. */
async function review(opts: { mapped: boolean; amount?: number }): Promise<{ paymentId: string; amount: number; orderId: string | null; attemptId: string | null }> {
  if (!opts.mapped) {
    const invoiceId = randomUUID()
    const paymentId = randomUUID()
    const amount = opts.amount ?? 4000
    const applied = await call('apply_verified_payment', {
      p_invoice_id: invoiceId,
      p_payment: { id: paymentId, status: 'paid', amount, currency: 'SAR', fee: 0, refunded: 0, invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
      p_invoice: { id: invoiceId, status: 'paid', amount, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
    expect(applied).toEqual({ outcome: 'unknown_invoice' })
    return { paymentId, amount, orderId: null, attemptId: null }
  }
  const placed = await place([{ variantId: await digital(), quantity: 1 }])
  const started = await start(placed)
  const amount = opts.amount ?? placed.total + 700
  expect(await apply(started, { amount })).toMatchObject({ outcome: 'review', reason: 'AMOUNT_MISMATCH' })
  return { paymentId: started.paymentId, amount, orderId: placed.id, attemptId: started.attemptId }
}
const requestReview = (r: { paymentId: string; orderId: string | null }, over: Record<string, unknown> = {}, client?: Client): Promise<any> => {
  const key = (over.p_idempotency_key as string | undefined) ?? randomUUID()
  return call(
    'refund_request',
    {
      p_actor: ownerUser.userId,
      p_order: r.orderId,
      p_attempt: null,
      p_review_payment: r.paymentId,
      p_amount: 1000,
      p_reason: 'دفعة بمبلغ خاطئ',
      p_allocation: {},
      p_idempotency_key: key,
      p_request_hash: sha256(`hash:${key}`),
      p_return: null,
      p_provider_refunded: 0,
      ...over,
    },
    client,
  )
}
const reviewOf = (paymentId: string): Promise<Row> => row('select * from finance.payment_reviews where provider_payment_id = $1', [paymentId])

// --- grants ------------------------------------------------------------------------------------------------------

const REFUND_FUNCTIONS: Array<[string, Record<string, unknown>]> = [
  [
    'refund_request',
    {
      p_actor: randomUUID(), p_order: randomUUID(), p_attempt: randomUUID(), p_review_payment: null, p_amount: 100, p_reason: 'x', p_allocation: {},
      p_idempotency_key: randomUUID(), p_request_hash: ZERO, p_return: null, p_provider_refunded: 0,
    },
  ],
  ['refund_result', { p_refund: randomUUID(), p_outcome: 'uncertain', p_provider_refunded: null, p_error: null }],
  ['refund_settle', { p_refund: randomUUID(), p_provider_refunded: 0 }],
  ['refund_checked', { p_refund: randomUUID(), p_error: null }],
  [
    'refund_record_external',
    { p_actor: randomUUID(), p_attempt: randomUUID(), p_review_payment: null, p_provider_refunded: 100, p_provider_status: 'refunded', p_reason: 'x' },
  ],
  ['refund_ref', { p_actor: randomUUID(), p_refund: randomUUID() }],
]
const REFUND_HELPERS = ['refund_lock_rows', 'refund_lock', 'refund_allocation_ok', 'refund_succeed', 'refund_fail', 'refund_dashboard']

describe('grants', () => {
  it('anon and an authenticated editor cannot execute any of the six; service_role alone holds each', async () => {
    for (const [fn, args] of REFUND_FUNCTIONS) {
      expect((await anonClient().rpc(fn, args)).error?.code, `${fn} anon`).toBe('42501')
      expect((await editorClient.rpc(fn, args)).error?.code, `${fn} authenticated`).toBe('42501')
    }
    const signatures = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [REFUND_FUNCTIONS.map(([fn]) => fn)],
    )
    expect(signatures).toHaveLength(REFUND_FUNCTIONS.length)
    for (const { sig } of signatures) {
      for (const [role, want] of [['service_role', true], ['anon', false], ['authenticated', false]] as const) {
        expect((await row('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])).ok, `${role} on ${sig}`).toBe(want)
      }
    }
  })

  it('the internal helpers belong to nobody: no API role, service_role included, may execute them', async () => {
    const signatures = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'finance' and p.proname = any($1::text[])`,
      [REFUND_HELPERS],
    )
    expect(signatures).toHaveLength(REFUND_HELPERS.length)
    for (const { sig } of signatures) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        expect((await row('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])).ok, `${role} on ${sig}`).toBe(false)
      }
    }
  })

  it('the three that name an actor refuse anyone who is not an active owner: operations, an editor, a revoked owner, an unknown id, no id', async () => {
    const p = await plain()
    const flying = await flight(p)
    for (const actor of [operationsUser.userId, editorUser.userId, revokedOwner.userId, randomUUID(), null]) {
      await expect(request(p, { p_actor: actor }), `request as ${actor}`).rejects.toMatchObject({ code: '42501' })
      await expect(external(p, 500, 'refunded', { p_actor: actor }), `external as ${actor}`).rejects.toMatchObject({ code: '42501' })
      await expect(call('refund_ref', { p_actor: actor, p_refund: flying }), `ref as ${actor}`).rejects.toMatchObject({ code: '42501' })
    }
    // Nothing was written by the refused calls.
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(await call('refund_ref', { p_actor: ownerUser.userId, p_refund: flying })).toEqual({
      ok: true,
      refundId: flying,
      status: 'submitting',
      providerPaymentId: p.paymentId,
    })
    expect(await call('refund_ref', { p_actor: ownerUser.userId, p_refund: randomUUID() })).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('a malformed call raises instead of answering: no target or two, a bad amount, reason, key or hash, a negative total', async () => {
    const p = await plain()
    const review = randomUUID()
    const bad: Array<Record<string, unknown>> = [
      { p_attempt: null },
      { p_review_payment: review },
      { p_amount: 0 },
      { p_amount: -5 },
      { p_amount: null },
      { p_reason: '' },
      { p_reason: 'ا'.repeat(301) },
      { p_reason: 'سطر\nثانٍ' },
      { p_reason: null },
      { p_idempotency_key: null },
      { p_request_hash: 'not-a-hash' },
      { p_request_hash: null },
      { p_provider_refunded: -1 },
      { p_provider_refunded: null },
    ]
    for (const over of bad) await expect(request(p, over), JSON.stringify(over)).rejects.toMatchObject({ code: '22023' })
    for (const over of [{ p_attempt: null }, { p_review_payment: review }, { p_provider_refunded: null }, { p_provider_refunded: -1 }, { p_reason: '' }, { p_provider_status: 'x'.repeat(61) }]) {
      await expect(external(p, 500, 'refunded', over), JSON.stringify(over)).rejects.toMatchObject({ code: '22023' })
    }
    const flying = await flight(p)
    for (const args of [
      { p_refund: null, p_outcome: 'failed' },
      { p_refund: flying, p_outcome: 'bogus' },
      { p_refund: flying, p_outcome: null },
      { p_refund: flying, p_outcome: 'succeeded', p_provider_refunded: null },
      { p_refund: flying, p_outcome: 'succeeded', p_provider_refunded: -1 },
      { p_refund: flying, p_outcome: 'failed', p_error: 'has a space' },
      { p_refund: flying, p_outcome: 'failed', p_error: 'x'.repeat(121) },
    ]) {
      await expect(call('refund_result', { p_provider_refunded: null, p_error: null, ...args }), JSON.stringify(args)).rejects.toMatchObject({ code: '22023' })
    }
    // Still in flight: none of the refused calls touched it.
    expect(await refundOf(flying)).toMatchObject({ status: 'submitting', error: null })
    await expect(call('refund_settle', { p_refund: null, p_provider_refunded: 0 })).rejects.toMatchObject({ code: '22023' })
    await expect(call('refund_settle', { p_refund: flying, p_provider_refunded: null })).rejects.toMatchObject({ code: '22023' })
    await expect(call('refund_settle', { p_refund: flying, p_provider_refunded: -1 })).rejects.toMatchObject({ code: '22023' })
    await expect(call('refund_checked', { p_refund: null, p_error: null })).rejects.toMatchObject({ code: '22023' })
    await expect(call('refund_checked', { p_refund: flying, p_error: 'a message with spaces' })).rejects.toMatchObject({ code: '22023' })
  })
})

// --- refund_request ----------------------------------------------------------------------------------------------

describe('refund_request: reserving the balance', () => {
  it('writes a submitting refund with the total it was given, due in a minute, and answers it as new', async () => {
    const p = await three()
    const reply = await request(p, { p_amount: 3500, p_allocation: alloc(p.items[1]!, 3500), p_provider_refunded: 0 })
    expect(reply).toEqual({ ok: true, state: 'new', refundId: expect.any(String), providerPaymentId: p.paymentId, amount: 3500 })
    const refund = await refundOf(reply.refundId)
    expect(refund).toMatchObject({
      order_id: p.id,
      attempt_id: p.attemptId,
      review_payment_id: null,
      amount_halalas: 3500,
      reason: 'عيب في الطباعة',
      allocation: { items: [{ itemId: p.items[1]!.id, amount: 3500 }], shipping: 0 },
      status: 'submitting',
      source: 'admin',
      provider_refunded_before: 0,
      provider_refunded_after: null,
      return_id: null,
      requested_by: ownerUser.userId,
      error: null,
      check_count: 0,
      succeeded_at: null,
    })
    expect(refund.request_hash).toMatch(/^[0-9a-f]{64}$/)
    const ahead = await secondsAhead(reply.refundId)
    expect(ahead).toBeGreaterThan(50)
    expect(ahead).toBeLessThan(70)
    // The request is on the audit trail, with the owner who made it and no contact detail.
    const trail = await audits('refund.requested', reply.refundId)
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ actor: ownerUser.userId, entity: 'refund' })
    expect(JSON.stringify(trail[0]!.summary)).not.toContain(p.email)
    // Nothing else moved: the order is paid, its entitlements granted, the attempt unchanged.
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect(await attemptOf(p.attemptId)).toMatchObject({ status: 'paid', provider_refunded_halalas: 0 })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at === null)).toBe(true)
  })

  it('the balance is reserved while it is in flight: any other request is REFUND_IN_FLIGHT, whatever its amount and key', async () => {
    const p = await plain()
    await flight(p, { p_amount: 500, p_allocation: alloc(p.items[0]!, 500) })
    for (const amount of [1, 500, 3000, 3500]) {
      expect(await request(p, { p_amount: amount, p_allocation: alloc(p.items[0]!, amount) }), String(amount)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    }
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
  })

  it('REFUND_IN_FLIGHT is checked before the provider total: our own unsettled refund is never mistaken for one made outside', async () => {
    const p = await plain()
    await flight(p)
    // The provider already shows our refund (1 000): that is not PROVIDER_AHEAD while ours is in flight, and nothing
    // else is looked at (the attempt's provider total is only written once the in-flight check has passed).
    expect(await request(p, { p_provider_refunded: 1000 })).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    expect(await request(p, { p_provider_refunded: 0 })).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    expect((await attemptOf(p.attemptId)).provider_refunded_halalas).toBe(0)
  })

  it('PROVIDER_AHEAD when the provider shows more than the ledger, PROVIDER_BEHIND when it shows less; the attempt keeps the greater total', async () => {
    const p = await plain()
    expect(await request(p, { p_provider_refunded: 700 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    expect((await attemptOf(p.attemptId)).provider_refunded_halalas).toBe(700)
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
    // One confirmed refund of 1 000: the provider must show exactly that.
    const first = await flight(p)
    await result(first, 'succeeded', 1000)
    expect(await request(p, { p_provider_refunded: 0 })).toEqual({ ok: false, code: 'PROVIDER_BEHIND' })
    expect(await request(p, { p_provider_refunded: 999 })).toEqual({ ok: false, code: 'PROVIDER_BEHIND' })
    expect(await request(p, { p_provider_refunded: 1001 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    expect((await attemptOf(p.attemptId)).provider_refunded_halalas).toBe(1001)
    // The total is checked before the balance: a wrong total is PROVIDER_*, not EXCEEDS_BALANCE.
    expect(await request(p, { p_amount: 999_999, p_provider_refunded: 5 })).toEqual({ ok: false, code: 'PROVIDER_BEHIND' })
    expect(await request(p, { p_amount: 999_999, p_provider_refunded: 2000 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    expect(await request(p, { p_provider_refunded: 1000 })).toMatchObject({ ok: true, state: 'new' })
  })

  it('EXCEEDS_BALANCE when what is confirmed plus the amount is more than was captured, and not before', async () => {
    const p = await plain() // 3 500
    expect(await request(p, { p_amount: 3501, p_allocation: alloc(p.items[0]!, 3501) })).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    const first = await flight(p, { p_amount: 3000, p_allocation: alloc(p.items[0]!, 3000) })
    await result(first, 'succeeded', 3000)
    expect(await request(p, { p_amount: 501, p_allocation: alloc(p.items[0]!, 501), p_provider_refunded: 3000 })).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    // Exactly what is left is fine.
    expect(await request(p, { p_amount: 500, p_allocation: alloc(p.items[0]!, 500), p_provider_refunded: 3000 })).toMatchObject({ ok: true, state: 'new' })
    // A refund that failed frees its balance again.
    const q = await plain()
    const failed = await flight(q, { p_amount: 3500, p_allocation: alloc(q.items[0]!, 3500) })
    expect(await request(q, { p_amount: 1 })).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    await result(failed, 'failed', null, 'REFUND_REFUSED')
    expect(await request(q, { p_amount: 3500, p_allocation: alloc(q.items[0]!, 3500) })).toMatchObject({ ok: true, state: 'new' })
  })

  it('NOT_REFUNDABLE: an attempt that is not paid, an unknown one, another order\'s, a missing order, and a review payment closed as refunded', async () => {
    const pending = await place([{ variantId: await digital(), quantity: 1 }])
    const started = await start(pending)
    const as = (over: Record<string, unknown>) =>
      call('refund_request', {
        p_actor: ownerUser.userId, p_order: pending.id, p_attempt: started.attemptId, p_review_payment: null, p_amount: 1000, p_reason: 'سبب',
        p_allocation: {}, p_idempotency_key: randomUUID(), p_request_hash: ZERO, p_return: null, p_provider_refunded: 0, ...over,
      })
    expect(await as({})).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    const p = await plain()
    expect(await request(p, { p_attempt: randomUUID() })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await request(p, { p_order: randomUUID() })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await request(p, { p_order: null })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await request(p, { p_order: pending.id })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    // A review payment that does not exist, one whose order is another, and one closed as refunded.
    const r = await review({ mapped: true })
    expect(await requestReview({ paymentId: randomUUID(), orderId: null })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await requestReview({ paymentId: r.paymentId, orderId: p.id })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    await postgres.query("update finance.payment_reviews set closed_at = now(), closed_reason = 'refunded' where provider_payment_id = $1", [r.paymentId])
    expect(await requestReview(r)).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await count('select count(*)::int as n from finance.refunds where attempt_id = any($1::uuid[])', [[started.attemptId, p.attemptId]])).toBe(0)
  })

  it('a review payment the owner closed by hand can still be refunded', async () => {
    const r = await review({ mapped: true })
    await postgres.query("update finance.payment_reviews set closed_at = now(), closed_reason = 'reversed by the bank' where provider_payment_id = $1", [r.paymentId])
    expect(await requestReview(r)).toMatchObject({ ok: true, state: 'new' })
  })

  it('INVALID_ALLOCATION: the parts must add up, belong to the order, stay within what each cost and within the shipping', async () => {
    const p = await three() // 6 900, 3 500, 2 000 and 2 500 shipping
    const [a, b] = p.items as [Item, Item, Item]
    const bad = async (label: string, amount: number, allocation: unknown) =>
      expect(await request(p, { p_amount: amount, p_allocation: allocation }), label).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    await bad('parts below the amount', 1000, alloc(a, 999))
    await bad('parts above the amount', 1000, alloc(a, 1001))
    await bad('the empty allocation of a paying attempt', 1000, {})
    await bad('shipping counted twice', 1000, { items: [{ itemId: a.id, amount: 1000 }], shipping: 1000 })
    await bad('an item of another order', 1000, { items: [{ itemId: randomUUID(), amount: 1000 }], shipping: 0 })
    await bad('an item more than it cost', 6901, alloc(a, 6901))
    await bad('shipping more than the order\'s', 2501, { items: [], shipping: 2501 })
    await bad('the same item twice', 1000, { items: [{ itemId: b.id, amount: 500 }, { itemId: b.id, amount: 500 }], shipping: 0 })
    await bad('an unknown key', 1000, { items: [{ itemId: a.id, amount: 1000 }], shipping: 0, note: 'x' })
    await bad('an item with an unknown key', 1000, { items: [{ itemId: a.id, amount: 1000, extra: true }], shipping: 0 })
    await bad('a zero item amount', 1000, { items: [{ itemId: a.id, amount: 0 }, { itemId: b.id, amount: 1000 }], shipping: 0 })
    await bad('a negative item amount', 1000, { items: [{ itemId: a.id, amount: -5 }, { itemId: b.id, amount: 1005 }], shipping: 0 })
    await bad('a fractional amount', 1000, { items: [{ itemId: a.id, amount: 1000.5 }], shipping: 0 })
    await bad('an amount as text', 1000, { items: [{ itemId: a.id, amount: '1000' }], shipping: 0 })
    await bad('an item id that is not a uuid', 1000, { items: [{ itemId: 'item-1', amount: 1000 }], shipping: 0 })
    await bad('items that are not a list', 1000, { items: 'all', shipping: 0 })
    await bad('a shipping as text', 1000, { items: [{ itemId: a.id, amount: 500 }], shipping: '500' })
    await bad('a negative shipping', 1000, { items: [{ itemId: a.id, amount: 1500 }], shipping: -500 })
    await bad('an allocation that is not an object', 1000, [1000])
    expect(await refundsOf(p.attemptId)).toHaveLength(0)

    // What each cost is counted across refunds: the second refund of an item sees the first.
    const first = await flight(p, { p_amount: 3000, p_allocation: alloc(b, 3000) })
    await result(first, 'succeeded', 3000)
    expect(await request(p, { p_amount: 501, p_allocation: alloc(b, 501), p_provider_refunded: 3000 })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await request(p, { p_amount: 500, p_allocation: alloc(b, 500), p_provider_refunded: 3000 })).toMatchObject({ ok: true })
    // The shipping too: it is refunded once, in parts.
    const q = await three()
    const ship = await flight(q, { p_amount: 2000, p_allocation: { items: [], shipping: 2000 } })
    await result(ship, 'succeeded', 2000)
    expect(await request(q, { p_amount: 501, p_allocation: { items: [], shipping: 501 }, p_provider_refunded: 2000 })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await request(q, { p_amount: 500, p_allocation: { items: [], shipping: 500 }, p_provider_refunded: 2000 })).toMatchObject({ ok: true })
    // An item and the shipping in one refund, and a refund of items only or shipping only, are all well formed.
    const r = await three()
    expect(await request(r, { p_amount: 3000, p_allocation: { items: [{ itemId: r.items[0]!.id, amount: 2000 }], shipping: 1000 } })).toMatchObject({ ok: true })
  })

  it('a free line cannot be allocated: it cost nothing', async () => {
    const free = await digital(3000)
    const freeProduct = (await row('select product_id from public.product_variants where id = $1', [free])).product_id as string
    const p = await paid([{ variantId: free, quantity: 1 }, { variantId: await digital(5000), quantity: 1 }], { couponCode: await freeCoupon(freeProduct) })
    const [freeItem, paidItem] = p.items as [Item, Item]
    expect([freeItem.paid, paidItem.paid]).toEqual([0, 5000])
    expect(await request(p, { p_amount: 1, p_allocation: alloc(freeItem, 1) })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await request(p, { p_amount: 1, p_allocation: alloc(paidItem, 1) })).toMatchObject({ ok: true })
  })

  it('a review payment\'s allocation is {} and nothing else', async () => {
    const r = await review({ mapped: false })
    expect(await requestReview(r, { p_allocation: { items: [], shipping: 0 } })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await requestReview(r, { p_allocation: { items: [{ itemId: randomUUID(), amount: 1000 }], shipping: 0 } })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await requestReview(r, { p_allocation: null })).toMatchObject({ ok: true, state: 'new' })
  })

  it('INVALID_RETURN unless it is a received return of this order with no refund linked; a review payment has none', async () => {
    const p = await plain()
    const other = await plain()
    const returnOf = async (orderId: string, state: string): Promise<string> =>
      (await row(`insert into finance.return_requests (order_id, items, reason, state) values ($1, '[]'::jsonb, 'سبب', $2) returning id`, [orderId, state])).id as string
    for (const state of ['requested', 'approved', 'rejected', 'refunded']) {
      expect(await request(p, { p_return: await returnOf(p.id, state) }), state).toEqual({ ok: false, code: 'INVALID_RETURN' })
    }
    expect(await request(p, { p_return: randomUUID() })).toEqual({ ok: false, code: 'INVALID_RETURN' })
    expect(await request(p, { p_return: await returnOf(other.id, 'received') })).toEqual({ ok: false, code: 'INVALID_RETURN' })
    const received = await returnOf(p.id, 'received')
    const linked = await returnOf(p.id, 'received')
    const holder = await flight(await plain()) // any refund row to point at
    await postgres.query('update finance.return_requests set refund_id = $2 where id = $1', [linked, holder])
    expect(await request(p, { p_return: linked })).toEqual({ ok: false, code: 'INVALID_RETURN' })
    const ok = await request(p, { p_return: received })
    expect(ok).toMatchObject({ ok: true, state: 'new' })
    expect((await refundOf(ok.refundId)).return_id).toBe(received)
    const r = await review({ mapped: true })
    expect(await requestReview(r, { p_return: received })).toEqual({ ok: false, code: 'INVALID_RETURN' })
  })

  it('the refusals come in the contract\'s order: the key, then refundable, in flight, the total, the balance, the allocation, the return', async () => {
    const p = await plain()
    const bogusReturn = randomUUID()
    // Everything wrong at once, one fault removed at a time.
    expect(await request(p, { p_amount: 999_999, p_allocation: {}, p_return: bogusReturn, p_provider_refunded: 0 })).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    expect(await request(p, { p_amount: 999_999, p_allocation: {}, p_return: bogusReturn, p_provider_refunded: 50 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    expect(await request(p, { p_amount: 1000, p_allocation: {}, p_return: bogusReturn, p_provider_refunded: 50 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    expect(await request(p, { p_amount: 1000, p_allocation: {}, p_return: bogusReturn, p_provider_refunded: 0 })).toEqual({ ok: false, code: 'INVALID_ALLOCATION' })
    expect(await request(p, { p_amount: 1000, p_return: bogusReturn, p_provider_refunded: 0 })).toEqual({ ok: false, code: 'INVALID_RETURN' })
    // A replay of a request that was refused is not a duplicate: nothing was stored under its key.
    const key = randomUUID()
    expect(await request(p, { p_idempotency_key: key, p_amount: 999_999 })).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    expect(await request(p, { p_idempotency_key: key })).toMatchObject({ ok: true, state: 'new' })
  })
})

describe('refund_request: the idempotency key', () => {
  it('the same key and the same request answers the stored refund and writes nothing: new, then duplicate at every stage', async () => {
    const p = await three()
    const key = randomUUID()
    const hash = sha256('one request')
    const asked = () => request(p, { p_idempotency_key: key, p_request_hash: hash, p_amount: 3500, p_allocation: alloc(p.items[1]!, 3500) })
    const first = await asked()
    expect(first).toMatchObject({ ok: true, state: 'new' })
    const stored = { ok: true, state: 'duplicate', refundId: first.refundId, amount: 3500 }
    expect(await asked()).toEqual({ ...stored, status: 'submitting' })
    await result(first.refundId, 'uncertain', null, 'REFUND_UNCERTAIN')
    expect(await asked()).toEqual({ ...stored, status: 'uncertain' })
    await result(first.refundId, 'succeeded', 3500)
    expect(await asked()).toEqual({ ...stored, status: 'succeeded' })
    // Even when the attempt is no longer refundable for that amount, a replay is a replay.
    const rest = await flight(p, { p_amount: 11_400, p_allocation: { items: [{ itemId: p.items[0]!.id, amount: 6900 }, { itemId: p.items[2]!.id, amount: 2000 }], shipping: 2500 }, p_provider_refunded: 3500 })
    await result(rest, 'succeeded', 14_900)
    expect(await asked()).toEqual({ ...stored, status: 'succeeded' })
    expect(await refundsOf(p.attemptId)).toHaveLength(2)

    // A refund that failed is replayed as failed: the same key never reaches the provider twice.
    const q = await plain()
    const failedKey = randomUUID()
    const failed = await request(q, { p_idempotency_key: failedKey })
    await result(failed.refundId, 'failed', null, 'REFUND_REFUSED')
    expect(await request(q, { p_idempotency_key: failedKey })).toEqual({ ok: true, state: 'duplicate', refundId: failed.refundId, status: 'failed', amount: 1000 })
    expect(await refundsOf(q.attemptId)).toHaveLength(1)
  })

  it('the same key for another request is IDEMPOTENCY_CONFLICT: another hash, another attempt, or a review payment', async () => {
    const p = await plain()
    const key = randomUUID()
    const first = await request(p, { p_idempotency_key: key, p_request_hash: sha256('a') })
    expect(first).toMatchObject({ ok: true })
    expect(await request(p, { p_idempotency_key: key, p_request_hash: sha256('b') })).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    // Another target with the very same hash is still another request.
    const q = await plain()
    expect(await request(q, { p_idempotency_key: key, p_request_hash: sha256('a') })).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    const r = await review({ mapped: false })
    expect(await requestReview(r, { p_idempotency_key: key, p_request_hash: sha256('a') })).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(await refundsOf(q.attemptId)).toHaveLength(0)
    expect(await count('select count(*)::int as n from finance.refunds where review_payment_id = $1', [r.paymentId])).toBe(0)
  })
})

describe('refund_request: the reserve under concurrency', () => {
  it('one key sent at once for two different attempts: one is new, the other IDEMPOTENCY_CONFLICT, never an exception', async () => {
    for (let round = 0; round < 3; round += 1) {
      const p = await plain()
      const q = await plain()
      const key = randomUUID()
      const replies = await Promise.all([request(p, { p_idempotency_key: key }, pool[1]), request(q, { p_idempotency_key: key }, pool[2])])
      expect(replies.filter((reply) => reply.ok && reply.state === 'new')).toHaveLength(1)
      expect(replies.filter((reply) => !reply.ok).map((reply) => reply.code)).toEqual(['IDEMPOTENCY_CONFLICT'])
      expect((await refundsOf(p.attemptId)).length + (await refundsOf(q.attemptId)).length).toBe(1)
    }
  })

  it('two connections asking for the same attempt at once: exactly one new, the other REFUND_IN_FLIGHT, five times over', async () => {
    for (let round = 0; round < 5; round += 1) {
      const p = await plain()
      const [one, two] = await Promise.all([
        request(p, { p_amount: 2000, p_allocation: alloc(p.items[0]!, 2000) }, pool[1]),
        request(p, { p_amount: 2000, p_allocation: alloc(p.items[0]!, 2000) }, pool[2]),
      ])
      const outcomes = [one, two].map((reply) => (reply.ok ? reply.state : reply.code)).sort()
      expect(outcomes, `round ${round}`).toEqual(['REFUND_IN_FLIGHT', 'new'])
      expect(await refundsOf(p.attemptId)).toHaveLength(1)
    }
  })

  it('the same key at once: one new, one duplicate, one row', async () => {
    const p = await plain()
    const key = randomUUID()
    const [one, two] = await Promise.all([
      request(p, { p_idempotency_key: key }, pool[1]),
      request(p, { p_idempotency_key: key }, pool[2]),
    ])
    expect([one, two].map((reply) => reply.state).sort()).toEqual(['duplicate', 'new'])
    expect(one.refundId).toBe(two.refundId)
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
  })

  it('three connections racing partial refunds of one attempt: the refunded total never exceeds what was captured', async () => {
    const p = await plain() // 3 500: two refunds of 1 500 fit, a third does not
    // Each worker reads the ledger through its own session (the service role may not read the finance tables).
    const readers = await Promise.all(
      [0, 1, 2].map(async () => {
        const reader = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
        await reader.connect()
        return reader
      }),
    )
    const worker = async (client: Client, reader: Client): Promise<void> => {
      for (let turn = 0; turn < 60; turn += 1) {
        const total = Number(
          (await reader.query("select coalesce(sum(amount_halalas), 0)::int as n from finance.refunds where attempt_id = $1 and status = 'succeeded'", [p.attemptId])).rows[0].n,
        )
        const reply = await request(p, { p_amount: 1500, p_allocation: alloc(p.items[0]!, 1500), p_provider_refunded: total }, client)
        if (reply.ok) {
          expect(await result(reply.refundId, 'succeeded', total + 1500, null, client)).toMatchObject({ ok: true, status: 'succeeded' })
          continue
        }
        if (reply.code === 'EXCEEDS_BALANCE') return
        // Another connection is between its request and its result: look again.
        expect(['REFUND_IN_FLIGHT', 'PROVIDER_AHEAD', 'PROVIDER_BEHIND']).toContain(reply.code)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error('the worker never reached the end of the balance')
    }
    try {
      await Promise.all([worker(pool[1]!, readers[0]!), worker(pool[2]!, readers[1]!), worker(pool[3]!, readers[2]!)])
    } finally {
      for (const reader of readers) await reader.end()
    }
    const all = await refundsOf(p.attemptId)
    expect(all.map((refund) => refund.status)).toEqual(['succeeded', 'succeeded'])
    expect(await confirmed(p.attemptId)).toBe(3000)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
  })

  it('a request racing the result of the refund in flight never reserves twice and never loses the first', async () => {
    for (let round = 0; round < 3; round += 1) {
      const p = await plain()
      const first = await flight(p, { p_amount: 3500, p_allocation: alloc(p.items[0]!, 3500) })
      const [settled, second] = await Promise.all([
        result(first, 'succeeded', 3500, null, pool[1]),
        request(p, { p_amount: 1, p_allocation: alloc(p.items[0]!, 1), p_provider_refunded: 3500 }, pool[2]),
      ])
      expect(settled).toMatchObject({ ok: true, status: 'succeeded' })
      // Before the result: IN_FLIGHT. After it: the balance is gone.
      expect(['REFUND_IN_FLIGHT', 'EXCEEDS_BALANCE']).toContain(second.code)
      expect(await confirmed(p.attemptId)).toBe(3500)
      expect(await refundsOf(p.attemptId)).toHaveLength(1)
    }
  })
})

// --- refund_result -----------------------------------------------------------------------------------------------

describe('refund_result', () => {
  it('succeeded with exactly before plus the amount: the refund succeeds and the target\'s total follows', async () => {
    const p = await three()
    const id = await flight(p, { p_amount: 3500, p_allocation: alloc(p.items[1]!, 3500) })
    const reply = await result(id, 'succeeded', 3500)
    expect(reply).toEqual({ ok: true, refundId: id, status: 'succeeded', amount: 3500 })
    const refund = await refundOf(id)
    expect(refund).toMatchObject({ status: 'succeeded', provider_refunded_before: 0, provider_refunded_after: 3500, error: null, next_check_at: null })
    expect(refund.succeeded_at).not.toBeNull()
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 3500, status: 'paid' })
    expect(await audits('refund.succeeded', id)).toHaveLength(1)
  })

  it('the exact total is before plus the amount, not the amount: a second refund after a first answers its own total', async () => {
    const p = await three()
    const first = await flight(p, { p_amount: 3500, p_allocation: alloc(p.items[1]!, 3500) })
    await result(first, 'succeeded', 3500)
    const second = await flight(p, { p_amount: 2000, p_allocation: alloc(p.items[2]!, 2000), p_provider_refunded: 3500 })
    // The provider's total after the second is 5 500; 2 000 (the amount alone) is not it.
    expect(await result(second, 'succeeded', 2000)).toMatchObject({ ok: true, status: 'uncertain' })
    expect(await result(second, 'succeeded', 5500)).toMatchObject({ ok: true, status: 'succeeded' })
    expect(await confirmed(p.attemptId)).toBe(5500)
  })

  it('succeeded with another total becomes uncertain for the job: nothing else happens', async () => {
    const p = await plain()
    const id = await flight(p, { p_amount: 3500, p_allocation: alloc(p.items[0]!, 3500) })
    const before = await refundOf(id)
    for (const total of [0, 999, 3501, 7000]) {
      expect(await result(id, 'succeeded', total), String(total)).toEqual({ ok: true, refundId: id, status: 'uncertain', amount: 3500 })
    }
    const refund = await refundOf(id)
    expect(refund).toMatchObject({ status: 'uncertain', error: 'TOTAL_MISMATCH', provider_refunded_after: null, succeeded_at: null })
    expect(refund.next_check_at).toEqual(before.next_check_at)
    // No effect of a success: the order, the entitlement, the attempt, the mail.
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect((await entitlementsOf(p.id))[0]!.revoked_at).toBeNull()
    expect((await attemptOf(p.attemptId)).provider_refunded_halalas).toBe(0)
    expect(await mailsOf(id)).toHaveLength(0)
    // It is still in flight: the right total settles it later.
    expect(await result(id, 'succeeded', 3500)).toMatchObject({ ok: true, status: 'succeeded' })
  })

  it('failed (the provider answered a 4xx): the status, the code, no schedule, the balance free again, an audit row', async () => {
    const p = await plain()
    const id = await flight(p, { p_amount: 3500, p_allocation: alloc(p.items[0]!, 3500) })
    expect(await result(id, 'failed', null, 'REFUND_REFUSED')).toEqual({ ok: true, refundId: id, status: 'failed', amount: 3500 })
    expect(await refundOf(id)).toMatchObject({ status: 'failed', error: 'REFUND_REFUSED', next_check_at: null, provider_refunded_after: null, succeeded_at: null })
    expect(await audits('refund.failed', id)).toHaveLength(1)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect(await request(p, { p_amount: 3500, p_allocation: alloc(p.items[0]!, 3500) })).toMatchObject({ ok: true, state: 'new' })
    // Without a code it still says why in ASCII.
    const q = await plain()
    const second = await flight(q)
    await result(second, 'failed')
    expect((await refundOf(second)).error).toBe('REFUND_REFUSED')
  })

  it('uncertain (a timeout, a 5xx, a 429): the status and the code only; it stays in flight and keeps its schedule', async () => {
    const p = await plain()
    const id = await flight(p)
    const before = await refundOf(id)
    expect(await result(id, 'uncertain', null, 'REFUND_UNCERTAIN')).toEqual({ ok: true, refundId: id, status: 'uncertain', amount: 1000 })
    const refund = await refundOf(id)
    expect(refund).toMatchObject({ status: 'uncertain', error: 'REFUND_UNCERTAIN', provider_refunded_after: null })
    expect(refund.next_check_at).toEqual(before.next_check_at)
    expect(await request(p)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    // An uncertain refund can still be answered: a success, once it is known.
    expect(await result(id, 'succeeded', 1000)).toMatchObject({ ok: true, status: 'succeeded' })
  })

  it('acts only on a refund in flight: any other is NOT_IN_FLIGHT and unchanged; an unknown refund is NOT_FOUND', async () => {
    const p = await plain()
    const done = await flight(p)
    await result(done, 'succeeded', 1000)
    const closed = await refundOf(done)
    for (const outcome of ['succeeded', 'failed', 'uncertain']) {
      expect(await result(done, outcome, 1000), outcome).toEqual({ ok: false, code: 'NOT_IN_FLIGHT', refundId: done, status: 'succeeded', amount: 1000 })
    }
    expect(await refundOf(done)).toEqual(closed)
    expect(await alerts('refund_mismatch', done)).toBe(0)
    expect(await mailsOf(done)).toHaveLength(1)
    expect(await result(randomUUID(), 'failed')).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('a success that arrives for a refund already closed as failed is raised to every owner, once, and changes nothing', async () => {
    const p = await plain()
    const id = await flight(p)
    await age(id, '16 minutes')
    await settle(id, 0)
    expect(await refundOf(id)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    const closed = await refundOf(id)
    expect(await result(id, 'succeeded', 1000)).toEqual({ ok: false, code: 'NOT_IN_FLIGHT', refundId: id, status: 'failed', amount: 1000 })
    expect(await result(id, 'succeeded', 1000)).toMatchObject({ code: 'NOT_IN_FLIGHT' })
    expect(await alerts('refund_mismatch', id)).toBe(await owners())
    const alert = await row("select payload from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1 limit 1", [`refund_mismatch:${id}:%`])
    expect(alert.payload).toEqual({ alert: 'refund_mismatch', refundId: id, orderId: p.id })
    expect(await refundOf(id)).toEqual(closed)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    // A failure or an uncertainty for a refund already failed is no mismatch.
    await result(id, 'failed')
    await result(id, 'uncertain')
    expect(await alerts('refund_mismatch', id)).toBe(await owners())
  })
})

// --- refund_settle -----------------------------------------------------------------------------------------------

describe('refund_settle: every branch of the fetched total', () => {
  /** An order with a provider total already at `before` (a dashboard refund recorded), then a refund of `amount` in flight. */
  async function inFlight(before: number, amount = 2000): Promise<{ p: Paid; id: string }> {
    const p = await three()
    if (before > 0) expect(await external(p, before)).toMatchObject({ ok: true })
    const id = await flight(p, { p_amount: amount, p_allocation: alloc(p.items[0]!, amount), p_provider_refunded: before })
    return { p, id }
  }

  it('the total reached: the refund succeeds with before plus the amount, and nothing more is recorded', async () => {
    const { p, id } = await inFlight(0, 2000)
    expect(await settle(id, 2000)).toEqual({ ok: true, refundId: id, status: 'succeeded', amount: 2000 })
    expect(await refundOf(id)).toMatchObject({ status: 'succeeded', provider_refunded_before: 0, provider_refunded_after: 2000, next_check_at: null, error: null })
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 2000 })
    expect(await audits('refund.succeeded', id)).toHaveLength(1)
    expect(await mailsOf(id)).toHaveLength(1)
  })

  it('an uncertain refund is settled the same way', async () => {
    const { id } = await inFlight(0, 2000)
    await result(id, 'uncertain', null, 'REFUND_UNCERTAIN')
    expect(await settle(id, 2000)).toMatchObject({ status: 'succeeded' })
  })

  it('a surplus above before plus the amount is recorded, in the same transaction, as a refund made at the provider\'s dashboard', async () => {
    const { p, id } = await inFlight(500, 2000)
    expect(await settle(id, 2800)).toEqual({ ok: true, refundId: id, status: 'succeeded', amount: 2000 })
    const all = await refundsOf(p.attemptId)
    const ours = all.find((r) => r.id === id)!
    const surplus = all.find((r) => r.source === 'provider_dashboard' && r.amount_halalas === 300)!
    expect(ours).toMatchObject({ status: 'succeeded', provider_refunded_before: 500, provider_refunded_after: 2500 })
    expect(surplus).toMatchObject({
      status: 'succeeded',
      source: 'provider_dashboard',
      amount_halalas: 300,
      allocation: {},
      provider_refunded_before: 2500,
      provider_refunded_after: 2800,
      attempt_id: p.attemptId,
      order_id: p.id,
      next_check_at: null,
    })
    expect(surplus.requested_by).toBeNull()
    // One transaction: both rows carry the same instant, and the ledger equals the provider.
    expect(surplus.succeeded_at).toEqual(ours.succeeded_at)
    expect(await confirmed(p.attemptId)).toBe(500 + 2000 + 300)
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 2800 })
    expect(await mailsOf(surplus.id)).toHaveLength(1)
    expect(await audits('refund.external', surplus.id)).toHaveLength(1)
  })

  it('a surplus that completes the whole payment refunds the order and revokes every entitlement', async () => {
    const p = await plain() // 3 500
    const id = await flight(p, { p_amount: 3000, p_allocation: alloc(p.items[0]!, 3000) })
    await settle(id, 3500)
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
    expect(await confirmed(p.attemptId)).toBe(3500)
  })

  it('the total unchanged and the refund younger than 15 minutes: nothing changes but the schedule, which backs off 1, 2, 4, 8 minutes and never past the 15th', async () => {
    const { p, id } = await inFlight(0, 2000)
    const seen: number[] = []
    for (let round = 1; round <= 4; round += 1) {
      expect(await settle(id, 0), `round ${round}`).toEqual({ ok: true, refundId: id, status: 'submitting', amount: 2000 })
      const refund = await refundOf(id)
      expect(refund).toMatchObject({ status: 'submitting', check_count: round, provider_refunded_before: 0, amount_halalas: 2000, error: null })
      seen.push(Math.round((await secondsAhead(id)) / 60))
    }
    expect(seen).toEqual([1, 2, 4, 8])
    // The fifth would be 16 minutes ahead: it stops at the 15th minute of the refund's life.
    await settle(id, 0)
    expect(await refundOf(id)).toMatchObject({ status: 'submitting', check_count: 5 })
    expect(await row('select next_check_at <= created_at + interval \'15 minutes\' as capped, next_check_at > now() as ahead from finance.refunds where id = $1', [id])).toEqual({
      capped: true,
      ahead: true,
    })
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 0 })
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect(await mailsOf(id)).toHaveLength(0)
  })

  it('the total unchanged and the refund 15 minutes old: failed NOT_APPLIED, no schedule, the balance free, an audit row', async () => {
    const { p, id } = await inFlight(0, 2000)
    await age(id, '14 minutes 59 seconds')
    expect(await settle(id, 0)).toMatchObject({ status: 'submitting' })
    await age(id, '15 minutes')
    expect(await settle(id, 0)).toEqual({ ok: true, refundId: id, status: 'failed', amount: 2000 })
    expect(await refundOf(id)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED', next_check_at: null, provider_refunded_after: null })
    expect((await audits('refund.failed', id))[0]!.summary).toEqual({ amount: 2000, error: 'NOT_APPLIED' })
    expect(await request(p, { p_amount: 2000, p_allocation: alloc(p.items[0]!, 2000) })).toMatchObject({ ok: true, state: 'new' })
  })

  it('between before and before plus the amount: the difference is recorded as a dashboard refund, this refund\'s before becomes the fetched total, and it stays in flight', async () => {
    const { p, id } = await inFlight(500, 2000)
    expect(await settle(id, 1200)).toEqual({ ok: true, refundId: id, status: 'submitting', amount: 2000 })
    const refund = await refundOf(id)
    expect(refund).toMatchObject({ status: 'submitting', provider_refunded_before: 1200, check_count: 1 })
    const dashboard = (await refundsOf(p.attemptId)).filter((r) => r.source === 'provider_dashboard' && r.amount_halalas === 700)
    expect(dashboard).toHaveLength(1)
    expect(dashboard[0]).toMatchObject({ status: 'succeeded', provider_refunded_before: 500, provider_refunded_after: 1200, allocation: {}, order_id: p.id })
    expect(await confirmed(p.attemptId)).toBe(500 + 700)
    // The same total again changes nothing more (no second difference), and ours may still land.
    expect(await settle(id, 1200)).toMatchObject({ status: 'submitting' })
    expect((await refundsOf(p.attemptId)).filter((r) => r.source === 'provider_dashboard')).toHaveLength(2)
    // Ours lands on top of what was there: before is the fetched total, so the exact total is 1 200 + 2 000.
    expect(await settle(id, 3200)).toMatchObject({ status: 'succeeded' })
    expect(await refundOf(id)).toMatchObject({ provider_refunded_before: 1200, provider_refunded_after: 3200 })
    expect(await confirmed(p.attemptId)).toBe(3200)
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 3200 })
  })

  it('between, and the refund is older than 15 minutes: the difference is recorded and the refund ends NOT_APPLIED in the same call', async () => {
    const { p, id } = await inFlight(0, 2000)
    await age(id, '16 minutes')
    expect(await settle(id, 600)).toEqual({ ok: true, refundId: id, status: 'failed', amount: 2000 })
    expect(await refundOf(id)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED', provider_refunded_before: 600 })
    expect(await confirmed(p.attemptId)).toBe(600)
    expect((await attemptOf(p.attemptId)).provider_refunded_halalas).toBe(600)
  })

  it('the total went down: failed PROVIDER_TOTAL_DECREASED, every owner told once, and the balance free', async () => {
    const { p, id } = await inFlight(3000, 2000)
    expect(await settle(id, 2999)).toEqual({ ok: true, refundId: id, status: 'failed', amount: 2000 })
    expect(await refundOf(id)).toMatchObject({ status: 'failed', error: 'PROVIDER_TOTAL_DECREASED', next_check_at: null })
    expect(await alerts('refund_total_decreased', id)).toBe(await owners())
    const alert = await row("select payload from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1 limit 1", [`refund_total_decreased:${id}:%`])
    expect(alert.payload).toEqual({ alert: 'refund_total_decreased', refundId: id, orderId: p.id })
    expect(await audits('refund.failed', id)).toHaveLength(1)
    // The ledger still holds what was confirmed; the owner sees the PROVIDER_BEHIND on the next try.
    expect(await request(p, { p_provider_refunded: 2999 })).toEqual({ ok: false, code: 'PROVIDER_BEHIND' })
  })

  it('a total read before a dashboard refund this function has since recorded is stale, not a decrease: the refund stays in flight and nobody is alerted', async () => {
    const { id } = await inFlight(300, 500)
    expect(await settle(id, 450)).toMatchObject({ status: 'submitting' })
    expect(await refundOf(id)).toMatchObject({ provider_refunded_before: 450 })
    // A fetch made before that dashboard refund arrives late: the job and the owner's recheck fetch with no lock held.
    for (const stale of [300, 449]) {
      expect(await settle(id, stale)).toMatchObject({ status: 'submitting' })
      expect(await refundOf(id)).toMatchObject({ status: 'submitting', provider_refunded_before: 450 })
    }
    expect((await refundOf(id)).next_check_at).not.toBeNull()
    expect(await alerts('refund_total_decreased', id)).toBe(0)
    // Our own call can still land on top of it.
    expect(await settle(id, 950)).toMatchObject({ status: 'succeeded' })
    // Below the refund's own starting total is a real decrease.
    const other = await inFlight(300, 500)
    expect(await settle(other.id, 450)).toMatchObject({ status: 'submitting' })
    expect(await settle(other.id, 299)).toMatchObject({ status: 'failed' })
    expect((await refundOf(other.id)).error).toBe('PROVIDER_TOTAL_DECREASED')
    expect(await alerts('refund_total_decreased', other.id)).toBe(await owners())
  })

  it('every branch ends within 15 minutes of the refund\'s life: one settle on a refund that old is never left in flight', async () => {
    // before = 3 000, amount = 2 000: the provider's total could be anything from 0 to the payment.
    for (const total of [0, 1, 2999, 3000, 3001, 4999, 5000, 5001, 6000, 6900]) {
      const { id } = await inFlight(3000, 2000)
      await age(id, '16 minutes')
      const reply = await settle(id, total)
      expect(['succeeded', 'failed'], `total ${total}`).toContain(reply.status)
      expect((await refundOf(id)).next_check_at, `total ${total}`).toBeNull()
    }
  })

  it('acts only on a refund in flight: any other is NOT_IN_FLIGHT and unchanged, an unknown one NOT_FOUND, and the job repeating changes nothing', async () => {
    const { p, id } = await inFlight(0, 2000)
    await settle(id, 2000)
    const done = await refundOf(id)
    const order = await orderOf(p.id)
    for (const total of [0, 2000, 5000]) {
      expect(await settle(id, total), String(total)).toEqual({ ok: false, code: 'NOT_IN_FLIGHT', refundId: id, status: 'succeeded', amount: 2000 })
    }
    expect(await refundOf(id)).toEqual(done)
    expect(await orderOf(p.id)).toEqual(order)
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    expect(await mailsOf(id)).toHaveLength(1)
    expect(await settle(randomUUID(), 0)).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('two connections settling the same refund at once: one success, one mail, one surplus row', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { p, id } = await inFlight(0, 2000)
      const [one, two] = await Promise.all([settle(id, 2300, pool[1]), settle(id, 2300, pool[2])])
      expect([one.ok, two.ok].sort()).toEqual([false, true])
      expect([one, two].find((reply) => !reply.ok)).toMatchObject({ code: 'NOT_IN_FLIGHT' })
      const all = await refundsOf(p.attemptId)
      expect(all).toHaveLength(2)
      expect(all.filter((r) => r.source === 'provider_dashboard')).toHaveLength(1)
      expect(await mailsOf(id)).toHaveLength(1)
      expect(await confirmed(p.attemptId)).toBe(2300)
    }
  })

  it('a review payment\'s refund is settled the same way: its surplus is a dashboard refund of the review payment', async () => {
    const r = await review({ mapped: false, amount: 4000 })
    const id = (await requestReview(r, { p_amount: 1500 })).refundId
    expect(await settle(id, 1700)).toMatchObject({ status: 'succeeded' })
    const all = await rows('select * from finance.refunds where review_payment_id = $1 order by created_at, id', [r.paymentId])
    expect(all).toHaveLength(2)
    expect(all.find((refund) => refund.source === 'provider_dashboard')).toMatchObject({
      amount_halalas: 200,
      status: 'succeeded',
      attempt_id: null,
      order_id: null,
      provider_refunded_before: 1500,
      provider_refunded_after: 1700,
    })
    expect(await reviewOf(r.paymentId)).toMatchObject({ provider_refunded_halalas: 1700, closed_at: null })
  })
})

// --- refund_checked ----------------------------------------------------------------------------------------------

describe('refund_checked: a fetch that failed', () => {
  it('backs the refund off 1, 2, 4 ... 60 minutes and keeps the last code', async () => {
    const p = await plain()
    const id = await flight(p)
    const minutes: number[] = []
    for (let round = 1; round <= 8; round += 1) {
      await checked(id, round % 2 ? 'PAYMENT_FETCH_UNAVAILABLE' : 'PAYMENT_FETCH_RATE_LIMITED')
      const refund = await refundOf(id)
      expect(refund).toMatchObject({ status: 'submitting', check_count: round })
      minutes.push(Math.round((await secondsAhead(id)) / 60))
    }
    expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 60, 60])
    expect((await refundOf(id)).error).toBe('PAYMENT_FETCH_RATE_LIMITED')
    // A failed fetch decides nothing: the refund is as it was, in flight, still blocking the next one.
    expect(await request(p)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    expect(await alerts('refund_unverified', id)).toBe(0)
  })

  it('after 24 hours in flight it is no longer scheduled and every owner is told, once; the owner\'s recheck can still settle it', async () => {
    const p = await plain()
    const id = await flight(p, { p_amount: 2000, p_allocation: alloc(p.items[0]!, 2000) })
    await age(id, '25 hours')
    await checked(id)
    const refund = await refundOf(id)
    expect(refund).toMatchObject({ status: 'submitting', next_check_at: null, check_count: 1 })
    expect(await alerts('refund_unverified', id)).toBe(await owners())
    const alert = await row("select payload from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1 limit 1", [`refund_unverified:${id}:%`])
    expect(alert.payload).toEqual({ alert: 'refund_unverified', refundId: id, orderId: p.id })
    await checked(id)
    await checked(id)
    expect(await alerts('refund_unverified', id)).toBe(await owners())
    expect(await refundOf(id)).toMatchObject({ next_check_at: null, check_count: 3 })
    // It waits for the owner's «أعد الفحص», which is `refund_settle` with a fresh fetch: it ends.
    expect(await settle(id, 0)).toMatchObject({ status: 'failed' })
    expect((await refundOf(id)).error).toBe('NOT_APPLIED')
  })

  it('a refund that is not in flight is left alone, and an unknown one is ignored', async () => {
    const p = await plain()
    const id = await flight(p)
    await result(id, 'succeeded', 1000)
    const done = await refundOf(id)
    await checked(id)
    expect(await refundOf(id)).toEqual(done)
    await checked(randomUUID())
    await age(id, '48 hours')
    await checked(id)
    expect(await alerts('refund_unverified', id)).toBe(0)
  })
})

// --- refund_record_external --------------------------------------------------------------------------------------

describe('refund_record_external', () => {
  it('records the difference as one succeeded, unallocated refund from the dashboard, with its effects', async () => {
    const p = await three()
    const reply = await external(p, 3000, 'refunded', { p_reason: 'استرداد يدوي من لوحة بوابة الدفع' })
    expect(reply).toEqual({ ok: true, refundId: expect.any(String), status: 'succeeded', amount: 3000 })
    const refund = await refundOf(reply.refundId)
    expect(refund).toMatchObject({
      status: 'succeeded',
      source: 'provider_dashboard',
      amount_halalas: 3000,
      allocation: {},
      reason: 'استرداد يدوي من لوحة بوابة الدفع',
      provider_refunded_before: 0,
      provider_refunded_after: 3000,
      attempt_id: p.attemptId,
      order_id: p.id,
      review_payment_id: null,
      requested_by: ownerUser.userId,
      next_check_at: null,
    })
    expect(await attemptOf(p.attemptId)).toMatchObject({ provider_refunded_halalas: 3000 })
    const trail = await audits('refund.external', reply.refundId)
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ actor: ownerUser.userId })
    expect(await mailsOf(reply.refundId)).toHaveLength(1)
    // Unallocated and partial: no entitlement is revoked, the order is not refunded.
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at === null)).toBe(true)
    // The ledger equals the provider again: the next refund request goes through.
    expect(await request(p, { p_provider_refunded: 3000 })).toMatchObject({ ok: true, state: 'new' })
  })

  it('a delta counts from the confirmed refunds, and the same total again is no delta', async () => {
    const p = await three()
    expect(await external(p, 1000)).toMatchObject({ ok: true, amount: 1000 })
    expect(await external(p, 1000)).toEqual({ ok: false, code: 'NO_DELTA' })
    expect(await external(p, 999)).toEqual({ ok: false, code: 'NO_DELTA' })
    expect(await external(p, 0)).toEqual({ ok: false, code: 'NO_DELTA' })
    expect(await external(p, 1800)).toMatchObject({ ok: true, amount: 800 })
    expect(await confirmed(p.attemptId)).toBe(1800)
    expect(await refundsOf(p.attemptId)).toHaveLength(2)
  })

  it('a refund the provider shows above what was captured is EXCEEDS_BALANCE, and a payment that is not paid is NOT_REFUNDABLE', async () => {
    const p = await plain()
    expect(await external(p, 3501)).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    const pending = await place([{ variantId: await digital(), quantity: 1 }])
    const started = await start(pending)
    expect(await external(p, 100, 'refunded', { p_attempt: started.attemptId })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await external(p, 100, 'refunded', { p_attempt: randomUUID() })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await external(p, 100, 'refunded', { p_attempt: null, p_review_payment: randomUUID() })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
    expect(await refundsOf(p.attemptId)).toHaveLength(0)
  })

  it('refused while a refund of the target is in flight: it is not recorded over a refund that may still land', async () => {
    const p = await plain()
    await flight(p)
    expect(await external(p, 700)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
  })

  it('a full refund made outside refunds the order and revokes every entitlement, a zero-paid one included', async () => {
    const free = await digital(3000)
    const freeProduct = (await row('select product_id from public.product_variants where id = $1', [free])).product_id as string
    const p = await paid([{ variantId: free, quantity: 1 }, { variantId: await digital(5000), quantity: 1 }], { couponCode: await freeCoupon(freeProduct) })
    expect(await entitlementsOf(p.id)).toHaveLength(2)
    expect(await external(p, 5000)).toMatchObject({ ok: true, amount: 5000 })
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    const entitlements = await entitlementsOf(p.id)
    expect(entitlements.map((entitlement) => entitlement.revoked_at !== null)).toEqual([true, true])
    expect(entitlements.every((entitlement) => entitlement.revoke_reason === 'refund')).toBe(true)
  })

  it('a void is the whole unrefunded amount, whatever total the provider shows', async () => {
    const p = await three() // 14 900
    expect(await external(p, 2000)).toMatchObject({ ok: true })
    expect(await external(p, 0, 'voided')).toEqual({ ok: true, refundId: expect.any(String), status: 'succeeded', amount: 12_900 })
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect(await confirmed(p.attemptId)).toBe(14_900)
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
    // Nothing is left to record, and the payment cannot be refunded again.
    expect(await external(p, 0, 'voided')).toEqual({ ok: false, code: 'NO_DELTA' })
    expect(await request(p, { p_provider_refunded: 0 })).toEqual({ ok: false, code: 'PROVIDER_BEHIND' })
  })

  it('a delta equal to a NOT_APPLIED refund\'s amount is that refund landing late: it is reopened as succeeded with its own allocation', async () => {
    const p = await three()
    const b = p.items[1]!
    const id = await flight(p, { p_amount: 3500, p_allocation: alloc(b, 3500) })
    await age(id, '16 minutes')
    expect(await settle(id, 0)).toMatchObject({ status: 'failed' })
    expect((await refundOf(id)).error).toBe('NOT_APPLIED')
    // The provider applies it after all: the next request is caught by PROVIDER_AHEAD, and the owner adopts it.
    expect(await request(p, { p_provider_refunded: 3500 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    const reply = await external(p, 3500)
    expect(reply).toEqual({ ok: true, refundId: id, status: 'succeeded', amount: 3500 })
    const refund = await refundOf(id)
    expect(refund).toMatchObject({
      status: 'succeeded',
      source: 'admin',
      allocation: { items: [{ itemId: b.id, amount: 3500 }], shipping: 0 },
      provider_refunded_before: 0,
      provider_refunded_after: 3500,
      error: null,
      next_check_at: null,
    })
    expect(refund.succeeded_at).not.toBeNull()
    expect(await refundsOf(p.attemptId)).toHaveLength(1)
    // The owner's recording is audited as such, and the late landing is the extra row.
    expect(await audits('refund.late_applied', id)).toHaveLength(1)
    const recorded = await audits('refund.external', id)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ actor: ownerUser.userId, summary: { amount: 3500, lateApplied: true } })
    expect((await audits('refund.late_applied', id))[0]).toMatchObject({ actor: ownerUser.userId })
    // Its allocation counts: item B is fully refunded, so its entitlement is revoked and the others are not.
    const entitlements = await entitlementsOf(p.id)
    expect(entitlements.map((entitlement) => entitlement.revoked_at !== null)).toEqual([true, false])
    expect(await mailsOf(id)).toHaveLength(1)
    expect(await external(p, 3500)).toEqual({ ok: false, code: 'NO_DELTA' })
  })

  it('a NOT_APPLIED refund that lands after the same item was refunded again is not reopened: the item is never allocated more than it cost and stays fully refunded', async () => {
    const p = await three()
    const b = p.items[1]!
    const full = async (): Promise<boolean> => (await row('select finance.item_fully_refunded($1) as full', [b.id])).full
    const allocated = (): Promise<number> =>
      count(
        `select coalesce(sum((a.value ->> 'amount')::int), 0)::int as n from finance.refunds r
          cross join lateral jsonb_array_elements(coalesce(r.allocation -> 'items', '[]'::jsonb)) a
          where r.attempt_id = $1 and r.status = 'succeeded' and a.value ->> 'itemId' = $2`,
        [p.attemptId, b.id],
      )
    const late = await flight(p, { p_amount: 3500, p_allocation: alloc(b, 3500) })
    await age(late, '16 minutes')
    expect(await settle(late, 0)).toMatchObject({ status: 'failed' })
    // The owner refunds the same item again, and that one succeeds.
    const again = await flight(p, { p_amount: 3500, p_allocation: alloc(b, 3500) })
    expect(await result(again, 'succeeded', 3500)).toMatchObject({ status: 'succeeded' })
    expect(await full()).toBe(true)
    // The first one lands after all: the provider now shows both.
    expect(await request(p, { p_provider_refunded: 7000 })).toEqual({ ok: false, code: 'PROVIDER_AHEAD' })
    const reply = await external(p, 7000)
    expect(reply).toMatchObject({ ok: true, status: 'succeeded', amount: 3500 })
    expect(reply.refundId).not.toBe(late)
    expect(await refundOf(reply.refundId)).toMatchObject({ source: 'provider_dashboard', allocation: {} })
    expect(await refundOf(late)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    // The money is all in the ledger, and the item's own allocation is what it cost, no more.
    expect(await confirmed(p.attemptId)).toBe(7000)
    expect(await allocated()).toBe(3500)
    expect(await full()).toBe(true)
  })

  it('a delta that is not the NOT_APPLIED amount, or not of the most recent one, is a new dashboard refund and the old one stays failed', async () => {
    const p = await three()
    const aged = async (amount: number, total: number): Promise<string> => {
      const id = await flight(p, { p_amount: amount, p_allocation: alloc(p.items[0]!, amount), p_provider_refunded: total })
      await age(id, '16 minutes')
      await settle(id, total)
      expect((await refundOf(id)).error).toBe('NOT_APPLIED')
      return id
    }
    const older = await aged(700, 0)
    const newer = await aged(900, 0)
    // 700 is the older one's amount, not the most recent one's (900).
    const reply = await external(p, 700)
    expect(reply).toMatchObject({ ok: true, amount: 700 })
    expect(reply.refundId).not.toBe(older)
    expect(await refundOf(reply.refundId)).toMatchObject({ source: 'provider_dashboard', allocation: {} })
    expect(await refundOf(older)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    expect(await refundOf(newer)).toMatchObject({ status: 'failed', error: 'NOT_APPLIED' })
    // The most recent one's amount reopens it.
    expect(await external(p, 1600)).toEqual({ ok: true, refundId: newer, status: 'succeeded', amount: 900 })
    expect(await refundOf(older)).toMatchObject({ status: 'failed' })
  })

  it('a review payment: a refund made outside is recorded against it, and a void closes it', async () => {
    const r = await review({ mapped: false, amount: 4000 })
    const partial = await call('refund_record_external', {
      p_actor: ownerUser.userId, p_attempt: null, p_review_payment: r.paymentId, p_provider_refunded: 1500, p_provider_status: 'refunded', p_reason: 'استرداد يدوي',
    })
    expect(partial).toMatchObject({ ok: true, amount: 1500 })
    expect(await refundOf(partial.refundId)).toMatchObject({ review_payment_id: r.paymentId, attempt_id: null, order_id: null, source: 'provider_dashboard' })
    expect(await reviewOf(r.paymentId)).toMatchObject({ provider_refunded_halalas: 1500, closed_at: null })
    expect(await mailsOf(partial.refundId)).toHaveLength(0)
    const voided = await call('refund_record_external', {
      p_actor: ownerUser.userId, p_attempt: null, p_review_payment: r.paymentId, p_provider_refunded: 0, p_provider_status: 'voided', p_reason: 'أُلغيت الدفعة',
    })
    expect(voided).toMatchObject({ ok: true, amount: 2500 })
    expect(await reviewOf(r.paymentId)).toMatchObject({ closed_reason: 'refunded' })
    expect((await reviewOf(r.paymentId)).closed_at).not.toBeNull()
  })
})

// --- the success effects -----------------------------------------------------------------------------------------

describe('the success effects of a refund of a paying attempt', () => {
  it('entitlements: an item is revoked when its refunded total equals what it cost, across refunds; the others stay granted', async () => {
    const p = await three()
    const [a, b, c] = p.items as [Item, Item, Item]
    const revoked = async () => (await entitlementsOf(p.id)).map((entitlement) => entitlement.revoked_at !== null)
    // The physical line has no entitlement: a partial refund of the digital one revokes nothing.
    expect((await entitlementsOf(p.id)).map((entitlement) => entitlement.line_no)).toEqual([2, 3])
    let total = 0
    const refund = async (item: Item, amount: number, shipping = 0): Promise<string> => {
      const id = await flight(p, { p_amount: amount + shipping, p_allocation: alloc(item, amount, shipping), p_provider_refunded: total })
      total += amount + shipping
      expect(await result(id, 'succeeded', total)).toMatchObject({ status: 'succeeded' })
      return id
    }
    await refund(b, 1000)
    expect(await revoked()).toEqual([false, false])
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    await refund(b, 2500)
    expect(await revoked()).toEqual([true, false])
    expect((await entitlementsOf(p.id))[0]).toMatchObject({ revoke_reason: 'refund' })
    await refund(c, 2000)
    expect(await revoked()).toEqual([true, true])
    // The physical line and the shipping are still unrefunded: the order is paid, not refunded.
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    await refund(a, 6900, 2500)
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect(await confirmed(p.attemptId)).toBe(p.total)
  })

  it('the order becomes refunded only when the confirmed refunds equal the captured amount, with a version bump', async () => {
    const p = await plain() // 3 500
    const before = await orderOf(p.id)
    const first = await flight(p, { p_amount: 3499, p_allocation: alloc(p.items[0]!, 3499) })
    await result(first, 'succeeded', 3499)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid', version: before.version })
    const last = await flight(p, { p_amount: 1, p_allocation: alloc(p.items[0]!, 1), p_provider_refunded: 3499 })
    await result(last, 'succeeded', 3500)
    const after = await orderOf(p.id)
    expect(after).toMatchObject({ status: 'refunded', version: before.version + 1 })
    expect(await attemptOf(p.attemptId)).toMatchObject({ status: 'paid', provider_refunded_halalas: 3500 })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
  })

  it('a zero-paid item is not refunded by another line\'s refund, and is revoked when the attempt is fully refunded', async () => {
    const free = await digital(3000)
    const freeProduct = (await row('select product_id from public.product_variants where id = $1', [free])).product_id as string
    const p = await paid([{ variantId: free, quantity: 1 }, { variantId: await digital(5000), quantity: 1 }], { couponCode: await freeCoupon(freeProduct) })
    const [freeItem, paidItem] = p.items as [Item, Item]
    expect(freeItem.paid).toBe(0)
    const revoked = async () => (await entitlementsOf(p.id)).map((entitlement) => entitlement.revoked_at !== null)
    expect(await revoked()).toEqual([false, false])
    const part = await flight(p, { p_amount: 2000, p_allocation: alloc(paidItem, 2000) })
    await result(part, 'succeeded', 2000)
    expect(await revoked()).toEqual([false, false])
    const rest = await flight(p, { p_amount: 3000, p_allocation: alloc(paidItem, 3000), p_provider_refunded: 2000 })
    await result(rest, 'succeeded', 5000)
    // The paid item is revoked by its own refund; the free one only because the whole attempt is refunded.
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect(await revoked()).toEqual([true, true])
  })

  it('an unallocated full refund revokes every entitlement; an unallocated partial one revokes none', async () => {
    const p = await three()
    expect(await external(p, 14_000)).toMatchObject({ ok: true })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at === null)).toBe(true)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid' })
    expect(await external(p, 14_900)).toMatchObject({ ok: true, amount: 900 })
    expect((await entitlementsOf(p.id)).every((entitlement) => entitlement.revoked_at !== null)).toBe(true)
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
  })

  it('the preorder reservation of a fully refunded item is released, so its capacity is free; a partial refund keeps it; stock is never touched', async () => {
    const pre = await preorder(8000, 3)
    const normal = await physical(4000, 10)
    const p = await paid([{ variantId: pre, quantity: 2 }, { variantId: normal, quantity: 1 }])
    const [preItem, normalItem] = p.items as [Item, Item]
    const reservation = (variantId: string) => row('select state, released_at, preorder from finance.inventory_reservations where order_id = $1 and variant_id = $2', [p.id, variantId])
    const committed = () => count('select finance.preorder_committed($1) as n', [pre])
    expect(await reservation(pre)).toMatchObject({ state: 'committed', preorder: true })
    expect(await committed()).toBe(2)
    const stockBefore = [await stockOf(pre), await stockOf(normal)]

    const part = await flight(p, { p_amount: 16_000 - 1, p_allocation: alloc(preItem, 15_999) })
    await result(part, 'succeeded', 15_999)
    expect(await reservation(pre)).toMatchObject({ state: 'committed', released_at: null })
    expect(await committed()).toBe(2)

    const rest = await flight(p, { p_amount: 1, p_allocation: alloc(preItem, 1), p_provider_refunded: 15_999 })
    await result(rest, 'succeeded', 16_000)
    expect(await reservation(pre)).toMatchObject({ state: 'released', preorder: true })
    expect((await reservation(pre)).released_at).not.toBeNull()
    expect(await committed()).toBe(0)
    // The ordinary line is untouched: its reservation stays committed, and no stock moved anywhere.
    expect(await reservation(normal)).toMatchObject({ state: 'committed', preorder: false })
    expect([await stockOf(pre), await stockOf(normal)]).toEqual(stockBefore)
    // A full refund of the rest releases nothing more and still touches no stock.
    const last = await flight(p, { p_amount: 4000 + p.shipping, p_allocation: alloc(normalItem, 4000, p.shipping), p_provider_refunded: 16_000 })
    await result(last, 'succeeded', 16_000 + 4000 + p.shipping)
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect(await reservation(normal)).toMatchObject({ state: 'committed' })
    expect([await stockOf(pre), await stockOf(normal)]).toEqual(stockBefore)
  })

  it('a full refund of the attempt releases every preorder reservation, whatever the allocation', async () => {
    const pre = await preorder(8000, 3)
    const p = await paid([{ variantId: pre, quantity: 1 }, { variantId: await digital(), quantity: 1 }])
    expect(await external(p, p.total)).toMatchObject({ ok: true })
    expect(await row('select state from finance.inventory_reservations where order_id = $1 and variant_id = $2', [p.id, pre])).toEqual({ state: 'released' })
    expect(await count('select finance.preorder_committed($1) as n', [pre])).toBe(0)
  })

  it('a linked return becomes refunded with the refund that succeeded; a failed refund leaves it received and unlinked', async () => {
    const p = await plain()
    const received = (await row(`insert into finance.return_requests (order_id, items, reason, state) values ($1, '[]'::jsonb, 'سبب', 'received') returning id`, [p.id])).id as string
    const failed = await flight(p, { p_return: received })
    await result(failed, 'failed', null, 'REFUND_REFUSED')
    expect(await row('select state, refund_id from finance.return_requests where id = $1', [received])).toEqual({ state: 'received', refund_id: null })
    // The same return can be tried again.
    const id = await flight(p, { p_return: received })
    expect(await row('select state, refund_id from finance.return_requests where id = $1', [received])).toEqual({ state: 'received', refund_id: null })
    await result(id, 'succeeded', 1000)
    expect(await row('select state, refund_id from finance.return_requests where id = $1', [received])).toEqual({ state: 'refunded', refund_id: id })
    // Now it is refunded: no other refund can claim it.
    expect(await request(p, { p_return: received, p_provider_refunded: 1000 })).toEqual({ ok: false, code: 'INVALID_RETURN' })
  })

  it('a linked return is settled by the job\'s path too', async () => {
    const p = await plain()
    const received = (await row(`insert into finance.return_requests (order_id, items, reason, state) values ($1, '[]'::jsonb, 'سبب', 'received') returning id`, [p.id])).id as string
    const id = await flight(p, { p_return: received })
    await settle(id, 1000)
    expect(await row('select state, refund_id from finance.return_requests where id = $1', [received])).toEqual({ state: 'refunded', refund_id: id })
  })

  it('one order_refunded mail per succeeded refund, with ids only, however many times the result is repeated', async () => {
    const p = await plain()
    const id = await flight(p)
    await result(id, 'succeeded', 1000)
    await result(id, 'succeeded', 1000)
    await settle(id, 1000)
    const mails = await mailsOf(id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({
      kind: 'order_refunded',
      priority: 0,
      recipient: p.email.toLowerCase(),
      payload: { orderId: p.id, refundId: id },
      status: 'pending',
    })
    expect(Object.keys(mails[0]!.payload).sort()).toEqual(['orderId', 'refundId'])
    // And the dispatcher's data function reads exactly that refund.
    const data = await call('order_email_data', { p_order: p.id, p_refund: id })
    expect(data).toMatchObject({ orderId: p.id, refund: { amount: 1000 }, refundedHalalas: 1000 })
  })

  it('a paid_needs_resolution order is refunded the same way: the state table\'s other row', async () => {
    const variant = await physical(5000, 5)
    const placed = await place([{ variantId: variant, quantity: 1 }])
    const started = await start(placed)
    await postgres.query('update public.product_variants set stock = 0 where id = $1', [variant])
    expect(await apply(started)).toMatchObject({ outcome: 'paid_needs_resolution' })
    const p: Paid = {
      ...placed,
      attemptId: started.attemptId,
      paymentId: started.paymentId,
      invoiceId: started.invoiceId,
      shipping: 2500,
      items: (await rows('select id, variant_id, fulfillment, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1', [placed.id])).map((item) => ({ id: item.id, variantId: item.variant_id, fulfillment: item.fulfillment, paid: Number(item.paid) })),
    }
    const first = await flight(p, { p_amount: 2500, p_allocation: { items: [], shipping: 2500 } })
    await result(first, 'succeeded', 2500)
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid_needs_resolution' })
    const rest = await flight(p, { p_amount: 5000, p_allocation: alloc(p.items[0]!, 5000), p_provider_refunded: 2500 })
    await result(rest, 'succeeded', 7500)
    expect(await orderOf(p.id)).toMatchObject({ status: 'refunded' })
    expect(await stockOf(variant)).toBe(0)
  })
})

describe('refunds of a review payment leave the order alone', () => {
  it('a payment of the wrong amount: its refunds close the review row when they equal its amount, and the order, its attempt and its mail are never touched', async () => {
    const r = await review({ mapped: true }) // the order's total + 700
    const order = await orderOf(r.orderId!)
    const attempt = await attemptOf(r.attemptId!)
    expect(order.status).toBe('pending_payment')
    const first = await requestReview(r, { p_amount: 500, p_order: r.orderId })
    expect(first).toMatchObject({ ok: true, state: 'new', providerPaymentId: r.paymentId })
    const stored = await refundOf(first.refundId)
    expect(stored).toMatchObject({ review_payment_id: r.paymentId, attempt_id: null, order_id: r.orderId, allocation: {}, status: 'submitting' })
    expect(await result(first.refundId, 'succeeded', 500)).toMatchObject({ ok: true, status: 'succeeded' })
    expect(await reviewOf(r.paymentId)).toMatchObject({ provider_refunded_halalas: 500, closed_at: null })
    // The remainder, without naming the order (it may be absent): the row is closed refunded.
    const rest = await requestReview(r, { p_amount: r.amount - 500, p_order: null, p_provider_refunded: 500 })
    expect(rest).toMatchObject({ ok: true, state: 'new' })
    expect(await result(rest.refundId, 'succeeded', r.amount)).toMatchObject({ ok: true, status: 'succeeded' })
    const closed = await reviewOf(r.paymentId)
    expect(closed).toMatchObject({ provider_refunded_halalas: r.amount, closed_reason: 'refunded' })
    expect(closed.closed_at).not.toBeNull()
    expect(await orderOf(r.orderId!)).toEqual(order)
    expect(await attemptOf(r.attemptId!)).toEqual(attempt)
    expect(await entitlementsOf(r.orderId!)).toEqual([])
    for (const id of [first.refundId, rest.refundId]) expect(await mailsOf(id)).toHaveLength(0)
    expect(await audits('refund.succeeded', rest.refundId)).toHaveLength(1)
    // A review closed as refunded is not refundable again.
    expect(await requestReview(r, { p_provider_refunded: r.amount })).toEqual({ ok: false, code: 'NOT_REFUNDABLE' })
  })

  it('a review payment is never refunded beyond its own amount', async () => {
    const r = await review({ mapped: false, amount: 1200 })
    expect(await requestReview(r, { p_amount: 1201 })).toEqual({ ok: false, code: 'EXCEEDS_BALANCE' })
    expect(await requestReview(r, { p_amount: 1200 })).toMatchObject({ ok: true, state: 'new' })
  })

  it('one in flight per review payment: the second is REFUND_IN_FLIGHT, and two connections at once reserve once', async () => {
    const r = await review({ mapped: false, amount: 5000 })
    expect(await requestReview(r, { p_amount: 2000 })).toMatchObject({ ok: true, state: 'new' })
    expect(await requestReview(r, { p_amount: 1 })).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    for (let round = 0; round < 3; round += 1) {
      const q = await review({ mapped: round % 2 === 0 })
      const [one, two] = await Promise.all([requestReview(q, { p_amount: 1000 }, pool[1]), requestReview(q, { p_amount: 1000 }, pool[2])])
      expect([one, two].map((reply) => (reply.ok ? reply.state : reply.code)).sort(), `round ${round}`).toEqual(['REFUND_IN_FLIGHT', 'new'])
      expect(await count('select count(*)::int as n from finance.refunds where review_payment_id = $1', [q.paymentId])).toBe(1)
    }
  })

  it('a review payment\'s failed refund frees its balance, and its refund ref answers the review payment id', async () => {
    const r = await review({ mapped: false, amount: 3000 })
    const first = await requestReview(r, { p_amount: 3000 })
    expect(await call('refund_ref', { p_actor: ownerUser.userId, p_refund: first.refundId })).toEqual({
      ok: true,
      refundId: first.refundId,
      status: 'submitting',
      providerPaymentId: r.paymentId,
    })
    await result(first.refundId, 'failed', null, 'REFUND_REFUSED')
    expect(await requestReview(r, { p_amount: 3000 })).toMatchObject({ ok: true, state: 'new' })
  })
})
