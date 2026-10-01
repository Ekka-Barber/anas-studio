// P07: the catalog and checkout SQL surface (`supabase/migrations/
// 20260927160000_catalog_and_checkout.sql`) against the real local database.
// The three checkout entry points are called as `service_role` (the `checkout`
// Edge Function's role, D32) through direct sessions; the catalog's RLS and
// grants go through real JWTs, like tests/integration/forms.test.ts. This file
// is the only one that switches `finance.commerce_settings.checkout_enabled`
// on: the row is saved in beforeAll and restored in afterAll. Every fixture it
// writes carries a per-run unique slug, SKU, code or email.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { anonClient, createStaff, pgRpc, serviceRoleDb, signIn, uniqueEmail } from './support'

const PEPPER = `integration-pepper-${randomUUID()}`
const REV = { store: 1, delivery: 1, refund: 1 }

/** The buyer's access token and its hash, exactly as the Edge Function computes them. */
function tokenFor(idempotencyKey: string): string {
  return createHmac('sha256', PEPPER).update(`order-access:${idempotencyKey}`).digest('base64url')
}
function hashFor(token: string): string {
  return createHash('sha256').update(`${PEPPER}:order:${token}`).digest('hex')
}

let postgres: Client
/** Six `service_role` sessions: the main one plus the concurrency tests' own connections. */
const pool: Client[] = []

