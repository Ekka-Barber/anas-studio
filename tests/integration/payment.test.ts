// P08 round 2: the payment schema and the payment core of
// `supabase/migrations/20261002100000_payment_core.sql` against the real local
// database. The server-only functions are called as `service_role` (the Edge
// Functions' role, D32) through direct sessions, like checkout.test.ts, which
// also creates the orders here: every order goes through `checkout_create`
// with its own email and session. What only the owner or the database could
// write (an aged row, a lowered stock) is written as the local `postgres`
// superuser. Nothing here reaches Moyasar: the objects `apply_verified_payment`
// receives are built by the test, in the shape the Edge Functions normalize.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved in
// beforeAll and restored in afterAll; every fixture carries a per-run unique
// slug, SKU, code, email or event id.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { anonClient, createStaff, pgRpc, serviceRoleDb, signIn, uniqueEmail, type Role } from './support'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const PEPPER = `payment-pepper-${randomUUID()}`
const REV = { store: 1, delivery: 1, refund: 1 }
const ZERO = '0'.repeat(64)
const EVENT_PREFIX = `p08r2-${Date.now()}-${process.pid}-`

type Row = Record<string, any>

/** The buyer's access token and its hash, exactly as the Edge Function computes them. */
function tokenFor(idempotencyKey: string): string {
  return createHmac('sha256', PEPPER).update(`order-access:${idempotencyKey}`).digest('base64url')
}
function hashFor(token: string): string {
  return createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex')
}
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

let postgres: Client
/** Six `service_role` sessions: the main one plus the concurrency tests' own connections. */
const pool: Client[] = []
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''

type Member = { userId: string; email: string }
/**
 * The staff this run created. They are made inactive in afterAll: the shared
 * local database would otherwise keep every run's owners active, and
 * staff-admin.test.ts pauses every active owner one by one.
 */
const staffMade: string[] = []
async function makeStaff(role: Role, overrides: { active?: boolean } = {}): Promise<Member> {
  const member = await createStaff(role, overrides)
  staffMade.push(member.userId)
  return member
}
// One staff member and one real session per role, shared by the access tests.
let ownerUser: Member
let editorUser: Member
let operationsUser: Member
let ownerClient: SupabaseClient
let editorClient: SupabaseClient
let operationsClient: SupabaseClient

/** What this run created, retired in afterAll. */
const created = { products: [] as string[], rates: [] as string[], coupons: [] as string[], orders: [] as string[] }

let counter = 0
function unique(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}
const ipHash = (): string => sha256(unique('ip'))

const call = (fn: string, args: Record<string, unknown>, client: Client = pool[0]!): Promise<any> =>
  pgRpc(client)(fn, args) as Promise<any>

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

/** Seconds from the database's clock to a stored time (never the test's own clock). */
async function secondsAhead(table: 'payment_attempts' | 'payment_events', idColumn: string, id: string, column: string): Promise<number> {
  return Number(
    (await row(`select extract(epoch from (${column} - now())) as s from finance.${table} where ${idColumn} = $1`, [id])).s,
  )
}

const owners = (): Promise<number> =>
  count(
    "select count(*)::int as n from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'owner' and u.email is not null",
  )
const alerts = (alert: string, subject: string): Promise<number> =>
  count("select count(*)::int as n from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1", [`${alert}:${subject}:%`])
const receipts = (orderId: string): Promise<Row[]> =>
  rows("select * from finance.email_outbox where kind = 'receipt' and dedupe_key = $1", [`receipt:${orderId}`])

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  for (let i = 0; i < 6; i += 1) pool.push(await serviceRoleDb())
  startedAt = (await row('select now() as t')).t
  ownerUser = await makeStaff('owner')
  editorUser = await makeStaff('editor')
  operationsUser = await makeStaff('operations')
  ownerClient = await signIn(ownerUser.email)
  editorClient = await signIn(editorUser.email)
  operationsClient = await signIn(operationsUser.email)
  settingsSaved = (
    await row(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  )
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع', seller_address = 'تبوك',
       seller_registration = 'REG-P08', policy_revisions = $1::jsonb where id = 1`,
    [JSON.stringify(REV)],
  )
  // The whole-store daily bucket (500 a day) is shared by every run on this machine.
  await postgres.query("delete from finance.rate_limits where bucket = 'checkout:all'")
  await postgres.query('delete from finance.payment_events where event_id like $1', ['p08r2-%'])
  city = await makeRate(2500)
})

afterAll(async () => {
  // Fixtures cannot be deleted (orders reference them), so they leave the
  // local store: products archived, city rates and coupons disabled, nothing
  // of this run left due for the reconciliation job or waiting in the outbox.
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  await postgres.query('update public.coupons set enabled = false where id = any($1::uuid[])', [created.coupons])
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  await postgres.query('delete from finance.payment_events where event_id like $1', [`${EVENT_PREFIX}%`])
  // (Only while another owner remains: a database that has none keeps this run's.)
  await postgres.query(
    `update public.staff set active = false
      where user_id = any($1::uuid[])
        and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> all($1::uuid[]))`,
    [staffMade],
  )
  await postgres.query('delete from finance.refunds where created_at >= $1', [startedAt])
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

// --- fixtures (the superuser writes what only the owner could, faster) ------

async function makeProduct(status = 'published'): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const id = (
    await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', $3) returning id`, [
      slug,
      `منتج ${slug}`,
      status,
    ])
  ).id as string
  created.products.push(id)
  return id
}

type VariantSpec = {
  fulfillment: 'digital' | 'physical' | 'signed'
  price: number
  stock?: number | null
  low?: number | null
}

async function makeVariant(productId: string, spec: VariantSpec): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold)
       values ($1, $2, $3, $4, $5, true, $6, $7) returning id`,
      [productId, sku, `خيار ${sku}`, spec.fulfillment, spec.price, spec.stock ?? null, spec.low ?? null],
    )
  ).id as string
}
const digital = async (price = 3500): Promise<string> => makeVariant(await makeProduct(), { fulfillment: 'digital', price })
const physical = async (price: number, stock: number, low?: number): Promise<string> =>
  makeVariant(await makeProduct(), { fulfillment: 'physical', price, stock, low })

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

async function makeCoupon(spec: { percentBp: number; usageLimit?: number | null }): Promise<{ id: string; code: string }> {
  const code = unique('CODE').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = (
    await row(
      `insert into public.coupons (code, kind, percent_bp, usage_limit, enabled) values ($1, 'percent', $2, $3, true) returning id`,
      [code, spec.percentBp, spec.usageLimit ?? null],
    )
  ).id as string
  created.coupons.push(id)
  return { id, code }
}

/** A paid file for a digital variant, as `paid_asset_set` will write it (round 7). */
async function attachFile(variantId: string): Promise<string> {
  const key = `assets/${variantId}/${randomUUID()}`
  const asset = await row(
    `insert into finance.paid_assets (variant_id, storage_key, filename, mime, bytes) values ($1, $2, 'book.pdf', 'application/pdf', 1000) returning id`,
    [variantId, key],
  )
  await postgres.query('update public.product_variants set digital_asset = $2 where id = $1', [variantId, key])
  return asset.id
}

type Line = { variantId: string; quantity: number; dedication?: string }
type Placed = { id: string; number: string; total: number; key: string; hash: string; email: string }

/** Quotes the cart, then creates the order with that quote's hash: a pending order holding its units. */
async function place(
  lines: Line[],
  opts: { couponCode?: string | null; environment?: 'test' | 'live'; email?: string } = {},
): Promise<Placed> {
  const priced = await call('checkout_quote', {
    p_ip_hash: ipHash(),
    p_lines: lines,
    p_city_key: city,
    p_coupon_code: opts.couponCode ?? null,
  })
  expect(priced.ok, JSON.stringify(priced)).toBe(true)
  const key = randomUUID()
  const email = opts.email ?? uniqueEmail('payer')
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
    p_environment: opts.environment ?? 'test',
  })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  created.orders.push(result.order.id)
  return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, key, hash: hashFor(tokenFor(key)), email }
}
/** One digital line: an order with nothing to count, for the tests about the attempt itself. */
const plain = async (): Promise<Placed> => place([{ variantId: await digital(), quantity: 1 }])

const begin = (placed: Placed, over: Record<string, unknown> = {}): Promise<any> =>
  call('payment_attempt_begin', {
    p_order_number: placed.number,
    p_access_token_hash: placed.hash,
    p_mode: 'test',
    p_ip_hash: null,
    ...over,
  })
const adopt = (attemptId: string, invoiceId: string, over: Record<string, unknown> = {}): Promise<any> =>
  call('payment_attempt_created', {
    p_attempt: attemptId,
    p_invoice_id: invoiceId,
    p_invoice_url: `http://127.0.0.1:54390/invoices/${invoiceId}`,
    p_expires_at: null,
    ...over,
  })
const close = (attemptId: string, status: string, error: string | null = null): Promise<any> =>
  call('payment_attempt_close', { p_attempt: attemptId, p_status: status, p_error: error })

type Started = { attemptId: string; invoiceId: string; paymentId: string; placed: Placed }

/** begin, then created: a pending attempt with an invoice (what `checkout`'s invoice step leaves). */
async function start(placed: Placed, mode = 'test'): Promise<Started> {
  const begun = await begin(placed, { p_mode: mode })
  expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, state: 'new' })
  const invoiceId = randomUUID()
  expect(await adopt(begun.attemptId, invoiceId)).toEqual({ ok: true })
  return { attemptId: begun.attemptId, invoiceId, paymentId: randomUUID(), placed }
}

type Facts = Partial<{
  paymentId: string
  status: string
  amount: number
  currency: string
  fee: number | null
  refunded: number
  payInvoiceId: string
  invoiceId: string
  invoiceStatus: string
  invoiceAmount: number
}>

/** The normalized objects the Edge Function hands over: the payment and its invoice. */
function facts(s: Started, o: Facts = {}) {
  return {
    payment: {
      id: o.paymentId ?? s.paymentId,
      status: o.status ?? 'paid',
      amount: o.amount ?? s.placed.total,
      currency: o.currency ?? 'SAR',
      fee: o.fee === undefined ? 150 : o.fee,
      refunded: o.refunded ?? 0,
      invoiceId: o.payInvoiceId ?? s.invoiceId,
      sourceType: 'creditcard',
      sourceCompany: 'mada',
    },
    invoice: {
      id: o.invoiceId ?? s.invoiceId,
      status: o.invoiceStatus ?? 'paid',
      amount: o.invoiceAmount ?? s.placed.total,
      currency: 'SAR',
    },
  }
}

function apply(
  s: Started,
  o: Facts = {},
  c: { client?: Client; mode?: string; live?: boolean | null; eventId?: string | null; invoiceId?: string } = {},
): Promise<any> {
  const f = facts(s, o)
  return call(
    'apply_verified_payment',
    {
      p_invoice_id: c.invoiceId ?? s.invoiceId,
      p_payment: f.payment,
      p_invoice: f.invoice,
      p_mode: c.mode ?? 'test',
      p_live: c.live === undefined ? null : c.live,
      p_event_id: c.eventId === undefined ? null : c.eventId,
    },
    c.client,
  )
}

/** Gives a pending attempt an invoice that an apply can reach without a begin (a row as the job would find it). */
async function insertAttempt(orderId: string, status: string, extra: Record<string, unknown> = {}, expires = '20 minutes', next: string | null = null): Promise<string> {
  const total = (await orderOf(orderId)).total_halalas
  const columns: Record<string, unknown> = { order_id: orderId, status, amount_halalas: total, environment: 'test', ...extra }
  const names = Object.keys(columns)
  const values = Object.values(columns)
  const marks = names.map((_, i) => `$${i + 1}`)
  const sql = `insert into finance.payment_attempts (${names.join(', ')}, invoice_expires_at, next_check_at)
               values (${marks.join(', ')}, now() + $${names.length + 1}::interval, ${next === null ? 'null' : `now() + $${names.length + 2}::interval`})
               returning id`
  return (await row(sql, next === null ? [...values, expires] : [...values, expires, next])).id as string
}

/** Pushes every due or scheduled row of the job's three kinds a month out, so a claim sees only what a test makes due. */
async function parkAll(): Promise<void> {
  await postgres.query("update finance.payment_attempts set next_check_at = now() + interval '30 days' where next_check_at is not null")
  await postgres.query("update finance.payment_events set next_check_at = now() + interval '30 days' where next_check_at is not null")
  await postgres.query("update finance.refunds set next_check_at = now() + interval '30 days' where next_check_at is not null")
}

// --- grants, schema and access ----------------------------------------------

const PUBLIC_FUNCTIONS: Array<[string, Record<string, unknown>]> = [
  ['payment_attempt_begin', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_mode: 'test', p_ip_hash: null }],
  ['payment_attempt_created', { p_attempt: randomUUID(), p_invoice_id: 'inv-1', p_invoice_url: 'http://127.0.0.1/x', p_expires_at: null }],
  ['payment_attempt_close', { p_attempt: randomUUID(), p_status: 'failed', p_error: null }],
  ['apply_verified_payment', { p_invoice_id: 'inv-1', p_payment: {}, p_invoice: {}, p_mode: 'test', p_live: null, p_event_id: null }],
  ['payment_event_record', { p_event_id: 'e-1', p_type: 'payment_paid', p_live: false, p_payment_id: null, p_payload_hash: null }],
  ['payment_event_result', { p_event_id: 'e-1', p_outcome: 'paid', p_error: null }],
  ['payment_check_begin', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_ip_hash: ZERO, p_mode: 'test' }],
  ['payment_state', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_mode: 'test' }],
  ['payment_callback_begin', { p_invoice_id: 'inv-1', p_ip_hash: ZERO, p_mode: 'test' }],
  ['payment_attempt_ref', { p_actor: randomUUID(), p_attempt: randomUUID(), p_mode: 'test' }],
  ['payment_reconcile_claim', { p_mode: 'test' }],
  ['payment_attempt_checked', { p_attempt: randomUUID(), p_source: 'job', p_ok: true, p_provider_status: null, p_error: null }],
  ['payments_kick', {}],
  ['payment_attempt_duplicates', { p_attempt: randomUUID() }],
]
const FINANCE_TABLES = [
  'payment_attempts',
  'payment_reviews',
  'payment_events',
  'entitlements',
  'paid_assets',
  'download_tokens',
  'fulfillments',
  'return_requests',
  'refunds',
  'disputes',
  'variant_availability',
]
const HELPERS = [
  'owner_alert',
  'preorder_committed',
  'availability',
  'item_fully_refunded',
  'attempt_worth_asking',
  'attempt_provider_alerts',
  'payment_view',
  'order_try_commit',
  'disputes_immutable',
]

