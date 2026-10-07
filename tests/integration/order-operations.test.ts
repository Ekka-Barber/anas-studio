// P08 round 7b: the staff's order operations of
// `supabase/migrations/20261002145000_order_operations.sql` against the real local
// database: `orders_list`, `order_detail`, `fulfillment_update`, `return_decide`,
// `return_receive`, `order_resolve`, `orders_alerts`, `reconciliation_list` and
// `review_close`. They are granted to `authenticated` and recheck the caller's role
// inside, so they are called as signed-in staff: through the Data API (one session
// per role, for the refusals) and through direct `authenticated` sessions with the
// member's claims (the behaviour, and the races, which need two live connections).
// Orders go through `checkout_create` and are paid by `apply_verified_payment`
// (the shared fixtures of `support.ts`); the server-only functions the fixtures need
// (refunds, a review payment, an event) are called as `service_role`. What only the
// database could write (a shipped item, a lowered stock, an aged invoice) is written
// as the local `postgres` superuser, which also holds a row lock so that calls
// started behind it race for the same row the moment it is freed. Nothing here
// reaches Moyasar or sends a mail. This file switches
// `finance.commerce_settings.checkout_enabled` on, saved and restored by the
// fixtures; every fixture carries a per-run unique slug, SKU, email or payment id.
import { createHash, randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  anonClient,
  commerceHarness,
  type Harness,
  type Line,
  type Paid,
  type PaidItem,
  pgRpc,
  type Row,
  settledWithin,
  sha256,
  signIn,
  staffDb,
  uniqueEmail,
} from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const PEPPER = `order-operations-pepper-${randomUUID()}`
const PREFIX = `p08r7b-${Date.now()}-${process.pid}-`
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }
const keys = (value: object): string[] => Object.keys(value).sort()
/** The object has exactly these keys (in any order). */
const sameKeys = (value: object, names: string[]): void => expect(keys(value)).toEqual([...names].sort())
const uuids = (ids: string[]): string => `{${ids.join(',')}}`
const md5 = (text: string): string => createHash('md5').update(text).digest('hex')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const sorted = (ids: string[]): string[] => [...ids].sort()
const idsOf = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id)
const REVIEW_REASON = 'عكسها البنك'

type Member = { userId: string; email: string }
let h: Harness
let owner: Member
let operations: Member
let editor: Member
let revokedOwner: Member
let inactiveOperations: Member
let ownerDb: Client
let opsDb: Client
const sessions: Client[] = []
/** Orders written straight into the table by the paging test: no item, no attempt, so they can be deleted. */
const bulk: string[] = []
let eventCounter = 0

async function session(member: Member): Promise<Client> {
  const db = await staffDb(member.userId)
  sessions.push(db)
  return db
}

/** The nine functions as one signed-in staff session calls them (a direct session: `uuid[]` goes in as an array literal). */
function api(db: Client) {
  const call = (fn: string, args: Record<string, unknown>): Promise<any> => pgRpc(db)(fn, args) as Promise<any>
  return {
    list: (filter = 'all', query: string | null = null, before: string | null = null, limit: number | null = 50) =>
      call('orders_list', { p_filter: filter, p_query: query, p_before: before, p_limit: limit }),
    detail: (order: string | null) => call('order_detail', { p_order: order }),
    fulfil: (order: string, items: string[], state: string, carrier: string | null = null, tracking: string | null = null, dedication: boolean | null = null) =>
      call('fulfillment_update', { p_order: order, p_item_ids: uuids(items), p_state: state, p_carrier: carrier, p_tracking: tracking, p_dedication_done: dedication }),
    correct: (order: string, items: string[], carrier: string | null, tracking: string | null) =>
      call('fulfillment_correct', { p_order: order, p_item_ids: uuids(items), p_carrier: carrier, p_tracking: tracking }),
    decide: (id: string, decision: string, note: string | null = null) => call('return_decide', { p_return: id, p_decision: decision, p_note: note }),
    receive: (id: string, restock: unknown = []) => call('return_receive', { p_return: id, p_restock: restock }),
    resolve: (order: string) => call('order_resolve', { p_order: order }),
    alerts: () => call('orders_alerts', {}),
    recon: () => call('reconciliation_list', {}),
    close: (payment: string, reason: string) => call('review_close', { p_payment: payment, p_reason: reason }),
    dismiss: (event: string) => call('event_dismiss', { p_event: event }),
  }
}
type StaffApi = ReturnType<typeof api>
let ownerApi: StaffApi
let opsApi: StaffApi

/** The SQLSTATE a call raised, or undefined when it did not raise. */
async function sqlstate(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

beforeAll(async () => {
  h = await commerceHarness(PEPPER, 8)
  owner = await h.makeStaff('owner')
  operations = await h.makeStaff('operations')
  editor = await h.makeStaff('editor')
  revokedOwner = await h.makeStaff('owner', { active: false })
  inactiveOperations = await h.makeStaff('operations', { active: false })
  ownerDb = await session(owner)
  opsDb = await session(operations)
  ownerApi = api(ownerDb)
  opsApi = api(opsDb)
})

afterAll(async () => {
  for (const db of sessions) await db.end()
  await h.postgres.query('delete from finance.orders where id = any($1::uuid[])', [bulk])
  await h.postgres.query('delete from finance.payment_events where event_id like $1', [`${PREFIX}%`])
  await h.postgres.query("delete from finance.email_outbox where payload ->> 'eventId' like $1", [`${PREFIX}%`])
  await h.stop()
})

// --- fixtures ---------------------------------------------------------------------------------------------------

const stockOf = async (variantId: string): Promise<number | null> => (await h.row('select stock from public.product_variants where id = $1', [variantId])).stock
const orderOf = (id: string): Promise<Row> => h.row('select * from finance.orders where id = $1', [id])
const fulfilmentOf = (itemId: string): Promise<Row> => h.row('select * from finance.fulfillments where order_item_id = $1', [itemId])
const returnOf = (id: string): Promise<Row> => h.row('select * from finance.return_requests where id = $1', [id])
const reservationOf = (orderId: string, variantId: string): Promise<Row> =>
  h.row('select * from finance.inventory_reservations where order_id = $1 and variant_id = $2', [orderId, variantId])
const mailsOf = (orderId: string, kind: string): Promise<Row[]> =>
  h.rows("select * from finance.email_outbox where kind = $2 and payload ->> 'orderId' = $1 order by id", [orderId, kind])
const auditsOf = (action: string, entityId: string): Promise<Row[]> =>
  h.rows('select * from public.audit_events where action = $1 and entity_id = $2 order by id', [action, entityId])
const count = (table: string, orderId: string): Promise<number> => h.count(`select count(*)::int as n from ${table} where order_id = $1`, [orderId])
const reviewOpen = async (paymentId: string): Promise<boolean> =>
  (await h.row('select closed_at is null as open from finance.payment_reviews where provider_payment_id = $1', [paymentId])).open as boolean

const itemsOf = async (orderId: string): Promise<PaidItem[]> =>
  (
    await h.rows(
      'select id, variant_id, fulfillment, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1 order by line_no',
      [orderId],
    )
  ).map((item) => ({ id: item.id as string, variantId: item.variant_id as string, fulfillment: item.fulfillment as string, paid: Number(item.paid) }))

const markShipped = (itemId: string): Promise<unknown> =>
  h.postgres.query(
    "update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = $2, shipped_at = now() where order_item_id = $1",
    [itemId, `TRK-${itemId.slice(0, 8)}`],
  )

/** An order that was paid when the stock of `empty` variants was gone: placed, invoiced, the stock emptied, then paid. */
async function stuck(lines: Line[], empty: string[], opts: { email?: string } = {}): Promise<Paid> {
  const placed = await h.place(lines, opts)
  const started = await h.startPayment(placed)
  for (const variantId of empty) await h.postgres.query('update public.product_variants set stock = 0 where id = $1', [variantId])
  const applied = await h.applyPayment(placed, started)
  expect(applied, JSON.stringify(applied)).toMatchObject({ outcome: 'paid_needs_resolution' })
  return { ...placed, ...started, items: await itemsOf(placed.id) }
}

/** A second charged payment on a paid order's invoice: a review payment, open until someone settles it. */
async function reviewOf(p: Paid): Promise<string> {
  const paymentId = randomUUID()
  const reply = await h.applyPayment(p, { invoiceId: p.invoiceId, paymentId })
  expect(reply, JSON.stringify(reply)).toMatchObject({ outcome: 'review', reason: 'SECOND_PAYMENT' })
  return paymentId
}

/** What the provider's fetched payment says about a paid order's own payment (a dashboard refund, a void). */
const fetched = (p: Paid, over: { status?: string; refunded?: number }): Promise<any> =>
  h.call('apply_verified_payment', {
    p_invoice_id: p.invoiceId,
    p_payment: { id: p.paymentId, status: over.status ?? 'paid', amount: p.total, currency: 'SAR', fee: 150, refunded: over.refunded ?? 0, invoiceId: p.invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
    p_invoice: { id: p.invoiceId, status: 'paid', amount: p.total, currency: 'SAR' },
    p_mode: 'test',
    p_live: null,
    p_event_id: null,
  })

type Part = { item: PaidItem; amount: number }
/** A refund of items of a paid order, requested (balance reserved) but not yet confirmed. */
async function askRefund(p: Paid, parts: Part[], shipping = 0): Promise<{ refundId: string; before: number; amount: number }> {
  const amount = parts.reduce((sum, part) => sum + part.amount, 0) + shipping
  const before = Number((await h.row("select coalesce(sum(amount_halalas), 0) as n from finance.refunds where attempt_id = $1 and status = 'succeeded'", [p.attemptId])).n)
  const key = randomUUID()
  const asked = await h.call('refund_request', {
    p_actor: owner.userId,
    p_order: p.id,
    p_attempt: p.attemptId,
    p_review_payment: null,
    p_amount: amount,
    p_reason: 'استرداد',
    p_allocation: { items: parts.map((part) => ({ itemId: part.item.id, amount: part.amount })), ...(shipping > 0 ? { shipping } : {}) },
    p_idempotency_key: key,
    p_request_hash: sha256(`hash:${key}`),
    p_return: null,
    p_provider_refunded: before,
  })
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
  return { refundId: asked.refundId as string, before, amount }
}
const confirmRefund = async (asked: { refundId: string; before: number; amount: number }, client?: Client): Promise<any> =>
  h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: asked.before + asked.amount, p_error: null }, client)
/** Refunds the whole price of items of a paid order (not the shipping), confirmed. */
async function refundItems(p: Paid, items: PaidItem[]): Promise<string> {
  const asked = await askRefund(p, items.map((item) => ({ item, amount: item.paid })))
  const done = await confirmRefund(asked)
  expect(done, JSON.stringify(done)).toMatchObject({ ok: true, status: 'succeeded' })
  return asked.refundId
}

/** A buyer's return request for items that are marked shipped first; answers the return's id. */
async function requestReturn(p: Paid, items: Array<{ itemId: string; quantity: number }>): Promise<string> {
  for (const entry of items) await markShipped(entry.itemId)
  const reply = await h.call('return_request_create', {
    p_order_number: p.number,
    p_access_token_hash: p.hash,
    p_items: items,
    p_reason: 'سبب الإرجاع',
    p_ip_hash: h.ipHash(),
    p_mode: 'test',
  })
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true })
  return reply.returnId as string
}
const approve = (id: string): Promise<unknown> => h.postgres.query("update finance.return_requests set state = 'approved' where id = $1", [id])

/**
 * Holds the order's row, starts the calls one after the other behind it (so they queue in that order), then frees the
 * row and settles them all: what two staff connections do when they reach the same order together.
 */
async function race(orderId: string, calls: Array<() => Promise<unknown>>): Promise<Array<PromiseSettledResult<any>>> {
  const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [orderId])
  const running: Array<Promise<unknown>> = []
  try {
    for (const start of calls) {
      const call = start()
      call.catch(() => undefined)
      running.push(call)
      await sleep(250)
    }
  } finally {
    await lock.release()
  }
  return Promise.allSettled(running)
}
const fulfilledValue = (result: PromiseSettledResult<any>): any => {
  expect(result.status, JSON.stringify(result)).toBe('fulfilled')
  return (result as PromiseFulfilledResult<any>).value
}

/** Runs `run` while the order's row is held elsewhere: it must wait (the order's lock is the first it takes). */
async function behindOrderLock(orderId: string, run: () => Promise<any>): Promise<any> {
  const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [orderId])
  const running = run()
  running.catch(() => undefined)
  let waited: unknown
  try {
    waited = await settledWithin(running, 900)
  } finally {
    await lock.release()
  }
  expect(waited).toBe('blocked')
  return running
}

// --- grants ---------------------------------------------------------------------------------------------------------

const NINE = [
  'public.orders_list(text, text, timestamptz, integer)',
  'public.order_detail(uuid)',
  'public.fulfillment_update(uuid, uuid[], text, text, text, boolean)',
  'public.fulfillment_correct(uuid, uuid[], text, text)',
  'public.return_decide(uuid, text, text)',
  'public.return_receive(uuid, jsonb)',
  'public.order_resolve(uuid)',
  'public.orders_alerts()',
  'public.reconciliation_list()',
  'public.review_close(text, text)',
  'public.event_dismiss(text)',
]
const HELPERS = [
  'finance.require_staff(boolean)',
  'finance.order_lines_to_ship(uuid)',
  'finance.order_refunded_total(uuid)',
  'finance.attempt_refunds_confirmed(uuid)',
  'finance.attempt_refunds_known(uuid)',
  'finance.attempt_json(finance.payment_attempts)',
  'finance.review_json(finance.payment_reviews)',
  'finance.refund_json(finance.refunds)',
  'finance.event_json(finance.payment_events)',
  'finance.event_needs_person(finance.payment_events)',
  'finance.order_stopped_items(uuid)',
]

describe('grants', () => {
  const can = async (role: string, signature: string): Promise<boolean> =>
    (await h.row('select has_function_privilege($1, $2, $3) as ok', [role, signature, 'execute'])).ok as boolean

  it.each(NINE)('%s: authenticated only, security definer, search_path empty', async (signature) => {
    expect(await can('authenticated', signature)).toBe(true)
    expect(await can('anon', signature)).toBe(false)
    // Nothing for PUBLIC either: the default grant is gone, so the ACL exists and has no entry for grantee 0.
    const acl = await h.row(
      `select p.proacl is not null as has_acl,
              (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_entries
         from pg_proc p where p.oid = $1::regprocedure`,
      [signature],
    )
    expect(acl).toEqual({ has_acl: true, public_entries: 0 })
    const meta = await h.row('select p.prosecdef, p.proconfig from pg_proc p where p.oid = $1::regprocedure', [signature])
    expect(meta.prosecdef).toBe(true)
    expect(meta.proconfig).toContain('search_path=""')
  })

  it.each(HELPERS)('%s: no API role at all, the service role included', async (signature) => {
    for (const role of ['authenticated', 'anon', 'service_role']) expect(await can(role, signature), role).toBe(false)
  })
})

// --- who may call ----------------------------------------------------------------------------------------------------

