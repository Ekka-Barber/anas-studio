// P08 round 5: order mail against the real local database
// (`supabase/migrations/20261002120000_order_emails.sql`): the three data
// functions, the claim's three tiers and per-kind caps, the owner rule of the
// claim and the replay, the attention list, and one receipt end to end through
// the real `outbox` Edge Function into Mailpit.
//
// Orders go through `checkout_create` and are paid through
// `apply_verified_payment`, like payment.test.ts; what only the owner or the
// database could write (a refund row, a shipped item, a lowered stock) is written
// as the local `postgres` superuser. Nothing reaches Moyasar. The tier and cap
// tests run in a transaction that is always rolled back, with the day's sends
// moved to yesterday and every other due row parked inside it, so they count
// only their own rows and leave the shared database as it was. This file
// switches `finance.commerce_settings.checkout_enabled` on, saved in beforeAll
// and restored in afterAll; every fixture carries a per-run unique slug, SKU,
// code, email or event id.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type AlertEmailData, type OrderEmailData, renderOwnerAlert, renderReceipt } from '../../supabase/functions/_shared/email.ts'
import { runOutbox } from '../../supabase/functions/_shared/outbox.ts'
import { notificationToken, orderAccessToken, orderAccessTokenHash, sha256Hex } from '../../supabase/functions/_shared/tokens.ts'
import { anonClient, createStaff, localEnv, pgRpc, serviceRoleDb, signIn, status as stack, uniqueEmail, type Role } from './support'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const env = localEnv()
const PEPPER = env.TOKEN_HASH_PEPPER!
const SITE = env.SITE_URL!
const REV = { store: 1, delivery: 1, refund: 1 }
const PREFIX = `p08r5-${Date.now()}-${process.pid}-`
const PREORDER = { capacity: 5, shipsOn: '2099-12-31', note: 'يصل بعد الطباعة الثانية' }

type Row = Record<string, any>

let postgres: Client
/** A `service_role` session, the role of the Edge Functions. */
let app: Client
let settingsSaved: Row | undefined
let startedAt = new Date()
let city = ''
const created = { products: [] as string[], rates: [] as string[], coupons: [] as string[], orders: [] as string[], notifications: [] as string[] }
const staffMade: string[] = []

type Member = { userId: string; email: string }
async function makeStaff(role: Role): Promise<Member> {
  const member = await createStaff(role)
  staffMade.push(member.userId)
  return member
}
let ownerMain: Member
let ownerClient: SupabaseClient
let operations: Member

let counter = 0
const unique = (label: string): string => `${PREFIX}${label}-${(counter += 1)}`
const ipHash = (): Promise<string> => sha256Hex(unique('ip'))

const call = (fn: string, args: Record<string, unknown>): Promise<any> => pgRpc(app)(fn, args) as Promise<any>
async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await postgres.query(sql, params)).rows
}
async function row(sql: string, params: unknown[] = []): Promise<Row> {
  const found = await rows(sql, params)
  expect(found, sql).toHaveLength(1)
  return found[0]!
}
const orderOf = (id: string): Promise<Row> => row('select * from finance.orders where id = $1', [id])
const receiptsOf = (orderId: string): Promise<Row[]> =>
  rows("select * from finance.email_outbox where kind = 'receipt' and dedupe_key = $1", [`receipt:${orderId}`])
const alertPayload = async (alert: string, subject: string): Promise<Row> =>
  (await row('select payload from finance.email_outbox where dedupe_key = $1', [`${alert}:${subject}:${ownerMain.userId}`])).payload

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  app = await serviceRoleDb()
  startedAt = (await row('select now() as t')).t
  ownerMain = await makeStaff('owner')
  operations = await makeStaff('operations')
  ownerClient = await signIn(ownerMain.email)
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
  // Fixtures cannot be deleted (orders reference them), so they leave the local
  // store: products archived, rates and coupons disabled, nothing of this run
  // left due for the reconciliation job or waiting in the outbox.
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  await postgres.query('update public.coupons set enabled = false where id = any($1::uuid[])', [created.coupons])
  await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
  await postgres.query('delete from finance.payment_events where event_id like $1', [`${PREFIX}%`])
  await postgres.query('delete from public.notifications where id = any($1::uuid[])', [created.notifications])
  await postgres.query('delete from finance.refunds where created_at >= $1', [startedAt])
  await postgres.query(
    "update finance.payment_reviews set closed_at = now(), closed_reason = 'test cleanup' where created_at >= $1 and closed_at is null",
    [startedAt],
  )
  await postgres.query("delete from finance.email_outbox where kind = 'owner_alert' and created_at >= $1", [startedAt])
  await postgres.query("delete from finance.email_outbox where kind = 'receipt' and payload ->> 'orderId' = any($1::text[])", [created.orders])
  await postgres.query('delete from finance.email_outbox where dedupe_key like $1', [`${PREFIX}%`])
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
  await app.end()
  await postgres.end()
})

// --- fixtures ----------------------------------------------------------------

async function makeProduct(): Promise<{ id: string; title: string }> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const title = `منتج ${slug}`
  const id = (await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [slug, title]))
    .id as string
  created.products.push(id)
  return { id, title }
}

type VariantSpec = {
  fulfillment: 'digital' | 'physical' | 'signed'
  price: number
  stock?: number | null
  low?: number | null
  preorder?: boolean
}

async function makeVariant(productId: string, spec: VariantSpec): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return (
    await row(
      `insert into public.product_variants
         (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold,
          preorder, preorder_capacity, preorder_ships_on, preorder_note)
       values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11) returning id`,
      [
        productId,
        sku,
        `خيار ${sku}`,
        spec.fulfillment,
        spec.price,
        spec.stock ?? null,
        spec.low ?? null,
        spec.preorder ?? false,
        spec.preorder ? PREORDER.capacity : null,
        spec.preorder ? PREORDER.shipsOn : null,
        spec.preorder ? PREORDER.note : null,
      ],
    )
  ).id as string
}
const variantOf = async (spec: VariantSpec): Promise<{ id: string; product: { id: string; title: string } }> => {
  const product = await makeProduct()
  return { id: await makeVariant(product.id, spec), product }
}

async function makeRate(fee: number): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [key, `مدينة ${key}`, fee])
  created.rates.push(key)
  return key
}

async function makeCoupon(percentBp: number): Promise<string> {
  const code = unique('CODE').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = (await row(`insert into public.coupons (code, kind, percent_bp, enabled) values ($1, 'percent', $2, true) returning id`, [code, percentBp])).id
  created.coupons.push(id)
  return code
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

type Placed = { id: string; number: string; total: number; key: string; hash: string; email: string; token: string }

/** Quotes the cart, then creates the order with that quote's hash: a pending order holding its units. */
async function place(lines: Array<{ variantId: string; quantity: number }>, opts: { couponCode?: string | null } = {}): Promise<Placed> {
  const priced = await call('checkout_quote', { p_ip_hash: await ipHash(), p_lines: lines, p_city_key: city, p_coupon_code: opts.couponCode ?? null })
  expect(priced.ok, JSON.stringify(priced)).toBe(true)
  const key = randomUUID()
  const token = await orderAccessToken(PEPPER, key)
  const hash = await orderAccessTokenHash(PEPPER, token)
  const email = uniqueEmail('payer')
  const result = await call('checkout_create', {
    p_idempotency_key: key,
    p_request_hash: await sha256Hex(`request:${key}`),
    p_checkout_session: randomUUID(),
    p_ip_hash: await ipHash(),
    p_email: email,
    p_name: 'مشترٍ',
    p_phone: '966501234567',
    p_lines: lines,
    p_city_key: city,
    p_address: 'تبوك شارع الرئيسي',
    p_coupon_code: opts.couponCode ?? null,
    p_policy_revisions: REV,
    p_quote_hash: priced.quoteHash,
    p_access_token_hash: hash,
    p_environment: 'test',
  })
  expect(result.ok, JSON.stringify(result)).toBe(true)
  created.orders.push(result.order.id)
  return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, key, hash, email, token }
}