describe('grants and access', () => {
  it('every new public function refuses anon and an editor with 42501; service_role holds each, nobody else', async () => {
    for (const [fn, args] of PUBLIC_FUNCTIONS) {
      const anon = await anonClient().rpc(fn, args)
      expect(anon.error?.code, `${fn} anon`).toBe('42501')
      const staff = await editorClient.rpc(fn, args)
      expect(staff.error?.code, `${fn} authenticated`).toBe('42501')
    }
    const signatures = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [PUBLIC_FUNCTIONS.map(([fn]) => fn)],
    )
    expect(signatures).toHaveLength(PUBLIC_FUNCTIONS.length)
    for (const { sig } of signatures) {
      for (const [role, want] of [['service_role', true], ['anon', false], ['authenticated', false]] as const) {
        const held = await row('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])
        expect(held.ok, `${role} on ${sig}`).toBe(want)
      }
    }
    // Works as service_role: the answer for an order that is not there.
    expect(await call('payment_state', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_mode: 'test' })).toEqual({
      state: 'unknown',
      hasToken: false,
    })
  })

  it('the finance helpers belong to nobody: no API role, service_role included, may execute them', async () => {
    const signatures = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'finance' and p.proname = any($1::text[])`,
      [HELPERS],
    )
    expect(signatures).toHaveLength(HELPERS.length)
    for (const { sig } of signatures) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const held = await row('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])
        expect(held.ok, `${role} on ${sig}`).toBe(false)
      }
    }
  })

  it('no API role holds any privilege on the new finance tables, and the tables exist', async () => {
    const existing = await rows(
      `select table_name from information_schema.tables where table_schema = 'finance' and table_name = any($1::text[])`,
      [FINANCE_TABLES],
    )
    expect(existing).toHaveLength(FINANCE_TABLES.length)
    const held = await rows(
      `select r.role, p.priv, t.tbl
         from unnest($1::text[]) t(tbl)
        cross join unnest(array['anon', 'authenticated', 'service_role']) r(role)
        cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p(priv)
        where has_table_privilege(r.role, 'finance.' || t.tbl, p.priv)`,
      [FINANCE_TABLES],
    )
    expect(held).toEqual([])
  })

  it('anon cannot read the capacity but reads the public preorder columns; the owner writes the preorder columns and no longer digital_asset', async () => {
    const product = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 5 })
    const file = await makeVariant(product, { fulfillment: 'digital', price: 1500 })
    expect((await anonClient().from('product_variants').select('preorder_capacity').eq('id', variant)).error?.code).toBe('42501')
    const publicRead = await anonClient().from('product_variants').select('preorder, preorder_ships_on, preorder_note').eq('id', variant)
    expect(publicRead.error).toBeNull()
    expect(publicRead.data).toEqual([{ preorder: false, preorder_ships_on: null, preorder_note: null }])

    const owner = ownerClient
    // Only paid_asset_set writes digital_asset from now on, through insert or update.
    expect((await owner.from('product_variants').update({ digital_asset: 'assets/x' }).eq('id', file)).error?.code).toBe('42501')
    const slug = unique('PRE').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    expect(
      (await owner.from('product_variants').insert({ product_id: product, sku: slug, title: 'خيار', fulfillment: 'digital', price_halalas: 100, digital_asset: 'assets/x' })).error?.code,
    ).toBe('42501')

    // The four preorder columns are the owner's, together.
    const set = await owner
      .from('product_variants')
      .update({ preorder: true, preorder_capacity: 3, preorder_ships_on: '2027-02-01', preorder_note: 'يصلك بعد الطباعة' })
      .eq('id', variant)
      .select('id, preorder, preorder_capacity')
    expect(set.error).toBeNull()
    expect(set.data).toEqual([{ id: variant, preorder: true, preorder_capacity: 3 }])
    // The anon key sees the flag, the date and the note, never the capacity.
    const afterSet = await anonClient().from('product_variants').select('preorder, preorder_ships_on, preorder_note').eq('id', variant)
    expect(afterSet.data).toEqual([{ preorder: true, preorder_ships_on: '2027-02-01', preorder_note: 'يصلك بعد الطباعة' }])
    const inserted = await owner
      .from('product_variants')
      .insert({
        product_id: product,
        sku: `${slug}-B`,
        title: 'مسبق',
        fulfillment: 'physical',
        price_halalas: 100,
        stock: 1,
        preorder: true,
        preorder_capacity: 2,
        preorder_ships_on: '2027-02-01',
        preorder_note: 'ملاحظة',
      })
      .select('id')
    expect(inserted.error).toBeNull()

    // A preorder needs its capacity, its date and its note.
    for (const patch of [
      { preorder: true, preorder_capacity: null },
      { preorder: true, preorder_ships_on: null },
      { preorder: true, preorder_note: null },
    ]) {
      const refused = await owner.from('product_variants').update(patch).eq('id', variant)
      expect(refused.error?.code, JSON.stringify(patch)).toBe('23514')
    }
    expect((await owner.from('product_variants').update({ preorder_capacity: 0 }).eq('id', variant)).error?.code).toBe('23514')
    expect((await owner.from('product_variants').update({ preorder_note: '' }).eq('id', variant)).error?.code).toBe('23514')
    expect((await owner.from('product_variants').update({ preorder_note: 'ا'.repeat(301) }).eq('id', variant)).error?.code).toBe('23514')
    expect((await owner.from('product_variants').update({ preorder_note: 'سطر\nثانٍ' }).eq('id', variant)).error?.code).toBe('23514')
    // An editor changes nothing: the owner-only policy filters every row out.
    const blocked = await editorClient.from('product_variants').update({ preorder: false }).eq('id', variant).select('id')
    expect(blocked.data).toEqual([])
    expect((await row('select preorder from public.product_variants where id = $1', [variant])).preorder).toBe(true)
  })

  it('catalog audit records the preorder flag and its capacity with from and to; the public preorder columns request a site build, the capacity does not', async () => {
    const variant = await physical(6900, 5)
    await postgres.query(
      `update public.product_variants set preorder = true, preorder_capacity = 4, preorder_ships_on = '2027-03-01', preorder_note = 'أ' where id = $1`,
      [variant],
    )
    const audit = await row(
      "select summary from public.audit_events where entity = 'product_variants' and entity_id = $1 order by id desc limit 1",
      [variant],
    )
    expect(audit.summary.changes).toMatchObject({
      preorder: { from: false, to: true },
      preorder_capacity: { from: null, to: 4 },
      preorder_ships_on: true,
      preorder_note: true,
    })
    const requestedAt = async () => (await row('select requested_at from finance.site_builds where id = 1')).requested_at as Date
    const park = async () => {
      await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
      return (await requestedAt()).getTime()
    }
    let parked = await park()
    await postgres.query('update public.product_variants set preorder_capacity = 9 where id = $1', [variant])
    expect((await requestedAt()).getTime()).toBe(parked)
    for (const change of ["preorder_note = 'ب'", "preorder_ships_on = '2027-04-01'", 'preorder = false']) {
      parked = await park()
      await postgres.query(`update public.product_variants set ${change} where id = $1`, [variant])
      expect((await requestedAt()).getTime(), change).toBeGreaterThan(parked)
    }
  })

  it('notifications: the owner and operations read them, nobody else does, and nobody writes through the API', async () => {
    const variant = await digital()
    const email = uniqueEmail('notify')
    await postgres.query('insert into public.notifications (email, variant_id) values ($1, $2)', [email, variant])
    const owner = ownerClient
    const editor = editorClient
    for (const [label, client] of [['owner', owner], ['operations', operationsClient]] as const) {
      const read = await client.from('notifications').select('email, status, token_version').eq('variant_id', variant)
      expect(read.error, label).toBeNull()
      expect(read.data, label).toEqual([{ email, status: 'pending', token_version: 1 }])
    }
    expect((await editor.from('notifications').select('email').eq('variant_id', variant)).data).toEqual([])
    expect((await anonClient().from('notifications').select('email').eq('variant_id', variant)).error?.code).toBe('42501')
    expect((await owner.from('notifications').insert({ email: uniqueEmail('x'), variant_id: variant })).error?.code).toBe('42501')
    expect((await owner.from('notifications').update({ status: 'confirmed' }).eq('variant_id', variant)).error?.code).toBe('42501')
    expect((await owner.from('notifications').delete().eq('variant_id', variant)).error?.code).toBe('42501')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['insert', 'update', 'delete']) {
        const held = await row('select has_table_privilege($1, $2, $3) as ok', [role, 'public.notifications', privilege])
        expect(held.ok, `${role} ${privilege}`).toBe(false)
      }
    }
    expect((await row("select has_table_privilege('authenticated', 'public.notifications', 'select') as ok")).ok).toBe(true)
    expect((await row("select has_table_privilege('anon', 'public.notifications', 'select') as ok")).ok).toBe(false)
    // One subscription per address and variant, in the contact grammar.
    await expect(postgres.query('insert into public.notifications (email, variant_id) values ($1, $2)', [email, variant])).rejects.toMatchObject({ code: '23505' })
    await expect(postgres.query('insert into public.notifications (email, variant_id) values ($1, $2)', ['Not An Email', variant])).rejects.toMatchObject({ code: '23514' })
  })

  it('the paid-files bucket is private, bounded to two types and has no storage policy', async () => {
    const bucket = await row(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'paid-files'",
    )
    expect(bucket).toEqual({
      public: false,
      file_size_limit: '104857600',
      allowed_mime_types: ['application/pdf', 'application/epub+zip'],
    })
    expect(
      await count(
        `select count(*)::int as n from pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%paid-files%'`,
      ),
    ).toBe(0)
  })

  it('the orders accept the six states, the outbox the nine kinds, disputes are append-only', async () => {
    const placed = await plain()
    await postgres.query('begin')
    try {
      for (const status of ['paid', 'paid_needs_resolution', 'refunded', 'expired', 'cancelled', 'pending_payment']) {
        await postgres.query('update finance.orders set status = $2 where id = $1', [placed.id, status])
      }
      for (const kind of ['receipt', 'contact_notice', 'availability', 'order_link', 'order_shipped', 'order_refunded', 'order_ready', 'notify_confirm', 'owner_alert']) {
        await postgres.query(
          `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload) values ($1, $2, 2, 'kind@example.com', '{}')`,
          [`${EVENT_PREFIX}kind-${kind}`, kind],
        )
      }
    } finally {
      await postgres.query('rollback')
    }
    await expect(postgres.query("update finance.orders set status = 'bogus' where id = $1", [placed.id])).rejects.toMatchObject({ code: '23514' })
    await expect(
      postgres.query(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload) values ($1, 'bogus', 0, 'kind@example.com', '{}')`,
        [`${EVENT_PREFIX}kind-bogus`],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    // A dispute is a row nobody edits: a correction is a new row.
    const insertDispute = `insert into finance.disputes (kind, provider_ref, seq, environment, amount_halalas, direction, occurred_on, reason)
                           values ('payout_difference', $1, 1, 'test', 500, 'against_seller', current_date, 'فرق')`
    for (const statement of ["update finance.disputes set reason = 'x' where provider_ref = $1", 'delete from finance.disputes where provider_ref = $1']) {
      await postgres.query('begin')
      try {
        await postgres.query(insertDispute, [`ref-${randomUUID()}`])
        const ref = (await row('select provider_ref from finance.disputes order by created_at desc limit 1')).provider_ref
        await expect(postgres.query(statement, [ref])).rejects.toMatchObject({ code: '42501' })
      } finally {
        await postgres.query('rollback')
      }
    }
  })

  it('payments_kick runs every minute from pg_cron and calls the outbox function only when a row is due and Vault has its values', async () => {
    const job = await row("select schedule, command from cron.job where jobname = 'payments-reconcile'")
    expect(job).toEqual({ schedule: '* * * * *', command: 'select public.payments_kick()' })

    const placed = await plain()
    await postgres.query('begin')
    try {
      await postgres.query("update finance.payment_attempts set next_check_at = null where next_check_at is not null")
      await postgres.query("update finance.payment_events set next_check_at = null where next_check_at is not null")
      await postgres.query("update finance.refunds set next_check_at = null where next_check_at is not null")
      // A stack that already holds the two secrets (docs/operations.md) must not fail the test.
      await postgres.query("delete from vault.secrets where name in ('functions_url', 'jobs_secret')")
      await postgres.query("select vault.create_secret('http://127.0.0.1:9/functions/v1', 'functions_url')")
      await postgres.query("select vault.create_secret('kick-secret', 'jobs_secret')")
      const kick = async (): Promise<boolean> => (await row('select public.payments_kick() as r')).r
      // Nothing due: no call.
      expect(await kick()).toBe(false)
      expect(await count("select count(*)::int as n from net.http_request_queue where url like '%/outbox'")).toBe(0)
      // A row that waits for a person (no due time) never triggers it; a due attempt does.
      await insertAttempt(placed.id, 'uncertain', {}, '20 minutes', null)
      expect(await kick()).toBe(false)
      await postgres.query("update finance.payment_attempts set next_check_at = now() - interval '1 minute' where order_id = $1", [placed.id])
      expect(await kick()).toBe(true)
      const queued = await row(
        "select url, convert_from(body, 'utf8') as body, headers ->> 'Authorization' as auth from net.http_request_queue where url like '%/outbox'",
      )
      expect(queued.url).toBe('http://127.0.0.1:9/functions/v1/outbox')
      expect(JSON.parse(queued.body)).toEqual({ job: 'payments_reconcile' })
      expect(queued.auth).toBe('Bearer kick-secret')
      // A due event, and a due in-flight refund, wake it too.
      await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = $1', [placed.id])
      expect(await kick()).toBe(false)
      await postgres.query(
        `insert into finance.payment_events (event_id, next_check_at) values ($1, now() - interval '1 minute')`,
        [`${EVENT_PREFIX}kick`],
      )
      expect(await kick()).toBe(true)
    } finally {
      await postgres.query('rollback')
    }
  })
})

// --- payment_attempt_begin ---------------------------------------------------

describe('payment_attempt_begin', () => {
  it('answers NOT_FOUND for an unknown number, a wrong token and an expired token', async () => {
    const placed = await plain()
    expect(await begin(placed, { p_order_number: 'ZZZZ2222' })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await begin(placed, { p_access_token_hash: ZERO })).toEqual({ ok: false, code: 'NOT_FOUND' })
    await postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 minute' where id = $1", [placed.id])
    expect(await begin(placed)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [placed.id])).toBe(0)
  })

  it('ORDER_NOT_PAYABLE for a cancelled order, for the other mode (MODE_CHANGED) and with an open review payment (UNDER_REVIEW)', async () => {
    const cancelled = await plain()
    expect(await call('checkout_cancel', { p_order_number: cancelled.number, p_access_token_hash: cancelled.hash })).toMatchObject({ ok: true, status: 'cancelled' })
    expect(await begin(cancelled)).toMatchObject({ ok: false, code: 'ORDER_NOT_PAYABLE', status: 'cancelled' })

    const live = await plain()
    expect(await begin(live, { p_mode: 'live' })).toEqual({
      ok: false, code: 'ORDER_NOT_PAYABLE', status: 'pending_payment', reason: 'MODE_CHANGED', order: expect.objectContaining({ orderNumber: live.number }),
    })

    const reviewed = await plain()
    const paymentId = randomUUID()
    await postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, provider_invoice_id, order_id, environment, amount_halalas, currency, provider_status, reason)
       values ($1, $2, $3, 'test', $4, 'SAR', 'paid', 'SECOND_PAYMENT')`,
      [paymentId, randomUUID(), reviewed.id, reviewed.total],
    )
    expect(await begin(reviewed)).toEqual({
      ok: false, code: 'ORDER_NOT_PAYABLE', status: 'pending_payment', reason: 'UNDER_REVIEW', order: expect.objectContaining({ orderNumber: reviewed.number }),
    })
    // Closed by the owner: a new invoice is allowed again.
    await postgres.query("update finance.payment_reviews set closed_at = now(), closed_reason = 'bank reversal' where provider_payment_id = $1", [paymentId])
    expect(await begin(reviewed)).toMatchObject({ ok: true, state: 'new' })
  })

  it('HOLD_EXPIRED with under 60 seconds left, TOTAL_BELOW_MINIMUM under 100 halalas', async () => {
    const late = await plain()
    await postgres.query("update finance.orders set hold_expires_at = now() + interval '30 seconds' where id = $1", [late.id])
    expect(await begin(late)).toEqual({ ok: false, code: 'HOLD_EXPIRED', order: expect.objectContaining({ orderNumber: late.number }) })
    await postgres.query("update finance.orders set hold_expires_at = now() + interval '90 seconds' where id = $1", [late.id])
    expect(await begin(late)).toMatchObject({ ok: true, state: 'new' })

    // Checkout itself refuses a total under the minimum (round 4), so the order is made smaller behind its back.
    const tiny = await place([{ variantId: await digital(100), quantity: 1 }])
    await postgres.query('update finance.orders set subtotal_halalas = 50, total_halalas = 50 where id = $1', [tiny.id])
    expect(await begin(tiny)).toEqual({ ok: false, code: 'TOTAL_BELOW_MINIMUM', order: expect.objectContaining({ orderNumber: tiny.number }) })
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [tiny.id])).toBe(0)
  })

  it('TOO_MANY_ATTEMPTS at 5 attempts; an active fifth keeps answering instead', async () => {
    const placed = await plain()
    for (let i = 0; i < 4; i += 1) {
      const next = await begin(placed)
      expect(next.state).toBe('new')
      expect(await adopt(next.attemptId, randomUUID())).toEqual({ ok: true })
      expect(await close(next.attemptId, 'cancelled')).toMatchObject({ ok: true, status: 'cancelled' })
    }
    const fifth = await begin(placed)
    expect(fifth.state).toBe('new')
    expect(await begin(placed)).toMatchObject({ ok: true, state: 'creating', attemptId: fifth.attemptId })
    expect(await close(fifth.attemptId, 'failed', 'PROVIDER_REFUSED')).toMatchObject({ ok: true })
    expect(await begin(placed)).toEqual({ ok: false, code: 'TOO_MANY_ATTEMPTS', order: expect.objectContaining({ orderNumber: placed.number }) })
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [placed.id])).toBe(5)
  })

  it('answers new, then creating for the same order, then uncertain once the creating row is older than 30 seconds', async () => {
    const placed = await plain()
    const first = await begin(placed)
    expect(first).toMatchObject({ ok: true, state: 'new', amount: placed.total, currency: 'SAR' })
    expect(first.order).toMatchObject({ orderNumber: placed.number, status: 'pending_payment', total: placed.total })
    const hold = (await orderOf(placed.id)).hold_expires_at as Date
    expect(new Date(first.expiresAt).getTime()).toBe(hold.getTime())
    const row1 = await attemptOf(first.attemptId)
    expect(row1).toMatchObject({ status: 'creating', amount_halalas: placed.total, currency: 'SAR', environment: 'test', provider_invoice_id: null })
    // Due in 30 seconds, so the job reaches a creation whose function died.
    const due = await secondsAhead('payment_attempts', 'id', first.attemptId, 'next_check_at')
    expect(due).toBeGreaterThan(20)
    expect(due).toBeLessThanOrEqual(30)

    expect(await begin(placed)).toMatchObject({ ok: true, state: 'creating', attemptId: first.attemptId })
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [placed.id])).toBe(1)

    await postgres.query("update finance.payment_attempts set created_at = now() - interval '31 seconds' where id = $1", [first.attemptId])
    const third = await begin(placed)
    expect(third).toMatchObject({ ok: true, state: 'uncertain', attemptId: first.attemptId, amount: placed.total, currency: 'SAR' })
    expect(third.createdAt).toBeTruthy()
    const marked = await attemptOf(first.attemptId)
    expect(marked.status).toBe('uncertain')
    expect(await secondsAhead('payment_attempts', 'id', first.attemptId, 'next_check_at')).toBeLessThanOrEqual(1)
    // Still one attempt: nothing makes a second invoice behind its back.
    expect(await begin(placed)).toMatchObject({ ok: true, state: 'uncertain', attemptId: first.attemptId })
  })

  it('four calls at once for one order make one attempt: one answers new, the others creating', async () => {
    const placed = await plain()
    const answers = await Promise.all(pool.slice(0, 4).map((client) => call('payment_attempt_begin', {
      p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null,
    }, client)))
    expect(answers.filter((a) => a.state === 'new')).toHaveLength(1)
    expect(answers.filter((a) => a.state === 'creating')).toHaveLength(3)
    expect(new Set(answers.map((a) => a.attemptId)).size).toBe(1)
    expect(await count('select count(*)::int as n from finance.payment_attempts where order_id = $1', [placed.id])).toBe(1)
  })

  it('a pending attempt answers its stored URL; an uncertain one answers when it was created', async () => {
    const placed = await plain()
    const started = await start(placed)
    expect(await begin(placed)).toMatchObject({
      ok: true,
      state: 'pending',
      attemptId: started.attemptId,
      invoiceUrl: `http://127.0.0.1:54390/invoices/${started.invoiceId}`,
    })

    const other = await plain()
    const next = await begin(other)
    expect(await close(next.attemptId, 'uncertain')).toMatchObject({ ok: true })
    const answer = await begin(other)
    expect(answer).toMatchObject({ ok: true, state: 'uncertain', attemptId: next.attemptId, amount: other.total, currency: 'SAR' })
    expect(answer.createdAt).toBeTruthy()
  })

  it('the partial unique index really forbids a second active attempt, and allows closed ones', async () => {
    const placed = await plain()
    const first = await begin(placed)
    await expect(insertAttempt(placed.id, 'pending')).rejects.toMatchObject({ code: '23505' })
    await expect(insertAttempt(placed.id, 'uncertain')).rejects.toMatchObject({ code: '23505' })
    expect(await close(first.attemptId, 'failed', 'PROVIDER_REFUSED')).toMatchObject({ ok: true })
    expect(await insertAttempt(placed.id, 'expired')).toBeTruthy()
    expect(await insertAttempt(placed.id, 'pending')).toBeTruthy()
    await expect(insertAttempt(placed.id, 'creating')).rejects.toMatchObject({ code: '23505' })
  })

  it('the pay throttle is 30 an hour per IP hash and raises 54000 over it; create passes no hash and is not throttled', async () => {
    const hash = ipHash()
    const unknown = (): Promise<any> =>
      begin({ number: 'ZZZZ2222', hash: ZERO } as Placed, { p_ip_hash: hash })
    for (let i = 0; i < 30; i += 1) expect(await unknown()).toEqual({ ok: false, code: 'NOT_FOUND' })
    await expect(unknown()).rejects.toMatchObject({ code: '54000' })
    // Another hash is unaffected, and so is a call with no hash.
    expect(await begin({ number: 'ZZZZ2222', hash: ZERO } as Placed, { p_ip_hash: ipHash() })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await begin({ number: 'ZZZZ2222', hash: ZERO } as Placed)).toEqual({ ok: false, code: 'NOT_FOUND' })
    // A malformed hash is not a business answer.
    await expect(begin({ number: 'ZZZZ2222', hash: ZERO } as Placed, { p_ip_hash: 'not-a-hash' })).rejects.toMatchObject({ code: '22023' })
  })

  it('malformed calls raise 22023 on every function that takes a mode, a status, a source or a hash', async () => {
    const attempt = randomUUID()
    const bad: Array<[string, Record<string, unknown>]> = [
      ['payment_attempt_begin', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_mode: 'staging', p_ip_hash: null }],
      ['payment_attempt_created', { p_attempt: attempt, p_invoice_id: 'has space', p_invoice_url: 'http://127.0.0.1/x', p_expires_at: null }],
      ['payment_attempt_created', { p_attempt: attempt, p_invoice_id: 'inv', p_invoice_url: 'javascript:alert(1)', p_expires_at: null }],
      ['payment_attempt_close', { p_attempt: attempt, p_status: 'failed', p_error: 'A provider message with spaces' }],
      ['apply_verified_payment', { p_invoice_id: 'inv', p_payment: {}, p_invoice: {}, p_mode: 'staging', p_live: null, p_event_id: null }],
      ['apply_verified_payment', { p_invoice_id: 'inv', p_payment: { id: 'p' }, p_invoice: { id: 'inv' }, p_mode: 'test', p_live: null, p_event_id: null }],
      ['payment_event_record', { p_event_id: 'x'.repeat(201), p_type: 't', p_live: false, p_payment_id: null, p_payload_hash: null }],
      ['payment_event_record', { p_event_id: 'e', p_type: 't', p_live: false, p_payment_id: null, p_payload_hash: 'xyz' }],
      ['payment_event_result', { p_event_id: 'e', p_outcome: '', p_error: null }],
      ['payment_check_begin', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_ip_hash: 'nope', p_mode: 'test' }],
      ['payment_callback_begin', { p_invoice_id: 'inv', p_ip_hash: 'nope', p_mode: 'test' }],
      ['payment_state', { p_order_number: 'ABCD2345', p_access_token_hash: ZERO, p_mode: 'staging' }],
      ['payment_reconcile_claim', { p_mode: 'staging' }],
      ['payment_attempt_checked', { p_attempt: attempt, p_source: 'cron', p_ok: true, p_provider_status: null, p_error: null }],
    ]
    for (const [fn, args] of bad) {
      await expect(call(fn, args), fn).rejects.toMatchObject({ code: '22023' })
    }
  })
})