beforeAll(async () => {
  postgres = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await postgres.connect()
  for (let i = 0; i < 6; i += 1) {
    const client = await serviceRoleDb()
    pool.push(client)
  }
  const saved = await postgres.query<Record<string, unknown>>(
    'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
  )
  settingsSaved = saved.rows[0]!
  // Refusals first: the store starts exactly as the migration leaves it, even
  // when the local demo seed (D37) has filled the row; afterAll restores it.
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = false, seller_legal_name = null, seller_address = null,
       seller_registration = null, policy_revisions = '{}'::jsonb where id = 1`,
  )
  // The whole-store daily bucket (500 a day) is shared by every run on this
  // machine; each run uses about 45 creates, so a busy day of reruns would trip
  // it. Every other bucket this file touches is keyed by a per-run hash.
  await postgres.query("delete from finance.rate_limits where bucket = 'checkout:all'")
})

let settingsSaved: Record<string, unknown> | undefined

afterAll(async () => {
  // Fixtures cannot be deleted (orders reference them), so they leave the
  // local store: products archived, city rates and coupons disabled.
  await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
  await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
  await postgres.query('update public.coupons set enabled = false where id = any($1::uuid[])', [created.coupons])
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

/** What this run created, retired in afterAll. */
const created = { products: [] as string[], rates: [] as string[], coupons: [] as string[] }

let counter = 0
function unique(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}`
}
function ipHash(): string {
  return createHash('sha256').update(unique('ip')).digest('hex')
}

// --- fixtures (the superuser writes what only the owner could, faster) ------

async function makeProduct(status = 'published'): Promise<string> {
  const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const id = (
    await postgres.query<{ id: string }>(
      `insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', $3) returning id`,
      [slug, `منتج ${slug}`, status],
    )
  ).rows[0]!.id
  created.products.push(id)
  return id
}

type VariantSpec = {
  fulfillment: 'digital' | 'physical' | 'signed'
  price: number
  stock?: number | null
  low?: number | null
  enabled?: boolean
}

async function makeVariant(productId: string, spec: VariantSpec): Promise<string> {
  const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const id = (
    await postgres.query<{ id: string }>(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [productId, sku, `خيار ${sku}`, spec.fulfillment, spec.price, spec.enabled ?? true, spec.stock ?? null, spec.low ?? null],
    )
  ).rows[0]!.id
  return id
}

async function makeRate(fee: number | null, enabled = true): Promise<string> {
  const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
  await postgres.query(
    'insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, $4)',
    [key, `مدينة ${key}`, fee, enabled],
  )
  created.rates.push(key)
  return key
}

type CouponSpec = {
  kind: 'percent' | 'fixed'
  percentBp?: number
  amount?: number
  minSubtotal?: number
  usageLimit?: number | null
  productIds?: string[]
  startsAt?: string | null
  endsAt?: string | null
}

async function makeCoupon(spec: CouponSpec): Promise<{ id: string; code: string }> {
  const code = unique('CODE').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const id = (
    await postgres.query<{ id: string }>(
      `insert into public.coupons (code, kind, percent_bp, amount_halalas, starts_at, ends_at, min_subtotal_halalas, usage_limit, product_ids, enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) returning id`,
      [
        code,
        spec.kind,
        spec.percentBp ?? null,
        spec.amount ?? null,
        spec.startsAt ?? null,
        spec.endsAt ?? null,
        spec.minSubtotal ?? 0,
        spec.usageLimit ?? null,
        spec.productIds ?? [],
      ],
    )
  ).rows[0]!.id
  created.coupons.push(id)
  return { id, code }
}

type Line = { variantId: string; quantity: number; dedication?: string | null }

const rpc = (client: Client) => pgRpc(client)

async function quote(client: Client, lines: Line[], cityKey?: string | null, couponCode?: string | null): Promise<any> {
  return rpc(client)('checkout_quote', {
    p_ip_hash: ipHash(),
    p_lines: lines,
    p_city_key: cityKey ?? null,
    p_coupon_code: couponCode ?? null,
  })
}

type CreateSpec = {
  lines: Line[]
  cityKey?: string | null
  couponCode?: string | null
  address?: string | null
  email?: string
  phone?: string | null
  policyRevisions?: Record<string, number>
  quoteHash?: string
  idempotencyKey?: string
  checkoutSession?: string
  requestHash?: string
}

/** Quotes the cart, then creates with that quote's hash unless the spec overrides it. */
async function createOrder(client: Client, spec: CreateSpec): Promise<{ result?: any; code?: string }> {
  const priced = await quote(client, spec.lines, spec.cityKey, spec.couponCode)
  // The request hash is derived from the key, so a repeated call with the same
  // key repeats the same request — the duplicate path, not a conflict.
  const key = spec.idempotencyKey ?? randomUUID()
  const args = {
    p_idempotency_key: key,
    p_request_hash: spec.requestHash ?? createHash('sha256').update(`request:${key}`).digest('hex'),
    p_checkout_session: spec.checkoutSession ?? randomUUID(),
    p_ip_hash: ipHash(),
    p_email: spec.email ?? uniqueEmail('buyer'),
    p_name: 'مشترٍ',
    p_phone: spec.phone === undefined ? '966501234567' : spec.phone,
    p_lines: spec.lines,
    p_city_key: spec.cityKey ?? null,
    p_address: spec.address === undefined ? 'تبوك شارع الرئيسي' : spec.address,
    p_coupon_code: spec.couponCode ?? null,
    p_policy_revisions: spec.policyRevisions ?? REV,
    p_quote_hash: spec.quoteHash ?? priced.quoteHash,
    p_access_token_hash: hashFor(tokenFor(key)),
    p_environment: 'test',
  }
  try {
    return { result: await rpc(client)('checkout_create', args) }
  } catch (error) {
    return { code: (error as { code?: string }).code }
  }
}

// --- grants and access -------------------------------------------------------

describe('grants and access (D32)', () => {
  it('anon and authenticated cannot execute the three checkout functions; service_role can', async () => {
    for (const call of [
      { fn: 'checkout_quote', args: { p_ip_hash: ipHash(), p_lines: [], p_city_key: null, p_coupon_code: null } },
      {
        fn: 'checkout_create',
        args: {
          p_idempotency_key: randomUUID(),
          p_request_hash: '0'.repeat(64),
          p_checkout_session: randomUUID(),
          p_ip_hash: ipHash(),
          p_email: 'x@example.com',
          p_name: 'x',
          p_phone: null,
          p_lines: [],
          p_city_key: null,
          p_address: null,
          p_coupon_code: null,
          p_policy_revisions: {},
          p_quote_hash: '0'.repeat(64),
          p_access_token_hash: '0'.repeat(64),
          p_environment: 'test',
        },
      },
      { fn: 'checkout_cancel', args: { p_order_number: 'ABCD2345', p_access_token_hash: '0'.repeat(64) } },
    ]) {
      const anon = await anonClient().rpc(call.fn, call.args)
      expect(anon.error?.code, `${call.fn} anon`).toBe('42501')
      const editor = await signIn((await createStaff('editor')).email)
      const staff = await editor.rpc(call.fn, call.args)
      expect(staff.error?.code, `${call.fn} authenticated`).toBe('42501')
    }
    const executed = await rpc(pool[0]!)('checkout_quote', {
      p_ip_hash: ipHash(),
      p_lines: [],
      p_city_key: null,
      p_coupon_code: null,
    })
    expect(executed).toMatchObject({ ok: false, errors: [{ code: 'EMPTY_CART' }] })
  })

  it('no API role, service_role included, holds any privilege on the finance functions of the migration', async () => {
    const signatures = (
      await postgres.query<{ sig: string }>(
        `select p.oid::regprocedure::text as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'finance'
            and p.proname in ('active_holds', 'coupon_uses', 'random_order_number', 'checkout_price', 'order_summary', 'checkout_expire')`,
      )
    ).rows.map((row) => row.sig)
    expect(signatures).toHaveLength(6)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const sig of signatures) {
        const held = await postgres.query<{ ok: boolean }>('select has_function_privilege($1, $2, $3) as ok', [role, sig, 'execute'])
        expect(held.rows[0]!.ok, `${role} on ${sig}`).toBe(false)
      }
    }
  })

  it('anon cannot read coupons or customers', async () => {
    const coupons = await anonClient().from('coupons').select('id')
    expect(coupons.error?.code).toBe('42501')
    const customers = await anonClient().from('customers').select('id')
    expect(customers.error?.code).toBe('42501')
  })

  it('anon cannot select a variant\'s stock, digital asset or low-stock threshold, but reads the priced public columns', async () => {
    const product = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 5 })
    for (const column of ['stock', 'digital_asset', 'low_stock_threshold']) {
      const read = await anonClient().from('product_variants').select(column).eq('id', variant)
      expect(read.error?.code, column).toBe('42501')
    }
    const allowed = await anonClient().from('product_variants').select('id, sku, title, fulfillment, price_halalas').eq('id', variant)
    expect(allowed.error).toBeNull()
    expect(allowed.data).toHaveLength(1)
  })

  it('anon sees only published products, their enabled variants, and the enabled priced city rates', async () => {
    const published = await makeProduct('published')
    const draft = await makeProduct('draft')
    const enabled = await makeVariant(published, { fulfillment: 'digital', price: 1500 })
    const disabled = await makeVariant(published, { fulfillment: 'digital', price: 1500, enabled: false })
    await makeVariant(draft, { fulfillment: 'digital', price: 1500 })
    const priced = await makeRate(2500)
    const off = await makeRate(2500, false)
    const free = await makeRate(null)

    const products = await anonClient().from('products').select('id').in('id', [published, draft])
    expect(products.data?.map((row) => row.id)).toEqual([published])

    const variants = await anonClient().from('product_variants').select('id').in('id', [enabled, disabled])
    expect(variants.data?.map((row) => row.id)).toEqual([enabled])

    const rates = await anonClient().from('shipping_rates').select('city_key').in('city_key', [priced, off, free])
    expect(rates.data?.map((row) => row.city_key)).toEqual([priced])
  })

  it('an editor and an operations member cannot insert or update catalog rows', async () => {
    const editor = await signIn((await createStaff('editor')).email)
    const operations = await signIn((await createStaff('operations')).email)
    for (const [label, client] of [['editor', editor], ['operations', operations]] as const) {
      const product = await makeProduct()
      const variant = await makeVariant(product, { fulfillment: 'digital', price: 1500 })
      const rate = await makeRate(2500)
      const coupon = await makeCoupon({ kind: 'percent', percentBp: 1000 })
      const slug = unique('no').toLowerCase().replace(/[^a-z0-9-]/g, '')
      const sku = unique('NO').toUpperCase().replace(/[^A-Z0-9-]/g, '')
      const city = unique('nocity').toLowerCase().replace(/[^a-z0-9-]/g, '')
      const code = unique('NOCODE').toUpperCase().replace(/[^A-Z0-9]/g, '')
      expect((await client.from('products').insert({ slug, title: 'ممنوع' })).error?.code, `${label} product insert`).toBe('42501')
      expect((await client.from('product_variants').insert({ product_id: product, sku, title: 'ممنوع', fulfillment: 'digital', price_halalas: 100 })).error?.code, `${label} variant insert`).toBe('42501')
      expect((await client.from('shipping_rates').insert({ city_key: city, name_ar: 'ممنوع', fee_halalas: 100 })).error?.code, `${label} rate insert`).toBe('42501')
      expect((await client.from('coupons').insert({ code, kind: 'percent', percent_bp: 1000 })).error?.code, `${label} coupon insert`).toBe('42501')
      // An update the role cannot see changes nothing: the owner-only USING
      // clause filters every row out, so no error and no affected row.
      const productUpdate = await client.from('products').update({ title: 'ممنوع' }).eq('id', product).select('id')
      expect(productUpdate.error, `${label} product update`).toBeNull()
      expect(productUpdate.data, `${label} product update`).toEqual([])
      const variantUpdate = await client.from('product_variants').update({ price_halalas: 100 }).eq('id', variant).select('id')
      expect(variantUpdate.error, `${label} variant update`).toBeNull()
      expect(variantUpdate.data, `${label} variant update`).toEqual([])
      const rateUpdate = await client.from('shipping_rates').update({ fee_halalas: 100 }).eq('city_key', rate).select('city_key')
      expect(rateUpdate.data, `${label} rate update`).toEqual([])
      const couponUpdate = await client.from('coupons').update({ enabled: true }).eq('id', coupon.id).select('id')
      expect(couponUpdate.data, `${label} coupon update`).toEqual([])
      const kept = (await postgres.query('select price_halalas from public.product_variants where id = $1', [variant])).rows[0]!
      expect(kept.price_halalas, `${label} variant untouched`).toBe(1500)
    }
  })

  it('an owner inserts and updates catalog rows; a stale version changes 0 rows; demo and version are not updatable', async () => {
    const owner = await signIn((await createStaff('owner')).email)
    const slug = unique('own').toLowerCase().replace(/[^a-z0-9-]/g, '')
    const sku = unique('OWN').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    const inserted = await owner.from('products').insert({ slug, title: 'منتج المالك', summary: '', status: 'published' }).select('id')
    expect(inserted.error).toBeNull()
    const productId = inserted.data![0]!.id
    created.products.push(productId)
    const variant = await owner
      .from('product_variants')
      .insert({ product_id: productId, sku, title: 'خيار', fulfillment: 'physical', price_halalas: 5000, stock: 10 })
      .select('id, version')
    expect(variant.error).toBeNull()
    const variantId = variant.data![0]!.id
    const version = variant.data![0]!.version

    const updated = await owner.from('product_variants').update({ price_halalas: 5500 }).eq('id', variantId).eq('version', version).select('version')
    expect(updated.data).toHaveLength(1)
    expect(updated.data![0]!.version).toBe(version + 1)

    const stale = await owner.from('product_variants').update({ price_halalas: 6000 }).eq('id', variantId).eq('version', version).select('id')
    expect(stale.data).toHaveLength(0)

    expect((await owner.from('products').update({ demo: true }).eq('id', productId)).error?.code).toBe('42501')
    expect((await owner.from('products').update({ version: 99 }).eq('id', productId)).error?.code).toBe('42501')
    expect((await owner.from('product_variants').update({ version: 99 }).eq('id', variantId)).error?.code).toBe('42501')
  })
})

