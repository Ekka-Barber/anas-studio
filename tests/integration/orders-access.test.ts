// P08 round 7: the buyer's order page, link recovery and return request of
// `supabase/migrations/20261002140000_delivery.sql` against the real local
// database: `order_access`, `order_recover_list`, `order_recover_apply` and
// `return_request_create`, and the grants of every function of the migration. The
// server-only functions are called as `service_role` (the Edge Functions' role,
// D32) through direct sessions; every order goes through `checkout_create` and is
// paid by `apply_verified_payment` (the shared fixtures of `support.ts`). What
// only the database could write (an aged expiry, a shipped item, a status) is
// written as the local `postgres` superuser. Recovery is driven the way the
// `orders` function drives it: both SQL functions on every request, the links
// derived by `recoveryItems`. Nothing here reaches Moyasar or sends a mail.
// This file switches `finance.commerce_settings.checkout_enabled` on, saved and
// restored by the fixtures; every fixture carries a per-run unique slug, SKU or
// email.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type RecoverableOrder, recoveryItems } from '../../supabase/functions/_shared/orders.ts'
import { orderAccessToken, orderAccessTokenHash } from '../../supabase/functions/_shared/tokens.ts'
import { commerceHarness, type Harness, type Paid, type Row, settledWithin, sha256, signIn, uniqueEmail } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const PEPPER = `orders-access-pepper-${randomUUID()}`
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const keys = (value: object): string[] => Object.keys(value).sort()

let h: Harness
let owner: { userId: string; email: string }

beforeAll(async () => {
  h = await commerceHarness(PEPPER)
  owner = await h.makeStaff('owner')
})

afterAll(async () => {
  await h.stop()
})

// --- fixtures -----------------------------------------------------------------------------------------------------

const access = (p: { number: string; hash: string }, over: Record<string, unknown> = {}): Promise<any> =>
  h.call('order_access', { p_order_number: p.number, p_access_token_hash: p.hash, p_ip_hash: h.ipHash(), p_mode: 'test', ...over })

const setState = (itemId: string, state: 'preparing' | 'shipped' | 'delivered'): Promise<unknown> =>
  h.postgres.query(
    `update finance.fulfillments
        set state = $2::text, carrier = case when $2::text = 'preparing' then null else 'SMSA' end,
            tracking = case when $2::text = 'preparing' then null else 'TRK-' || $1::text end,
            shipped_at = case when $2::text <> 'preparing' then now() end
      where order_item_id = $1`,
    [itemId, state],
  )
const setStatus = (orderId: string, status: string): Promise<unknown> => h.postgres.query('update finance.orders set status = $2 where id = $1', [orderId, status])
const setExpiry = (orderId: string, expiry: string): Promise<unknown> =>
  h.postgres.query(`update finance.orders set access_token_expires_at = ${expiry} where id = $1`, [orderId])
const orderOf = (id: string): Promise<Row> => h.row('select * from finance.orders where id = $1', [id])
const itemOf = (p: Paid, variantId: string) => p.items.find((item) => item.variantId === variantId)!

/** A paid file for a digital variant, written the way the owner's upload ends (`paid_asset_set`). */
async function attachFile(variantId: string): Promise<{ key: string }> {
  const key = `assets/${variantId}/${randomUUID()}`
  const reply = await h.call('paid_asset_set', {
    p_actor: owner.userId,
    p_variant: variantId,
    p_storage_key: key,
    p_filename: 'كتاب.pdf',
    p_mime: 'application/pdf',
    p_bytes: 1000,
  })
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true })
  return { key }
}

// --- grants ---------------------------------------------------------------------------------------------------------

const SERVER_ONLY = [
  'public.order_access(text, text, text, text)',
  'public.order_recover_list(text, text, text)',
  'public.order_recover_apply(text, jsonb)',
  'public.download_issue(text, text, uuid, text, text, text)',
  'public.download_redeem(text, text, text)',
  'public.paid_asset_set(uuid, uuid, text, text, text, bigint)',
  'public.paid_files_sweep_candidates(integer)',
  'public.return_request_create(text, text, jsonb, text, text, text)',
]

describe('grants', () => {
  const can = async (role: string, signature: string): Promise<boolean> =>
    (await h.row('select has_function_privilege($1, $2, $3) as ok', [role, signature, 'execute'])).ok as boolean

  it.each(SERVER_ONLY)('%s: service_role only', async (signature) => {
    expect(await can('service_role', signature)).toBe(true)
    expect(await can('authenticated', signature)).toBe(false)
    expect(await can('anon', signature)).toBe(false)
  })

  it('the returnable-quantity helper is for no API role at all, the service role included', async () => {
    for (const role of ['service_role', 'authenticated', 'anon']) expect(await can(role, 'finance.item_returnable(uuid)')).toBe(false)
  })
})

// --- order_access -----------------------------------------------------------------------------------------------------

