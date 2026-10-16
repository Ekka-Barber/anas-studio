// P12 round R1: the wall outside the board. A board-only person signs in like any other staff member, so every place that admitted
// "any staff role" would admit them to the catalogue, the hidden posts or the owner's screens. This file proves what a `board`
// token reaches through the Data API, the SQL functions and the Edge Functions, next to what an `editor`, an `operations` member
// and an owner read today (the four policies of PLANS/P12-CONTRACT.md section 2 name their roles now), and that the schema
// `board` itself is not exposed to any role (`Accept-Profile: board`). The functions of the board are `board.test.ts`.
//
// The Edge Functions' side of the wall (the `admin` function's actions refuse a board token) is in `staff-admin.test.ts`, with the other
// tests that need the edge runtime. The Data API clients are real sessions (`signIn`, an emailed one-time code through the local Mailpit). The fixtures (a draft
// product with a variant, a published one, a disabled and an enabled city rate, a hidden post, a visible one and a draft) are
// written as the local superuser with a name of their own and removed in `afterAll`.
import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { anonClient, createStaff, signIn, status } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
type Any = any
type WhoAmI = 'board' | 'editor' | 'operations' | 'owner'

let pg: Client
const clients = {} as Record<WhoAmI, SupabaseClient>
const userIds = {} as Record<WhoAmI, string>

const tag = randomUUID().replace(/-/g, '').slice(0, 10)
const fixture = {
  draftProduct: randomUUID(),
  publishedProduct: randomUUID(),
  draftVariant: randomUUID(),
  publishedVariant: randomUUID(),
  offRate: `wall-off-${tag}`,
  onRate: `wall-on-${tag}`,
  hiddenPost: `wall-hidden-${tag}`,
  visiblePost: `wall-visible-${tag}`,
  draftPost: `wall-draft-${tag}`,
}

beforeAll(async () => {
  pg = new Client({ connectionString: DATABASE_URL })
  await pg.connect()
  await pg.query("insert into public.products (id, slug, title, status) values ($1, $2, 'منتج مسودة', 'draft'), ($3, $4, 'منتج منشور', 'published')", [
    fixture.draftProduct,
    `wall-draft-${tag}`,
    fixture.publishedProduct,
    `wall-published-${tag}`,
  ])
  await pg.query(
    "insert into public.product_variants (id, product_id, sku, title, fulfillment, price_halalas, enabled, stock) values ($1, $2, $3, 'خيار مسودة', 'physical', 1000, true, 3), ($4, $5, $6, 'خيار منشور', 'physical', 1000, true, 3)",
    [fixture.draftVariant, fixture.draftProduct, `WALL-D-${tag.toUpperCase()}`, fixture.publishedVariant, fixture.publishedProduct, `WALL-P-${tag.toUpperCase()}`],
  )
  await pg.query("insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, 'مدينة معطلة', 1000, false), ($2, 'مدينة مفعلة', 1000, true)", [fixture.offRate, fixture.onRate])
  const version = (docId: string, visible: boolean) =>
    pg.query("insert into public.content_versions (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)", [docId, JSON.stringify({ title: `عنوان ${docId}`, visible })])
  const publish = (docId: string, visible: boolean) =>
    pg.query("insert into public.published_documents (collection, doc_id, seq, data) values ('posts', $1, 1, $2::jsonb)", [docId, JSON.stringify({ title: `عنوان ${docId}`, visible })])
  await version(fixture.hiddenPost, false)
  await publish(fixture.hiddenPost, false)
  await version(fixture.visiblePost, true)
  await publish(fixture.visiblePost, true)
  await version(fixture.draftPost, true)
  for (const role of ['board', 'editor', 'operations', 'owner'] as const) {
    const made = await createStaff(role)
    userIds[role] = made.userId
    clients[role] = await signIn(made.email)
  }
})

afterAll(async () => {
  await pg.query("delete from public.published_documents where collection = 'posts' and doc_id = any($1::text[])", [[fixture.hiddenPost, fixture.visiblePost]])
  await pg.query("delete from public.content_versions where collection = 'posts' and doc_id = any($1::text[])", [[fixture.hiddenPost, fixture.visiblePost, fixture.draftPost]])
  await pg.query('delete from public.shipping_rates where city_key = any($1::text[])', [[fixture.offRate, fixture.onRate]])
  await pg.query('delete from public.product_variants where id = any($1::uuid[])', [[fixture.draftVariant, fixture.publishedVariant]])
  await pg.query('delete from public.products where id = any($1::uuid[])', [[fixture.draftProduct, fixture.publishedProduct]])
  await pg.end()
})