// --- quote -------------------------------------------------------------------

/** The largest-remainder allocation the SQL must produce, computed independently. */
function expectedAllocation(subtotals: number[], discount: number): number[] {
  const eligible = subtotals.reduce((a, b) => a + b, 0)
  const bases = subtotals.map((sub) => Math.floor((discount * sub) / eligible))
  const remainder = discount - bases.reduce((a, b) => a + b, 0)
  const order = subtotals.map((_, i) => i).sort((a, b) => ((discount * subtotals[b]!) % eligible) - ((discount * subtotals[a]!) % eligible) || a - b)
  const result = [...bases]
  for (let i = 0; i < remainder; i += 1) result[order[i]!]! += 1
  return result
}

describe('checkout_quote', () => {
  it('prices a percent and a fixed coupon: totals and per-line discounts', async () => {
    const product = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'physical', price: 10_000, stock: 10 })
    const city = await makeRate(2500)
    const percent = await makeCoupon({ kind: 'percent', percentBp: 1000 })
    const priced = (await quote(pool[0]!, [{ variantId: variant, quantity: 2 }], city, percent.code)) as any
    expect(priced.ok).toBe(true)
    expect(priced.subtotal).toBe(20_000)
    expect(priced.discount).toBe(2_000)
    expect(priced.shipping).toBe(2500)
    expect(priced.total).toBe(20_500)
    expect(priced.lines[0].discount).toBe(2_000)
    expect(priced.coupon).toMatchObject({ code: percent.code, kind: 'percent', discount: 2_000 })

    const fixed = await makeCoupon({ kind: 'fixed', amount: 1_500 })
    const fixedPriced = (await quote(pool[0]!, [{ variantId: variant, quantity: 2 }], city, fixed.code)) as any
    expect(fixedPriced.discount).toBe(1_500)
    expect(fixedPriced.total).toBe(20_000 + 2_500 - 1_500)
    expect(fixedPriced.lines[0].discount).toBe(1_500)
  })

  it('allocates the discount by largest remainder: the lines sum to the order, extras go to the largest remainders, ties by line order', async () => {
    const product = await makeProduct()
    // Three odd subtotals: 1001 + 1002 + 1003, a 10% coupon discounts 300.
    const odd = await makeCoupon({ kind: 'percent', percentBp: 1000 })
    const lines: Line[] = []
    const subtotals = [1001, 1002, 1003]
    for (const subtotal of subtotals) {
      lines.push({ variantId: await makeVariant(product, { fulfillment: 'digital', price: subtotal }), quantity: 1 })
    }
    const priced = (await quote(pool[0]!, lines, null, odd.code)) as any
    expect(priced.discount).toBe(300)
    expect(priced.lines.map((line: any) => line.discount)).toEqual(expectedAllocation(subtotals, 300))
    expect(priced.lines.reduce((sum: number, line: any) => sum + line.discount, 0)).toBe(priced.discount)

    // A tie: two equal subtotals, an odd discount — the earlier line gets the extra halala.
    const tie = await makeCoupon({ kind: 'percent', percentBp: 1050 })
    const tieProduct = await makeProduct()
    const tieLines = [
      { variantId: await makeVariant(tieProduct, { fulfillment: 'digital', price: 101 }), quantity: 1 },
      { variantId: await makeVariant(tieProduct, { fulfillment: 'digital', price: 101 }), quantity: 1 },
    ]
    const tiePriced = (await quote(pool[0]!, tieLines, null, tie.code)) as any
    expect(tiePriced.discount).toBe(21)
    expect(tiePriced.lines.map((line: any) => line.discount)).toEqual([11, 10])
  })

  it('enforces coupon windows, minimums and product scope', async () => {
    const product = await makeProduct()
    const other = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'digital', price: 10_000 })
    const lines = [{ variantId: variant, quantity: 1 }]

    const future = await makeCoupon({ kind: 'percent', percentBp: 1000, startsAt: new Date(Date.now() + 86_400_000).toISOString() })
    expect(((await quote(pool[0]!, lines, null, future.code)) as any).errors).toContainEqual(expect.objectContaining({ code: 'COUPON_INVALID' }))

    const past = await makeCoupon({ kind: 'percent', percentBp: 1000, endsAt: new Date(Date.now() - 86_400_000).toISOString() })
    expect(((await quote(pool[0]!, lines, null, past.code)) as any).errors).toContainEqual(expect.objectContaining({ code: 'COUPON_INVALID' }))

    const minimum = await makeCoupon({ kind: 'percent', percentBp: 1000, minSubtotal: 20_000 })
    expect(((await quote(pool[0]!, lines, null, minimum.code)) as any).errors).toContainEqual(
      expect.objectContaining({ code: 'COUPON_MIN_SUBTOTAL', minimum: 20_000 }),
    )

    const scoped = await makeCoupon({ kind: 'percent', percentBp: 1000, productIds: [other] })
    expect(((await quote(pool[0]!, lines, null, scoped.code)) as any).errors).toContainEqual(
      expect.objectContaining({ code: 'COUPON_NOT_APPLICABLE' }),
    )
  })

  it('delivery: a digital-only cart needs no city; a physical cart needs a served one', async () => {
    const digital = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const digitalOnly = (await quote(pool[0]!, [{ variantId: digital, quantity: 1 }], null)) as any
    expect(digitalOnly.ok).toBe(true)
    expect(digitalOnly.physical).toBe(false)
    expect(digitalOnly.city).toBeNull()
    expect(digitalOnly.shipping).toBe(0)

    const physical = await makeVariant(await makeProduct(), { fulfillment: 'physical', price: 6900, stock: 5 })
    expect(((await quote(pool[0]!, [{ variantId: physical, quantity: 1 }], null)) as any).errors).toContainEqual(
      expect.objectContaining({ code: 'CITY_REQUIRED' }),
    )
    const off = await makeRate(2500, false)
    const unpriced = await makeRate(null)
    for (const city of [off, unpriced]) {
      expect(((await quote(pool[0]!, [{ variantId: physical, quantity: 1 }], city)) as any).errors).toContainEqual(
        expect.objectContaining({ code: 'CITY_UNSUPPORTED' }),
      )
    }
  })

  it('refuses an unpublished product, a disabled variant and an unpriced variant as UNAVAILABLE', async () => {
    const draft = await makeVariant(await makeProduct('draft'), { fulfillment: 'digital', price: 1500 })
    const disabled = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500, enabled: false })
    const unpriced = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 3500 })
    await postgres.query('update public.product_variants set price_halalas = null where id = $1', [unpriced])
    for (const variantId of [draft, disabled, unpriced]) {
      const priced = (await quote(pool[0]!, [{ variantId, quantity: 1 }], null)) as any
      expect(priced.errors).toContainEqual(expect.objectContaining({ code: 'UNAVAILABLE' }))
    }
  })

  it('a dedication is for a signed line only', async () => {
    const product = await makeProduct()
    const signed = await makeVariant(product, { fulfillment: 'signed', price: 9900, stock: 3 })
    const physical = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 3 })
    const city = await makeRate(2500)
    const signedQuote = (await quote(pool[0]!, [{ variantId: signed, quantity: 1, dedication: 'إهداء تجريبي' }], city)) as any
    expect(signedQuote.ok).toBe(true)
    expect(signedQuote.lines[0].dedication).toBe('إهداء تجريبي')
    const physicalQuote = (await quote(pool[0]!, [{ variantId: physical, quantity: 1, dedication: 'إهداء' }], city)) as any
    expect(physicalQuote.errors).toContainEqual(expect.objectContaining({ code: 'DEDICATION_NOT_ALLOWED' }))
  })
})