describe('order_access', () => {
  it('shows a placed order that is not paid yet: its payment, its lines and nothing about shipping or files', async () => {
    const placed = await h.place([{ variantId: await h.physical(), quantity: 2 }])
    const before = await access(placed)
    expect(keys(before)).toEqual(['items', 'ok', 'order', 'payment', 'returns'])
    expect(before.ok).toBe(true)
    expect(before.order).toMatchObject({ orderNumber: placed.number, status: 'pending_payment', total: placed.total, environment: 'test', paidAt: null, refunded: 0, testMode: true })
    expect(before.payment).toEqual({ state: 'pending' })
    expect(before.returns).toEqual([])
    expect(before.items).toHaveLength(1)
    expect(before.items[0]).toMatchObject({ quantity: 2, fulfillment: 'physical', preorder: null, returnable: 0 })
    expect(keys(before.items[0])).toEqual(['fulfillment', 'itemId', 'preorder', 'quantity', 'returnable', 'title', 'variantTitle'])

    // With an invoice the page may offer it: the same view the return page reads, and the token matched.
    const started = await h.startPayment(placed)
    const after = await access(placed)
    expect(after.payment).toEqual({ state: 'pending', invoiceUrl: `http://127.0.0.1:54390/invoices/${started.invoiceId}` })
  })

  it('shows a paid order line by line, with the exact keys of every kind of item, and leaks nothing', async () => {
    const book = await h.digital(3500)
    const waiting = await h.digital(2000)
    const printed = await h.physical(4000, 10)
    const signedEdition = await h.signed(9000, 10)
    const preorder = await h.makeVariant({ fulfillment: 'physical', price: 5000, stock: 0, preorder: { capacity: 5 } })
    const { key: storageKey } = await attachFile(book)
    const paid = await h.paid([
      { variantId: book, quantity: 1 },
      { variantId: waiting, quantity: 1 },
      { variantId: printed, quantity: 3 },
      { variantId: signedEdition, quantity: 1 },
      { variantId: preorder, quantity: 1 },
    ])
    await setState(itemOf(paid, printed).id, 'shipped')
    await setState(itemOf(paid, signedEdition).id, 'delivered')

    const reply = await access(paid)
    expect(keys(reply)).toEqual(['items', 'ok', 'order', 'payment', 'returns'])
    expect(keys(reply.order)).toEqual([
      'currency', 'discount', 'environment', 'holdExpiresAt', 'id', 'lines', 'orderNumber', 'paidAt', 'refunded', 'shipping', 'status', 'subtotal', 'testMode', 'total',
    ])
    expect(reply.order).toMatchObject({ id: paid.id, orderNumber: paid.number, status: 'paid', total: paid.total, refunded: 0, testMode: true })
    expect(reply.order.paidAt).toEqual(expect.any(String))
    expect(reply.order.lines).toHaveLength(5)
    expect(reply.payment).toEqual({ state: 'paid' })
    expect(reply.returns).toEqual([])
    expect(reply.items.map((item: Row) => item.itemId)).toEqual(paid.items.map((item) => item.id))

    const by = (variantId: string): Row => reply.items.find((item: Row) => item.itemId === itemOf(paid, variantId).id)
    // A digital item with its file: the button works.
    expect(by(book)).toMatchObject({ fulfillment: 'digital', quantity: 1, preorder: null, returnable: 0, download: { available: true, revoked: false } })
    expect(keys(by(book))).toEqual(['download', 'fulfillment', 'itemId', 'preorder', 'quantity', 'returnable', 'title', 'variantTitle'])
    // A digital item whose file does not exist yet: granted, but nothing to ask for.
    expect(by(waiting)).toMatchObject({ download: { available: false, revoked: false }, returnable: 0 })
    // A printed item that shipped: its state, carrier and tracking, and what may be returned.
    expect(by(printed)).toMatchObject({ fulfillment: 'physical', quantity: 3, state: 'shipped', carrier: 'SMSA', tracking: `TRK-${itemOf(paid, printed).id}`, returnable: 3 })
    expect(keys(by(printed))).toEqual(['carrier', 'fulfillment', 'itemId', 'preorder', 'quantity', 'returnable', 'state', 'title', 'variantTitle', 'tracking'].sort())
    expect(by(signedEdition)).toMatchObject({ fulfillment: 'signed', state: 'delivered', returnable: 1 })
    // A preorder: the note and date the buyer was shown, still being prepared, nothing to return yet.
    expect(by(preorder)).toMatchObject({ state: 'preparing', returnable: 0, preorder: { shipsOn: '2030-01-01', note: 'يصلك بعد الطباعة' } })
    expect(keys(by(preorder))).toEqual(['fulfillment', 'itemId', 'preorder', 'quantity', 'returnable', 'state', 'title', 'variantTitle'])

    // No contact detail, no provider id, no storage key, no token and nothing the link is derived from, anywhere in the reply.
    const text = JSON.stringify(reply)
    const secrets = [
      paid.email, 'مشترٍ', '966501234567', 'تبوك شارع الرئيسي', paid.attemptId, paid.invoiceId, paid.paymentId, paid.token, paid.hash, paid.key,
      storageKey, storageKey.split('/')[2]!, 'كتاب.pdf', 'customer', 'provider',
    ]
    for (const secret of secrets) expect(text, secret).not.toContain(secret)
    // No link of any kind: a paid order offers no invoice.
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('answers NOT_FOUND, and only that, for an unknown number, a wrong, missing or expired token and the other mode', async () => {
    const paid = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const other = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const live = await h.place([{ variantId: await h.digital(), quantity: 1 }], { environment: 'live' })

    // The right token: the order.
    expect((await access(paid)).ok).toBe(true)
    // The number is trimmed and case-folded like everywhere else.
    expect((await access(paid, { p_order_number: ` ${paid.number.toLowerCase()} ` })).ok).toBe(true)

    expect(await access(paid, { p_order_number: 'AAAAAAAA' })).toEqual(NOT_FOUND)
    expect(await access(paid, { p_access_token_hash: other.hash })).toEqual(NOT_FOUND)
    expect(await access(paid, { p_access_token_hash: '0'.repeat(64) })).toEqual(NOT_FOUND)
    expect(await access(paid, { p_access_token_hash: null })).toEqual(NOT_FOUND)
    expect(await access(paid, { p_order_number: null })).toEqual(NOT_FOUND)

    // An expired link: the right token is not enough.
    await setExpiry(paid.id, "now() - interval '1 second'")
    expect(await access(paid)).toEqual(NOT_FOUND)
    await setExpiry(paid.id, "now() + interval '1 day'")
    expect((await access(paid)).ok).toBe(true)

    // The configured mode is bound: an order of the other mode is not found, whichever way the mismatch goes.
    expect(await access(live)).toEqual(NOT_FOUND)
    expect(await access(paid, { p_mode: 'live' })).toEqual(NOT_FOUND)
    expect((await access(live, { p_mode: 'live' })).ok).toBe(true)
  })

  it('shows an order under review, an expired one, a cancelled one and a refunded one in their own words', async () => {
    const owned = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    await setStatus(owned.id, 'paid_needs_resolution')
    expect(await access(owned)).toMatchObject({ order: { status: 'paid_needs_resolution' }, payment: { state: 'needs_resolution' } })

    const expired = await h.place([{ variantId: await h.digital(), quantity: 1 }])
    await setStatus(expired.id, 'expired')
    expect(await access(expired)).toMatchObject({ order: { status: 'expired' }, payment: { state: 'expired' } })

    const cancelled = await h.place([{ variantId: await h.digital(), quantity: 1 }])
    expect(await h.call('checkout_cancel', { p_order_number: cancelled.number, p_access_token_hash: cancelled.hash })).toMatchObject({ ok: true, status: 'cancelled' })
    expect(await access(cancelled)).toMatchObject({ order: { status: 'cancelled' }, payment: { state: 'cancelled' } })

    // A real full refund: the order's status, the refunded total, the files revoked, nothing returnable.
    const book = await h.digital(3500)
    await attachFile(book)
    const printed = await h.physical(4000, 10)
    const refunded = await h.paid([{ variantId: book, quantity: 1 }, { variantId: printed, quantity: 1 }])
    await setState(itemOf(refunded, printed).id, 'shipped')
    expect((await access(refunded)).items.find((item: Row) => item.fulfillment === 'physical').returnable).toBe(1)
    await h.refundFully(refunded, owner.userId)
    const reply = await access(refunded)
    expect(reply.order).toMatchObject({ status: 'refunded', refunded: refunded.total })
    expect(reply.payment).toEqual({ state: 'refunded' })
    expect(reply.items.find((item: Row) => item.fulfillment === 'digital').download).toEqual({ available: false, revoked: true })
    expect(reply.items.find((item: Row) => item.fulfillment === 'physical').returnable).toBe(0)
  })

  it('counts a partial refund in `refunded` and keeps the other lines downloadable', async () => {
    const book = await h.digital(3500)
    const second = await h.digital(2000)
    await attachFile(book)
    await attachFile(second)
    const p = await h.paid([{ variantId: book, quantity: 1 }, { variantId: second, quantity: 1 }])
    const refundKey = randomUUID()
    const asked = await h.call('refund_request', {
      p_actor: owner.userId, p_order: p.id, p_attempt: p.attemptId, p_review_payment: null, p_amount: 2000, p_reason: 'استرداد جزئي',
      p_allocation: { items: [{ itemId: itemOf(p, second).id, amount: 2000 }], shipping: 0 },
      p_idempotency_key: refundKey, p_request_hash: '1'.repeat(64), p_return: null, p_provider_refunded: 0,
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
    expect(await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: 2000, p_error: null })).toMatchObject({ ok: true, status: 'succeeded' })
    const reply = await access(p)
    expect(reply.order).toMatchObject({ status: 'paid', refunded: 2000 })
    expect(reply.items.find((item: Row) => item.itemId === itemOf(p, book).id).download).toEqual({ available: true, revoked: false })
    expect(reply.items.find((item: Row) => item.itemId === itemOf(p, second).id).download).toEqual({ available: false, revoked: true })
  })

  it('throttles 120 requests an hour per IP hash with 54000, wrong tokens included, and another IP is not affected', async () => {
    const ip = h.ipHash()
    const probe = { p_order_number: 'AAAAAAAA', p_access_token_hash: '0'.repeat(64), p_ip_hash: ip, p_mode: 'test' }
    for (let i = 0; i < 120; i += 1) expect(await h.call('order_access', probe)).toEqual(NOT_FOUND)
    await expect(h.call('order_access', probe)).rejects.toMatchObject({ code: '54000' })
    expect(await h.call('order_access', { ...probe, p_ip_hash: h.ipHash() })).toEqual(NOT_FOUND)
  })

  it('raises, rather than answers, for a call that is malformed', async () => {
    const good = { p_order_number: 'AAAAAAAA', p_access_token_hash: '0'.repeat(64), p_ip_hash: h.ipHash(), p_mode: 'test' }
    await expect(h.call('order_access', { ...good, p_mode: 'staging' })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_access', { ...good, p_mode: null })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_access', { ...good, p_ip_hash: 'not-a-hash' })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_access', { ...good, p_ip_hash: null })).rejects.toMatchObject({ code: '22023' })
  })
})

// --- recovery ---------------------------------------------------------------------------------------------------------

describe('recovery', () => {
  /** The `orders` function's recovery: the list, the links derived from it, the apply. */
  async function recover(email: string, opts: { ip?: string; client?: Parameters<typeof h.call>[2] } = {}): Promise<{ listed: RecoverableOrder[]; queued: number }> {
    const ip = opts.ip ?? h.ipHash()
    const listed = (await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: ip, p_email: email }, opts.client)) as RecoverableOrder[]
    const queued = (await h.call('order_recover_apply', { p_ip_hash: ip, p_items: await recoveryItems(PEPPER, listed) }, opts.client)) as number
    return { listed, queued }
  }
  const linkMails = (orderId: string): Promise<Row[]> => h.rows("select * from finance.email_outbox where kind = 'order_link' and payload ->> 'orderId' = $1 order by id", [orderId])
  const today = async (): Promise<string> => (await h.row("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as d")).d as string
  const secondsAhead = async (orderId: string): Promise<number> =>
    Number((await h.row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [orderId])).s)
  const oneBook = async (email?: string): Promise<Paid> => h.paid([{ variantId: await h.digital(), quantity: 1 }], { email })
  const week = 7 * 24 * 3600
  /** What the dispatcher derives for an `order_link` row: `order_email_data`'s key and version, run through the token functions as `outbox.ts` runs them. */
  const mailLinkHash = async (orderId: string): Promise<{ version: number; hash: string }> => {
    const data = (await h.call('order_email_data', { p_order: orderId })) as { idempotencyKey: string; tokenVersion: number }
    return { version: data.tokenVersion, hash: await orderAccessTokenHash(PEPPER, await orderAccessToken(PEPPER, data.idempotencyKey, data.tokenVersion)) }
  }

  it('lists only the orders of the configured mode: a test order is never offered a link once the site is live', async () => {
    const p = await oneBook()
    expect(await h.call('order_recover_list', { p_mode: 'live', p_ip_hash: h.ipHash(), p_email: p.email })).toEqual([])
    expect(((await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: p.email })) as RecoverableOrder[]).map((o) => o.orderId)).toEqual([p.id])
    for (const mode of ['staging', null]) {
      await expect(h.call('order_recover_list', { p_mode: mode, p_ip_hash: h.ipHash(), p_email: p.email })).rejects.toMatchObject({ code: '22023' })
    }
  })

  it('answers an address with no order with an empty list and queues nothing', async () => {
    const email = uniqueEmail('nobody')
    const { listed, queued } = await recover(email)
    expect(listed).toEqual([])
    expect(queued).toBe(0)
    expect(await h.count('select count(*)::int as n from finance.email_outbox where recipient = $1', [email])).toBe(0)
    expect(await h.call('order_recover_apply', { p_ip_hash: h.ipHash(), p_items: [] })).toBe(0)
  })

  it('keeps a working link: no new version, the old token still works, the expiry renewed and one mail with ids only', async () => {
    const p = await oneBook()
    await setExpiry(p.id, "now() + interval '1 hour'")
    const { listed, queued } = await recover(p.email)
    expect(listed).toEqual([{ orderId: p.id, idempotencyKey: p.key, tokenVersion: 0, expired: false }])
    expect(queued).toBe(1)

    const order = await orderOf(p.id)
    expect(order.access_token_version).toBe(0)
    expect(order.access_token_hash).toBe(p.hash)
    expect(await secondsAhead(p.id)).toBeGreaterThan(week - 120)
    expect((await access(p)).ok).toBe(true)
    // The mail is built at send from the order's own facts: the link it derives is the one the buyer already has.
    expect(await mailLinkHash(p.id)).toEqual({ version: 0, hash: p.hash })

    const mails = await linkMails(p.id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ dedupe_key: `order_link:${p.id}:0:${await today()}`, kind: 'order_link', priority: 1, recipient: p.email.toLowerCase(), status: 'pending' })
    // Ids only: no token, no hash, no address in the payload.
    expect(mails[0]!.payload).toEqual({ orderId: p.id })
  })

  it('gives an expired link the next version: the old token dies, the new one works, one mail', async () => {
    const p = await oneBook()
    await setExpiry(p.id, "now() - interval '1 minute'")
    expect(await access(p)).toEqual(NOT_FOUND)

    const { listed, queued } = await recover(p.email)
    expect(listed).toEqual([{ orderId: p.id, idempotencyKey: p.key, tokenVersion: 0, expired: true }])
    expect(queued).toBe(1)

    const order = await orderOf(p.id)
    expect(order.access_token_version).toBe(1)
    const fresh = await orderAccessToken(PEPPER, p.key, 1)
    expect(order.access_token_hash).toBe(await orderAccessTokenHash(PEPPER, fresh))
    expect(await secondsAhead(p.id)).toBeGreaterThan(week - 120)
    // The old link is dead, the new one is the order's.
    expect(await access(p)).toEqual(NOT_FOUND)
    expect((await access({ number: p.number, hash: await orderAccessTokenHash(PEPPER, fresh) })).ok).toBe(true)
    // The mail derives its link from the order's facts at send: it is the new one, so the link in the mail opens the order.
    expect(await mailLinkHash(p.id)).toEqual({ version: 1, hash: order.access_token_hash })
    expect((await linkMails(p.id)).map((mail) => mail.dedupe_key)).toEqual([`order_link:${p.id}:1:${await today()}`])

    // Asked again at once the link is alive, so it keeps its token (version 1) and the day's mail is not repeated.
    const again = await recover(p.email)
    expect(again.listed[0]).toMatchObject({ tokenVersion: 1, expired: false })
    expect(again.queued).toBe(0)
    expect((await orderOf(p.id)).access_token_version).toBe(1)
    expect(await linkMails(p.id)).toHaveLength(1)

    // Expired once more, the next version again.
    await setExpiry(p.id, "now() - interval '1 minute'")
    expect((await recover(p.email)).queued).toBe(1)
    expect((await orderOf(p.id)).access_token_version).toBe(2)
  })

  it('agrees on one new token when two requests for the same expired link apply at once: the version guard', async () => {
    const p = await oneBook()
    await setExpiry(p.id, "now() - interval '1 minute'")
    const listed = (await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: p.email })) as RecoverableOrder[]
    const items = await recoveryItems(PEPPER, listed)
    expect(items).toEqual([{ orderId: p.id, version: 1, tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) }])

    // Both applies queue behind the order's lock; when it is freed they race for the same row.
    const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [p.id])
    const first = h.call('order_recover_apply', { p_ip_hash: h.ipHash(), p_items: items }, h.pool[1])
    const second = h.call('order_recover_apply', { p_ip_hash: h.ipHash(), p_items: items }, h.pool[2])
    await sleep(400)
    await lock.release()
    const queued = (await Promise.all([first, second])) as number[]

    expect(queued.reduce((sum, n) => sum + n, 0)).toBe(1)
    const order = await orderOf(p.id)
    expect(order.access_token_version).toBe(1)
    expect(order.access_token_hash).toBe(items[0]!.tokenHash)
    expect(await linkMails(p.id)).toHaveLength(1)
  })

  it('applies only what it was shown: a stale version, a link renewed or expired in between, and a version that skips', async () => {
    // A version that is not the next one changes nothing.
    const stale = await oneBook()
    await setExpiry(stale.id, "now() - interval '1 minute'")
    const hash = '0'.repeat(63) + '1'
    const apply = (items: unknown[]): Promise<number> => h.call('order_recover_apply', { p_ip_hash: h.ipHash(), p_items: items }) as Promise<number>
    expect(await apply([{ orderId: stale.id, version: 5, tokenHash: hash }])).toBe(0)
    expect(await apply([{ orderId: stale.id, version: 0, tokenHash: hash }])).toBe(0)
    expect((await orderOf(stale.id)).access_token_version).toBe(0)
    expect(await linkMails(stale.id)).toHaveLength(0)
    // A link that is alive is not renewed under a version it never had.
    const live = await oneBook()
    await setExpiry(live.id, "now() + interval '1 hour'")
    expect(await apply([{ orderId: live.id, version: 3 }])).toBe(0)
    expect(await secondsAhead(live.id)).toBeLessThan(3700)

    // Expired when listed, alive when applied (a file was attached meanwhile): never replaced, so no working link is killed.
    const revived = await oneBook()
    await setExpiry(revived.id, "now() - interval '1 minute'")
    const listed = (await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: revived.email })) as RecoverableOrder[]
    expect(listed[0]!.expired).toBe(true)
    await setExpiry(revived.id, "now() + interval '1 day'")
    expect(await apply(await recoveryItems(PEPPER, listed))).toBe(0)
    expect((await orderOf(revived.id)).access_token_version).toBe(0)
    expect((await access(revived)).ok).toBe(true)
    expect(await linkMails(revived.id)).toHaveLength(0)

    // Alive when listed, expired when applied: an expired token is never brought back to life.
    const lapsed = await oneBook()
    await setExpiry(lapsed.id, "now() + interval '1 hour'")
    const shown = (await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: lapsed.email })) as RecoverableOrder[]
    expect(shown[0]!.expired).toBe(false)
    await setExpiry(lapsed.id, "now() - interval '1 second'")
    expect(await apply(await recoveryItems(PEPPER, shown))).toBe(0)
    expect(await access(lapsed)).toEqual(NOT_FOUND)
    expect(await linkMails(lapsed.id)).toHaveLength(0)
  })

  it('queues at most one mail per order per UTC day, and a new day sends a new one', async () => {
    const p = await oneBook()
    expect((await recover(p.email)).queued).toBe(1)
    expect((await recover(p.email)).queued).toBe(0)
    expect(await linkMails(p.id)).toHaveLength(1)

    // Yesterday's mail does not count for today.
    await h.postgres.query("update finance.email_outbox set dedupe_key = replace(dedupe_key, $2, '2000-01-01') where dedupe_key like $1", [`order_link:${p.id}:%`, await today()])
    expect((await recover(p.email)).queued).toBe(1)
    expect((await linkMails(p.id)).map((mail) => mail.dedupe_key).sort()).toEqual([`order_link:${p.id}:0:${await today()}`, `order_link:${p.id}:0:2000-01-01`].sort())
  })

  it('lists at most the 5 most recent paid, under-review or refunded orders of an address, newest first', async () => {
    const email = uniqueEmail('regular')
    const orders: Paid[] = []
    for (let i = 0; i < 4; i += 1) orders.push(await oneBook(email))
    // Not paid, expired, cancelled: never listed.
    const unpaid = await h.place([{ variantId: await h.digital(), quantity: 1 }], { email })
    const expired = await h.place([{ variantId: await h.digital(), quantity: 1 }], { email })
    await setStatus(expired.id, 'expired')
    const cancelled = await h.place([{ variantId: await h.digital(), quantity: 1 }], { email })
    await setStatus(cancelled.id, 'cancelled')
    // The three listed statuses, newest of all.
    const review = await oneBook(email)
    await setStatus(review.id, 'paid_needs_resolution')
    const refunded = await oneBook(email)
    await setStatus(refunded.id, 'refunded')
    const newest = await oneBook(email)

    const { listed } = await recover(email)
    expect(listed.map((order) => order.orderId)).toEqual([newest.id, refunded.id, review.id, orders[3]!.id, orders[2]!.id])
    expect(listed.map((order) => order.orderId)).not.toContain(unpaid.id)
    expect(listed.map((order) => order.orderId)).not.toContain(expired.id)
    expect(listed.map((order) => order.orderId)).not.toContain(cancelled.id)
    // One mail each, no more than the five.
    expect(await h.count("select count(*)::int as n from finance.email_outbox where kind = 'order_link' and recipient = $1", [email.toLowerCase()])).toBe(5)
  })

  it('throttles 3 an hour per email and 10 an hour per IP in silence: the same empty list as a miss, never an error', async () => {
    const p = await oneBook()
    // The address: its 4th request in the hour is answered like an address with no order.
    const lengths: number[] = []
    for (let i = 0; i < 5; i += 1) lengths.push((await recover(p.email)).listed.length)
    expect(lengths).toEqual([1, 1, 1, 0, 0])
    // The email key is the address's hash, so a different case of the same address is the same address.
    expect((await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: p.email.toUpperCase() })) as unknown[]).toEqual([])

    // The IP: eleven addresses that each have an order, one caller.
    const ip = h.ipHash()
    const buyers: Paid[] = []
    for (let i = 0; i < 11; i += 1) buyers.push(await oneBook())
    const seen: number[] = []
    for (const buyer of buyers) seen.push((await recover(buyer.email, { ip })).listed.length)
    expect(seen).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0])
    // The refused eleventh spent none of its address's allowance.
    expect((await recover(buyers[10]!.email)).listed).toHaveLength(1)
  })

  it('queues at most 20 links a day in all, and still renews the link it was asked for', async () => {
    const p = await oneBook()
    await setExpiry(p.id, "now() + interval '1 hour'")
    for (let i = 0; i < 20; i += 1) await h.postgres.query("select finance.rate_limit_take('order-link:day', $1, 20, interval '1 day')", ['0'.repeat(64)])
    const capped = await recover(p.email)
    expect(capped.queued).toBe(0)
    expect(await linkMails(p.id)).toHaveLength(0)
    expect(await secondsAhead(p.id)).toBeGreaterThan(week - 120)

    // The next day's budget (here: the bucket cleared) queues it.
    await h.postgres.query("delete from finance.rate_limits where bucket = 'order-link:day'")
    expect((await recover(p.email)).queued).toBe(1)
    expect(await linkMails(p.id)).toHaveLength(1)
  })

  it('raises, rather than answers, for a call that is malformed', async () => {
    const ip = h.ipHash()
    await expect(h.call('order_recover_list', { p_mode: 'test', p_ip_hash: 'x', p_email: 'a@example.com' })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_list', { p_mode: 'test', p_ip_hash: ip, p_email: 'a' })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_list', { p_mode: 'test', p_ip_hash: ip, p_email: null })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_apply', { p_ip_hash: 'x', p_items: [] })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_apply', { p_ip_hash: ip, p_items: { orderId: randomUUID() } })).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_apply', { p_ip_hash: ip, p_items: null })).rejects.toMatchObject({ code: '22023' })
    await expect(
      h.call('order_recover_apply', { p_ip_hash: ip, p_items: Array.from({ length: 6 }, () => ({ orderId: randomUUID(), version: 0 })) }),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(h.call('order_recover_apply', { p_ip_hash: ip, p_items: [{ orderId: 'nope', version: 0 }] })).rejects.toMatchObject({ code: '22P02' })
  })
})

