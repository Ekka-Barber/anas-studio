// Shared helpers for `pnpm test:db` integration specs (P03). Reads
// `supabase status -o json` once and refuses anything but a local stack —
// `vitest.config.ts` already gates the whole run on `TEST_ENV=local` and a
// loopback `DATABASE_URL`, this is the same rule applied to the API host.
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { orderAccessToken, orderAccessTokenHash } from '../../supabase/functions/_shared/tokens.ts'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

type Status = {
  API_URL: string
  FUNCTIONS_URL: string
  MAILPIT_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

function readStatus(): Status {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const status = JSON.parse(raw) as Status
  const host = new URL(status.API_URL).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error('Refusing: supabase status API_URL is not a local host.')
  }
  return status
}

export const status = readStatus()

/**
 * The local-only values `pnpm db:env` wrote to `.env.local` (never `.env`).
 * The Edge Functions run on the same values from `supabase/functions/.env`, so
 * a test can sign a webhook, call the jobs endpoint or derive a token the way
 * the running functions do.
 */
export function localEnv(): Record<string, string> {
  return parseEnv(readFileSync('.env.local', 'utf8')) as Record<string, string>
}

export type Role = 'owner' | 'editor' | 'operations'

/** Service-role client: bypasses RLS, used only to set up and inspect fixtures. */
export const serviceClient: SupabaseClient = createClient(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** A fresh client authenticated as no one, using the publishable key. */
export function anonClient(): SupabaseClient {
  return createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

let counter = 0
/** A unique email per run and per call, so tests can share a database. */
export function uniqueEmail(label: string): string {
  counter += 1
  return `${label}-${Date.now()}-${process.pid}-${counter}@example.com`
}

/** Creates a confirmed user and a staff row directly, bypassing the app. */
export async function createStaff(
  role: Role,
  overrides: { active?: boolean; email?: string } = {},
): Promise<{ userId: string; email: string }> {
  const email = overrides.email ?? uniqueEmail(role)
  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (createError || !created.user) throw new Error(`createStaff: ${createError?.message}`)
  const { error: staffError } = await serviceClient
    .from('staff')
    .insert({ user_id: created.user.id, display_name: email, role, active: overrides.active ?? true })
  if (staffError) throw new Error(`createStaff: ${staffError.message}`)
  return { userId: created.user.id, email }
}

/** Signs in as `email` through a real one-time code, as the browser would. */
export async function signIn(email: string): Promise<SupabaseClient> {
  const { data, error } = await serviceClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data) throw new Error(`signIn: could not generate a link for ${email}: ${error?.message}`)
  const token = data.properties.email_otp
  const client = anonClient()
  const { error: verifyError } = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (verifyError) throw new Error(`signIn: verifyOtp failed: ${verifyError.message}`)
  return client
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value === -1) throw new Error(`base32Decode: invalid character ${char}`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP, 30-second step, 6 digits — the same shape an authenticator app computes. */
function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

/** Enrols and verifies a TOTP factor on `client`'s session, reaching aal2. */
export async function stepUp(client: SupabaseClient): Promise<void> {
  const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrollError || !enrolled || enrolled.type !== 'totp') {
    throw new Error(`stepUp: enroll failed: ${enrollError?.message}`)
  }
  const code = totpCode(enrolled.totp.secret)
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code })
  if (verifyError) throw new Error(`stepUp: challengeAndVerify failed: ${verifyError.message}`)
}

export type StaffAdminReply =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } }

/** Calls the `staff-admin` Edge Function as `client`'s current session. */
export async function callStaffAdmin(client: SupabaseClient, body: Record<string, unknown>): Promise<{
  status: number
  reply: StaffAdminReply
}> {
  const { data: sessionData } = await client.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: status.PUBLISHABLE_KEY,
  }
  if (sessionData.session) headers.Authorization = `Bearer ${sessionData.session.access_token}`
  const response = await fetch(`${status.FUNCTIONS_URL}/staff-admin`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const reply = (await response.json()) as StaffAdminReply
  return { status: response.status, reply }
}

/**
 * A direct database session as `service_role` — the role the Edge Functions
 * use for the server-only functions (D32; `app_server` is gone). The session
 * connects as the local superuser and switches role, so every call below is
 * checked against `service_role`'s real grants.
 */
export async function serviceRoleDb(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  await client.connect()
  await client.query('set role service_role')
  return client
}

/** Functions that return a set of rows; everything else returns one value, as PostgREST answers. */
const SET_RETURNING = new Set(['outbox_claim', 'contact_for_notice'])