// --- create: refusals, in the settings' own order ----------------------------

describe('checkout_create refusals', () => {
  it('CHECKOUT_DISABLED while checkout is off', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const answer = await createOrder(pool[0]!, { lines: [{ variantId: variant, quantity: 1 }] })
    expect(answer.result).toMatchObject({ ok: false, code: 'CHECKOUT_DISABLED' })
  })

  it('SELLER_NOT_CONFIGURED once checkout is on but the seller is not named', async () => {
    await postgres.query('update finance.commerce_settings set checkout_enabled = true where id = 1')
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const answer = await createOrder(pool[0]!, { lines: [{ variantId: variant, quantity: 1 }] })
    expect(answer.result).toMatchObject({ ok: false, code: 'SELLER_NOT_CONFIGURED' })
  })

  it('POLICIES_NOT_CONFIGURED with no approved revisions, POLICY_CHANGED with the wrong ones', async () => {
    await postgres.query(
      `update finance.commerce_settings set seller_legal_name = 'بائع', seller_address = 'تبوك', seller_registration = 'REG-1' where id = 1`,
    )
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const unconfigured = await createOrder(pool[0]!, { lines: [{ variantId: variant, quantity: 1 }] })
    expect(unconfigured.result).toMatchObject({ ok: false, code: 'POLICIES_NOT_CONFIGURED' })

    await postgres.query(`update finance.commerce_settings set policy_revisions = '{"store": 7, "delivery": 8, "refund": 9}'::jsonb where id = 1`)
    const changed = await createOrder(pool[0]!, { lines: [{ variantId: variant, quantity: 1 }] })
    expect(changed.result).toMatchObject({ ok: false, code: 'POLICY_CHANGED', policyRevisions: { store: 7, delivery: 8, refund: 9 } })
  })

  it('INVALID_CONTACT for an address the database itself refuses', async () => {
    await postgres.query(`update finance.commerce_settings set policy_revisions = $1::jsonb where id = 1`, [JSON.stringify(REV)])
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const answer = await createOrder(pool[0]!, { lines: [{ variantId: variant, quantity: 1 }], email: 'not-an-email' })
    expect(answer.result).toMatchObject({ ok: false, code: 'INVALID_CONTACT' })
  })

  it('ADDRESS_REQUIRED and PHONE_REQUIRED for a physical cart', async () => {
    const product = await makeProduct()
    const physical = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 5 })
    const city = await makeRate(2500)
    const noAddress = await createOrder(pool[0]!, { lines: [{ variantId: physical, quantity: 1 }], cityKey: city, address: null })
    expect(noAddress.result).toMatchObject({ ok: false, code: 'ADDRESS_REQUIRED' })
    const noPhone = await createOrder(pool[0]!, { lines: [{ variantId: physical, quantity: 1 }], cityKey: city, phone: null })
    expect(noPhone.result).toMatchObject({ ok: false, code: 'PHONE_REQUIRED' })
  })

  it('QUOTE_CHANGED after a price change, carrying the new quote', async () => {
    const product = await makeProduct()
    const physical = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 5 })
    const city = await makeRate(2500)
    const stale = (await quote(pool[0]!, [{ variantId: physical, quantity: 1 }], city)) as any
    await postgres.query('update public.product_variants set price_halalas = 7000 where id = $1', [physical])
    const answer = await createOrder(pool[0]!, { lines: [{ variantId: physical, quantity: 1 }], cityKey: city, quoteHash: stale.quoteHash })
    expect(answer.result).toMatchObject({ ok: false, code: 'QUOTE_CHANGED' })
    expect(answer.result.quote.total).toBe(7000 + 2500)
    expect(answer.result.quote.quoteHash).not.toBe(stale.quoteHash)
  })
})