// --- payment_attempt_created and payment_attempt_close -----------------------

describe('payment_attempt_created', () => {
  it('moves creating to pending with the id, the URL and the provider\'s own expiry, due in a minute; the same id again is a no-op', async () => {
    const placed = await plain()
    const begun = await begin(placed)
    const invoiceId = randomUUID()
    const expires = new Date(Date.now() + 15 * 60_000).toISOString()
    expect(await adopt(begun.attemptId, invoiceId, { p_expires_at: expires })).toEqual({ ok: true })
    const stored = await attemptOf(begun.attemptId)
    expect(stored).toMatchObject({ status: 'pending', provider_invoice_id: invoiceId, invoice_url: `http://127.0.0.1:54390/invoices/${invoiceId}` })
    expect((stored.invoice_expires_at as Date).toISOString()).toBe(expires)
    const due = await secondsAhead('payment_attempts', 'id', begun.attemptId, 'next_check_at')
    expect(due).toBeGreaterThan(50)
    expect(due).toBeLessThanOrEqual(60)
    expect(await adopt(begun.attemptId, invoiceId)).toEqual({ ok: true })
    expect(await attemptOf(begun.attemptId)).toEqual(stored)
    // Without an echoed expiry the order's own is kept.
    const other = await plain()
    const second = await begin(other)
    expect(await adopt(second.attemptId, randomUUID())).toEqual({ ok: true })
    expect(((await attemptOf(second.attemptId)).invoice_expires_at as Date).getTime()).toBe(((await orderOf(other.id)).hold_expires_at as Date).getTime())
  })

  it('adopts an invoice for an uncertain attempt', async () => {
    const placed = await plain()
    const begun = await begin(placed)
    expect(await close(begun.attemptId, 'uncertain')).toMatchObject({ ok: true })
    const invoiceId = randomUUID()
    expect(await adopt(begun.attemptId, invoiceId)).toEqual({ ok: true })
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'pending', provider_invoice_id: invoiceId })
  })

  it('INVOICE_CONFLICT for another id on the row and for an id already on another attempt, never a raised 23505', async () => {
    const placed = await plain()
    const started = await start(placed)
    expect(await adopt(started.attemptId, randomUUID())).toEqual({ ok: false, code: 'INVOICE_CONFLICT' })
    expect((await attemptOf(started.attemptId)).provider_invoice_id).toBe(started.invoiceId)

    const other = await plain()
    const begun = await begin(other)
    expect(await adopt(begun.attemptId, started.invoiceId)).toEqual({ ok: false, code: 'INVOICE_CONFLICT' })
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'creating', provider_invoice_id: null })
    // The same id on a closed attempt of another order conflicts too.
    expect(await close(started.attemptId, 'cancelled')).toMatchObject({ ok: true })
    expect(await adopt(begun.attemptId, started.invoiceId)).toEqual({ ok: false, code: 'INVOICE_CONFLICT' })
  })

  it('two attempts adopting one invoice at once: one wins, the other answers INVOICE_CONFLICT', async () => {
    const first = await begin(await plain())
    const second = await begin(await plain())
    const invoiceId = randomUUID()
    const answers = await Promise.all([adopt(first.attemptId, invoiceId).catch((e) => e), call('payment_attempt_created', {
      p_attempt: second.attemptId, p_invoice_id: invoiceId, p_invoice_url: `http://127.0.0.1:54390/invoices/${invoiceId}`, p_expires_at: null,
    }, pool[1]).catch((e) => e)])
    expect(answers.filter((a) => a?.ok === true)).toHaveLength(1)
    expect(answers.filter((a) => a?.code === 'INVOICE_CONFLICT')).toHaveLength(1)
    expect(await count('select count(*)::int as n from finance.payment_attempts where provider_invoice_id = $1', [invoiceId])).toBe(1)
  })

  it('ATTEMPT_CLOSED on any other status: the id is stored when the row has none, the status stays, a closed one gets a last check', async () => {
    const placed = await plain()
    for (const status of ['failed', 'abandoned', 'expired', 'cancelled']) {
      const attempt = await insertAttempt(placed.id, status)
      const invoiceId = randomUUID()
      expect(await adopt(attempt, invoiceId), status).toEqual({ ok: false, code: 'ATTEMPT_CLOSED' })
      const stored = await attemptOf(attempt)
      expect(stored, status).toMatchObject({ status, provider_invoice_id: invoiceId, invoice_url: null })
      // Its invoice expires in about 20 minutes: one last check 10 minutes after.
      const due = await secondsAhead('payment_attempts', 'id', attempt, 'next_check_at')
      expect(due, status).toBeGreaterThan(29 * 60)
      expect(due, status).toBeLessThanOrEqual(30 * 60)
      // The same id again, and another id on the stored one.
      expect(await adopt(attempt, invoiceId), status).toEqual({ ok: false, code: 'ATTEMPT_CLOSED' })
      expect(await adopt(attempt, randomUUID()), status).toEqual({ ok: false, code: 'INVOICE_CONFLICT' })
    }
    // A paid or review attempt keeps its status and has no check to schedule.
    for (const status of ['paid', 'review']) {
      const attempt = await insertAttempt(placed.id, status, { provider_payment_id: randomUUID() })
      const invoiceId = randomUUID()
      expect(await adopt(attempt, invoiceId), status).toEqual({ ok: false, code: 'ATTEMPT_CLOSED' })
      expect(await attemptOf(attempt), status).toMatchObject({ status, provider_invoice_id: invoiceId, next_check_at: null })
    }
    expect(await adopt(randomUUID(), randomUUID())).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('payment_attempt_close', () => {
  const ALLOWED: Array<[string, string]> = [
    ['creating', 'failed'],
    ['creating', 'uncertain'],
    ['uncertain', 'abandoned'],
    ['pending', 'cancelled'],
    ['pending', 'expired'],
  ]
  const STATUSES = ['creating', 'pending', 'uncertain', 'paid', 'review', 'failed', 'expired', 'cancelled', 'abandoned']

  it('every allowed move works and sets its next check; every other move is BAD_TRANSITION and changes nothing', async () => {
    const placed = await plain()
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const extra: Record<string, unknown> = {}
        if (from === 'pending') extra.provider_invoice_id = randomUUID()
        if (from === 'paid' || from === 'review') extra.provider_payment_id = randomUUID()
        const attempt = await insertAttempt(placed.id, from, extra, '20 minutes', '5 minutes')
        const answer = await close(attempt, to, to === 'failed' || to === 'abandoned' ? 'PROVIDER_REFUSED' : null)
        const after = await attemptOf(attempt)
        if (ALLOWED.some(([a, b]) => a === from && b === to)) {
          expect(answer, `${from} -> ${to}`).toEqual({ ok: true, status: to })
          expect(after.status, `${from} -> ${to}`).toBe(to)
          const ahead = await secondsAhead('payment_attempts', 'id', attempt, 'next_check_at')
          if (to === 'uncertain') {
            // Due at once.
            expect(ahead, `${from} -> ${to}`).toBeLessThanOrEqual(1)
            expect(ahead, `${from} -> ${to}`).toBeGreaterThan(-5)
          } else if (extra.provider_invoice_id) {
            // One last check, 10 minutes after the invoice's expiry (20 minutes ahead).
            expect(ahead, `${from} -> ${to}`).toBeGreaterThan(29 * 60)
            expect(ahead, `${from} -> ${to}`).toBeLessThanOrEqual(30 * 60)
          } else {
            // No invoice id: nothing to check.
            expect(after.next_check_at, `${from} -> ${to}`).toBeNull()
          }
        } else {
          expect(answer, `${from} -> ${to}`).toEqual({ ok: false, code: 'BAD_TRANSITION' })
          expect(after.status, `${from} -> ${to}`).toBe(from)
          expect(after.updated_at, `${from} -> ${to}`).toEqual(after.created_at)
        }
        // The next pair starts clean (an active row would block the next insert).
        await postgres.query('delete from finance.payment_attempts where id = $1', [attempt])
      }
    }
  })

  it('stores the error code, refuses an unknown status and a null one, answers NOT_FOUND for an unknown attempt', async () => {
    const placed = await plain()
    const begun = await begin(placed)
    expect(await close(begun.attemptId, 'bogus')).toEqual({ ok: false, code: 'BAD_TRANSITION' })
    await expect(close(begun.attemptId, null as unknown as string)).rejects.toMatchObject({ code: '22023' })
    expect(await close(begun.attemptId, 'failed', 'PROVIDER_REFUSED')).toEqual({ ok: true, status: 'failed' })
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'failed', last_error: 'PROVIDER_REFUSED', next_check_at: null })
    expect(await close(randomUUID(), 'failed')).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

// --- apply_verified_payment: the decision table ----------------------------------

describe('apply_verified_payment: the first four steps', () => {
  it('unknown_invoice: nothing for a payment that is not charged; for a charged one a single UNMAPPED_INVOICE review row and one owner alert, once', async () => {
    const total = 4200
    const invoiceId = randomUUID()
    const ghost = { placed: { total }, invoiceId, paymentId: randomUUID() } as unknown as Started
    for (const status of ['initiated', 'authorized', 'verified', 'failed', 'voided', 'captured']) {
      expect(await apply(ghost, { status }), status).toEqual({ outcome: 'unknown_invoice' })
    }
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [ghost.paymentId])).toBe(0)
    expect(await alerts('payment_review', ghost.paymentId)).toBe(0)

    expect(await apply(ghost, { status: 'paid' })).toEqual({ outcome: 'unknown_invoice' })
    const review = await row('select * from finance.payment_reviews where provider_payment_id = $1', [ghost.paymentId])
    expect(review).toMatchObject({
      provider_invoice_id: invoiceId,
      attempt_id: null,
      order_id: null,
      environment: 'test',
      amount_halalas: total,
      currency: 'SAR',
      provider_status: 'paid',
      reason: 'UNMAPPED_INVOICE',
      provider_refunded_halalas: 0,
      closed_at: null,
    })
    const everyOwner = await owners()
    expect(await alerts('payment_review', ghost.paymentId)).toBe(everyOwner)
    const outbox = await row("select kind, priority, payload from finance.email_outbox where kind = 'owner_alert' and dedupe_key like $1 limit 1", [`payment_review:${ghost.paymentId}:%`])
    expect(outbox).toMatchObject({ kind: 'owner_alert', priority: 0 })
    expect(outbox.payload).toMatchObject({ alert: 'payment_review', paymentId: ghost.paymentId, reason: 'UNMAPPED_INVOICE' })
    const audit = await row("select summary from public.audit_events where action = 'payment.review' and entity_id = $1", [ghost.paymentId])
    expect(audit.summary).toMatchObject({ reason: 'UNMAPPED_INVOICE', amount: total })

    // Once: a replay, the same payment seen refunded, adds nothing but the fresher facts.
    expect(await apply(ghost, { status: 'refunded', refunded: 1000 })).toEqual({ outcome: 'unknown_invoice' })
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [ghost.paymentId])).toBe(1)
    expect(await alerts('payment_review', ghost.paymentId)).toBe(everyOwner)
    expect(await row('select provider_status, provider_refunded_halalas from finance.payment_reviews where provider_payment_id = $1', [ghost.paymentId])).toEqual({
      provider_status: 'refunded',
      provider_refunded_halalas: 1000,
    })
  })

  it('rejected INVOICE_MISMATCH when the payment or the invoice names another invoice; nothing changes', async () => {
    const started = await start(await plain())
    const before = await attemptOf(started.attemptId)
    const other = randomUUID()
    expect(await apply(started, { payInvoiceId: other })).toEqual({ outcome: 'rejected', reason: 'INVOICE_MISMATCH' })
    expect(await apply(started, { invoiceId: other })).toEqual({ outcome: 'rejected', reason: 'INVOICE_MISMATCH' })
    // Asked about an invoice both objects do not carry.
    expect(await apply(started, {}, { invoiceId: other })).toEqual({ outcome: 'rejected', reason: 'INVOICE_MISMATCH' })
    expect(await attemptOf(started.attemptId)).toEqual(before)
    expect((await orderOf(started.placed.id)).status).toBe('pending_payment')
  })

  it('rejected MODE_MISMATCH by the configured mode and by the webhook\'s live; nothing changes', async () => {
    const started = await start(await plain())
    const before = await attemptOf(started.attemptId)
    expect(await apply(started, {}, { mode: 'live' })).toEqual({ outcome: 'rejected', reason: 'MODE_MISMATCH' })
    expect(await apply(started, {}, { live: true })).toEqual({ outcome: 'rejected', reason: 'MODE_MISMATCH' })
    expect(await attemptOf(started.attemptId)).toEqual(before)

    const live = await start(await place([{ variantId: await digital(), quantity: 1 }], { environment: 'live' }), 'live')
    expect(await apply(live, {}, { mode: 'test' })).toEqual({ outcome: 'rejected', reason: 'MODE_MISMATCH' })
    expect(await apply(live, {}, { mode: 'live', live: false })).toEqual({ outcome: 'rejected', reason: 'MODE_MISMATCH' })
    expect((await orderOf(live.placed.id)).status).toBe('pending_payment')
    // The matching mode and `live` are accepted (a payment that is not charged, so nothing is settled).
    expect(await apply(live, { status: 'initiated' }, { mode: 'live', live: true })).toEqual({ outcome: 'not_paid' })
  })

  it('not_paid for initiated, authorized, verified, failed, voided and expired: the attempt records what was fetched and stays pending', async () => {
    const started = await start(await plain())
    for (const status of ['initiated', 'authorized', 'verified', 'failed', 'voided', 'expired']) {
      expect(await apply(started, { status }), status).toEqual({ outcome: 'not_paid' })
      const attempt = await attemptOf(started.attemptId)
      expect(attempt, status).toMatchObject({ status: 'pending', provider_status: status, provider_payment_id: null, captured_halalas: null })
      expect(attempt.fetched_at, status).not.toBeNull()
    }
    expect((await orderOf(started.placed.id)).status).toBe('pending_payment')
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_invoice_id = $1', [started.invoiceId])).toBe(0)
    expect(await receipts(started.placed.id)).toEqual([])
  })
})

