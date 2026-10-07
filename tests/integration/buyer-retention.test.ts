// D42: buyer retention (`supabase/migrations/20260930130000_buyer_retention.sql`).
// Every fixture is written inside a transaction that is rolled back, as the
// local `postgres` superuser; `now()` is the transaction's start, so the
// backdated rows are exactly as old as the test says.
import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let postgres: Client

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
})

afterAll(async () => {
  await postgres.end()
})

const hash = () => createHash('sha256').update(randomUUID()).digest('hex')
const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const orderNumber = () =>
  Array.from({ length: 8 }, () => ORDER_ALPHABET[Math.floor(Math.random() * ORDER_ALPHABET.length)]).join('')

async function customer(daysAgo: number): Promise<string> {
  const email = `retention-${randomUUID()}@example.com`
  const { rows } = await postgres.query<{ id: string }>(
    `insert into public.customers (email, name, phone, created_at, updated_at)
     values ($1, 'مشترٍ', '966501234567', now() - make_interval(days => $2), now() - make_interval(days => $2))
     returning id`,
    [email, daysAgo],
  )
  return rows[0]!.id
}

/**
 * An order that ended `endedDaysAgo` days ago. Live by default: what money or work keeps an order is the live rule, and a
 * test-environment order (sandbox payments, no money) has its own (FABLE-AUDIT M2-12).
 */
async function order(customerId: string, status: string, endedDaysAgo: number, environment: 'test' | 'live' = 'live'): Promise<string> {
  const { rows } = await postgres.query<{ id: string }>(
    `insert into finance.orders (order_number, access_token_hash, access_token_expires_at, customer_id, customer_email,
       customer_name, customer_phone, seller, policy_revisions, subtotal_halalas, discount_halalas, shipping_halalas,
       total_halalas, environment, idempotency_key, request_hash, checkout_session, email_hash, status, hold_expires_at,
       created_at, updated_at)
     values ($1, $2, now(), $3, 'buyer@example.com', 'مشترٍ', '966501234567', '{}', '{}', 1000, 0, 0, 1000, $6,
       gen_random_uuid(), $2, gen_random_uuid(), $2, $4, now() - make_interval(days => $5),
       now() - make_interval(days => $5 + 1), now() - make_interval(days => $5))
     returning id`,
    [orderNumber(), hash(), customerId, status, endedDaysAgo, environment],
  )
  return rows[0]!.id
}

async function exists(table: string, id: string): Promise<boolean> {
  return (await postgres.query(`select 1 from ${table} where id = $1`, [id])).rowCount === 1
}

/** A payment attempt of a long-ended order (P08): its invoice expired 95 days ago. */
async function attempt(
  orderId: string,
  status: string,
  extra: { payment?: string; lastError?: string; due?: boolean } = {},
): Promise<string> {
  const { rows } = await postgres.query<{ id: string }>(
    `insert into finance.payment_attempts (order_id, status, amount_halalas, environment, invoice_expires_at,
       provider_invoice_id, provider_payment_id, last_error, next_check_at)
     values ($1, $2, 1000, (select o.environment from finance.orders o where o.id = $1), now() - interval '95 days', $3, $4, $5,
       case when $6::boolean then now() + interval '1 day' end)
     returning id`,
    [orderId, status, randomUUID(), extra.payment ?? null, extra.lastError ?? null, extra.due ?? false],
  )
  return rows[0]!.id
}