describe('who may call', () => {
  let clients: Array<[string, SupabaseClient]>
  let shipOrder: Paid
  let returnsOrder: Paid
  let stuckOrder: Paid
  let reviewOrder: Paid
  let scarce: string
  let requested: string
  let approvedByOps: string
  let approvedForOwner: string
  let reviewPayment: string

  beforeAll(async () => {
    clients = [
      ['anon', anonClient()],
      ['an editor', await signIn(editor.email)],
      ['a revoked owner', await signIn(revokedOwner.email)],
      ['an inactive operations member', await signIn(inactiveOperations.email)],
    ]
    const variant = await h.physical(4000, 20)
    shipOrder = await h.paid([{ variantId: variant, quantity: 1 }])
    returnsOrder = await h.paid([{ variantId: variant, quantity: 3 }])
    const item = returnsOrder.items[0]!.id
    requested = await requestReturn(returnsOrder, [{ itemId: item, quantity: 1 }])
    approvedByOps = await requestReturn(returnsOrder, [{ itemId: item, quantity: 1 }])
    approvedForOwner = await requestReturn(returnsOrder, [{ itemId: item, quantity: 1 }])
    await approve(approvedByOps)
    await approve(approvedForOwner)
    scarce = await h.physical(3000, 5)
    stuckOrder = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    reviewOrder = await h.paid([{ variantId: variant, quantity: 1 }])
    reviewPayment = await reviewOf(reviewOrder)
  })

  const calls = (): Array<[string, Record<string, unknown>]> => [
    ['orders_list', { p_filter: 'all', p_query: null, p_before: null, p_limit: 5 }],
    ['order_detail', { p_order: shipOrder.id }],
    ['fulfillment_update', { p_order: shipOrder.id, p_item_ids: [shipOrder.items[0]!.id], p_state: 'shipped', p_carrier: 'SMSA', p_tracking: 'T1', p_dedication_done: null }],
    ['return_decide', { p_return: requested, p_decision: 'approved', p_note: null }],
    ['return_receive', { p_return: approvedForOwner, p_restock: [{ itemId: returnsOrder.items[0]!.id, quantity: 1 }] }],
    ['order_resolve', { p_order: stuckOrder.id }],
    ['orders_alerts', {}],
    ['reconciliation_list', {}],
    ['review_close', { p_payment: reviewPayment, p_reason: REVIEW_REASON }],
    ['event_dismiss', { p_event: 'no-such-event' }],
    ['fulfillment_correct', { p_order: shipOrder.id, p_item_ids: [shipOrder.items[0]!.id], p_carrier: 'SMSA', p_tracking: 'T1' }],
  ]

  it('refuses anon, an editor, a revoked owner and an inactive operations member on every one of the nine, and changes nothing', async () => {
    for (const [who, client] of clients) {
      for (const [fn, args] of calls()) {
        const { data, error } = await client.rpc(fn, args)
        expect(error?.code, `${who}: ${fn}`).toBe('42501')
        expect(data, `${who}: ${fn}`).toBeNull()
      }
    }
    // The state every refused write would have moved is as it was.
    expect((await fulfilmentOf(shipOrder.items[0]!.id)).state).toBe('preparing')
    expect((await returnOf(requested)).state).toBe('requested')
    expect((await returnOf(approvedForOwner)).state).toBe('approved')
    expect(await stockOf(returnsOrder.items[0]!.variantId)).toBe(20 - 1 - 3 - 1)
    expect((await orderOf(stuckOrder.id)).status).toBe('paid_needs_resolution')
    expect(await reviewOpen(reviewPayment)).toBe(true)
  })

  it('lets an operations member work the orders but refuses what is the owner\'s: resolving, the reconciliation, closing a review, restocking', async () => {
    const client = await signIn(operations.email)
    const [, , fulfil, decide, receive, resolve, , recon, close] = calls() as Array<[string, Record<string, unknown>]>
    for (const [fn, args] of [resolve!, recon!, close!, receive!] as Array<[string, Record<string, unknown>]>) {
      expect((await client.rpc(fn, args)).error?.code, `operations: ${fn}`).toBe('42501')
    }
    expect((await orderOf(stuckOrder.id)).status).toBe('paid_needs_resolution')
    expect(await reviewOpen(reviewPayment)).toBe(true)
    expect((await returnOf(approvedForOwner)).state).toBe('approved')
    expect(await stockOf(returnsOrder.items[0]!.variantId)).toBe(20 - 1 - 3 - 1)

    const list = await client.rpc('orders_list', { p_filter: 'all', p_query: null, p_before: null, p_limit: 5 })
    expect(list.error).toBeNull()
    expect((list.data as { rows: unknown[] }).rows.length).toBeGreaterThan(0)
    const detail = await client.rpc('order_detail', { p_order: shipOrder.id })
    expect(detail.error).toBeNull()
    expect((await client.rpc('orders_alerts')).error).toBeNull()

    const shipped = await client.rpc(fulfil![0], fulfil![1])
    expect(shipped.error).toBeNull()
    expect(shipped.data).toMatchObject({ ok: true, changed: 1 })
    expect((await fulfilmentOf(shipOrder.items[0]!.id)).state).toBe('shipped')
    const decided = await client.rpc(decide![0], decide![1])
    expect(decided.error).toBeNull()
    expect(decided.data).toMatchObject({ ok: true, state: 'approved' })
    // The goods are received without a restock: operations may mark that.
    const received = await client.rpc('return_receive', { p_return: approvedByOps, p_restock: [] })
    expect(received.error).toBeNull()
    expect(received.data).toMatchObject({ ok: true, state: 'received', restocked: [] })
  })

  it('lets an owner through the Data API on the owner-only functions', async () => {
    const client = await signIn(owner.email)
    const recon = await client.rpc('reconciliation_list')
    expect(recon.error).toBeNull()
    sameKeys(recon.data as object, ['attempts', 'events', 'refunds', 'reviews'])
    const restocked = await client.rpc('return_receive', { p_return: approvedForOwner, p_restock: [{ itemId: returnsOrder.items[0]!.id, quantity: 1 }] })
    expect(restocked.error).toBeNull()
    expect(restocked.data).toMatchObject({ ok: true, state: 'received' })
    expect(await stockOf(returnsOrder.items[0]!.variantId)).toBe(20 - 1 - 3 - 1 + 1)
    const closed = await client.rpc('review_close', { p_payment: reviewPayment, p_reason: REVIEW_REASON })
    expect(closed.data).toMatchObject({ ok: true, paymentId: reviewPayment })
    const resolved = await client.rpc('order_resolve', { p_order: stuckOrder.id })
    expect(resolved.error).toBeNull()
    expect(resolved.data).toEqual({ ok: true, orderNumber: stuckOrder.number, status: 'paid' })
  })

  it('refuses the same sessions an unknown target the same way: the role is checked before anything is looked up', async () => {
    for (const [who, client] of clients) {
      for (const [fn, args] of [
        ['order_detail', { p_order: randomUUID() }],
        ['order_resolve', { p_order: randomUUID() }],
        ['review_close', { p_payment: randomUUID(), p_reason: 'x' }],
        ['return_decide', { p_return: randomUUID(), p_decision: 'approved', p_note: null }],
      ] as Array<[string, Record<string, unknown>]>) {
        expect((await client.rpc(fn, args)).error?.code, `${who}: ${fn}`).toBe('42501')
      }
    }
  })
})

// --- orders_list -----------------------------------------------------------------------------------------------------

describe('orders_list', () => {
  const idsFor = async (filter: string, email: string, api: StaffApi = ownerApi): Promise<string[]> => sorted(idsOf((await api.list(filter, email)).rows))

  it('answers each filter with the orders that belong to it, in the row the contract names; to_ship leaves out fully refunded items and digital-only orders', async () => {
    const email = uniqueEmail('list')
    const phys = await h.physical(4000, 30)
    const other = await h.physical(2500, 30)
    const scarce = await h.physical(3000, 5)
    const book = await h.digital(3000)
    const toShip = await h.paid([{ variantId: phys, quantity: 2 }], { email })
    const shipped = await h.paid([{ variantId: phys, quantity: 1 }], { email })
    await markShipped(shipped.items[0]!.id)
    const digitalOnly = await h.paid([{ variantId: book, quantity: 1 }], { email })
    // Two lines, the second refunded in full: one line is still to ship, not two.
    const partlyRefunded = await h.paid([{ variantId: phys, quantity: 1 }, { variantId: other, quantity: 1 }], { email })
    await refundItems(partlyRefunded, [partlyRefunded.items[1]!])
    // The first line shipped, the second refunded in full: nothing is left to ship.
    const shippedAndRefunded = await h.paid([{ variantId: phys, quantity: 1 }, { variantId: other, quantity: 1 }], { email })
    await markShipped(shippedAndRefunded.items[0]!.id)
    await refundItems(shippedAndRefunded, [shippedAndRefunded.items[1]!])
    const refunded = await h.paid([{ variantId: phys, quantity: 1 }], { email })
    await h.refundFully(refunded, owner.userId)
    const pending = await h.place([{ variantId: phys, quantity: 1 }], { email })
    const resolving = await stuck([{ variantId: scarce, quantity: 1 }], [scarce], { email })
    const reviewed = await h.paid([{ variantId: phys, quantity: 1 }], { email })
    const reviewPayment = await reviewOf(reviewed)

    const want = (...orders: Array<{ id: string }>): string[] => sorted(idsOf(orders))
    expect(await idsFor('all', email)).toEqual(want(toShip, shipped, digitalOnly, partlyRefunded, shippedAndRefunded, refunded, pending, resolving, reviewed))
    expect(await idsFor('paid', email)).toEqual(want(toShip, shipped, digitalOnly, partlyRefunded, shippedAndRefunded, reviewed))
    expect(await idsFor('to_ship', email)).toEqual(want(toShip, partlyRefunded, reviewed))
    expect(await idsFor('needs_resolution', email)).toEqual(want(resolving))
    expect(await idsFor('pending', email)).toEqual(want(pending))
    expect(await idsFor('refunded', email)).toEqual(want(refunded))
    expect(await idsFor('review', email)).toEqual(want(reviewed))
    // Operations see the same.
    expect(await idsFor('to_ship', email, opsApi)).toEqual(want(toShip, partlyRefunded, reviewed))

    const all = (await ownerApi.list('all', email)).rows as Row[]
    const row = (order: { id: string }): Row => all.find((entry) => entry.id === order.id)!
    for (const entry of all) {
      sameKeys(entry, ['createdAt', 'email', 'environment', 'id', 'items', 'name', 'orderNumber', 'paidAt', 'refunded', 'review', 'status', 'toShip', 'total'])
    }
    expect(row(toShip)).toMatchObject({ orderNumber: toShip.number, status: 'paid', environment: 'test', total: toShip.total, name: 'مشترٍ', email, items: 1, toShip: 1, refunded: 0, review: false })
    expect(row(toShip).createdAt).toEqual(expect.any(String))
    expect(row(toShip).paidAt).toEqual(expect.any(String))
    expect(row(shipped)).toMatchObject({ toShip: 0 })
    expect(row(digitalOnly)).toMatchObject({ toShip: 0, items: 1 })
    expect(row(partlyRefunded)).toMatchObject({ items: 2, toShip: 1, refunded: partlyRefunded.items[1]!.paid })
    expect(row(shippedAndRefunded)).toMatchObject({ items: 2, toShip: 0, refunded: shippedAndRefunded.items[1]!.paid })
    expect(row(refunded)).toMatchObject({ status: 'refunded', refunded: refunded.total, toShip: 0 })
    expect(row(pending)).toMatchObject({ status: 'pending_payment', paidAt: null, toShip: 0, refunded: 0 })
    expect(row(resolving)).toMatchObject({ status: 'paid_needs_resolution', toShip: 0 })
    expect(row(reviewed)).toMatchObject({ review: true, status: 'paid' })

    // A closed review payment no longer marks the order.
    expect(await ownerApi.close(reviewPayment, REVIEW_REASON)).toMatchObject({ ok: true })
    expect(await idsFor('review', email)).toEqual([])
    expect(((await ownerApi.list('all', email)).rows as Row[]).find((entry) => entry.id === reviewed.id)).toMatchObject({ review: false })
  })

  it('finds an order by its number and a customer by email, folded the way checkout folds them, and never with a LIKE', async () => {
    const email = uniqueEmail('query')
    const variant = await h.physical(4000, 30)
    const a = await h.paid([{ variantId: variant, quantity: 1 }], { email })
    const b = await h.paid([{ variantId: variant, quantity: 1 }], { email })
    const stranger = await h.paid([{ variantId: variant, quantity: 1 }])

    expect(idsOf((await ownerApi.list('all', a.number)).rows)).toEqual([a.id])
    expect(idsOf((await ownerApi.list('all', a.number.toLowerCase())).rows)).toEqual([a.id])
    expect(idsOf((await ownerApi.list('all', `  ${a.number} `)).rows)).toEqual([a.id])
    expect(await idsFor('all', email)).toEqual(sorted([a.id, b.id]))
    expect(await idsFor('all', `  ${email.toUpperCase()}  `)).toEqual(sorted([a.id, b.id]))
    expect(await idsFor('all', stranger.email)).toEqual([stranger.id])
    // The filter and the query together.
    expect(await idsFor('paid', email)).toEqual(sorted([a.id, b.id]))
    expect(await idsFor('refunded', email)).toEqual([])
    expect(idsOf((await ownerApi.list('pending', a.number)).rows)).toEqual([])

    // A LIKE pattern is only an email that matches no address; a number nobody has matches nothing.
    expect((await ownerApi.list('all', '%@example.com')).rows).toEqual([])
    expect((await ownerApi.list('all', `${email.slice(0, 6)}%@example.com`)).rows).toEqual([])
    expect((await ownerApi.list('all', 'AAAAAAAA')).rows).toEqual([])
    // A blank query is no query.
    expect((await ownerApi.list('all', '   ', null, 5)).rows).toHaveLength(5)

    for (const bad of ['abc', 'not an order', 'ABCDEFGH1', 'a@b', 'x@y.z', '%', 'ABCDEFG0']) expect(await sqlstate(ownerApi.list('all', bad)), bad).toBe('22023')
    for (const bad of ['', 'PAID', 'unpaid', 'to-ship', null]) expect(await sqlstate(ownerApi.list(bad as string)), String(bad)).toBe('22023')
  })

  it('pages by created_at with no row lost or repeated, and clamps a page at 50', async () => {
    const email = uniqueEmail('pages')
    const variant = await h.physical(4000, 30)
    const first = await h.place([{ variantId: variant, quantity: 1 }], { email })
    // Sixty older orders of the same customer, written straight into the table (no item, no attempt: they can be deleted).
    const inserted = await h.rows(
      `insert into finance.orders (
         order_number, access_token_hash, access_token_expires_at, customer_id, customer_email, customer_name, customer_phone,
         city_key, city_name_ar, address, seller, policy_revisions, subtotal_halalas, discount_halalas, shipping_halalas,
         total_halalas, currency, environment, idempotency_key, request_hash, checkout_session, email_hash, status,
         hold_expires_at, created_at, updated_at
       )
       select finance.random_order_number(), o.access_token_hash, o.access_token_expires_at, o.customer_id, o.customer_email,
              o.customer_name, o.customer_phone, o.city_key, o.city_name_ar, o.address, o.seller, o.policy_revisions,
              o.subtotal_halalas, o.discount_halalas, o.shipping_halalas, o.total_halalas, o.currency, o.environment,
              gen_random_uuid(), o.request_hash, gen_random_uuid(), o.email_hash, 'expired', o.hold_expires_at,
              o.created_at - g * interval '1 second', o.created_at - g * interval '1 second'
         from finance.orders o cross join generate_series(1, 60) g where o.id = $1
       returning id`,
      [first.id],
    )
    bulk.push(...inserted.map((entry) => entry.id as string))
    const expected = idsOf(await h.rows('select id from finance.orders where email_hash = finance.recipient_hash($1) order by created_at desc, id desc', [email]) as Array<{ id: string }>)
    expect(expected).toHaveLength(61)
    expect(expected[0]).toBe(first.id)

    const seen: string[] = []
    let before: string | null = null
    let pages = 0
    for (;;) {
      const page: { rows: Row[]; next: string | null } = await ownerApi.list('all', email, before, 20)
      pages += 1
      seen.push(...idsOf(page.rows as Array<{ id: string }>))
      if (page.next === null) break
      expect(page.rows).toHaveLength(20)
      // The next page starts where this one ended: the last row's created_at, passed back as it came.
      expect(page.next).toBe(page.rows[page.rows.length - 1]!.createdAt)
      before = page.next
    }
    expect(pages).toBe(4)
    expect(seen).toEqual(expected)

    // A page is at most 50, however many are asked for; a limit below 1 is 1 and no limit is 50.
    const big = await ownerApi.list('all', email, null, 500)
    expect(big.rows).toHaveLength(50)
    expect(big.next).not.toBeNull()
    const rest = await ownerApi.list('all', email, big.next, 500)
    expect(rest.rows).toHaveLength(11)
    expect(rest.next).toBeNull()
    expect(idsOf([...big.rows, ...rest.rows])).toEqual(expected)
    // Exactly what is left is a last page: nothing more to fetch.
    const exact = await ownerApi.list('all', email, big.next, 11)
    expect(exact.rows).toHaveLength(11)
    expect(exact.next).toBeNull()
    expect((await ownerApi.list('all', email, null, 0)).rows).toHaveLength(1)
    expect((await ownerApi.list('all', email, null, -7)).rows).toHaveLength(1)
    expect((await ownerApi.list('all', email, null, null)).rows).toHaveLength(50)
  })
})

// --- order_detail ----------------------------------------------------------------------------------------------------