// --- order_link_reissue (FABLE-AUDIT M1b) -------------------------------------------------------------------------------

describe('order_link_reissue', () => {
  let ownerClient: SupabaseClient
  let operationsClient: SupabaseClient
  beforeAll(async () => {
    ownerClient = await signIn(owner.email)
    operationsClient = await signIn((await h.makeStaff('operations')).email)
  })

  const reissue = async (client: SupabaseClient, args: Record<string, unknown>): Promise<{ data: any; code: string | undefined }> => {
    const { data, error } = await client.rpc('order_link_reissue', args)
    return { data, code: error?.code }
  }
  /** What the Edge Function derives for a version, as recovery does: the hash of the token of the order's key. */
  const hashFor = async (p: Paid, version: number): Promise<string> => orderAccessTokenHash(PEPPER, await orderAccessToken(PEPPER, p.key, version))
  const linkMails = (orderId: string): Promise<Row[]> => h.rows("select * from finance.email_outbox where kind = 'order_link' and payload ->> 'orderId' = $1 order by id", [orderId])
  const audits = (orderId: string): Promise<Row[]> => h.rows("select * from public.audit_events where action = 'order.link_reissued' and entity_id = $1 order by id", [orderId])
  const today = async (): Promise<string> => (await h.row("select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as d")).d as string
  const secondsAhead = async (orderId: string): Promise<number> =>
    Number((await h.row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [orderId])).s)

  it('rotates the link to the next version: the old token dies, the new one opens the order for 7 days, one mail, an audit row', async () => {
    const p = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const hash = await hashFor(p, 1)
    expect(await reissue(ownerClient, { p_order: p.id, p_version: 1, p_token_hash: hash, p_email: null })).toEqual({
      data: { ok: true, version: 1, emailChanged: false },
      code: undefined,
    })
    expect(await access(p)).toEqual(NOT_FOUND)
    expect((await access({ number: p.number, hash })).ok).toBe(true)
    expect(await orderOf(p.id)).toMatchObject({ access_token_version: 1, access_token_hash: hash, customer_email: p.email.toLowerCase() })
    expect(await secondsAhead(p.id)).toBeGreaterThan(7 * 24 * 3600 - 120)
    const mails = await linkMails(p.id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ dedupe_key: `order_link:${p.id}:1:${await today()}`, kind: 'order_link', priority: 1, recipient: p.email.toLowerCase(), status: 'pending' })
    expect(mails[0]!.payload).toEqual({ orderId: p.id })
    const rows = await audits(p.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor: owner.userId, entity: 'order' })
    expect(rows[0]!.summary).toEqual({ orderNumber: p.number, emailChanged: false })

    // The same version again is stale: refused, and nothing changes.
    expect((await reissue(ownerClient, { p_order: p.id, p_version: 1, p_token_hash: hash, p_email: null })).data).toEqual({ ok: false, code: 'VERSION_MISMATCH' })
    expect(await linkMails(p.id)).toHaveLength(1)
    // Rotated again, version 2: the version 1 link dies too.
    const next = await hashFor(p, 2)
    expect((await reissue(ownerClient, { p_order: p.id, p_version: 2, p_token_hash: next, p_email: null })).data).toMatchObject({ ok: true, version: 2 })
    expect(await access({ number: p.number, hash })).toEqual(NOT_FOUND)
    expect((await access({ number: p.number, hash: next })).ok).toBe(true)
  })

  it('re-addresses an order to a corrected address: the link goes to the new one, the order\'s address and hash follow it, the audit row names neither', async () => {
    const p = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const corrected = uniqueEmail('corrected')
    const hash = await hashFor(p, 1)
    expect((await reissue(ownerClient, { p_order: p.id, p_version: 1, p_token_hash: hash, p_email: `  ${corrected.toUpperCase()} ` })).data).toEqual({
      ok: true,
      version: 1,
      emailChanged: true,
    })
    expect(await access(p)).toEqual(NOT_FOUND)
    expect((await access({ number: p.number, hash })).ok).toBe(true)
    expect(await orderOf(p.id)).toMatchObject({ customer_email: corrected, email_hash: sha256(corrected), access_token_version: 1 })
    const mails = await linkMails(p.id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ dedupe_key: `order_link:${p.id}:1:${await today()}`, recipient: corrected })
    const rows = await audits(p.id)
    expect(rows[0]!.summary).toEqual({ orderNumber: p.number, emailChanged: true })
    const text = JSON.stringify(rows)
    for (const address of [corrected, p.email]) expect(text.includes(address), address).toBe(false)
    // The new address finds the order through recovery; the old one no longer does.
    const listed = async (email: string): Promise<string[]> =>
      ((await h.call('order_recover_list', { p_mode: 'test', p_ip_hash: h.ipHash(), p_email: email })) as RecoverableOrder[]).map((entry) => entry.orderId)
    expect(await listed(corrected)).toEqual([p.id])
    expect(await listed(p.email)).toEqual([])
  })

  it('refuses what it cannot do and changes nothing: an unknown order, one that is not paid, a version that is not the next, an address that is not one; and anyone but an owner', async () => {
    const p = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const hash = await hashFor(p, 1)
    const placed = await h.place([{ variantId: await h.digital(), quantity: 1 }])
    const call = (over: Record<string, unknown>, client: SupabaseClient = ownerClient) =>
      reissue(client, { p_order: p.id, p_version: 1, p_token_hash: hash, p_email: null, ...over })
    expect((await call({ p_order: randomUUID() })).data).toEqual(NOT_FOUND)
    expect((await call({ p_order: placed.id })).data).toEqual({ ok: false, code: 'BAD_STATUS', status: 'pending_payment' })
    expect((await call({ p_version: 2 })).data).toEqual({ ok: false, code: 'VERSION_MISMATCH' })
    for (const email of ['not-an-address', '', 'a@b']) expect((await call({ p_email: email })).data, email).toEqual({ ok: false, code: 'INVALID_EMAIL' })
    for (const over of [{ p_version: 0 }, { p_version: null }, { p_token_hash: 'x' }, { p_token_hash: null }]) {
      expect((await call(over)).code, JSON.stringify(over)).toBe('22023')
    }
    // Operations work the orders, but the link is the owner's to reissue: refused before anything is read.
    expect((await call({}, operationsClient)).code).toBe('42501')
    expect((await call({ p_order: randomUUID() }, operationsClient)).code).toBe('42501')
    expect(await orderOf(p.id)).toMatchObject({ access_token_version: 0, access_token_hash: p.hash, customer_email: p.email.toLowerCase() })
    expect((await access(p)).ok).toBe(true)
    expect(await linkMails(p.id)).toEqual([])
    expect(await audits(p.id)).toEqual([])
    const can = async (role: string): Promise<boolean> =>
      (await h.row("select has_function_privilege($1, 'public.order_link_reissue(uuid, integer, text, text)', 'execute') as ok", [role])).ok as boolean
    expect(await can('authenticated')).toBe(true)
    expect(await can('anon')).toBe(false)
  })
})