describe('buyer retention (D42)', () => {
  it('deletes expired and cancelled holds 90 days after they ended, and customers left with no order', async () => {
    await postgres.query('begin')
    try {
      const slug = `retention-${Date.now()}`
      const product = (
        await postgres.query<{ id: string }>(
          `insert into public.products (slug, title, summary, status) values ($1, 'منتج', '', 'published') returning id`,
          [slug],
        )
      ).rows[0]!.id
      const variant = (
        await postgres.query<{ id: string }>(
          `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled)
           values ($1, $2, 'رقمي', 'digital', 1000, true) returning id`,
          [product, `RET-${Date.now()}`],
        )
      ).rows[0]!.id

      // Old enough: an expired hold 91 days ago, with a line and a reservation.
      const oldBuyer = await customer(120)
      const oldOrder = await order(oldBuyer, 'expired', 91)
      await postgres.query(
        `insert into finance.order_items (order_id, line_no, variant_id, product_id, sku, product_title, variant_title,
           fulfillment, unit_price_halalas, quantity, line_subtotal_halalas, discount_halalas)
         values ($1, 1, $2, $3, 'RET', 'منتج', 'رقمي', 'digital', 1000, 1, 1000, 0)`,
        [oldOrder, variant, product],
      )
      await postgres.query(
        `insert into finance.inventory_reservations (order_id, variant_id, quantity, state, expires_at, released_at)
         values ($1, $2, 1, 'released', now() - interval '91 days', now() - interval '91 days')`,
        [oldOrder, variant],
      )
      // Kept: a hold cancelled 10 days ago, and a pending hold (never purged by status).
      const recentBuyer = await customer(120)
      const recentOrder = await order(recentBuyer, 'cancelled', 10)
      // A coupon order keeps a 'released' use after its hold ends; the use
      // references the order without ON DELETE CASCADE, so the purge must
      // delete it first or `delete from finance.orders` fails with 23503.
      const coupon = (
        await postgres.query<{ id: string }>(
          `insert into public.coupons (code, kind, percent_bp) values ($1, 'percent', 1000) returning id`,
          [`RET${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`],
        )
      ).rows[0]!.id
      await postgres.query(
        `insert into finance.coupon_redemptions (coupon_id, order_id, state, expires_at, released_at)
         values ($1, $2, 'released', now() - interval '91 days', now() - interval '91 days'),
                ($1, $3, 'released', now() - interval '10 days', now() - interval '10 days')`,
        [coupon, oldOrder, recentOrder],
      )
      const pendingBuyer = await customer(120)
      const pendingOrder = await order(pendingBuyer, 'pending_payment', 100)
      // Customers with no order: gone when untouched for 90 days, kept when recent.
      const idleBuyer = await customer(95)
      const freshBuyer = await customer(10)

      const { rows } = await postgres.query<{ n: number }>('select finance.buyer_retention_purge() as n')
      expect(rows[0]!.n).toBeGreaterThanOrEqual(3)

      expect(await exists('finance.orders', oldOrder)).toBe(false)
      expect((await postgres.query('select 1 from finance.order_items where order_id = $1', [oldOrder])).rowCount).toBe(0)
      expect(
        (await postgres.query('select 1 from finance.inventory_reservations where order_id = $1', [oldOrder])).rowCount,
      ).toBe(0)
      expect((await postgres.query('select 1 from finance.coupon_redemptions where order_id = $1', [oldOrder])).rowCount).toBe(0)
      expect((await postgres.query('select 1 from finance.coupon_redemptions where order_id = $1', [recentOrder])).rowCount).toBe(1)
      expect(await exists('public.customers', oldBuyer)).toBe(false)
      expect(await exists('public.customers', idleBuyer)).toBe(false)

      expect(await exists('finance.orders', recentOrder)).toBe(true)
      expect(await exists('public.customers', recentBuyer)).toBe(true)
      expect(await exists('finance.orders', pendingOrder)).toBe(true)
      expect(await exists('public.customers', pendingBuyer)).toBe(true)
      expect(await exists('public.customers', freshBuyer)).toBe(true)

      const audit = await postgres.query<{ summary: { orders: number; customers: number } }>(
        "select summary from public.audit_events where action = 'privacy.buyer_retention' order by id desc limit 1",
      )
      expect(audit.rows[0]!.summary.orders).toBeGreaterThanOrEqual(1)
      expect(audit.rows[0]!.summary.customers).toBeGreaterThanOrEqual(2)
      // The customers audit names the fields, never the buyer's values.
      const deleted = await postgres.query<{ summary: unknown }>(
        "select summary from public.audit_events where action = 'customers.delete' and entity_id = $1",
        [oldBuyer],
      )
      expect(JSON.stringify(deleted.rows[0]!.summary)).not.toContain('@example.com')
      expect(JSON.stringify(deleted.rows[0]!.summary)).not.toContain('966501234567')
    } finally {
      await postgres.query('rollback')
    }
  })

  it('deletes the payment attempts and events of the orders it removes, and keeps every order that still has money or work attached (P08)', async () => {
    await postgres.query('begin')
    try {
      const buyer = await customer(120)
      const event = async (paymentId: string): Promise<string> => {
        const id = `retention-${randomUUID()}`
        await postgres.query('insert into finance.payment_events (event_id, provider_payment_id) values ($1, $2)', [id, paymentId])
        return id
      }
      const attempts = async (orderId: string): Promise<number> =>
        (await postgres.query('select 1 from finance.payment_attempts where order_id = $1', [orderId])).rowCount ?? 0
      const events = async (eventId: string): Promise<number> =>
        (await postgres.query('select 1 from finance.payment_events where event_id = $1', [eventId])).rowCount ?? 0

      // Removed: an expired order and a cancelled one whose attempts are closed, with the events of their payments.
      const closedPayment = randomUUID()
      const closed = await order(buyer, 'expired', 91)
      await attempt(closed, 'expired', { payment: closedPayment })
      const closedEvent = await event(closedPayment)
      const strangerEvent = await event(randomUUID())
      const failed = await order(buyer, 'cancelled', 91)
      await attempt(failed, 'failed')
      await attempt(failed, 'abandoned')

      // Kept, each for its own reason.
      const kept: Record<string, string> = {}
      for (const status of ['creating', 'pending', 'uncertain', 'paid', 'review']) {
        const id = await order(buyer, 'expired', 91)
        await attempt(id, status, { payment: status === 'paid' || status === 'review' ? randomUUID() : undefined })
        kept[status] = id
      }
      kept.unverified = await order(buyer, 'expired', 91)
      await attempt(kept.unverified, 'expired', { lastError: 'UNVERIFIED' })
      kept.due = await order(buyer, 'cancelled', 91)
      await attempt(kept.due, 'cancelled', { due: true })
      for (const name of ['openReview', 'closedReview']) {
        const id = await order(buyer, 'expired', 91)
        const attemptId = await attempt(id, 'expired')
        await postgres.query(
          `insert into finance.payment_reviews (provider_payment_id, provider_invoice_id, attempt_id, order_id, environment,
             amount_halalas, currency, provider_status, reason, closed_at)
           values ($1, $2, $3, $4, 'test', 1000, 'SAR', 'paid', 'AMOUNT_MISMATCH', case when $5 then now() end)`,
          [randomUUID(), randomUUID(), attemptId, id, name === 'closedReview'],
        )
        kept[name] = id
      }
      kept.dispute = await order(buyer, 'expired', 91)
      await postgres.query(
        `insert into finance.disputes (kind, provider_ref, seq, attempt_id, environment, amount_halalas, direction, occurred_on, reason)
         values ('chargeback', $1, 1, $2, 'test', 1000, 'against_seller', current_date, 'نزاع')`,
        [`retention-${randomUUID()}`, await attempt(kept.dispute, 'expired')],
      )

      const { rows } = await postgres.query<{ n: number }>('select finance.buyer_retention_purge() as n')
      expect(rows[0]!.n).toBeGreaterThanOrEqual(2)

      for (const id of [closed, failed]) {
        expect(await exists('finance.orders', id)).toBe(false)
        expect(await attempts(id)).toBe(0)
      }
      expect(await events(closedEvent)).toBe(0)
      expect(await events(strangerEvent)).toBe(1)
      for (const [reason, id] of Object.entries(kept)) {
        expect(await exists('finance.orders', id), reason).toBe(true)
        expect(await attempts(id), reason).toBe(1)
      }
      // The buyer still has orders, so the profile stays.
      expect(await exists('public.customers', buyer)).toBe(true)
    } finally {
      await postgres.query('rollback')
    }
  })

  // FABLE-AUDIT M2-12 (OPS-PRIVACY-20): sandbox payments are no money, so a test-environment order goes 90 days after it
  // ended whatever its payment, with the rows a paid order has; work still attached keeps it, and a live one stays.
  it('purges a paid test-environment order 90 days after it ended, with its payment rows; one with work attached, a younger one and a live one stay', async () => {
    await postgres.query('begin')
    try {
      const buyer = await customer(120)
      const attempts = async (orderId: string): Promise<number> =>
        (await postgres.query('select 1 from finance.payment_attempts where order_id = $1', [orderId])).rowCount ?? 0
      const refunded = async (orderId: string): Promise<string> => {
        const paying = await attempt(orderId, 'paid', { payment: randomUUID() })
        await postgres.query(
          `insert into finance.refunds (order_id, attempt_id, amount_halalas, reason, status, source, succeeded_at)
           values ($1, $2, 1000, 'استرداد', 'succeeded', 'admin', now() - interval '91 days')`,
          [orderId, paying],
        )
        return paying
      }
      const sandbox = await order(buyer, 'refunded', 91, 'test')
      await refunded(sandbox)
      const young = await order(buyer, 'paid', 10, 'test')
      await attempt(young, 'paid', { payment: randomUUID() })
      const working = await order(buyer, 'paid', 91, 'test')
      await attempt(working, 'paid', { payment: randomUUID() })
      await attempt(working, 'pending')
      const live = await order(buyer, 'refunded', 91)
      await refunded(live)

      await postgres.query('select finance.buyer_retention_purge()')

      expect(await exists('finance.orders', sandbox)).toBe(false)
      expect(await attempts(sandbox)).toBe(0)
      expect((await postgres.query('select 1 from finance.refunds where order_id = $1', [sandbox])).rowCount).toBe(0)
      for (const [label, id] of Object.entries({ young, working, live })) {
        expect(await exists('finance.orders', id), label).toBe(true)
        expect(await attempts(id), label).toBeGreaterThan(0)
      }
      expect((await postgres.query('select 1 from finance.refunds where order_id = $1', [live])).rowCount).toBe(1)
    } finally {
      await postgres.query('rollback')
    }
  })

  it('runs daily from pg_cron and no API role can call it', async () => {
    const job = await postgres.query<{ command: string }>("select command from cron.job where jobname = 'buyer-retention'")
    expect(job.rows[0]!.command).toBe('select finance.buyer_retention_purge()')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const { rows } = await postgres.query<{ ok: boolean }>(
        "select has_function_privilege($1, 'finance.buyer_retention_purge()', 'execute') as ok",
        [role],
      )
      expect(rows[0]!.ok).toBe(false)
    }
  })
})