describe('order_detail', () => {
  it('shows everything the order screen needs, nothing secret, and the disputes and audit rows to an owner only', async () => {
    const phys = await h.physical(4000, 10)
    const sig = await h.signed(9000, 10)
    const book = await h.digital(3500)
    const storageKey = `assets/${book}/${randomUUID()}`
    const file = await h.call('paid_asset_set', { p_actor: owner.userId, p_variant: book, p_storage_key: storageKey, p_filename: 'كتاب أنس.pdf', p_mime: 'application/pdf', p_bytes: 2048 })
    expect(file, JSON.stringify(file)).toMatchObject({ ok: true })
    const p = await h.paid([{ variantId: phys, quantity: 2 }, { variantId: sig, quantity: 1, dedication: 'إلى أنس' }, { variantId: book, quantity: 1 }])
    const [physItem, sigItem, bookItem] = p.items as [PaidItem, PaidItem, PaidItem]
    await markShipped(physItem.id)
    const asked = await askRefund(p, [{ item: physItem, amount: 1000 }])
    await confirmRefund(asked)
    const returnId = await requestReturn(p, [{ itemId: physItem.id, quantity: 1 }])
    const reviewPayment = await reviewOf(p)
    const eventId = `${PREFIX}event-${(eventCounter += 1)}`
    await h.call('payment_event_record', { p_event_id: eventId, p_type: 'payment_paid', p_live: false, p_payment_id: p.paymentId, p_payload_hash: sha256(eventId) })
    await h.call('payment_event_result', { p_event_id: eventId, p_outcome: 'paid', p_error: null })
    const refundKeys = (await h.rows('select idempotency_key from finance.refunds where order_id = $1', [p.id])).map((entry) => entry.idempotency_key as string)

    const detail = await ownerApi.detail(p.id)
    sameKeys(detail, ['attempts', 'audit', 'disputes', 'entitlements', 'events', 'fulfillments', 'items', 'ok', 'order', 'refunds', 'returns', 'reviews'])
    expect(detail.ok).toBe(true)

    // The order, its contact and its delivery.
    sameKeys(detail.order, ['contact', 'couponCode', 'createdAt', 'currency', 'delivery', 'discount', 'environment', 'holdExpiresAt', 'id', 'orderNumber', 'paidAt', 'refunded', 'shipping', 'status', 'subtotal', 'total', 'updatedAt'])
    expect(detail.order).toMatchObject({ id: p.id, orderNumber: p.number, status: 'paid', environment: 'test', total: p.total, currency: 'SAR', couponCode: null, refunded: 1000, shipping: 2500, discount: 0 })
    expect(detail.order.contact).toEqual({ name: 'مشترٍ', email: p.email, phone: '966501234567' })
    expect(detail.order.delivery).toEqual({ cityKey: h.city, city: expect.any(String), address: 'تبوك شارع الرئيسي' })

    // Its items, with what was written on the signed one and what each has had refunded.
    expect(detail.items).toHaveLength(3)
    for (const entry of detail.items) {
      sameKeys(entry, ['dedication', 'discount', 'fullyRefunded', 'fulfillment', 'id', 'lineNo', 'preorder', 'productTitle', 'quantity', 'refunded', 'sku', 'stopped', 'total', 'unitPrice', 'variantTitle'])
      // No dispute stopped any of them.
      expect(entry.stopped).toBe(false)
    }
    expect(detail.items.map((entry: Row) => entry.id)).toEqual([physItem.id, sigItem.id, bookItem.id])
    expect(detail.items[0]).toMatchObject({ lineNo: 1, fulfillment: 'physical', quantity: 2, unitPrice: 4000, total: 8000, refunded: 1000, fullyRefunded: false, dedication: null, preorder: null })
    expect(detail.items[1]).toMatchObject({ fulfillment: 'signed', dedication: 'إلى أنس', refunded: 0 })
    expect(detail.items[2]).toMatchObject({ fulfillment: 'digital', refunded: 0 })

    // The payment evidence: provider ids, amounts, mode, source and fetch time.
    expect(detail.attempts).toHaveLength(1)
    sameKeys(detail.attempts[0], ['amount', 'captured', 'checkCount', 'createdAt', 'currency', 'environment', 'errorCount', 'fee', 'fetchedAt', 'id', 'invoiceExpiresAt', 'lastError', 'orderId', 'paidAt', 'providerInvoiceId', 'providerPaymentId', 'providerRefunded', 'providerStatus', 'sourceCompany', 'sourceType', 'status'])
    expect(detail.attempts[0]).toMatchObject({
      id: p.attemptId, orderId: p.id, status: 'paid', environment: 'test', amount: p.total, captured: p.total, fee: 150, currency: 'SAR',
      providerInvoiceId: p.invoiceId, providerPaymentId: p.paymentId, providerStatus: 'paid', providerRefunded: 1000, sourceType: 'creditcard', sourceCompany: 'mada',
    })
    expect(detail.attempts[0].fetchedAt).toEqual(expect.any(String))
    expect(detail.reviews).toHaveLength(1)
    sameKeys(detail.reviews[0], ['amount', 'attemptId', 'closedAt', 'closedReason', 'createdAt', 'currency', 'environment', 'invoiceId', 'orderId', 'paymentId', 'providerRefunded', 'providerStatus', 'reason', 'refunded'])
    expect(detail.reviews[0]).toMatchObject({ paymentId: reviewPayment, reason: 'SECOND_PAYMENT', closedAt: null, orderId: p.id, attemptId: p.attemptId })
    expect(detail.events).toHaveLength(1)
    sameKeys(detail.events[0], ['attempts', 'error', 'eventId', 'live', 'nextCheckAt', 'outcome', 'paymentId', 'processedAt', 'receivedAt', 'type'])
    expect(detail.events[0]).toMatchObject({ eventId, type: 'payment_paid', outcome: 'paid', paymentId: p.paymentId, live: false })

    // What happens to the goods and the files.
    expect(detail.fulfillments).toHaveLength(2)
    sameKeys(detail.fulfillments[0], ['carrier', 'dedicationDone', 'deliveredAt', 'id', 'itemId', 'shippedAt', 'state', 'tracking', 'updatedAt'])
    expect(detail.fulfillments.map((entry: Row) => [entry.itemId, entry.state])).toEqual([[physItem.id, 'shipped'], [sigItem.id, 'preparing']])
    expect(detail.entitlements).toHaveLength(1)
    sameKeys(detail.entitlements[0], ['filename', 'grantedAt', 'hasFile', 'id', 'itemId', 'revokeReason', 'revokedAt'])
    expect(detail.entitlements[0]).toMatchObject({ itemId: bookItem.id, hasFile: true, filename: 'كتاب أنس.pdf', revokedAt: null })
    expect(detail.refunds).toHaveLength(1)
    sameKeys(detail.refunds[0], ['allocation', 'amount', 'attemptId', 'createdAt', 'error', 'id', 'nextCheckAt', 'orderId', 'providerRefundedAfter', 'providerRefundedBefore', 'reason', 'returnId', 'reviewPaymentId', 'source', 'status', 'succeededAt'])
    expect(detail.refunds[0]).toMatchObject({ id: asked.refundId, status: 'succeeded', amount: 1000, source: 'admin', attemptId: p.attemptId, providerRefundedBefore: 0, providerRefundedAfter: 1000 })
    expect(detail.refunds[0].allocation).toEqual({ items: [{ itemId: physItem.id, amount: 1000 }] })
    expect(detail.returns).toHaveLength(1)
    sameKeys(detail.returns[0], ['createdAt', 'id', 'items', 'reason', 'refundId', 'restocked', 'staffNote', 'state', 'updatedAt'])
    expect(detail.returns[0]).toMatchObject({ id: returnId, state: 'requested', items: [{ itemId: physItem.id, quantity: 1 }], reason: 'سبب الإرجاع', staffNote: null, restocked: null })

    // The owner's audit trail of this order: its own rows, its refunds' and its review payments'.
    expect(detail.disputes).toEqual([])
    for (const entry of detail.audit) sameKeys(entry, ['action', 'actor', 'at', 'entity', 'entityId', 'id', 'summary'])
    const actions = detail.audit.map((entry: Row) => entry.action)
    for (const action of ['order.created', 'order.paid', 'refund.requested', 'refund.succeeded', 'payment.review']) expect(actions, action).toContain(action)
    expect(detail.audit.find((entry: Row) => entry.action === 'refund.requested')).toMatchObject({ entity: 'refund', entityId: asked.refundId, actor: owner.userId })
    expect(detail.audit.find((entry: Row) => entry.action === 'payment.review')).toMatchObject({ entity: 'payment', entityId: reviewPayment })

    // Nothing secret anywhere in it: no token, token hash, idempotency key, storage key or invoice link.
    const text = JSON.stringify(detail)
    for (const secret of [p.hash, p.token, p.key, ...refundKeys, storageKey, `assets/${book}`, `http://127.0.0.1:54390/invoices/${p.invoiceId}`]) {
      expect(text.includes(secret), secret).toBe(false)
    }
    expect(text).not.toMatch(/token|idempotency|storage_?key|request_?hash|invoice_?url/i)

    // Operations get the same screen without the disputes and the audit trail: the keys are absent, not empty.
    const forOperations = await opsApi.detail(p.id)
    sameKeys(forOperations, ['attempts', 'entitlements', 'events', 'fulfillments', 'items', 'ok', 'order', 'refunds', 'returns', 'reviews'])
    expect('disputes' in forOperations).toBe(false)
    expect('audit' in forOperations).toBe(false)
    expect(forOperations).toEqual(Object.fromEntries(Object.entries(detail).filter(([name]) => name !== 'disputes' && name !== 'audit')))
    expect(JSON.stringify(forOperations).includes(p.hash)).toBe(false)
  })

  it('shows an owner the disputes recorded against an order\'s payments, and only an owner', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    // The disputes table is append-only, so the row lives in a transaction that is rolled back.
    await h.postgres.query('begin')
    try {
      await h.postgres.query(
        `insert into finance.disputes (kind, provider_ref, seq, attempt_id, environment, amount_halalas, direction, occurred_on, reason, decision)
         values ('chargeback', $2, 1, $1, 'test', 500, 'against_seller', current_date, 'نزاع تجريبي', 'none')`,
        [p.attemptId, `${PREFIX}dispute`],
      )
      await h.postgres.query('set local role authenticated')
      const detailAs = async (member: Member): Promise<any> => {
        await h.postgres.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member.userId, role: 'authenticated' })])
        return (await h.postgres.query('select public.order_detail($1) as r', [p.id])).rows[0].r
      }
      const asOwner = await detailAs(owner)
      expect(asOwner.disputes).toHaveLength(1)
      sameKeys(asOwner.disputes[0], ['amount', 'attemptId', 'createdAt', 'decision', 'direction', 'environment', 'id', 'itemIds', 'kind', 'occurredOn', 'providerRef', 'reason', 'resolution', 'reviewPaymentId', 'seq'])
      expect(asOwner.disputes[0]).toMatchObject({ kind: 'chargeback', providerRef: `${PREFIX}dispute`, seq: 1, attemptId: p.attemptId, amount: 500, direction: 'against_seller', decision: 'none', itemIds: [] })
      expect('disputes' in (await detailAs(operations))).toBe(false)
    } finally {
      await h.postgres.query('rollback')
    }
  })

  it('answers NOT_FOUND for an order that does not exist', async () => {
    expect(await ownerApi.detail(randomUUID())).toEqual(NOT_FOUND)
    expect(await ownerApi.detail(null)).toEqual(NOT_FOUND)
    expect(await opsApi.detail(randomUUID())).toEqual(NOT_FOUND)
  })
})

// --- fulfillment_update ----------------------------------------------------------------------------------------------