// --- return_request_create -----------------------------------------------------------------------------------------------

describe('return_request_create', () => {
  const request = (p: { number: string; hash: string }, items: unknown, over: Record<string, unknown> = {}): Promise<any> =>
    h.call('return_request_create', {
      p_order_number: p.number, p_access_token_hash: p.hash, p_items: items, p_reason: 'المنتج وصلني تالفًا', p_ip_hash: h.ipHash(), p_mode: 'test', ...over,
    })
  const returnsOf = (orderId: string): Promise<Row[]> => h.rows('select * from finance.return_requests where order_id = $1 order by created_at, id', [orderId])
  const returnable = async (p: Paid, variantId: string): Promise<number> =>
    (await access(p)).items.find((item: Row) => item.itemId === itemOf(p, variantId).id).returnable

  /** An order of one printed line (quantity `qty`) that has shipped. */
  async function shipped(qty: number, stock = 20): Promise<{ p: Paid; variantId: string; itemId: string }> {
    const variantId = await h.physical(4000, stock)
    const p = await h.paid([{ variantId, quantity: qty }])
    await setState(itemOf(p, variantId).id, 'shipped')
    return { p, variantId, itemId: itemOf(p, variantId).id }
  }

  it('is bound to the configured mode: a test order files no return once the site is live', async () => {
    const { p, itemId } = await shipped(1)
    const items = [{ itemId, quantity: 1 }]
    expect(await request(p, items, { p_mode: 'live' })).toEqual(NOT_FOUND)
    expect(await returnsOf(p.id)).toHaveLength(0)
    for (const mode of ['staging', null]) await expect(request(p, items, { p_mode: mode })).rejects.toMatchObject({ code: '22023' })
    expect((await request(p, items)).ok).toBe(true)
  })

  it('takes a request for shipped and delivered items, stores it as asked and shows it on the order page', async () => {
    const printed = await h.physical(4000, 10)
    const signedEdition = await h.signed(9000, 10)
    const p = await h.paid([{ variantId: printed, quantity: 3 }, { variantId: signedEdition, quantity: 1 }])
    await setState(itemOf(p, printed).id, 'shipped')
    await setState(itemOf(p, signedEdition).id, 'delivered')
    const stockBefore = (await h.row('select stock from public.product_variants where id = $1', [printed])).stock

    const reply = await request(p, [{ itemId: itemOf(p, printed).id, quantity: 2 }, { itemId: itemOf(p, signedEdition).id, quantity: 1 }], { p_reason: '  المنتج تالف  ' })
    expect(reply, JSON.stringify(reply)).toEqual({ ok: true, returnId: expect.any(String) })
    const stored = await returnsOf(p.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: reply.returnId, state: 'requested', reason: 'المنتج تالف', decided_by: null, refund_id: null })
    expect(stored[0]!.items).toEqual([{ itemId: itemOf(p, printed).id, quantity: 2 }, { itemId: itemOf(p, signedEdition).id, quantity: 1 }])

    const page = await access(p)
    expect(page.returns).toEqual([{ id: reply.returnId, state: 'requested', createdAt: expect.any(String) }])
    expect(await returnable(p, printed)).toBe(1)
    expect(await returnable(p, signedEdition)).toBe(0)
    // A request moves no money and no stock: the staff decide.
    expect(await h.count('select count(*)::int as n from finance.refunds where order_id = $1', [p.id])).toBe(0)
    expect((await h.row('select stock from public.product_variants where id = $1', [printed])).stock).toBe(stockBefore)
  })

  it('counts the quantities of earlier requests that were not rejected: only what is left can be asked for', async () => {
    const { p, variantId, itemId } = await shipped(4)
    const first = await request(p, [{ itemId, quantity: 3 }])
    expect(first.ok).toBe(true)
    expect(await returnable(p, variantId)).toBe(1)
    expect(await request(p, [{ itemId, quantity: 2 }])).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    const second = await request(p, [{ itemId, quantity: 1 }])
    expect(second.ok).toBe(true)
    expect(await returnable(p, variantId)).toBe(0)
    expect(await request(p, [{ itemId, quantity: 1 }])).toEqual({ ok: false, code: 'INVALID_ITEMS' })

    // Every state but `rejected` still holds its quantity.
    for (const state of ['approved', 'received', 'refunded']) {
      await h.postgres.query('update finance.return_requests set state = $2 where id = $1', [second.returnId, state])
      expect(await returnable(p, variantId), state).toBe(0)
    }
    // A rejected request gives its quantity back.
    await h.postgres.query("update finance.return_requests set state = 'rejected' where id = $1", [first.returnId])
    expect(await returnable(p, variantId)).toBe(3)
    expect((await request(p, [{ itemId, quantity: 3 }])).ok).toBe(true)
    expect(await returnable(p, variantId)).toBe(0)
  })

  it('refuses what cannot be returned: an order that is not paid, a digital item, an item not shipped yet', async () => {
    const book = await h.digital()
    const printed = await h.physical(4000, 10)
    const waiting = await h.physical(3000, 10)
    const p = await h.paid([{ variantId: book, quantity: 1 }, { variantId: printed, quantity: 1 }, { variantId: waiting, quantity: 1 }])
    await setState(itemOf(p, printed).id, 'shipped')
    const ok = [{ itemId: itemOf(p, printed).id, quantity: 1 }]

    expect(await request(p, [{ itemId: itemOf(p, book).id, quantity: 1 }])).toEqual({ ok: false, code: 'NOT_RETURNABLE' })
    expect(await request(p, [{ itemId: itemOf(p, waiting).id, quantity: 1 }])).toEqual({ ok: false, code: 'NOT_RETURNABLE' })
    // One refusable item refuses the whole request, and nothing is stored.
    expect(await request(p, [...ok, { itemId: itemOf(p, waiting).id, quantity: 1 }])).toEqual({ ok: false, code: 'NOT_RETURNABLE' })
    expect(await returnsOf(p.id)).toHaveLength(0)

    for (const status of ['paid_needs_resolution', 'refunded', 'expired', 'cancelled', 'pending_payment']) {
      await setStatus(p.id, status)
      expect(await request(p, ok), status).toEqual({ ok: false, code: 'NOT_RETURNABLE' })
    }
    await setStatus(p.id, 'paid')
    expect((await request(p, ok)).ok).toBe(true)
    expect(await returnsOf(p.id)).toHaveLength(1)
  })

  it('refuses a malformed, foreign, repeated or too large list with INVALID_ITEMS and stores nothing', async () => {
    const { p, itemId } = await shipped(3)
    const foreign = await shipped(1)
    const bad: Array<[string, unknown]> = [
      ['an empty list', []],
      ['an object', { itemId, quantity: 1 }],
      ['a string', '"x"'],
      ['null', null],
      ['a scalar entry', [1]],
      ['a null entry', [null]],
      ['an item of another order', [{ itemId: foreign.itemId, quantity: 1 }]],
      ['an unknown item', [{ itemId: randomUUID(), quantity: 1 }]],
      ['a malformed id', [{ itemId: 'not-a-uuid', quantity: 1 }]],
      ['a missing id', [{ quantity: 1 }]],
      ['a zero quantity', [{ itemId, quantity: 0 }]],
      ['a negative quantity', [{ itemId, quantity: -1 }]],
      ['a fractional quantity', [{ itemId, quantity: 1.5 }]],
      ['a quantity as text', [{ itemId, quantity: '1' }]],
      ['a missing quantity', [{ itemId }]],
      ['an extra key', [{ itemId, quantity: 1, price: 0 }]],
      ['more than was bought', [{ itemId, quantity: 4 }]],
      ['a huge quantity', [{ itemId, quantity: 99 }]],
      ['a quantity of four digits', [{ itemId, quantity: 1000 }]],
      ['the same item twice', [{ itemId, quantity: 1 }, { itemId, quantity: 1 }]],
      ['more than 50 entries', Array.from({ length: 51 }, () => ({ itemId, quantity: 1 }))],
    ]
    for (const [label, items] of bad) expect(await request(p, items), label).toEqual({ ok: false, code: 'INVALID_ITEMS' })
    expect(await returnsOf(p.id)).toHaveLength(0)
    expect((await request(p, [{ itemId, quantity: 3 }])).ok).toBe(true)
  })

  it('answers NOT_FOUND for a wrong number, a wrong or expired token, and a guess never spends the order\'s daily allowance', async () => {
    const { p, itemId } = await shipped(8)
    const items = [{ itemId, quantity: 1 }]
    const other = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    for (let i = 0; i < 6; i += 1) expect(await request({ number: p.number, hash: other.hash }, items)).toEqual(NOT_FOUND)
    expect(await request({ number: 'AAAAAAAA', hash: p.hash }, items)).toEqual(NOT_FOUND)
    expect(await request({ number: p.number, hash: p.hash }, items, { p_access_token_hash: null })).toEqual(NOT_FOUND)
    await setExpiry(p.id, "now() - interval '1 second'")
    expect(await request(p, items)).toEqual(NOT_FOUND)
    await setExpiry(p.id, "now() + interval '1 day'")
    expect(await returnsOf(p.id)).toHaveLength(0)
    expect((await request(p, items)).ok).toBe(true)
  })

  it('takes at most 5 requests a day per order, counted from the requests made, and another order is not affected', async () => {
    const { p, itemId } = await shipped(8)
    const items = [{ itemId, quantity: 1 }]
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) ids.push((await request(p, items)).returnId)
    expect(await request(p, items)).toEqual({ ok: false, code: 'TOO_MANY_REQUESTS' })
    // The limit is checked before the list is, so a bad list does not say anything the order's owner did not already know.
    expect(await request(p, [])).toEqual({ ok: false, code: 'TOO_MANY_REQUESTS' })
    expect(await returnsOf(p.id)).toHaveLength(5)
    const another = await shipped(2)
    expect((await request(another.p, [{ itemId: another.itemId, quantity: 1 }])).ok).toBe(true)

    // A request of two days ago is not "today": the 6th goes through.
    await h.postgres.query("update finance.return_requests set created_at = now() - interval '2 days' where id = $1", [ids[0]])
    expect((await request(p, items)).ok).toBe(true)
    expect(await request(p, items)).toEqual({ ok: false, code: 'TOO_MANY_REQUESTS' })
  })

  it('reads under no lock and compares the token before it locks the order: with the order held, the page and a wrong guess answer at once, the right token waits', async () => {
    const { p, itemId } = await shipped(2)
    const args = (hash: string): Record<string, unknown> => ({
      p_order_number: p.number, p_access_token_hash: hash, p_items: [{ itemId, quantity: 1 }], p_reason: 'تالف', p_ip_hash: h.ipHash(), p_mode: 'test',
    })
    const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [p.id])
    let waiting: Promise<any> | undefined
    try {
      // One connection each, so that nothing waits behind another call of the same session.
      expect(await settledWithin(h.call('order_access', { p_order_number: p.number, p_access_token_hash: p.hash, p_ip_hash: h.ipHash(), p_mode: 'test' }, h.pool[1]))).toMatchObject({ ok: true })
      expect(await settledWithin(h.call('return_request_create', args('0'.repeat(64)), h.pool[2]))).toEqual(NOT_FOUND)
      // The control: the right token does queue behind the writer, which is what the lock is for.
      waiting = h.call('return_request_create', args(p.hash), h.pool[3])
      expect(await settledWithin(waiting)).toBe('blocked')
    } finally {
      await lock.release()
    }
    expect((await waiting!).ok).toBe(true)
  })

  it('lets three requests for the last units race: one is taken, the others are told the quantity is no longer there', async () => {
    const { p, itemId } = await shipped(2)
    const items = [{ itemId, quantity: 2 }]
    const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [p.id])
    const first = request(p, items) // the main session is not the holder: both queue on the order's row lock
    const a = h.call('return_request_create', { p_order_number: p.number, p_access_token_hash: p.hash, p_items: items, p_reason: 'أول', p_ip_hash: h.ipHash(), p_mode: 'test' }, h.pool[1])
    const b = h.call('return_request_create', { p_order_number: p.number, p_access_token_hash: p.hash, p_items: items, p_reason: 'ثانٍ', p_ip_hash: h.ipHash(), p_mode: 'test' }, h.pool[2])
    await sleep(400)
    await lock.release()
    const results = await Promise.all([first, a, b])
    expect(results.filter((r) => r.ok === true)).toHaveLength(1)
    expect(results.filter((r) => r.ok === false)).toEqual([{ ok: false, code: 'INVALID_ITEMS' }, { ok: false, code: 'INVALID_ITEMS' }])
    expect(await returnsOf(p.id)).toHaveLength(1)
  })

  it('raises, rather than answers, for a reason out of bounds or a malformed call, and throttles 20 an hour per IP hash', async () => {
    const { p, itemId } = await shipped(2)
    const items = [{ itemId, quantity: 1 }]
    for (const reason of ['', '   ', 'x'.repeat(501), 'a\u0001b', null]) {
      await expect(request(p, items, { p_reason: reason }), JSON.stringify(reason)).rejects.toMatchObject({ code: '22023' })
    }
    await expect(request(p, items, { p_ip_hash: 'x' })).rejects.toMatchObject({ code: '22023' })
    expect((await request(p, items, { p_reason: 'x'.repeat(500) })).ok).toBe(true)

    const ip = h.ipHash()
    for (let i = 0; i < 20; i += 1) expect(await request({ number: 'AAAAAAAA', hash: p.hash }, items, { p_ip_hash: ip })).toEqual(NOT_FOUND)
    await expect(request({ number: 'AAAAAAAA', hash: p.hash }, items, { p_ip_hash: ip })).rejects.toMatchObject({ code: '54000' })
    expect(await request({ number: 'AAAAAAAA', hash: p.hash }, items)).toEqual(NOT_FOUND)
  })
})