describe('apply_verified_payment: a payment id the ledger already holds', () => {
  it('is rejected on another attempt\'s invoice and changes nothing', async () => {
    const paid = await start(await plain())
    expect(await apply(paid)).toMatchObject({ outcome: 'paid' })
    const other = await start(await plain())
    const before = await attemptOf(other.attemptId)
    expect(await apply(other, { paymentId: paid.paymentId })).toEqual({ outcome: 'rejected', reason: 'INVOICE_MISMATCH' })
    expect(await attemptOf(other.attemptId)).toEqual(before)
    expect((await orderOf(other.placed.id)).status).toBe('pending_payment')
  })
})

describe('apply_verified_payment: charged payments that cannot settle an order', () => {
  /** The shared assertions of a review outcome: one row, the attempt in review, one alert, the order untouched. */
  async function expectReview(started: Started, reason: string, answer: any, paymentId = started.paymentId): Promise<void> {
    expect(answer).toEqual({ outcome: 'review', reason, orderNumber: started.placed.number })
    const review = await row('select * from finance.payment_reviews where provider_payment_id = $1', [paymentId])
    expect(review).toMatchObject({
      provider_invoice_id: started.invoiceId,
      environment: 'test',
      reason,
      closed_at: null,
      order_id: started.placed.id,
      attempt_id: started.attemptId,
    })
    expect(await alerts('payment_review', paymentId)).toBe(await owners())
  }

  it('captured is UNEXPECTED_STATUS: the attempt becomes review with the payment id and no further check; replays add nothing', async () => {
    const started = await start(await plain())
    await expectReview(started, 'UNEXPECTED_STATUS', await apply(started, { status: 'captured' }))
    const attempt = await attemptOf(started.attemptId)
    expect(attempt).toMatchObject({ status: 'review', provider_payment_id: started.paymentId, next_check_at: null, provider_status: 'captured' })
    expect((await orderOf(started.placed.id)).status).toBe('pending_payment')
    expect(await receipts(started.placed.id)).toEqual([])
    // The same payment again: review again, nothing new.
    const alertsBefore = await alerts('payment_review', started.paymentId)
    expect(await apply(started, { status: 'captured' })).toEqual({ outcome: 'review', reason: 'UNEXPECTED_STATUS', orderNumber: started.placed.number })
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toBe(1)
    expect(await alerts('payment_review', started.paymentId)).toBe(alertsBefore)
    // Even once paid at the provider, a payment that is already in review is never fulfilled.
    expect(await apply(started, { status: 'paid' })).toMatchObject({ outcome: 'review', reason: 'UNEXPECTED_STATUS' })
    expect((await orderOf(started.placed.id)).status).toBe('pending_payment')
  })

  it('AMOUNT_MISMATCH for another payment amount and for another invoice amount', async () => {
    const started = await start(await plain())
    await expectReview(started, 'AMOUNT_MISMATCH', await apply(started, { amount: started.placed.total - 1 }))
    expect(await attemptOf(started.attemptId)).toMatchObject({ status: 'review', provider_payment_id: started.paymentId, next_check_at: null })
    expect(await row('select amount_halalas from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toEqual({ amount_halalas: started.placed.total - 1 })

    const invoiceSide = await start(await plain())
    await expectReview(invoiceSide, 'AMOUNT_MISMATCH', await apply(invoiceSide, { invoiceAmount: invoiceSide.placed.total + 1 }))
    expect((await orderOf(invoiceSide.placed.id)).status).toBe('pending_payment')
  })

  it('CURRENCY_MISMATCH for another currency', async () => {
    const started = await start(await plain())
    await expectReview(started, 'CURRENCY_MISMATCH', await apply(started, { currency: 'USD' }))
    expect(await row('select currency from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toEqual({ currency: 'USD' })
  })

  it('SECOND_PAYMENT on a paid attempt and on a review attempt: the attempt is untouched', async () => {
    const started = await start(await plain())
    expect(await apply(started)).toMatchObject({ outcome: 'paid' })
    const paid = await attemptOf(started.attemptId)
    const second = randomUUID()
    expect(await apply(started, { paymentId: second })).toEqual({ outcome: 'review', reason: 'SECOND_PAYMENT', orderNumber: started.placed.number })
    expect(await attemptOf(started.attemptId)).toEqual(paid)
    const review = await row('select * from finance.payment_reviews where provider_payment_id = $1', [second])
    expect(review).toMatchObject({ reason: 'SECOND_PAYMENT', attempt_id: started.attemptId, order_id: started.placed.id, amount_halalas: started.placed.total })
    expect(await alerts('payment_review', second)).toBe(await owners())
    expect(await apply(started, { paymentId: second })).toMatchObject({ outcome: 'review', reason: 'SECOND_PAYMENT' })
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [second])).toBe(1)
    expect((await orderOf(started.placed.id)).status).toBe('paid')

    // A review attempt answers a different payment the same way.
    const reviewed = await start(await plain())
    expect(await apply(reviewed, { amount: 1 })).toMatchObject({ reason: 'AMOUNT_MISMATCH' })
    const inReview = await attemptOf(reviewed.attemptId)
    const next = randomUUID()
    expect(await apply(reviewed, { paymentId: next })).toEqual({ outcome: 'review', reason: 'SECOND_PAYMENT', orderNumber: reviewed.placed.number })
    expect(await attemptOf(reviewed.attemptId)).toEqual(inReview)
    expect((await orderOf(reviewed.placed.id)).status).toBe('pending_payment')
  })

  it('ORDER_ALREADY_PAID: the first attempt\'s invoice is paid after the second attempt paid the order', async () => {
    const variant = await physical(6900, 5)
    const placed = await place([{ variantId: variant, quantity: 1 }])
    const first = await start(placed)
    expect(await close(first.attemptId, 'expired')).toMatchObject({ ok: true })
    const second = await start(placed)
    expect(await apply(second)).toMatchObject({ outcome: 'paid' })
    expect(await stockOf(variant)).toBe(4)
    const paidOrder = await orderOf(placed.id)

    await expectReview(first, 'ORDER_ALREADY_PAID', await apply(first))
    expect(await attemptOf(first.attemptId)).toMatchObject({ status: 'review', provider_payment_id: first.paymentId, next_check_at: null })
    // Only the paying attempt is paid; the order and the stock are not touched again.
    expect(await attemptOf(second.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: second.paymentId })
    expect(await orderOf(placed.id)).toEqual(paidOrder)
    expect(await stockOf(variant)).toBe(4)
    expect(await count('select count(*)::int as n from finance.fulfillments where order_id = $1', [placed.id])).toBe(1)
  })
})

describe('apply_verified_payment: money that is already in review', () => {
  it('a payment first seen on an unmapped invoice stays in review when the invoice is mapped later: it is never fulfilled', async () => {
    const placed = await plain()
    const begun = await begin(placed)
    expect(await close(begun.attemptId, 'uncertain')).toMatchObject({ ok: true })
    const started: Started = { attemptId: begun.attemptId, invoiceId: randomUUID(), paymentId: randomUUID(), placed }
    // The payment arrives before the creation call's outcome is known: no attempt has this invoice yet.
    expect(await apply(started)).toEqual({ outcome: 'unknown_invoice' })
    expect(await row('select attempt_id, order_id from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toEqual({
      attempt_id: null,
      order_id: null,
    })
    // The listing finds the invoice and adopts it: the same payment now maps to the order, and is still only money in review.
    expect(await adopt(begun.attemptId, started.invoiceId)).toEqual({ ok: true })
    expect(await apply(started)).toEqual({ outcome: 'review', reason: 'UNMAPPED_INVOICE', orderNumber: placed.number })
    expect(await row('select attempt_id, order_id, reason from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toEqual({
      attempt_id: begun.attemptId,
      order_id: placed.id,
      reason: 'UNMAPPED_INVOICE',
    })
    expect(await attemptOf(begun.attemptId)).toMatchObject({ status: 'review', provider_payment_id: started.paymentId, next_check_at: null })
    expect((await orderOf(placed.id)).status).toBe('pending_payment')
    expect(await receipts(placed.id)).toEqual([])
    expect(await count('select count(*)::int as n from finance.payment_reviews where provider_payment_id = $1', [started.paymentId])).toBe(1)
    expect(await alerts('payment_review', started.paymentId)).toBe(await owners())
  })
})

describe('apply_verified_payment: the first verified payment', () => {
  it('pays: the reservations, the stock, the coupon, the entitlements, the fulfilments, the receipt, the token expiry, the audit row and the low-stock alert', async () => {
    const coupon = await makeCoupon({ percentBp: 1000, usageLimit: 5 })
    const withFile = await digital(3500)
    const assetId = await attachFile(withFile)
    const noFile = await digital(1500)
    const shelf = await physical(6900, 10, 8)
    const plainShelf = await physical(2000, 10)
    const signed = await makeVariant(await makeProduct(), { fulfillment: 'signed', price: 9900, stock: 5 })
    const placed = await place(
      [
        { variantId: withFile, quantity: 1 },
        { variantId: noFile, quantity: 1 },
        { variantId: shelf, quantity: 3 },
        { variantId: plainShelf, quantity: 1 },
        { variantId: signed, quantity: 1, dedication: 'إهداء' },
      ],
      { couponCode: coupon.code },
    )
    const started = await start(placed)
    // The link was about to expire; paying gives it a fresh 7 days.
    await postgres.query("update finance.orders set access_token_expires_at = now() + interval '1 hour' where id = $1", [placed.id])
    const redemptionBefore = await row('select state from finance.coupon_redemptions where order_id = $1', [placed.id])
    expect(redemptionBefore.state).toBe('held')

    expect(await apply(started, {}, { eventId: 'evt-paid-1' })).toEqual({ outcome: 'paid', orderNumber: placed.number })

    const order = await orderOf(placed.id)
    expect(order.status).toBe('paid')
    expect(order.paid_at).not.toBeNull()
    expect(order.version).toBe(2)
    const validFor = Number((await row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [placed.id])).s)
    expect(validFor).toBeGreaterThan(7 * 86_400 - 30)
    expect(validFor).toBeLessThanOrEqual(7 * 86_400)

    const attempt = await attemptOf(started.attemptId)
    expect(attempt).toMatchObject({
      status: 'paid',
      provider_payment_id: started.paymentId,
      captured_halalas: placed.total,
      fee_halalas: 150,
      source_type: 'creditcard',
      source_company: 'mada',
      provider_status: 'paid',
      provider_refunded_halalas: 0,
      next_check_at: null,
    })
    expect(attempt.paid_at).not.toBeNull()
    expect(attempt.fetched_at).not.toBeNull()

    // Reservations are committed (a digital line has none); stock went down once, by an audited UPDATE.
    const reservations = await rows('select variant_id, state, preorder from finance.inventory_reservations where order_id = $1', [placed.id])
    expect(reservations).toHaveLength(3)
    expect(reservations.every((r) => r.state === 'committed' && r.preorder === false)).toBe(true)
    expect(await stockOf(shelf)).toBe(7)
    expect(await stockOf(plainShelf)).toBe(9)
    expect(await stockOf(signed)).toBe(4)
    expect(await stockOf(withFile)).toBeNull()
    const stockAudit = await row("select summary from public.audit_events where entity = 'product_variants' and entity_id = $1 order by id desc limit 1", [shelf])
    expect(stockAudit.summary.changes.stock).toEqual({ from: 10, to: 7 })

    expect(await row('select state, released_at from finance.coupon_redemptions where order_id = $1', [placed.id])).toEqual({ state: 'committed', released_at: null })

    // One entitlement per digital item, with the variant's file when it has one; one fulfilment per physical or signed item.
    const entitlements = await rows(
      `select i.variant_id, e.asset_id, e.revoked_at from finance.entitlements e join finance.order_items i on i.id = e.order_item_id where e.order_id = $1`,
      [placed.id],
    )
    expect(entitlements).toHaveLength(2)
    expect(entitlements.find((e) => e.variant_id === withFile)).toMatchObject({ asset_id: assetId, revoked_at: null })
    expect(entitlements.find((e) => e.variant_id === noFile)).toMatchObject({ asset_id: null, revoked_at: null })
    const fulfilments = await rows(
      `select i.variant_id, f.state, f.dedication_done, f.carrier from finance.fulfillments f join finance.order_items i on i.id = f.order_item_id where f.order_id = $1`,
      [placed.id],
    )
    expect(fulfilments).toHaveLength(3)
    expect(fulfilments.every((f) => f.state === 'preparing' && f.dedication_done === false && f.carrier === null)).toBe(true)
    expect(fulfilments.map((f) => f.variant_id).sort()).toEqual([shelf, plainShelf, signed].sort())

    // One receipt, priority 0, to the buyer, carrying only the order id.
    const receipt = await receipts(placed.id)
    expect(receipt).toHaveLength(1)
    expect(receipt[0]).toMatchObject({ kind: 'receipt', priority: 0, recipient: placed.email.toLowerCase(), status: 'pending' })
    expect(receipt[0]!.payload).toEqual({ orderId: placed.id })

    // The shelf crossed its threshold of 8 (10 to 7); the plain shelf has none set.
    expect(await alerts('low_stock', `${shelf}:${placed.id}`)).toBe(await owners())
    expect(await alerts('low_stock', `${plainShelf}:${placed.id}`)).toBe(0)
    expect(await alerts('needs_resolution', placed.id)).toBe(0)

    const audit = await row("select summary from public.audit_events where action = 'order.paid' and entity_id = $1", [placed.id])
    expect(audit.summary).toEqual({ orderNumber: placed.number, amount: placed.total, attemptId: started.attemptId, paymentId: started.paymentId, eventId: 'evt-paid-1' })
    // Nothing personal in the audit row.
    expect(JSON.stringify(audit.summary)).not.toContain('@')
  })

  it('a payment already refunded at the provider counts as charged and raises the external_refund alert; a void and a later refund raise theirs', async () => {
    const started = await start(await plain())
    const total = started.placed.total
    expect(await apply(started, { status: 'refunded', refunded: total })).toEqual({ outcome: 'paid', orderNumber: started.placed.number })
    expect(await attemptOf(started.attemptId)).toMatchObject({ status: 'paid', captured_halalas: total, provider_status: 'refunded', provider_refunded_halalas: total })
    const everyOwner = await owners()
    expect(await alerts('external_refund', `${started.attemptId}:${total}`)).toBe(everyOwner)
    expect(await alerts('provider_status', `${started.attemptId}:refunded`)).toBe(0)
    // The same facts again change nothing and add no alert.
    expect(await apply(started, { status: 'refunded', refunded: total })).toEqual({ outcome: 'already_paid', orderNumber: started.placed.number })
    expect(await alerts('external_refund', `${started.attemptId}:${total}`)).toBe(everyOwner)

    // The provider's total only grows: a stale lower one is ignored, a higher one is alerted once more.
    const partial = await start(await place([{ variantId: await digital(10_000), quantity: 1 }]))
    expect(await apply(partial)).toMatchObject({ outcome: 'paid' })
    expect(await alerts('external_refund', `${partial.attemptId}:2500`)).toBe(0)
    expect(await apply(partial, { refunded: 2500 })).toMatchObject({ outcome: 'already_paid' })
    expect(await alerts('external_refund', `${partial.attemptId}:2500`)).toBe(everyOwner)
    expect(await apply(partial, { refunded: 1000 })).toMatchObject({ outcome: 'already_paid' })
    expect((await attemptOf(partial.attemptId)).provider_refunded_halalas).toBe(2500)
    expect(await alerts('external_refund', `${partial.attemptId}:2500`)).toBe(everyOwner)
    expect(await alerts('external_refund', `${partial.attemptId}:1000`)).toBe(0)

    // A void of the paying payment: not paid again, the order stays paid, one alert.
    expect(await apply(partial, { status: 'voided', refunded: 2500 })).toEqual({ outcome: 'not_paid' })
    expect(await attemptOf(partial.attemptId)).toMatchObject({ status: 'paid', provider_status: 'voided' })
    expect((await orderOf(partial.placed.id)).status).toBe('paid')
    expect(await alerts('provider_status', `${partial.attemptId}:voided`)).toBe(everyOwner)

    // The provider moves our own paying payment to captured: it is not a second payment, so no review row; one alert.
    expect(await apply(partial, { status: 'captured', refunded: 2500 })).toEqual({ outcome: 'already_paid', orderNumber: partial.placed.number })
    expect(await count('select count(*)::int as n from finance.payment_reviews where attempt_id = $1', [partial.attemptId])).toBe(0)
    expect(await alerts('provider_status', `${partial.attemptId}:captured`)).toBe(everyOwner)
    expect((await orderOf(partial.placed.id)).status).toBe('paid')
  })

  it('replays: already_paid, with nothing duplicated; a failed sibling payment on a paid attempt does not overwrite its provider columns', async () => {
    const variant = await physical(6900, 5)
    const placed = await place([{ variantId: variant, quantity: 2 }])
    const started = await start(placed)
    expect(await apply(started)).toMatchObject({ outcome: 'paid' })
    const counts = async () => ({
      stock: await stockOf(variant),
      receipts: (await receipts(placed.id)).length,
      fulfilments: await count('select count(*)::int as n from finance.fulfillments where order_id = $1', [placed.id]),
      paidAudit: await count("select count(*)::int as n from public.audit_events where action = 'order.paid' and entity_id = $1", [placed.id]),
    })
    const once = await counts()
    expect(once).toEqual({ stock: 3, receipts: 1, fulfilments: 1, paidAudit: 1 })
    expect(await apply(started)).toEqual({ outcome: 'already_paid', orderNumber: placed.number })
    expect(await counts()).toEqual(once)

    const paid = await attemptOf(started.attemptId)
    for (const status of ['failed', 'initiated', 'voided']) {
      expect(await apply(started, { paymentId: randomUUID(), status, fee: 1, amount: 1 }), status).toEqual({ outcome: 'not_paid' })
    }
    expect(await attemptOf(started.attemptId)).toEqual(paid)
    expect(await counts()).toEqual(once)
  })
})

// --- settles once ----------------------------------------------------------------

describe('a payment settles once', () => {
  /** An order of every kind of line, so one settle has something of each to duplicate. */
  async function everyKind() {
    const coupon = await makeCoupon({ percentBp: 1000, usageLimit: 20 })
    const digitals = [await digital(3500), await digital(1500)]
    const shelves = [await physical(6900, 20), await physical(2500, 20)]
    const lines = [...digitals, ...shelves].map((variantId) => ({ variantId, quantity: 2 }))
    return { placed: await place(lines, { couponCode: coupon.code }), digitals, shelves }
  }
  async function expectSettledOnce(placed: Placed, started: Started, shelves: string[]) {
    expect(await count("select count(*)::int as n from finance.payment_attempts where order_id = $1 and status = 'paid'", [placed.id])).toBe(1)
    expect(await attemptOf(started.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: started.paymentId })
    for (const shelf of shelves) expect(await stockOf(shelf)).toBe(18)
    expect(await count("select count(*)::int as n from finance.coupon_redemptions where order_id = $1 and state = 'committed'", [placed.id])).toBe(1)
    expect(await count('select count(*)::int as n from finance.coupon_redemptions where order_id = $1', [placed.id])).toBe(1)
    expect(await receipts(placed.id)).toHaveLength(1)
    expect(await count('select count(*)::int as n from finance.entitlements where order_id = $1', [placed.id])).toBe(2)
    expect(await count('select count(*)::int as n from finance.fulfillments where order_id = $1', [placed.id])).toBe(2)
    expect(await count("select count(*)::int as n from finance.inventory_reservations where order_id = $1 and state = 'committed'", [placed.id])).toBe(2)
    expect(await count("select count(*)::int as n from public.audit_events where action = 'order.paid' and entity_id = $1", [placed.id])).toBe(1)
    expect((await orderOf(placed.id)).status).toBe('paid')
  }

  it('the same payment applied 20 times in a row: one paid attempt, one decrement, one coupon commit, one receipt, one entitlement and one fulfilment per item', async () => {
    const { placed, shelves } = await everyKind()
    const started = await start(placed)
    const outcomes: string[] = []
    for (let i = 0; i < 20; i += 1) outcomes.push((await apply(started)).outcome)
    expect(outcomes).toEqual(['paid', ...Array<string>(19).fill('already_paid')])
    await expectSettledOnce(placed, started, shelves)
  })

  it('the same payment applied by 6 connections at once: the same single settlement', async () => {
    const { placed, shelves } = await everyKind()
    const started = await start(placed)
    const answers = await Promise.all(pool.map((client) => apply(started, {}, { client })))
    expect(answers.filter((a) => a.outcome === 'paid')).toHaveLength(1)
    expect(answers.filter((a) => a.outcome === 'already_paid')).toHaveLength(5)
    await expectSettledOnce(placed, started, shelves)
  })

  it('the webhook, the callback and a verify racing for one payment on two invoices of one order: one settlement, the other money in review', async () => {
    const variant = await physical(6900, 5)
    const placed = await place([{ variantId: variant, quantity: 1 }])
    const first = await start(placed)
    expect(await close(first.attemptId, 'expired')).toMatchObject({ ok: true })
    const second = await start(placed)
    const answers = await Promise.all([apply(first, {}, { client: pool[0] }), apply(second, {}, { client: pool[1] }), apply(second, {}, { client: pool[2] })])
    // Whichever invoice settled first paid the order; the other payment is held for review.
    expect(answers.filter((a) => a.outcome === 'paid')).toHaveLength(1)
    expect(answers.filter((a) => a.outcome === 'review' && a.reason === 'ORDER_ALREADY_PAID').length + answers.filter((a) => a.outcome === 'already_paid').length).toBe(2)
    expect(await stockOf(variant)).toBe(4)
    expect(await count("select count(*)::int as n from finance.payment_attempts where order_id = $1 and status = 'paid'", [placed.id])).toBe(1)
    expect(await receipts(placed.id)).toHaveLength(1)
  })
})

// --- late payment --------------------------------------------------------------------

/** The hold ended and the minute job ran: the order is expired and its holds are released. */
async function expireHold(orderId: string): Promise<void> {
  await postgres.query("update finance.orders set hold_expires_at = now() - interval '2 minutes' where id = $1", [orderId])
  await postgres.query("update finance.inventory_reservations set expires_at = now() - interval '2 minutes' where order_id = $1", [orderId])
  await postgres.query("update finance.coupon_redemptions set expires_at = now() - interval '2 minutes' where order_id = $1", [orderId])
  // The real minute job may hold the order for a moment: its `skip locked` would leave it to the next call.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await postgres.query('select finance.checkout_expire()')
    if ((await orderOf(orderId)).status === 'expired') return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect((await orderOf(orderId)).status).toBe('expired')
}

describe('a payment after the hold ended', () => {
  it('reacquires the stock when it is still there: the order expired, the payment pays it', async () => {
    const variant = await physical(6900, 3)
    const placed = await place([{ variantId: variant, quantity: 2 }])
    const started = await start(placed)
    await expireHold(placed.id)
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [placed.id])).toEqual({ state: 'released' })
    expect(await stockOf(variant)).toBe(3)

    expect(await apply(started)).toEqual({ outcome: 'paid', orderNumber: placed.number })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await row('select state, released_at from finance.inventory_reservations where order_id = $1', [placed.id])).toEqual({ state: 'committed', released_at: null })
    expect(await stockOf(variant)).toBe(1)
    expect(await attemptOf(started.attemptId)).toMatchObject({ status: 'paid', provider_payment_id: started.paymentId })
    expect(await receipts(placed.id)).toHaveLength(1)
    expect(await count('select count(*)::int as n from finance.fulfillments where order_id = $1', [placed.id])).toBe(1)
  })

  it('when another order took the last unit meanwhile the payment is kept: paid_needs_resolution, nothing committed, an alert and the under-review receipt', async () => {
    const variant = await physical(6900, 1)
    const coupon = await makeCoupon({ percentBp: 1000 })
    const placed = await place([{ variantId: variant, quantity: 1 }], { couponCode: coupon.code })
    const started = await start(placed)
    await expireHold(placed.id)
    const taker = await place([{ variantId: variant, quantity: 1 }])

    expect(await apply(started)).toEqual({ outcome: 'paid_needs_resolution', orderNumber: placed.number })
    const order = await orderOf(placed.id)
    expect(order.status).toBe('paid_needs_resolution')
    expect(order.paid_at).not.toBeNull()
    expect(await attemptOf(started.attemptId)).toMatchObject({
      status: 'paid',
      provider_payment_id: started.paymentId,
      captured_halalas: placed.total,
      fee_halalas: 150,
      source_type: 'creditcard',
      source_company: 'mada',
      next_check_at: null,
    })
    // Nothing committed, granted, decremented or shipped; the other order's hold is intact.
    expect(await stockOf(variant)).toBe(1)
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [placed.id])).toEqual({ state: 'released' })
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [taker.id])).toEqual({ state: 'held' })
    expect(await row('select state from finance.coupon_redemptions where order_id = $1', [placed.id])).toEqual({ state: 'released' })
    expect(await count('select count(*)::int as n from finance.entitlements where order_id = $1', [placed.id])).toBe(0)
    expect(await count('select count(*)::int as n from finance.fulfillments where order_id = $1', [placed.id])).toBe(0)
    expect(await alerts('needs_resolution', placed.id)).toBe(await owners())
    const receipt = await receipts(placed.id)
    expect(receipt).toHaveLength(1)
    expect(receipt[0]!.payload).toEqual({ orderId: placed.id })
    const audit = await row("select summary from public.audit_events where action = 'order.paid_needs_resolution' and entity_id = $1", [placed.id])
    expect(audit.summary).toMatchObject({ orderNumber: placed.number, amount: placed.total, paymentId: started.paymentId })
    // A replay changes nothing and alerts nothing more.
    expect(await apply(started)).toEqual({ outcome: 'already_paid', orderNumber: placed.number })
    expect(await alerts('needs_resolution', placed.id)).toBe(await owners())
    expect(await receipts(placed.id)).toHaveLength(1)
  })

  it('pays through an attempt that already closed (expired, cancelled, failed or abandoned) once it holds an invoice id', async () => {
    for (const closed of ['expired', 'cancelled', 'failed', 'abandoned']) {
      const placed = await plain()
      const begun = await begin(placed)
      const invoiceId = randomUUID()
      if (closed === 'expired' || closed === 'cancelled') {
        expect(await adopt(begun.attemptId, invoiceId)).toEqual({ ok: true })
        expect(await close(begun.attemptId, closed)).toMatchObject({ ok: true })
      } else {
        // A creation that was refused or given up on, and whose invoice turned up anyway (the late 201).
        if (closed === 'failed') {
          expect(await close(begun.attemptId, 'failed', 'PROVIDER_REFUSED')).toMatchObject({ ok: true })
        } else {
          expect(await close(begun.attemptId, 'uncertain')).toMatchObject({ ok: true })
          expect(await close(begun.attemptId, 'abandoned')).toMatchObject({ ok: true })
        }
        expect(await adopt(begun.attemptId, invoiceId)).toEqual({ ok: false, code: 'ATTEMPT_CLOSED' })
      }
      expect((await attemptOf(begun.attemptId)).status, closed).toBe(closed)
      const started: Started = { attemptId: begun.attemptId, invoiceId, paymentId: randomUUID(), placed }
      expect(await apply(started), closed).toEqual({ outcome: 'paid', orderNumber: placed.number })
      expect(await attemptOf(begun.attemptId), closed).toMatchObject({ status: 'paid', provider_payment_id: started.paymentId, next_check_at: null })
      expect((await orderOf(placed.id)).status, closed).toBe('paid')
    }
  })

  it('pays a cancelled order', async () => {
    const variant = await physical(6900, 2)
    const placed = await place([{ variantId: variant, quantity: 1 }])
    const started = await start(placed)
    // The buyer's cancel is refused while the attempt is active; the function closes it once the provider cancelled the invoice.
    const cancel = (): Promise<any> => call('checkout_cancel', { p_order_number: placed.number, p_access_token_hash: placed.hash })
    expect(await cancel()).toMatchObject({ ok: false, code: 'PAYMENT_ACTIVE' })
    expect(await close(started.attemptId, 'cancelled', 'BUYER_CANCELLED')).toMatchObject({ ok: true })
    expect(await cancel()).toMatchObject({ ok: true, status: 'cancelled' })
    expect(await stockOf(variant)).toBe(2)
    expect(await apply(started)).toEqual({ outcome: 'paid', orderNumber: placed.number })
    expect((await orderOf(placed.id)).status).toBe('paid')
    expect(await stockOf(variant)).toBe(1)
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [placed.id])).toEqual({ state: 'committed' })
  })

  it('a hold still open whose stock the owner lowered to 0 gives paid_needs_resolution and the stock stays 0, never an exception', async () => {
    const variant = await physical(6900, 3)
    const placed = await place([{ variantId: variant, quantity: 2 }])
    const started = await start(placed)
    await postgres.query('update public.product_variants set stock = 0 where id = $1', [variant])
    expect(await apply(started)).toEqual({ outcome: 'paid_needs_resolution', orderNumber: placed.number })
    expect(await stockOf(variant)).toBe(0)
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [placed.id])).toEqual({ state: 'held' })
    expect((await orderOf(placed.id)).status).toBe('paid_needs_resolution')
    // A hold that is still open needs only the units to exist: other orders' holds do not count against it.
    const open = await physical(6900, 2)
    const first = await place([{ variantId: open, quantity: 1 }])
    const second = await place([{ variantId: open, quantity: 1 }])
    expect(await apply(await start(first))).toMatchObject({ outcome: 'paid' })
    expect(await apply(await start(second))).toMatchObject({ outcome: 'paid' })
    expect(await stockOf(open)).toBe(0)
  })

  it('a coupon whose limit was reached meanwhile is still committed, and the audit row marks it', async () => {
    const coupon = await makeCoupon({ percentBp: 1000, usageLimit: 1 })
    const variant = await digital(10_000)
    const placed = await place([{ variantId: variant, quantity: 1 }], { couponCode: coupon.code })
    const started = await start(placed)
    await expireHold(placed.id)
    expect(await row('select state from finance.coupon_redemptions where order_id = $1', [placed.id])).toEqual({ state: 'released' })
    // The use went to another buyer while this one was away.
    const other = await place([{ variantId: variant, quantity: 1 }], { couponCode: coupon.code })
    expect(await row('select state from finance.coupon_redemptions where order_id = $1', [other.id])).toEqual({ state: 'held' })

    expect(await apply(started)).toEqual({ outcome: 'paid', orderNumber: placed.number })
    expect(await row('select state, released_at from finance.coupon_redemptions where order_id = $1', [placed.id])).toEqual({ state: 'committed', released_at: null })
    expect(await row('select state from finance.coupon_redemptions where order_id = $1', [other.id])).toEqual({ state: 'held' })
    const audit = await row("select summary from public.audit_events where action = 'order.paid' and entity_id = $1", [placed.id])
    expect(audit.summary.couponOverLimit).toBe(true)
    // A commit within the limit carries no flag.
    const fine = await makeCoupon({ percentBp: 1000, usageLimit: 3 })
    const within = await place([{ variantId: variant, quantity: 1 }], { couponCode: fine.code })
    await apply(await start(within))
    expect((await row("select summary from public.audit_events where action = 'order.paid' and entity_id = $1", [within.id])).summary.couponOverLimit).toBeUndefined()
  })

  it('a preorder reservation commits against the capacity, never touches stock, and fails when the capacity is used up', async () => {
    const variant = await physical(6900, 5)
    const first = await place([{ variantId: variant, quantity: 1 }])
    const second = await place([{ variantId: variant, quantity: 1 }])
    const firstPayment = await start(first)
    const secondPayment = await start(second)
    // From now on the variant sells by capacity; its stock (0) is ignored. The orders are marked as the checkout will (round 4).
    await postgres.query(
      `update public.product_variants set stock = 0, preorder = true, preorder_capacity = 1, preorder_ships_on = '2027-06-01', preorder_note = 'يصلك لاحقًا' where id = $1`,
      [variant],
    )
    await postgres.query('update finance.inventory_reservations set preorder = true where order_id = any($1::uuid[])', [[first.id, second.id]])
    await postgres.query(
      "update finance.order_items set preorder = true, preorder_ships_on = '2027-06-01', preorder_note = 'يصلك لاحقًا' where order_id = any($1::uuid[])",
      [[first.id, second.id]],
    )

    expect(await apply(firstPayment)).toEqual({ outcome: 'paid', orderNumber: first.number })
    expect(await stockOf(variant)).toBe(0)
    expect(await row('select state, preorder from finance.inventory_reservations where order_id = $1', [first.id])).toEqual({ state: 'committed', preorder: true })
    expect(await count('select finance.preorder_committed($1) as n', [variant])).toBe(1)
    expect(await count('select finance.availability($1) as n', [variant])).toBe(0)
    // The capacity is used: the second payment is kept for resolution, nothing committed.
    expect(await apply(secondPayment)).toEqual({ outcome: 'paid_needs_resolution', orderNumber: second.number })
    expect(await row('select state from finance.inventory_reservations where order_id = $1', [second.id])).toEqual({ state: 'held' })
    expect(await stockOf(variant)).toBe(0)
    expect(await count('select finance.preorder_committed($1) as n', [variant])).toBe(1)
  })

  it('a reservation flagged as a preorder decides by capacity even when the variant is no longer one; a stocked line flagged otherwise uses stock', async () => {
    const variant = await physical(6900, 5)
    const placed = await place([{ variantId: variant, quantity: 2 }])
    const started = await start(placed)
    await postgres.query('update finance.inventory_reservations set preorder = true where order_id = $1', [placed.id])
    // The variant has no capacity (null): the reservation's own flag is what counts, so it fails.
    expect(await apply(started)).toMatchObject({ outcome: 'paid_needs_resolution' })
    expect(await stockOf(variant)).toBe(5)
    expect(await count('select finance.availability($1) as n', [variant])).toBe(3)
  })

  it('finance.order_try_commit skips a line that is fully refunded: nothing is committed, granted or shipped for it', async () => {
    const gone = await physical(6900, 5)
    const kept = await physical(2500, 5)
    const placed = await place([{ variantId: gone, quantity: 1 }, { variantId: kept, quantity: 1 }])
    await postgres.query('begin')
    try {
      // The first line cannot be delivered, but it is already refunded in full, so it does not count.
      await postgres.query('update public.product_variants set stock = 0 where id = $1', [gone])
      const attempt = await insertAttempt(placed.id, 'paid', { provider_payment_id: randomUUID(), captured_halalas: placed.total })
      const item = await row('select id, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1 and variant_id = $2', [placed.id, gone])
      // Not yet refunded: the line counts and fails.
      expect((await row("select finance.order_try_commit($1, $2) as ok", [placed.id, `receipt:${EVENT_PREFIX}skip-1`])).ok).toBe(false)
      expect(await row('select state from finance.inventory_reservations where order_id = $1 and variant_id = $2', [placed.id, kept])).toEqual({ state: 'held' })
      // A partial refund of the line does not skip it either.
      await postgres.query(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, allocation, status, succeeded_at)
         values ($1, $2, 100, 'جزئي', $3::jsonb, 'succeeded', now())`,
        [placed.id, attempt, JSON.stringify({ items: [{ itemId: item.id, amount: 100 }], shipping: 0 })],
      )
      expect((await row("select finance.order_try_commit($1, $2) as ok", [placed.id, `receipt:${EVENT_PREFIX}skip-2`])).ok).toBe(false)
      await postgres.query(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, allocation, status, succeeded_at)
         values ($1, $2, $3, 'الباقي', $4::jsonb, 'succeeded', now())`,
        [placed.id, attempt, item.paid - 100, JSON.stringify({ items: [{ itemId: item.id, amount: item.paid - 100 }], shipping: 0 })],
      )
      expect((await row("select finance.order_try_commit($1, $2) as ok", [placed.id, `receipt:${EVENT_PREFIX}skip-3`])).ok).toBe(true)
      expect(await row('select state from finance.inventory_reservations where order_id = $1 and variant_id = $2', [placed.id, gone])).toEqual({ state: 'held' })
      expect(await row('select state from finance.inventory_reservations where order_id = $1 and variant_id = $2', [placed.id, kept])).toEqual({ state: 'committed' })
      expect(await stockOf(gone)).toBe(0)
      expect(await stockOf(kept)).toBe(4)
      const fulfilments = await rows('select order_item_id from finance.fulfillments where order_id = $1', [placed.id])
      expect(fulfilments).toHaveLength(1)
      expect(fulfilments[0]!.order_item_id).not.toBe(item.id)
      expect(await count('select count(*)::int as n from finance.email_outbox where dedupe_key = $1', [`receipt:${EVENT_PREFIX}skip-3`])).toBe(1)
    } finally {
      await postgres.query('rollback')
    }
  })
})

