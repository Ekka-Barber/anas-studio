// P08 round 11c: `public.variant_admin_info` of
// `supabase/migrations/20261003110000_variant_admin_info.sql` against the real local
// database. It is granted to `authenticated` and rechecks the caller's role inside, so it
// is called as signed-in staff: through the Data API (one session per role, for the
// refusals) and through direct `authenticated` sessions with the member's claims (the
// answers). Orders go through `checkout_create` and are paid by `apply_verified_payment`
// (the shared fixtures of `support.ts`); the paid file is recorded by `paid_asset_set`,
// the function the `admin` Edge function calls, as `service_role`. What only the database
// could write (a variant turned into a preorder, a released reservation) is written as the
// local `postgres` superuser. Nothing here reaches Moyasar or sends a mail. This file
// switches `finance.commerce_settings.checkout_enabled` on, saved and restored by the
// fixtures; every fixture carries a per-run unique slug, SKU, email or storage key.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { anonClient, commerceHarness, type Harness, pgRpc, signIn, staffDb } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const PEPPER = `variant-admin-info-pepper-${randomUUID()}`
const SIGNATURE = 'public.variant_admin_info(uuid)'
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' }
const keys = (value: object): string[] => Object.keys(value).sort()

type Member = { userId: string; email: string }
let h: Harness
let owner: Member
let operations: Member
let editor: Member
let revokedOwner: Member
let inactiveOperations: Member
const sessions: Client[] = []

async function session(member: Member): Promise<Client> {
  const db = await staffDb(member.userId)
  sessions.push(db)
  return db
}

/** What a signed-in staff session answers for a variant. */
const info = (db: Client, variant: string | null): Promise<any> => pgRpc(db)('variant_admin_info', { p_variant: variant }) as Promise<any>

let ownerDb: Client
let opsDb: Client

beforeAll(async () => {
  h = await commerceHarness(PEPPER, 4)
  owner = await h.makeStaff('owner')
  operations = await h.makeStaff('operations')
  editor = await h.makeStaff('editor')
  revokedOwner = await h.makeStaff('owner', { active: false })
  inactiveOperations = await h.makeStaff('operations', { active: false })
  ownerDb = await session(owner)
  opsDb = await session(operations)
})

afterAll(async () => {
  for (const db of sessions) await db.end()
  await h.stop()
})

/** The file as the `admin` function records it: an asset under `assets/<variant>/<uuid>` and the variant pointed at it. */
async function recordFile(variant: string, filename: string, mime: string, bytes: number): Promise<string> {
  const key = `assets/${variant}/${randomUUID()}`
  const set = await h.call('paid_asset_set', { p_actor: owner.userId, p_variant: variant, p_storage_key: key, p_filename: filename, p_mime: mime, p_bytes: bytes })
  expect(set, JSON.stringify(set)).toMatchObject({ ok: true })
  return key
}

describe('the function', () => {
  it('is granted to authenticated only, security definer, owned by postgres, search_path empty', async () => {
    const can = async (role: string): Promise<boolean> => (await h.row('select has_function_privilege($1, $2, $3) as ok', [role, SIGNATURE, 'execute'])).ok as boolean
    expect(await can('authenticated')).toBe(true)
    expect(await can('anon')).toBe(false)
    // Nothing for PUBLIC either: the ACL exists and has no entry for grantee 0.
    const acl = await h.row(
      `select p.proacl is not null as has_acl, (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_entries
         from pg_proc p where p.oid = $1::regprocedure`,
      [SIGNATURE],
    )
    expect(acl).toEqual({ has_acl: true, public_entries: 0 })
    const meta = await h.row('select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner from pg_proc p where p.oid = $1::regprocedure', [SIGNATURE])
    expect(meta.prosecdef).toBe(true)
    expect(meta.proconfig).toContain('search_path=""')
    expect(meta.owner).toBe('postgres')
  })

  it('refuses anon, an editor, a revoked owner and an inactive operations member (42501), the role before the lookup', async () => {
    const variant = await h.physical(4000, 5)
    const clients: Array<[string, SupabaseClient]> = [
      ['anon', anonClient()],
      ['an editor', await signIn(editor.email)],
      ['a revoked owner', await signIn(revokedOwner.email)],
      ['an inactive operations member', await signIn(inactiveOperations.email)],
    ]
    for (const [who, client] of clients) {
      for (const id of [variant, randomUUID()]) {
        const { data, error } = await client.rpc('variant_admin_info', { p_variant: id })
        expect(error?.code, `${who}: ${id}`).toBe('42501')
        expect(data, who).toBeNull()
      }
    }
  })

  it('answers an owner and an operations member alike, through the Data API too', async () => {
    const variant = await h.physical(4000, 5)
    for (const member of [owner, operations]) {
      const { data, error } = await (await signIn(member.email)).rpc('variant_admin_info', { p_variant: variant })
      expect(error).toBeNull()
      expect(data).toEqual({ ok: true, preorderUnits: 0, file: null })
    }
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 0, file: null })
    expect(await info(opsDb, variant)).toEqual({ ok: true, preorderUnits: 0, file: null })
  })

  it('answers NOT_FOUND for an unknown id, and for none, to both roles', async () => {
    for (const db of [ownerDb, opsDb]) {
      expect(await info(db, randomUUID())).toEqual(NOT_FOUND)
      expect(await info(db, null)).toEqual(NOT_FOUND)
    }
  })
})