describe('fulfillment_update', () => {
  type Fixture = { p: Paid; phys: PaidItem; sig: PaidItem; book: PaidItem }
  async function make(): Promise<Fixture> {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }, { variantId: await h.signed(9000, 10), quantity: 1 }, { variantId: await h.digital(3500), quantity: 1 }])
    const [phys, sig, book] = p.items as [PaidItem, PaidItem, PaidItem]
    return { p, phys, sig, book }
  }
  const unchanged = async (...items: PaidItem[]): Promise<void> => {
    for (const item of items) expect(await fulfilmentOf(item.id), item.id).toMatchObject({ state: 'preparing', carrier: null, tracking: null, version: 1 })
  }

  it('refuses a malformed call by raising, and moves nothing', async () => {
    const { p, phys } = await make()
    const many = Array.from({ length: 51 }, () => randomUUID())
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['no ids', () => ownerApi.fulfil(p.id, [], 'shipped', 'SMSA', 'T1')],
      ['too many ids', () => ownerApi.fulfil(p.id, many, 'shipped', 'SMSA', 'T1')],
      ['a null id', () => pgRpc(ownerDb)('fulfillment_update', { p_order: p.id, p_item_ids: `{${phys.id},NULL}`, p_state: 'shipped', p_carrier: 'SMSA', p_tracking: 'T1', p_dedication_done: null })],
      ['an unknown state', () => ownerApi.fulfil(p.id, [phys.id], 'lost', 'SMSA', 'T1')],
      ['no state', () => pgRpc(ownerDb)('fulfillment_update', { p_order: p.id, p_item_ids: uuids([phys.id]), p_state: null, p_carrier: 'SMSA', p_tracking: 'T1', p_dedication_done: null })],
      ['no carrier', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', null, 'T1')],
      ['a blank carrier', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', '   ', 'T1')],
      ['a carrier of 81 characters', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'x'.repeat(81), 'T1')],
      ['a carrier on two lines', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SM\nSA', 'T1')],
      ['no tracking', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', null)],
      ['a blank tracking', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', ' \t ')],
      ['a tracking of 121 characters', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'x'.repeat(121))],
      ['a tracking on two lines', () => ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1\nT2')],
    ]
    for (const [name, attempt] of attempts) expect(await sqlstate(attempt()), name).toBe('22023')
    // The longest values that are allowed.
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'x'.repeat(80), 'y'.repeat(120))).toMatchObject({ ok: true, changed: 1 })
    expect(await fulfilmentOf(phys.id)).toMatchObject({ carrier: 'x'.repeat(80), tracking: 'y'.repeat(120) })
  })

  it('refuses an order that is not paid, and an order or an item that is not there', async () => {
    const { p, phys, book } = await make()
    const other = await make()
    expect(await ownerApi.fulfil(randomUUID(), [phys.id], 'shipped', 'SMSA', 'T1')).toEqual(NOT_FOUND)
    const pending = await h.place([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    expect(await ownerApi.fulfil(pending.id, [randomUUID()], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'ORDER_NOT_PAID', status: 'pending_payment' })
    const scarce = await h.physical(4000, 5)
    const waiting = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    expect(await ownerApi.fulfil(waiting.id, [randomUUID()], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'ORDER_NOT_PAID', status: 'paid_needs_resolution' })
    const gone = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    await h.refundFully(gone, owner.userId)
    expect(await ownerApi.fulfil(gone.id, gone.items.map((item) => item.id), 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'ORDER_NOT_PAID', status: 'refunded' })
    expect((await fulfilmentOf(gone.items[0]!.id)).state).toBe('preparing')

    // Every id must be the fulfilment of an item of this order, once: a digital item has none.
    expect(await ownerApi.fulfil(p.id, [book.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'INVALID_ITEMS', itemIds: [book.id] })
    expect(await ownerApi.fulfil(p.id, [phys.id, other.phys.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'INVALID_ITEMS', itemIds: [other.phys.id] })
    const unknown = randomUUID()
    expect(await ownerApi.fulfil(p.id, [unknown], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'INVALID_ITEMS', itemIds: [unknown] })
    expect(await ownerApi.fulfil(p.id, [phys.id, phys.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ ok: false, code: 'INVALID_ITEMS' })
    await unchanged(phys, other.phys)
    expect(await mailsOf(p.id, 'order_shipped')).toEqual([])
  })

  it('ships an item: trimmed carrier and tracking, one mail with the ids, one audit row, and the dispatcher can read what it needs', async () => {
    const { p, phys } = await make()
    const reply = await ownerApi.fulfil(p.id, [phys.id], 'shipped', '  SMSA  ', ' TRK-123 ')
    expect(reply).toEqual({ ok: true, changed: 1, itemIds: [phys.id] })
    const row = await fulfilmentOf(phys.id)
    expect(row).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'TRK-123', dedication_done: false, version: 2, updated_by: owner.userId, delivered_at: null })
    expect(row.shipped_at).not.toBeNull()

    const mails = await mailsOf(p.id, 'order_shipped')
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ dedupe_key: `order_shipped:${p.id}:${md5(phys.id)}`, priority: 0, recipient: p.email, status: 'pending' })
    expect(mails[0]!.payload).toEqual({ orderId: p.id, itemIds: [phys.id] })
    const data = (await h.postgres.query('select public.order_email_data($1, null, $2::uuid[]) as r', [p.id, mails[0]!.payload.itemIds])).rows[0]!.r
    expect(data.shipment).toEqual({ carrier: 'SMSA', tracking: 'TRK-123', itemIds: [phys.id] })

    const audits = await auditsOf('fulfillment.updated', p.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: owner.userId, entity: 'order' })
    expect(audits[0]!.summary).toEqual({ orderNumber: p.number, state: 'shipped', itemIds: [phys.id] })
  })

  it('changes nothing and queues nothing when the same call is made again, and refuses another carrier or tracking for what has shipped', async () => {
    const { p, phys } = await make()
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ ok: true, changed: 1 })
    const before = await fulfilmentOf(phys.id)
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: true, changed: 0, itemIds: [] })
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', ' SMSA', 'T1 ')).toEqual({ ok: true, changed: 0, itemIds: [] })
    expect(await fulfilmentOf(phys.id)).toEqual(before)
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(1)
    expect(await auditsOf('fulfillment.corrected', p.id)).toEqual([])

    // A correction is not a move: a second «تم الشحن» with other values (another member's screen that has not seen
    // the first) changes nothing and rewrites nobody's carrier or tracking; `fulfillment_correct` is the correction.
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T2')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    expect(await opsApi.fulfil(p.id, [phys.id], 'shipped', 'Aramex', 'T1')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    expect(await fulfilmentOf(phys.id)).toEqual(before)
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(1)
    expect(await auditsOf('fulfillment.corrected', p.id)).toEqual([])
  })

  it('fulfillment_correct corrects a mistyped carrier or tracking of what has shipped: the rows change, no second mail, an audit row of its own; an item not shipped is refused', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }, { variantId: await h.physical(2500, 10), quantity: 1 }, { variantId: await h.physical(1500, 10), quantity: 1 }])
    const [a, b, c] = p.items as [PaidItem, PaidItem, PaidItem]
    expect(await ownerApi.fulfil(p.id, [a.id, b.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ ok: true, changed: 2 })
    const shippedAt = (await fulfilmentOf(a.id)).shipped_at
    const mails = await mailsOf(p.id, 'order_shipped')
    expect(mails).toHaveLength(1)

    // The tracking of one item was mistyped: operations correct it; its carrier and its shipping time stay.
    expect(await opsApi.correct(p.id, [a.id], 'SMSA', ' T1-FIXED ')).toEqual({ ok: true, changed: 1, itemIds: [a.id], corrected: true })
    expect(await fulfilmentOf(a.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'T1-FIXED', version: 3, updated_by: operations.userId, shipped_at: shippedAt })
    expect(await fulfilmentOf(b.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'T1', version: 2 })
    // No mail: the buyer's shipped mail is the one already queued.
    expect(await mailsOf(p.id, 'order_shipped')).toEqual(mails)
    const corrected = await auditsOf('fulfillment.corrected', p.id)
    expect(corrected).toHaveLength(1)
    expect(corrected[0]).toMatchObject({ actor: operations.userId, entity: 'order' })
    // The ids only, never the text that was typed.
    expect(corrected[0]!.summary).toEqual({ orderNumber: p.number, itemIds: [a.id] })
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(1)

    // Both at once: each row that differs changes; the same call again changes nothing and audits nothing.
    expect(await ownerApi.correct(p.id, [a.id, b.id], 'Aramex', 'T1-FIXED')).toEqual({ ok: true, changed: 2, itemIds: sorted([a.id, b.id]), corrected: true })
    expect(await ownerApi.correct(p.id, [a.id, b.id], 'Aramex', 'T1-FIXED')).toEqual({ ok: true, changed: 0, itemIds: [] })
    expect(await fulfilmentOf(b.id)).toMatchObject({ carrier: 'Aramex', tracking: 'T1-FIXED', version: 3 })
    expect(await auditsOf('fulfillment.corrected', p.id)).toHaveLength(2)

    // Named beside an item still being prepared, the correction is refused whole and names that item: it never ships
    // anything. `fulfillment_update` refuses another tracking beside it too, naming the shipped one.
    expect(await ownerApi.correct(p.id, [a.id, c.id], 'Aramex', 'OTHER')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [c.id] })
    expect(await ownerApi.fulfil(p.id, [a.id, c.id], 'shipped', 'Aramex', 'OTHER')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [a.id] })
    await unchanged(c)
    expect(await fulfilmentOf(a.id)).toMatchObject({ tracking: 'T1-FIXED', version: 4 })
    expect(await mailsOf(p.id, 'order_shipped')).toEqual(mails)
    expect(await auditsOf('fulfillment.corrected', p.id)).toHaveLength(2)
  })

  it('fulfillment_correct refuses a malformed call by raising, an order or an item that is not there, an order that is not paid, and an item that is not shipped: still prepared, or delivered', async () => {
    const { p, phys, sig, book } = await make()
    const other = await make()
    const many = Array.from({ length: 51 }, () => randomUUID())
    const malformed: Array<[string, () => Promise<unknown>]> = [
      ['no ids', () => ownerApi.correct(p.id, [], 'SMSA', 'T1')],
      ['too many ids', () => ownerApi.correct(p.id, many, 'SMSA', 'T1')],
      ['a null id', () => pgRpc(ownerDb)('fulfillment_correct', { p_order: p.id, p_item_ids: `{${phys.id},NULL}`, p_carrier: 'SMSA', p_tracking: 'T1' })],
      ['no carrier', () => ownerApi.correct(p.id, [phys.id], null, 'T1')],
      ['a blank carrier', () => ownerApi.correct(p.id, [phys.id], '   ', 'T1')],
      ['a carrier of 81 characters', () => ownerApi.correct(p.id, [phys.id], 'x'.repeat(81), 'T1')],
      ['a carrier on two lines', () => ownerApi.correct(p.id, [phys.id], 'SM\nSA', 'T1')],
      ['no tracking', () => ownerApi.correct(p.id, [phys.id], 'SMSA', null)],
      ['a blank tracking', () => ownerApi.correct(p.id, [phys.id], 'SMSA', ' \t ')],
      ['a tracking of 121 characters', () => ownerApi.correct(p.id, [phys.id], 'SMSA', 'x'.repeat(121))],
      ['a tracking on two lines', () => ownerApi.correct(p.id, [phys.id], 'SMSA', 'T1\nT2')],
    ]
    for (const [name, attempt] of malformed) expect(await sqlstate(attempt()), name).toBe('22023')

    expect(await ownerApi.correct(randomUUID(), [phys.id], 'SMSA', 'T1')).toEqual(NOT_FOUND)
    const pending = await h.place([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    expect(await opsApi.correct(pending.id, [randomUUID()], 'SMSA', 'T1')).toEqual({ ok: false, code: 'ORDER_NOT_PAID', status: 'pending_payment' })
    // Every id must be the fulfilment of an item of this order, once: a digital item has none.
    expect(await ownerApi.correct(p.id, [book.id], 'SMSA', 'T1')).toEqual({ ok: false, code: 'INVALID_ITEMS', itemIds: [book.id] })
    expect(await ownerApi.correct(p.id, [phys.id, other.phys.id], 'SMSA', 'T1')).toEqual({ ok: false, code: 'INVALID_ITEMS', itemIds: [other.phys.id] })
    expect(await ownerApi.correct(p.id, [phys.id, phys.id], 'SMSA', 'T1')).toMatchObject({ ok: false, code: 'INVALID_ITEMS' })
    // Items still being prepared: the correction never ships them, and nothing changes.
    expect(await opsApi.correct(p.id, [phys.id, sig.id], 'SMSA', 'T1')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: sorted([phys.id, sig.id]) })
    await unchanged(phys, sig, other.phys)
    // A delivered item is not corrected either.
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ ok: true, changed: 1 })
    expect(await ownerApi.fulfil(p.id, [phys.id], 'delivered')).toMatchObject({ ok: true, changed: 1 })
    const delivered = await fulfilmentOf(phys.id)
    expect(await ownerApi.correct(p.id, [phys.id], 'SMSA', 'T2')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    expect(await fulfilmentOf(phys.id)).toEqual(delivered)
    expect(await auditsOf('fulfillment.corrected', p.id)).toEqual([])
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
  })

  it('answers REFUND_IN_FLIGHT for an item a refund in flight allocates, and moves nothing; once the refund is decided, the item follows it', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }, { variantId: await h.signed(9000, 10), quantity: 1 }])
    const [phys, sig] = p.items as [PaidItem, PaidItem]
    const asked = await askRefund(p, [{ item: phys, amount: phys.paid }])
    // All or nothing: the signed item beside it is neither ticked nor shipped.
    expect(await ownerApi.fulfil(p.id, [phys.id, sig.id], 'shipped', 'SMSA', 'T1', true)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT', itemIds: [phys.id] })
    expect(await opsApi.fulfil(p.id, [phys.id], 'preparing')).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT', itemIds: [phys.id] })
    await unchanged(phys, sig)
    expect((await fulfilmentOf(sig.id)).dedication_done).toBe(false)
    expect(await mailsOf(p.id, 'order_shipped')).toEqual([])
    // An item no refund allocates still ships.
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T1', true)).toEqual({ ok: true, changed: 1, itemIds: [sig.id] })
    // The refund lands: the item is refunded in full, and it is never shipped.
    expect(await h.call('refund_settle', { p_refund: asked.refundId, p_provider_refunded: asked.before + asked.amount })).toMatchObject({ ok: true, status: 'succeeded' })
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'ITEM_REFUNDED', itemIds: [phys.id] })
    await unchanged(phys)

    // A refund in flight for part of an item holds it too; once it fails, the item ships.
    const q = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    const item = q.items[0]!
    const part = await askRefund(q, [{ item, amount: 1000 }])
    expect(await ownerApi.fulfil(q.id, [item.id], 'shipped', 'SMSA', 'T2')).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT', itemIds: [item.id] })
    expect(await h.call('refund_result', { p_refund: part.refundId, p_outcome: 'failed', p_provider_refunded: null, p_error: 'REFUSED' })).toMatchObject({ ok: true, status: 'failed' })
    expect(await ownerApi.fulfil(q.id, [item.id], 'shipped', 'SMSA', 'T2')).toEqual({ ok: true, changed: 1, itemIds: [item.id] })
  })

  it('renews the order\'s link when it mails a shipment, so that the mail\'s link opens; never shortened, and not by a call that ships nothing', async () => {
    const { p, phys, sig } = await make()
    const access = (): Promise<any> => h.call('order_access', { p_order_number: p.number, p_access_token_hash: p.hash, p_ip_hash: h.ipHash(), p_mode: 'test' })
    const daysLeft = async (): Promise<number> =>
      Number((await h.row('select extract(epoch from (access_token_expires_at - now())) / 86400 as d from finance.orders where id = $1', [p.id])).d)
    // The link expired 7 days after the payment; the goods ship later.
    await h.postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 minute' where id = $1", [p.id])
    expect(await access()).toEqual(NOT_FOUND)
    // The checklist alone mails nothing and renews nothing.
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing', null, null, true)).toMatchObject({ ok: true, changed: 1 })
    expect(await access()).toEqual(NOT_FOUND)

    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: true, changed: 1, itemIds: [phys.id] })
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
    expect(await access()).toMatchObject({ ok: true, order: { orderNumber: p.number } })
    expect(await daysLeft()).toBeGreaterThan(6.9)

    // A link with longer left keeps it.
    await h.postgres.query("update finance.orders set access_token_expires_at = now() + interval '30 days' where id = $1", [p.id])
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T2')).toEqual({ ok: true, changed: 1, itemIds: [sig.id] })
    expect(await daysLeft()).toBeGreaterThan(29.9)
  })

  it('moves only forward: preparing, shipped, delivered, each one step; delivered ignores a carrier and a tracking', async () => {
    const { p, phys } = await make()
    // Not backwards, and not a jump over `shipped`.
    expect(await ownerApi.fulfil(p.id, [phys.id], 'delivered')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    expect((await fulfilmentOf(phys.id)).state).toBe('preparing')
    expect(await ownerApi.fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ ok: true })
    expect(await ownerApi.fulfil(p.id, [phys.id], 'preparing')).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    expect((await fulfilmentOf(phys.id)).state).toBe('shipped')

    const delivered = await ownerApi.fulfil(p.id, [phys.id], 'delivered', 'Aramex', 'OTHER')
    expect(delivered).toEqual({ ok: true, changed: 1, itemIds: [phys.id] })
    expect(await fulfilmentOf(phys.id)).toMatchObject({ state: 'delivered', carrier: 'SMSA', tracking: 'T1', version: 3 })
    expect((await fulfilmentOf(phys.id)).delivered_at).not.toBeNull()
    // No mail for a delivery; one audit row for each move that changed something.
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(2)
    // A repeat is no move; going back is refused.
    expect(await ownerApi.fulfil(p.id, [phys.id], 'delivered')).toEqual({ ok: true, changed: 0, itemIds: [] })
    for (const state of ['preparing', 'shipped']) {
      expect(await ownerApi.fulfil(p.id, [phys.id], state, 'SMSA', 'T1'), state).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [phys.id] })
    }
    expect(await fulfilmentOf(phys.id)).toMatchObject({ state: 'delivered', version: 3 })
  })

  it('needs a signed item\'s dedication done first, ticked in the same call or before', async () => {
    const { p, phys, sig } = await make()
    const refusal = { ok: false, code: 'DEDICATION_NOT_DONE', itemIds: [sig.id] }
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T1')).toEqual(refusal)
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T1', false)).toEqual(refusal)
    // All or nothing: the physical item beside it did not move either.
    expect(await ownerApi.fulfil(p.id, [phys.id, sig.id], 'shipped', 'SMSA', 'T1')).toEqual(refusal)
    await unchanged(phys, sig)
    expect((await fulfilmentOf(sig.id)).dedication_done).toBe(false)
    expect(await mailsOf(p.id, 'order_shipped')).toEqual([])

    // The checklist alone: ticked while the item is prepared, no move and no mail; the physical item has none.
    expect(await ownerApi.fulfil(p.id, [sig.id, phys.id], 'preparing', null, null, true)).toEqual({ ok: true, changed: 1, itemIds: [sig.id] })
    expect(await fulfilmentOf(sig.id)).toMatchObject({ state: 'preparing', dedication_done: true, version: 2 })
    expect(await fulfilmentOf(phys.id)).toMatchObject({ dedication_done: false, version: 1 })
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing', null, null, true)).toEqual({ ok: true, changed: 0, itemIds: [] })
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing')).toEqual({ ok: true, changed: 0, itemIds: [] })
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing', null, null, false)).toMatchObject({ ok: true, changed: 1 })
    expect((await fulfilmentOf(sig.id)).dedication_done).toBe(false)
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T1')).toEqual(refusal)
    expect(await mailsOf(p.id, 'order_shipped')).toEqual([])

    // Ticked before, shipped with no mention of it: it ships.
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing', null, null, true)).toMatchObject({ changed: 1 })
    expect(await ownerApi.fulfil(p.id, [sig.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: true, changed: 1, itemIds: [sig.id] })
    expect(await fulfilmentOf(sig.id)).toMatchObject({ state: 'shipped', dedication_done: true })
    // What has shipped keeps its checklist: a later tick is refused as a step back.
    expect(await ownerApi.fulfil(p.id, [sig.id], 'preparing', null, null, false)).toEqual({ ok: false, code: 'BAD_TRANSITION', itemIds: [sig.id] })
  })

  it('ships mixed items in one call: one mail for the items that moved, the signed one ticked with the call', async () => {
    const { p, phys, sig } = await make()
    const reply = await ownerApi.fulfil(p.id, [sig.id, phys.id], 'shipped', 'SMSA', 'T1', true)
    expect(reply).toEqual({ ok: true, changed: 2, itemIds: sorted([phys.id, sig.id]) })
    expect(await fulfilmentOf(phys.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'T1', dedication_done: false })
    expect(await fulfilmentOf(sig.id)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'T1', dedication_done: true })
    const mails = await mailsOf(p.id, 'order_shipped')
    expect(mails).toHaveLength(1)
    expect(mails[0]!.dedupe_key).toBe(`order_shipped:${p.id}:${md5(sorted([phys.id, sig.id]).join(','))}`)
    expect(mails[0]!.payload).toEqual({ orderId: p.id, itemIds: sorted([phys.id, sig.id]) })
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(1)
  })

  it('moves what can move in a call that repeats something already shipped, and mails only the items that moved', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }, { variantId: await h.physical(2500, 10), quantity: 1 }])
    const [a, b] = p.items as [PaidItem, PaidItem]
    expect(await ownerApi.fulfil(p.id, [a.id], 'shipped', 'SMSA', 'T1')).toMatchObject({ changed: 1 })
    const reply = await ownerApi.fulfil(p.id, [a.id, b.id], 'shipped', 'SMSA', 'T1')
    expect(reply).toEqual({ ok: true, changed: 1, itemIds: [b.id] })
    expect(await fulfilmentOf(a.id)).toMatchObject({ version: 2 })
    expect(await fulfilmentOf(b.id)).toMatchObject({ state: 'shipped', version: 2 })
    const mails = await mailsOf(p.id, 'order_shipped')
    expect(mails.map((mail) => mail.dedupe_key).sort()).toEqual([`order_shipped:${p.id}:${md5(a.id)}`, `order_shipped:${p.id}:${md5(b.id)}`].sort())
    expect(mails.find((mail) => mail.dedupe_key.endsWith(md5(b.id)))!.payload).toEqual({ orderId: p.id, itemIds: [b.id] })
  })

  it('refuses a fully refunded item, ships a partly refunded one, and lets a refunded item that had shipped be marked delivered', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }, { variantId: await h.physical(2500, 10), quantity: 1 }, { variantId: await h.physical(1500, 10), quantity: 1 }])
    const [partly, whole, late] = p.items as [PaidItem, PaidItem, PaidItem]
    await confirmRefund(await askRefund(p, [{ item: partly, amount: 1000 }]))
    await refundItems(p, [whole])

    // The refunded item is refused, all or nothing: the one beside it stays where it was.
    expect(await ownerApi.fulfil(p.id, [partly.id, whole.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: false, code: 'ITEM_REFUNDED', itemIds: [whole.id] })
    expect(await ownerApi.fulfil(p.id, [whole.id], 'preparing', null, null, true)).toEqual({ ok: false, code: 'ITEM_REFUNDED', itemIds: [whole.id] })
    await unchanged(partly, whole)
    expect(await mailsOf(p.id, 'order_shipped')).toEqual([])
    // A partial refund leaves the item shippable.
    expect(await ownerApi.fulfil(p.id, [partly.id], 'shipped', 'SMSA', 'T1')).toEqual({ ok: true, changed: 1, itemIds: [partly.id] })

    // Shipped first and refunded after: it is still on its way, and arrives.
    expect(await ownerApi.fulfil(p.id, [late.id], 'shipped', 'SMSA', 'T2')).toMatchObject({ ok: true })
    await refundItems(p, [late])
    expect(await ownerApi.fulfil(p.id, [late.id], 'delivered')).toEqual({ ok: true, changed: 1, itemIds: [late.id] })
    expect((await fulfilmentOf(late.id)).state).toBe('delivered')
    expect((await fulfilmentOf(whole.id)).state).toBe('preparing')
  })

  it('answers two identical calls at once with one move, one mail and one audit row', async () => {
    const { p, phys } = await make()
    const [first, second] = [await session(owner), await session(owner)]
    const settled = await race(p.id, [() => api(first).fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1'), () => api(second).fulfil(p.id, [phys.id], 'shipped', 'SMSA', 'T1')])
    const replies = settled.map(fulfilledValue)
    expect(replies.map((reply) => reply.changed).sort()).toEqual([0, 1])
    expect(replies.every((reply) => reply.ok === true)).toBe(true)
    expect(await fulfilmentOf(phys.id)).toMatchObject({ state: 'shipped', version: 2 })
    expect(await mailsOf(p.id, 'order_shipped')).toHaveLength(1)
    expect(await auditsOf('fulfillment.updated', p.id)).toHaveLength(1)
  })
})

// --- return_decide ---------------------------------------------------------------------------------------------------