type Started = { attemptId: string; invoiceId: string; paymentId: string; placed: Placed }

/** begin, then created: a pending attempt with an invoice (what `checkout`'s invoice step leaves). */
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

/** The normalized payment and invoice the Edge Function hands to `apply_verified_payment`. */
function apply(s: Started, o: Partial<{ status: string; amount: number; refunded: number }> = {}): Promise<any> {
  return call('apply_verified_payment', {
    p_invoice_id: s.invoiceId,
    p_payment: {
      id: s.paymentId,
      status: o.status ?? 'paid',
      amount: o.amount ?? s.placed.total,
      currency: 'SAR',
      fee: 150,
      refunded: o.refunded ?? 0,
      invoiceId: s.invoiceId,
      sourceType: 'creditcard',
      sourceCompany: 'mada',
    },
    p_invoice: { id: s.invoiceId, status: 'paid', amount: s.placed.total, currency: 'SAR' },
    p_mode: 'test',
    p_live: null,
    p_event_id: null,
  })
}

/** Places nothing: pays an order that exists and answers what `apply_verified_payment` decided. */
async function pay(placed: Placed): Promise<Started & { outcome: string }> {
  const started = await start(placed)
  const applied = await apply(started)
  return { ...started, outcome: applied.outcome }
}

const plain = async (): Promise<Placed> => place([{ variantId: (await variantOf({ fulfillment: 'digital', price: 3500 })).id, quantity: 1 }])

/** Gives an attempt an invoice that `payment_attempt_checked` can reach, as the job would find it. */
async function insertAttempt(orderId: string, state: string, expires: string, next: string): Promise<string> {
  const total = (await orderOf(orderId)).total_halalas
  return (
    await row(
      `insert into finance.payment_attempts (order_id, status, amount_halalas, environment, provider_invoice_id, invoice_expires_at, next_check_at)
       values ($1, $2, $3, 'test', $4, now() + $5::interval, now() + $6::interval) returning id`,
      [orderId, state, total, randomUUID(), expires, next],
    )
  ).id as string
}

/** The outbox as a transaction that is rolled back; see the header. `keep` are the rows of this test that must stay due. */
async function rolledBack<T>(keep: string[], body: () => Promise<T>): Promise<T> {
  await postgres.query('begin')
  try {
    await postgres.query("update finance.email_outbox set sent_at = sent_at - interval '1 day' where sent_at >= date_trunc('day', now(), 'UTC')")
    await postgres.query("update finance.email_outbox set next_at = now() + interval '1 day' where status in ('pending', 'uncertain') and id <> all($1::bigint[])", [keep])
    return await body()
  } finally {
    await postgres.query('rollback')
  }
}

/** `n` rows of `kind` already sent, today or a day ago. */
async function fillSent(kind: string, priority: number, n: number, when: 'today' | 'yesterday' = 'today'): Promise<void> {
  await postgres.query(
    `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, sent_at, provider_id)
     select $1::text || g::text, $2, $3, 'filler@example.com', '{}'::jsonb, 'sent',
            case when $5 = 'today' then now() else now() - interval '1 day' end, 'f' || g::text
       from generate_series(1, $4::integer) as g`,
    [unique('fill'), kind, priority, n, when],
  )
}

/** A due row waiting for the claim. */
async function fixture(kind: string, priority: number, recipient = `${unique('fx')}@example.com`): Promise<string> {
  return (
    await row(`insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload) values ($1, $2, $3, $4, '{}'::jsonb) returning id`, [
      unique('fixture'),
      kind,
      priority,
      recipient,
    ])
  ).id as string
}

async function claimRows(limit: number, args = '120, 100, 20, 3000, 30'): Promise<Array<{ id: string; kind: string }>> {
  return (await postgres.query(`select id, kind from public.outbox_claim($1, ${args})`, [limit])).rows
}

// --- order_email_data ----------------------------------------------------------