describe('the confirmed preorders', () => {
  it('counts only the committed reservations that were preorders when they were made', async () => {
    // A copy sold while the variant was an ordinary edition: committed, but never a preorder.
    const variant = await h.physical(4000, 10)
    await h.paid([{ variantId: variant, quantity: 2 }])
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 0, file: null })

    // The owner then turns it into a preorder (what the variant form saves).
    await h.postgres.query(
      "update public.product_variants set preorder = true, preorder_capacity = 50, preorder_ships_on = '2030-01-01', preorder_note = 'يصلك بعد الطباعة' where id = $1",
      [variant],
    )
    await h.paid([{ variantId: variant, quantity: 3 }])
    const held = await h.place([{ variantId: variant, quantity: 4 }])
    const released = await h.place([{ variantId: variant, quantity: 5 }])
    await h.postgres.query("update finance.inventory_reservations set state = 'released', released_at = now() where order_id = $1", [released.id])
    expect((await h.rows('select state, preorder, quantity from finance.inventory_reservations where variant_id = $1 order by id', [variant])).map((r) => `${r.state}:${r.preorder}:${r.quantity}`)).toEqual([
      'committed:false:2',
      'committed:true:3',
      'held:true:4',
      'released:true:5',
    ])
    // Only the committed preorder counts: not the ordinary committed sale, not the hold, not the released one.
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 3, file: null })
    expect(await info(opsDb, variant)).toEqual({ ok: true, preorderUnits: 3, file: null })

    // The hold is paid: it becomes a confirmed preorder and the count follows.
    await h.applyPayment(held, await h.startPayment(held))
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 7, file: null })

    // A confirmed preorder that has shipped is no longer owed from the stock on hand: it leaves the count (the capacity rule keeps it).
    await h.postgres.query(
      `update finance.fulfillments f set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-11C', shipped_at = now()
         from finance.order_items i
        where f.order_item_id = i.id and i.variant_id = $1
          and i.order_id = (select r.order_id from finance.inventory_reservations r where r.variant_id = $1 and r.state = 'committed' and r.preorder and r.quantity = 3)`,
      [variant],
    )
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 4, file: null })
    await h.postgres.query(
      `update finance.fulfillments f set state = 'delivered', delivered_at = now()
         from finance.order_items i
        where f.order_item_id = i.id and i.variant_id = $1 and f.state = 'shipped'`,
      [variant],
    )
    expect(await info(ownerDb, variant)).toMatchObject({ preorderUnits: 4 })

    // Another variant's preorders never count here.
    const other = await h.makeVariant({ fulfillment: 'physical', price: 3000, stock: 0, preorder: { capacity: 9 } })
    await h.paid([{ variantId: other, quantity: 2 }])
    expect(await info(ownerDb, variant)).toMatchObject({ preorderUnits: 4 })
    expect(await info(ownerDb, other)).toMatchObject({ preorderUnits: 2 })
  })

  it('counts the units of a digital preorder too (it takes capacity)', async () => {
    const variant = await h.makeVariant({ fulfillment: 'digital', price: 3500, preorder: { capacity: 5 } })
    // A digital line is one copy (M1b-6), so two orders of one copy each.
    await h.paid([{ variantId: variant, quantity: 1 }])
    await h.paid([{ variantId: variant, quantity: 1 }])
    expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 2, file: null })
  })
})

describe('the paid file', () => {
  it('is null for a physical variant and for a digital one with no file yet', async () => {
    expect((await info(ownerDb, await h.physical(4000, 3))).file).toBeNull()
    expect((await info(ownerDb, await h.digital())).file).toBeNull()
  })

  it('shows the name, type, size and time of the variant\'s current file, and no storage key', async () => {
    const variant = await h.digital()
    const first = await recordFile(variant, 'كتاب.pdf', 'application/pdf', 1234)
    const reply = await info(ownerDb, variant)
    expect(reply).toMatchObject({ ok: true, preorderUnits: 0 })
    expect(keys(reply)).toEqual(['file', 'ok', 'preorderUnits'])
    expect(keys(reply.file)).toEqual(['bytes', 'createdAt', 'filename', 'mime'])
    expect(reply.file).toMatchObject({ filename: 'كتاب.pdf', mime: 'application/pdf', bytes: 1234 })
    const stored = await h.row('select created_at from finance.paid_assets where storage_key = $1', [first])
    expect(Date.parse(reply.file.createdAt)).toBe((stored.created_at as Date).getTime())
    // The key is nowhere in the reply, nor anything that names an order or a buyer.
    const text = JSON.stringify(reply)
    expect(text).not.toContain(first)
    expect(text).not.toContain('assets/')
    expect(text).not.toContain('storage')
    expect(await info(opsDb, variant)).toEqual(reply)

    // A replacement is the current file; the first stays in the ledger, out of the reply.
    const second = await recordFile(variant, 'second.epub', 'application/epub+zip', 98_765)
    const replaced = await info(ownerDb, variant)
    expect(replaced.file).toMatchObject({ filename: 'second.epub', mime: 'application/epub+zip', bytes: 98_765 })
    expect(JSON.stringify(replaced)).not.toContain(second)
    expect(await h.count('select count(*)::int as n from finance.paid_assets where variant_id = $1', [variant])).toBe(2)
  })

  it('is a read: it takes no lock a writer would wait for, and changes nothing', async () => {
    const variant = await h.digital()
    const before = await h.row('select version, stock, digital_asset from public.product_variants where id = $1', [variant])
    const lock = await h.holdLock('select 1 from public.product_variants where id = $1 for update', [variant])
    try {
      // A writer holds the variant's row: the read answers all the same.
      expect(await info(ownerDb, variant)).toEqual({ ok: true, preorderUnits: 0, file: null })
    } finally {
      await lock.release()
    }
    expect(await h.row('select version, stock, digital_asset from public.product_variants where id = $1', [variant])).toEqual(before)
  })
})
