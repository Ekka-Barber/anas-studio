// P06 round 2, D32: the `admin` Edge Function's `stats` action against real
// local JWTs. The handler is imported and called directly (the e2e suites
// reach it over HTTP); the analytics module is mocked so the cache behavior
// is observable by counting calls, and no network is touched.
//
// P08 round 9: the same action's `commerce` figures, and the SQL behind them and
// behind the disputes (`supabase/migrations/20261002170000_stats_disputes.sql`):
// `owner_commerce_stats`, `dispute_record` and `disputes_list`. The server-only
// functions are called as `service_role` (the Edge Functions' role, D32) through
// direct sessions; the owner's list as signed-in staff. Orders go through
// `checkout_create` and are paid by `apply_verified_payment` (the shared fixtures of
// `support.ts`). What only the database could write (a payment's date, an order's
// mode, a review payment) is written as the local `postgres` superuser. The ledger
// figures are proven in a month of the years 1000 to 1999 that holds nothing yet
// (found at random among twelve thousand, checked empty first): disputes cannot be
// deleted, so the local database keeps them, and a fixed month would accumulate the
// runs; a pool that small would run dry on a database that is never reset. Nothing here
// reaches Moyasar or sends a mail. This file switches
// `finance.commerce_settings.checkout_enabled` on, saved and restored by the
// fixtures; every fixture carries a per-run unique slug, SKU, email or reference.
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  anonClient,
  commerceHarness,
  createStaff,
  type Harness,
  type Paid,
  pgRpc,
  type Row,
  settledWithin,
  sha256,
  signIn,
  staffDb,
  status,
  uniqueEmail,
  type Role,
} from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

// `vi.hoisted` so the mock factory (hoisted with `vi.mock`) can reference it.
const { fetchAnalyticsMock } = vi.hoisted(() => ({
  fetchAnalyticsMock: vi.fn(async () => ({ status: 'unavailable', reason: 'NOT_CONFIGURED' })),
}))

vi.mock('../../supabase/functions/_shared/analytics.ts', () => ({
  fetchAnalytics: () => fetchAnalyticsMock(),
}))

import { handleAdmin } from '../../supabase/functions/_shared/admin.ts'

function requestWith(token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('http://local.test/functions/v1/admin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'stats' }),
  })
}

const GET = (request: Request) => handleAdmin(request)

async function tokenFor(email: string): Promise<string> {
  const client = await signIn(email)
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error('tokenFor: no session after sign-in')
  return data.session.access_token
}

const tokens: Partial<Record<Role | 'revoked-owner', string>> = {}
const PAYMENT_ENV = {
  MOYASAR_API_BASE_URL: 'http://127.0.0.1:54390/v1',
  MOYASAR_SECRET_KEY: 'sk_test_local_emulator_key_not_for_production',
  MOYASAR_WEBHOOK_SECRET: 'local-moyasar-webhook-secret-not-for-production',
  PAYMENTS_MODE: 'test',
  FUNCTIONS_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1',
}
const stubPayments = (values: Record<string, string>): void => {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value)
}
const unconfigurePayments = (): void => stubPayments(Object.fromEntries(Object.keys(PAYMENT_ENV).map((name) => [name, ''])))

beforeAll(async () => {
  // What the Edge Function runtime provides: the staff check runs as the
  // service role, like the hosted function.
  process.env.SUPABASE_URL = status.API_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SECRET_KEY
  for (const role of ['owner', 'editor', 'operations'] as const) {
    const { email } = await createStaff(role)
    tokens[role] = await tokenFor(email)
  }
  // A revoked owner: a valid token whose staff row is inactive — 403, not 401,
  // because the token itself is genuine.
  const revoked = await createStaff('owner', { active: false })
  tokens['revoked-owner'] = await tokenFor(revoked.email)
})

beforeEach(() => {
  fetchAnalyticsMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('admin function: stats', () => {
  it('no bearer is 401', async () => {
    const response = await GET(requestWith())
    expect(response.status).toBe(401)
  })

  it('a garbage bearer is 401', async () => {
    const response = await GET(requestWith('not-a-jwt'))
    expect(response.status).toBe(401)
  })

  it('an owner gets null commerce while payments are not configured and unavailable analytics, cached briefly (30 s)', async () => {
    // Runs first in this file, so the per-isolate cache is empty and the two
    // owner calls below exercise exactly one analytics fetch.
    unconfigurePayments()
    const first = await GET(requestWith(tokens.owner))
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const body = (await first.json()) as {
      ok: boolean
      data: { generatedAt: string; commerce: unknown; analytics: { status: string; reason: string } }
    }
    expect(body.ok).toBe(true)
    expect(body.data.commerce).toBeNull()
    expect(body.data.analytics).toEqual({ status: 'unavailable', reason: 'NOT_CONFIGURED' })
    expect(fetchAnalyticsMock).toHaveBeenCalledTimes(1)

    const second = await GET(requestWith(tokens.owner))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { data: { analytics: { reason: string } } }
    expect(secondBody.data.analytics.reason).toBe('NOT_CONFIGURED')
    expect(fetchAnalyticsMock).toHaveBeenCalledTimes(1) // served from the cache
  })

  it('with payments configured the commerce figures are the ledger\'s for the site\'s mode, read on every call (only the analytics is cached)', async () => {
    stubPayments(PAYMENT_ENV)
    const read = async (): Promise<Row> => ((await (await GET(requestWith(tokens.owner))).json()) as { data: { commerce: Row } }).data.commerce
    const before = await read()
    expect(Object.keys(before).sort()).toEqual(
      ['customers', 'disputes', 'environment', 'grossPaid', 'netCollected', 'paidOrders', 'refundsConfirmed', 'review'].sort(),
    )
    expect(before.environment).toBe('test')
    // A review payment that arrives now is in the default range at once: the ledger is not cached. It is dated a minute
    // back (FABLE-AUDIT M2-15): the range ends at this host's clock and the row's date is the database container's, whose
    // clock drifts a little from the host's, so a row dated at the database's now could fall just past the range's end.
    const paymentId = randomUUID()
    await h.postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason, created_at)
       values ($1, 'test', 1234, 'SAR', 'paid', 'UNMAPPED_INVOICE', now() - interval '1 minute')`,
      [paymentId],
    )
    reviewsToClose.push(paymentId)
    const after = await read()
    expect(after.review.captured).toBe(before.review.captured + 1234)
    expect(after.review.open).toBe(before.review.open + 1)
    expect(after.grossPaid).toBe(before.grossPaid)
    // Two reads, at most one analytics fetch (none while the first test answer is still cached).
    expect(fetchAnalyticsMock.mock.calls.length).toBeLessThanOrEqual(1)
    // A range that is not valid is refused before anything is read.
    const bad = await GET(
      new Request('http://local.test/functions/v1/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.owner}` },
        body: JSON.stringify({ action: 'stats', from: '2025-01-01T00:00:00Z' }),
      }),
    )
    expect(bad.status).toBe(422)
  })

  it('an editor is 403 without touching the cache or the analytics module', async () => {
    const response = await GET(requestWith(tokens.editor))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })

  it('an operations member is 403', async () => {
    const response = await GET(requestWith(tokens.operations))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })

  it('a revoked owner is 403 (a genuine token, no active role)', async () => {
    const response = await GET(requestWith(tokens['revoked-owner']))
    expect(response.status).toBe(403)
    expect(fetchAnalyticsMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// P08 round 9: the SQL

const PEPPER = `stats-pepper-${randomUUID()}`
const PREFIX = `p08r9-${Date.now()}-${process.pid}-`
const DAY = 86_400_000
const HOUR = 3_600_000
const uuids = (ids: string[]): string => `{${ids.join(',')}}`
const iso = (time: number | string): string => (typeof time === 'number' ? new Date(time).toISOString() : time)
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)
const sorted = (values: string[]): string[] => [...values].sort()

type Member = { userId: string; email: string }
type Figures = {
  environment: string
  paidOrders: number
  grossPaid: number
  refundsConfirmed: number
  netCollected: number
  customers: number
  review: { open: number; captured: number; refunded: number }
  disputes: { count: number; againstSeller: number; forSeller: number }
}

let h: Harness
let owner: Member
const reviewsToClose: string[] = []
let counter = 0
const ref = (label: string): string => `${PREFIX}${label}-${(counter += 1)}`

beforeAll(async () => {
  h = await commerceHarness(PEPPER, 6)
  owner = await h.makeStaff('owner')
})

afterAll(async () => {
  // Review payments written here must not stay open in the local database (the alerts count them); their refunds and the
  // alerts they queued go.
  await h.postgres.query('delete from finance.refunds where review_payment_id = any($1::text[])', [reviewsToClose])
  await h.postgres.query(
    "update finance.payment_reviews set closed_at = coalesce(closed_at, now()), closed_reason = coalesce(closed_reason, 'test cleanup') where provider_payment_id = any($1::text[])",
    [reviewsToClose],
  )
  await h.postgres.query("delete from finance.email_outbox where kind = 'owner_alert' and payload ->> 'paymentId' = any($1::text[])", [reviewsToClose])
  await h.stop()
})

const statsOf = (from: number | string, to: number | string, environment = 'test'): Promise<Figures> =>
  h.call('owner_commerce_stats', { p_from: iso(from), p_to: iso(to), p_environment: environment })

/** The same figures summed in JavaScript from the rows themselves, with the ledger's own definitions. */
async function fromRows(environment: string, from: number, to: number): Promise<Omit<Figures, 'environment' | 'disputes' | 'review'>> {
  const paid = await h.rows(
    `select a.captured_halalas as amount, a.order_id, o.customer_id
       from finance.payment_attempts a join finance.orders o on o.id = a.order_id
      where a.status = 'paid' and a.environment = $1 and a.paid_at >= $2 and a.paid_at < $3`,
    [environment, iso(from), iso(to)],
  )
  const refunds = await h.rows(
    `select r.amount_halalas as amount
       from finance.refunds r join finance.payment_attempts a on a.id = r.attempt_id
      where r.status = 'succeeded' and a.environment = $1 and r.succeeded_at >= $2 and r.succeeded_at < $3`,
    [environment, iso(from), iso(to)],
  )
  const grossPaid = sum(paid.map((row) => Number(row.amount)))
  const refundsConfirmed = sum(refunds.map((row) => Number(row.amount)))
  return {
    paidOrders: new Set(paid.map((row) => row.order_id)).size,
    grossPaid,
    refundsConfirmed,
    netCollected: grossPaid - refundsConfirmed,
    customers: new Set(paid.map((row) => row.customer_id)).size,
  }
}

const settle = async (p: Paid, paidAt: number, environment: 'test' | 'live' = 'test'): Promise<void> => {
  await h.postgres.query('update finance.payment_attempts set paid_at = $2, environment = $3 where id = $1', [p.attemptId, iso(paidAt), environment])
  await h.postgres.query('update finance.orders set paid_at = $2, environment = $3 where id = $1', [p.id, iso(paidAt), environment])
}

/** A refund of the paying attempt's first item the way the owner makes it, confirmed by the provider's total, dated `at`. */
async function refund(p: Paid, amount: number, at: number, before = 0): Promise<string> {
  const key = randomUUID()
  const asked = await h.call('refund_request', {
    p_actor: owner.userId,
    p_order: p.id,
    p_attempt: p.attemptId,
    p_review_payment: null,
    p_amount: amount,
    p_reason: 'استرداد جزئي',
    p_allocation: { items: [{ itemId: p.items[0]!.id, amount }], shipping: 0 },
    p_idempotency_key: key,
    p_request_hash: sha256(`hash:${key}`),
    p_return: null,
    p_provider_refunded: before,
  })
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
  const done = await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: before + amount, p_error: null })
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true, status: 'succeeded' })
  await h.postgres.query('update finance.refunds set succeeded_at = $2 where id = $1', [asked.refundId, iso(at)])
  return asked.refundId as string
}
const refundInFull = async (p: Paid, at: number): Promise<void> => {
  await h.refundFully(p, owner.userId)
  await h.postgres.query('update finance.refunds set succeeded_at = $2 where attempt_id = $1', [p.attemptId, iso(at)])
}