// --- concurrency with checkout --------------------------------------------------------

describe('concurrency with checkout', () => {
  it('a payment for the last unit racing a checkout for the same variant never oversells (five rounds)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const variant = await physical(6900, 1)
      const placed = await place([{ variantId: variant, quantity: 1 }])
      const started = await start(placed)
      await expireHold(placed.id)
      // Quote the rival's cart before the race, so the two connections only race the commit and the hold.
      const priced = await call('checkout_quote', { p_ip_hash: ipHash(), p_lines: [{ variantId: variant, quantity: 1 }], p_city_key: city, p_coupon_code: null })
      expect(priced.ok).toBe(true)
      const key = randomUUID()
      const rival = call(
        'checkout_create',
        {
          p_idempotency_key: key,
          p_request_hash: sha256(`request:${key}`),
          p_checkout_session: randomUUID(),
          p_ip_hash: ipHash(),
          p_email: uniqueEmail('rival'),
          p_name: 'مشترٍ',
          p_phone: '966501234567',
          p_lines: [{ variantId: variant, quantity: 1 }],
          p_city_key: city,
          p_address: 'تبوك شارع الرئيسي',
          p_coupon_code: null,
          p_policy_revisions: REV,
          p_quote_hash: priced.quoteHash,
          p_access_token_hash: hashFor(tokenFor(key)),
          p_environment: 'test',
        },
        pool[1],
      )
      const [payment, checkout] = await Promise.all([apply(started, {}, { client: pool[0] }), rival])
      if (checkout.order) created.orders.push(checkout.order.id)
      const stock = await stockOf(variant)
      expect(stock, `round ${round}`).toBeGreaterThanOrEqual(0)
      if (payment.outcome === 'paid') {
        // The payment got the unit: the rival found none.
        expect(stock).toBe(0)
        expect(checkout.ok).toBe(false)
        expect(checkout.code).toBe('OUT_OF_STOCK')
      } else {
        // The rival's hold got it: the payment is kept for resolution, nothing committed.
        expect(payment.outcome).toBe('paid_needs_resolution')
        expect(stock).toBe(1)
        expect(checkout.ok).toBe(true)
        expect(await row('select state from finance.inventory_reservations where order_id = $1', [checkout.order.id])).toEqual({ state: 'held' })
      }
      // Never both: units sold or held never exceed what existed.
      const committed = await count("select coalesce(sum(quantity), 0)::int as n from finance.inventory_reservations where variant_id = $1 and state = 'committed'", [variant])
      const held = await count("select coalesce(sum(quantity), 0)::int as n from finance.inventory_reservations where variant_id = $1 and state = 'held' and expires_at > now()", [variant])
      expect(committed + held, `round ${round}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('concurrency: a crowd for a few units', () => {
  it('four late payments, all sharing one coupon, and two checkouts racing for two units: exactly two units go out, nothing deadlocks (three rounds)', async () => {
    for (let round = 0; round < 3; round += 1) {
      const variant = await physical(6900, 2)
      const coupon = await makeCoupon({ percentBp: 500, usageLimit: 100 })
      // Four orders that each held a unit and lost the hold: two at a time, as the stock allows.
      const late: Started[] = []
      for (let wave = 0; wave < 2; wave += 1) {
        const pair = [
          await place([{ variantId: variant, quantity: 1 }], { couponCode: coupon.code }),
          await place([{ variantId: variant, quantity: 1 }], { couponCode: coupon.code }),
        ]
        for (const placed of pair) late.push(await start(placed))
        for (const started of late.slice(-2)) await expireHold(started.placed.id)
      }
      const prepareRival = async (client: Client): Promise<() => Promise<any>> => {
        const priced = await call('checkout_quote', { p_ip_hash: ipHash(), p_lines: [{ variantId: variant, quantity: 1 }], p_city_key: city, p_coupon_code: null })
        const key = randomUUID()
        return () =>
          call(
            'checkout_create',
            {
              p_idempotency_key: key,
              p_request_hash: sha256(`request:${key}`),
              p_checkout_session: randomUUID(),
              p_ip_hash: ipHash(),
              p_email: uniqueEmail('crowd'),
              p_name: 'مشترٍ',
              p_phone: '966501234567',
              p_lines: [{ variantId: variant, quantity: 1 }],
              p_city_key: city,
              p_address: 'تبوك شارع الرئيسي',
              p_coupon_code: null,
              p_policy_revisions: REV,
              p_quote_hash: priced.quoteHash,
              p_access_token_hash: hashFor(tokenFor(key)),
              p_environment: 'test',
            },
            client,
          )
      }
      const rivals = [await prepareRival(pool[4]!), await prepareRival(pool[5]!)]
      // No `catch`: a deadlock (40P01) or any other raised error fails the round.
      const answers = await Promise.all([...late.map((started, i) => apply(started, {}, { client: pool[i] })), ...rivals.map((go) => go())])
      const payments = answers.slice(0, 4)
      const checkouts = answers.slice(4)
      for (const checkout of checkouts) if (checkout.order) created.orders.push(checkout.order.id)
      const paid = payments.filter((p) => p.outcome === 'paid').length
      const kept = payments.filter((p) => p.outcome === 'paid_needs_resolution').length
      const held = checkouts.filter((c) => c.ok === true).length
      expect(paid + kept, `round ${round}`).toBe(4)
      // Every competitor took a unit if one was left when its turn came: all two went, none twice.
      expect(paid + held, `round ${round}`).toBe(2)
      expect(await stockOf(variant), `round ${round}`).toBe(2 - paid)
      expect(await count("select coalesce(sum(quantity), 0)::int as n from finance.inventory_reservations where variant_id = $1 and state = 'committed'", [variant])).toBe(paid)
      // A payment kept for resolution committed nothing: it never took the coupon either.
      expect(await count("select count(*)::int as n from finance.coupon_redemptions where coupon_id = $1 and state = 'committed'", [coupon.id])).toBe(paid)
    }
  })
})

// --- two owners ---------------------------------------------------------------------------

describe('owner alerts', () => {
  it('creates one outbox row per active owner, none for a revoked owner or operations, and a second identical alert creates none', async () => {
    const first = await makeStaff('owner')
    const second = await makeStaff('owner')
    const revoked = await makeStaff('owner', { active: false })
    const operations = operationsUser
    const subject = randomUUID()
    const raise = () => postgres.query("select finance.owner_alert('p08_probe', $1, $2::jsonb)", [subject, JSON.stringify({ probe: true })])
    await raise()
    const queued = await rows("select recipient, kind, priority, status, payload from finance.email_outbox where dedupe_key like $1", [`p08_probe:${subject}:%`])
    expect(queued).toHaveLength(await owners())
    const recipients = queued.map((r) => r.recipient)
    expect(recipients).toContain(first.email.toLowerCase())
    expect(recipients).toContain(second.email.toLowerCase())
    expect(recipients).not.toContain(revoked.email.toLowerCase())
    expect(recipients).not.toContain(operations.email.toLowerCase())
    expect(new Set(recipients).size).toBe(recipients.length)
    expect(queued.every((r) => r.kind === 'owner_alert' && r.priority === 0 && r.status === 'pending')).toBe(true)
    expect(queued.every((r) => r.payload.alert === 'p08_probe' && r.payload.probe === true)).toBe(true)
    await raise()
    expect(await count('select count(*)::int as n from finance.email_outbox where dedupe_key like $1', [`p08_probe:${subject}:%`])).toBe(queued.length)

    // The same through a real path: an unmapped charged payment, applied twice.
    const ghost = { placed: { total: 900 }, invoiceId: randomUUID(), paymentId: randomUUID() } as unknown as Started
    await apply(ghost)
    await apply(ghost)
    const real = await rows("select recipient from finance.email_outbox where dedupe_key like $1", [`payment_review:${ghost.paymentId}:%`])
    expect(real).toHaveLength(await owners())
    expect(real.map((r) => r.recipient)).toContain(second.email.toLowerCase())
    expect(real.map((r) => r.recipient)).not.toContain(revoked.email.toLowerCase())

    // A subject too long for the dedupe key is shortened, never an error.
    const long = 'x'.repeat(200)
    await postgres.query("select finance.owner_alert('p08_long', $1, '{}'::jsonb)", [long])
    await postgres.query("select finance.owner_alert('p08_long', $1, '{}'::jsonb)", [long])
    expect(await count("select count(*)::int as n from finance.email_outbox where dedupe_key like 'p08_long:%'")).toBe(await owners())
  })

  it('payment_attempt_duplicates: the one alert an Edge Function raises itself, once per owner; an unknown attempt is ignored', async () => {
    const started = await start(await plain())
    const key = `attempt_duplicate_invoices:${started.attemptId}:%`
    await call('payment_attempt_duplicates', { p_attempt: started.attemptId })
    await call('payment_attempt_duplicates', { p_attempt: started.attemptId })
    const queued = await rows('select kind, priority, payload from finance.email_outbox where dedupe_key like $1', [key])
    expect(queued).toHaveLength(await owners())
    expect(queued.every((r) => r.kind === 'owner_alert' && r.priority === 0 && r.payload.attemptId === started.attemptId)).toBe(true)
    const unknown = randomUUID()
    await call('payment_attempt_duplicates', { p_attempt: unknown })
    expect(await count('select count(*)::int as n from finance.email_outbox where dedupe_key like $1', [`attempt_duplicate_invoices:${unknown}:%`])).toBe(0)
  })
})

// --- events ----------------------------------------------------------------------------------

describe('payment events', () => {
  const record = (id: string, over: Record<string, unknown> = {}): Promise<any> =>
    call('payment_event_record', { p_event_id: id, p_type: 'payment_paid', p_live: false, p_payment_id: randomUUID(), p_payload_hash: sha256(id), ...over })
  const result = (id: string, outcome: string, error: string | null = null): Promise<any> =>
    call('payment_event_result', { p_event_id: id, p_outcome: outcome, p_error: error })

  it('records an event once, then reports a duplicate with its processing state; the type and the payment id are stored bounded', async () => {
    const id = `${EVENT_PREFIX}dup`
    const paymentId = randomUUID()
    expect(await record(id, { p_payment_id: paymentId.toUpperCase() })).toEqual({ state: 'recorded' })
    const stored = await row('select * from finance.payment_events where event_id = $1', [id])
    expect(stored).toMatchObject({ type: 'payment_paid', live: false, provider_payment_id: paymentId, payload_hash: sha256(id), processed_at: null, outcome: null, attempts: 0 })
    const due = await secondsAhead('payment_events', 'event_id', id, 'next_check_at')
    expect(due).toBeGreaterThan(20)
    expect(due).toBeLessThanOrEqual(30)
    expect(await record(id)).toEqual({ state: 'duplicate', processed: false })
    await result(id, 'paid')
    expect(await record(id)).toEqual({ state: 'duplicate', processed: true })
    // Anything else about the event is stored bounded: a long type is cut, a payment id that is no UUID is not kept.
    const odd = `${EVENT_PREFIX}odd`
    expect(await record(odd, { p_type: 't'.repeat(100), p_payment_id: 'not-a-uuid' })).toEqual({ state: 'recorded' })
    expect(await row('select char_length(type) as n, provider_payment_id from finance.payment_events where event_id = $1', [odd])).toEqual({ n: 60, provider_payment_id: null })
    // Two connections recording one event: one recorded, one duplicate.
    const race = `${EVENT_PREFIX}race`
    const answers = await Promise.all(pool.slice(0, 4).map((client) => call('payment_event_record', { p_event_id: race, p_type: 'payment_paid', p_live: true, p_payment_id: null, p_payload_hash: null }, client)))
    expect(answers.filter((a) => a.state === 'recorded')).toHaveLength(1)
    expect(answers.filter((a) => a.state === 'duplicate')).toHaveLength(3)
  })

  it('a retry backs off 1, 2, 4 ... 60 minutes and is exhausted at 10 attempts with one owner alert', async () => {
    const id = `${EVENT_PREFIX}retry`
    await record(id)
    const minutes = [1, 2, 4, 8, 16, 32, 60, 60, 60]
    for (let n = 0; n < minutes.length; n += 1) {
      await result(id, 'retry', 'FETCH_FAILED')
      const stored = await row('select * from finance.payment_events where event_id = $1', [id])
      expect(stored).toMatchObject({ attempts: n + 1, processed_at: null, outcome: null, error: 'FETCH_FAILED' })
      const ahead = await secondsAhead('payment_events', 'event_id', id, 'next_check_at')
      expect(ahead, `retry ${n + 1}`).toBeGreaterThan(minutes[n]! * 60 - 15)
      expect(ahead, `retry ${n + 1}`).toBeLessThanOrEqual(minutes[n]! * 60)
    }
    expect(await alerts('event_exhausted', id)).toBe(0)
    await result(id, 'retry', 'FETCH_FAILED')
    const exhausted = await row('select * from finance.payment_events where event_id = $1', [id])
    expect(exhausted).toMatchObject({ attempts: 10, outcome: 'exhausted', next_check_at: null, error: 'FETCH_FAILED' })
    expect(exhausted.processed_at).not.toBeNull()
    expect(await alerts('event_exhausted', id)).toBe(await owners())
    const alert = await row("select payload from finance.email_outbox where dedupe_key like $1 limit 1", [`event_exhausted:${id}:%`])
    expect(alert.payload).toMatchObject({ alert: 'event_exhausted', eventId: id })
    // A closed event is not reopened by a late result.
    await result(id, 'paid')
    expect(await row('select outcome, attempts from finance.payment_events where event_id = $1', [id])).toEqual({ outcome: 'exhausted', attempts: 10 })
    expect(await alerts('event_exhausted', id)).toBe(await owners())
  })

  it('a final outcome sets processed_at and clears the due time; an unknown event is ignored', async () => {
    for (const outcome of ['paid', 'ignored', 'unknown_payment', 'no_invoice', 'mode_mismatch', 'review']) {
      const id = `${EVENT_PREFIX}final-${outcome}`
      await record(id)
      await result(id, outcome)
      const stored = await row('select * from finance.payment_events where event_id = $1', [id])
      expect(stored, outcome).toMatchObject({ outcome, attempts: 1, next_check_at: null, error: null })
      expect(stored.processed_at, outcome).not.toBeNull()
    }
    await result(`${EVENT_PREFIX}missing`, 'paid')
  })
})

// --- the return page, the callback ---------------------------------------------------

describe('payment_check_begin, payment_state and payment_callback_begin', () => {
  const check = (placed: Pick<Placed, 'number' | 'hash'>, over: Record<string, unknown> = {}): Promise<any> =>
    call('payment_check_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_ip_hash: ipHash(), p_mode: 'test', ...over })
  const state = (placed: Pick<Placed, 'number' | 'hash'>, over: Record<string, unknown> = {}): Promise<any> =>
    call('payment_state', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', ...over })
  const callback = (invoiceId: string, over: Record<string, unknown> = {}): Promise<any> =>
    call('payment_callback_begin', { p_invoice_id: invoiceId, p_ip_hash: ipHash(), p_mode: 'test', ...over })

  it('unknown for a missing order and for the other mode: the same shape, nothing more', async () => {
    expect(await check({ number: 'ZZZZ2222', hash: ZERO })).toEqual({ state: 'unknown', hasToken: false })
    const live = await place([{ variantId: await digital(), quantity: 1 }], { environment: 'live' })
    expect(await check(live)).toEqual({ state: 'unknown', hasToken: false })
    expect(await state(live)).toEqual({ state: 'unknown', hasToken: false })
    expect(await check(live, { p_mode: 'live' })).toEqual({ state: 'pending', hasToken: true })
    expect(await state(live, { p_mode: 'live' })).toEqual({ state: 'pending', hasToken: true })
  })

  it('maps every state: pending while an attempt is active (even on an expired order), then paid, needs_resolution, review, refunded, expired, cancelled', async () => {
    // pending: no attempt yet, then each active attempt; the URL only with the token and a pending attempt.
    const placed = await plain()
    expect(await state(placed)).toEqual({ state: 'pending', hasToken: true })
    const begun = await begin(placed)
    expect(await state(placed)).toEqual({ state: 'pending', hasToken: true })
    expect(await close(begun.attemptId, 'uncertain')).toMatchObject({ ok: true })
    expect(await state(placed)).toEqual({ state: 'pending', hasToken: true })
    expect(await adopt(begun.attemptId, begun.attemptId)).toEqual({ ok: true })
    const url = `http://127.0.0.1:54390/invoices/${begun.attemptId}`
    expect(await state(placed)).toEqual({ state: 'pending', hasToken: true, invoiceUrl: url })
    expect(await state({ number: placed.number, hash: ZERO })).toEqual({ state: 'pending', hasToken: false })
    // Even once the order expired: the attempt keeps the page waiting, a payment in the last minute is not "expired".
    await postgres.query("update finance.orders set status = 'expired' where id = $1", [placed.id])
    expect(await state(placed)).toEqual({ state: 'pending', hasToken: true, invoiceUrl: url })
    // The job closes the attempt: now it is expired, and cancelled when the buyer cancelled.
    expect(await close(begun.attemptId, 'expired')).toMatchObject({ ok: true })
    expect(await state(placed)).toEqual({ state: 'expired', hasToken: true })
    await postgres.query("update finance.orders set status = 'cancelled' where id = $1", [placed.id])
    expect(await state(placed)).toEqual({ state: 'cancelled', hasToken: true })
    // A token past its expiry is not a token.
    await postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 minute' where id = $1", [placed.id])
    expect(await state(placed)).toEqual({ state: 'cancelled', hasToken: false })

    const paid = await plain()
    expect(await apply(await start(paid))).toMatchObject({ outcome: 'paid' })
    expect(await state(paid)).toEqual({ state: 'paid', hasToken: true })
    await postgres.query("update finance.orders set status = 'refunded' where id = $1", [paid.id])
    expect(await state(paid)).toEqual({ state: 'refunded', hasToken: true })
    await postgres.query("update finance.orders set status = 'paid_needs_resolution' where id = $1", [paid.id])
    expect(await state(paid)).toEqual({ state: 'needs_resolution', hasToken: true })

    // review: an open review payment and no paid attempt; closed, the order is pending again.
    const reviewed = await plain()
    const started = await start(reviewed)
    expect(await apply(started, { amount: 7 })).toMatchObject({ outcome: 'review' })
    expect(await state(reviewed)).toEqual({ state: 'review', hasToken: true })
    await postgres.query("update finance.payment_reviews set closed_at = now() where provider_payment_id = $1", [started.paymentId])
    expect(await state(reviewed)).toEqual({ state: 'pending', hasToken: true })
  })

  it('check: an attempt worth asking about is returned once, then not for 5 seconds (the call sets fetched_at); never a paid or review one', async () => {
    const placed = await plain()
    const started = await start(placed)
    const first = await check(placed)
    expect(first).toEqual({ state: 'pending', hasToken: true, invoiceUrl: `http://127.0.0.1:54390/invoices/${started.invoiceId}`, check: { attemptId: started.attemptId, providerInvoiceId: started.invoiceId } })
    expect((await attemptOf(started.attemptId)).fetched_at).not.toBeNull()
    // A second caller within 5 seconds gets no check; payment_state never does and never writes.
    const second = await check(placed)
    expect(second.check).toBeUndefined()
    expect(second.state).toBe('pending')
    const fetched = (await attemptOf(started.attemptId)).fetched_at
    expect((await state(placed)).check).toBeUndefined()
    expect((await attemptOf(started.attemptId)).fetched_at).toEqual(fetched)
    await postgres.query("update finance.payment_attempts set fetched_at = now() - interval '6 seconds' where id = $1", [started.attemptId])
    expect((await check(placed)).check).toEqual({ attemptId: started.attemptId, providerInvoiceId: started.invoiceId })
    // The job's own schedule is not moved by a check.
    const due = await secondsAhead('payment_attempts', 'id', started.attemptId, 'next_check_at')
    expect(due).toBeGreaterThan(0)
    expect(due).toBeLessThanOrEqual(60)

    // The unknown token still gets the check: it asks the provider, it reveals nothing.
    await postgres.query("update finance.payment_attempts set fetched_at = null where id = $1", [started.attemptId])
    const anonymous = await check({ number: placed.number, hash: ZERO })
    expect(anonymous).toMatchObject({ state: 'pending', hasToken: false, check: { attemptId: started.attemptId } })
    expect(anonymous.invoiceUrl).toBeUndefined()
  })

  it('check: which statuses are worth asking about', async () => {
    const placed = await plain()
    const attempt = await insertAttempt(placed.id, 'pending', { provider_invoice_id: randomUUID() })
    const asked = async (): Promise<boolean> => {
      await postgres.query('update finance.payment_attempts set fetched_at = null where id = $1', [attempt])
      return (await check(placed)).check !== undefined
    }
    const set = (status: string, invoice: string | null, expires: string, payment: string | null = null) =>
      postgres.query(
        `update finance.payment_attempts set status = $2, provider_invoice_id = $3, provider_payment_id = $5, invoice_expires_at = now() + $4::interval where id = $1`,
        [attempt, status, invoice, expires, payment],
      )
    const invoice = randomUUID()
    for (const status of ['pending', 'uncertain']) {
      await set(status, invoice, '20 minutes')
      expect(await asked(), status).toBe(true)
    }
    // Closed with an invoice that expired less than 24 hours ago: still worth a look (a late payment).
    for (const status of ['expired', 'cancelled', 'failed', 'abandoned']) {
      await set(status, invoice, '-23 hours')
      expect(await asked(), `${status} 23h`).toBe(true)
      await set(status, invoice, '-25 hours')
      expect(await asked(), `${status} 25h`).toBe(false)
    }
    // Never without an invoice id, never paid or review.
    await set('pending', null, '20 minutes')
    expect(await asked()).toBe(false)
    await set('uncertain', null, '20 minutes')
    expect(await asked()).toBe(false)
    for (const status of ['paid', 'review']) {
      await set(status, invoice, '-1 hour', randomUUID())
      expect(await asked(), status).toBe(false)
    }
    // A creating attempt has no invoice to ask about.
    await set('creating', null, '20 minutes')
    expect(await asked()).toBe(false)
  })

  it('check: with several attempts worth asking about, the newest is offered first, then the older one while the newest is fresh', async () => {
    const placed = await plain()
    const older = await insertAttempt(placed.id, 'expired', { provider_invoice_id: randomUUID() }, '-1 hour')
    await postgres.query("update finance.payment_attempts set created_at = now() - interval '1 hour' where id = $1", [older])
    const newest = await start(placed)
    expect((await check(placed)).check).toEqual({ attemptId: newest.attemptId, providerInvoiceId: newest.invoiceId })
    expect((await check(placed)).check).toEqual({ attemptId: older, providerInvoiceId: (await attemptOf(older)).provider_invoice_id })
    expect((await check(placed)).check).toBeUndefined()
  })

  it('check: the throttle is 120 an hour per IP hash and raises 54000 over it', async () => {
    const hash = ipHash()
    for (let i = 0; i < 120; i += 1) {
      expect(await check({ number: 'ZZZZ2222', hash: ZERO }, { p_ip_hash: hash })).toEqual({ state: 'unknown', hasToken: false })
    }
    await expect(check({ number: 'ZZZZ2222', hash: ZERO }, { p_ip_hash: hash })).rejects.toMatchObject({ code: '54000' })
    expect(await check({ number: 'ZZZZ2222', hash: ZERO }, { p_ip_hash: ipHash() })).toEqual({ state: 'unknown', hasToken: false })
    // payment_state is not throttled and takes no hash.
    for (let i = 0; i < 3; i += 1) expect((await state({ number: 'ZZZZ2222', hash: ZERO })).state).toBe('unknown')
  })

  it('callback: a check for a known invoice, {} for an unknown one, {} within 5 seconds and {} when throttled (never an error)', async () => {
    const started = await start(await plain())
    expect(await callback(started.invoiceId)).toEqual({ check: { attemptId: started.attemptId, providerInvoiceId: started.invoiceId } })
    expect(await callback(started.invoiceId)).toEqual({})
    expect(await callback(randomUUID())).toEqual({})
    expect(await callback('')).toEqual({})
    // The other mode's invoice is not this site's.
    expect(await callback(started.invoiceId, { p_mode: 'live' })).toEqual({})
    // A paid attempt is not asked about.
    await postgres.query("update finance.payment_attempts set fetched_at = null where id = $1", [started.attemptId])
    expect(await apply(started)).toMatchObject({ outcome: 'paid' })
    expect(await callback(started.invoiceId)).toEqual({})

    const hash = ipHash()
    for (let i = 0; i < 60; i += 1) expect(await callback(randomUUID(), { p_ip_hash: hash })).toEqual({})
    const waiting = await start(await plain())
    expect(await callback(waiting.invoiceId, { p_ip_hash: hash })).toEqual({})
    expect((await attemptOf(waiting.attemptId)).fetched_at).toBeNull()
    expect(await callback(waiting.invoiceId, { p_ip_hash: ipHash() })).toMatchObject({ check: { attemptId: waiting.attemptId } })
  })
})