/**
 * An `Rpc` (what the Edge Functions call) over a direct session: named
 * arguments like the Data API, objects sent as JSON. Test-only; `fn` is
 * always a constant from the code under test.
 */
export function pgRpc(client: Client): Rpc {
  return async (fn, args) => {
    const names = Object.keys(args)
    const values = names.map((name) => {
      const value = args[name]
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    })
    const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(', ')})`
    if (SET_RETURNING.has(fn)) return (await client.query(`select * from ${call}`, values)).rows
    const result = await client.query<{ r: unknown }>(`select ${call} as r`, values)
    return result.rows[0]?.r ?? null
  }
}

// --- P08 round 7: the paid-order fixtures the delivery specs share ---------------------------------------------

export type Row = Record<string, any>
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
/** What `call` settles to within `ms`, or `'blocked'`: a call that is waiting for a lock a test holds. The call itself stays pending. */
export const settledWithin = (call: Promise<unknown>, ms = 1500): Promise<unknown> =>
  Promise.race([call, new Promise<string>((resolve) => setTimeout(resolve, ms, 'blocked'))])

const REVISIONS = { store: 1, delivery: 1, refund: 1 }

export type VariantSpec = { fulfillment: 'digital' | 'physical' | 'signed'; price: number; stock?: number | null; preorder?: { capacity: number } }
export type Line = { variantId: string; quantity: number; dedication?: string }
export type Placed = { id: string; number: string; total: number; key: string; token: string; hash: string; email: string }
export type PaidItem = { id: string; variantId: string; fulfillment: string; paid: number }
export type Paid = Placed & { attemptId: string; invoiceId: string; paymentId: string; items: PaidItem[] }

/**
 * What the specs of `orders-access`, `download` and `orders-http` share, so none of them repeats ~250 lines of
 * fixtures: one superuser session, a pool of `service_role` sessions (the concurrency tests' own connections),
 * staff, products, orders placed through `checkout_create` and paid through `apply_verified_payment` (the objects
 * the Edge function would hand over, built here), and a `stop()` that retires everything the run made. It switches
 * `finance.commerce_settings.checkout_enabled` on, saved here and restored by `stop`. Tokens are derived with
 * `pepper`; the HTTP spec passes the running functions' own.
 */
export async function commerceHarness(pepper: string, poolSize = 6) {
  const postgres = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
  await postgres.connect()
  const pool: Client[] = []
  for (let i = 0; i < poolSize; i += 1) pool.push(await serviceRoleDb())
  const created = { products: [] as string[], rates: [] as string[], orders: [] as string[], staff: [] as string[] }
  let counter = 0
  const unique = (label: string): string => `${label}-${Date.now()}-${process.pid}-${(counter += 1)}`
  const ipHash = (): string => sha256(unique('ip'))
  const call = (fn: string, args: Record<string, unknown>, client: Client = pool[0]!): Promise<any> => pgRpc(client)(fn, args) as Promise<any>
  const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await postgres.query(sql, params)).rows
  const row = async (sql: string, params: unknown[] = []): Promise<Row> => {
    const found = await rows(sql, params)
    if (found.length !== 1) throw new Error(`expected one row, got ${found.length}: ${sql}`)
    return found[0]!
  }
  const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await row(sql, params)).n)

  const settingsSaved = await row(
    'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
  )
  await postgres.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع', seller_address = 'تبوك',
       seller_registration = 'REG-P08', policy_revisions = $1::jsonb where id = 1`,
    [JSON.stringify(REVISIONS)],
  )
  // The global buckets of this machine: the daily order total and the day's `order_link` mails.
  await postgres.query("delete from finance.rate_limits where bucket in ('checkout:all', 'order-link:day')")

  async function makeStaff(role: Role, overrides: { active?: boolean } = {}): Promise<{ userId: string; email: string }> {
    const member = await createStaff(role, overrides)
    created.staff.push(member.userId)
    return member
  }
  async function makeProduct(): Promise<string> {
    const slug = unique('prod').toLowerCase().replace(/[^a-z0-9-]/g, '')
    const id = (await row(`insert into public.products (slug, title, summary, status) values ($1, $2, 'ملخص تجريبي', 'published') returning id`, [slug, `منتج ${slug}`])).id as string
    created.products.push(id)
    return id
  }
  async function makeVariant(spec: VariantSpec): Promise<string> {
    const sku = unique('SKU').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    return (
      await row(
        `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock, preorder, preorder_capacity, preorder_ships_on, preorder_note)
         values ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10) returning id`,
        [
          await makeProduct(),
          sku,
          `خيار ${sku}`,
          spec.fulfillment,
          spec.price,
          spec.stock ?? null,
          spec.preorder !== undefined,
          spec.preorder?.capacity ?? null,
          spec.preorder ? '2030-01-01' : null,
          spec.preorder ? 'يصلك بعد الطباعة' : null,
        ],
      )
    ).id as string
  }
  async function makeRate(fee: number): Promise<string> {
    const key = unique('city').toLowerCase().replace(/[^a-z0-9-]/g, '')
    await postgres.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, $3, true)', [key, `مدينة ${key}`, fee])
    created.rates.push(key)
    return key
  }
  const city = await makeRate(2500)

  /** Quotes the cart, then creates the order with that quote's hash: a pending order holding its units. */
  async function place(lines: Line[], opts: { environment?: 'test' | 'live'; email?: string } = {}): Promise<Placed> {
    const priced = await call('checkout_quote', { p_ip_hash: ipHash(), p_lines: lines, p_city_key: city, p_coupon_code: null })
    if (priced.ok !== true) throw new Error(`checkout_quote refused: ${JSON.stringify(priced)}`)
    const key = randomUUID()
    const email = opts.email ?? uniqueEmail('delivery-buyer')
    const token = await orderAccessToken(pepper, key)
    const hash = await orderAccessTokenHash(pepper, token)
    const result = await call('checkout_create', {
      p_idempotency_key: key,
      p_request_hash: sha256(`request:${key}`),
      p_checkout_session: randomUUID(),
      p_ip_hash: ipHash(),
      p_email: email,
      p_name: 'مشترٍ',
      p_phone: '966501234567',
      p_lines: lines,
      p_city_key: city,
      p_address: 'تبوك شارع الرئيسي',
      p_coupon_code: null,
      p_policy_revisions: REVISIONS,
      p_quote_hash: priced.quoteHash,
      p_access_token_hash: hash,
      p_environment: opts.environment ?? 'test',
    })
    if (result.ok !== true) throw new Error(`checkout_create refused: ${JSON.stringify(result)}`)
    created.orders.push(result.order.id)
    return { id: result.order.id, number: result.order.orderNumber, total: result.order.total, key, token, hash, email }
  }

  /** begin, then created: a pending attempt with an invoice. */
  async function startPayment(placed: Placed): Promise<{ attemptId: string; invoiceId: string; paymentId: string }> {
    const begun = await call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })
    if (begun.ok !== true || begun.state !== 'new') throw new Error(`payment_attempt_begin: ${JSON.stringify(begun)}`)
    const invoiceId = randomUUID()
    const adopted = await call('payment_attempt_created', {
      p_attempt: begun.attemptId,
      p_invoice_id: invoiceId,
      p_invoice_url: `http://127.0.0.1:54390/invoices/${invoiceId}`,
      p_expires_at: null,
    })
    if (adopted.ok !== true) throw new Error(`payment_attempt_created: ${JSON.stringify(adopted)}`)
    return { attemptId: begun.attemptId, invoiceId, paymentId: randomUUID() }
  }
  /** What the Edge function hands `apply_verified_payment`: the payment and its invoice, normalized. */
  const applyPayment = (placed: Placed, s: { invoiceId: string; paymentId: string }, over: { amount?: number; status?: string } = {}): Promise<any> => {
    const amount = over.amount ?? placed.total
    return call('apply_verified_payment', {
      p_invoice_id: s.invoiceId,
      p_payment: { id: s.paymentId, status: over.status ?? 'paid', amount, currency: 'SAR', fee: 150, refunded: 0, invoiceId: s.invoiceId, sourceType: 'creditcard', sourceCompany: 'mada' },
      p_invoice: { id: s.invoiceId, status: 'paid', amount, currency: 'SAR' },
      p_mode: 'test',
      p_live: null,
      p_event_id: null,
    })
  }
  /** An order placed and paid: its paying attempt and its items with what each cost. */
  async function paid(lines: Line[], opts: { email?: string } = {}): Promise<Paid> {
    const placed = await place(lines, opts)
    const started = await startPayment(placed)
    const applied = await applyPayment(placed, started)
    if (applied.outcome !== 'paid') throw new Error(`the payment did not settle the order: ${JSON.stringify(applied)}`)
    const items = (
      await rows('select id, variant_id, fulfillment, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1 order by line_no', [placed.id])
    ).map((item) => ({ id: item.id as string, variantId: item.variant_id as string, fulfillment: item.fulfillment as string, paid: Number(item.paid) }))
    return { ...placed, ...started, items }
  }

  /** A full refund of a paid order as the owner makes it: requested for every item and the shipping, then confirmed by the provider's total. */
  async function refundFully(p: Paid, actor: string): Promise<void> {
    const shipping = Number((await row('select shipping_halalas from finance.orders where id = $1', [p.id])).shipping_halalas)
    const key = randomUUID()
    const asked = await call('refund_request', {
      p_actor: actor,
      p_order: p.id,
      p_attempt: p.attemptId,
      p_review_payment: null,
      p_amount: p.total,
      p_reason: 'استرداد كامل',
      p_allocation: { items: p.items.filter((item) => item.paid > 0).map((item) => ({ itemId: item.id, amount: item.paid })), shipping },
      p_idempotency_key: key,
      p_request_hash: sha256(`hash:${key}`),
      p_return: null,
      p_provider_refunded: 0,
    })
    if (asked.ok !== true || asked.state !== 'new') throw new Error(`refund_request: ${JSON.stringify(asked)}`)
    const done = await call('refund_result', { p_refund: asked.refundId, p_outcome: 'succeeded', p_provider_refunded: p.total, p_error: null })
    if (done.ok !== true || done.status !== 'succeeded') throw new Error(`refund_result: ${JSON.stringify(done)}`)
  }

  /**
   * A superuser session that holds the rows `sql` selects `for update` until `release()`: what makes two calls queue
   * behind it, so a test can start both and let them race for the same row the moment it is freed.
   */
  async function holdLock(sql: string, params: unknown[]): Promise<{ release: () => Promise<void> }> {
    const holder = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' })
    await holder.connect()
    await holder.query('begin')
    await holder.query(sql, params)
    return {
      release: async () => {
        await holder.query('commit')
        await holder.end()
      },
    }
  }

  /** Retires everything this run made, and restores the commerce settings. */
  async function stop(): Promise<void> {
    // Fixtures cannot be deleted (orders reference them), so they leave the local store: products archived, city rates
    // disabled, nothing of this run left due for the reconciliation job or waiting in the outbox.
    await postgres.query("update public.products set status = 'archived' where id = any($1::uuid[])", [created.products])
    await postgres.query('update public.shipping_rates set enabled = false where city_key = any($1::text[])', [created.rates])
    await postgres.query('update finance.payment_attempts set next_check_at = null where order_id = any($1::uuid[])', [created.orders])
    await postgres.query('update finance.return_requests set refund_id = null where order_id = any($1::uuid[])', [created.orders])
    // Only this run's own rows, by its orders: whatever else writes to the local database meanwhile (a dev session, an e2e
    // run) keeps its refunds, review payments and alerts. The owner alerts of a run's orders carry the order's id, like its mail.
    await postgres.query('delete from finance.refunds where order_id = any($1::uuid[])', [created.orders])
    await postgres.query('delete from finance.return_requests where order_id = any($1::uuid[])', [created.orders])
    await postgres.query(
      "update finance.payment_reviews set closed_at = coalesce(closed_at, now()), closed_reason = coalesce(closed_reason, 'test cleanup') where order_id = any($1::uuid[])",
      [created.orders],
    )
    await postgres.query("delete from finance.email_outbox where payload ->> 'orderId' = any($1::text[])", [created.orders])
    // Only while another owner remains: a database that has none keeps this run's.
    await postgres.query(
      `update public.staff set active = false
        where user_id = any($1::uuid[])
          and exists (select 1 from public.staff o where o.role = 'owner' and o.active and o.user_id <> all($1::uuid[]))`,
      [created.staff],
    )
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
    for (const client of pool) await client.end()
    await postgres.end()
  }

  return {
    postgres,
    pool,
    created,
    city,
    unique,
    ipHash,
    call,
    rows,
    row,
    count,
    makeStaff,
    makeProduct,
    makeVariant,
    digital: (price = 3500) => makeVariant({ fulfillment: 'digital', price }),
    physical: (price = 4000, stock = 10) => makeVariant({ fulfillment: 'physical', price, stock }),
    signed: (price = 9000, stock = 10) => makeVariant({ fulfillment: 'signed', price, stock }),
    place,
    startPayment,
    applyPayment,
    paid,
    refundFully,
    holdLock,
    stop,
  }
}

export type Harness = Awaited<ReturnType<typeof commerceHarness>>