describe('return_decide', () => {
  async function fresh(): Promise<{ p: Paid; item: PaidItem; id: string }> {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 2 }])
    const item = p.items[0]!
    return { p, item, id: await requestReturn(p, [{ itemId: item.id, quantity: 2 }]) }
  }

  it('approves a request with its note trimmed, and records who decided and what was decided', async () => {
    const { p, id } = await fresh()
    expect(await ownerApi.decide(id, 'approved', '  مقبول  ')).toEqual({ ok: true, returnId: id, state: 'approved' })
    expect(await returnOf(id)).toMatchObject({ state: 'approved', staff_note: 'مقبول', decided_by: owner.userId, received_by: null, restocked: null })
    const audits = await auditsOf('return.decided', id)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: owner.userId, entity: 'return' })
    expect(audits[0]!.summary).toEqual({ orderNumber: p.number, decision: 'approved' })
  })

  it('rejects a request, which gives its quantities back to the buyer; a blank or missing note is none', async () => {
    const { item, id } = await fresh()
    expect(await h.postgres.query('select finance.item_returnable($1) as n', [item.id]).then((result) => result.rows[0]!.n)).toBe(0)
    expect(await opsApi.decide(id, 'rejected', '   ')).toEqual({ ok: true, returnId: id, state: 'rejected' })
    expect(await returnOf(id)).toMatchObject({ state: 'rejected', staff_note: null, decided_by: operations.userId })
    expect(await h.postgres.query('select finance.item_returnable($1) as n', [item.id]).then((result) => result.rows[0]!.n)).toBe(2)
  })

  it('decides only from requested: any other state, and a second decision, is refused with the state it is in', async () => {
    const { id } = await fresh()
    expect(await ownerApi.decide(id, 'approved')).toMatchObject({ ok: true })
    expect(await ownerApi.decide(id, 'approved')).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'approved' })
    expect(await ownerApi.decide(id, 'rejected')).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'approved' })
    for (const state of ['rejected', 'received', 'refunded']) {
      await h.postgres.query('update finance.return_requests set state = $2 where id = $1', [id, state])
      expect(await ownerApi.decide(id, 'approved'), state).toEqual({ ok: false, code: 'BAD_TRANSITION', state })
      expect((await returnOf(id)).state).toBe(state)
    }
    expect((await returnOf(id)).staff_note).toBeNull()
    expect(await auditsOf('return.decided', id)).toHaveLength(1)
  })

  it('refuses an unknown return and a malformed decision or note', async () => {
    const { id } = await fresh()
    expect(await ownerApi.decide(randomUUID(), 'approved')).toEqual(NOT_FOUND)
    for (const [name, call] of [
      ['an unknown decision', () => ownerApi.decide(id, 'maybe')],
      ['no decision', () => ownerApi.decide(id, null as unknown as string)],
      ['a note of 501 characters', () => ownerApi.decide(id, 'approved', 'x'.repeat(501))],
      ['a note on two lines', () => ownerApi.decide(id, 'approved', 'a\nb')],
    ] as Array<[string, () => Promise<unknown>]>) {
      expect(await sqlstate(call()), name).toBe('22023')
    }
    expect((await returnOf(id)).state).toBe('requested')
    expect(await ownerApi.decide(id, 'approved', 'x'.repeat(500))).toMatchObject({ ok: true })
  })
})

// --- return_receive --------------------------------------------------------------------------------------------------

describe('return_receive', () => {
  type Goods = { p: Paid; items: PaidItem[]; variants: string[]; id: string }
  /** Three lines (3, 2 and 1 units); the return is for 2 of the first and 1 of the second, and approved. */
  async function approvedReturn(): Promise<Goods> {
    const variants = [await h.physical(4000, 10), await h.physical(2500, 10), await h.physical(1500, 10)]
    const p = await h.paid([{ variantId: variants[0]!, quantity: 3 }, { variantId: variants[1]!, quantity: 2 }, { variantId: variants[2]!, quantity: 1 }])
    const id = await requestReturn(p, [{ itemId: p.items[0]!.id, quantity: 2 }, { itemId: p.items[1]!.id, quantity: 1 }])
    await approve(id)
    return { p, items: p.items, variants, id }
  }
  const stocks = async (g: Goods): Promise<Array<number | null>> => {
    const found: Array<number | null> = []
    for (const variantId of g.variants) found.push(await stockOf(variantId))
    return found
  }

  it('marks approved goods received without a restock: operations may, the stock is not touched, and the return keeps an empty list', async () => {
    for (const restock of [[], null, 'null']) {
      const g = await approvedReturn()
      const reply = await opsApi.receive(g.id, restock)
      expect(reply, String(restock)).toEqual({ ok: true, returnId: g.id, state: 'received', restocked: [] })
      expect(await returnOf(g.id)).toMatchObject({ state: 'received', received_by: operations.userId, restocked: [] })
      expect(await stocks(g)).toEqual([7, 8, 9])
      const audits = await auditsOf('return.received', g.id)
      expect(audits).toHaveLength(1)
      expect(audits[0]).toMatchObject({ actor: operations.userId, entity: 'return' })
      expect(audits[0]!.summary).toEqual({ orderNumber: g.p.number, restocked: [] })
    }
  })

  it('receives only what was approved, once: any other state is refused with the state it is in', async () => {
    const g = await approvedReturn()
    const requested = await requestReturn(g.p, [{ itemId: g.items[2]!.id, quantity: 1 }])
    expect(await ownerApi.receive(requested)).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'requested' })
    await h.postgres.query("update finance.return_requests set state = 'rejected' where id = $1", [requested])
    expect(await ownerApi.receive(requested)).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'rejected' })
    expect(await ownerApi.receive(randomUUID())).toEqual(NOT_FOUND)
    expect(await ownerApi.receive(g.id)).toMatchObject({ ok: true, state: 'received' })
    expect(await ownerApi.receive(g.id, [{ itemId: g.items[0]!.id, quantity: 1 }])).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'received' })
    expect(await stocks(g)).toEqual([7, 8, 9])
    expect(await auditsOf('return.received', g.id)).toHaveLength(1)
  })

  it('puts the quantities back for an owner, records each variant\'s stock from and to, and keeps what was restocked', async () => {
    const g = await approvedReturn()
    const [a, b] = g.items as [PaidItem, PaidItem]
    const reply = await ownerApi.receive(g.id, [{ itemId: b.id, quantity: 1 }, { itemId: a.id, quantity: 2 }])
    expect(reply.ok).toBe(true)
    expect(reply.state).toBe('received')
    const trail = [
      { itemId: a.id, variantId: a.variantId, quantity: 2, from: 7, to: 9 },
      { itemId: b.id, variantId: b.variantId, quantity: 1, from: 8, to: 9 },
    ].sort((x, y) => (x.variantId < y.variantId ? -1 : 1))
    expect(reply.restocked).toEqual(trail)
    expect(await stocks(g)).toEqual([9, 9, 9])
    expect(await returnOf(g.id)).toMatchObject({ state: 'received', received_by: owner.userId })
    expect(sorted((await returnOf(g.id)).restocked.map((entry: Row) => entry.itemId))).toEqual(sorted([a.id, b.id]))
    expect((await returnOf(g.id)).restocked).toEqual(expect.arrayContaining([{ itemId: a.id, quantity: 2 }, { itemId: b.id, quantity: 1 }]))
    const audits = await auditsOf('return.received', g.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.summary).toEqual({ orderNumber: g.p.number, restocked: trail })
    // The catalog's own audit trail sees the stock change too.
    const stockAudit = await h.row("select summary from public.audit_events where action = 'product_variants.update' and entity_id = $1 order by id desc limit 1", [a.variantId])
    expect(stockAudit.summary.changes.stock).toEqual({ from: 7, to: 9 })
    // A partial restock: fewer than the return held is allowed.
    const second = await approvedReturn()
    expect(await ownerApi.receive(second.id, [{ itemId: second.items[0]!.id, quantity: 1 }])).toMatchObject({ ok: true })
    expect(await stocks(second)).toEqual([8, 8, 9])
  })

  it('refuses a restock by operations by raising, and an owner\'s restock that does not fit the return, and changes nothing', async () => {
    const g = await approvedReturn()
    const [a, b, c] = g.items as [PaidItem, PaidItem, PaidItem]
    const other = await approvedReturn()
    expect(await sqlstate(opsApi.receive(g.id, [{ itemId: a.id, quantity: 1 }])), 'operations').toBe('42501')

    const refused: Array<[string, unknown]> = [
      ['an item that is not in the return', [{ itemId: c.id, quantity: 1 }]],
      ['an item of another order', [{ itemId: other.items[0]!.id, quantity: 1 }]],
      ['an unknown item', [{ itemId: randomUUID(), quantity: 1 }]],
      ['an item twice', [{ itemId: a.id, quantity: 1 }, { itemId: a.id, quantity: 1 }]],
      ['more than the return held', [{ itemId: a.id, quantity: 3 }]],
      ['more than the return held for the second item', [{ itemId: a.id, quantity: 2 }, { itemId: b.id, quantity: 2 }]],
      ['a quantity of zero', [{ itemId: a.id, quantity: 0 }]],
      ['a negative quantity', [{ itemId: a.id, quantity: -1 }]],
      ['a fractional quantity', [{ itemId: a.id, quantity: 1.5 }]],
      ['a quantity as text', [{ itemId: a.id, quantity: '1' }]],
      ['an extra key', [{ itemId: a.id, quantity: 1, note: 'x' }]],
      ['an entry that is not an object', [1]],
      ['an item id that is not a uuid', [{ itemId: 'x', quantity: 1 }]],
      ['more entries than a return can hold', Array.from({ length: 51 }, () => ({ itemId: randomUUID(), quantity: 1 }))],
    ]
    for (const [name, restock] of refused) {
      expect(await ownerApi.receive(g.id, restock), name).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    }
    // Not a list at all is a malformed call.
    for (const restock of [{}, '"x"', 5]) expect(await sqlstate(ownerApi.receive(g.id, restock)), JSON.stringify(restock)).toBe('22023')
    expect(await returnOf(g.id)).toMatchObject({ state: 'approved', received_by: null, restocked: null })
    expect(await stocks(g)).toEqual([7, 8, 9])
    expect(await auditsOf('return.received', g.id)).toEqual([])
    // And exactly what the return held is accepted.
    expect(await ownerApi.receive(g.id, [{ itemId: a.id, quantity: 2 }, { itemId: b.id, quantity: 1 }])).toMatchObject({ ok: true })
    expect(await stocks(g)).toEqual([9, 9, 9])
  })

  it('never puts a preorder line back on the shelf, and restocks the other lines of the same return', async () => {
    const preorder = await h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0, preorder: { capacity: 5 } })
    const normal = await h.physical(2500, 10)
    const p = await h.paid([{ variantId: preorder, quantity: 2 }, { variantId: normal, quantity: 2 }])
    const [pre, nor] = p.items as [PaidItem, PaidItem]
    expect((await reservationOf(p.id, preorder)).preorder).toBe(true)
    expect(await stockOf(preorder)).toBe(0)
    const id = await requestReturn(p, [{ itemId: pre.id, quantity: 2 }, { itemId: nor.id, quantity: 2 }])
    await approve(id)
    const reply = await ownerApi.receive(id, [{ itemId: pre.id, quantity: 2 }, { itemId: nor.id, quantity: 1 }])
    expect(reply).toEqual({ ok: true, returnId: id, state: 'received', restocked: [{ itemId: nor.id, variantId: normal, quantity: 1, from: 8, to: 9 }] })
    expect(await stockOf(preorder)).toBe(0)
    expect(await stockOf(normal)).toBe(9)
    expect((await returnOf(id)).restocked).toEqual([{ itemId: nor.id, quantity: 1 }])
    // The preorder's capacity is not stock: nothing about it changed either.
    expect((await h.row('select preorder_capacity from public.product_variants where id = $1', [preorder])).preorder_capacity).toBe(5)
  })

  it('does not change stock when an order is refunded, even in full and after it shipped; only receiving the goods does', async () => {
    const variant = await h.physical(4000, 10)
    const p = await h.paid([{ variantId: variant, quantity: 2 }])
    const item = p.items[0]!
    expect(await stockOf(variant)).toBe(8)
    const id = await requestReturn(p, [{ itemId: item.id, quantity: 2 }])
    expect(await ownerApi.decide(id, 'approved')).toMatchObject({ ok: true })
    await h.refundFully(p, owner.userId)
    expect((await orderOf(p.id)).status).toBe('refunded')
    expect(await stockOf(variant)).toBe(8)
    // The goods come back after the money did: receiving them, and saying so, is what restocks.
    expect(await ownerApi.receive(id, [{ itemId: item.id, quantity: 2 }])).toMatchObject({ ok: true, restocked: [{ itemId: item.id, variantId: variant, quantity: 2, from: 8, to: 10 }] })
    expect(await stockOf(variant)).toBe(10)
    const audits = await auditsOf('return.received', id)
    expect(audits[0]!.summary.restocked).toEqual([{ itemId: item.id, variantId: variant, quantity: 2, from: 8, to: 10 }])
  })

  it('adds the stock once when two calls arrive at once: one receives, the other is refused', async () => {
    const g = await approvedReturn()
    const [first, second] = [await session(owner), await session(owner)]
    const restock = [{ itemId: g.items[0]!.id, quantity: 2 }]
    const settled = await race(g.p.id, [() => api(first).receive(g.id, restock), () => api(second).receive(g.id, restock)])
    const replies = settled.map(fulfilledValue)
    expect(replies.filter((reply) => reply.ok === true)).toHaveLength(1)
    expect(replies.filter((reply) => reply.ok === false)).toEqual([{ ok: false, code: 'BAD_TRANSITION', state: 'received' }])
    expect(await stocks(g)).toEqual([9, 8, 9])
    expect(await auditsOf('return.received', g.id)).toHaveLength(1)
  })
})

// --- order_resolve ---------------------------------------------------------------------------------------------------