describe('order_email_data', () => {
  type Item = { variantId: string; product: { id: string; title: string } }
  let main: Placed
  let attemptId: string
  const items: Item[] = []
  let itemRows: Row[] = []
  let dataBefore: OrderEmailData

  beforeAll(async () => {
    const physical = await variantOf({ fulfillment: 'physical', price: 6900, stock: 10 })
    const withFile = await variantOf({ fulfillment: 'digital', price: 1500 })
    await attachFile(withFile.id)
    const noFile = await variantOf({ fulfillment: 'digital', price: 900 })
    const preorder = await variantOf({ fulfillment: 'digital', price: 2000, preorder: true })
    for (const variant of [physical, withFile, noFile, preorder]) items.push({ variantId: variant.id, product: variant.product })
    main = await place(
      [
        { variantId: physical.id, quantity: 2 },
        { variantId: withFile.id, quantity: 1 },
        { variantId: noFile.id, quantity: 1 },
        { variantId: preorder.id, quantity: 1 },
      ],
      { couponCode: await makeCoupon(1000) },
    )
    const paid = await pay(main)
    expect(paid.outcome).toBe('paid')
    attemptId = paid.attemptId
    itemRows = await rows('select * from finance.order_items where order_id = $1 order by line_no', [main.id])
    dataBefore = (await call('order_email_data', { p_order: main.id })) as OrderEmailData
  })

  it('answers everything the mails show, from the order\'s own rows', async () => {
    const order = await orderOf(main.id)
    expect(order.discount_halalas).toBeGreaterThan(0)
    expect(order.shipping_halalas).toBe(2500)
    expect(dataBefore).toMatchObject({
      orderId: main.id,
      orderNumber: main.number,
      status: 'paid',
      environment: 'test',
      customerName: 'مشترٍ',
      customerEmail: main.email,
      idempotencyKey: main.key,
      tokenVersion: 0,
      totals: {
        subtotal: order.subtotal_halalas,
        discount: order.discount_halalas,
        shipping: order.shipping_halalas,
        total: order.total_halalas,
      },
      seller: { legalName: 'بائع', address: 'تبوك', registration: 'REG-P08' },
      refundedHalalas: 0,
    })
    expect(typeof dataBefore.paidAt).toBe('string')
    // The data is the order's own: no card, no address, no phone, no token.
    const text = JSON.stringify(dataBefore)
    for (const secret of ['966501234567', 'تبوك شارع الرئيسي', main.token, main.hash, PEPPER]) expect(text).not.toContain(secret)
    // `refund` and `shipment` only when asked for.
    expect(Object.keys(dataBefore)).not.toContain('refund')
    expect(Object.keys(dataBefore)).not.toContain('shipment')
  })

  it('each line from the order item: title, variant, quantity, total after its discount, preorder note, hasFile', () => {
    expect(dataBefore.lines).toEqual(
      itemRows.map((item, index) => ({
        itemId: item.id,
        title: items[index]!.product.title,
        variantTitle: item.variant_title,
        quantity: item.quantity,
        total: item.line_subtotal_halalas - item.discount_halalas,
        fulfillment: ['physical', 'digital', 'digital', 'digital'][index],
        preorder: index === 3 ? { shipsOn: PREORDER.shipsOn, note: PREORDER.note } : null,
        // The physical line has no entitlement (null); of the digital ones only the second holds a file.
        hasFile: [null, true, false, false][index],
      })),
    )
    expect(dataBefore.lines.map((line) => line.quantity)).toEqual([2, 1, 1, 1])
  })

  it('a later price, title or seller change does not change it', async () => {
    for (const item of items) {
      await postgres.query('update public.product_variants set price_halalas = 1, title = $2 where id = $1', [item.variantId, 'عنوان مغيّر'])
      await postgres.query('update public.products set title = $2 where id = $1', [item.product.id, 'منتج بعنوان جديد'])
    }
    await postgres.query("update finance.commerce_settings set seller_legal_name = 'اسم آخر', seller_registration = 'REG-NEW' where id = 1")
    expect(await call('order_email_data', { p_order: main.id })).toEqual(dataBefore)
  })

  it('an unknown order answers null', async () => {
    expect(await call('order_email_data', { p_order: randomUUID() })).toBeNull()
  })

  it('hasFile follows the entitlement: a file attached later, or revoked, changes it', async () => {
    const withFile = await variantOf({ fulfillment: 'digital', price: 1500 })
    await attachFile(withFile.id)
    const without = await variantOf({ fulfillment: 'digital', price: 900 })
    const small = await place([
      { variantId: withFile.id, quantity: 1 },
      { variantId: without.id, quantity: 1 },
    ])
    await pay(small)
    const hasFile = async (): Promise<Array<boolean | null>> => ((await call('order_email_data', { p_order: small.id })) as OrderEmailData).lines.map((line) => line.hasFile)
    expect(await hasFile()).toEqual([true, false])
    // The owner uploads the missing file: the entitlement gets it.
    const asset = await attachFile(without.id)
    await postgres.query('update finance.entitlements set asset_id = $2 where order_id = $1 and asset_id is null', [small.id, asset])
    expect(await hasFile()).toEqual([true, true])
    // A revoked entitlement has no file to hand out, and none will come: null, not "waiting".
    await postgres.query('update finance.entitlements set revoked_at = now() where order_id = $1', [small.id])
    expect(await hasFile()).toEqual([null, null])
    // A line that was never granted (refunded before the order was resolved) is the same.
    await postgres.query('delete from finance.entitlements where order_id = $1', [small.id])
    expect(await hasFile()).toEqual([null, null])
  })

  async function insertRefund(orderId: string, attempt: string | null, amount: number, state: string, reviewPayment: string | null = null): Promise<string> {
    return (
      await row(
        `insert into finance.refunds (order_id, attempt_id, review_payment_id, amount_halalas, reason, status)
         values ($1, $2, $3, $4, 'اختبار', $5) returning id`,
        [orderId, attempt, reviewPayment, amount, state],
      )
    ).id as string
  }

  it('a refund: its amount, and the refunded total from the succeeded refunds of the paying attempt only', async () => {
    const first = await insertRefund(main.id, attemptId, 1000, 'succeeded')
    const second = await insertRefund(main.id, attemptId, 500, 'succeeded')
    const failed = await insertRefund(main.id, attemptId, 700, 'failed')
    const inFlight = await insertRefund(main.id, attemptId, 300, 'submitting')
    // A review payment's refund never counts toward the order.
    const reviewId = unique('review')
    await postgres.query(
      "insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason) values ($1, 'test', 500, 'SAR', 'paid', 'AMOUNT_MISMATCH')",
      [reviewId],
    )
    await insertRefund(main.id, null, 400, 'succeeded', reviewId)

    const asked = async (refund: string | null): Promise<OrderEmailData> => (await call('order_email_data', { p_order: main.id, p_refund: refund })) as OrderEmailData
    expect(await asked(first)).toMatchObject({ refundedHalalas: 1500, refund: { amount: 1000 } })
    expect((await asked(second)).refund).toEqual({ amount: 500 })
    // A refund that did not succeed, one still in flight, an unknown one: no `refund`.
    for (const refund of [failed, inFlight, randomUUID()]) {
      const data = await asked(refund)
      expect(Object.keys(data)).not.toContain('refund')
      expect(data.refundedHalalas).toBe(1500)
    }
    // Nothing asked: no `refund` either.
    expect(Object.keys(await asked(null))).not.toContain('refund')
    // Another order's refund is not this order's.
    const other = await plain()
    const otherPaid = await pay(other)
    const otherRefund = await insertRefund(other.id, otherPaid.attemptId, 100, 'succeeded')
    expect(Object.keys(await asked(otherRefund))).not.toContain('refund')
    expect(((await call('order_email_data', { p_order: other.id, p_refund: otherRefund })) as OrderEmailData).refund).toEqual({ amount: 100 })
  })

  it('a shipment: the carrier, the tracking value and the shipped items among those asked for', async () => {
    const [physicalItem, digitalItem] = itemRows as [Row, Row]
    const asked = async (ids: string[] | null): Promise<OrderEmailData> =>
      ((await app.query('select public.order_email_data($1, null, $2::uuid[]) as r', [main.id, ids])).rows[0]!.r as OrderEmailData)
    // Preparing: not a shipment yet.
    expect(Object.keys(await asked([physicalItem.id]))).not.toContain('shipment')
    await postgres.query("update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-1', shipped_at = now() where order_item_id = $1", [
      physicalItem.id,
    ])
    expect((await asked([physicalItem.id])).shipment).toEqual({ carrier: 'SMSA', tracking: 'TRK-1', itemIds: [physicalItem.id] })
    // Items that are not shipped, not physical or not this order's are left out.
    expect((await asked([digitalItem.id, physicalItem.id, randomUUID()])).shipment).toEqual({ carrier: 'SMSA', tracking: 'TRK-1', itemIds: [physicalItem.id] })
    for (const none of [[digitalItem.id], [randomUUID()], [], null]) expect(Object.keys(await asked(none))).not.toContain('shipment')
    // A delivered item is still a shipped one.
    await postgres.query("update finance.fulfillments set state = 'delivered', delivered_at = now() where order_item_id = $1", [physicalItem.id])
    expect((await asked([physicalItem.id])).shipment).toMatchObject({ itemIds: [physicalItem.id] })
    // Without a tracking value there is nothing to tell the buyer.
    await postgres.query('update finance.fulfillments set tracking = null where order_item_id = $1', [physicalItem.id])
    expect(Object.keys(await asked([physicalItem.id]))).not.toContain('shipment')
  })

  it('renders a receipt from its own data: every title, the preorder note, the file notes, the test label', async () => {
    // Back to the order as it was: the title changes above are in the catalog, not in the order.
    const data = (await call('order_email_data', { p_order: main.id })) as OrderEmailData
    const { subject, text } = renderReceipt(data, SITE, await orderAccessToken(PEPPER, main.key, data.tokenVersion))
    expect(subject.startsWith('(تجريبي) ')).toBe(true)
    for (const item of items) expect(text).toContain(item.product.title)
    expect(text).not.toContain('منتج بعنوان جديد')
    expect(text).toContain(`${SITE}/orders#${main.number}.${main.token}`)
    expect(text).toContain(PREORDER.shipsOn)
    expect(text).toContain(PREORDER.note)
    expect(text).toContain('الملف الرقمي: تجده في صفحة طلبك.')
    expect(text).toContain('الملف الرقمي: سنضيفه إلى صفحة طلبك عند توفره.')
    expect(text).toContain('بائع')
    expect(text).toContain('REG-P08')
  })
})

