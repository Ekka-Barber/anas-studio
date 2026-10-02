// P08 round 7: the paid files and their downloads of
// `supabase/migrations/20261002140000_delivery.sql` against the real local
// database: `download_issue`, `download_redeem`, `paid_asset_set` and
// `paid_files_sweep_candidates`, and what a refund does to a download that was
// already issued. The server-only functions are called as `service_role` (the Edge
// Functions' role, D32) through direct sessions; every order goes through
// `checkout_create` and is paid by `apply_verified_payment` (the shared fixtures of
// `support.ts`). What only the database could write (an aged token, a status) is
// written as the local `postgres` superuser; a session of that role also holds a
// row lock, so that calls started behind it race for the same row the moment it is
// freed. The sweep reads real objects of the local Storage. Nothing here reaches
// Moyasar or sends a mail. This file switches `finance.commerce_settings.checkout_enabled`
// on, saved and restored by the fixtures; every fixture carries a per-run unique slug,
// SKU, email or token.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { commerceHarness, type Harness, type Paid, type Row, serviceClient, serviceRoleDb, settledWithin, sha256 } from './support'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const PEPPER = `download-pepper-${randomUUID()}`
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

const newHash = (): string => sha256(`download-token-${randomUUID()}`)

const setFileCall = (variantId: string, key: string, over: Record<string, unknown> = {}, client?: Parameters<Harness['call']>[2]): Promise<any> =>
  h.call(
    'paid_asset_set',
    { p_actor: owner.userId, p_variant: variantId, p_storage_key: key, p_filename: 'كتاب أنس.pdf', p_mime: 'application/pdf', p_bytes: 2048, ...over },
    client,
  )
const keyFor = (variantId: string): string => `assets/${variantId}/${randomUUID()}`
async function setFile(variantId: string): Promise<{ key: string; assetId: string }> {
  const key = keyFor(variantId)
  const reply = await setFileCall(variantId, key)
  expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true })
  return { key, assetId: reply.assetId as string }
}

type Book = { variantId: string; key: string | null; p: Paid; itemId: string }
/** A digital variant (with its file when `file`) and an order that paid for it. */
async function book(file = true): Promise<Book> {
  const variantId = await h.digital(3500)
  const key = file ? (await setFile(variantId)).key : null
  const p = await h.paid([{ variantId, quantity: 1 }])
  return { variantId, key, p, itemId: p.items[0]!.id }
}

const issue = (p: { number: string; hash: string }, itemId: unknown, hash = newHash(), over: Record<string, unknown> = {}, client?: Parameters<Harness['call']>[2]): Promise<any> =>
  h.call('download_issue', { p_order_number: p.number, p_access_token_hash: p.hash, p_item: itemId, p_download_token_hash: hash, p_ip_hash: h.ipHash(), p_mode: 'test', ...over }, client)
const redeem = (hash: string, over: Record<string, unknown> = {}, client?: Parameters<Harness['call']>[2]): Promise<any> =>
  h.call('download_redeem', { p_download_token_hash: hash, p_ip_hash: h.ipHash(), p_mode: 'test', ...over }, client)
const tokenOf = (hash: string): Promise<Row> => h.row('select * from finance.download_tokens where token_hash = $1', [hash])
const entitlementOf = (itemId: string): Promise<Row> => h.row('select * from finance.entitlements where order_item_id = $1', [itemId])
const readyMails = (orderIds: string[]): Promise<Row[]> =>
  h.rows("select * from finance.email_outbox where kind = 'order_ready' and payload ->> 'orderId' = any($1::text[]) order by id", [orderIds])
/** The first line's `hasFile` in the facts the dispatcher renders a mail from (`order_email_data`): true, false (waiting) or null (nothing will be handed out). */
const hasFile = async (p: Paid): Promise<boolean | null> =>
  ((await h.call('order_email_data', { p_order: p.id })) as { lines: Array<{ itemId: string; hasFile: boolean | null }> }).lines.find((line) => line.itemId === p.items[0]!.id)!.hasFile
const minutesAhead = async (hash: string): Promise<number> =>
  Number((await h.row('select extract(epoch from (expires_at - now())) / 60 as m from finance.download_tokens where token_hash = $1', [hash])).m)

// --- download_issue ------------------------------------------------------------------------------------------------------