/** One `dispute_record` call as the owner makes it; `over` changes what it needs. */
const rec = (over: Record<string, unknown> = {}, client?: Parameters<Harness['call']>[2]): Promise<any> =>
  h.call(
    'dispute_record',
    {
      p_actor: owner.userId,
      p_kind: 'fee_difference',
      p_provider_ref: ref('REF'),
      p_follows: 0,
      p_attempt: null,
      p_review_payment: null,
      p_amount: 1000,
      p_direction: 'against_seller',
      p_occurred_on: '2001-03-05',
      p_reason: 'فرق في الرسوم عن كشف التسوية',
      p_resolution: null,
      p_decision: 'none',
      p_item_ids: uuids([]),
      p_environment: 'test',
      ...over,
    },
    client,
  )
const disputesOf = (providerRef: string): Promise<Row[]> => h.rows('select * from finance.disputes where provider_ref = $1 order by seq', [providerRef])
const disputeCount = async (): Promise<number> => h.count('select count(*)::int as n from finance.disputes')
const audits = (id: string): Promise<Row[]> => h.rows("select * from public.audit_events where action = 'dispute.recorded' and entity_id = $1", [id])

/** A second payment on a paid order's invoice, which the ledger keeps as a review payment of that order: its payment id. */
async function secondPayment(p: Paid): Promise<string> {
  const paymentId = randomUUID()
  const applied = await h.call('apply_verified_payment', {
    p_invoice_id: p.invoiceId,
    p_payment: { id: paymentId, status: 'paid', amount: p.total, currency: 'SAR', fee: 150, refunded: 0, invoiceId: p.invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
    p_invoice: { id: p.invoiceId, status: 'paid', amount: p.total, currency: 'SAR' },
    p_mode: 'test',
    p_live: null,
    p_event_id: null,
  })
  expect(applied, JSON.stringify(applied)).toMatchObject({ outcome: 'review' })
  reviewsToClose.push(paymentId)
  return paymentId
}

/** A charged payment on an invoice no attempt maps to: a review payment with no order and no attempt. Its payment id. */
async function unmappedReview(): Promise<string> {
  const paymentId = randomUUID()
  const invoiceId = randomUUID()
  const applied = await h.call('apply_verified_payment', {
    p_invoice_id: invoiceId,
    p_payment: { id: paymentId, status: 'paid', amount: 1500, currency: 'SAR', fee: 0, refunded: 0, invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
    p_invoice: { id: invoiceId, status: 'paid', amount: 1500, currency: 'SAR' },
    p_mode: 'test',
    p_live: null,
    p_event_id: null,
  })
  expect(applied, JSON.stringify(applied)).toMatchObject({ outcome: 'unknown_invoice' })
  reviewsToClose.push(paymentId)
  return paymentId
}

/** The SQLSTATE a call raised, or undefined when it did not raise. */
async function sqlstate(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

// --- the statistics ----------------------------------------------------------------------------------------------

describe('owner_commerce_stats', () => {
  let from = 0
  let to = 0
  let days = 0
  let year = 0
  let month = 0
  const at = (n: number): number => from + n * DAY + 12 * HOUR
  /** The calendar day, in Riyadh, `n` days after the month's first. */
  const day = (n: number): string => new Date(Date.UTC(year, month, 1 + n)).toISOString().slice(0, 10)
  let a1: Paid
  let a3: Paid
  let b: Paid
  let c: Paid
  let d: Paid
  let e: Paid
  let stuck: Paid
  let g: Paid
  let atTo: Paid
  let k: Paid
  let liveA: Paid
  let liveB: Paid
  let expected: { gross: number; refunds: number; customers: number }

  beforeAll(async () => {
    // A month that holds nothing, in Riyadh time: the ledger is never cleaned of what other runs left, and each run leaves
    // a month of disputes and paid orders behind, so it takes its own from twelve thousand. Before 1947 Riyadh's offset is
    // not the present three hours, so the month's bounds are the database's own local midnights.
    for (let attempt = 0; ; attempt += 1) {
      if (attempt === 40) throw new Error('no empty month found in the local ledger')
      year = 1000 + Math.floor(Math.random() * 1000)
      month = Math.floor(Math.random() * 12)
      const bounds = await h.row(
        `select extract(epoch from make_date($1::int, $2::int, 1)::timestamp at time zone 'Asia/Riyadh') * 1000 as first,
                extract(epoch from (make_date($1::int, $2::int, 1) + interval '1 month')::timestamp at time zone 'Asia/Riyadh') * 1000 as after`,
        [year, month + 1],
      )
      from = Number(bounds.first)
      to = Number(bounds.after)
      days = Math.round((to - from) / DAY)
      // The month and the 31 days on each side, which the partition test reads too.
      const quiet = async (environment: string): Promise<boolean> => {
        const found = await statsOf(from - 31 * DAY, to + 31 * DAY, environment)
        return found.paidOrders === 0 && found.refundsConfirmed === 0 && found.review.captured === 0 && found.disputes.count === 0
      }
      if ((await quiet('test')) && (await quiet('live'))) break
    }

    const physical = await h.physical(4000, 500)
    const digital = await h.digital(3500)
    const lines = (variantId: string, quantity = 1) => [{ variantId, quantity }]
    const shared = uniqueEmail('stats-buyer')
    a1 = await h.paid(lines(physical), { email: shared })
    a3 = await h.paid(lines(digital), { email: shared })
    b = await h.paid(lines(physical, 2))
    c = await h.paid(lines(digital))
    d = await h.paid(lines(physical))
    e = await h.paid(lines(physical))
    stuck = await h.paid(lines(physical))
    g = await h.paid(lines(digital))
    atTo = await h.paid(lines(digital))
    k = await h.paid(lines(digital))
    liveA = await h.paid(lines(digital))
    liveB = await h.paid(lines(physical))

    // Payments: inside the month, on its first instant (counted), one millisecond before its end (counted), on its end
    // (not), and before it.
    await settle(a1, at(2))
    await settle(a3, at(8))
    await settle(b, at(4))
    await settle(c, at(6))
    await settle(d, from - 10 * DAY)
    await settle(e, at(9))
    await settle(stuck, at(10))
    await h.postgres.query("update finance.orders set status = 'paid_needs_resolution' where id = $1", [stuck.id])
    await settle(g, from)
    await settle(atTo, to)
    await settle(k, to - 1)
    // Refunds: dated where they succeeded, whenever the payment was.
    await refund(b, 1500, at(5))
    await refundInFull(c, at(7))
    await refundInFull(d, from)
    await refund(e, 1000, to)
    await refund(liveB, 700, at(13))
    await settle(liveA, at(11), 'live')
    await settle(liveB, at(12), 'live')

    // Review payments: a real one (a second payment on a paid invoice), a closed and refunded one, one before the month, a live one.
    const second = await secondPayment(a1)
    await h.postgres.query('update finance.payment_reviews set created_at = $2 where provider_payment_id = $1', [second, iso(at(3))])
    const refundedReview = randomUUID()
    await h.postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason, provider_refunded_halalas, closed_at, closed_reason, created_at)
       values ($1, 'test', 2000, 'SAR', 'paid', 'UNMAPPED_INVOICE', 2000, $2, 'refunded', $2)`,
      [refundedReview, iso(at(14))],
    )
    // The refund of a review payment has no order and no attempt: it is in no figure of the paying attempts.
    await h.postgres.query(
      `insert into finance.refunds (review_payment_id, amount_halalas, reason, allocation, status, source, provider_refunded_before, provider_refunded_after, succeeded_at)
       values ($1, 2000, 'استرداد', '{}'::jsonb, 'succeeded', 'admin', 0, 2000, $2)`,
      [refundedReview, iso(at(15))],
    )
    const earlier = randomUUID()
    const live = randomUUID()
    await h.postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason, created_at)
       values ($1, 'test', 900, 'SAR', 'paid', 'UNMAPPED_INVOICE', $3), ($2, 'live', 1100, 'SAR', 'paid', 'UNMAPPED_INVOICE', $4)`,
      [earlier, live, iso(from - 2 * DAY), iso(at(16))],
    )
    reviewsToClose.push(refundedReview, earlier, live)

    // Disputes, each on a day of its own: the month's first day (counted: its start is the range's first instant) and
    // last, the day of the month's end (not: its start is the range's end), the day before the month (not).
    const owned = { p_kind: 'chargeback' }
    expect(await rec({ p_kind: 'fee_difference', p_amount: 500, p_occurred_on: day(0) })).toMatchObject({ ok: true })
    expect(await rec({ p_kind: 'payout_difference', p_amount: 700, p_direction: 'for_seller', p_occurred_on: day(days - 1) })).toMatchObject({ ok: true })
    const cb1 = ref('CB')
    expect(await rec({ ...owned, p_provider_ref: cb1, p_attempt: a1.attemptId, p_amount: a1.total, p_occurred_on: day(12) })).toMatchObject({ ok: true })
    expect(
      await rec({ ...owned, p_provider_ref: cb1, p_follows: 1, p_attempt: a1.attemptId, p_amount: a1.total, p_direction: 'for_seller', p_occurred_on: day(20), p_resolution: 'ربحنا النزاع' }),
    ).toMatchObject({ ok: true })
    expect(await rec({ ...owned, p_attempt: b.attemptId, p_amount: 1000, p_occurred_on: day(13) })).toMatchObject({ ok: true })
    expect(await rec({ p_amount: 300, p_occurred_on: day(days) })).toMatchObject({ ok: true })
    expect(await rec({ p_amount: 400, p_occurred_on: day(-1) })).toMatchObject({ ok: true })
    expect(await rec({ p_amount: 250, p_occurred_on: day(5), p_environment: 'live' })).toMatchObject({ ok: true })
    expect(await rec({ ...owned, p_attempt: liveA.attemptId, p_amount: 600, p_direction: 'for_seller', p_occurred_on: day(6), p_environment: 'live' })).toMatchObject({ ok: true })

    expected = {
      gross: sum([a1, a3, b, c, e, stuck, g, k].map((p) => p.total)),
      refunds: 1500 + c.total + d.total,
      customers: 1 + 6,
    }
  })

  it('the test figures equal the ledger, row for row: gross, orders, buyers, refunds and net', async () => {
    const figures = await statsOf(from, to)
    expect(figures).toEqual({
      environment: 'test',
      // a1 and a3 (one buyer), b, c (refunded in full), e, the order that needs resolution, g (on the first instant) and
      // k (a millisecond before the end): the paid ones of the month, whatever became of them since.
      paidOrders: 8,
      grossPaid: expected.gross,
      // b's partial refund, c's full one, and d's, which succeeded in this month for a payment of the one before.
      refundsConfirmed: expected.refunds,
      netCollected: expected.gross - expected.refunds,
      customers: expected.customers,
      review: { open: 1, captured: a1.total + 2000, refunded: 2000 },
      disputes: { count: 4, againstSeller: 500 + 1000, forSeller: 700 + a1.total },
    })
    // The same sums made from the rows.
    expect({
      paidOrders: figures.paidOrders,
      grossPaid: figures.grossPaid,
      refundsConfirmed: figures.refundsConfirmed,
      netCollected: figures.netCollected,
      customers: figures.customers,
    }).toEqual(await fromRows('test', from, to))
  })

  it('the live figures are apart: live rows only, and the test rows are in none of them', async () => {
    const figures = await statsOf(from, to, 'live')
    expect(figures).toEqual({
      environment: 'live',
      paidOrders: 2,
      grossPaid: liveA.total + liveB.total,
      refundsConfirmed: 700,
      netCollected: liveA.total + liveB.total - 700,
      customers: 2,
      review: { open: 1, captured: 1100, refunded: 0 },
      disputes: { count: 2, againstSeller: 250, forSeller: 600 },
    })
    const rows = await fromRows('live', from, to)
    expect(figures.grossPaid).toBe(rows.grossPaid)
    expect(figures.refundsConfirmed).toBe(rows.refundsConfirmed)
    // And the other way: the test figures above hold no live order.
    const test = await statsOf(from, to)
    expect(test.grossPaid).not.toBe(figures.grossPaid)
    expect(test.paidOrders + figures.paidOrders).toBe(10)
  })

  it('every row falls in exactly one of two adjacent ranges: the first instant is in, the last is out, so the parts add up to the whole', async () => {
    const before = await statsOf(from - 30 * DAY, from)
    const middle = await statsOf(from, to)
    const after = await statsOf(to, to + 30 * DAY)
    // The range's first instant is in (g, d's refund, the dispute of the first day); its end is not (atTo, e's refund, the dispute of that day).
    expect(before).toMatchObject({ paidOrders: 1, grossPaid: d.total, refundsConfirmed: 0, review: { captured: 900, open: 1 }, disputes: { count: 1, againstSeller: 400 } })
    expect(after).toMatchObject({ paidOrders: 1, grossPaid: atTo.total, refundsConfirmed: 1000, disputes: { count: 1, againstSeller: 300 } })
    for (const environment of ['test', 'live']) {
      const parts = [await statsOf(from - 30 * DAY, from, environment), await statsOf(from, to, environment), await statsOf(to, to + 30 * DAY, environment)]
      const whole = await statsOf(from - 30 * DAY, to + 30 * DAY, environment)
      const total = (pick: (figures: Figures) => number): number => sum(parts.map(pick))
      expect(whole.paidOrders, environment).toBe(total((f) => f.paidOrders))
      expect(whole.grossPaid, environment).toBe(total((f) => f.grossPaid))
      expect(whole.refundsConfirmed, environment).toBe(total((f) => f.refundsConfirmed))
      expect(whole.netCollected, environment).toBe(total((f) => f.netCollected))
      expect(whole.review.open, environment).toBe(total((f) => f.review.open))
      expect(whole.review.captured, environment).toBe(total((f) => f.review.captured))
      expect(whole.review.refunded, environment).toBe(total((f) => f.review.refunded))
      expect(whole.disputes.count, environment).toBe(total((f) => f.disputes.count))
      expect(whole.disputes.againstSeller, environment).toBe(total((f) => f.disputes.againstSeller))
      expect(whole.disputes.forSeller, environment).toBe(total((f) => f.disputes.forSeller))
    }
    expect(middle.paidOrders).toBe(8)
    // A millisecond after the first instant, the payment made on it is out; a millisecond before the end, the payment made
    // a millisecond before the end is out too (the end is exclusive), and the one on the end is out of the month.
    expect((await statsOf(from + 1, to)).paidOrders).toBe(7)
    expect((await statsOf(from, to - 1)).paidOrders).toBe(7)
    // An empty range answers zeros.
    expect(await statsOf(from, from)).toMatchObject({ paidOrders: 0, grossPaid: 0, refundsConfirmed: 0, netCollected: 0, customers: 0 })
  })

  it('review money and disputes are beside the figures and in none of them', async () => {
    const before = await statsOf(from, to)
    const paymentId = randomUUID()
    await h.postgres.query(
      `insert into finance.payment_reviews (provider_payment_id, environment, amount_halalas, currency, provider_status, reason, created_at)
       values ($1, 'test', 777, 'SAR', 'paid', 'UNMAPPED_INVOICE', $2)`,
      [paymentId, iso(at(18))],
    )
    reviewsToClose.push(paymentId)
    expect(await rec({ p_amount: 333, p_occurred_on: day(18) })).toMatchObject({ ok: true })
    const after = await statsOf(from, to)
    expect({ ...after, review: 0, disputes: 0 }).toEqual({ ...before, review: 0, disputes: 0 })
    expect(after.review).toEqual({ open: before.review.open + 1, captured: before.review.captured + 777, refunded: before.review.refunded })
    expect(after.disputes).toEqual({ count: before.disputes.count + 1, againstSeller: before.disputes.againstSeller + 333, forSeller: before.disputes.forSeller })
    // A refunded review payment is in `review.refunded` and in no refund of the paying attempts.
    expect(after.review.refunded).toBe(2000)
    expect(after.refundsConfirmed).toBe(expected.refunds)
  })

  it('a dispute counts once however many rows it has: its latest row is its current state, and it is counted where that row is dated', async () => {
    const before = await statsOf(from, to)
    const earlyBefore = (await statsOf(from, from + 22 * DAY)).disputes
    const reference = ref('STATE')
    expect(await rec({ p_kind: 'chargeback', p_provider_ref: reference, p_attempt: b.attemptId, p_amount: 2000, p_occurred_on: day(21) })).toMatchObject({ ok: true })
    const opened = await statsOf(from, to)
    expect(opened.disputes).toEqual({ count: before.disputes.count + 1, againstSeller: before.disputes.againstSeller + 2000, forSeller: before.disputes.forSeller })
    expect((await statsOf(from, from + 22 * DAY)).disputes).toEqual({ ...earlyBefore, count: earlyBefore.count + 1, againstSeller: earlyBefore.againstSeller + 2000 })
    // Its outcome is a second row: the amount against the seller becomes an amount for the seller, and the count is the same.
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: reference, p_follows: 1, p_attempt: b.attemptId, p_amount: 2000, p_direction: 'for_seller', p_occurred_on: day(22) }),
    ).toMatchObject({ ok: true })
    const closed = await statsOf(from, to)
    expect(closed.disputes).toEqual({ count: before.disputes.count + 1, againstSeller: before.disputes.againstSeller, forSeller: before.disputes.forSeller + 2000 })
    // The latest row dates the dispute, so it is never counted twice: a range that ends before the outcome no longer has the
    // opening, and the range that starts on the outcome's day has it (with the payout difference of the month's last day).
    expect((await statsOf(from, from + 22 * DAY)).disputes).toEqual(earlyBefore)
    expect((await statsOf(from + 22 * DAY, to)).disputes).toEqual({ count: 2, againstSeller: 0, forSeller: 2000 + 700 })
    // The figures of the money are the same in all of this.
    expect({ ...closed, disputes: 0, review: 0 }).toEqual({ ...before, disputes: 0, review: 0 })
  })

  it('refuses a malformed range or environment with 22023 and answers nothing', async () => {
    const f = '2020-01-01T00:00:00Z'
    const t = '2020-02-01T00:00:00Z'
    for (const [label, args] of [
      ['no from', { p_from: null, p_to: t, p_environment: 'test' }],
      ['no to', { p_from: f, p_to: null, p_environment: 'test' }],
      ['from after to', { p_from: t, p_to: f, p_environment: 'test' }],
      ['367 days', { p_from: '2019-01-01T00:00:00Z', p_to: '2020-01-03T00:00:00Z', p_environment: 'test' }],
      ['366 days and a second', { p_from: '2019-01-01T00:00:00Z', p_to: '2020-01-02T00:00:01Z', p_environment: 'live' }],
      ['no environment', { p_from: f, p_to: t, p_environment: null }],
      ['an unknown environment', { p_from: f, p_to: t, p_environment: 'staging' }],
      ['an environment in capitals', { p_from: f, p_to: t, p_environment: 'TEST' }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(await sqlstate(h.call('owner_commerce_stats', args)), label).toBe('22023')
    }
    // A leap year's 366 days is the longest range there is.
    expect(await statsOf('2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z')).toMatchObject({ environment: 'test' })
    expect(await statsOf('2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')).toMatchObject({ paidOrders: 0, grossPaid: 0 })
  })
})