// --- the receipt row ---------------------------------------------------------------

describe('the receipt row', () => {
  it('a paid order queues one receipt for the buyer: priority 0, the order id and nothing else', async () => {
    const placed = await plain()
    expect((await pay(placed)).outcome).toBe('paid')
    const receipts = await receiptsOf(placed.id)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ kind: 'receipt', priority: 0, recipient: placed.email, status: 'pending' })
    expect(receipts[0]!.payload).toEqual({ orderId: placed.id })
    for (const secret of [placed.key, placed.token, placed.hash]) expect(JSON.stringify(receipts[0])).not.toContain(secret)
  })

  it('a paid order that cannot be delivered queues its receipt too, and it renders as under review', async () => {
    const physical = await variantOf({ fulfillment: 'physical', price: 4000, stock: 3 })
    const placed = await place([{ variantId: physical.id, quantity: 1 }])
    // The owner lowers the stock while the buyer pays: the money is kept, nothing is delivered.
    await postgres.query('update public.product_variants set stock = 0 where id = $1', [physical.id])
    const paid = await pay(placed)
    expect(paid.outcome).toBe('paid_needs_resolution')
    const receipts = await receiptsOf(placed.id)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ kind: 'receipt', priority: 0, recipient: placed.email, payload: { orderId: placed.id } })
    const data = (await call('order_email_data', { p_order: placed.id })) as OrderEmailData
    expect(data.status).toBe('paid_needs_resolution')
    const { text } = renderReceipt(data, SITE, placed.token)
    expect(text).toContain('ونراجع الطلب الآن')
    expect(text).not.toContain('المجموع الفرعي')
    // The owners are told, with the order number and the amount.
    const alert = await alertPayload('needs_resolution', placed.id)
    expect(alert).toEqual({ alert: 'needs_resolution', orderId: placed.id, attemptId: paid.attemptId })
    expect(await call('alert_email_data', { p_payload: alert })).toEqual({ alert: 'needs_resolution', orderNumber: placed.number, amount: placed.total })
  })
})

// --- alert_email_data ----------------------------------------------------------------