// --- the job's claim and the check results ----------------------------------------------

describe('payment_reconcile_claim', () => {
  const claim = (mode = 'test', client?: Client): Promise<any> => call('payment_reconcile_claim', { p_mode: mode }, client)

  it('claims only the due attempts of the mode, leases them for two minutes, and turns a creating row older than 30 seconds into uncertain', async () => {
    await parkAll()
    const stale = await plain()
    const creating = (await begin(stale)).attemptId
    await postgres.query("update finance.payment_attempts set created_at = now() - interval '2 minutes', next_check_at = now() - interval '1 minute' where id = $1", [creating])
    const pending = await start(await plain())
    await postgres.query("update finance.payment_attempts set next_check_at = now() - interval '2 minutes' where id = $1", [pending.attemptId])
    const notDue = await start(await plain())
    const live = await start(await place([{ variantId: await digital(), quantity: 1 }], { environment: 'live' }), 'live')
    await postgres.query("update finance.payment_attempts set next_check_at = now() - interval '1 minute' where id = $1", [live.attemptId])

    const claimed = await claim()
    expect(claimed.events).toEqual([])
    expect(claimed.refunds).toEqual([])
    const ids = claimed.attempts.map((a: any) => a.attemptId)
    // Ordered by due time: the older first.
    expect(ids).toEqual([pending.attemptId, creating])
    expect(claimed.attempts[0]).toEqual({
      attemptId: pending.attemptId,
      status: 'pending',
      providerInvoiceId: pending.invoiceId,
      orderNumber: pending.placed.number,
      orderPaid: false,
      createdAt: expect.any(String),
      amount: pending.placed.total,
      currency: 'SAR',
    })
    expect(claimed.attempts[1]).toMatchObject({ attemptId: creating, status: 'uncertain', providerInvoiceId: null, orderNumber: stale.number })
    expect((await attemptOf(creating)).status).toBe('uncertain')
    for (const id of [pending.attemptId, creating]) {
      const ahead = await secondsAhead('payment_attempts', 'id', id, 'next_check_at')
      expect(ahead).toBeGreaterThan(100)
      expect(ahead).toBeLessThanOrEqual(120)
    }
    // The lease: an overlapping run takes nothing, and the rows that were not due were left alone.
    expect((await claim()).attempts).toEqual([])
    const kept = await secondsAhead('payment_attempts', 'id', notDue.attemptId, 'next_check_at')
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThanOrEqual(60)
    // Work of the other mode cannot be checked with this key: the claim parked it (no due time, marked), so it
    // neither wakes the job every minute nor blocks the retention purge, and a claim of that mode finds nothing.
    expect(await attemptOf(live.attemptId)).toMatchObject({ status: 'expired', next_check_at: null, last_error: 'MODE_CHANGED' })
    expect((await claim('live')).attempts).toEqual([])
    // Two runs at once never take the same row.
    for (const id of [pending.attemptId, creating]) {
      await postgres.query("update finance.payment_attempts set next_check_at = now() - interval '1 minute' where id = $1", [id])
    }
    const both = await Promise.all([claim('test', pool[0]), claim('test', pool[1]), claim('test', pool[2])])
    expect(both.flatMap((c) => c.attempts.map((a: any) => a.attemptId)).sort()).toEqual([pending.attemptId, creating].sort())
  })

  it('reports an order that is already paid, so the job can cancel the other invoice', async () => {
    await parkAll()
    const variant = await physical(6900, 3)
    const placed = await place([{ variantId: variant, quantity: 1 }])
    const first = await start(placed)
    expect(await close(first.attemptId, 'expired')).toMatchObject({ ok: true })
    const second = await start(placed)
    // The first invoice is paid late: the order is paid and the second attempt, still pending, is due at once.
    expect(await apply(first)).toMatchObject({ outcome: 'paid' })
    expect(await attemptOf(second.attemptId)).toMatchObject({ status: 'pending' })
    expect(await secondsAhead('payment_attempts', 'id', second.attemptId, 'next_check_at')).toBeLessThanOrEqual(1)
    // The buyer's page says paid at once and is offered no second invoice, though that attempt is still open.
    expect(await call('payment_state', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test' })).toEqual({
      state: 'paid',
      hasToken: true,
    })
    const claimed = await claim()
    expect(claimed.attempts).toHaveLength(1)
    expect(claimed.attempts[0]).toMatchObject({ attemptId: second.attemptId, status: 'pending', orderPaid: true, providerInvoiceId: second.invoiceId })
    // And the paid attempt itself is not due: a settled one has no schedule.
    expect((await attemptOf(first.attemptId)).next_check_at).toBeNull()
  })

  it('takes at most 10 attempts, 10 events and 5 refunds a run, oldest due first, and each kind in its own list', async () => {
    await parkAll()
    const orders: Placed[] = []
    for (let i = 0; i < 12; i += 1) orders.push(await plain())
    const attempts: string[] = []
    for (const placed of orders) attempts.push((await begin(placed)).attemptId)
    for (let i = 0; i < attempts.length; i += 1) {
      await postgres.query("update finance.payment_attempts set created_at = now() - interval '5 minutes', next_check_at = now() - make_interval(secs => $2) where id = $1", [attempts[i], 600 - i])
    }
    const eventIds: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const id = `${EVENT_PREFIX}claim-${i}`
      eventIds.push(id)
      await call('payment_event_record', { p_event_id: id, p_type: 'payment_paid', p_live: false, p_payment_id: randomUUID(), p_payload_hash: sha256(id) })
      await postgres.query("update finance.payment_events set next_check_at = now() - make_interval(secs => $2) where event_id = $1", [id, 600 - i])
    }
    // Refunds in flight: seven on paying attempts and one on a review payment, plus ones the job must not take.
    const base = await plain()
    const refunds: string[] = []
    for (let i = 0; i < 7; i += 1) {
      const attempt = await insertAttempt(base.id, 'paid', { provider_payment_id: randomUUID() })
      const refund = await row(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, next_check_at)
         values ($1, $2, 100, 'اختبار', $3, now() - make_interval(secs => $4)) returning id`,
        [base.id, attempt, i % 2 === 0 ? 'submitting' : 'uncertain', 600 - i],
      )
      refunds.push(refund.id)
    }
    const reviewPayment = randomUUID()
    await postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason)
       values ($1, 'test', 500, 'SAR', 'paid', 'UNMAPPED_INVOICE')`,
      [reviewPayment],
    )
    const reviewRefund = (
      await row(
        `insert into finance.refunds (review_payment_id, amount_halalas, reason, status, next_check_at)
         values ($1, 500, 'مراجعة', 'submitting', now() - interval '30 seconds') returning id`,
        [reviewPayment],
      )
    ).id
    // Not claimed: a settled refund, one not due, and one of the other mode.
    const done = await insertAttempt(base.id, 'paid', { provider_payment_id: randomUUID() })
    await postgres.query(`insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, next_check_at) values ($1, $2, 100, 'تم', 'succeeded', now() - interval '1 hour')`, [base.id, done])
    const later = await insertAttempt(base.id, 'paid', { provider_payment_id: randomUUID() })
    await postgres.query(`insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, next_check_at) values ($1, $2, 100, 'لاحقًا', 'submitting', now() + interval '1 hour')`, [base.id, later])
    const otherMode = await insertAttempt(base.id, 'paid', { provider_payment_id: randomUUID(), environment: 'live' })
    await postgres.query(`insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, next_check_at) values ($1, $2, 100, 'وضع آخر', 'submitting', now() - interval '1 hour')`, [base.id, otherMode])

    const first = await claim()
    expect(first.attempts.map((a: any) => a.attemptId)).toEqual(attempts.slice(0, 10))
    expect(first.events.map((e: any) => e.eventId)).toEqual(eventIds.slice(0, 10))
    expect(first.events[0]).toEqual({ eventId: eventIds[0], paymentId: expect.any(String), live: false })
    // The review refund is the most recently due of the six oldest-first: five a run, oldest first.
    expect(first.refunds.map((r: any) => r.refundId)).toEqual(refunds.slice(0, 5))
    expect(first.refunds[0]).toEqual({ refundId: refunds[0], providerPaymentId: expect.any(String) })
    for (const claimed of first.refunds) {
      const attemptRow = await row('select provider_payment_id from finance.payment_attempts a join finance.refunds r on r.attempt_id = a.id where r.id = $1', [claimed.refundId])
      expect(claimed.providerPaymentId).toBe(attemptRow.provider_payment_id)
    }
    const second = await claim()
    expect(second.attempts.map((a: any) => a.attemptId)).toEqual(attempts.slice(10))
    expect(second.events.map((e: any) => e.eventId)).toEqual(eventIds.slice(10))
    expect(second.refunds.map((r: any) => r.refundId)).toEqual([...refunds.slice(5), reviewRefund])
    expect(second.refunds[2]).toEqual({ refundId: reviewRefund, providerPaymentId: reviewPayment })
    const third = await claim()
    expect(third).toEqual({ attempts: [], events: [], refunds: [] })
    // Leased for two minutes.
    for (const id of refunds) {
      const ahead = (await row("select extract(epoch from (next_check_at - now())) as s from finance.refunds where id = $1", [id])).s
      expect(Number(ahead)).toBeGreaterThan(100)
    }
    // The other mode's refund was parked by the first claim: still in flight (a person settles it), no due time.
    const parked = await row(
      'select r.status, r.next_check_at, r.error from finance.refunds r where r.attempt_id = $1',
      [otherMode],
    )
    expect(parked).toMatchObject({ status: 'submitting', next_check_at: null, error: 'MODE_CHANGED' })
    expect((await claim('live')).refunds).toEqual([])
  })
})