// --- dispute_record -----------------------------------------------------------------------------------------------

describe('dispute_record', () => {
  let digitalA: string
  let digitalB: string
  let printed: string
  let mixed: Paid
  let item: { a: string; b: string; physical: string }
  let operations: Member
  let editor: Member
  let revokedOwner: Member

  const setFile = async (variantId: string): Promise<void> => {
    const reply = await h.call('paid_asset_set', {
      p_actor: owner.userId,
      p_variant: variantId,
      p_storage_key: `assets/${variantId}/${randomUUID()}`,
      p_filename: 'كتاب أنس.pdf',
      p_mime: 'application/pdf',
      p_bytes: 2048,
    })
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true })
  }
  /** An order of two digital books (with files) and one printed one. */
  const order = async (): Promise<{ p: Paid; a: string; b: string; physical: string }> => {
    const p = await h.paid([
      { variantId: digitalA, quantity: 1 },
      { variantId: digitalB, quantity: 1 },
      { variantId: printed, quantity: 1 },
    ])
    const of = (variantId: string): string => p.items.find((entry) => entry.variantId === variantId)!.id
    return { p, a: of(digitalA), b: of(digitalB), physical: of(printed) }
  }
  const entitlement = (itemId: string): Promise<Row> => h.row('select * from finance.entitlements where order_item_id = $1', [itemId])
  const fulfilment = (itemId: string): Promise<Row> => h.row('select * from finance.fulfillments where order_item_id = $1', [itemId])
  const issue = async (p: Paid, itemId: string): Promise<{ reply: any; tokenHash: string }> => {
    const tokenHash = sha256(`download-${randomUUID()}`)
    const reply = await h.call('download_issue', {
      p_order_number: p.number,
      p_access_token_hash: p.hash,
      p_item: itemId,
      p_download_token_hash: tokenHash,
      p_ip_hash: h.ipHash(),
      p_mode: 'test',
    })
    return { reply, tokenHash }
  }
  const redeem = (tokenHash: string): Promise<any> => h.call('download_redeem', { p_download_token_hash: tokenHash, p_ip_hash: h.ipHash(), p_mode: 'test' })
  /** Everything a dispute must leave alone, as it is now. */
  const snapshot = async (p: Paid): Promise<Row> => ({
    attempt: (await h.row('select to_jsonb(a) as r from finance.payment_attempts a where a.id = $1', [p.attemptId])).r,
    order: (await h.row('select to_jsonb(o) as r from finance.orders o where o.id = $1', [p.id])).r,
    stock: (await h.rows('select id, stock from public.product_variants where id = any($1::uuid[]) order by id', [p.items.map((entry) => entry.variantId)])),
    reservations: (await h.rows('select state, quantity, preorder, released_at from finance.inventory_reservations where order_id = $1 order by id', [p.id])),
    fulfilments: (await h.rows('select to_jsonb(f) as r from finance.fulfillments f where f.order_id = $1 order by f.id', [p.id])).map((row) => row.r),
    refunds: await h.count('select count(*)::int as n from finance.refunds where order_id = $1', [p.id]),
    mail: await h.count("select count(*)::int as n from finance.email_outbox where payload ->> 'orderId' = $1", [p.id]),
  })

  beforeAll(async () => {
    digitalA = await h.digital(3500)
    digitalB = await h.digital(2000)
    printed = await h.physical(4000, 100)
    await setFile(digitalA)
    await setFile(digitalB)
    operations = await h.makeStaff('operations')
    editor = await h.makeStaff('editor')
    revokedOwner = await h.makeStaff('owner', { active: false })
    mixed = (await order()).p
    item = {
      a: mixed.items.find((entry) => entry.variantId === digitalA)!.id,
      b: mixed.items.find((entry) => entry.variantId === digitalB)!.id,
      physical: mixed.items.find((entry) => entry.variantId === printed)!.id,
    }
  })

  it('records a chargeback against a paid attempt and answers the row the way order_detail shows it', async () => {
    const providerRef = ref('CB')
    const reply = await rec({
      p_kind: 'chargeback',
      p_provider_ref: providerRef,
      p_attempt: mixed.attemptId,
      p_amount: 4500,
      p_occurred_on: '2026-09-30',
      p_reason: 'اعترض حامل البطاقة',
    })
    expect(reply).toEqual({
      ok: true,
      duplicate: false,
      dispute: {
        id: expect.any(String),
        kind: 'chargeback',
        providerRef,
        seq: 1,
        attemptId: mixed.attemptId,
        reviewPaymentId: null,
        environment: 'test',
        amount: 4500,
        direction: 'against_seller',
        occurredOn: '2026-09-30',
        reason: 'اعترض حامل البطاقة',
        resolution: null,
        decision: 'none',
        itemIds: [],
        createdAt: expect.any(String),
      },
    })
    const stored = (await disputesOf(providerRef))[0]!
    expect(stored).toMatchObject({ id: reply.dispute.id, recorded_by: owner.userId, amount_halalas: 4500 })
    // The owner's order screen shows the same row, key for key.
    const db = await staffDb(owner.userId)
    try {
      const detail = (await pgRpc(db)('order_detail', { p_order: mixed.id })) as { disputes: Array<Record<string, unknown>> }
      expect(detail.disputes.find((row) => row.id === reply.dispute.id)).toEqual(reply.dispute)
    } finally {
      await db.end()
    }
  })

  it('refuses anyone who is not an active owner, before it reads anything, and writes nothing', async () => {
    const before = await disputeCount()
    for (const [who, actor] of [
      ['operations', operations.userId],
      ['an editor', editor.userId],
      ['a revoked owner', revokedOwner.userId],
      ['someone unknown', randomUUID()],
      ['nobody', null],
    ] as Array<[string, string | null]>) {
      expect(await sqlstate(rec({ p_actor: actor, p_kind: 'chargeback', p_attempt: mixed.attemptId })), who).toBe('42501')
      // The role comes before the arguments: a malformed call from them is refused as theirs.
      expect(await sqlstate(rec({ p_actor: actor, p_kind: 'nonsense' })), `${who}, malformed`).toBe('42501')
    }
    expect(await disputeCount()).toBe(before)
  })

  it('raises 22023 for a malformed call, each field and each combination, and writes nothing', async () => {
    const before = await disputeCount()
    const tomorrow = new Date(Date.now() + 3 * HOUR + DAY).toISOString().slice(0, 10)
    const chargeback = { p_kind: 'chargeback', p_attempt: mixed.attemptId }
    for (const [label, over] of [
      ['no kind', { p_kind: null }],
      ['an unknown kind', { p_kind: 'refund' }],
      ['no reference', { p_provider_ref: null }],
      ['an empty reference', { p_provider_ref: '' }],
      ['a reference over 120 characters', { p_provider_ref: 'R'.repeat(121) }],
      ['a reference with spaces around it', { p_provider_ref: ' CB-1' }],
      ['a reference with a line break', { p_provider_ref: 'CB-1\nCB-2' }],
      ['no follows', { p_follows: null }],
      ['a negative follows', { p_follows: -1 }],
      ['a follows over 1000', { p_follows: 1001 }],
      ['no amount', { p_amount: null }],
      ['a zero amount', { p_amount: 0 }],
      ['a negative amount', { p_amount: -10 }],
      ['no direction', { p_direction: null }],
      ['an unknown direction', { p_direction: 'sideways' }],
      ['no date', { p_occurred_on: null }],
      ['a date in the future', { p_occurred_on: tomorrow }],
      ['no reason', { p_reason: null }],
      ['an empty reason', { p_reason: '' }],
      ['a reason over 500 characters', { p_reason: 'ا'.repeat(501) }],
      ['a reason with a line break', { p_reason: 'سطر\nثانٍ' }],
      ['an empty resolution', { p_resolution: '' }],
      ['a resolution over 500 characters', { p_resolution: 'ا'.repeat(501) }],
      ['a resolution with a control character', { p_resolution: 'نص\u0007' }],
      ['no decision', { p_decision: null }],
      ['an unknown decision', { p_decision: 'refunded' }],
      ['no environment', { p_environment: null }],
      ['an unknown environment', { p_environment: 'staging' }],
      ['an attempt and a review payment', { ...chargeback, p_review_payment: randomUUID() }],
      ['a chargeback with no target', { p_kind: 'chargeback' }],
      ['an `other` with no target', { p_kind: 'other' }],
      ['a review payment over 120 characters', { p_kind: 'other', p_review_payment: 'p'.repeat(121) }],
      ['an item decision with no items', { ...chargeback, p_decision: 'entitlement_revoked' }],
      ['items for a decision that does not act on them', { ...chargeback, p_decision: 'none', p_item_ids: uuids([item.a]) }],
      ['items for entitlement_kept', { ...chargeback, p_decision: 'entitlement_kept', p_item_ids: uuids([item.a]) }],
      ['the same item twice', { ...chargeback, p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a, item.a]) }],
      ['a null among the items', { ...chargeback, p_decision: 'entitlement_revoked', p_item_ids: '{NULL}' }],
      ['more than 50 items', { ...chargeback, p_decision: 'entitlement_revoked', p_item_ids: uuids(Array.from({ length: 51 }, () => randomUUID())) }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(await sqlstate(rec(over)), label).toBe('22023')
    }
    expect(await disputeCount()).toBe(before)
  })

  it('answers each business refusal with its code and changes nothing: no target, a payment that is not paid, no predecessor, items that do not fit', async () => {
    // The other order is made first: it takes stock of the printed book that `mixed` shares.
    const other = await order()
    const before = await disputeCount()
    const snapshotBefore = await snapshot(mixed)
    // An attempt that does not exist, and one of the other mode.
    expect(await rec({ p_kind: 'chargeback', p_attempt: randomUUID() })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await rec({ p_kind: 'chargeback', p_attempt: mixed.attemptId, p_environment: 'live' })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await rec({ p_kind: 'other', p_review_payment: randomUUID() })).toEqual({ ok: false, code: 'NOT_FOUND' })
    // A payment that is not paid: still pending, and one in review (its payment is the review payment's).
    const placed = await h.place([{ variantId: digitalA, quantity: 1 }])
    const started = await h.startPayment(placed)
    expect(await rec({ p_kind: 'chargeback', p_attempt: started.attemptId })).toEqual({ ok: false, code: 'NOT_DISPUTABLE' })
    const mismatched = await h.place([{ variantId: digitalA, quantity: 1 }])
    const mismatchedStart = await h.startPayment(mismatched)
    expect(await h.applyPayment(mismatched, mismatchedStart, { amount: mismatched.total + 100 })).toMatchObject({ outcome: 'review' })
    expect(await h.row('select status from finance.payment_attempts where id = $1', [mismatchedStart.attemptId])).toEqual({ status: 'review' })
    expect(await rec({ p_kind: 'chargeback', p_attempt: mismatchedStart.attemptId })).toEqual({ ok: false, code: 'NOT_DISPUTABLE' })
    // A follow-up needs its predecessor: none at all, and one that is too far ahead.
    expect(await rec({ p_follows: 1 })).toEqual({ ok: false, code: 'NO_PREDECESSOR' })
    const reference = ref('GAP')
    expect(await rec({ p_provider_ref: reference })).toMatchObject({ ok: true })
    expect(await rec({ p_provider_ref: reference, p_follows: 2 })).toEqual({ ok: false, code: 'NO_PREDECESSOR' })
    expect(await rec({ p_provider_ref: reference, p_follows: 1000 })).toEqual({ ok: false, code: 'NO_PREDECESSOR' })
    // The predecessor must be of the same kind: the same text under another kind is another reference.
    expect(await rec({ p_provider_ref: reference, p_follows: 1, p_kind: 'payout_difference' })).toEqual({ ok: false, code: 'NO_PREDECESSOR' })
    // A follow-up names its predecessor's target: this reference began with none.
    expect(await rec({ p_provider_ref: reference, p_follows: 1, p_attempt: mixed.attemptId })).toEqual({ ok: false, code: 'TARGET_MISMATCH' })
    // Items: an entitlement decision needs digital items of this order, a fulfilment one needs items still being prepared.
    const mine = { p_kind: 'chargeback', p_attempt: mixed.attemptId }
    for (const [label, over] of [
      ['a printed item for entitlement_revoked', { p_decision: 'entitlement_revoked', p_item_ids: uuids([item.physical]) }],
      ['an item of another order', { p_decision: 'entitlement_revoked', p_item_ids: uuids([other.a]) }],
      ['one good item and one of another order', { p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a, other.b]) }],
      ['an item that does not exist', { p_decision: 'entitlement_revoked', p_item_ids: uuids([randomUUID()]) }],
      ['a digital item for fulfillment_stopped', { p_decision: 'fulfillment_stopped', p_item_ids: uuids([item.a]) }],
      ['an item of another order for fulfillment_stopped', { p_decision: 'fulfillment_stopped', p_item_ids: uuids([other.physical]) }],
      ['a good item and a digital one for fulfillment_stopped', { p_decision: 'fulfillment_stopped', p_item_ids: uuids([item.physical, item.a]) }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(await rec({ ...mine, ...over }), label).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    }
    // A payout or a fee difference has no order, so no item: even a review payment with no order has none.
    expect(await rec({ p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a]) })).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    expect(await rec({ p_decision: 'fulfillment_stopped', p_item_ids: uuids([item.physical]) })).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    const unmapped = await unmappedReview()
    expect(await rec({ p_kind: 'other', p_review_payment: unmapped, p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a]) })).toEqual({ ok: false, code: 'INVALID_ITEMS' })

    expect(await disputeCount()).toBe(before + 1) // the one reference made above
    expect(await snapshot(mixed)).toEqual(snapshotBefore)
    expect((await entitlement(item.a)).revoked_at).toBeNull()
    expect((await fulfilment(item.physical)).state).toBe('preparing')
  })

  it('a repeat answers the stored row and changes nothing: a reconciliation run again never counts twice', async () => {
    const providerRef = ref('DUP')
    const first = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: mixed.attemptId, p_amount: 1200, p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a]) })
    expect(first).toMatchObject({ ok: true, duplicate: false })
    const revokedAt = (await entitlement(item.a)).revoked_at as Date
    expect(revokedAt).not.toBeNull()
    const auditsBefore = await audits(first.dispute.id)
    expect(auditsBefore).toHaveLength(1)

    const again = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: mixed.attemptId, p_amount: 1200, p_decision: 'entitlement_revoked', p_item_ids: uuids([item.a]) })
    expect(again).toEqual({ ok: true, duplicate: true, dispute: first.dispute })
    // Whatever the repeat says, it is the stored row that answers, and nothing is written.
    const other = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: mixed.attemptId, p_amount: 9999, p_direction: 'for_seller', p_reason: 'سبب آخر', p_decision: 'none' })
    expect(other).toEqual({ ok: true, duplicate: true, dispute: first.dispute })
    expect(await disputesOf(providerRef)).toHaveLength(1)
    expect(await audits(first.dispute.id)).toHaveLength(1)
    expect((await entitlement(item.a)).revoked_at).toEqual(revokedAt)
    // The repeat is answered before the state is judged: a repeated stop-fulfilment is not refused because its item has
    // shipped since.
    const stop = ref('STOP')
    const stopped = await rec({ p_kind: 'chargeback', p_provider_ref: stop, p_attempt: mixed.attemptId, p_decision: 'fulfillment_stopped', p_item_ids: uuids([item.physical]) })
    expect(stopped).toMatchObject({ ok: true, duplicate: false })
    await h.postgres.query("update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'T-1', shipped_at = now() where order_item_id = $1", [item.physical])
    expect(await rec({ p_kind: 'chargeback', p_provider_ref: stop, p_attempt: mixed.attemptId, p_decision: 'fulfillment_stopped', p_item_ids: uuids([item.physical]) })).toEqual({ ok: true, duplicate: true, dispute: stopped.dispute })
    // A follow-up repeated is the same: its place in the reference is taken.
    const followed = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 1, p_attempt: mixed.attemptId, p_amount: 1200, p_direction: 'for_seller', p_resolution: 'ربحنا' })
    expect(followed).toMatchObject({ ok: true, duplicate: false, dispute: { seq: 2 } })
    expect(await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 1, p_attempt: mixed.attemptId, p_amount: 1200, p_direction: 'for_seller' })).toEqual({
      ok: true,
      duplicate: true,
      dispute: followed.dispute,
    })
    expect(await disputesOf(providerRef)).toHaveLength(2)
  })

  it('two calls at once for the same place end the same way: one inserts, the other answers that row, never an error', async () => {
    // Behind the order's lock: both calls are started, both wait, and they race for the place the moment it is freed.
    const target = await order()
    const providerRef = ref('RACE')
    const args = { p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: target.p.attemptId, p_amount: 700, p_decision: 'entitlement_revoked', p_item_ids: uuids([target.a]) }
    const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [target.p.id])
    const calls = [rec(args, h.pool[0]), rec({ ...args, p_amount: 800 }, h.pool[1])]
    expect(await settledWithin(calls[0]!, 800)).toBe('blocked')
    expect(await settledWithin(calls[1]!, 800)).toBe('blocked')
    await lock.release()
    const answers = await Promise.all(calls)
    expect(answers.map((answer) => answer.ok)).toEqual([true, true])
    expect(answers.filter((answer) => answer.duplicate).length).toBe(1)
    expect(answers[0].dispute.id).toBe(answers[1].dispute.id)
    expect(await disputesOf(providerRef)).toHaveLength(1)
    expect(await audits(answers[0].dispute.id)).toHaveLength(1)
    expect((await entitlement(target.a)).revoked_at).not.toBeNull()

    // A reference with no order has no lock to queue on: the unique key decides, and the loser is answered, not failed.
    for (let round = 0; round < 6; round += 1) {
      const reference = ref('FREE')
      const pair = await Promise.all([rec({ p_provider_ref: reference, p_amount: 100 }, h.pool[2]), rec({ p_provider_ref: reference, p_amount: 200 }, h.pool[3])])
      expect(pair.map((answer) => answer.ok), `round ${round}`).toEqual([true, true])
      expect(pair.filter((answer) => answer.duplicate).length, `round ${round}`).toBe(1)
      expect(pair[0].dispute.id).toBe(pair[1].dispute.id)
      expect(await disputesOf(reference), `round ${round}`).toHaveLength(1)
    }
    // Two follow-ups to the same row, at once: one is seq 2, the other is told so.
    const chain = ref('FOLLOW')
    expect(await rec({ p_provider_ref: chain })).toMatchObject({ ok: true })
    const follows = await Promise.all([rec({ p_provider_ref: chain, p_follows: 1, p_amount: 10 }, h.pool[4]), rec({ p_provider_ref: chain, p_follows: 1, p_amount: 20 }, h.pool[5])])
    expect(follows.filter((answer) => answer.duplicate).length).toBe(1)
    expect((await disputesOf(chain)).map((row) => row.seq)).toEqual([1, 2])
  })

  it('a follow-up needs its predecessor and may change the outcome: rows are appended, seq by seq, and none is ever edited', async () => {
    const providerRef = ref('CHAIN')
    const opened = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: mixed.attemptId, p_amount: 3000 })
    const lost = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 1, p_attempt: mixed.attemptId, p_amount: 3000, p_direction: 'against_seller', p_resolution: 'خسرنا النزاع', p_occurred_on: '2026-10-01' })
    const penalty = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 2, p_attempt: mixed.attemptId, p_amount: 50, p_direction: 'against_seller', p_resolution: 'رسوم النزاع', p_occurred_on: '2026-10-02' })
    expect([opened, lost, penalty].map((answer) => answer.dispute.seq)).toEqual([1, 2, 3])
    const rows = await disputesOf(providerRef)
    expect(rows.map((row) => [row.seq, row.amount_halalas, row.resolution])).toEqual([[1, 3000, null], [2, 3000, 'خسرنا النزاع'], [3, 50, 'رسوم النزاع']])
    expect(new Set(rows.map((row) => row.id)).size).toBe(3)
    // The same text under another kind, or in the other mode, is another reference.
    expect(await rec({ p_provider_ref: providerRef })).toMatchObject({ ok: true, dispute: { seq: 1, kind: 'fee_difference' } })
  })

  it('a reference of the other mode is refused, never answered as a repeat of it', async () => {
    const providerRef = ref('MODE')
    expect(await rec({ p_provider_ref: providerRef, p_environment: 'live' })).toMatchObject({ ok: true, duplicate: false })
    expect(await rec({ p_provider_ref: providerRef, p_environment: 'test' })).toEqual({ ok: false, code: 'REFERENCE_IN_USE' })
    expect(await rec({ p_provider_ref: providerRef, p_follows: 1, p_environment: 'test' })).toEqual({ ok: false, code: 'NO_PREDECESSOR' })
    expect(await rec({ p_provider_ref: providerRef, p_environment: 'live' })).toMatchObject({ ok: true, duplicate: true })
    expect(await rec({ p_provider_ref: providerRef, p_follows: 1, p_environment: 'live' })).toMatchObject({ ok: true, duplicate: false, dispute: { seq: 2, environment: 'live' } })
    expect((await disputesOf(providerRef)).map((row) => row.environment)).toEqual(['live', 'live'])
  })

  it('entitlement_revoked revokes the named items\' entitlements: a download that was issued before it is closed, a new one is refused, the other item is untouched', async () => {
    const target = await order()
    const first = await issue(target.p, target.a)
    expect(first.reply).toMatchObject({ ok: true })
    const second = await issue(target.p, target.a)
    expect(await redeem(first.tokenHash)).toMatchObject({ ok: true, mime: 'application/pdf' })
    const bystander = await issue(target.p, target.b)
    expect(bystander.reply).toMatchObject({ ok: true })

    const reply = await rec({
      p_kind: 'chargeback',
      p_provider_ref: ref('REVOKE'),
      p_attempt: target.p.attemptId,
      p_decision: 'entitlement_revoked',
      p_item_ids: uuids([target.a]),
    })
    expect(reply).toMatchObject({ ok: true, duplicate: false, dispute: { decision: 'entitlement_revoked', itemIds: [target.a] } })
    expect(await entitlement(target.a)).toMatchObject({ revoke_reason: 'dispute' })
    expect((await entitlement(target.a)).revoked_at).not.toBeNull()
    // The token already used and the one never used are both closed, and no new one can be issued.
    expect(await redeem(first.tokenHash)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await redeem(second.tokenHash)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect((await issue(target.p, target.a)).reply).toEqual({ ok: false, code: 'NOT_FOUND' })
    // The item that was not named is as it was.
    expect((await entitlement(target.b)).revoked_at).toBeNull()
    expect(await redeem(bystander.tokenHash)).toMatchObject({ ok: true })
    expect((await issue(target.p, target.b)).reply).toMatchObject({ ok: true })
    // An entitlement already revoked keeps its first reason when a later dispute names it again.
    const revokedAt = (await entitlement(target.a)).revoked_at
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: ref('REVOKE'), p_attempt: target.p.attemptId, p_decision: 'entitlement_revoked', p_item_ids: uuids([target.a, target.b]) }),
    ).toMatchObject({ ok: true })
    expect(await entitlement(target.a)).toMatchObject({ revoked_at: revokedAt, revoke_reason: 'dispute' })
    expect((await entitlement(target.b)).revoked_at).not.toBeNull()
  })

  it('a refund still revokes through the same helper: an unallocated full refund revokes every entitlement and keeps its own reason', async () => {
    const target = await order()
    await h.refundFully(target.p, owner.userId)
    const revoked = await h.rows('select revoked_at is not null as revoked, revoke_reason from finance.entitlements where order_id = $1', [target.p.id])
    expect(revoked).toEqual([{ revoked: true, revoke_reason: 'refund' }, { revoked: true, revoke_reason: 'refund' }])
  })

  it('fulfillment_stopped needs named items still being prepared, and stops their shipping until a later row of the dispute lifts it', async () => {
    const target = await order()
    // Operations work the orders through their own session; the order screen's flag is for them too.
    const staff = await signIn(operations.email)
    const rpc = async (fn: string, args: Record<string, unknown> = {}): Promise<any> => {
      const { data, error } = await staff.rpc(fn, args)
      expect(error, `${fn}: ${JSON.stringify(error)}`).toBeNull()
      return data
    }
    const ship = (): Promise<any> =>
      rpc('fulfillment_update', { p_order: target.p.id, p_item_ids: [target.physical], p_state: 'shipped', p_carrier: 'SMSA', p_tracking: 'T-2', p_dedication_done: null })
    const linesToShip = async (): Promise<number> => (await h.row('select finance.order_lines_to_ship($1) as n', [target.p.id])).n as number
    const listed = async (): Promise<boolean> =>
      ((await rpc('orders_list', { p_filter: 'to_ship', p_query: target.p.number, p_before: null, p_limit: 50 })).rows as Row[]).some((row) => row.id === target.p.id)
    const toShip = async (): Promise<number> => (await rpc('orders_alerts')).toShip as number
    const stopped = async (): Promise<unknown> =>
      ((await rpc('order_detail', { p_order: target.p.id })).items as Row[]).find((entry) => entry.id === target.physical)!.stopped
    expect(await linesToShip()).toBe(1)
    expect(await listed()).toBe(true)
    expect(await stopped()).toBe(false)
    const shipping = await toShip()
    const before = await snapshot(target.p)

    const providerRef = ref('STOP')
    const reply = await rec({
      p_kind: 'chargeback',
      p_provider_ref: providerRef,
      p_attempt: target.p.attemptId,
      p_decision: 'fulfillment_stopped',
      p_item_ids: uuids([target.physical]),
    })
    expect(reply).toMatchObject({ ok: true, dispute: { decision: 'fulfillment_stopped', itemIds: [target.physical] } })
    // Recording it writes nothing of the order: the item is still being prepared, and nothing else changed.
    expect(await snapshot(target.p)).toEqual(before)
    // But it is not shipped while the dispute says so, and no list counts it as to ship.
    expect(await ship()).toEqual({ ok: false, code: 'FULFILLMENT_STOPPED', itemIds: [target.physical] })
    expect(await snapshot(target.p)).toEqual(before)
    expect(await linesToShip()).toBe(0)
    expect(await listed()).toBe(false)
    expect(await toShip()).toBe(shipping - 1)
    // Operations see why on the order screen; the disputes themselves stay the owner's.
    expect(await stopped()).toBe(true)
    expect('disputes' in (await rpc('order_detail', { p_order: target.p.id }))).toBe(false)

    // A later row of the same dispute with another decision lifts it: the item is to ship again, and ships.
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 1, p_attempt: target.p.attemptId, p_direction: 'for_seller', p_decision: 'none' }),
    ).toMatchObject({ ok: true, dispute: { seq: 2, decision: 'none' } })
    expect(await stopped()).toBe(false)
    expect(await linesToShip()).toBe(1)
    expect(await listed()).toBe(true)
    expect(await toShip()).toBe(shipping)
    expect(await ship()).toEqual({ ok: true, changed: 1, itemIds: [target.physical] })
    expect((await fulfilment(target.physical)).state).toBe('shipped')
    // Once it has shipped, it is no longer something to stop.
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: ref('STOP'), p_attempt: target.p.attemptId, p_decision: 'fulfillment_stopped', p_item_ids: uuids([target.physical]) }),
    ).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    await h.postgres.query("update finance.fulfillments set state = 'delivered', delivered_at = now() where order_item_id = $1", [target.physical])
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: ref('STOP'), p_attempt: target.p.attemptId, p_decision: 'fulfillment_stopped', p_item_ids: uuids([target.physical]) }),
    ).toEqual({ ok: false, code: 'INVALID_ITEMS' })
  })

  it('entitlement_kept and none only record: nothing of the order changes', async () => {
    const target = await order()
    const before = await snapshot(target.p)
    const entitlements = await h.rows('select * from finance.entitlements where order_id = $1 order by id', [target.p.id])
    for (const decision of ['none', 'entitlement_kept']) {
      expect(await rec({ p_kind: 'chargeback', p_provider_ref: ref('KEEP'), p_attempt: target.p.attemptId, p_decision: decision })).toMatchObject({ ok: true, dispute: { decision } })
    }
    expect(await snapshot(target.p)).toEqual(before)
    expect(await h.rows('select * from finance.entitlements where order_id = $1 order by id', [target.p.id])).toEqual(entitlements)
  })

  it('entitlement_kept after entitlement_revoked gives back what the dispute revoked: the download works again, but not for an item refunded in full meanwhile', async () => {
    const target = await order()
    const chargeback = { p_kind: 'chargeback', p_provider_ref: ref('KEPT'), p_attempt: target.p.attemptId }
    expect(await rec({ ...chargeback, p_decision: 'entitlement_revoked', p_item_ids: uuids([target.a, target.b]) })).toMatchObject({ ok: true })
    expect((await issue(target.p, target.a)).reply).toEqual({ ok: false, code: 'NOT_FOUND' })
    // Won by the seller (which lets a refund through again), and the buyer is refunded one of the two books in full.
    expect(await rec({ ...chargeback, p_follows: 1, p_direction: 'for_seller', p_resolution: 'ربحنا النزاع' })).toMatchObject({ ok: true, dispute: { seq: 2 } })
    const b = target.p.items.find((entry) => entry.id === target.b)!
    const key = randomUUID()
    const asked = await h.call('refund_request', {
      p_actor: owner.userId,
      p_order: target.p.id,
      p_attempt: target.p.attemptId,
      p_review_payment: null,
      p_amount: b.paid,
      p_reason: 'استرداد كتاب',
      p_allocation: { items: [{ itemId: b.id, amount: b.paid }] },
      p_idempotency_key: key,
      p_request_hash: sha256(`hash:${key}`),
      p_return: null,
      p_provider_refunded: 0,
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
    expect(await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: b.paid, p_error: null })).toMatchObject({
      ok: true,
      status: 'succeeded',
    })

    // The files are kept after all: the one revoked for the dispute comes back, the one refunded in full stays revoked.
    const kept = await rec({ ...chargeback, p_follows: 2, p_direction: 'for_seller', p_decision: 'entitlement_kept' })
    expect(kept).toMatchObject({ ok: true, duplicate: false, dispute: { seq: 3, decision: 'entitlement_kept', itemIds: [] } })
    expect(await entitlement(target.a)).toMatchObject({ revoked_at: null, revoke_reason: null })
    expect((await issue(target.p, target.a)).reply).toMatchObject({ ok: true })
    expect(await entitlement(target.b)).toMatchObject({ revoke_reason: 'dispute' })
    expect((await entitlement(target.b)).revoked_at).not.toBeNull()
    expect((await issue(target.p, target.b)).reply).toEqual({ ok: false, code: 'NOT_FOUND' })
    const rows = await audits(kept.dispute.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.summary).toEqual({ reference: chargeback.p_provider_ref, amount: 1000, kind: 'chargeback', decision: 'entitlement_kept', restored: 1 })
    // A repeat of the row answers it and gives nothing back twice.
    const restoredAt = await entitlement(target.a)
    expect(await rec({ ...chargeback, p_follows: 2, p_direction: 'for_seller', p_decision: 'entitlement_kept' })).toMatchObject({ ok: true, duplicate: true })
    expect(await entitlement(target.a)).toEqual(restoredAt)
    expect(await audits(kept.dispute.id)).toHaveLength(1)
  })

  it('never creates a refund and never changes an attempt, an order\'s status or stock, whatever it records', async () => {
    const target = await order()
    const refundsBefore = await h.count('select count(*)::int as n from finance.refunds')
    const before = await snapshot(target.p)
    const kinds: Array<Record<string, unknown>> = [
      { p_kind: 'chargeback', p_attempt: target.p.attemptId, p_amount: target.p.total, p_decision: 'entitlement_revoked', p_item_ids: uuids([target.a, target.b]) },
      { p_kind: 'chargeback', p_attempt: target.p.attemptId, p_amount: target.p.total, p_decision: 'fulfillment_stopped', p_item_ids: uuids([target.physical]) },
      { p_kind: 'other', p_attempt: target.p.attemptId, p_amount: 100 },
      { p_kind: 'fee_difference', p_attempt: target.p.attemptId, p_amount: 100 },
    ]
    for (const over of kinds) expect(await rec({ p_provider_ref: ref('SAFE'), ...over }), String(over.p_kind)).toMatchObject({ ok: true })
    const after = await snapshot(target.p)
    expect(after.attempt).toEqual(before.attempt)
    expect(after.order).toEqual(before.order)
    expect(after.stock).toEqual(before.stock)
    expect(after.reservations).toEqual(before.reservations)
    expect(after.fulfilments).toEqual(before.fulfilments)
    expect(after.refunds).toBe(0)
    expect(after.mail).toBe(before.mail)
    expect(await h.count('select count(*)::int as n from finance.refunds')).toBe(refundsBefore)
    expect((await h.row('select status from finance.orders where id = $1', [target.p.id])).status).toBe('paid')
  })

  it('a review payment is a target too, with its order or without one; the dispute names the payment, not an attempt', async () => {
    const target = await order()
    const second = await secondPayment(target.p)
    const providerRef = ref('REVIEW')
    const reply = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_review_payment: second, p_amount: target.p.total })
    expect(reply).toMatchObject({ ok: true, dispute: { reviewPaymentId: second, attemptId: null } })
    expect(await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_follows: 1, p_review_payment: second, p_amount: target.p.total, p_direction: 'for_seller' })).toMatchObject({
      ok: true,
      dispute: { seq: 2, reviewPaymentId: second },
    })
    // Its order's items can be named, and an entitlement of the order it belongs to is what is revoked.
    expect(
      await rec({ p_kind: 'chargeback', p_provider_ref: ref('REVIEW'), p_review_payment: second, p_decision: 'entitlement_revoked', p_item_ids: uuids([target.a]) }),
    ).toMatchObject({ ok: true })
    expect((await entitlement(target.a)).revoked_at).not.toBeNull()
    // The attempt itself and the order are as they were: a dispute never touches them.
    expect((await h.row('select status from finance.payment_attempts where id = $1', [target.p.attemptId])).status).toBe('paid')
    // A review payment that has no order: recorded, with no item to name.
    const unmapped = await unmappedReview()
    expect(await rec({ p_kind: 'chargeback', p_review_payment: unmapped, p_amount: 800, p_decision: 'entitlement_kept' })).toMatchObject({ ok: true, dispute: { reviewPaymentId: unmapped } })
    // The other mode's review payment is not found.
    expect(await rec({ p_kind: 'other', p_review_payment: unmapped, p_environment: 'live' })).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('is append-only for everyone: an update and a delete are refused, even for the migration role, and the row is as it was', async () => {
    const reply = await rec({ p_provider_ref: ref('LOCKED') })
    const id = reply.dispute.id as string
    const stored = await h.row('select * from finance.disputes where id = $1', [id])
    for (const statement of [
      "update finance.disputes set reason = 'تعديل' where id = $1",
      'update finance.disputes set amount_halalas = amount_halalas + 1 where id = $1',
      "update finance.disputes set resolution = 'x' where id = $1",
      'delete from finance.disputes where id = $1',
    ]) {
      expect(await sqlstate(h.postgres.query(statement, [id])), statement).toBe('42501')
    }
    expect(await h.row('select * from finance.disputes where id = $1', [id])).toEqual(stored)
    // An update of the whole table is refused row by row too.
    expect(await sqlstate(h.postgres.query("update finance.disputes set reason = reason where provider_ref = $1", [stored.provider_ref]))).toBe('42501')
  })

  it('audits dispute.recorded with the reference, the amount, the kind and the decision, and none of the text anyone typed; a repeat or a refusal audits nothing', async () => {
    const target = await order()
    const providerRef = ref('AUDIT')
    const reason = 'نص حر يحتوي اسم المشتري سعد'
    const resolution = 'حل حر يحتوي رقم هاتف 0501234567'
    const reply = await rec({
      p_kind: 'chargeback',
      p_provider_ref: providerRef,
      p_attempt: target.p.attemptId,
      p_amount: 2750,
      p_reason: reason,
      p_resolution: resolution,
      p_decision: 'entitlement_revoked',
      p_item_ids: uuids([target.a]),
    })
    const rows = await audits(reply.dispute.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor: owner.userId, action: 'dispute.recorded', entity: 'dispute', entity_id: reply.dispute.id })
    expect(rows[0]!.summary).toEqual({ reference: providerRef, amount: 2750, kind: 'chargeback', decision: 'entitlement_revoked' })
    const text = JSON.stringify(rows[0])
    for (const secret of [reason, resolution, 'سعد', '0501234567', target.p.number, target.p.email, target.a]) expect(text).not.toContain(secret)
    // A repeat and a refusal write no second row.
    const auditsBefore = await h.count("select count(*)::int as n from public.audit_events where action = 'dispute.recorded'")
    await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: target.p.attemptId })
    await rec({ p_kind: 'chargeback', p_attempt: randomUUID() })
    expect(await sqlstate(rec({ p_provider_ref: ref('BAD'), p_amount: 0 }))).toBe('22023')
    expect(await h.count("select count(*)::int as n from public.audit_events where action = 'dispute.recorded'")).toBe(auditsBefore)
  })
})