describe('download_issue', () => {
  it('stores the hash of a 15-minute token for a granted file and answers when it expires', async () => {
    const { p, itemId } = await book()
    const hash = newHash()
    const reply = await issue(p, itemId, hash)
    expect(reply, JSON.stringify(reply)).toEqual({ ok: true, expiresAt: expect.any(String) })

    const stored = await tokenOf(hash)
    expect(stored).toMatchObject({ entitlement_id: (await entitlementOf(itemId)).id, uses: 0, max_uses: 3, last_used_at: null })
    const minutes = await minutesAhead(hash)
    expect(minutes).toBeGreaterThan(14.5)
    expect(minutes).toBeLessThanOrEqual(15)
    expect(new Date(reply.expiresAt).getTime()).toBeCloseTo(new Date(stored.expires_at).getTime(), -2)
    // Only the hash is kept: nothing in the table could rebuild the token.
    expect(Object.keys(stored).sort()).toEqual(['created_at', 'entitlement_id', 'expires_at', 'last_used_at', 'max_uses', 'token_hash', 'uses'])
  })

  it('answers NOT_FOUND, and only that, whenever there is nothing to give: a wrong order or token, no file, a revoked file, a refunded order', async () => {
    const { p, itemId, variantId } = await book()
    const other = await book()
    expect((await issue(p, itemId)).ok).toBe(true)

    expect(await issue({ number: 'AAAAAAAA', hash: p.hash }, itemId)).toEqual(NOT_FOUND)
    expect(await issue({ number: p.number, hash: other.p.hash }, itemId)).toEqual(NOT_FOUND)
    expect(await issue({ number: p.number, hash: '0'.repeat(64) }, itemId, newHash(), { p_access_token_hash: null })).toEqual(NOT_FOUND)
    expect(await issue(p, randomUUID())).toEqual(NOT_FOUND)
    // An item of another order, even with a valid token of this one.
    expect(await issue(p, other.itemId)).toEqual(NOT_FOUND)
    // An expired link.
    await h.postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 second' where id = $1", [p.id])
    expect(await issue(p, itemId)).toEqual(NOT_FOUND)
    await h.postgres.query("update finance.orders set access_token_expires_at = now() + interval '1 day' where id = $1", [p.id])

    // An item that is not digital has no entitlement.
    const printed = await h.physical(4000, 10)
    const mixed = await h.paid([{ variantId, quantity: 1 }, { variantId: printed, quantity: 1 }])
    expect(await issue(mixed, mixed.items.find((item) => item.fulfillment === 'physical')!.id)).toEqual(NOT_FOUND)

    // A digital item whose file does not exist yet (a preorder, or a file not uploaded): granted, nothing to give.
    const waiting = await book(false)
    expect(await issue(waiting.p, waiting.itemId)).toEqual(NOT_FOUND)

    // A revoked entitlement.
    await h.postgres.query("update finance.entitlements set revoked_at = now(), revoke_reason = 'test' where order_item_id = $1", [itemId])
    expect(await issue(p, itemId)).toEqual(NOT_FOUND)
    await h.postgres.query('update finance.entitlements set revoked_at = null, revoke_reason = null where order_item_id = $1', [itemId])
    expect((await issue(p, itemId)).ok).toBe(true)

    // A refunded order, whether or not its entitlement was revoked with it: the order's status decides on its own.
    await h.postgres.query("update finance.orders set status = 'refunded' where id = $1", [p.id])
    expect((await entitlementOf(itemId)).revoked_at).toBeNull()
    expect(await issue(p, itemId)).toEqual(NOT_FOUND)
  })

  it('takes at most 10 tokens per entitlement in a day, then TOO_MANY_DOWNLOADS, and counts each file on its own', async () => {
    const first = await book()
    const secondVariant = await h.digital(2000)
    await setFile(secondVariant)
    const p = await h.paid([{ variantId: first.variantId, quantity: 1 }, { variantId: secondVariant, quantity: 1 }])
    const [firstItem, secondItem] = [p.items.find((item) => item.variantId === first.variantId)!.id, p.items.find((item) => item.variantId === secondVariant)!.id]
    const hashes: string[] = []
    for (let i = 0; i < 10; i += 1) {
      hashes.push(newHash())
      expect((await issue(p, firstItem, hashes[i])).ok, `token ${i + 1}`).toBe(true)
    }
    expect(await issue(p, firstItem)).toEqual({ ok: false, code: 'TOO_MANY_DOWNLOADS' })
    // The other file of the same order has its own ten.
    expect((await issue(p, secondItem)).ok).toBe(true)
    // The count is of the last 24 hours: one older than that no longer counts.
    await h.postgres.query("update finance.download_tokens set created_at = now() - interval '25 hours' where token_hash = $1", [hashes[0]])
    expect((await issue(p, firstItem)).ok).toBe(true)
    expect(await issue(p, firstItem)).toEqual({ ok: false, code: 'TOO_MANY_DOWNLOADS' })
    // A guess that fails the order's token is NOT_FOUND, never a count: nothing about the entitlement leaks.
    expect(await issue({ number: p.number, hash: '0'.repeat(64) }, firstItem)).toEqual(NOT_FOUND)
  })

  it('never takes more than 10 when requests arrive at once: the entitlement row serializes them', async () => {
    const { p, itemId } = await book()
    // Fourteen sessions, one request each.
    const sessions = await Promise.all(Array.from({ length: 14 }, () => serviceRoleDb()))
    try {
      const results = await Promise.all(sessions.map((session) => issue(p, itemId, newHash(), {}, session)))
      expect(results.filter((r) => r.ok === true)).toHaveLength(10)
      expect(results.filter((r) => r.ok === false)).toEqual(Array.from({ length: 4 }, () => ({ ok: false, code: 'TOO_MANY_DOWNLOADS' })))
    } finally {
      await Promise.all(sessions.map((session) => session.end()))
    }
    expect(await h.count('select count(*)::int as n from finance.download_tokens where entitlement_id = $1', [(await entitlementOf(itemId)).id])).toBe(10)
  })

  it('compares the order token before it locks the entitlement: with the file held, a wrong guess is answered at once and the right token waits', async () => {
    const { p, itemId } = await book()
    const lock = await h.holdLock('select 1 from finance.entitlements where order_item_id = $1 for update', [itemId])
    let waiting: Promise<any> | undefined
    try {
      expect(await settledWithin(issue({ number: p.number, hash: '0'.repeat(64) }, itemId, newHash(), {}, h.pool[1]))).toEqual(NOT_FOUND)
      // The control: the right token does queue behind the writer, which is what the lock is for.
      waiting = issue(p, itemId, newHash(), {}, h.pool[2])
      expect(await settledWithin(waiting)).toBe('blocked')
    } finally {
      await lock.release()
    }
    expect((await waiting!).ok).toBe(true)
  })

  it('throttles 120 requests an hour per IP hash with 54000, and raises for a malformed call', async () => {
    const { p, itemId } = await book()
    const ip = h.ipHash()
    for (let i = 0; i < 120; i += 1) expect(await issue({ number: 'AAAAAAAA', hash: p.hash }, itemId, newHash(), { p_ip_hash: ip })).toEqual(NOT_FOUND)
    await expect(issue(p, itemId, newHash(), { p_ip_hash: ip })).rejects.toMatchObject({ code: '54000' })
    expect((await issue(p, itemId)).ok).toBe(true)

    await expect(issue(p, itemId, 'not-a-hash')).rejects.toMatchObject({ code: '22023' })
    await expect(issue(p, itemId, null as unknown as string)).rejects.toMatchObject({ code: '22023' })
    await expect(issue(p, itemId, newHash(), { p_ip_hash: 'x' })).rejects.toMatchObject({ code: '22023' })
    await expect(issue(p, null)).rejects.toMatchObject({ code: '22023' })
  })
})