describe('payment_attempt_checked', () => {
  const checked = (attemptId: string, source: string, ok: boolean, status: string | null = null, error: string | null = null): Promise<any> =>
    call('payment_attempt_checked', { p_attempt: attemptId, p_source: source, p_ok: ok, p_provider_status: status, p_error: error })
  async function pendingAttempt(extra: Record<string, unknown> = {}, expires = '20 minutes', next: string | null = '1 minute', status = 'pending'): Promise<string> {
    const placed = await plain()
    return insertAttempt(placed.id, status, { provider_invoice_id: randomUUID(), ...extra }, expires, next)
  }

  it('a prompt writes fetched_at only: the job\'s schedule and counters stay', async () => {
    const attempt = await pendingAttempt()
    const before = await attemptOf(attempt)
    await checked(attempt, 'prompt', true, 'initiated')
    await checked(attempt, 'prompt', false, null, 'PROVIDER_TIMEOUT')
    const after = await attemptOf(attempt)
    expect(after.fetched_at).not.toBeNull()
    expect(after).toMatchObject({
      status: 'pending',
      next_check_at: before.next_check_at,
      check_count: 0,
      error_count: 0,
      last_error: null,
    })
  })

  it('the job backs off after good answers 1, 2, 4 ... 30 minutes and resets on an error-free answer', async () => {
    const attempt = await pendingAttempt()
    const minutes = [1, 2, 4, 8, 16, 30, 30]
    for (let n = 0; n < minutes.length; n += 1) {
      await checked(attempt, 'job', true, 'initiated')
      const stored = await attemptOf(attempt)
      expect(stored, `answer ${n + 1}`).toMatchObject({ status: 'pending', check_count: n + 1, error_count: 0 })
      const ahead = await secondsAhead('payment_attempts', 'id', attempt, 'next_check_at')
      expect(ahead, `answer ${n + 1}`).toBeGreaterThan(minutes[n]! * 60 - 15)
      expect(ahead, `answer ${n + 1}`).toBeLessThanOrEqual(minutes[n]! * 60)
    }
  })

  it('the job backs off after errors 1, 2, 4 ... 60 minutes, keeps the code, and a good answer clears the error count', async () => {
    const attempt = await pendingAttempt()
    const minutes = [1, 2, 4, 8, 16, 32, 60, 60]
    for (let n = 0; n < minutes.length; n += 1) {
      await checked(attempt, 'job', false, null, 'PROVIDER_TIMEOUT')
      const stored = await attemptOf(attempt)
      expect(stored, `error ${n + 1}`).toMatchObject({ status: 'pending', error_count: n + 1, check_count: 0, last_error: 'PROVIDER_TIMEOUT' })
      const ahead = await secondsAhead('payment_attempts', 'id', attempt, 'next_check_at')
      expect(ahead, `error ${n + 1}`).toBeGreaterThan(minutes[n]! * 60 - 15)
      expect(ahead, `error ${n + 1}`).toBeLessThanOrEqual(minutes[n]! * 60)
    }
    await checked(attempt, 'job', true, 'initiated')
    expect(await attemptOf(attempt)).toMatchObject({ error_count: 0, check_count: 1 })
  })

  it('a pending attempt whose provider status is expired or canceled more than 10 minutes after its expiry becomes expired or cancelled, with nothing more to check', async () => {
    for (const [providerStatus, becomes] of [['expired', 'expired'], ['canceled', 'cancelled']] as const) {
      // Within 10 minutes of the expiry: a payment may still land, so it stays pending.
      const early = await pendingAttempt({}, '-5 minutes')
      await checked(early, 'job', true, providerStatus)
      expect(await attemptOf(early), `${providerStatus} early`).toMatchObject({ status: 'pending', check_count: 1 })
      expect((await attemptOf(early)).next_check_at).not.toBeNull()
      // A prompt never closes it, and neither does an error.
      const late = await pendingAttempt({}, '-11 minutes')
      await checked(late, 'prompt', true, providerStatus)
      await checked(late, 'job', false, null, 'PROVIDER_TIMEOUT')
      expect((await attemptOf(late)).status, `${providerStatus} prompt/error`).toBe('pending')
      await checked(late, 'job', true, providerStatus)
      expect(await attemptOf(late), providerStatus).toMatchObject({ status: becomes, next_check_at: null })
      // Another provider status does not close it.
      const open = await pendingAttempt({}, '-11 minutes')
      await checked(open, 'job', true, 'initiated')
      expect((await attemptOf(open)).status).toBe('pending')
    }
  })

  it('24 hours after the invoice expired nothing more is asked: pending or uncertain becomes expired; what could not be verified is marked UNVERIFIED and alerted', async () => {
    const answered = await pendingAttempt({}, '-25 hours')
    await checked(answered, 'job', true, 'initiated')
    expect(await attemptOf(answered)).toMatchObject({ status: 'expired', next_check_at: null, last_error: null })

    const unverified = await pendingAttempt({}, '-25 hours')
    await checked(unverified, 'job', false, null, 'PROVIDER_TIMEOUT')
    expect(await attemptOf(unverified)).toMatchObject({ status: 'expired', next_check_at: null, last_error: 'UNVERIFIED' })
    expect(await alerts('attempt_unverified', unverified)).toBe(await owners())
    await checked(unverified, 'job', false, null, 'PROVIDER_TIMEOUT')
    expect(await alerts('attempt_unverified', unverified)).toBe(await owners())

    const uncertain = await pendingAttempt({ provider_invoice_id: null }, '-25 hours', '1 minute', 'uncertain')
    await checked(uncertain, 'job', false, null, 'PROVIDER_TIMEOUT')
    expect(await attemptOf(uncertain)).toMatchObject({ status: 'expired', next_check_at: null, last_error: 'UNVERIFIED' })

    // A prompt is not the job: it writes fetched_at only, even that late.
    const prompted = await pendingAttempt({}, '-25 hours')
    await checked(prompted, 'prompt', false, null, 'PROVIDER_TIMEOUT')
    expect(await attemptOf(prompted)).toMatchObject({ status: 'pending', last_error: null })
    // 23 hours is not 24.
    const recent = await pendingAttempt({}, '-23 hours')
    await checked(recent, 'job', false, null, 'PROVIDER_TIMEOUT')
    expect(await attemptOf(recent)).toMatchObject({ status: 'pending', last_error: 'PROVIDER_TIMEOUT' })
    expect((await attemptOf(recent)).next_check_at).not.toBeNull()
  })

  it('the last check of a closed attempt clears its due time when it answered and backs off like any other when it errored', async () => {
    for (const status of ['expired', 'cancelled', 'failed', 'abandoned']) {
      const answered = await pendingAttempt({}, '-1 hour', '1 minute', status)
      await checked(answered, 'job', true, 'expired')
      expect(await attemptOf(answered), status).toMatchObject({ status, next_check_at: null, check_count: 1 })
      const errored = await pendingAttempt({}, '-1 hour', '1 minute', status)
      await checked(errored, 'job', false, null, 'PROVIDER_TIMEOUT')
      const stored = await attemptOf(errored)
      expect(stored, status).toMatchObject({ status, error_count: 1, last_error: 'PROVIDER_TIMEOUT' })
      const ahead = await secondsAhead('payment_attempts', 'id', errored, 'next_check_at')
      expect(ahead, status).toBeGreaterThan(45)
      expect(ahead, status).toBeLessThanOrEqual(60)
    }
  })

  it('never touches an attempt that is paid or review', async () => {
    for (const status of ['paid', 'review']) {
      const attempt = await pendingAttempt({ provider_payment_id: randomUUID() }, '-30 hours', null, status)
      const before = await attemptOf(attempt)
      for (const [source, ok] of [['job', true], ['job', false], ['prompt', true], ['prompt', false]] as const) {
        await checked(attempt, source, ok, ok ? 'expired' : null, ok ? null : 'PROVIDER_TIMEOUT')
      }
      expect(await attemptOf(attempt), status).toEqual(before)
    }
    await checked(randomUUID(), 'job', true)
  })
})

