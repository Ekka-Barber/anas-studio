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

async function order(customerId: string, status: string, endedDaysAgo: number): Promise<string> {
  const { rows } = await postgres.query<{ id: string }>(
    `insert into finance.orders (order_number, access_token_hash, access_token_expires_at, customer_id, customer_email,
       customer_name, customer_phone, seller, policy_revisions, subtotal_halalas, discount_halalas, shipping_halalas,
       total_halalas, environment, idempotency_key, request_hash, checkout_session, email_hash, status, hold_expires_at,
       created_at, updated_at)
     values ($1, $2, now(), $3, 'buyer@example.com', 'مشترٍ', '966501234567', '{}', '{}', 1000, 0, 0, 1000, 'test',
       gen_random_uuid(), $2, gen_random_uuid(), $2, $4, now() - make_interval(days => $5),
       now() - make_interval(days => $5 + 1), now() - make_interval(days => $5))
     returning id`,
    [orderNumber(), hash(), customerId, status, endedDaysAgo],
  )
  return rows[0]!.id
}

async function exists(table: string, id: string): Promise<boolean> {
  return (await postgres.query(`select 1 from ${table} where id = $1`, [id])).rowCount === 1
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