// --- download_redeem -----------------------------------------------------------------------------------------------------

describe('download_redeem', () => {
  it('is bound to the configured mode, like the issue: a test order issues nothing and redeems nothing once the site is live', async () => {
    const { p, itemId } = await book()
    expect(await issue(p, itemId, newHash(), { p_mode: 'live' })).toEqual({ ok: false, code: 'NOT_FOUND' })
    const hash = newHash()
    expect((await issue(p, itemId, hash)).ok).toBe(true)
    // A token issued while the site was in test mode dies with the mode, and no use is counted.
    expect(await redeem(hash, { p_mode: 'live' })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect((await tokenOf(hash)).uses).toBe(0)
    expect((await redeem(hash)).ok).toBe(true)
    for (const mode of ['staging', null]) {
      await expect(issue(p, itemId, newHash(), { p_mode: mode })).rejects.toMatchObject({ code: '22023' })
      await expect(redeem(hash, { p_mode: mode })).rejects.toMatchObject({ code: '22023' })
    }
  })

  it('answers the file of a token three times, counting each use, and then NOT_FOUND', async () => {
    const { p, itemId, key } = await book()
    const hash = newHash()
    expect((await issue(p, itemId, hash)).ok).toBe(true)
    for (let use = 1; use <= 3; use += 1) {
      expect(await redeem(hash)).toEqual({ ok: true, storageKey: key, filename: 'كتاب أنس.pdf', mime: 'application/pdf' })
      expect((await tokenOf(hash)).uses).toBe(use)
    }
    expect((await tokenOf(hash)).last_used_at).not.toBeNull()
    expect(await redeem(hash)).toEqual(NOT_FOUND)
    expect((await tokenOf(hash)).uses).toBe(3)
  })

  it('answers NOT_FOUND for every failure and changes nothing: unknown, expired, revoked, refunded', async () => {
    expect(await redeem(newHash())).toEqual(NOT_FOUND)

    const expired = await book()
    const expiredHash = newHash()
    await issue(expired.p, expired.itemId, expiredHash)
    await h.postgres.query("update finance.download_tokens set expires_at = now() - interval '1 second' where token_hash = $1", [expiredHash])
    expect(await redeem(expiredHash)).toEqual(NOT_FOUND)
    expect((await tokenOf(expiredHash)).uses).toBe(0)

    const revoked = await book()
    const revokedHash = newHash()
    await issue(revoked.p, revoked.itemId, revokedHash)
    await h.postgres.query("update finance.entitlements set revoked_at = now() where order_item_id = $1", [revoked.itemId])
    expect(await redeem(revokedHash)).toEqual(NOT_FOUND)
    expect((await tokenOf(revokedHash)).uses).toBe(0)

    // An order that is refunded, with its entitlement still granted (the order's status alone is enough).
    const refunded = await book()
    const refundedHash = newHash()
    await issue(refunded.p, refunded.itemId, refundedHash)
    await h.postgres.query("update finance.orders set status = 'refunded' where id = $1", [refunded.p.id])
    expect(await redeem(refundedHash)).toEqual(NOT_FOUND)
    expect((await tokenOf(refundedHash)).uses).toBe(0)
  })

  it('never exceeds max_uses when redeems arrive at once, on two connections or five', async () => {
    const two = await book()
    const twoHash = newHash()
    await issue(two.p, two.itemId, twoHash)
    await h.postgres.query('update finance.download_tokens set max_uses = 1 where token_hash = $1', [twoHash])
    const first = await h.holdLock('select 1 from finance.download_tokens where token_hash = $1 for update', [twoHash])
    const pair = [redeem(twoHash, {}, h.pool[1]), redeem(twoHash, {}, h.pool[2])]
    await sleep(400)
    await first.release()
    const twoResults = await Promise.all(pair)
    expect(twoResults.filter((r) => r.ok === true)).toHaveLength(1)
    expect(twoResults.filter((r) => r.ok === false)).toEqual([NOT_FOUND])
    expect((await tokenOf(twoHash)).uses).toBe(1)

    const five = await book()
    const fiveHash = newHash()
    await issue(five.p, five.itemId, fiveHash)
    const second = await h.holdLock('select 1 from finance.download_tokens where token_hash = $1 for update', [fiveHash])
    const crowd = [1, 2, 3, 4, 5].map((i) => redeem(fiveHash, {}, h.pool[i]))
    await sleep(400)
    await second.release()
    const fiveResults = await Promise.all(crowd)
    expect(fiveResults.filter((r) => r.ok === true)).toHaveLength(3)
    expect(fiveResults.filter((r) => r.ok === false)).toEqual([NOT_FOUND, NOT_FOUND])
    expect((await tokenOf(fiveHash)).uses).toBe(3)
  })

  it('throttles 120 requests an hour per IP hash with 54000, and raises for a malformed call', async () => {
    const ip = h.ipHash()
    for (let i = 0; i < 120; i += 1) expect(await redeem(newHash(), { p_ip_hash: ip })).toEqual(NOT_FOUND)
    await expect(redeem(newHash(), { p_ip_hash: ip })).rejects.toMatchObject({ code: '54000' })
    await expect(redeem('x')).rejects.toMatchObject({ code: '22023' })
    await expect(redeem(newHash(), { p_ip_hash: null })).rejects.toMatchObject({ code: '22023' })
  })
})

// --- a refund and a download ---------------------------------------------------------------------------------------------

describe('a refund and the downloads', () => {
  it('stops a download token that was issued before the refund, and every new one', async () => {
    const { p, itemId } = await book()
    const hash = newHash()
    expect((await issue(p, itemId, hash)).ok).toBe(true)
    expect((await redeem(hash)).ok).toBe(true)

    await h.refundFully(p, owner.userId)
    expect((await entitlementOf(itemId)).revoked_at).not.toBeNull()
    expect(await redeem(hash)).toEqual(NOT_FOUND)
    expect((await tokenOf(hash)).uses).toBe(1)
    expect(await issue(p, itemId)).toEqual(NOT_FOUND)
  })

  it('stops only the refunded item: another file of the same order keeps working', async () => {
    const firstVariant = await h.digital(3500)
    const secondVariant = await h.digital(2000)
    await setFile(firstVariant)
    await setFile(secondVariant)
    const p = await h.paid([{ variantId: firstVariant, quantity: 1 }, { variantId: secondVariant, quantity: 1 }])
    const [firstItem, secondItem] = [p.items.find((item) => item.variantId === firstVariant)!.id, p.items.find((item) => item.variantId === secondVariant)!.id]
    const firstHash = newHash()
    const secondHash = newHash()
    await issue(p, firstItem, firstHash)
    await issue(p, secondItem, secondHash)

    const key = randomUUID()
    const asked = await h.call('refund_request', {
      p_actor: owner.userId, p_order: p.id, p_attempt: p.attemptId, p_review_payment: null, p_amount: 2000, p_reason: 'استرداد جزئي',
      p_allocation: { items: [{ itemId: secondItem, amount: 2000 }], shipping: 0 },
      p_idempotency_key: key, p_request_hash: sha256(`hash:${key}`), p_return: null, p_provider_refunded: 0,
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, state: 'new' })
    expect(await h.call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: 2000, p_error: null })).toMatchObject({ ok: true })

    expect(await redeem(secondHash)).toEqual(NOT_FOUND)
    expect((await redeem(firstHash)).ok).toBe(true)
    expect((await issue(p, firstItem)).ok).toBe(true)
    expect(await issue(p, secondItem)).toEqual(NOT_FOUND)
  })

  it('does not deadlock when a refund and several downloads arrive together, and ends with nothing to download', async () => {
    const { p, itemId } = await book()
    const results = await Promise.allSettled([
      h.refundFully(p, owner.userId),
      ...Array.from({ length: 5 }, (_, i) => issue(p, itemId, newHash(), {}, h.pool[i + 1])),
    ])
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    expect(await issue(p, itemId)).toEqual(NOT_FOUND)
  })
})