// --- the price function's own guards ------------------------------------------

describe('checkout_price refusals (AUDIT-2)', () => {
  it('refuses malformed and oversized carts with their own codes, in quote and in create', async () => {
    const product = await makeProduct()
    const digital = await makeVariant(product, { fulfillment: 'digital', price: 1500 })
    const signed = await makeVariant(product, { fulfillment: 'signed', price: 9900, stock: 5 })
    const city = await makeRate(2500)
    const errorCodes = async (lines: unknown): Promise<string[]> =>
      (((await quote(pool[0]!, lines as Line[], city)) as any).errors as Array<{ code: string }>).map((error) => error.code)

    expect(await errorCodes({})).toEqual(['INVALID_CART'])
    expect(await errorCodes([])).toEqual(['EMPTY_CART'])
    // 51 lines: refused before any line is read, so the ids need not exist.
    expect(await errorCodes(Array.from({ length: 51 }, () => ({ variantId: randomUUID(), quantity: 1 })))).toEqual(['TOO_MANY_LINES'])
    expect(await errorCodes([{ variantId: digital, quantity: 1 }, { variantId: digital, quantity: 2 }])).toEqual(['DUPLICATE_LINE'])
    // A quantity that is a number of one or two digits, from 1 to 20; anything else is refused.
    expect(await errorCodes([{ variantId: digital, quantity: 0 }])).toEqual(['INVALID_QUANTITY'])
    expect(await errorCodes([{ variantId: digital, quantity: 21 }])).toEqual(['INVALID_QUANTITY'])
    for (const quantity of ['5', 1.5, -1, 100]) {
      expect(await errorCodes([{ variantId: digital, quantity }]), String(quantity)).toEqual(['INVALID_LINE'])
    }
    expect(await errorCodes([{ variantId: 'not-a-uuid', quantity: 1 }])).toEqual(['INVALID_LINE'])
    expect(await errorCodes([{ variantId: signed, quantity: 1, dedication: 5 }])).toEqual(['INVALID_LINE'])
    expect(await errorCodes([{ variantId: signed, quantity: 1, dedication: 'ه'.repeat(201) }])).toEqual(['INVALID_DEDICATION'])
    expect(await errorCodes([{ variantId: signed, quantity: 1, dedication: 'ه'.repeat(200) }])).toEqual([])

    // Six of a 100,000 SAR item: past the 500,000 SAR ceiling that keeps the
    // subtotal inside an integer. Create refuses it with the same code, it does not raise.
    const pricey = await makeVariant(product, { fulfillment: 'digital', price: 10_000_000 })
    const lines = [{ variantId: pricey, quantity: 6 }]
    expect(await errorCodes(lines)).toEqual(['CART_TOO_LARGE'])
    const created = await createOrder(pool[0]!, { lines })
    expect(created.code).toBeUndefined()
    expect(created.result).toMatchObject({ ok: false, code: 'CART_TOO_LARGE' })
    // Exactly at the ceiling is fine.
    expect(await errorCodes([{ variantId: pricey, quantity: 5 }])).toEqual([])
  })
})

// --- create: the order itself -------------------------------------------------