// --- disputes_list ---------------------------------------------------------------------------------------------------

describe('disputes_list', () => {
  let ownerDb: Awaited<ReturnType<typeof staffDb>>
  let outsiders: Array<[string, ReturnType<typeof anonClient>]>
  let opsClient: Awaited<ReturnType<typeof signIn>>

  beforeAll(async () => {
    ownerDb = await staffDb(owner.userId)
    const operations = await h.makeStaff('operations')
    const editor = await h.makeStaff('editor')
    const revoked = await h.makeStaff('owner', { active: false })
    const inactive = await h.makeStaff('operations', { active: false })
    opsClient = await signIn(operations.email)
    outsiders = [
      ['anon', anonClient()],
      ['operations', opsClient],
      ['an editor', await signIn(editor.email)],
      ['a revoked owner', await signIn(revoked.email)],
      ['an inactive operations member', await signIn(inactive.email)],
    ]
  })
  afterAll(async () => {
    await ownerDb.end()
  })

  const list = async (): Promise<{ references: Array<{ kind: string; providerRef: string; rows: Row[] }> }> =>
    (await pgRpc(ownerDb)('disputes_list', {})) as { references: Array<{ kind: string; providerRef: string; rows: Row[] }> }
  const mine = async (): Promise<Array<{ kind: string; providerRef: string; rows: Row[] }>> =>
    (await list()).references.filter((entry) => entry.providerRef.startsWith(PREFIX))

  it('is the owner\'s alone: anon, operations, an editor, a revoked owner and an inactive member are refused', async () => {
    for (const [who, client] of outsiders) {
      const { data, error } = await client.rpc('disputes_list')
      expect(error?.code, who).toBe('42501')
      expect(data, who).toBeNull()
    }
    const reply = await ownerDb.query('select public.disputes_list() as r')
    expect(Object.keys(reply.rows[0].r)).toEqual(['references'])
  })

  it('answers every reference with its rows in seq order, the newest reference first, with the order number of its target', async () => {
    const target = await h.paid([{ variantId: await h.digital(3000), quantity: 1 }])
    const older = ref('LIST-OLDER')
    const middle = ref('LIST-MIDDLE')
    const newest = ref('LIST-NEWEST')
    expect(await rec({ p_kind: 'chargeback', p_provider_ref: older, p_attempt: target.attemptId, p_amount: 900 })).toMatchObject({ ok: true })
    expect(await rec({ p_provider_ref: middle, p_amount: 100 })).toMatchObject({ ok: true })
    expect(await rec({ p_provider_ref: newest, p_amount: 300, p_environment: 'live' })).toMatchObject({ ok: true })
    // The oldest reference gets two more rows, after the newest was recorded: the order is by the reference's first row, not its latest.
    for (const follows of [1, 2]) {
      expect(await rec({ p_kind: 'chargeback', p_provider_ref: older, p_follows: follows, p_attempt: target.attemptId, p_amount: 900 - follows, p_direction: 'for_seller' })).toMatchObject({ ok: true })
    }
    // The three are the newest references of the whole list, in that order.
    const found = (await mine()).slice(0, 3)
    expect(found.map((entry) => entry.providerRef)).toEqual([newest, middle, older])
    expect(found.map((entry) => entry.kind)).toEqual(['fee_difference', 'fee_difference', 'chargeback'])
    const olderRows = found[2]!.rows
    expect(olderRows.map((row) => row.seq)).toEqual([1, 2, 3])
    expect(olderRows.map((row) => row.amount)).toEqual([900, 899, 898])
    expect(olderRows.every((row) => row.orderNumber === target.number && row.attemptId === target.attemptId)).toBe(true)
    // No order for a difference with no target; both modes are listed, each row with its own.
    expect(found[1]!.rows[0]).toMatchObject({ orderNumber: null, attemptId: null, environment: 'test' })
    expect(found[0]!.rows[0]).toMatchObject({ orderNumber: null, environment: 'live', amount: 300 })
  })

  it('shows a row the way order_detail shows it, with the order number added', async () => {
    const target = await h.paid([{ variantId: await h.digital(3100), quantity: 1 }])
    const providerRef = ref('LIST-SHAPE')
    const reply = await rec({ p_kind: 'chargeback', p_provider_ref: providerRef, p_attempt: target.attemptId, p_amount: 1500, p_resolution: 'قيد المراجعة' })
    const row = (await mine()).find((entry) => entry.providerRef === providerRef)!.rows[0]!
    const { orderNumber, ...rest } = row
    expect(orderNumber).toBe(target.number)
    expect(rest).toEqual(reply.dispute)
    const detail = (await pgRpc(ownerDb)('order_detail', { p_order: target.id })) as { disputes: Array<Record<string, unknown>> }
    expect(sorted(Object.keys(detail.disputes[0]!))).toEqual(sorted(Object.keys(rest)))
    expect(detail.disputes[0]).toEqual(rest)
  })

  it('the list of a review payment names its order when it has one', async () => {
    const target = await h.paid([{ variantId: await h.digital(3200), quantity: 1 }])
    const second = await secondPayment(target)
    const providerRef = ref('LIST-REVIEW')
    expect(await rec({ p_kind: 'other', p_provider_ref: providerRef, p_review_payment: second, p_amount: 400 })).toMatchObject({ ok: true })
    const row = (await mine()).find((entry) => entry.providerRef === providerRef)!.rows[0]!
    expect(row).toMatchObject({ reviewPaymentId: second, attemptId: null, orderNumber: target.number })
  })
})