// --- paid_asset_set ------------------------------------------------------------------------------------------------------

describe('paid_asset_set', () => {
  const assetsOf = (variantId: string): Promise<Row[]> => h.rows('select * from finance.paid_assets where variant_id = $1 order by created_at', [variantId])
  const digitalAsset = async (variantId: string): Promise<string | null> => (await h.row('select digital_asset from public.product_variants where id = $1', [variantId])).digital_asset
  const unchanged = async (variantId: string): Promise<void> => {
    expect(await assetsOf(variantId)).toHaveLength(0)
    expect(await digitalAsset(variantId)).toBeNull()
  }

  it('records the file of a digital variant and points the variant at it', async () => {
    const variantId = await h.digital()
    const key = keyFor(variantId)
    const reply = await setFileCall(variantId, key, { p_filename: 'دليل البدء.pdf', p_bytes: 4096 })
    expect(reply).toEqual({ ok: true, assetId: key.split('/')[2], filled: 0 })
    const assets = await assetsOf(variantId)
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ id: key.split('/')[2], storage_key: key, filename: 'دليل البدء.pdf', mime: 'application/pdf', created_by: owner.userId })
    expect(Number(assets[0]!.bytes)).toBe(4096)
    expect(await digitalAsset(variantId)).toBe(key)
    // One audit row names the owner and no key.
    const audit = await h.rows("select * from public.audit_events where action = 'paid_asset.set' and entity_id = $1", [variantId])
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: owner.userId, entity: 'product_variants' })
    expect(JSON.stringify(audit[0]!.summary)).not.toContain(key)
    // An EPUB is as good.
    const epub = await setFileCall(variantId, keyFor(variantId), { p_mime: 'application/epub+zip', p_filename: 'كتاب.epub' })
    expect(epub).toMatchObject({ ok: true })
  })

  it('refuses a caller that is not an active owner with 42501, and writes nothing', async () => {
    const editor = await h.makeStaff('editor')
    const operations = await h.makeStaff('operations')
    const revoked = await h.makeStaff('owner', { active: false })
    const variantId = await h.digital()
    for (const actor of [editor.userId, operations.userId, revoked.userId, randomUUID(), null]) {
      await expect(setFileCall(variantId, keyFor(variantId), { p_actor: actor }), String(actor)).rejects.toMatchObject({ code: '42501' })
    }
    await unchanged(variantId)
  })

  it('refuses a variant that is not digital or does not exist, and a key that is not the variant\'s own', async () => {
    const printed = await h.physical()
    expect(await setFileCall(printed, keyFor(printed))).toEqual({ ok: false, code: 'NOT_DIGITAL' })
    await unchanged(printed)
    const ghost = randomUUID()
    expect(await setFileCall(ghost, keyFor(ghost))).toEqual({ ok: false, code: 'NOT_FOUND' })

    const variantId = await h.digital()
    const other = await h.digital()
    const bad: Array<[string, Record<string, unknown>]> = [
      ['another variant\'s prefix', { p_storage_key: keyFor(other) }],
      ['no assets prefix', { p_storage_key: `incoming/${randomUUID()}` }],
      ['a tail that is not a uuid', { p_storage_key: `assets/${variantId}/book.pdf` }],
      ['a deeper path', { p_storage_key: `assets/${variantId}/x/${randomUUID()}` }],
      ['no key', { p_storage_key: null }],
      ['a path out of the prefix', { p_storage_key: `assets/${variantId}/../${randomUUID()}` }],
    ]
    for (const [label, over] of bad) await expect(setFileCall(variantId, keyFor(variantId), over), label).rejects.toMatchObject({ code: '22023' })
    // The table's own limits answer too: a type that is not allowed, a name with a slash, a size of zero.
    await expect(setFileCall(variantId, keyFor(variantId), { p_mime: 'application/zip' })).rejects.toMatchObject({ code: '23514' })
    await expect(setFileCall(variantId, keyFor(variantId), { p_filename: 'a/b.pdf' })).rejects.toMatchObject({ code: '23514' })
    await expect(setFileCall(variantId, keyFor(variantId), { p_bytes: 0 })).rejects.toMatchObject({ code: '23514' })
    await unchanged(variantId)
  })

  it('hands the file to the orders that waited for it, once each and mailed once, and leaves a revoked one and a finished one alone', async () => {
    const variantId = await h.digital(3500)
    const a = await h.paid([{ variantId, quantity: 1 }])
    const b = await h.paid([{ variantId, quantity: 1 }])
    const refunded = await h.paid([{ variantId, quantity: 1 }])
    await h.refundFully(refunded, owner.userId)
    for (const p of [a, b, refunded]) expect((await entitlementOf(p.items[0]!.id)).asset_id).toBeNull()
    expect((await entitlementOf(refunded.items[0]!.id)).revoked_at).not.toBeNull()
    // Neither order can download yet, and the mail's own view says so: waiting for a file, nothing will be handed out for a revoked one.
    expect(await issue(a, a.items[0]!.id)).toEqual(NOT_FOUND)
    expect([await hasFile(a), await hasFile(b), await hasFile(refunded)]).toEqual([false, false, null])
    // `a`'s link is about to lapse.
    await h.postgres.query("update finance.orders set access_token_expires_at = now() + interval '1 hour' where id = any($1::uuid[])", [[a.id, b.id, refunded.id]])

    const first = await setFile(variantId)
    const aEntitlement = await entitlementOf(a.items[0]!.id)
    const bEntitlement = await entitlementOf(b.items[0]!.id)
    expect(aEntitlement.asset_id).toBe(first.assetId)
    expect(bEntitlement.asset_id).toBe(first.assetId)
    // The revoked entitlement got nothing.
    expect(await entitlementOf(refunded.items[0]!.id)).toMatchObject({ asset_id: null, revoked_at: expect.anything() })
    // The orders that were filled have a fresh week; the refunded one does not.
    for (const p of [a, b]) {
      expect(Number((await h.row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [p.id])).s)).toBeGreaterThan(7 * 24 * 3600 - 120)
    }
    expect(Number((await h.row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [refunded.id])).s)).toBeLessThan(3700)
    // One mail per waiting entitlement: its own key, the ids of its order and item only, to its buyer.
    const mails = await readyMails([a.id, b.id, refunded.id])
    expect(mails.map((mail) => mail.dedupe_key).sort()).toEqual([`order_ready:${aEntitlement.id}`, `order_ready:${bEntitlement.id}`].sort())
    for (const mail of mails) {
      const buyer = mail.payload.orderId === a.id ? a : b
      expect(mail).toMatchObject({ kind: 'order_ready', priority: 0, recipient: buyer.email.toLowerCase(), status: 'pending' })
      expect(mail.payload).toEqual({ orderId: buyer.id, itemIds: [buyer.items[0]!.id] })
    }
    // The dispatcher renders an `order_ready` row only for lines that hold a file: these do, the revoked one does not.
    expect([await hasFile(a), await hasFile(b), await hasFile(refunded)]).toEqual([true, true, null])
    // They can download now, and the refunded one cannot.
    expect((await issue(a, a.items[0]!.id)).ok).toBe(true)
    expect(await issue(refunded, refunded.items[0]!.id)).toEqual(NOT_FOUND)

    // A second file: the entitlements that have one keep it, nothing is mailed again, and new orders get the new file.
    const second = await setFile(variantId)
    expect((await entitlementOf(a.items[0]!.id)).asset_id).toBe(first.assetId)
    expect((await entitlementOf(b.items[0]!.id)).asset_id).toBe(first.assetId)
    expect(await readyMails([a.id, b.id])).toHaveLength(2)
    expect(await digitalAsset(variantId)).toBe(second.key)
    expect(await assetsOf(variantId)).toHaveLength(2)
    const later = await h.paid([{ variantId, quantity: 1 }])
    expect((await entitlementOf(later.items[0]!.id)).asset_id).toBe(second.assetId)
  })

  it('fills each waiting entitlement exactly once when two files are attached at once', async () => {
    const variantId = await h.digital()
    const orders = [await h.paid([{ variantId, quantity: 1 }]), await h.paid([{ variantId, quantity: 1 }]), await h.paid([{ variantId, quantity: 1 }])]
    const lock = await h.holdLock('select 1 from public.product_variants where id = $1 for update', [variantId])
    const keys = [keyFor(variantId), keyFor(variantId)]
    const calls = keys.map((key, i) => setFileCall(variantId, key, {}, h.pool[i + 1]))
    await sleep(500)
    await lock.release()
    const replies = (await Promise.all(calls)) as Array<{ ok: boolean; filled: number; assetId: string }>

    expect(replies.every((reply) => reply.ok === true)).toBe(true)
    expect(replies.map((reply) => reply.filled).sort()).toEqual([0, 3])
    const winner = replies.find((reply) => reply.filled === 3)!
    for (const p of orders) expect((await entitlementOf(p.items[0]!.id)).asset_id).toBe(winner.assetId)
    expect(await readyMails(orders.map((p) => p.id))).toHaveLength(3)
    expect(await assetsOf(variantId)).toHaveLength(2)
  })

  it('does not deadlock with a refund of the order that waits for the file, and mails only what was filled', async () => {
    const variantId = await h.digital()
    const p = await h.paid([{ variantId, quantity: 1 }])
    // Both queue on the order's row: the file is attached first or the refund is, and either way both finish.
    const lock = await h.holdLock('select 1 from finance.orders where id = $1 for update', [p.id])
    const attached = setFileCall(variantId, keyFor(variantId), {}, h.pool[1])
    const refunded = h.refundFully(p, owner.userId)
    await sleep(500)
    await lock.release()
    const [reply] = await Promise.all([attached, refunded])

    expect(reply.ok).toBe(true)
    expect(await h.row('select status from finance.orders where id = $1', [p.id])).toMatchObject({ status: 'refunded' })
    expect((await entitlementOf(p.items[0]!.id)).revoked_at).not.toBeNull()
    // A file that was attached before the refund was mailed once; one that came after found a revoked entitlement and mailed nothing.
    expect(await readyMails([p.id])).toHaveLength(reply.filled)
  })

  it('fills an order that began to wait after the first read, and answers 55P03 and changes nothing when another writer holds it', async () => {
    const variantId = await h.digital()
    const waiting = await h.paid([{ variantId, quantity: 1 }])
    // An order of another variant whose entitlement is pointed at this one while the call waits for the variant: it was not
    // in the first read, so the call must lock it after the variant, without waiting.
    const late = await h.paid([{ variantId: await h.digital(), quantity: 1 }])
    const latePoint = (): Promise<unknown> =>
      h.postgres.query('update finance.entitlements set variant_id = $1, asset_id = null where order_item_id = $2', [variantId, late.items[0]!.id])

    // 1. Another writer holds the late order: the call refuses to wait, rolls back and the owner tries again. (The variant is
    //    held `for no key update`: it still queues the call's `for update`, and the key-share lock of the foreign key that
    //    pointing the entitlement at it takes is not blocked.)
    const lockVariant = await h.holdLock('select 1 from public.product_variants where id = $1 for no key update', [variantId])
    const refused = setFileCall(variantId, keyFor(variantId), {}, h.pool[1])
    const refusedSettled = refused.then((value) => ({ value }), (error) => ({ error }))
    await sleep(500)
    await latePoint()
    const lockLate = await h.holdLock('select 1 from finance.orders where id = $1 for update', [late.id])
    await lockVariant.release()
    expect(await refusedSettled).toMatchObject({ error: { code: '55P03' } })
    await lockLate.release()
    await unchanged(variantId)
    expect((await entitlementOf(waiting.items[0]!.id)).asset_id).toBeNull()
    expect(await readyMails([waiting.id, late.id])).toHaveLength(0)

    // 2. Nobody holds it: the late order is filled with the others.
    const lockAgain = await h.holdLock('select 1 from public.product_variants where id = $1 for no key update', [variantId])
    const key = keyFor(variantId)
    const filled = setFileCall(variantId, key, {}, h.pool[2])
    await sleep(500)
    await lockAgain.release()
    expect(await filled).toEqual({ ok: true, assetId: key.split('/')[2], filled: 2 })
    expect((await entitlementOf(waiting.items[0]!.id)).asset_id).toBe(key.split('/')[2])
    expect((await entitlementOf(late.items[0]!.id)).asset_id).toBe(key.split('/')[2])
    expect(await readyMails([waiting.id, late.id])).toHaveLength(2)
  })
})