describe('alert_email_data', () => {
  const data = (payload: Record<string, unknown>): Promise<any> => call('alert_email_data', { p_payload: payload })
  const LEAKS: string[] = []

  it('low_stock: the SKU, the stock now and the threshold, and the order that crossed it', async () => {
    const physical = await variantOf({ fulfillment: 'physical', price: 2000, stock: 5, low: 3 })
    const placed = await place([{ variantId: physical.id, quantity: 3 }])
    const paid = await pay(placed)
    const variant = await row('select sku, stock from public.product_variants where id = $1', [physical.id])
    const payload = await alertPayload('low_stock', `${physical.id}:${placed.id}`)
    expect(payload).toEqual({ alert: 'low_stock', variantId: physical.id, orderId: placed.id })
    const facts = await data(payload)
    expect(facts).toEqual({ alert: 'low_stock', orderNumber: placed.number, sku: variant.sku, stock: 2, threshold: 3 })
    expect(renderOwnerAlert(facts, SITE).text).toContain(variant.sku)
    LEAKS.push(placed.email, placed.key, placed.token, '966501234567', 'تبوك شارع الرئيسي', 'مشترٍ')
    // The same facts reach the same order from the other alerts below.
    const external = paid
    await apply(external, { refunded: 500 })
    const refundPayload = await alertPayload('external_refund', `${external.attemptId}:500`)
    expect(refundPayload).toEqual({ alert: 'external_refund', attemptId: external.attemptId, orderId: placed.id, total: 500 })
    expect(await data(refundPayload)).toEqual({ alert: 'external_refund', orderNumber: placed.number, total: 500 })
    // A void at the provider.
    await apply(external, { status: 'voided', refunded: 500 })
    const statusPayload = await alertPayload('provider_status', `${external.attemptId}:voided`)
    expect(await data(statusPayload)).toEqual({ alert: 'provider_status', orderNumber: placed.number, status: 'voided' })
  })

  it('payment_review: the amount and the reason code, with the order number when the payment maps to one', async () => {
    const placed = await plain()
    const started = await start(placed)
    const reviewed = await apply(started, { amount: placed.total + 100 })
    expect(reviewed).toMatchObject({ outcome: 'review', reason: 'AMOUNT_MISMATCH' })
    const mapped = await alertPayload('payment_review', started.paymentId)
    expect(mapped).toEqual({ alert: 'payment_review', paymentId: started.paymentId, attemptId: started.attemptId, orderId: placed.id, reason: 'AMOUNT_MISMATCH' })
    expect(await data(mapped)).toEqual({
      alert: 'payment_review',
      orderNumber: placed.number,
      amount: placed.total + 100,
      reason: 'AMOUNT_MISMATCH',
      paymentId: started.paymentId,
    })

    // An invoice no attempt maps to: the money is real, the order is unknown.
    const ghost = { paymentId: randomUUID(), invoiceId: randomUUID() }
    await call('apply_verified_payment', {
      p_invoice_id: ghost.invoiceId,
      p_payment: { id: ghost.paymentId, status: 'paid', amount: 1234, currency: 'SAR', fee: 0, refunded: 0, invoiceId: ghost.invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
      p_invoice: { id: ghost.invoiceId, status: 'paid', amount: 1234, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
    const unmapped = await alertPayload('payment_review', ghost.paymentId)
    expect(unmapped).toEqual({ alert: 'payment_review', paymentId: ghost.paymentId, reason: 'UNMAPPED_INVOICE' })
    expect(await data(unmapped)).toEqual({ alert: 'payment_review', orderNumber: null, amount: 1234, reason: 'UNMAPPED_INVOICE', paymentId: ghost.paymentId })
  })

  it('event_exhausted: the event type and the payment', async () => {
    const eventId = unique('event')
    const paymentId = randomUUID()
    await call('payment_event_record', { p_event_id: eventId, p_type: 'payment_paid', p_live: false, p_payment_id: paymentId, p_payload_hash: null })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call('payment_event_result', { p_event_id: eventId, p_outcome: 'retry', p_error: 'FETCH_FAILED' })
    }
    const payload = await alertPayload('event_exhausted', eventId)
    expect(payload).toEqual({ alert: 'event_exhausted', eventId })
    expect(await data(payload)).toEqual({ alert: 'event_exhausted', orderNumber: null, eventType: 'payment_paid', paymentId })
  })

  it('attempt_unverified and attempt_duplicate_invoices: the order number and the amount', async () => {
    const placed = await plain()
    const attempt = await insertAttempt(placed.id, 'pending', '-25 hours', '1 minute')
    await call('payment_attempt_checked', { p_attempt: attempt, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'PROVIDER_TIMEOUT' })
    const unverified = await alertPayload('attempt_unverified', attempt)
    expect(unverified).toEqual({ alert: 'attempt_unverified', attemptId: attempt, orderId: placed.id })
    expect(await data(unverified)).toEqual({ alert: 'attempt_unverified', orderNumber: placed.number, amount: placed.total })

    await call('payment_attempt_duplicates', { p_attempt: attempt })
    const duplicates = await alertPayload('attempt_duplicate_invoices', attempt)
    expect(await data(duplicates)).toEqual({ alert: 'attempt_duplicate_invoices', orderNumber: placed.number, amount: placed.total })
  })

  it('refund_mismatch and refund_unverified (the refund round writes them): the order number and the refund\'s amount, from a refundId alone', async () => {
    const placed = await plain()
    const paid = await pay(placed)
    const refund = (
      await row(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status) values ($1, $2, 1000, 'اختبار', 'failed') returning id`,
        [placed.id, paid.attemptId],
      )
    ).id as string
    for (const alert of ['refund_mismatch', 'refund_unverified']) {
      expect(await data({ alert, refundId: refund })).toEqual({ alert, orderNumber: placed.number, amount: 1000 })
    }
  })

  // FABLE-AUDIT M2-13 (QUALITY-16): the alerts written after round 5 answered with their code alone.
  it('the alerts written since: the mode-changed ones the order number, a refused invoice that and its error code, a policy reset the policy and its seq, the brake the bounced count', async () => {
    const placed = await plain()
    const started = await start(placed)
    const attemptFacts = await data({ alert: 'attempt_mode_changed', attemptId: started.attemptId, orderId: placed.id })
    expect(attemptFacts).toEqual({ alert: 'attempt_mode_changed', orderNumber: placed.number })
    expect(renderOwnerAlert(attemptFacts, SITE).text).toContain(placed.number)
    const refundFacts = await data({ alert: 'refund_mode_changed', refundId: randomUUID(), orderId: placed.id })
    expect(refundFacts).toEqual({ alert: 'refund_mode_changed', orderNumber: placed.number })
    expect(renderOwnerAlert(refundFacts, SITE).text).toContain(placed.number)
    const refused = await data({ alert: 'payment_create_refused', attemptId: started.attemptId, orderId: placed.id, error: 'CREATE_REFUSED_401' })
    expect(refused).toEqual({ alert: 'payment_create_refused', orderNumber: placed.number, error: 'CREATE_REFUSED_401' })
    expect(renderOwnerAlert(refused, SITE).text).toContain('CREATE_REFUSED_401')
    expect(await data({ alert: 'policies_reset', policy: 'store', seq: 3 })).toEqual({ alert: 'policies_reset', orderNumber: null, policy: 'store', seq: 3 })
    // A policy taken down has no seq.
    expect(await data({ alert: 'policies_reset', policy: 'refund', seq: null })).toEqual({ alert: 'policies_reset', orderNumber: null, policy: 'refund', seq: null })
    expect(await data({ alert: 'confirm_mail_braked', bounced: 4 })).toEqual({ alert: 'confirm_mail_braked', orderNumber: null, bounced: 4 })
  })

  it('an alert it does not know, or whose rows are gone, answers the code alone; a malformed id never raises', async () => {
    const placed = await plain()
    expect(await data({ alert: 'brand_new', orderId: placed.id, amount: 5 })).toEqual({ alert: 'brand_new' })
    expect(await data({ alert: 'low_stock', variantId: randomUUID() })).toEqual({ alert: 'low_stock' })
    expect(await data({ alert: 'event_exhausted', eventId: 'no-such-event' })).toEqual({ alert: 'event_exhausted' })
    expect(await data({ alert: 'needs_resolution', orderId: 'not-a-uuid', attemptId: '1; drop table x' })).toEqual({
      alert: 'needs_resolution',
      orderNumber: null,
      amount: null,
    })
    expect(await data({})).toEqual({ alert: null })
  })

  it('shows no buyer detail, token or provider payload, and the renderer sends them nowhere', async () => {
    expect(LEAKS.length).toBeGreaterThan(0)
    const stored = await rows(
      "select payload from finance.email_outbox where kind = 'owner_alert' and recipient = $1 and created_at >= $2",
      [ownerMain.email, startedAt],
    )
    expect(stored.length).toBeGreaterThan(5)
    for (const { payload } of stored) {
      const facts = await data(payload)
      const text = JSON.stringify(facts)
      for (const leak of LEAKS) expect(text).not.toContain(leak)
      expect(Object.keys(facts).sort()).toEqual(expect.arrayContaining(['alert']))
      const mail = renderOwnerAlert(facts as AlertEmailData, SITE)
      for (const leak of LEAKS) expect(`${mail.subject}\n${mail.text}`).not.toContain(leak)
    }
  })
})

// --- notify_email_data -----------------------------------------------------------------

describe('notify_email_data', () => {
  it('the subscription status, the token version, and the product and variant it is about', async () => {
    const variant = await variantOf({ fulfillment: 'physical', price: 3000, stock: 0 })
    const product = await row('select slug, title from public.products where id = $1', [variant.product.id])
    const variantRow = await row('select title from public.product_variants where id = $1', [variant.id])
    const email = uniqueEmail('guest')
    const id = (
      await row("insert into public.notifications (email, variant_id, status, token_version) values ($1, $2, 'pending', 3) returning id", [email, variant.id])
    ).id as string
    created.notifications.push(id)
    const expected = { status: 'pending', tokenVersion: 3, email, productTitle: product.title, variantTitle: variantRow.title, slug: product.slug, preorder: false }
    expect(await call('notify_email_data', { p_id: id })).toEqual(expected)
    await postgres.query("update public.notifications set status = 'confirmed', token_version = 4 where id = $1", [id])
    expect(await call('notify_email_data', { p_id: id })).toEqual({ ...expected, status: 'confirmed', tokenVersion: 4 })
    // FABLE-AUDIT M2-13: the variant's preorder flag as it is now, so the notice can say it is a preorder.
    await postgres.query('update public.product_variants set preorder = true, preorder_capacity = $2, preorder_ships_on = $3, preorder_note = $4 where id = $1', [
      variant.id,
      PREORDER.capacity,
      PREORDER.shipsOn,
      PREORDER.note,
    ])
    expect(await call('notify_email_data', { p_id: id })).toEqual({ ...expected, status: 'confirmed', tokenVersion: 4, preorder: true })
    expect(await call('notify_email_data', { p_id: randomUUID() })).toBeNull()
    await postgres.query('delete from public.notifications where id = $1', [id])
    expect(await call('notify_email_data', { p_id: id })).toBeNull()
  })
})

// --- the claim: tiers and caps --------------------------------------------------------

describe('outbox_claim: three tiers (contract section 8)', () => {
  const KINDS: Array<[string, number]> = [
    ['receipt', 0],
    ['order_link', 1],
    ['availability', 2],
  ]

  it.each([
    [49, ['availability', 'order_link', 'receipt']],
    [50, ['order_link', 'receipt']],
    [79, ['order_link', 'receipt']],
    [80, ['receipt']],
    // Priority 0 keeps the last five sends of the day for Supabase Auth's sign-in codes (round M1b): it stops at 95.
    [94, ['receipt']],
    [95, []],
    [99, []],
    [100, []],
  ])('with %i sends in the UTC day, these kinds are claimed: %j', async (sends, expected) => {
    const claimed = await rolledBack([], async () => {
      await fillSent('receipt', 0, sends)
      for (const [kind, priority] of KINDS) await fixture(kind, priority)
      return (await claimRows(10)).map((claim) => claim.kind).sort()
    })
    expect(claimed).toEqual(expected)
  })

  it('the low reserve is a parameter: without it priority 2 stops 30 sends sooner than priority 1', async () => {
    const at = (sends: number, args?: string): Promise<string[]> =>
      rolledBack([], async () => {
        await fillSent('receipt', 0, sends)
        for (const [kind, priority] of KINDS) await fixture(kind, priority)
        return (await claimRows(10, args)).map((claim) => claim.kind).sort()
      })
    // Five arguments: the default 30 applies.
    expect(await at(60, '120, 100, 20, 3000')).toEqual(['order_link', 'receipt'])
    expect(await at(60, '120, 100, 20, 3000, 0')).toEqual(['availability', 'order_link', 'receipt'])
    expect(await at(60, '120, 100, 20, 3000, 30')).toEqual(['order_link', 'receipt'])
    expect(await at(60, '120, 100, 20, 3000, 45')).toEqual(['order_link', 'receipt'])
    expect(await at(40, '120, 100, 20, 3000, 45')).toEqual(['order_link', 'receipt'])
    expect(await at(30, '120, 100, 20, 3000, 45')).toEqual(['availability', 'order_link', 'receipt'])
  })

  it('only one claim signature exists, and the old five-argument one is gone', async () => {
    const signatures = await rows("select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'outbox_claim'")
    expect(signatures.map((entry) => entry.sig)).toEqual(['outbox_claim(integer,integer,integer,integer,integer,integer)'])
    expect((await row("select to_regprocedure('public.outbox_claim(integer, integer, integer, integer, integer)') as old")).old).toBeNull()
  })
})

describe('outbox_claim: a day sends at most 20 order links and 30 confirmation mails', () => {
  it('contact notices have no cap of their own in the claim: contact_submit takes 40 messages a day, and two recipients make 80 notices', async () => {
    const kinds = await rolledBack([], async () => {
      await fillSent('contact_notice', 1, 45)
      await fixture('contact_notice', 1, operations.email)
      return (await claimRows(10)).map((claim) => claim.kind)
    })
    expect(kinds).toEqual(['contact_notice'])
  })

  it.each([
    ['order_link', 1, 20],
    ['notify_confirm', 2, 30],
  ])('%s (priority %i): %i', async (kind, priority, cap) => {
    const claimedWith = (today: number, yesterday: number): Promise<string[]> =>
      rolledBack([], async () => {
        await fillSent(kind, priority, today)
        await fillSent(kind, priority, yesterday, 'yesterday')
        await fixture(kind, priority)
        // A receipt is always claimable here: it shows the claim ran and the others still go.
        await fixture('receipt', 0)
        return (await claimRows(10)).map((claim) => claim.kind).sort()
      })
    expect(await claimedWith(cap - 1, 0)).toEqual([kind, 'receipt'].sort())
    expect(await claimedWith(cap, 0)).toEqual(['receipt'])
    expect(await claimedWith(cap + 5, 0)).toEqual(['receipt'])
    // The cap is a UTC day's: yesterday's sends do not count.
    expect(await claimedWith(0, cap + 5)).toEqual([kind, 'receipt'].sort())
  })
})

// --- owner alerts ---------------------------------------------------------------------------

describe('owner alerts', () => {
  /** The alert rows `attempt_duplicate_invoices` queued for `members`, by recipient. */
  async function queueAlert(members: Member[]): Promise<Row[]> {
    const placed = await plain()
    const attempt = await insertAttempt(placed.id, 'uncertain', '20 minutes', '1 minute')
    await call('payment_attempt_duplicates', { p_attempt: attempt })
    return rows(
      `select id, recipient, priority, status, payload, kind from finance.email_outbox
        where kind = 'owner_alert' and dedupe_key like $1 and recipient = any($2::text[]) order by id`,
      [`attempt_duplicate_invoices:${attempt}:%`, members.map((member) => member.email)],
    )
  }

  it('two active owners each get an alert row, and each is claimable', async () => {
    const first = await makeStaff('owner')
    const second = await makeStaff('owner')
    const queued = await queueAlert([first, second])
    expect(queued.map((entry) => entry.recipient).sort()).toEqual([first.email, second.email].sort())
    for (const entry of queued) {
      expect(entry).toMatchObject({ kind: 'owner_alert', priority: 0, status: 'pending' })
      expect(Object.keys(entry.payload).sort()).toEqual(['alert', 'attemptId', 'orderId'])
    }
    const claimed = await rolledBack(
      queued.map((entry) => entry.id),
      async () => (await claimRows(10)).map((claim) => claim.id),
    )
    expect(claimed.sort()).toEqual(queued.map((entry) => entry.id).sort())
  })

  it('a row for an owner who was revoked, or demoted to operations, is closed and never claimed', async () => {
    const kept = await makeStaff('owner')
    const revoked = await makeStaff('owner')
    const demoted = await makeStaff('owner')
    const queued = await queueAlert([kept, revoked, demoted])
    expect(queued).toHaveLength(3)
    const idOf = (member: Member): string => queued.find((entry) => entry.recipient === member.email)!.id
    await postgres.query('update public.staff set active = false where user_id = $1', [revoked.userId])
    // An operations member is never an alert's recipient, though a contact notice goes to one.
    await postgres.query("update public.staff set role = 'operations' where user_id = $1", [demoted.userId])

    const outcome = await rolledBack(
      queued.map((entry) => entry.id),
      async () => {
        const claimed = (await claimRows(10)).map((claim) => claim.id)
        const closed = await rows(
          `select id, status, last_error from finance.email_outbox where id = any($1::bigint[]) and status = 'exhausted'`,
          [[idOf(revoked), idOf(demoted)]],
        )
        const audited = await rows(
          `select entity_id from public.audit_events where action = 'email.exhausted' and entity = 'email_outbox' and entity_id = any($1::text[])`,
          [[idOf(revoked), idOf(demoted)]],
        )
        return { claimed, closed, audited }
      },
    )
    expect(outcome.claimed).toEqual([idOf(kept)])
    expect(outcome.closed.map((entry) => entry.last_error)).toEqual(['RECIPIENT_INACTIVE', 'RECIPIENT_INACTIVE'])
    expect(outcome.audited).toHaveLength(2)

    // And an alert queued after that reaches only the owner who is still active.
    expect((await queueAlert([kept, revoked, demoted])).map((entry) => entry.recipient)).toEqual([kept.email])
  })

  it('outbox_replay refuses an alert for someone who is no longer an owner, and replays one for an active owner', async () => {
    const active = await makeStaff('owner')
    const revoked = await makeStaff('owner')
    const demoted = await makeStaff('owner')
    const queued = await queueAlert([active, revoked, demoted])
    await postgres.query('update public.staff set active = false where user_id = $1', [revoked.userId])
    await postgres.query("update public.staff set role = 'operations' where user_id = $1", [demoted.userId])
    await postgres.query("update finance.email_outbox set status = 'exhausted', last_error = 'HTTP_400' where id = any($1::bigint[])", [queued.map((entry) => entry.id)])
    const idOf = (member: Member): number => Number(queued.find((entry) => entry.recipient === member.email)!.id)

    for (const gone of [revoked, demoted]) {
      const refused = await ownerClient.rpc('outbox_replay', { p_id: idOf(gone), p_accept_duplicate_risk: true })
      expect(refused.error?.code, gone.email).toBe('22023')
      expect((await row('select status from finance.email_outbox where id = $1', [idOf(gone)])).status).toBe('exhausted')
    }
    const replayed = await ownerClient.rpc('outbox_replay', { p_id: idOf(active), p_accept_duplicate_risk: true })
    expect(replayed.error).toBeNull()
    expect((await row('select status from finance.email_outbox where id = $1', [idOf(active)])).status).toBe('pending')
  })

  it('a contact notice still goes to an operations member and to an owner (the rule is unchanged for it)', async () => {
    const notice = await rolledBack([], async () => {
      const toOperations = await fixture('contact_notice', 1, operations.email)
      const toOwner = await fixture('contact_notice', 1, ownerMain.email)
      const toStranger = await fixture('contact_notice', 1)
      const claimed = (await claimRows(10)).map((claim) => claim.id)
      return { claimed: claimed.sort(), expected: [toOperations, toOwner].sort(), stranger: toStranger }
    })
    expect(notice.claimed).toEqual(notice.expected)
    expect(notice.claimed).not.toContain(notice.stranger)
  })
})

// --- the attention list -----------------------------------------------------------------------

describe('outbox_attention', () => {
  it('leaves out the rows closed because the state moved on, and keeps every other closed row', async () => {
    const make = async (code: string): Promise<number> => {
      const key = unique(`attention-${code}`)
      const inserted = await row(
        `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload, status, last_error)
         values ($1, 'receipt', 0, $2, '{}'::jsonb, 'exhausted', $3) returning id`,
        [key, `${key.toLowerCase()}@example.com`, code],
      )
      return Number(inserted.id)
    }
    const benign: number[] = []
    for (const code of ['RECIPIENT_INACTIVE', 'NOT_PENDING', 'NOT_CONFIRMED', 'NO_FILE']) benign.push(await make(code))
    const open: number[] = []
    for (const code of ['GONE', 'NO_SHIPMENT', 'NO_REFUND', 'RENDER_FAILED', 'RATE_LIMIT']) open.push(await make(code))
    const { data, error } = await ownerClient.rpc('outbox_attention')
    expect(error).toBeNull()
    const listed = (data as Array<{ id: number }>).map((entry) => entry.id)
    for (const id of benign) expect(listed).not.toContain(id)
    for (const id of open) expect(listed).toContain(id)
  })
})

// --- grants ------------------------------------------------------------------------------------

describe('grants', () => {
  const FUNCTIONS: Array<[string, Record<string, unknown>]> = [
    ['order_email_data', { p_order: randomUUID() }],
    ['notify_email_data', { p_id: randomUUID() }],
    ['alert_email_data', { p_payload: { alert: 'low_stock' } }],
    ['outbox_claim', { p_limit: 1, p_lease_seconds: 60, p_daily_quota: 100, p_reserve: 20 }],
  ]

  it('anon and authenticated cannot execute the three data functions or the claim; service_role can', async () => {
    for (const [fn, args] of FUNCTIONS) {
      expect((await anonClient().rpc(fn, args)).error?.code, `${fn} anon`).toBe('42501')
      expect((await ownerClient.rpc(fn, args)).error?.code, `${fn} authenticated`).toBe('42501')
    }
    const signatures = await rows(
      `select p.oid::regprocedure::text as sig from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
      [FUNCTIONS.map(([fn]) => fn)],
    )
    expect(signatures).toHaveLength(FUNCTIONS.length)
    for (const { sig } of signatures) {
      for (const [role, want] of [['service_role', true], ['anon', false], ['authenticated', false]] as const) {
        expect((await row('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])).ok, `${role} on ${sig}`).toBe(want)
      }
    }
    // service_role really runs them.
    expect(await call('order_email_data', { p_order: randomUUID() })).toBeNull()
    expect(await call('notify_email_data', { p_id: randomUUID() })).toBeNull()
    expect(await call('alert_email_data', { p_payload: { alert: 'x' } })).toEqual({ alert: 'x' })
  })

  it('the uuid helper belongs to nobody, and the restated staff functions keep their grants', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await row('select has_function_privilege($1, $2, $3) as ok', [role, 'finance.uuid_or_null(text)', 'execute'])).ok, role).toBe(false)
    }
    for (const sig of ['public.outbox_replay(bigint, boolean)', 'public.outbox_attention()']) {
      expect((await row('select has_function_privilege($1, $2, $3) as ok', ['authenticated', sig, 'execute'])).ok, sig).toBe(true)
      expect((await row('select has_function_privilege($1, $2, $3) as ok', ['anon', sig, 'execute'])).ok, sig).toBe(false)
    }
  })
})

// --- the dispatcher over the real data functions ---------------------------------------------------

describe('the dispatcher over the real data functions (rolled back, provider stubbed)', () => {
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends every kind its state allows, with the right links, and closes the rest with their codes, sending nothing for them', async () => {
    // Committed fixtures: a paid order with a physical line (shipped, partly refunded) and a digital line with its file.
    const physical = await variantOf({ fulfillment: 'physical', price: 5000, stock: 5 })
    const book = await variantOf({ fulfillment: 'digital', price: 1500 })
    await attachFile(book.id)
    const placed = await place([
      { variantId: physical.id, quantity: 1 },
      { variantId: book.id, quantity: 1 },
    ])
    const paid = await pay(placed)
    const [physicalItem, digitalItem] = (await rows('select id from finance.order_items where order_id = $1 order by line_no', [placed.id])).map((item) => item.id as string)
    await postgres.query("update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-77', shipped_at = now() where order_item_id = $1", [physicalItem])
    const refundId = (
      await row(
        `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status) values ($1, $2, 2500, 'اختبار', 'succeeded') returning id`,
        [placed.id, paid.attemptId],
      )
    ).id as string
    const receiptId = (await receiptsOf(placed.id))[0]!.id as string
    const variant = await variantOf({ fulfillment: 'physical', price: 3000, stock: 0 })
    const product = await row('select slug, title from public.products where id = $1', [variant.product.id])

    vi.stubEnv('SITE_URL', 'https://anas.studio')
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', 'Anas <noreply@anas.studio>')
    vi.stubEnv('EMAIL_DEV_MAILPIT_URL', '')
    vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
    const posted: Array<{ to: string[]; subject: string; text: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: `prov-${posted.length}` }), { status: 200 })
      }),
    )
    // pgRpc sends an array of strings as JSON; the Data API turns it into a uuid[] itself, so give the direct session the array literal.
    const direct = pgRpc(postgres)
    const rpc = (fn: string, args: Record<string, unknown>): Promise<unknown> =>
      direct(fn, Array.isArray(args.p_item_ids) ? { ...args, p_item_ids: `{${(args.p_item_ids as string[]).join(',')}}` } : args)

    const outcome = await rolledBack([receiptId], async () => {
      const subscription = async (state: string): Promise<string> =>
        (
          await row("insert into public.notifications (email, variant_id, status, token_version) values ($1, $2, $3, 3) returning id", [
            uniqueEmail('guest'),
            variant.id,
            state,
          ])
        ).id as string
      const queue = async (kind: string, priority: number, recipient: string, payload: Record<string, unknown>): Promise<string> =>
        (
          await row(
            `insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload) values ($1, $2, $3, $4, $5::jsonb) returning id`,
            [unique(kind), kind, priority, recipient, JSON.stringify(payload)],
          )
        ).id as string
      const pending = await subscription('pending')
      const confirmed = await subscription('confirmed')
      const unsubscribed = await subscription('unsubscribed')
      const owner = ownerMain.email
      const queued = {
        link: await queue('order_link', 1, placed.email, { orderId: placed.id }),
        ready: await queue('order_ready', 0, placed.email, { orderId: placed.id, itemIds: [digitalItem] }),
        shipped: await queue('order_shipped', 0, placed.email, { orderId: placed.id, itemIds: [physicalItem] }),
        refunded: await queue('order_refunded', 0, placed.email, { orderId: placed.id, refundId }),
        confirm: await queue('notify_confirm', 2, uniqueEmail('guest'), { notificationId: pending }),
        availability: await queue('availability', 2, uniqueEmail('guest'), { notificationId: confirmed }),
        alert: await queue('owner_alert', 0, owner, { alert: 'brand_new' }),
        // The state moved on: nothing is sent, and each row says why.
        confirmedAlready: await queue('notify_confirm', 2, uniqueEmail('guest'), { notificationId: confirmed }),
        unsubscribedMeanwhile: await queue('availability', 2, uniqueEmail('guest'), { notificationId: unsubscribed }),
        subscriptionGone: await queue('availability', 2, uniqueEmail('guest'), { notificationId: randomUUID() }),
        noFile: await queue('order_ready', 0, placed.email, { orderId: placed.id, itemIds: [physicalItem] }),
        notShipped: await queue('order_shipped', 0, placed.email, { orderId: placed.id, itemIds: [digitalItem] }),
        noRefund: await queue('order_refunded', 0, placed.email, { orderId: placed.id, refundId: randomUUID() }),
        orderGone: await queue('receipt', 0, placed.email, { orderId: randomUUID() }),
      }
      // One run claims at most ten rows.
      const runs = [await runOutbox(rpc), await runOutbox(rpc)]
      const stored = await rows('select id, status, last_error from finance.email_outbox where id = any($1::bigint[])', [[receiptId, ...Object.values(queued)]])
      return { runs, stored: new Map(stored.map((entry) => [String(entry.id), entry])), queued, pending, confirmed }
    })

    expect(outcome.runs.map((run) => run.claimed)).toEqual([10, 5])
    const state = (id: string): Row => outcome.stored.get(String(id))!
    const sentKinds = ['link', 'ready', 'shipped', 'refunded', 'confirm', 'availability', 'alert'] as const
    expect(state(receiptId)).toMatchObject({ status: 'sent', last_error: null })
    for (const kind of sentKinds) expect(state(outcome.queued[kind]), kind).toMatchObject({ status: 'sent', last_error: null })
    const closedWith: Array<[keyof typeof outcome.queued, string]> = [
      ['confirmedAlready', 'NOT_PENDING'],
      ['unsubscribedMeanwhile', 'NOT_CONFIRMED'],
      ['subscriptionGone', 'GONE'],
      ['noFile', 'NO_FILE'],
      ['notShipped', 'NO_SHIPMENT'],
      ['noRefund', 'NO_REFUND'],
      ['orderGone', 'GONE'],
    ]
    for (const [kind, code] of closedWith) expect(state(outcome.queued[kind]), kind).toMatchObject({ status: 'exhausted', last_error: code })
    // Exactly the eight rows that could be sent reached the provider.
    expect(posted).toHaveLength(8)

    // What each one says, with the token the order or the subscription derives.
    const orderToken = await orderAccessToken(PEPPER, placed.key, 0)
    const link = `https://anas.studio/orders#${placed.number}.${orderToken}`
    const toBuyer = posted.filter((mail) => mail.to[0] === placed.email)
    expect(toBuyer).toHaveLength(5)
    for (const mail of toBuyer) expect(mail.text).toContain(link)
    const bySubject = (needle: string): { text: string } => toBuyer.find((mail) => mail.subject.includes(needle))!
    expect(bySubject('إيصال').text).toContain(book.product.title)
    expect(bySubject('جاهزة').text).toContain(book.product.title)
    expect(bySubject('جاهزة').text).not.toContain(physical.product.title)
    expect(bySubject('شحنة').text).toContain('TRK-77')
    expect(bySubject('استرداد').text).toContain('25.00')
    const confirmMail = posted.find((mail) => mail.subject === 'أكّد طلب التنبيه')!
    expect(confirmMail.text).toContain(`https://anas.studio/notify/confirm#${await notificationToken(PEPPER, outcome.pending, 3)}`)
    const availabilityMail = posted.find((mail) => mail.text.includes('/notify/unsubscribe#'))!
    expect(availabilityMail.text).toContain(`https://anas.studio/store/${product.slug}`)
    expect(availabilityMail.text).toContain(`https://anas.studio/notify/unsubscribe#${await notificationToken(PEPPER, outcome.confirmed, 3)}`)
    const alertMail = posted.find((mail) => mail.to[0] === ownerMain.email)!
    expect(alertMail.subject).toBe('تنبيه جديد في المتجر')
    expect(alertMail.text).toContain('brand_new')

    // Nothing was written: the rolled-back run left the receipt waiting.
    expect((await row('select status from finance.email_outbox where id = $1', [receiptId])).status).toBe('pending')
  })
})