// --- grants ----------------------------------------------------------------------------------------------------------

describe('grants', () => {
  const can = async (role: string, signature: string): Promise<boolean> =>
    (await h.row('select has_function_privilege($1, $2, $3) as ok', [role, signature, 'execute'])).ok as boolean
  const SERVICE = [
    'public.owner_commerce_stats(timestamptz, timestamptz, text)',
    'public.dispute_record(uuid, text, text, integer, uuid, text, integer, text, date, text, text, text, uuid[], text)',
  ]
  const PRIVACY = ['public.privacy_buyer_export(text)', 'public.privacy_buyer_erase(text)']
  const HELPERS = [
    'finance.entitlements_revoke(uuid, uuid[], text)',
    'finance.order_erasable(finance.orders)',
    'finance.orders_delete(uuid[])',
    'finance.buyer_address(text)',
    'finance.dispute_json(finance.disputes)',
    'finance.dispute_place(text, text, integer, text)',
    'finance.refund_succeed(uuid, integer, uuid, text)',
    'finance.buyer_retention_purge()',
  ]
  const definer = async (signature: string): Promise<void> => {
    const meta = await h.row('select p.prosecdef, p.proconfig, p.proacl is not null as has_acl, (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_entries from pg_proc p where p.oid = $1::regprocedure', [signature])
    expect(meta.prosecdef, signature).toBe(true)
    expect(meta.proconfig, signature).toContain('search_path=""')
    expect({ has_acl: meta.has_acl, public_entries: meta.public_entries }, signature).toEqual({ has_acl: true, public_entries: 0 })
  }

  it.each(SERVICE)('%s: service_role only, security definer, search_path empty', async (signature) => {
    expect(await can('service_role', signature)).toBe(true)
    expect(await can('authenticated', signature)).toBe(false)
    expect(await can('anon', signature)).toBe(false)
    await definer(signature)
  })

  it('public.disputes_list(): signed-in staff (the owner rechecked inside), never anon, security definer, search_path empty', async () => {
    expect(await can('authenticated', 'public.disputes_list()')).toBe(true)
    expect(await can('anon', 'public.disputes_list()')).toBe(false)
    await definer('public.disputes_list()')
  })

  it.each(PRIVACY)('%s: no API role can call it, the service role included, and the migration role can', async (signature) => {
    for (const role of ['anon', 'authenticated', 'service_role']) expect(await can(role, signature), `${role} ${signature}`).toBe(false)
    await definer(signature)
  })

  it.each(HELPERS)('%s: no API role at all, the service role included', async (signature) => {
    for (const role of ['authenticated', 'anon', 'service_role']) expect(await can(role, signature), `${role} ${signature}`).toBe(false)
  })
})