// --- the sweep of abandoned uploads -----------------------------------------------------------------------------------------

describe('paid_files_sweep_candidates', () => {
  const bucket = serviceClient.storage.from('paid-files')
  const uploaded: string[] = []
  const put = async (key: string, age: string | null): Promise<void> => {
    const { error } = await bucket.upload(key, new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    expect(error, `upload ${key}`).toBeNull()
    uploaded.push(key)
    if (age) await h.postgres.query("update storage.objects set created_at = now() - $2::interval where bucket_id = 'paid-files' and name = $1", [key, age])
  }
  afterAll(async () => {
    if (uploaded.length > 0) await bucket.remove(uploaded)
  })

  it('lists only upload parts under incoming/ older than 24 hours, oldest first, and never anything under assets/', async () => {
    const tag = randomUUID()
    const oldest = `incoming/${tag}-oldest`
    const old = `incoming/${tag}-old`
    const fresh = `incoming/${tag}-fresh`
    const justUnder = `incoming/${tag}-23h`
    const asset = `assets/${randomUUID()}/${randomUUID()}`
    const lookalike = `incoming-${tag}/x`
    await put(oldest, '3 days')
    await put(old, '25 hours')
    await put(fresh, null)
    await put(justUnder, '23 hours')
    await put(asset, '30 days')
    await put(lookalike, '30 days')

    const listed = ((await h.call('paid_files_sweep_candidates', { p_limit: 1000 })) as string[]).filter((name) => name.includes(tag))
    expect(listed).toEqual([oldest, old])
    // The limit is honored (a limit below one is one), and the oldest come first.
    const first = (await h.call('paid_files_sweep_candidates', { p_limit: 1 })) as string[]
    expect(first).toHaveLength(1)
    expect(await h.call('paid_files_sweep_candidates', { p_limit: 0 })).toHaveLength(1)
    expect(await h.call('paid_files_sweep_candidates', { p_limit: null })).toHaveLength(1)
    // Nothing of any other bucket or prefix is ever named.
    const everything = (await h.call('paid_files_sweep_candidates', { p_limit: 1000 })) as string[]
    expect(everything.every((name) => name.startsWith('incoming/'))).toBe(true)
    expect(everything).not.toContain(asset)
  })
})