// --- end to end ----------------------------------------------------------------------------------

describe('a receipt through the real outbox function into Mailpit', () => {
  it('arrives with the order number and the order link, with a token that is the one the order derives', async () => {
    const physical = await variantOf({ fulfillment: 'physical', price: 5000, stock: 4 })
    const book = await variantOf({ fulfillment: 'digital', price: 1500 })
    await attachFile(book.id)
    const placed = await place([
      { variantId: physical.id, quantity: 1 },
      { variantId: book.id, quantity: 1 },
    ])
    expect((await pay(placed)).outcome).toBe('paid')
    const receipt = (await receiptsOf(placed.id))[0]!

    // The function claims whatever is due, ten rows a run: park every other row so it takes this receipt only.
    await postgres.query("update finance.email_outbox set next_at = now() + interval '1 day' where status in ('pending', 'uncertain') and id <> $1", [receipt.id])
    const response = await fetch(`${stack.FUNCTIONS_URL}/outbox`, { method: 'POST', headers: { authorization: `Bearer ${env.JOBS_SECRET}` } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: Array<{ job: string; status: string; claimed: number; accepted: number }> }
    expect(body.data[0]).toMatchObject({ job: 'email_outbox', status: 'ok', claimed: 1, accepted: 1 })
    const sent = await row('select status, provider_id, recipient from finance.email_outbox where id = $1', [receipt.id])
    expect(sent).toMatchObject({ status: 'sent', recipient: placed.email })

    const search = (await (await fetch(`${stack.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${placed.email}`)}`)).json()) as {
      messages?: Array<{ ID: string }>
    }
    expect(search.messages).toHaveLength(1)
    const message = (await (await fetch(`${stack.MAILPIT_URL}/api/v1/message/${search.messages![0]!.ID}`)).json()) as {
      Text?: string
      Subject?: string
      To?: Array<{ Address?: string }>
    }
    expect(message.To?.map((address) => address.Address)).toEqual([placed.email])
    expect(message.Subject).toContain(placed.number)
    expect(message.Subject).toContain('(تجريبي)')
    const text = message.Text ?? ''
    expect(text).toContain(placed.number)
    expect(text).toContain(`${SITE}/orders#${placed.number}.${await orderAccessToken(PEPPER, placed.key, 0)}`)
    expect(text).toContain('الملف الرقمي: تجده في صفحة طلبك.')
    expect(text).toContain('بائع')
    expect(text).not.toMatch(/ضريب|فاتورة/u)
  })
})