/** What a client reads of the four tables the policies guard, among the fixtures. */
async function readFixtures(client: SupabaseClient) {
  const products = await client.from('products').select('id').in('id', [fixture.draftProduct, fixture.publishedProduct])
  const variants = await client.from('product_variants').select('id').in('id', [fixture.draftVariant, fixture.publishedVariant])
  const rates = await client.from('shipping_rates').select('city_key').in('city_key', [fixture.offRate, fixture.onRate])
  const posts = await client.from('published_documents').select('doc_id').in('doc_id', [fixture.hiddenPost, fixture.visiblePost])
  for (const [name, answer] of Object.entries({ products, variants, rates, posts })) expect(answer.error, name).toBeNull()
  return {
    products: (products.data ?? []).map((r: Any) => r.id as string).sort(),
    variants: (variants.data ?? []).map((r: Any) => r.id as string).sort(),
    rates: (rates.data ?? []).map((r: Any) => r.city_key as string).sort(),
    posts: (posts.data ?? []).map((r: Any) => r.doc_id as string).sort(),
  }
}

describe('a board token', () => {
  it('reads no draft product, no variant row, no disabled shipping rate and no hidden post through the Data API', async () => {
    const seen = await readFixtures(clients.board)
    // The published product and the visible post are read (a test that reads nothing proves nothing); the rest is not.
    expect(seen.products).toEqual([fixture.publishedProduct])
    expect(seen.posts).toEqual([fixture.visiblePost])
    expect(seen.variants).toEqual([])
    expect(seen.rates).toEqual([])
    const drafts = await clients.board.from('content_versions').select('doc_id').in('doc_id', [fixture.draftPost, fixture.visiblePost, fixture.hiddenPost])
    expect(drafts.error).toBeNull()
    expect(drafts.data).toEqual([])
  })

  it('reads nothing else of the admin: the rest of the tables are empty for it, and the staff table holds only its own row', async () => {
    for (const table of ['audit_events', 'content_versions', 'content_documents', 'coupons', 'customers', 'media', 'notifications']) {
      const answer = await clients.board.from(table).select('*').limit(1)
      expect(answer.error, table).toBeNull()
      expect(answer.data, table).toEqual([])
    }
    const staff = await clients.board.from('staff').select('user_id')
    expect(staff.data).toEqual([{ user_id: userIds.board }])
    expect((await clients.board.rpc('current_staff_role')).data).toBe('board')
  })

  it('is refused by every SQL function the admin calls: each one names the roles that may', async () => {
    const found = (
      await pg.query<{ proname: string; types: string[] }>(
        `select p.proname, array(select format_type(t, null) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) t) as types
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
            and p.proname not like 'board\\_%' and p.proname not in ('current_staff_role', 'media_rename_folder')
          order by 1`,
      )
    ).rows
    // The functions an admin screen calls today: a guard against a new one granted without a role check slipping by unseen.
    expect(found.length).toBeGreaterThan(25)
    const dummy = (type: string): unknown => {
      if (type === 'uuid') return randomUUID()
      if (type === 'uuid[]') return [randomUUID()]
      if (type === 'text') return 'x'
      if (type === 'integer' || type === 'bigint') return 1
      if (type === 'boolean') return false
      if (type === 'jsonb') return {}
      if (type === 'timestamp with time zone') return new Date().toISOString()
      if (type === 'content_collection') return 'posts'
      throw new Error(`board-wall: no dummy value for the type ${type}; add one`)
    }
    const names = (
      await pg.query<{ proname: string; names: string[] | null }>(
        "select p.proname, p.proargnames as names from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])",
        [found.map((f) => f.proname)],
      )
    ).rows
    for (const f of found) {
      const argNames = names.find((n) => n.proname === f.proname)?.names ?? []
      const args = Object.fromEntries(f.types.map((type, i) => [argNames[i]!, dummy(type)]))
      const answer = await clients.board.rpc(f.proname, args)
      expect(answer.error?.code, `${f.proname} as a board person`).toBe('42501')
    }
    // `media_rename_folder` runs as the caller, under the media policies (owners and editors): it changes no row for them.
    const renamed = await clients.board.rpc('media_rename_folder', { p_from: `wall-${tag}`, p_to: `wall-${tag}-x` })
    expect(renamed.error).toBeNull()
    expect(renamed.data).toBe(0)
  })
})