describe('checkout_create success', () => {
  const heldEmail = uniqueEmail('held')
  let order: any
  let coupon: { id: string; code: string }
  let cityKey: string
  let signed: string
  let digital: string
  let physical: string
  let idempotencyKey: string

  it('creates the order with its snapshots, its holds and one audit row', async () => {
    const product = await makeProduct()
    digital = await makeVariant(product, { fulfillment: 'digital', price: 3500 })
    physical = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 40 })
    signed = await makeVariant(product, { fulfillment: 'signed', price: 9900, stock: 10 })
    cityKey = await makeRate(2500)
    coupon = await makeCoupon({ kind: 'percent', percentBp: 1000, usageLimit: 1 })
    idempotencyKey = randomUUID()
    const lines = [
      { variantId: digital, quantity: 1 },
      { variantId: physical, quantity: 2 },
      { variantId: signed, quantity: 1, dedication: 'إهداء' },
    ]
    const answer = await createOrder(pool[0]!, {
      lines,
      cityKey,
      couponCode: coupon.code,
      email: heldEmail,
      idempotencyKey,
    })
    expect(answer.code).toBeUndefined()
    order = answer.result.order
    expect(order.status).toBe('pending_payment')

    const row = (
      await postgres.query<any>('select * from finance.orders where id = $1', [order.id])
    ).rows[0]!
    const subtotal = 3500 + 6900 * 2 + 9900
    const discount = Math.floor(subtotal / 10)
    expect(row.subtotal_halalas).toBe(subtotal)
    expect(row.discount_halalas).toBe(discount)
    expect(row.shipping_halalas).toBe(2500)
    expect(row.total_halalas).toBe(subtotal - discount + 2500)
    expect(row.seller).toEqual({ legalName: 'بائع', address: 'تبوك', registration: 'REG-1' })
    expect(row.policy_revisions).toEqual(REV)
    expect(row.customer_email).toBe(heldEmail)
    expect(row.customer_name).toBe('مشترٍ')
    expect(row.customer_phone).toBe('966501234567')
    expect(row.city_key).toBe(cityKey)
    expect(row.city_name_ar).toContain(cityKey)
    expect(row.address).toBe('تبوك شارع الرئيسي')
    expect(row.coupon_code).toBe(coupon.code)
    expect(row.environment).toBe('test')
    expect(row.hold_expires_at.getTime() - Date.now()).toBeGreaterThan(19 * 60_000)

    const items = (await postgres.query<any>('select * from finance.order_items where order_id = $1 order by line_no', [order.id])).rows
    expect(items.map((item) => item.sku)).toHaveLength(3)
    expect(items.reduce((sum: number, item: any) => sum + item.discount_halalas, 0)).toBe(discount)
    expect(items.find((item: any) => item.variant_id === signed).dedication).toBe('إهداء')

    const holds = (await postgres.query<any>('select * from finance.inventory_reservations where order_id = $1', [order.id])).rows
    expect(holds.map((hold) => hold.variant_id).sort()).toEqual([physical, signed].sort())
    expect(holds.every((hold) => hold.state === 'held' && hold.expires_at > new Date())).toBe(true)
    expect((await postgres.query('select 1 from finance.inventory_reservations where order_id = $1 and variant_id = $2', [order.id, digital])).rowCount).toBe(0)

    const redemption = (await postgres.query<any>('select * from finance.coupon_redemptions where order_id = $1', [order.id])).rows[0]!
    expect(redemption.coupon_id).toBe(coupon.id)
    expect(redemption.state).toBe('held')

    const audit = (
      await postgres.query<any>("select count(*)::int as n from public.audit_events where action = 'order.created' and entity_id = $1", [order.id])
    ).rows[0]!
    expect(audit.n).toBe(1)
  })

  it('the held coupon redemption exhausts a limit of one', async () => {
    const priced = (await quote(pool[0]!, [{ variantId: digital, quantity: 1 }], null, coupon.code)) as any
    expect(priced.errors).toContainEqual(expect.objectContaining({ code: 'COUPON_EXHAUSTED' }))
  })

  it('no API role can write the holds, redemptions or order totals: finance is not exposed and grants nothing', async () => {
    // Availability and coupon use are counted from these rows, not from
    // counter columns, so they are what a buyer or staff member must not touch.
    // The Data API serves only the public schema (supabase/config.toml).
    const owner = await signIn((await createStaff('owner')).email)
    const release = await owner.schema('finance').from('inventory_reservations').update({ state: 'released' }).eq('order_id', order.id)
    expect(release.error?.code).toBe('PGRST106')
    const total = await owner.schema('finance').from('orders').update({ total_halalas: 1 }).eq('id', order.id)
    expect(total.error?.code).toBe('PGRST106')
    // Exposing the schema later would still grant nothing on these tables.
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['finance.orders', 'finance.order_items', 'finance.inventory_reservations', 'finance.coupon_redemptions']) {
        for (const privilege of ['select', 'insert', 'update', 'delete']) {
          const held = await postgres.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, table, privilege])
          expect(held.rows[0]!.ok, `${role} ${privilege} on ${table}`).toBe(false)
        }
      }
    }
    const holds = (await postgres.query<{ state: string }>('select state from finance.inventory_reservations where order_id = $1', [order.id])).rows
    expect(holds.map((hold) => hold.state)).toEqual(['held', 'held'])
    const row = (await postgres.query<{ total_halalas: number }>('select total_halalas from finance.orders where id = $1', [order.id])).rows[0]!
    expect(row.total_halalas).toBe(order.total)
  })

  it('the same key and request return the same order with tokenMatches; another request is IDEMPOTENCY_CONFLICT', async () => {
    const repeat = await createOrder(pool[0]!, {
      lines: [
        { variantId: digital, quantity: 1 },
        { variantId: physical, quantity: 2 },
        { variantId: signed, quantity: 1, dedication: 'إهداء' },
      ],
      cityKey,
      couponCode: coupon.code,
      email: heldEmail,
      idempotencyKey,
    })
    expect(repeat.result.duplicate).toBe(true)
    expect(repeat.result.tokenMatches).toBe(true)
    expect(repeat.result.order.orderNumber).toBe(order.orderNumber)

    const conflict = await createOrder(pool[0]!, {
      lines: [{ variantId: digital, quantity: 1 }],
      email: heldEmail,
      idempotencyKey,
      requestHash: createHash('sha256').update(`another:${idempotencyKey}`).digest('hex'),
    })
    expect(conflict.result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
  })
})

// --- hold limits ---------------------------------------------------------------