describe('order_resolve', () => {
  it('delivers an order whose stock came back: commits it once, creates the fulfilments and entitlements, one receipt, a fresh link', async () => {
    const phys = await h.physical(4000, 10)
    const book = await h.digital(3500)
    const p = await stuck([{ variantId: phys, quantity: 2 }, { variantId: book, quantity: 1 }], [phys])
    expect(await stockOf(phys)).toBe(0)
    expect(await count('finance.fulfillments', p.id)).toBe(0)
    expect(await count('finance.entitlements', p.id)).toBe(0)
    expect(await mailsOf(p.id, 'receipt')).toHaveLength(1)
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [phys])
    await h.postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 day' where id = $1", [p.id])

    expect(await ownerApi.resolve(p.id)).toEqual({ ok: true, orderNumber: p.number, status: 'paid' })
    expect(await orderOf(p.id)).toMatchObject({ status: 'paid', version: 3 })
    expect(Number((await h.row("select extract(epoch from (access_token_expires_at - now())) / 86400 as d from finance.orders where id = $1", [p.id])).d)).toBeGreaterThan(6.9)
    expect(await stockOf(phys)).toBe(8)
    expect((await reservationOf(p.id, phys)).state).toBe('committed')
    expect(await count('finance.fulfillments', p.id)).toBe(1)
    expect(await fulfilmentOf(p.items[0]!.id)).toMatchObject({ state: 'preparing' })
    expect(await count('finance.entitlements', p.id)).toBe(1)
    // The first receipt said the order was under review; the second is keyed apart and goes once.
    const receipts = (await mailsOf(p.id, 'receipt')).map((mail) => mail.dedupe_key).sort()
    expect(receipts).toEqual([`receipt:${p.id}`, `receipt:${p.id}:resolved`].sort())
    const audits = await auditsOf('order.resolved', p.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: owner.userId, entity: 'order' })
    expect(audits[0]!.summary).toEqual({ orderNumber: p.number, amount: p.total })
    // The attempt that paid is as it was, and it is listed under to_ship now.
    expect(idsOf((await ownerApi.list('to_ship', p.email)).rows)).toEqual([p.id])
    // Resolved once: the same call again is refused and the stock moves no more.
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'paid' })
    expect(await stockOf(phys)).toBe(8)
  })

  it('answers STOCK_UNAVAILABLE and changes nothing while one line is still short', async () => {
    const ok = await h.physical(4000, 10)
    const short = await h.physical(2500, 10)
    const p = await stuck([{ variantId: ok, quantity: 1 }, { variantId: short, quantity: 2 }], [short])
    const before = await orderOf(p.id)
    const reservations = await h.rows('select id, state from finance.inventory_reservations where order_id = $1 order by id', [p.id])
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'STOCK_UNAVAILABLE' })
    expect(await orderOf(p.id)).toEqual(before)
    expect(await h.rows('select id, state from finance.inventory_reservations where order_id = $1 order by id', [p.id])).toEqual(reservations)
    expect(await stockOf(ok)).toBe(10)
    expect(await stockOf(short)).toBe(0)
    expect(await count('finance.fulfillments', p.id)).toBe(0)
    expect(await count('finance.entitlements', p.id)).toBe(0)
    expect(await mailsOf(p.id, 'receipt')).toHaveLength(1)
    expect(await auditsOf('order.resolved', p.id)).toEqual([])
    // Fewer than it needs is still short; enough is not.
    await h.postgres.query('update public.product_variants set stock = 1 where id = $1', [short])
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'STOCK_UNAVAILABLE' })
    await h.postgres.query('update public.product_variants set stock = 2 where id = $1', [short])
    expect(await ownerApi.resolve(p.id)).toMatchObject({ ok: true })
    expect(await stockOf(short)).toBe(0)
    expect(await stockOf(ok)).toBe(9)
  })

  it('skips the lines already refunded in full, so the rest of the order can be delivered', async () => {
    const ok = await h.physical(4000, 10)
    const short = await h.physical(2500, 10)
    const book = await h.digital(3500)
    const p = await stuck([{ variantId: ok, quantity: 1 }, { variantId: short, quantity: 2 }, { variantId: book, quantity: 1 }], [short])
    const [okItem, shortItem, bookItem] = p.items as [PaidItem, PaidItem, PaidItem]
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'STOCK_UNAVAILABLE' })
    // The owner refunds the line that cannot be delivered, and a digital line too.
    await refundItems(p, [shortItem, bookItem])
    expect((await orderOf(p.id)).status).toBe('paid_needs_resolution')

    expect(await ownerApi.resolve(p.id)).toEqual({ ok: true, orderNumber: p.number, status: 'paid' })
    expect((await orderOf(p.id)).status).toBe('paid')
    expect(await stockOf(ok)).toBe(9)
    expect(await stockOf(short)).toBe(0)
    expect((await reservationOf(p.id, ok)).state).toBe('committed')
    expect((await reservationOf(p.id, short)).state).not.toBe('committed')
    expect(await h.rows('select order_item_id from finance.fulfillments where order_id = $1', [p.id])).toEqual([{ order_item_id: okItem.id }])
    expect(await count('finance.entitlements', p.id)).toBe(0)
    expect(await mailsOf(p.id, 'receipt')).toHaveLength(2)
  })

  it('waits for a refund in flight: nothing is committed for a line that refund may still take', async () => {
    const variant = await h.physical(4000, 10)
    const p = await stuck([{ variantId: variant, quantity: 1 }], [variant])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [variant])
    const asked = await askRefund(p, [{ item: p.items[0]!, amount: p.items[0]!.paid }])
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'uncertain', p_provider_refunded: null, p_error: 'TIMEOUT' })
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'REFUND_IN_FLIGHT' })
    expect(await stockOf(variant)).toBe(10)
    expect((await orderOf(p.id)).status).toBe('paid_needs_resolution')
    expect(await count('finance.fulfillments', p.id)).toBe(0)
    // The refund did not land: the order can be delivered.
    await h.postgres.query("update finance.refunds set created_at = now() - interval '16 minutes' where id = $1", [asked.refundId])
    expect(await h.call('refund_settle', { p_refund: asked.refundId, p_provider_refunded: asked.before })).toMatchObject({ status: 'failed' })
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: true, orderNumber: p.number, status: 'paid' })
    expect(await stockOf(variant)).toBe(9)
  })

  it('resolves a preorder line against its capacity and never touches its stock', async () => {
    const preorder = await h.makeVariant({ fulfillment: 'physical', price: 4000, stock: 0, preorder: { capacity: 3 } })
    const placed = await h.place([{ variantId: preorder, quantity: 2 }])
    const started = await h.startPayment(placed)
    await h.postgres.query('update public.product_variants set preorder_capacity = 1 where id = $1', [preorder])
    expect(await h.applyPayment(placed, started)).toMatchObject({ outcome: 'paid_needs_resolution' })
    expect(await ownerApi.resolve(placed.id)).toEqual({ ok: false, code: 'STOCK_UNAVAILABLE' })
    await h.postgres.query('update public.product_variants set preorder_capacity = 3 where id = $1', [preorder])
    expect(await ownerApi.resolve(placed.id)).toMatchObject({ ok: true, status: 'paid' })
    expect(await reservationOf(placed.id, preorder)).toMatchObject({ state: 'committed', preorder: true })
    expect(await stockOf(preorder)).toBe(0)
    expect(await count('finance.fulfillments', placed.id)).toBe(1)
  })

  it('answers PAYMENT_REVERSED and changes nothing while the paying payment\'s money went back at the provider: voided, or refunded in full; a part refunded is no reversal', async () => {
    const variant = await h.physical(4000, 10)
    const p = await stuck([{ variantId: variant, quantity: 1 }], [variant])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [variant])
    // The provider now calls the paying payment voided.
    expect(await fetched(p, { status: 'voided' })).toMatchObject({ outcome: 'not_paid' })
    const before = await orderOf(p.id)
    const reservations = await h.rows('select id, state from finance.inventory_reservations where order_id = $1 order by id', [p.id])
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'PAYMENT_REVERSED' })
    expect(await orderOf(p.id)).toEqual(before)
    expect(await h.rows('select id, state from finance.inventory_reservations where order_id = $1 order by id', [p.id])).toEqual(reservations)
    expect(await stockOf(variant)).toBe(10)
    expect(await count('finance.fulfillments', p.id)).toBe(0)
    expect(await mailsOf(p.id, 'receipt')).toHaveLength(1)
    expect(await auditsOf('order.resolved', p.id)).toEqual([])
    // Once the owner records the void as a refund, the order is refunded: nothing to resolve.
    const recorded = await h.call('refund_record_external', { p_actor: owner.userId, p_attempt: p.attemptId, p_review_payment: null, p_provider_refunded: 0, p_provider_status: 'voided', p_reason: 'إلغاء من لوحة البوابة' })
    expect(recorded).toMatchObject({ ok: true, amount: p.total })
    expect(await ownerApi.resolve(p.id)).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'refunded' })

    // Refunded in full at the provider, and not in the ledger yet: the same answer.
    const full = await h.physical(4000, 10)
    const q = await stuck([{ variantId: full, quantity: 1 }], [full])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [full])
    expect(await fetched(q, { status: 'refunded', refunded: q.total })).toMatchObject({ outcome: 'already_paid' })
    expect(await ownerApi.resolve(q.id)).toEqual({ ok: false, code: 'PAYMENT_REVERSED' })
    expect(await stockOf(full)).toBe(10)
    expect((await orderOf(q.id)).status).toBe('paid_needs_resolution')

    // A part refunded at the provider is no reversal, though Moyasar then calls the payment `refunded` too (what the
    // owner's refund of the missing line produces): the order is delivered.
    const part = await h.physical(4000, 10)
    const r = await stuck([{ variantId: part, quantity: 1 }], [part])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [part])
    expect(await fetched(r, { status: 'refunded', refunded: r.total - 1 })).toMatchObject({ outcome: 'already_paid' })
    expect(await h.row('select provider_status, provider_refunded_halalas from finance.payment_attempts where id = $1', [r.attemptId])).toEqual({
      provider_status: 'refunded',
      provider_refunded_halalas: r.total - 1,
    })
    expect(await ownerApi.resolve(r.id)).toEqual({ ok: true, orderNumber: r.number, status: 'paid' })
    expect(await stockOf(part)).toBe(9)
  })

  it('marks the audit row when the commit takes the order\'s coupon past its usage limit, as a late payment does', async () => {
    const variant = await h.physical(4000, 10)
    const p = await stuck([{ variantId: variant, quantity: 1 }], [variant])
    // The order's coupon, whose one use another order took while this one waited. A disabled coupon still commits:
    // the price was charged.
    const coupon = (
      await h.row("insert into public.coupons (code, kind, percent_bp, usage_limit, enabled) values ($1, 'percent', 1000, 1, false) returning id", [
        `OVER${Date.now()}${process.pid}`,
      ])
    ).id as string
    await h.postgres.query('update finance.orders set coupon_id = $2 where id = $1', [p.id, coupon])
    const taker = await h.place([{ variantId: await h.digital(1000), quantity: 1 }])
    await h.postgres.query("insert into finance.coupon_redemptions (coupon_id, order_id, state, expires_at) values ($1, $2, 'committed', now())", [coupon, taker.id])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [variant])

    expect(await ownerApi.resolve(p.id)).toEqual({ ok: true, orderNumber: p.number, status: 'paid' })
    expect(await h.row('select state from finance.coupon_redemptions where order_id = $1', [p.id])).toEqual({ state: 'committed' })
    const audits = await auditsOf('order.resolved', p.id)
    expect(audits).toHaveLength(1)
    expect(audits[0]!.summary).toEqual({ orderNumber: p.number, amount: p.total, couponOverLimit: true })
  })

  it('refuses an order that is not waiting for it, and one that is not there', async () => {
    const variant = await h.physical(4000, 10)
    const paid = await h.paid([{ variantId: variant, quantity: 1 }])
    expect(await ownerApi.resolve(paid.id)).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'paid' })
    const pending = await h.place([{ variantId: variant, quantity: 1 }])
    expect(await ownerApi.resolve(pending.id)).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'pending_payment' })
    const scarce = await h.physical(4000, 5)
    const waiting = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    await h.refundFully(waiting, owner.userId)
    expect(await ownerApi.resolve(waiting.id)).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'refunded' })
    expect(await stockOf(scarce)).toBe(5)
    expect(await count('finance.fulfillments', waiting.id)).toBe(0)
    expect(await ownerApi.resolve(randomUUID())).toEqual(NOT_FOUND)
    expect(await auditsOf('order.resolved', paid.id)).toEqual([])
  })

  it('resolves once when two calls arrive at once: one resolves, the other is refused, the stock moves once', async () => {
    const phys = await h.physical(4000, 10)
    const p = await stuck([{ variantId: phys, quantity: 2 }], [phys])
    await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [phys])
    const [first, second] = [await session(owner), await session(owner)]
    const settled = await race(p.id, [() => api(first).resolve(p.id), () => api(second).resolve(p.id)])
    const replies = settled.map(fulfilledValue)
    expect(replies.filter((reply) => reply.ok === true)).toHaveLength(1)
    expect(replies.filter((reply) => reply.ok === false)).toEqual([{ ok: false, code: 'NOT_RESOLVABLE', status: 'paid' }])
    expect(await stockOf(phys)).toBe(8)
    expect((await mailsOf(p.id, 'receipt')).map((mail) => mail.dedupe_key).sort()).toEqual([`receipt:${p.id}`, `receipt:${p.id}:resolved`].sort())
    expect(await auditsOf('order.resolved', p.id)).toHaveLength(1)
  })
})

// --- orders_alerts ---------------------------------------------------------------------------------------------------