describe('an editor, an operations member and an owner read what they read today', () => {
  it('every staff role the policies name reads the drafts, the variants, the rates and the hidden posts', async () => {
    for (const role of ['editor', 'operations', 'owner'] as const) {
      const seen = await readFixtures(clients[role])
      expect(seen.products, role).toEqual([fixture.draftProduct, fixture.publishedProduct].sort())
      expect(seen.variants, role).toEqual([fixture.draftVariant, fixture.publishedVariant].sort())
      expect(seen.rates, role).toEqual([fixture.offRate, fixture.onRate].sort())
      expect(seen.posts, role).toEqual([fixture.hiddenPost, fixture.visiblePost].sort())
    }
  })

  it('the drafts of the content stay for owners and editors, as before', async () => {
    const draft = (client: SupabaseClient) => client.from('content_versions').select('doc_id').eq('doc_id', fixture.draftPost)
    for (const role of ['editor', 'owner'] as const) expect((await draft(clients[role])).data, role).toEqual([{ doc_id: fixture.draftPost }])
    expect((await draft(clients.operations)).data).toEqual([])
  })

  it('anon reads what it read: published products, enabled variants and rates, visible posts', async () => {
    const seen = await readFixtures(anonClient())
    expect(seen.products).toEqual([fixture.publishedProduct])
    expect(seen.variants).toEqual([fixture.publishedVariant])
    expect(seen.rates).toEqual([fixture.onRate])
    expect(seen.posts).toEqual([fixture.visiblePost])
  })
})

describe('the policies', () => {
  const FOUR = [
    ['products', 'products_read_staff'],
    ['product_variants', 'product_variants_read_staff'],
    ['shipping_rates', 'shipping_rates_read_staff'],
    ['published_documents', 'published_documents_staff_read'],
  ] as const

  it('the four that admitted any staff role name the owner, the editor and the operations member, and nothing admits a role by "is not null"', async () => {
    for (const [table, policy] of FOUR) {
      const found = (await pg.query("select cmd, roles::text as roles, qual from pg_policies where schemaname = 'public' and tablename = $1 and policyname = $2", [table, policy])).rows
      expect(found, policy).toHaveLength(1)
      expect(found[0].cmd).toBe('SELECT')
      expect(found[0].roles).toBe('{authenticated}')
      for (const role of ['owner', 'editor', 'operations']) expect(found[0].qual, `${policy}: ${role}`).toContain(`'${role}'::staff_role`)
      expect(found[0].qual, policy).not.toContain("'board'")
    }
    const loose = (
      await pg.query(
        "select tablename, policyname from pg_policies where schemaname in ('public', 'storage', 'board') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'current_staff_role.*is not null'",
      )
    ).rows
    expect(loose).toEqual([])
  })

  it('no function admits an active staff member of any role without naming the roles: the helpers that read the staff table name theirs', async () => {
    // The SQL functions that read `public.staff` and are granted to a client name a role in the same body (a role list or the owner).
    const found = (
      await pg.query<{ proname: string; prosrc: string }>(
        `select p.proname, p.prosrc from pg_proc p
          where p.pronamespace in ('public'::regnamespace, 'finance'::regnamespace)
            and has_function_privilege('authenticated', p.oid, 'execute')
            and p.proname not like 'board\\_%' and p.proname <> 'current_staff_role'
            and (p.prosrc ~ 'public\\.staff' or p.prosrc ~ 'current_staff_role' or p.prosrc ~ 'require_staff')`,
      )
    ).rows
    expect(found.length).toBeGreaterThan(10)
    for (const f of found) {
      const names = /'owner'|'operations'|'editor'|require_staff|content_assert_publisher/.test(f.prosrc)
      expect(names, `${f.proname} names the roles it admits`).toBe(true)
    }
  })
})

describe('Accept-Profile: board', () => {
  it('is refused for anon and for every staff role, on a read, a write and a function call', async () => {
    const tokens: [string, string | null][] = [['anon', null]]
    for (const role of ['board', 'editor', 'operations', 'owner'] as const) {
      tokens.push([role, (await clients[role].auth.getSession()).data.session!.access_token])
    }
    for (const [who, token] of tokens) {
      const base = { apikey: status.PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      for (const table of ['projects', 'cards', 'activity', 'members']) {
        const read = await fetch(`${status.API_URL}/rest/v1/${table}?select=*`, { headers: { ...base, 'Accept-Profile': 'board' } })
        expect(read.status, `${who}: GET ${table}`).toBe(406)
        expect(await read.json(), `${who}: GET ${table}`).toMatchObject({ code: 'PGRST106' })
      }
      const write = await fetch(`${status.API_URL}/rest/v1/projects`, {
        method: 'POST',
        headers: { ...base, 'Content-Profile': 'board' },
        body: JSON.stringify({ name: 'x', created_by: randomUUID() }),
      })
      expect(write.status, `${who}: POST`).toBe(406)
      const call = await fetch(`${status.API_URL}/rest/v1/rpc/caller`, { method: 'POST', headers: { ...base, 'Content-Profile': 'board' }, body: '{}' })
      expect(call.status, `${who}: rpc`).toBe(406)
    }
    // And nothing was written.
    expect((await pg.query('select count(*)::int as n from board.projects where name = $1', ['x'])).rows[0].n).toBe(0)
  })
})