describe('hold limits (DATA "Unpaid reservation abuse")', () => {
  let digital: string
  let cityKey: string

  beforeAll(async () => {
    digital = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    cityKey = await makeRate(2500)
  })

  it('a second order for the same email, or for the same session with another email, is ACTIVE_HOLD', async () => {
    const email = uniqueEmail('hold')
    const session = randomUUID()
    const first = await createOrder(pool[0]!, { lines: [{ variantId: digital, quantity: 1 }], email, checkoutSession: session })
    expect(first.result.ok).toBe(true)

    const sameEmail = await createOrder(pool[0]!, { lines: [{ variantId: digital, quantity: 1 }], email })
    expect(sameEmail.result).toMatchObject({ ok: false, code: 'ACTIVE_HOLD' })

    const sameSession = await createOrder(pool[0]!, { lines: [{ variantId: digital, quantity: 1 }], checkoutSession: session })
    expect(sameSession.result).toMatchObject({ ok: false, code: 'ACTIVE_HOLD' })
  })

  it('a cancel with the right token releases the holds and a new order is accepted; a wrong token is NOT_FOUND', async () => {
    const email = uniqueEmail('cancel')
    const key = randomUUID()
    const created = await createOrder(pool[0]!, {
      lines: [{ variantId: digital, quantity: 1 }],
      email,
      idempotencyKey: key,
    })
    const orderNumber = created.result.order.orderNumber
    // A different buyer holds the last physical unit.
    const physical = await makeVariant(await makeProduct(), { fulfillment: 'physical', price: 1000, stock: 1 })
    const withStockKey = randomUUID()
    const withStock = await createOrder(pool[0]!, {
      lines: [{ variantId: physical, quantity: 1 }],
      cityKey,
      email: uniqueEmail('cancel-stock'),
      idempotencyKey: withStockKey,
    })
    expect(withStock.result.ok).toBe(true)

    const wrong = await rpc(pool[0]!)('checkout_cancel', { p_order_number: orderNumber, p_access_token_hash: '0'.repeat(64) })
    expect(wrong).toMatchObject({ ok: false, code: 'NOT_FOUND' })

    const cancelled = await rpc(pool[0]!)('checkout_cancel', {
      p_order_number: orderNumber,
      p_access_token_hash: hashFor(tokenFor(key)),
    })
    expect(cancelled).toMatchObject({ ok: true, status: 'cancelled' })
    const cancelledStock = await rpc(pool[0]!)('checkout_cancel', {
      p_order_number: withStock.result.order.orderNumber,
      p_access_token_hash: hashFor(tokenFor(withStockKey)),
    })
    expect(cancelledStock).toMatchObject({ ok: true, status: 'cancelled' })

    const released = (
      await postgres.query<any>("select state from finance.inventory_reservations where order_id = $1", [withStock.result.order.id])
    ).rows
    expect(released.every((row) => row.state === 'released')).toBe(true)

    const again = await createOrder(pool[0]!, { lines: [{ variantId: physical, quantity: 1 }], cityKey, email })
    expect(again.result.ok).toBe(true)
  })

  it('a cancel with the right token after the token expired is NOT_FOUND and leaves the order held (AUDIT-2)', async () => {
    const key = randomUUID()
    const created = await createOrder(pool[0]!, { lines: [{ variantId: digital, quantity: 1 }], idempotencyKey: key })
    expect(created.result.ok).toBe(true)
    await postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 minute' where id = $1", [
      created.result.order.id,
    ])
    const answer = await rpc(pool[0]!)('checkout_cancel', {
      p_order_number: created.result.order.orderNumber,
      p_access_token_hash: hashFor(tokenFor(key)),
    })
    expect(answer).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    const order = (await postgres.query<{ status: string }>('select status from finance.orders where id = $1', [created.result.order.id]))
      .rows[0]!
    expect(order.status).toBe('pending_payment')
  })
})

// --- throttle ------------------------------------------------------------------

describe('the checkout throttle', () => {
  it('the 11th create in an hour from one IP hash raises 54000', async () => {
    const digital = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const priced = (await quote(pool[0]!, [{ variantId: digital, quantity: 1 }], null)) as any
    const hash = ipHash()
    const args = (email: string) => ({
      p_idempotency_key: randomUUID(),
      p_request_hash: createHash('sha256').update(randomUUID()).digest('hex'),
      p_checkout_session: randomUUID(),
      p_ip_hash: hash,
      p_email: email,
      p_name: 'مشترٍ',
      p_phone: null,
      p_lines: [{ variantId: digital, quantity: 1 }],
      p_city_key: null,
      p_address: null,
      p_coupon_code: null,
      p_policy_revisions: REV,
      p_quote_hash: priced.quoteHash,
      p_access_token_hash: '0'.repeat(64),
      p_environment: 'test',
    })
    for (let i = 0; i < 10; i += 1) {
      const direct = (await rpc(pool[0]!)('checkout_create', args(uniqueEmail('throttle')))) as { ok: boolean }
      expect(direct.ok).toBe(true)
    }
    await expect(rpc(pool[0]!)('checkout_create', args(uniqueEmail('throttle')))).rejects.toMatchObject({ code: '54000' })
  })
})

// --- concurrency ----------------------------------------------------------------

describe('concurrency (separate connections)', () => {
  it('five creates for the last unit of a stock-1 variant: exactly one succeeds', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'physical', price: 6900, stock: 1 })
    const city = await makeRate(2500)
    const answers = await Promise.all(
      pool.slice(0, 5).map((client) =>
        createOrder(client, { lines: [{ variantId: variant, quantity: 1 }], cityKey: city, email: uniqueEmail('race') }),
      ),
    )
    const ok = answers.filter((answer) => answer.result?.ok === true)
    const refused = answers.filter((answer) => answer.result?.code === 'OUT_OF_STOCK')
    expect(ok).toHaveLength(1)
    expect(refused).toHaveLength(4)
  })

  it('two creates for a coupon limited to one use: exactly one keeps it', async () => {
    const product = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'digital', price: 10_000 })
    const coupon = await makeCoupon({ kind: 'percent', percentBp: 1000, usageLimit: 1 })
    const answers = await Promise.all(
      pool.slice(0, 2).map((client) =>
        createOrder(client, { lines: [{ variantId: variant, quantity: 1 }], couponCode: coupon.code, email: uniqueEmail('coupon-race') }),
      ),
    )
    const ok = answers.filter((answer) => answer.result?.ok === true)
    expect(ok).toHaveLength(1)
    for (const answer of answers.filter((a) => a.result?.ok !== true)) {
      expect(['COUPON_EXHAUSTED', 'QUOTE_CHANGED']).toContain(answer.result?.code)
    }
  })

  it('two concurrent creates with one idempotency key: one order, both answers name it', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    const key = randomUUID()
    const requestHash = createHash('sha256').update(randomUUID()).digest('hex')
    const email = uniqueEmail('same-key')
    const args = {
      p_idempotency_key: key,
      p_request_hash: requestHash,
      p_checkout_session: randomUUID(),
      p_ip_hash: ipHash(),
      p_email: email,
      p_name: 'مشترٍ',
      p_phone: null,
      p_lines: [{ variantId: variant, quantity: 1 }],
      p_city_key: null,
      p_address: null,
      p_coupon_code: null,
      p_policy_revisions: REV,
      p_quote_hash: ((await quote(pool[0]!, [{ variantId: variant, quantity: 1 }], null)) as any).quoteHash,
      p_access_token_hash: hashFor(tokenFor(key)),
      p_environment: 'test',
    }
    const [first, second] = (await Promise.all([
      rpc(pool[0]!)('checkout_create', args),
      rpc(pool[1]!)('checkout_create', args),
    ])) as Array<{ ok: boolean; order: { orderNumber: string } }>
    expect(first!.ok).toBe(true)
    expect(second!.ok).toBe(true)
    expect(first!.order.orderNumber).toBe(second!.order.orderNumber)
    const orders = (await postgres.query('select * from finance.orders where idempotency_key = $1', [key])).rows
    expect(orders).toHaveLength(1)
  })
})

