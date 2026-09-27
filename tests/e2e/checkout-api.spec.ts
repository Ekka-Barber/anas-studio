// P07 e2e: the `checkout` Edge Function at the API level, against the local
// functions runtime (D32) with Turnstile's always-pass test secret, exactly as
// the contact tests run it. The spec brings its own product, variant, city
// rate and commerce settings, and removes or restores every one of them in
// afterAll; checkout is switched on only between the off-test and afterAll.
import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { expect, test } from '@playwright/test'

import { readStatus, SITE_ORIGIN } from './helpers'

const status = readStatus()
const CHECKOUT = `${status.FUNCTIONS_URL}/checkout`
const POLICY_REVISIONS = { store: 1, delivery: 1, refund: 1 }

let db: Client
let saved: Record<string, unknown>
let productId: string
let variantId: string
let cityKey: string
let orderId: string | null = null
const marker = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const buyerEmail = `buyer-${marker}@example.com`

test.beforeAll(async () => {
  db = new Client({ connectionString: status.DB_URL })
  await db.connect()
  saved = (
    await db.query(
      'select checkout_enabled, seller_legal_name, seller_address, seller_registration, policy_revisions, version, configured_at, approved_by from finance.commerce_settings where id = 1',
    )
  ).rows[0]!

  const slug = `e2e-checkout-${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  productId = (
    await db.query<{ id: string }>(
      `insert into public.products (slug, title, summary, status) values ($1, 'منتج الاختبار', 'ملخص', 'published') returning id`,
      [slug],
    )
  ).rows[0]!.id
  variantId = (
    await db.query<{ id: string }>(
      `insert into public.product_variants (product_id, sku, title, fulfillment, price_halalas, enabled, stock)
       values ($1, $2, 'خيار', 'physical', 5000, true, 5) returning id`,
      [productId, `E2E-${marker}`.toUpperCase().replace(/[^A-Z0-9-]/g, '')],
    )
  ).rows[0]!.id
  cityKey = `e2ecity${marker}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  await db.query('insert into public.shipping_rates (city_key, name_ar, fee_halalas, enabled) values ($1, $2, 2500, true)', [
    cityKey,
    `مدينة ${marker}`,
  ])
  // The off-test runs first; the on-fixture is set inside the second test.
  await db.query('update finance.commerce_settings set checkout_enabled = false where id = 1')
})

test.afterAll(async () => {
  // The spec's own order (cancelled, but its rows still reference the fixtures).
  if (orderId) {
    await db.query('delete from finance.order_items where order_id = $1', [orderId])
    await db.query('delete from finance.inventory_reservations where order_id = $1', [orderId])
    await db.query('delete from finance.orders where id = $1', [orderId])
  }
  await db.query('delete from public.customers where email = $1', [buyerEmail])
  await db.query('delete from public.product_variants where product_id = $1', [productId])
  await db.query('delete from public.products where id = $1', [productId])
  await db.query('delete from public.shipping_rates where city_key = $1', [cityKey])
  await db.query(
    `update finance.commerce_settings set checkout_enabled = $1, seller_legal_name = $2, seller_address = $3,
       seller_registration = $4, policy_revisions = $5::jsonb, version = $6, configured_at = $7, approved_by = $8
     where id = 1`,
    [
      saved.checkout_enabled,
      saved.seller_legal_name,
      saved.seller_address,
      saved.seller_registration,
      JSON.stringify(saved.policy_revisions),
      saved.version,
      saved.configured_at,
      saved.approved_by,
    ],
  )
  await db.end()
})

/** Posts one checkout action with the site origin and a per-run visitor IP. */
async function post(request: import('@playwright/test').APIRequestContext, body: unknown, origin = SITE_ORIGIN) {
  return request.post(CHECKOUT, {
    headers: { origin, 'cf-connecting-ip': `198.51.100.${(Math.random() * 254 | 0) + 1}` },
    data: body,
  })
}

test('a quote for a fixture product prices the cart', async ({ request }) => {
  const response = await post(request, { action: 'quote', lines: [{ variantId, quantity: 2 }], cityKey })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { ok: boolean; data: { ok: boolean; subtotal: number; shipping: number; total: number } }
  expect(body.ok).toBe(true)
  expect(body.data.ok).toBe(true)
  expect(body.data.subtotal).toBe(10_000)
  expect(body.data.shipping).toBe(2500)
  expect(body.data.total).toBe(12_500)
})

test('a create while checkout is off is 503 CHECKOUT_DISABLED', async ({ request }) => {
  const response = await post(request, {
    action: 'create',
    idempotencyKey: randomUUID(),
    checkoutSession: randomUUID(),
    lines: [{ variantId, quantity: 1 }],
    cityKey,
    address: 'تبوك شارع الرئيسي',
    email: `buyer-${marker}@example.com`,
    name: 'مشترٍ',
    phone: '0501234567',
    policyRevisions: POLICY_REVISIONS,
    quoteHash: '0'.repeat(64),
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  })
  expect(response.status()).toBe(503)
  const body = (await response.json()) as { error: { code: string } }
  expect(body.error.code).toBe('CHECKOUT_DISABLED')
})

test('with checkout on: create, repeat and cancel', async ({ request }) => {
  await db.query(
    `update finance.commerce_settings set checkout_enabled = true, seller_legal_name = 'بائع الاختبار',
       seller_address = 'تبوك', seller_registration = 'E2E-REG', policy_revisions = $1::jsonb, version = version + 1
     where id = 1`,
    [JSON.stringify(POLICY_REVISIONS)],
  )
  const quoted = (await (await post(request, { action: 'quote', lines: [{ variantId, quantity: 1 }], cityKey })).json()) as {
    data: { quoteHash: string }
  }
  const idempotencyKey = randomUUID()
  const body = {
    action: 'create',
    idempotencyKey,
    checkoutSession: randomUUID(),
    lines: [{ variantId, quantity: 1 }],
    cityKey,
    address: 'تبوك شارع الرئيسي',
    email: buyerEmail,
    name: 'مشترٍ',
    phone: '0501234567',
    policyRevisions: POLICY_REVISIONS,
    quoteHash: quoted.data.quoteHash,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  }

  const created = await post(request, body)
  expect(created.status()).toBe(201)
  const createdBody = (await created.json()) as { ok: boolean; data: { order: { id: string; orderNumber: string; status: string }; accessToken: string } }
  expect(createdBody.ok).toBe(true)
  expect(createdBody.data.order.status).toBe('pending_payment')
  expect(createdBody.data.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  orderId = createdBody.data.order.id

  const repeated = await post(request, { ...body, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' })
  expect(repeated.status()).toBe(200)
  const repeatedBody = (await repeated.json()) as { ok: boolean; data: { order: { orderNumber: string }; accessToken: string } }
  expect(repeatedBody.data.order.orderNumber).toBe(createdBody.data.order.orderNumber)
  expect(repeatedBody.data.accessToken).toBe(createdBody.data.accessToken)

  const cancelled = await post(request, {
    action: 'cancel',
    orderNumber: createdBody.data.order.orderNumber,
    accessToken: createdBody.data.accessToken,
  })
  expect(cancelled.status()).toBe(200)
  const cancelledBody = (await cancelled.json()) as { ok: boolean; data: { status: string } }
  expect(cancelledBody).toEqual({ ok: true, data: { status: 'cancelled' } })
})

test('a foreign Origin is 403', async ({ request }) => {
  const response = await post(request, { action: 'quote', lines: [{ variantId, quantity: 1 }] }, 'https://evil.test')
  expect(response.status()).toBe(403)
})