describe('orders_alerts', () => {
  const NUMBERS = ['needsResolution', 'review', 'toShip', 'uncertainRefunds', 'unverifiedAttempts', 'exhaustedEvents', 'externalRefunds']
  const numbers = async (): Promise<Record<string, number>> => {
    const alerts = await ownerApi.alerts()
    return Object.fromEntries(NUMBERS.map((name) => [name, alerts[name] as number]))
  }
  const delta = (before: Record<string, number>, after: Record<string, number>): Record<string, number> =>
    Object.fromEntries(NUMBERS.map((name) => [name, after[name]! - before[name]!]))
  const zero = (over: Record<string, number> = {}): Record<string, number> => ({ ...Object.fromEntries(NUMBERS.map((name) => [name, 0])), ...over })

  it('has the shape the contract names, for an owner and for operations, counts and a list', async () => {
    for (const alerts of [await ownerApi.alerts(), await opsApi.alerts()]) {
      expect(keys(alerts)).toEqual([...NUMBERS, 'lowStock'].sort())
      for (const name of NUMBERS) expect(Number.isInteger(alerts[name]), name).toBe(true)
      expect(Array.isArray(alerts.lowStock)).toBe(true)
    }
  })

  it('moves orders needing resolution, orders to ship and open reviews when their cause is created, and back when it is settled', async () => {
    const base = await numbers()
    const phys = await h.physical(4000, 10)
    const scarce = await h.physical(3000, 5)

    const waiting = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    expect(delta(base, await numbers())).toEqual(zero({ needsResolution: 1 }))
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    await ownerApi.resolve(waiting.id)
    // Resolved, the order is paid and has a line to ship.
    expect(delta(base, await numbers())).toEqual(zero({ toShip: 1 }))
    await ownerApi.fulfil(waiting.id, [waiting.items[0]!.id], 'shipped', 'SMSA', 'T1')
    expect(delta(base, await numbers())).toEqual(zero())

    const shippable = await h.paid([{ variantId: phys, quantity: 1 }])
    expect(delta(base, await numbers())).toEqual(zero({ toShip: 1 }))
    const reviewPayment = await reviewOf(shippable)
    expect(delta(base, await numbers())).toEqual(zero({ toShip: 1, review: 1 }))
    await ownerApi.close(reviewPayment, REVIEW_REASON)
    expect(delta(base, await numbers())).toEqual(zero({ toShip: 1 }))
    await ownerApi.fulfil(shippable.id, [shippable.items[0]!.id], 'shipped', 'SMSA', 'T2')
    expect(delta(base, await numbers())).toEqual(zero())

    // A refund in full settles an order that was to ship.
    const refunded = await h.paid([{ variantId: phys, quantity: 1 }])
    expect(delta(base, await numbers())).toEqual(zero({ toShip: 1 }))
    await h.refundFully(refunded, owner.userId)
    expect(delta(base, await numbers())).toEqual(zero())
  })

  it('counts a review payment that has no order, and settles with a refund too', async () => {
    const base = await numbers()
    const invoice = randomUUID()
    const paymentId = randomUUID()
    const applied = await h.call('apply_verified_payment', {
      p_invoice_id: invoice,
      p_payment: { id: paymentId, status: 'paid', amount: 1234, currency: 'SAR', fee: 0, refunded: 0, invoiceId: invoice, sourceType: 'creditcard', sourceCompany: 'mada' },
      p_invoice: { id: invoice, status: 'paid', amount: 1234, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
    expect(applied).toMatchObject({ outcome: 'unknown_invoice' })
    expect(delta(base, await numbers())).toEqual(zero({ review: 1 }))
    expect(await ownerApi.close(paymentId, REVIEW_REASON)).toMatchObject({ ok: true })
    expect(delta(base, await numbers())).toEqual(zero())
  })

  it('moves uncertain refunds and external refunds, and unverified attempts and exhausted events, with their causes', async () => {
    const base = await numbers()
    // Digital orders: paid, they have nothing to ship, so only the cause under test moves a number.
    const variant = await h.digital(4000)

    // A refund whose outcome is unknown, until the job settles it from the provider's total.
    const p = await h.paid([{ variantId: variant, quantity: 1 }])
    const asked = await askRefund(p, [{ item: p.items[0]!, amount: 1000 }])
    await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'uncertain', p_provider_refunded: null, p_error: 'TIMEOUT' })
    expect(delta(base, await numbers())).toEqual(zero({ uncertainRefunds: 1 }))
    const settled = await h.call('refund_settle', { p_refund: asked.refundId, p_provider_refunded: asked.before + asked.amount })
    expect(settled).toMatchObject({ ok: true, status: 'succeeded' })
    expect(delta(base, await numbers())).toEqual(zero())

    // A refund still submitting is the job's while a check is scheduled; once none is (the job stops after 24 hours
    // without an answer) it waits for a person, and it is counted until it settles.
    const s = await h.paid([{ variantId: variant, quantity: 1 }])
    const waiting = await askRefund(s, [{ item: s.items[0]!, amount: 1000 }])
    expect(delta(base, await numbers())).toEqual(zero())
    await h.postgres.query("update finance.refunds set created_at = now() - interval '25 hours' where id = $1", [waiting.refundId])
    await h.call('refund_checked', { p_refund: waiting.refundId, p_error: 'HTTP_500' })
    expect(await h.row('select status, next_check_at from finance.refunds where id = $1', [waiting.refundId])).toEqual({ status: 'submitting', next_check_at: null })
    expect(delta(base, await numbers())).toEqual(zero({ uncertainRefunds: 1 }))
    expect(await h.call('refund_settle', { p_refund: waiting.refundId, p_provider_refunded: waiting.before + waiting.amount })).toMatchObject({ ok: true, status: 'succeeded' })
    expect(delta(base, await numbers())).toEqual(zero())

    // A refund made in the provider's dashboard, until the owner records it. An in-flight refund of our own is not one.
    const q = await h.paid([{ variantId: variant, quantity: 1 }])
    expect(await fetched(q, { refunded: 500 })).toMatchObject({ outcome: 'already_paid' })
    expect(delta(base, await numbers())).toEqual(zero({ externalRefunds: 1 }))
    const recorded = await h.call('refund_record_external', { p_actor: owner.userId, p_attempt: q.attemptId, p_review_payment: null, p_provider_refunded: 500, p_provider_status: 'refunded', p_reason: 'استرداد من لوحة البوابة' })
    expect(recorded).toMatchObject({ ok: true, amount: 500 })
    expect(delta(base, await numbers())).toEqual(zero())
    const r = await h.paid([{ variantId: variant, quantity: 1 }])
    const own = await askRefund(r, [{ item: r.items[0]!, amount: 1000 }])
    expect(await fetched(r, { refunded: 1000 })).toMatchObject({ outcome: 'already_paid' })
    expect(delta(base, await numbers())).toEqual(zero())
    await confirmRefund(own)
    expect(delta(base, await numbers())).toEqual(zero())

    // An attempt the job could not verify before its invoice was a day old, until a payment settles it.
    const placed = await h.place([{ variantId: variant, quantity: 1 }])
    const started = await h.startPayment(placed)
    await h.postgres.query("update finance.payment_attempts set invoice_expires_at = now() - interval '25 hours' where id = $1", [started.attemptId])
    await h.call('payment_attempt_checked', { p_attempt: started.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'HTTP_500' })
    expect((await h.row('select status, last_error from finance.payment_attempts where id = $1', [started.attemptId]))).toEqual({ status: 'expired', last_error: 'UNVERIFIED' })
    expect(delta(base, await numbers())).toEqual(zero({ unverifiedAttempts: 1 }))
    // A recheck the provider does not answer changes nothing; one it answers is the verification.
    const recheck = (ok: boolean): Promise<unknown> =>
      h.call('payment_attempt_checked', { p_attempt: started.attemptId, p_source: 'prompt', p_ok: ok, p_provider_status: ok ? 'expired' : null, p_error: ok ? null : 'HTTP_500' })
    await recheck(false)
    expect(delta(base, await numbers())).toEqual(zero({ unverifiedAttempts: 1 }))
    await recheck(true)
    expect((await h.row('select status, last_error from finance.payment_attempts where id = $1', [started.attemptId]))).toEqual({ status: 'expired', last_error: null })
    expect(delta(base, await numbers())).toEqual(zero())
    // A payment settles one too.
    const late = await h.place([{ variantId: variant, quantity: 1 }])
    const lateStarted = await h.startPayment(late)
    await h.postgres.query("update finance.payment_attempts set invoice_expires_at = now() - interval '25 hours' where id = $1", [lateStarted.attemptId])
    await h.call('payment_attempt_checked', { p_attempt: lateStarted.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'HTTP_500' })
    expect(delta(base, await numbers())).toEqual(zero({ unverifiedAttempts: 1 }))
    expect(await h.applyPayment(late, lateStarted)).toMatchObject({ outcome: 'paid' })
    expect(delta(base, await numbers())).toEqual(zero())

    // A webhook event the job gave up on stays counted until the owner dismisses it.
    const eventId = `${PREFIX}event-${(eventCounter += 1)}`
    await h.call('payment_event_record', { p_event_id: eventId, p_type: 'payment_paid', p_live: false, p_payment_id: randomUUID(), p_payload_hash: sha256(eventId) })
    for (let i = 0; i < 10; i += 1) await h.call('payment_event_result', { p_event_id: eventId, p_outcome: 'retry', p_error: 'HTTP_500' })
    expect((await h.row('select outcome from finance.payment_events where event_id = $1', [eventId])).outcome).toBe('exhausted')
    expect(delta(base, await numbers())).toEqual(zero({ exhaustedEvents: 1 }))
    expect(await sqlstate(opsApi.dismiss(eventId))).toBe('42501')
    expect(delta(base, await numbers())).toEqual(zero({ exhaustedEvents: 1 }))
    expect(await ownerApi.dismiss(eventId)).toEqual({ ok: true, eventId })
    expect(await h.row('select outcome, next_check_at from finance.payment_events where event_id = $1', [eventId])).toEqual({ outcome: 'dismissed', next_check_at: null })
    expect(await auditsOf('payment.event_dismissed', eventId)).toHaveLength(1)
    expect(await ownerApi.dismiss(eventId)).toEqual({ ok: false, code: 'NOT_EXHAUSTED' })
    expect(await ownerApi.dismiss(`${eventId}-none`)).toEqual(NOT_FOUND)
    expect(await sqlstate(ownerApi.dismiss(''))).toBe('22023')
    expect(delta(base, await numbers())).toEqual(zero())
    // An exhausted event whose payment the ledger has settled needs nobody.
    const settledEvent = `${PREFIX}event-${(eventCounter += 1)}`
    await h.call('payment_event_record', { p_event_id: settledEvent, p_type: 'payment_paid', p_live: false, p_payment_id: p.paymentId, p_payload_hash: sha256(settledEvent) })
    for (let i = 0; i < 10; i += 1) await h.call('payment_event_result', { p_event_id: settledEvent, p_outcome: 'retry', p_error: 'HTTP_500' })
    expect((await h.row('select outcome from finance.payment_events where event_id = $1', [settledEvent])).outcome).toBe('exhausted')
    expect(delta(base, await numbers())).toEqual(zero())
    expect(((await ownerApi.recon()).events as Row[]).map((entry) => entry.eventId)).not.toContain(settledEvent)
  })

  it('lists the enabled, published, stocked variants at or under their threshold, the fewest first, and no other', async () => {
    const low = await h.physical(1000, 2)
    const exactly = await h.physical(1000, 3)
    const above = await h.physical(1000, 4)
    const unset = await h.physical(1000, 0)
    const off = await h.physical(1000, 0)
    const preorder = await h.makeVariant({ fulfillment: 'physical', price: 1000, stock: 0, preorder: { capacity: 5 } })
    const archived = await h.physical(1000, 0)
    const book = await h.digital(1000)
    for (const variantId of [low, exactly, above, off, preorder, archived]) {
      await h.postgres.query('update public.product_variants set low_stock_threshold = 3 where id = $1', [variantId])
    }
    await h.postgres.query('update public.product_variants set enabled = false where id = $1', [off])
    await h.postgres.query("update public.products set status = 'archived' where id = (select product_id from public.product_variants where id = $1)", [archived])
    const listed = (await ownerApi.alerts()).lowStock as Row[]
    const mine = new Map(listed.map((entry) => [entry.variantId as string, entry]))
    expect([...mine.keys()].filter((id) => [low, exactly, above, unset, off, preorder, archived, book].includes(id)).sort()).toEqual([low, exactly].sort())
    const details = await h.row('select v.sku, p.title from public.product_variants v join public.products p on p.id = v.product_id where v.id = $1', [low])
    expect(mine.get(low)).toEqual({ variantId: low, sku: details.sku, title: details.title, stock: 2, threshold: 3 })
    expect(mine.get(exactly)).toMatchObject({ stock: 3, threshold: 3 })
    // The fewest first.
    const order = listed.map((entry) => entry.variantId as string)
    expect(order.indexOf(low)).toBeLessThan(order.indexOf(exactly))
    expect(listed.map((entry) => entry.stock as number)).toEqual([...listed.map((entry) => entry.stock as number)].sort((x, y) => x - y))
    // Raising the stock above the threshold takes it off the list again.
    await h.postgres.query('update public.product_variants set stock = 4 where id = $1', [low])
    expect(((await ownerApi.alerts()).lowStock as Row[]).map((entry) => entry.variantId)).not.toContain(low)
    // A sale that crosses the threshold lists it.
    const crossing = await h.physical(1000, 5)
    await h.postgres.query('update public.product_variants set low_stock_threshold = 3 where id = $1', [crossing])
    expect(((await ownerApi.alerts()).lowStock as Row[]).map((entry) => entry.variantId)).not.toContain(crossing)
    await h.paid([{ variantId: crossing, quantity: 2 }])
    expect(((await ownerApi.alerts()).lowStock as Row[]).find((entry) => entry.variantId === crossing)).toMatchObject({ stock: 3, threshold: 3 })
    const forOperations = ((await opsApi.alerts()).lowStock as Row[]).map((entry) => entry.variantId)
    expect(forOperations).toContain(crossing)
  })
})

// --- reconciliation_list ---------------------------------------------------------------------------------------------

describe('reconciliation_list', () => {
  const ATTEMPT_KEYS = ['amount', 'captured', 'checkCount', 'createdAt', 'currency', 'environment', 'errorCount', 'fee', 'fetchedAt', 'id', 'invoiceExpiresAt', 'lastError', 'orderId', 'orderNumber', 'paidAt', 'providerInvoiceId', 'providerPaymentId', 'providerRefunded', 'providerStatus', 'reasons', 'refunded', 'sourceCompany', 'sourceType', 'status']
  const attemptsOf = async (): Promise<Row[]> => (await ownerApi.recon()).attempts as Row[]
  const reasonsFor = async (attemptId: string): Promise<string[] | undefined> => (await attemptsOf()).find((entry) => entry.id === attemptId)?.reasons

  it('lists the attempts that need a person, each with why, and drops them when they are settled', async () => {
    const variant = await h.physical(4000, 30)
    // An uncertain creation, until the job proves it absent.
    const placed = await h.place([{ variantId: variant, quantity: 1 }])
    const begun = await h.call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })
    await h.call('payment_attempt_close', { p_attempt: begun.attemptId, p_status: 'uncertain', p_error: null })
    expect(await reasonsFor(begun.attemptId)).toEqual(['UNCERTAIN'])
    const entry = (await attemptsOf()).find((item) => item.id === begun.attemptId)!
    sameKeys(entry, ATTEMPT_KEYS)
    expect(entry).toMatchObject({ orderId: placed.id, orderNumber: placed.number, status: 'uncertain', environment: 'test', amount: placed.total, currency: 'SAR', refunded: 0, providerInvoiceId: null, providerPaymentId: null })
    expect(await h.call('payment_attempt_close', { p_attempt: begun.attemptId, p_status: 'abandoned', p_error: null })).toEqual({ ok: true, status: 'abandoned' })
    expect(await reasonsFor(begun.attemptId)).toBeUndefined()

    // An attempt the job could not verify, until a payment settles it.
    const second = await h.place([{ variantId: variant, quantity: 1 }])
    const started = await h.startPayment(second)
    await h.postgres.query("update finance.payment_attempts set invoice_expires_at = now() - interval '25 hours' where id = $1", [started.attemptId])
    await h.call('payment_attempt_checked', { p_attempt: started.attemptId, p_source: 'job', p_ok: false, p_provider_status: null, p_error: 'HTTP_500' })
    expect(await reasonsFor(started.attemptId)).toEqual(['UNVERIFIED'])
    expect(await h.applyPayment(second, started)).toMatchObject({ outcome: 'paid' })
    expect(await reasonsFor(started.attemptId)).toBeUndefined()

    // A paid attempt whose payment the provider now calls something else; a void ends when it is recorded as a refund.
    const voided = await h.paid([{ variantId: variant, quantity: 1 }])
    expect(await reasonsFor(voided.attemptId)).toBeUndefined()
    expect(await fetched(voided, { status: 'voided' })).toMatchObject({ outcome: 'not_paid' })
    expect(await reasonsFor(voided.attemptId)).toEqual(['PROVIDER_STATUS'])
    expect(((await attemptsOf()).find((item) => item.id === voided.attemptId) as Row).providerStatus).toBe('voided')
    const recorded = await h.call('refund_record_external', { p_actor: owner.userId, p_attempt: voided.attemptId, p_review_payment: null, p_provider_refunded: 0, p_provider_status: 'voided', p_reason: 'إلغاء من لوحة البوابة' })
    expect(recorded).toMatchObject({ ok: true, amount: voided.total })
    expect(await reasonsFor(voided.attemptId)).toBeUndefined()

    // A refund the provider holds and the ledger does not, until it is recorded; with the status odd as well, both reasons show.
    const external = await h.paid([{ variantId: variant, quantity: 1 }])
    await fetched(external, { refunded: 700 })
    expect(await reasonsFor(external.attemptId)).toEqual(['EXTERNAL_REFUND'])
    expect(((await attemptsOf()).find((item) => item.id === external.attemptId) as Row)).toMatchObject({ providerRefunded: 700, refunded: 0 })
    await fetched(external, { status: 'captured', refunded: 700 })
    expect(await reasonsFor(external.attemptId)).toEqual(['PROVIDER_STATUS', 'EXTERNAL_REFUND'])
    await fetched(external, { status: 'paid', refunded: 700 })
    expect(await h.call('refund_record_external', { p_actor: owner.userId, p_attempt: external.attemptId, p_review_payment: null, p_provider_refunded: 700, p_provider_status: 'paid', p_reason: 'استرداد من لوحة البوابة' })).toMatchObject({ ok: true })
    expect(await reasonsFor(external.attemptId)).toBeUndefined()
    // An attempt that is fine is not listed.
    const fine = await h.paid([{ variantId: variant, quantity: 1 }])
    expect(await reasonsFor(fine.attemptId)).toBeUndefined()
  })

  it('lists open review payments, in-flight refunds and unprocessed or exhausted events until they are settled', async () => {
    const variant = await h.physical(4000, 30)
    const p = await h.paid([{ variantId: variant, quantity: 1 }])
    const list = async (): Promise<Row> => ownerApi.recon()
    sameKeys(await list(), ['attempts', 'events', 'refunds', 'reviews'])

    // Review payments: open ones only.
    const reviewPayment = await reviewOf(p)
    const review = ((await list()).reviews as Row[]).find((entry) => entry.paymentId === reviewPayment)!
    sameKeys(review, ['amount', 'attemptId', 'closedAt', 'closedReason', 'createdAt', 'currency', 'environment', 'invoiceId', 'orderId', 'orderNumber', 'paymentId', 'providerRefunded', 'providerStatus', 'reason', 'refunded'])
    expect(review).toMatchObject({ orderId: p.id, orderNumber: p.number, attemptId: p.attemptId, reason: 'SECOND_PAYMENT', amount: p.total, refunded: 0, closedAt: null })
    expect(await ownerApi.close(reviewPayment, REVIEW_REASON)).toMatchObject({ ok: true })
    expect(((await list()).reviews as Row[]).map((entry) => entry.paymentId)).not.toContain(reviewPayment)

    // In-flight refunds, until the provider's answer ends them.
    const asked = await askRefund(p, [{ item: p.items[0]!, amount: 1000 }])
    const inFlight = ((await list()).refunds as Row[]).find((entry) => entry.id === asked.refundId)!
    sameKeys(inFlight, ['allocation', 'amount', 'attemptId', 'createdAt', 'error', 'id', 'nextCheckAt', 'orderId', 'orderNumber', 'providerRefundedAfter', 'providerRefundedBefore', 'reason', 'returnId', 'reviewPaymentId', 'source', 'status', 'succeededAt'])
    expect(inFlight).toMatchObject({ status: 'submitting', amount: 1000, orderNumber: p.number, orderId: p.id, attemptId: p.attemptId, providerRefundedBefore: 0 })
    await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'uncertain', p_provider_refunded: null, p_error: 'TIMEOUT' })
    expect((((await list()).refunds as Row[]).find((entry) => entry.id === asked.refundId) as Row).status).toBe('uncertain')
    await h.call('refund_settle', { p_refund: asked.refundId, p_provider_refunded: asked.before + asked.amount })
    expect(((await list()).refunds as Row[]).map((entry) => entry.id)).not.toContain(asked.refundId)
    const failed = await askRefund(p, [{ item: p.items[0]!, amount: 500 }])
    expect(((await list()).refunds as Row[]).map((entry) => entry.id)).toContain(failed.refundId)
    await h.call('refund_result', { p_refund: failed.refundId, p_outcome: 'failed', p_provider_refunded: null, p_error: 'REFUSED' })
    expect(((await list()).refunds as Row[]).map((entry) => entry.id)).not.toContain(failed.refundId)

    // Events: one the job has not processed yet, then processed; one it gave up on.
    const open = `${PREFIX}event-${(eventCounter += 1)}`
    await h.call('payment_event_record', { p_event_id: open, p_type: 'payment_paid', p_live: false, p_payment_id: p.paymentId, p_payload_hash: sha256(open) })
    const event = ((await list()).events as Row[]).find((entry) => entry.eventId === open)!
    sameKeys(event, ['attempts', 'error', 'eventId', 'live', 'nextCheckAt', 'outcome', 'paymentId', 'processedAt', 'receivedAt', 'type'])
    expect(event).toMatchObject({ type: 'payment_paid', processedAt: null, outcome: null, paymentId: p.paymentId, live: false })
    await h.call('payment_event_result', { p_event_id: open, p_outcome: 'paid', p_error: null })
    expect(((await list()).events as Row[]).map((entry) => entry.eventId)).not.toContain(open)
    const gaveUp = `${PREFIX}event-${(eventCounter += 1)}`
    await h.call('payment_event_record', { p_event_id: gaveUp, p_type: 'payment_paid', p_live: false, p_payment_id: randomUUID(), p_payload_hash: sha256(gaveUp) })
    for (let i = 0; i < 10; i += 1) await h.call('payment_event_result', { p_event_id: gaveUp, p_outcome: 'retry', p_error: 'HTTP_500' })
    expect(((await list()).events as Row[]).find((entry) => entry.eventId === gaveUp)).toMatchObject({ outcome: 'exhausted', attempts: 10 })
    expect(await ownerApi.dismiss(gaveUp)).toEqual({ ok: true, eventId: gaveUp })
    expect(((await list()).events as Row[]).map((entry) => entry.eventId)).not.toContain(gaveUp)
  })

  it('clears the mark the job left on work of the other mode once a recheck reaches the provider: off the screen, out of the count, and its order erasable', async () => {
    const placed = await h.place([{ variantId: await h.physical(4000, 30), quantity: 1 }])
    const started = await h.startPayment(placed)
    // What the job's claim does to an attempt of the other mode (20261007100000_fable_audit_payments.sql): parked with its
    // invoice, no due time, marked; the order's hold has ended since.
    await h.postgres.query("update finance.payment_attempts set status = 'expired', next_check_at = null, last_error = 'MODE_CHANGED' where id = $1", [started.attemptId])
    await h.postgres.query("update finance.orders set status = 'expired' where id = $1", [placed.id])
    const unverified = async (): Promise<number> => (await ownerApi.alerts()).unverifiedAttempts as number
    const erasable = async (): Promise<boolean> => (await h.row('select finance.order_erasable(o) as ok from finance.orders o where o.id = $1', [placed.id])).ok as boolean
    const before = await unverified()
    expect(await reasonsFor(started.attemptId)).toEqual(['MODE_CHANGED'])
    expect(await erasable()).toBe(false)
    const recheck = (ok: boolean): Promise<unknown> =>
      h.call('payment_attempt_checked', { p_attempt: started.attemptId, p_source: 'prompt', p_ok: ok, p_provider_status: ok ? 'expired' : null, p_error: ok ? null : 'HTTP_500' })
    // A recheck the provider does not answer leaves the mark.
    await recheck(false)
    expect(await reasonsFor(started.attemptId)).toEqual(['MODE_CHANGED'])
    expect(await unverified()).toBe(before)
    // The mode is switched back and the recheck reaches the provider: the invoice expired unpaid.
    await recheck(true)
    expect(await h.row('select status, last_error from finance.payment_attempts where id = $1', [started.attemptId])).toEqual({ status: 'expired', last_error: null })
    expect(await reasonsFor(started.attemptId)).toBeUndefined()
    expect(await unverified()).toBe(before - 1)
    expect(await erasable()).toBe(true)
  })
})

// --- review_close ----------------------------------------------------------------------------------------------------