// --- the owner's recheck ---------------------------------------------------------------------

describe('payment_attempt_ref', () => {
  const ref = (actor: string, attempt: string, mode = 'test'): Promise<any> => call('payment_attempt_ref', { p_actor: actor, p_attempt: attempt, p_mode: mode })

  it('answers the owner the attempt\'s references; an editor, operations and a revoked owner are refused; the other mode is NOT_FOUND', async () => {
    const owner = ownerUser
    const started = await start(await plain())
    expect(await apply(started, { amount: 1 })).toMatchObject({ outcome: 'review' })
    const answer = await ref(owner.userId, started.attemptId)
    expect(answer).toEqual({
      ok: true,
      attemptId: started.attemptId,
      status: 'review',
      providerInvoiceId: started.invoiceId,
      providerPaymentId: started.paymentId,
      orderNumber: started.placed.number,
      createdAt: expect.any(String),
      amount: started.placed.total,
      currency: 'SAR',
    })
    for (const [role, member] of [['editor', editorUser], ['operations', operationsUser]] as const) {
      await expect(ref(member.userId, started.attemptId), role).rejects.toMatchObject({ code: '42501' })
    }
    const revoked = await makeStaff('owner', { active: false })
    await expect(ref(revoked.userId, started.attemptId)).rejects.toMatchObject({ code: '42501' })
    await expect(ref(randomUUID(), started.attemptId)).rejects.toMatchObject({ code: '42501' })
    expect(await ref(owner.userId, started.attemptId, 'live')).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await ref(owner.userId, randomUUID())).toEqual({ ok: false, code: 'NOT_FOUND' })
    // The creating attempt of a fresh order carries no provider ids yet.
    const fresh = await begin(await plain())
    expect(await ref(owner.userId, fresh.attemptId)).toMatchObject({ ok: true, status: 'creating', providerInvoiceId: null, providerPaymentId: null })
  })
})