// --- expiry ----------------------------------------------------------------------

describe('expiry', () => {
  it('an expired hold stops counting before any job runs, and checkout_expire tidies up; the cron job exists', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'physical', price: 6900, stock: 1 })
    const city = await makeRate(2500)
    const coupon = await makeCoupon({ kind: 'percent', percentBp: 1000, usageLimit: 1 })
    const created = await createOrder(pool[0]!, {
      lines: [{ variantId: variant, quantity: 1 }],
      cityKey: city,
      couponCode: coupon.code,
    })
    expect(created.result.ok).toBe(true)
    const orderId = created.result.order.id

    const blocked = (await quote(pool[0]!, [{ variantId: variant, quantity: 1 }], city)) as any
    expect(blocked.errors).toContainEqual(expect.objectContaining({ code: 'OUT_OF_STOCK', available: 0 }))

    await postgres.query("update finance.orders set hold_expires_at = now() - interval '2 minutes' where id = $1", [orderId])
    await postgres.query("update finance.inventory_reservations set expires_at = now() - interval '2 minutes' where order_id = $1", [orderId])
    await postgres.query("update finance.coupon_redemptions set expires_at = now() - interval '2 minutes' where order_id = $1", [orderId])

    const visibleAgain = (await quote(pool[0]!, [{ variantId: variant, quantity: 1 }], city)) as any
    expect(visibleAgain.ok).toBe(true)
    // Stock stays private: a line never carries it.
    expect(visibleAgain.lines[0]).not.toHaveProperty('available')

    await postgres.query('select finance.checkout_expire()')
    const order = (await postgres.query<{ status: string }>('select status from finance.orders where id = $1', [orderId])).rows[0]!
    expect(order.status).toBe('expired')
    const reservations = (await postgres.query<{ state: string }>('select state from finance.inventory_reservations where order_id = $1', [orderId])).rows
    expect(reservations.every((row) => row.state === 'released')).toBe(true)
    const redemptions = (await postgres.query<{ state: string }>('select state from finance.coupon_redemptions where order_id = $1', [orderId])).rows
    expect(redemptions.every((row) => row.state === 'released')).toBe(true)
    // The release is tied to its order in the audit trail (S05.3).
    const audit = await postgres.query<{ summary: { orderNumber: string } }>(
      "select summary from public.audit_events where action = 'order.expired' and entity_id = $1",
      [orderId],
    )
    expect(audit.rows.map((row) => row.summary.orderNumber)).toEqual([created.result.order.orderNumber])

    const job = await postgres.query("select 1 from cron.job where jobname = 'checkout-expire'")
    expect(job.rowCount).toBe(1)
  })
})

// --- rebuilds and audit ------------------------------------------------------------

describe('rebuilds and audit', () => {
  it('a price change requests a site build; a stock-only change does not', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'physical', price: 6900, stock: 10 })
    await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
    const before = (await postgres.query<{ requested_at: Date }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at

    await postgres.query('update public.product_variants set price_halalas = 7000 where id = $1', [variant])
    const afterPrice = (await postgres.query<{ requested_at: Date }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at
    expect(afterPrice.getTime()).toBeGreaterThan(before.getTime())

    await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
    const parked = (await postgres.query<{ requested_at: Date }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at
    await postgres.query('update public.product_variants set stock = 9 where id = $1', [variant])
    const afterStock = (await postgres.query<{ requested_at: Date }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at
    expect(afterStock.getTime()).toBe(parked.getTime())
  })

  // The admin's variant form sends every public column with each save, changed or
  // not, and a save can match no row (AUDIT-2): none of those starts a Pages build.
  it('a variant save that changes no public column, or matches no row, requests no site build; a new variant does', async () => {
    const product = await makeProduct()
    const variant = await makeVariant(product, { fulfillment: 'physical', price: 6900, stock: 10 })
    const requestedAt = async () =>
      (await postgres.query<{ requested_at: Date }>('select requested_at from finance.site_builds where id = 1')).rows[0]!.requested_at
    const park = async () => {
      await postgres.query("update finance.site_builds set requested_at = now() - interval '10 minutes' where id = 1")
      return (await requestedAt()).getTime()
    }

    const parked = await park()
    await postgres.query(
      `update public.product_variants
          set sku = sku, title = title, fulfillment = fulfillment, price_halalas = price_halalas,
              enabled = enabled, sort_order = sort_order, stock = 4
        where id = $1`,
      [variant],
    )
    expect((await requestedAt()).getTime()).toBe(parked)

    await postgres.query('update public.product_variants set price_halalas = 1 where id = $1', [randomUUID()])
    expect((await requestedAt()).getTime()).toBe(parked)

    await postgres.query('update public.product_variants set enabled = false where id = $1', [variant])
    expect((await requestedAt()).getTime()).toBeGreaterThan(parked)

    const parkedAgain = await park()
    await makeVariant(product, { fulfillment: 'digital', price: 1500 })
    expect((await requestedAt()).getTime()).toBeGreaterThan(parkedAgain)
  })

  it('a price change is audited with from and to; a customer name change by column name only', async () => {
    const variant = await makeVariant(await makeProduct(), { fulfillment: 'digital', price: 1500 })
    await postgres.query('update public.product_variants set price_halalas = 1600 where id = $1', [variant])
    const priceAudit = (
      await postgres.query<{ summary: any }>(
        "select summary from public.audit_events where entity = 'product_variants' and entity_id = $1 order by id desc limit 1",
        [variant],
      )
    ).rows[0]!
    expect(priceAudit.summary.changes.price_halalas).toEqual({ from: 1500, to: 1600 })

    const email = uniqueEmail('customer')
    const customer = (
      await postgres.query<{ id: string }>("insert into public.customers (email, name) values ($1, 'الاسم الأول') returning id", [email])
    ).rows[0]!
    await postgres.query("update public.customers set name = 'الاسم الثاني' where id = $1", [customer.id])
    const nameAudit = (
      await postgres.query<{ summary: any }>(
        "select summary from public.audit_events where entity = 'customers' and entity_id = $1 order by id desc limit 1",
        [customer.id],
      )
    ).rows[0]!
    expect(nameAudit.summary.changes).toEqual({ name: true })
  })
})