describe('review_close', () => {
  it('closes an open review payment with a reason and an audit row, and it stays refundable', async () => {
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    const paymentId = await reviewOf(p)
    expect(await reviewOpen(paymentId)).toBe(true)
    const closed = await ownerApi.close(paymentId, `  ${REVIEW_REASON}  `)
    expect(closed).toEqual({ ok: true, paymentId, closedAt: expect.any(String) })
    expect(await h.row('select closed_reason, closed_at is not null as closed from finance.payment_reviews where provider_payment_id = $1', [paymentId])).toEqual({ closed_reason: REVIEW_REASON, closed: true })
    const audits = await auditsOf('payment.review_closed', paymentId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actor: owner.userId, entity: 'payment' })
    expect(audits[0]!.summary).toEqual({ amount: p.total, reviewReason: 'SECOND_PAYMENT', orderId: p.id })
    // The order itself is as it was: paid, with its line still to ship.
    expect((await orderOf(p.id)).status).toBe('paid')
    expect(await ownerApi.close(paymentId, 'مرة أخرى')).toEqual({ ok: false, code: 'ALREADY_CLOSED' })

    // Closed by hand, it can still be refunded; the refund does not overwrite the owner's reason.
    const key = randomUUID()
    const asked = await h.call('refund_request', {
      p_actor: owner.userId, p_order: p.id, p_attempt: null, p_review_payment: paymentId, p_amount: p.total, p_reason: 'استرداد دفعة مراجعة',
      p_allocation: {}, p_idempotency_key: key, p_request_hash: sha256(`hash:${key}`), p_return: null, p_provider_refunded: 0,
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
    expect(await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: p.total, p_error: null })).toMatchObject({ ok: true, status: 'succeeded' })
    expect((await h.row('select closed_reason from finance.payment_reviews where provider_payment_id = $1', [paymentId])).closed_reason).toBe(REVIEW_REASON)
    expect((await orderOf(p.id)).status).toBe('paid')
  })

  it('closes a review payment that has no order, and refuses what it cannot close', async () => {
    const invoice = randomUUID()
    const paymentId = randomUUID()
    const applied = await h.call('apply_verified_payment', {
      p_invoice_id: invoice,
      p_payment: { id: paymentId, status: 'paid', amount: 1234, currency: 'SAR', fee: 0, refunded: 0, invoiceId: invoice, sourceType: 'creditcard', sourceCompany: 'mada' },
      p_invoice: { id: invoice, status: 'paid', amount: 1234, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
    expect(applied).toMatchObject({ outcome: 'unknown_invoice' })
    expect(await ownerApi.close(randomUUID(), REVIEW_REASON)).toEqual(NOT_FOUND)
    for (const [name, reason] of [['no reason', null], ['a blank reason', '   '], ['a reason of 301 characters', 'x'.repeat(301)], ['a reason on two lines', 'a\nb'], ['the reason a refund writes', 'refunded']] as Array<[string, string | null]>) {
      expect(await sqlstate(ownerApi.close(paymentId, reason as string)), name).toBe('22023')
    }
    expect(await sqlstate(ownerApi.close('', REVIEW_REASON))).toBe('22023')
    expect(await sqlstate(ownerApi.close('x'.repeat(121), REVIEW_REASON))).toBe('22023')
    expect(await reviewOpen(paymentId)).toBe(true)
    expect(await ownerApi.close(paymentId, 'x'.repeat(300))).toMatchObject({ ok: true })
    expect(await reviewOpen(paymentId)).toBe(false)

    // A review payment closed by its own full refund is closed: nothing for a person to add.
    const p = await h.paid([{ variantId: await h.physical(4000, 10), quantity: 1 }])
    const refunded = await reviewOf(p)
    const key = randomUUID()
    const asked = await h.call('refund_request', {
      p_actor: owner.userId, p_order: p.id, p_attempt: null, p_review_payment: refunded, p_amount: p.total, p_reason: 'استرداد',
      p_allocation: {}, p_idempotency_key: key, p_request_hash: sha256(`hash:${key}`), p_return: null, p_provider_refunded: 0,
    })
    await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: p.total, p_error: null })
    expect(await reviewOpen(refunded)).toBe(false)
    expect(await ownerApi.close(refunded, REVIEW_REASON)).toEqual({ ok: false, code: 'ALREADY_CLOSED' })
    expect((await h.row('select closed_reason from finance.payment_reviews where provider_payment_id = $1', [refunded])).closed_reason).toBe('refunded')
  })
})

// --- locks and races -------------------------------------------------------------------------------------------------

describe('locks', () => {
  it('every writer waits for the order\'s row before it decides, and finishes when it is freed', async () => {
    // fulfillment_update
    const variant = await h.physical(4000, 20)
    const p = await h.paid([{ variantId: variant, quantity: 1 }])
    const shipped = await behindOrderLock(p.id, () => ownerApi.fulfil(p.id, [p.items[0]!.id], 'shipped', 'SMSA', 'T1'))
    expect(shipped).toMatchObject({ ok: true, changed: 1 })

    // return_decide, then return_receive
    const q = await h.paid([{ variantId: variant, quantity: 2 }])
    const id = await requestReturn(q, [{ itemId: q.items[0]!.id, quantity: 1 }])
    expect(await behindOrderLock(q.id, () => ownerApi.decide(id, 'approved'))).toMatchObject({ ok: true })
    expect(await behindOrderLock(q.id, () => ownerApi.receive(id, []))).toMatchObject({ ok: true })

    // order_resolve
    const scarce = await h.physical(3000, 5)
    const waiting = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    expect(await behindOrderLock(waiting.id, () => ownerApi.resolve(waiting.id))).toMatchObject({ ok: true })

    // review_close, for a payment that has an order
    const r = await h.paid([{ variantId: variant, quantity: 1 }])
    const reviewPayment = await reviewOf(r)
    expect(await behindOrderLock(r.id, () => ownerApi.close(reviewPayment, REVIEW_REASON))).toMatchObject({ ok: true })
  })

  it('decides on what it reads after the locks: a change committed while it waited is what it sees', async () => {
    // Each case: another transaction holds the order, the call queues behind it, the other changes something and commits.
    const settle = async (orderId: string, change: [string, unknown[]], run: () => Promise<any>): Promise<any> => {
      const holder = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
      await holder.connect()
      try {
        await holder.query('begin')
        await holder.query('select 1 from finance.orders where id = $1 for update', [orderId])
        const running = run()
        running.catch(() => undefined)
        expect(await settledWithin(running, 700)).toBe('blocked')
        await holder.query(change[0], change[1])
        await holder.query('commit')
        return await running
      } finally {
        await holder.end()
      }
    }
    const variant = await h.physical(4000, 10)

    // fulfillment_update: the order was refunded meanwhile.
    const p = await h.paid([{ variantId: variant, quantity: 2 }])
    const refunded = await settle(p.id, ["update finance.orders set status = 'refunded' where id = $1", [p.id]], () => ownerApi.fulfil(p.id, [p.items[0]!.id], 'shipped', 'SMSA', 'T1'))
    expect(refunded).toEqual({ ok: false, code: 'ORDER_NOT_PAID', status: 'refunded' })
    expect((await fulfilmentOf(p.items[0]!.id)).state).toBe('preparing')

    // return_decide and return_receive: the return moved on meanwhile.
    const q = await h.paid([{ variantId: variant, quantity: 3 }])
    const asked = await requestReturn(q, [{ itemId: q.items[0]!.id, quantity: 1 }])
    const decided = await settle(q.id, ["update finance.return_requests set state = 'approved' where id = $1", [asked]], () => ownerApi.decide(asked, 'rejected'))
    expect(decided).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'approved' })
    const received = await settle(q.id, ["update finance.return_requests set state = 'received' where id = $1", [asked]], () => ownerApi.receive(asked, [{ itemId: q.items[0]!.id, quantity: 1 }]))
    expect(received).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'received' })
    expect((await returnOf(asked)).staff_note).toBeNull()
    expect(await stockOf(variant)).toBe(10 - 2 - 3)

    // order_resolve: the stock went again meanwhile, and then someone else resolved the order.
    const scarce = await h.physical(3000, 5)
    const waiting = await stuck([{ variantId: scarce, quantity: 1 }], [scarce])
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    expect(await settle(waiting.id, ['update public.product_variants set stock = 0 where id = $1', [scarce]], () => ownerApi.resolve(waiting.id))).toEqual({ ok: false, code: 'STOCK_UNAVAILABLE' })
    expect((await orderOf(waiting.id)).status).toBe('paid_needs_resolution')
    await h.postgres.query('update public.product_variants set stock = 5 where id = $1', [scarce])
    expect(await settle(waiting.id, ["update finance.orders set status = 'paid' where id = $1", [waiting.id]], () => ownerApi.resolve(waiting.id))).toEqual({ ok: false, code: 'NOT_RESOLVABLE', status: 'paid' })
    expect(await stockOf(scarce)).toBe(5)

    // review_close: the review payment was closed meanwhile.
    const r = await h.paid([{ variantId: variant, quantity: 1 }])
    const reviewPayment = await reviewOf(r)
    const closed = await settle(r.id, ["update finance.payment_reviews set closed_at = now(), closed_reason = 'someone else' where provider_payment_id = $1", [reviewPayment]], () => ownerApi.close(reviewPayment, REVIEW_REASON))
    expect(closed).toEqual({ ok: false, code: 'ALREADY_CLOSED' })
    expect((await h.row('select closed_reason from finance.payment_reviews where provider_payment_id = $1', [reviewPayment])).closed_reason).toBe('someone else')
  })

  it('a restock waits for the variant\'s row, after the order and the return, and then applies', async () => {
    const variant = await h.physical(4000, 10)
    const p = await h.paid([{ variantId: variant, quantity: 2 }])
    const id = await requestReturn(p, [{ itemId: p.items[0]!.id, quantity: 2 }])
    await approve(id)
    const lock = await h.holdLock('select 1 from public.product_variants where id = $1 for update', [variant])
    const running = ownerApi.receive(id, [{ itemId: p.items[0]!.id, quantity: 2 }])
    running.catch(() => undefined)
    let waited: unknown
    try {
      waited = await settledWithin(running, 900)
      // It already holds the order's row and the return's: another writer of them is queued behind it.
      expect(await h.rows('select 1 from finance.orders where id = $1 for update nowait', [p.id]).then(() => 'free', (error: { code?: string }) => error.code)).toBe('55P03')
    } finally {
      await lock.release()
    }
    expect(waited).toBe('blocked')
    expect(await running).toMatchObject({ ok: true, state: 'received' })
    expect(await stockOf(variant)).toBe(10)
  })
})

describe('races between staff and the money functions', () => {
  it('shipping an item against a refund of that same item: no deadlock, and nothing ships for money that is going back, whichever comes first', async () => {
    for (const shipFirst of [true, false]) {
      const variant = await h.physical(4000, 10)
      const p = await h.paid([{ variantId: variant, quantity: 1 }])
      const item = p.items[0]!
      const asked = await askRefund(p, [{ item, amount: item.paid }])
      const staff = await session(owner)
      const ship = (): Promise<unknown> => api(staff).fulfil(p.id, [item.id], 'shipped', 'SMSA', 'T1')
      const settle = (): Promise<unknown> => confirmRefund(asked, h.pool[1])
      const [first, second] = await race(p.id, shipFirst ? [ship, settle] : [settle, ship])
      const shipped = fulfilledValue(shipFirst ? first! : second!)
      const refund = fulfilledValue(shipFirst ? second! : first!)
      // The refund lands whichever way: it does not touch the fulfilment.
      expect(refund).toMatchObject({ ok: true, status: 'succeeded' })
      const state = (await fulfilmentOf(item.id)).state
      const mails = await mailsOf(p.id, 'order_shipped')
      // Before the refund lands the ship waits for it (REFUND_IN_FLIGHT); after it the item is refunded (ITEM_REFUNDED).
      expect(shipped).toEqual({ ok: false, code: shipFirst ? 'REFUND_IN_FLIGHT' : 'ITEM_REFUNDED', itemIds: [item.id] })
      expect(state).toBe('preparing')
      expect(mails).toHaveLength(0)
      expect((await h.call('payment_state', { p_order_number: p.number, p_access_token_hash: p.hash, p_mode: 'test' })).state).toBe('paid')
      expect((await orderOf(p.id)).status).toBe('paid')
    }
  })

  it('resolving an order against a refund of that same order: no deadlock, and the end state is one of the two valid orders of events', async () => {
    for (const resolveFirst of [true, false]) {
      const variant = await h.physical(4000, 10)
      const p = await stuck([{ variantId: variant, quantity: 2 }], [variant])
      await h.postgres.query('update public.product_variants set stock = 10 where id = $1', [variant])
      // The refund covers every item and the shipping: the whole order.
      const itemsPaid = p.items.reduce((sum, item) => sum + item.paid, 0)
      const asked = await askRefund(p, p.items.map((item) => ({ item, amount: item.paid })), p.total - itemsPaid)
      const staff = await session(owner)
      const resolve = (): Promise<unknown> => api(staff).resolve(p.id)
      const settle = (): Promise<unknown> => confirmRefund(asked, h.pool[2])
      const [first, second] = await race(p.id, resolveFirst ? [resolve, settle] : [settle, resolve])
      const resolved = fulfilledValue(resolveFirst ? first! : second!)
      const refund = fulfilledValue(resolveFirst ? second! : first!)
      expect(refund).toMatchObject({ ok: true, status: 'succeeded' })
      expect((await orderOf(p.id)).status).toBe('refunded')
      // Either way nothing is delivered and no stock is taken: before the refund lands the resolution waits for it, after it there is nothing to deliver.
      expect(resolved).toEqual(resolveFirst ? { ok: false, code: 'REFUND_IN_FLIGHT' } : { ok: false, code: 'NOT_RESOLVABLE', status: 'refunded' })
      expect(await stockOf(variant)).toBe(10)
      expect(await count('finance.fulfillments', p.id)).toBe(0)
    }
  })

  it('receiving, deciding, a new return request and a file attached to a waiting digital line, all at one order: no deadlock, and each does what it does', async () => {
    const phys = await h.physical(4000, 10)
    const book = await h.digital(3500)
    const p = await h.paid([{ variantId: phys, quantity: 3 }, { variantId: book, quantity: 1 }])
    const [physItem, bookItem] = p.items as [PaidItem, PaidItem]
    const approved = await requestReturn(p, [{ itemId: physItem.id, quantity: 1 }])
    await approve(approved)
    const waiting = await requestReturn(p, [{ itemId: physItem.id, quantity: 1 }])
    expect((await h.row('select asset_id is null as waiting from finance.entitlements where order_item_id = $1', [bookItem.id])).waiting).toBe(true)
    const [receiver, decider] = [await session(owner), await session(owner)]
    const settled = await race(p.id, [
      () => api(receiver).receive(approved, [{ itemId: physItem.id, quantity: 1 }]),
      () => h.call('paid_asset_set', { p_actor: owner.userId, p_variant: book, p_storage_key: `assets/${book}/${randomUUID()}`, p_filename: 'كتاب.pdf', p_mime: 'application/pdf', p_bytes: 1000 }, h.pool[3]),
      () => api(decider).decide(waiting, 'approved'),
      () => h.call('return_request_create', { p_order_number: p.number, p_access_token_hash: p.hash, p_items: [{ itemId: physItem.id, quantity: 1 }], p_reason: 'سبب آخر', p_ip_hash: h.ipHash(), p_mode: 'test' }, h.pool[4]),
    ])
    const [received, filed, decided, requested] = settled.map(fulfilledValue)
    expect(received).toMatchObject({ ok: true, state: 'received' })
    expect(filed).toMatchObject({ ok: true, filled: 1 })
    expect(decided).toMatchObject({ ok: true, state: 'approved' })
    expect(requested).toMatchObject({ ok: true })
    expect(await stockOf(phys)).toBe(8)
    expect((await h.row('select asset_id is not null as filled from finance.entitlements where order_item_id = $1', [bookItem.id])).filled).toBe(true)
    expect(await count('finance.return_requests', p.id)).toBe(3)
  })

  it('receiving goods against deciding the request: no deadlock, and the end state is one of the two valid orders of events', async () => {
    for (const decideFirst of [true, false]) {
      const variant = await h.physical(4000, 10)
      const p = await h.paid([{ variantId: variant, quantity: 2 }])
      const item = p.items[0]!
      const id = await requestReturn(p, [{ itemId: item.id, quantity: 2 }])
      const [decider, receiver] = [await session(owner), await session(owner)]
      const decide = (): Promise<unknown> => api(decider).decide(id, 'approved')
      const receive = (): Promise<unknown> => api(receiver).receive(id, [{ itemId: item.id, quantity: 2 }])
      const [first, second] = await race(p.id, decideFirst ? [decide, receive] : [receive, decide])
      const decided = fulfilledValue(decideFirst ? first! : second!)
      const received = fulfilledValue(decideFirst ? second! : first!)
      if (decideFirst) {
        // Approved, then received: the goods are back on the shelf.
        expect(decided).toMatchObject({ ok: true, state: 'approved' })
        expect(received).toMatchObject({ ok: true, state: 'received' })
        expect((await returnOf(id)).state).toBe('received')
        expect(await stockOf(variant)).toBe(10)
      } else {
        // Received too early (not yet approved): refused, nothing restocked; the decision then lands.
        expect(received).toEqual({ ok: false, code: 'BAD_TRANSITION', state: 'requested' })
        expect(decided).toMatchObject({ ok: true, state: 'approved' })
        expect((await returnOf(id)).state).toBe('approved')
        expect(await stockOf(variant)).toBe(8)
      }
    }
  })
})
