// P08 round 7: the REAL local `orders`, `download` and `admin` Edge Functions over
// HTTP (Docker), against the local database, the local Storage and the Moyasar
// emulator started in this process on port 54390 (the functions reach it as
// host.docker.internal:54390). A paid digital order goes end to end: the order page,
// the owner's upload of a real PDF through `paid-file-ticket` and `paid-file-complete`
// (a signed upload straight to Storage, then the head checks on the real object), the
// buyer's download token and the signed URL, the bytes fetched back and compared, and a
// full refund through the real `admin` function after which the same token answers
// NOT_FOUND. Then recovery with the same reply for an address with an order and one
// without, the return request, the upload checks on real objects, and the origin and
// role gates. Every owner is a real staff member with a real session (a fresh TOTP for
// the refund, as staff-admin.test.ts does with `stepUp`). The orders are created by SQL
// (`checkout_create`), bound to an emulator invoice and paid on the emulator, whose
// webhook settles them through the real `payments` function. Turnstile runs with the
// local always-pass test secret, so any non-empty token works. Nothing here reaches
// Moyasar. This file switches `finance.commerce_settings.checkout_enabled` on, saved and
// restored by the fixtures.
// CORS is not asserted here: the local gateway (Kong) answers every preflight itself and rewrites
// `Access-Control-Allow-Origin` to `*` on every function reply, `checkout` included (the same code path),
// so what the functions themselves answer (the site's origin, also on a refusal) is proven in
// tests/unit/orders.test.ts and tests/unit/download.test.ts, where nothing sits in front of them.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { crc32 } from 'node:zlib'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DbError } from '../../supabase/functions/_shared/db.ts'
import { paidFileComplete, paidFileStore } from '../../supabase/functions/_shared/paid-files.ts'
import { moyasarClient, type MoyasarClient, type PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { orderAccessToken, orderAccessTokenHash } from '../../supabase/functions/_shared/tokens.ts'
import { startEmulator, type Emulator } from '../support/moyasar-emulator.ts'
import { anonClient, commerceHarness, type Harness, localEnv, type Row, serviceClient, signIn, status, stepUp, uniqueEmail } from './support'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const env = localEnv()
const FUNCTIONS_URL = status.FUNCTIONS_URL
const SITE = env.SITE_URL!
const PEPPER = env.TOKEN_HASH_PEPPER!
const EMULATOR_PORT = 54390
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const FILENAME = 'كتاب أنس.pdf'
const BUCKET = 'paid-files'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

let h: Harness
let emulator: Emulator
let provider: MoyasarClient
const storageKeys: string[] = []
/** The emulator payments this run made: the webhook events it stored are removed by them, not by a time window. */
const paymentIds: string[] = []

// --- what is uploaded ------------------------------------------------------------------------------------------------

/** A one-page PDF with a real cross-reference table, padded past the head so only a ranged read can tell it from the whole. */
function makePdf(): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>',
    `<</Length 5000>>stream\n${'% '.repeat(2500)}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

/** A ZIP of stored entries: local headers, data, the central directory and its end. */
function makeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc32(entry.data), 14)
    header.writeUInt32LE(entry.data.length, 18)
    header.writeUInt32LE(entry.data.length, 22)
    header.writeUInt16LE(name.length, 26)
    parts.push(header, name, entry.data)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt32LE(crc32(entry.data), 16)
    record.writeUInt32LE(entry.data.length, 20)
    record.writeUInt32LE(entry.data.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += 30 + name.length + entry.data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}
const makeEpub = (): Buffer =>
  makeZip([
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from('<container/>') },
    { name: 'OEBPS/page.xhtml', data: Buffer.from(`<html>${'x'.repeat(3000)}</html>`) },
  ])

// --- the functions -----------------------------------------------------------------------------------------------------

type Reply = { status: number; body: any; headers: Headers }
/** A random visitor address per request: the functions throttle by it, and every request is its own visitor. */
const visitorIp = (): string => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`

async function callFunction(name: 'orders' | 'download', body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': visitorIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json(), headers: response.headers }
}
const getOrder = (p: { number: string; token: string }): Promise<Reply> => callFunction('orders', { action: 'get', orderNumber: p.number, accessToken: p.token })
const issue = (p: { number: string; token: string }, itemId: string): Promise<Reply> =>
  callFunction('download', { action: 'issue', orderNumber: p.number, accessToken: p.token, itemId })
const redeem = (downloadToken: string): Promise<Reply> => callFunction('download', { action: 'redeem', downloadToken })

async function adminCall(client: SupabaseClient, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const { data } = await client.auth.getSession()
  const response = await fetch(`${FUNCTIONS_URL}/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: status.PUBLISHABLE_KEY, authorization: `Bearer ${data.session!.access_token}` },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/** A real owner with a real session at aal2 (the refund needs a fresh TOTP). */
let ownerClient: SupabaseClient
let ownerUserId = ''
let editorClient: SupabaseClient

beforeAll(async () => {
  h = await commerceHarness(PEPPER)
  try {
    emulator = await startEmulator({
      port: EMULATOR_PORT,
      webhookUrl: `${FUNCTIONS_URL}/payments/webhook`,
      webhookSecret: env.MOYASAR_WEBHOOK_SECRET!,
      secretKey: env.MOYASAR_SECRET_KEY!,
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'EADDRINUSE') {
      throw new Error(`Port ${EMULATOR_PORT} is busy: stop whatever holds it (a running \`pnpm emulator\`?) and run this file again.`)
    }
    throw error
  }
  const emulatorConfig: PaymentsConfigOk = {
    ok: true,
    baseUrl: `${emulator.url}/v1`,
    secretKey: env.MOYASAR_SECRET_KEY!,
    webhookSecret: env.MOYASAR_WEBHOOK_SECRET!,
    mode: 'test',
    callbackBase: env.FUNCTIONS_PUBLIC_URL!,
    storageBase: `${new URL(env.FUNCTIONS_PUBLIC_URL!).origin}/storage/v1`,
  }
  provider = moyasarClient(emulatorConfig)
  // The throttles of this machine's address that the functions take from, and the day's total of recovery mails.
  await h.postgres.query("delete from finance.rate_limits where bucket in ('payment-callback:ip', 'order-access:ip', 'download-issue:ip', 'download-redeem:ip', 'order-recover:ip', 'return-request:ip')")

  const owner = await h.makeStaff('owner')
  ownerUserId = owner.userId
  ownerClient = await signIn(owner.email)
  await stepUp(ownerClient)
  editorClient = await signIn((await h.makeStaff('editor')).email)
})

afterAll(async () => {
  await emulator?.close()
  if (storageKeys.length > 0) await serviceClient.storage.from(BUCKET).remove(storageKeys)
  await h.postgres.query('delete from finance.payment_events where provider_payment_id = any($1::text[])', [paymentIds])
  await h.stop()
})

beforeEach(() => {
  emulator.reset()
  emulator.config({ autoWebhook: true, autoCallback: false })
})

// --- an order, paid on the emulator -----------------------------------------------------------------------------------

async function control(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${emulator.url}/__emulator${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

type Paid = Awaited<ReturnType<Harness['place']>> & { attemptId: string; paymentId: string; items: Array<{ id: string; variantId: string; fulfillment: string; paid: number }> }

/** An order placed, bound to an emulator invoice and paid there: the emulator's webhook settles it through the real function. */
async function paid(lines: Array<{ variantId: string; quantity: number }>, opts: { email?: string } = {}): Promise<Paid> {
  const placed = await h.place(lines, opts)
  const begun = await h.call('payment_attempt_begin', { p_order_number: placed.number, p_access_token_hash: placed.hash, p_mode: 'test', p_ip_hash: null })
  expect(begun, JSON.stringify(begun)).toMatchObject({ ok: true, state: 'new' })
  const invoice = await provider.createInvoice({
    amount: begun.amount,
    currency: 'SAR',
    description: `طلب ${placed.number}`,
    callback_url: `${env.FUNCTIONS_PUBLIC_URL}/payments/callback`,
    success_url: `${SITE}/checkout/return?order=${placed.number}`,
    back_url: `${SITE}/checkout/return?order=${placed.number}`,
    expired_at: new Date(begun.expiresAt).toISOString(),
    metadata: { order_number: placed.number, attempt_id: begun.attemptId },
  })
  if (!invoice.ok) throw new Error(`the emulator refused the invoice: ${invoice.kind}`)
  expect(await h.call('payment_attempt_created', { p_attempt: begun.attemptId, p_invoice_id: invoice.data.id, p_invoice_url: invoice.data.url, p_expires_at: null })).toEqual({ ok: true })
  const payment = await control('/pay', { invoiceId: invoice.data.id, status: 'paid' })
  expect(payment.status, JSON.stringify(payment.body)).toBe(200)
  paymentIds.push(payment.body.payment.id)
  expect(await h.row('select status from finance.orders where id = $1', [placed.id])).toMatchObject({ status: 'paid' })
  const items = (await h.rows('select id, variant_id, fulfillment, line_subtotal_halalas - discount_halalas as paid from finance.order_items where order_id = $1 order by line_no', [placed.id])).map((item) => ({
    id: item.id as string,
    variantId: item.variant_id as string,
    fulfillment: item.fulfillment as string,
    paid: Number(item.paid),
  }))
  return { ...placed, attemptId: begun.attemptId, paymentId: payment.body.payment.id, items }
}

/** The owner's upload of one file, as the variant form will do it: a ticket, a signed upload to Storage, then the completion. */
async function upload(variantId: string, file: Buffer, over: { contentType?: string; declared?: string; filename?: string } = {}): Promise<{ ticket: string; path: string; complete: { status: number; body: any } }> {
  const declared = over.declared ?? 'application/pdf'
  const ticket = await adminCall(ownerClient, { action: 'paid-file-ticket', variantId, filename: over.filename ?? FILENAME, mime: declared, bytes: file.length })
  expect(ticket.status, JSON.stringify(ticket.body)).toBe(201)
  const { path, token } = ticket.body.data as { path: string; token: string }
  const sent = await anonClient().storage.from(BUCKET).uploadToSignedUrl(path, token, new Blob([new Uint8Array(file)], { type: over.contentType ?? declared }), { contentType: over.contentType ?? declared })
  expect(sent.error, JSON.stringify(sent.error)).toBeNull()
  const complete = await adminCall(ownerClient, { action: 'paid-file-complete', variantId, ticket: ticket.body.data.ticket, filename: over.filename ?? FILENAME, mime: declared })
  return { ticket: ticket.body.data.ticket as string, path, complete }
}
const objectExists = async (key: string): Promise<boolean> => (await serviceClient.storage.from(BUCKET).exists(key)).data
const entitlementOf = (itemId: string): Promise<Row> => h.row('select * from finance.entitlements where order_item_id = $1', [itemId])

// --- the whole journey ----------------------------------------------------------------------------------------------------

describe('a paid digital order, end to end', () => {
  it('shows the order, takes the owner\'s PDF, hands out a download and the bytes come back; a full refund then stops the same token', async () => {
    const variantId = await h.digital(3500)
    const p = await paid([{ variantId, quantity: 1 }])
    const itemId = p.items[0]!.id

    // 1. The order page: paid, the file not there yet.
    const first = await getOrder(p)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(Object.keys(first.body.data).sort()).toEqual(['items', 'order', 'payment', 'returns'])
    expect(first.body.data.order).toMatchObject({ orderNumber: p.number, status: 'paid', total: p.total, testMode: true, refunded: 0 })
    expect(first.body.data.payment).toEqual({ state: 'paid' })
    expect(first.body.data.items[0]).toMatchObject({ itemId, fulfillment: 'digital', download: { available: false, revoked: false } })
    expect(first.headers.get('referrer-policy')).toBe('no-referrer')
    expect(first.headers.get('cache-control')).toBe('no-store')
    // Nothing to download yet: one answer, the same as for a wrong token.
    expect((await issue(p, itemId)).status).toBe(404)

    // 2. The owner uploads a real PDF. The signed upload goes straight to Storage; the function reads the object's metadata
    //    and its first bytes, moves it, records it, and mails the buyer who waited.
    const pdf = makePdf()
    const { ticket, path, complete } = await upload(variantId, pdf)
    expect(complete.status, JSON.stringify(complete.body)).toBe(201)
    expect(complete.body).toEqual({ ok: true, data: { assetId: expect.any(String), filled: 1 } })
    const assetKey = `assets/${variantId}/${complete.body.data.assetId}`
    storageKeys.push(assetKey, path)
    expect(path).toBe(`incoming/${ticket}`)
    expect(await objectExists(assetKey)).toBe(true)
    expect(await objectExists(path)).toBe(false)
    expect(await h.row('select * from finance.paid_assets where variant_id = $1', [variantId])).toMatchObject({
      id: complete.body.data.assetId, storage_key: assetKey, filename: FILENAME, mime: 'application/pdf', created_by: ownerUserId,
    })
    expect(Number((await h.row('select bytes from finance.paid_assets where variant_id = $1', [variantId])).bytes)).toBe(pdf.length)
    expect((await h.row('select digital_asset from public.product_variants where id = $1', [variantId])).digital_asset).toBe(assetKey)
    const entitlement = await entitlementOf(itemId)
    expect(entitlement.asset_id).toBe(complete.body.data.assetId)
    const mails = await h.rows('select * from finance.email_outbox where dedupe_key = $1', [`order_ready:${entitlement.id}`])
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ kind: 'order_ready', recipient: p.email.toLowerCase(), payload: { orderId: p.id, itemIds: [itemId] } })
    expect((await getOrder(p)).body.data.items[0].download).toEqual({ available: true, revoked: false })

    // 3. The buyer asks for the file: a 15-minute download token (only its hash is stored), then a 60-second URL.
    const issued = await issue(p, itemId)
    expect(issued.status, JSON.stringify(issued.body)).toBe(200)
    expect(issued.body.data).toEqual({ downloadToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(String) })
    expect(issued.headers.get('referrer-policy')).toBe('no-referrer')
    expect(issued.headers.get('cache-control')).toBe('no-store')
    const downloadToken = issued.body.data.downloadToken as string
    const stored = await h.row('select * from finance.download_tokens where token_hash = $1', [sha256(`${PEPPER}:download:${downloadToken}`)])
    expect(stored).toMatchObject({ entitlement_id: entitlement.id, uses: 0, max_uses: 3 })
    expect(JSON.stringify(stored)).not.toContain(downloadToken)

    const redeemed = await redeem(downloadToken)
    expect(redeemed.status, JSON.stringify(redeemed.body)).toBe(200)
    expect(Object.keys(redeemed.body.data)).toEqual(['url'])
    expect(redeemed.headers.get('referrer-policy')).toBe('no-referrer')
    const url = new URL(redeemed.body.data.url as string)
    // The public Storage base (never the runtime's own address), the object's path, a signed token and the file's own name.
    expect(url.origin + url.pathname).toBe(`${new URL(env.FUNCTIONS_PUBLIC_URL!).origin}/storage/v1/object/sign/${BUCKET}/${assetKey}`)
    expect(url.searchParams.get('download')).toBe(FILENAME)
    const claims = JSON.parse(Buffer.from((url.searchParams.get('token') ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp: number }
    const secondsLeft = claims.exp - Date.now() / 1000
    expect(secondsLeft).toBeGreaterThan(0)
    expect(secondsLeft).toBeLessThanOrEqual(61)
    // The key is inside the URL and nowhere else in the reply.
    expect(JSON.stringify(redeemed.body).split(assetKey)).toHaveLength(2)

    const file = await fetch(url)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(FILENAME)}`)
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true)

    // At most three links per token.
    expect((await redeem(downloadToken)).status).toBe(200)
    expect((await redeem(downloadToken)).status).toBe(200)
    const spent = await redeem(downloadToken)
    expect(spent.status).toBe(404)
    expect(spent.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect((await h.row('select uses from finance.download_tokens where token_hash = $1', [sha256(`${PEPPER}:download:${downloadToken}`)])).uses).toBe(3)

    // 4. A token that still has two uses left; then a full refund through the real admin function.
    const fresh = (await issue(p, itemId)).body.data.downloadToken as string
    expect((await redeem(fresh)).status).toBe(200)
    const refund = await adminCall(ownerClient, {
      action: 'refund-create',
      orderId: p.id,
      attemptId: p.attemptId,
      amount: p.total,
      reason: 'استرداد كامل',
      allocation: { items: [{ itemId, amount: p.items[0]!.paid }], shipping: 0 },
      idempotencyKey: randomUUID(),
    })
    expect(refund.status, JSON.stringify(refund.body)).toBe(200)
    expect(refund.body.data).toMatchObject({ status: 'succeeded', amount: p.total })
    expect(await h.row('select status from finance.orders where id = $1', [p.id])).toMatchObject({ status: 'refunded' })

    // The token that was issued before the refund (with uses left) now answers what an unknown one does; nothing new is issued.
    const after = await redeem(fresh)
    expect(after.status).toBe(404)
    expect(after.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect((await h.row('select uses from finance.download_tokens where token_hash = $1', [sha256(`${PEPPER}:download:${fresh}`)])).uses).toBe(1)
    expect((await issue(p, itemId)).status).toBe(404)
    const page = await getOrder(p)
    expect(page.body.data.order).toMatchObject({ status: 'refunded', refunded: p.total })
    expect(page.body.data.items[0].download).toEqual({ available: false, revoked: true })
    expect(page.body.data.payment).toEqual({ state: 'refunded' })
  })

  it('shows what a buyer must not see nowhere: no address, no provider id, no key, no token', async () => {
    const variantId = await h.digital(3500)
    const upload1 = await upload(variantId, makePdf())
    storageKeys.push(`assets/${variantId}/${upload1.complete.body.data.assetId}`, upload1.path)
    const p = await paid([{ variantId, quantity: 1 }])
    const reply = await getOrder(p)
    const text = JSON.stringify(reply.body)
    for (const secret of [p.email, '966501234567', 'تبوك شارع الرئيسي', p.attemptId, p.paymentId, p.token, p.hash, p.key, upload1.complete.body.data.assetId, 'storage_key']) {
      expect(text, secret).not.toContain(secret)
    }
  })
})

// --- recovery ---------------------------------------------------------------------------------------------------------------

describe('recovery over HTTP', () => {
  const recover = (email: string): Promise<Reply> => callFunction('orders', { action: 'recover', email, turnstileToken: TURNSTILE_TOKEN })
  const linkMails = (orderId: string): Promise<Row[]> => h.rows("select * from finance.email_outbox where kind = 'order_link' and payload ->> 'orderId' = $1", [orderId])

  it('answers an address with an order and an address with none with the same reply, and only the first gets a mail and a renewed link', async () => {
    const p = await paid([{ variantId: await h.digital(2500), quantity: 1 }])
    await h.postgres.query("update finance.orders set access_token_expires_at = now() + interval '1 hour' where id = $1", [p.id])
    const stranger = uniqueEmail('stranger')

    const hit = await recover(p.email)
    const miss = await recover(stranger)
    expect(hit.status).toBe(200)
    expect(miss.status).toBe(200)
    expect(hit.body).toEqual({ ok: true, data: { sent: true } })
    expect(miss.body).toEqual(hit.body)
    for (const name of ['cache-control', 'referrer-policy', 'content-type']) expect(miss.headers.get(name), name).toBe(hit.headers.get(name))
    expect(hit.headers.get('referrer-policy')).toBe('no-referrer')

    // The address with an order: its link renewed, one mail with ids only. The stranger: nothing at all.
    expect(Number((await h.row('select extract(epoch from (access_token_expires_at - now())) as s from finance.orders where id = $1', [p.id])).s)).toBeGreaterThan(7 * 24 * 3600 - 300)
    const mails = await linkMails(p.id)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ kind: 'order_link', recipient: p.email.toLowerCase(), payload: { orderId: p.id } })
    expect(await h.count('select count(*)::int as n from finance.email_outbox where recipient = $1', [stranger])).toBe(0)
    // The old link still works: a live link is never replaced.
    expect((await getOrder(p)).status).toBe(200)
    expect((await h.row('select access_token_version from finance.orders where id = $1', [p.id])).access_token_version).toBe(0)
    // Nothing in the reply or the row names the address, the token or the order.
    expect(JSON.stringify(hit.body)).not.toContain(p.email)
  })

  it('gives an expired link a new version: the old token is dead at the real function and the new one opens the order', async () => {
    const p = await paid([{ variantId: await h.digital(2500), quantity: 1 }])
    await h.postgres.query("update finance.orders set access_token_expires_at = now() - interval '1 minute' where id = $1", [p.id])
    expect((await getOrder(p)).status).toBe(404)

    const reply = await recover(p.email)
    expect(reply.body).toEqual({ ok: true, data: { sent: true } })
    expect((await h.row('select access_token_version from finance.orders where id = $1', [p.id])).access_token_version).toBe(1)
    expect((await getOrder(p)).status).toBe(404)
    const fresh = await orderAccessToken(PEPPER, p.key, 1)
    const opened = await getOrder({ number: p.number, token: fresh })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    expect(await orderAccessTokenHash(PEPPER, fresh)).toBe((await h.row('select access_token_hash from finance.orders where id = $1', [p.id])).access_token_hash)
    expect((await linkMails(p.id)).map((mail) => mail.dedupe_key)).toHaveLength(1)
  })

  it('refuses a malformed address with a field error and a Turnstile token that is missing, before the database', async () => {
    const bad = await callFunction('orders', { action: 'recover', email: 'not-an-address', turnstileToken: TURNSTILE_TOKEN })
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('INVALID')
    const noToken = await callFunction('orders', { action: 'recover', email: uniqueEmail('x'), turnstileToken: '' })
    expect(noToken.status).toBe(422)
  })
})

// --- the return request -----------------------------------------------------------------------------------------------------

describe('the return request over HTTP', () => {
  it('takes a request for shipped goods, shows it on the order page, and refuses what cannot be returned', async () => {
    const printed = await h.physical(4000, 10)
    const book = await h.digital(2000)
    const p = await paid([{ variantId: printed, quantity: 2 }, { variantId: book, quantity: 1 }])
    const printedItem = p.items.find((item) => item.variantId === printed)!.id
    const bookItem = p.items.find((item) => item.variantId === book)!.id
    const send = (items: unknown, reason = 'المنتج تالف'): Promise<Reply> =>
      callFunction('orders', { action: 'return-request', orderNumber: p.number, accessToken: p.token, items, reason })

    // Not shipped yet.
    expect((await send([{ itemId: printedItem, quantity: 1 }])).body).toMatchObject({ ok: false, error: { code: 'NOT_RETURNABLE' } })
    await h.postgres.query("update finance.fulfillments set state = 'shipped', carrier = 'SMSA', tracking = 'TRK-1', shipped_at = now() where order_item_id = $1", [printedItem])
    // A digital item is never returnable.
    expect((await send([{ itemId: bookItem, quantity: 1 }])).status).toBe(409)
    // More than was bought.
    const tooMany = await send([{ itemId: printedItem, quantity: 3 }])
    expect(tooMany.status).toBe(422)
    expect(tooMany.body.error.code).toBe('INVALID_ITEMS')

    const taken = await send([{ itemId: printedItem, quantity: 1 }], '  المنتج\nتالف  ')
    expect(taken.status, JSON.stringify(taken.body)).toBe(201)
    expect(taken.body).toEqual({ ok: true, data: { returnId: expect.any(String) } })
    expect(taken.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await h.row('select * from finance.return_requests where id = $1', [taken.body.data.returnId])).toMatchObject({ order_id: p.id, state: 'requested', reason: 'المنتج تالف', items: [{ itemId: printedItem, quantity: 1 }] })

    const page = (await getOrder(p)).body.data
    expect(page.returns).toEqual([{ id: taken.body.data.returnId, state: 'requested', createdAt: expect.any(String) }])
    expect(page.items.find((item: Row) => item.itemId === printedItem)).toMatchObject({ state: 'shipped', carrier: 'SMSA', tracking: 'TRK-1', returnable: 1 })
    // The wrong token is the one answer for everything.
    const wrong = await callFunction('orders', { action: 'return-request', orderNumber: p.number, accessToken: 'A'.repeat(43), items: [{ itemId: printedItem, quantity: 1 }], reason: 'x' })
    expect(wrong.status).toBe(404)
  })
})

// --- the upload checks on real objects ---------------------------------------------------------------------------------------

describe('the upload checks, on real objects in the real Storage', () => {
  /** An upload that must be refused: 422 with the code, and the uploaded part gone from Storage. */
  async function refused(file: Buffer, over: Parameters<typeof upload>[2], code: string): Promise<void> {
    const variantId = await h.digital(1000)
    const { path, complete } = await upload(variantId, file, over)
    expect(complete.status, JSON.stringify(complete.body)).toBe(422)
    expect(complete.body.error.code).toBe(code)
    expect(await objectExists(path)).toBe(false)
    expect(await h.rows('select 1 from finance.paid_assets where variant_id = $1', [variantId])).toHaveLength(0)
    expect((await h.row('select digital_asset from public.product_variants where id = $1', [variantId])).digital_asset).toBeNull()
  }

  it('a renamed executable declared as a PDF is refused and removed', async () => {
    await refused(Buffer.concat([Buffer.from('MZ'), randomBytes(4000)]), {}, 'NOT_A_PDF')
  })

  it('a file that is not an EPUB is refused and removed: a plain ZIP, a PDF', async () => {
    await refused(makeZip([{ name: 'readme.txt', data: Buffer.from('hello') }, { name: 'mimetype', data: Buffer.from('application/epub+zip') }]), { declared: 'application/epub+zip' }, 'NOT_AN_EPUB')
    await refused(makePdf(), { declared: 'application/epub+zip' }, 'NOT_AN_EPUB')
  })

  it('a stored type that differs from the declared one is refused and removed', async () => {
    await refused(makePdf(), { contentType: 'application/epub+zip', declared: 'application/pdf' }, 'TYPE_MISMATCH')
    await refused(makeEpub(), { contentType: 'application/pdf', declared: 'application/epub+zip' }, 'TYPE_MISMATCH')
  })

  it('a real EPUB is taken, and its bytes come back whole', async () => {
    const variantId = await h.digital(1000)
    const epub = makeEpub()
    const { path, complete } = await upload(variantId, epub, { declared: 'application/epub+zip', filename: 'كتاب.epub' })
    expect(complete.status, JSON.stringify(complete.body)).toBe(201)
    const assetKey = `assets/${variantId}/${complete.body.data.assetId}`
    storageKeys.push(assetKey, path)
    const downloaded = await serviceClient.storage.from(BUCKET).download(assetKey)
    expect(Buffer.from(await downloaded.data!.arrayBuffer()).equals(epub)).toBe(true)
    expect(await h.row('select mime, filename from finance.paid_assets where variant_id = $1', [variantId])).toMatchObject({ mime: 'application/epub+zip', filename: 'كتاب.epub' })
  })

  it('a ticket that was never uploaded, and one already completed, say there is no file', async () => {
    const variantId = await h.digital(1000)
    const ticket = await adminCall(ownerClient, { action: 'paid-file-ticket', variantId, filename: 'a.pdf', mime: 'application/pdf', bytes: 100 })
    const never = await adminCall(ownerClient, { action: 'paid-file-complete', variantId, ticket: ticket.body.data.ticket, filename: 'a.pdf', mime: 'application/pdf' })
    expect(never.status).toBe(422)
    expect(never.body.error.code).toBe('MISSING_FILE')

    const done = await upload(variantId, makePdf())
    expect(done.complete.status).toBe(201)
    storageKeys.push(`assets/${variantId}/${done.complete.body.data.assetId}`, done.path)
    const again = await adminCall(ownerClient, { action: 'paid-file-complete', variantId, ticket: done.ticket, filename: FILENAME, mime: 'application/pdf' })
    expect(again.status).toBe(422)
    expect(again.body.error.code).toBe('MISSING_FILE')
  })

  it('a physical variant is refused by the database, and the moved object is removed again', async () => {
    const variantId = await h.physical()
    const { complete } = await upload(variantId, makePdf())
    expect(complete.status, JSON.stringify(complete.body)).toBe(422)
    expect(complete.body.error.code).toBe('NOT_DIGITAL')
    const left = await serviceClient.storage.from(BUCKET).list(`assets/${variantId}`)
    expect(left.data ?? []).toHaveLength(0)
  })

  it('a lock held elsewhere puts the real object back under its ticket, and the same ticket then completes', async () => {
    const variantId = await h.digital(1000)
    const pdf = makePdf()
    const ticket = await adminCall(ownerClient, { action: 'paid-file-ticket', variantId, filename: FILENAME, mime: 'application/pdf', bytes: pdf.length })
    expect(ticket.status, JSON.stringify(ticket.body)).toBe(201)
    const { path, token } = ticket.body.data as { path: string; token: string }
    storageKeys.push(path)
    const sent = await anonClient().storage.from(BUCKET).uploadToSignedUrl(path, token, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    expect(sent.error, JSON.stringify(sent.error)).toBeNull()
    const completion = { action: 'paid-file-complete', variantId, ticket: ticket.body.data.ticket, filename: FILENAME, mime: 'application/pdf' }

    // The handler on the real Storage, with a database that answers "lock not available" (nothing was recorded).
    vi.stubEnv('SUPABASE_URL', status.API_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.SECRET_KEY)
    try {
      const busy = await paidFileComplete(
        {
          rpc: async () => {
            throw new DbError('could not obtain lock', '55P03')
          },
          files: paidFileStore(),
        },
        ownerUserId,
        completion,
      )
      expect(busy.status).toBe(409)
    } finally {
      vi.unstubAllEnvs()
    }
    // The object waits under its ticket: nothing is left under assets/, which nothing sweeps.
    expect(await objectExists(path)).toBe(true)
    expect((await serviceClient.storage.from(BUCKET).list(`assets/${variantId}`)).data ?? []).toHaveLength(0)
    expect(await h.rows('select 1 from finance.paid_assets where variant_id = $1', [variantId])).toHaveLength(0)

    // The owner tries again with the same ticket, through the real function.
    const done = await adminCall(ownerClient, completion)
    expect(done.status, JSON.stringify(done.body)).toBe(201)
    const assetKey = `assets/${variantId}/${done.body.data.assetId}`
    storageKeys.push(assetKey)
    expect(await objectExists(path)).toBe(false)
    expect(await objectExists(assetKey)).toBe(true)
    expect(await h.row('select storage_key from finance.paid_assets where variant_id = $1', [variantId])).toMatchObject({ storage_key: assetKey })
  })

  it('only an owner may ask: an editor is refused both actions, and so is a caller with no session', async () => {
    const variantId = await h.digital(1000)
    for (const body of [
      { action: 'paid-file-ticket', variantId, filename: 'a.pdf', mime: 'application/pdf', bytes: 100 },
      { action: 'paid-file-complete', variantId, ticket: randomUUID(), filename: 'a.pdf', mime: 'application/pdf' },
    ]) {
      const refusedEditor = await adminCall(editorClient, body)
      expect(refusedEditor.status).toBe(403)
      expect(refusedEditor.body.error.code).toBe('FORBIDDEN')
      const anonymous = await fetch(`${FUNCTIONS_URL}/admin`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: status.PUBLISHABLE_KEY }, body: JSON.stringify(body) })
      expect([401, 403]).toContain(anonymous.status)
    }
  })
})

// --- the daily sweep ---------------------------------------------------------------------------------------------------------

describe('the daily sweep of abandoned uploads, through the real jobs endpoint', () => {
  it('removes a part under incoming/ that is over a day old from the real Storage, and keeps a fresh part and an old asset', async () => {
    const stale = `incoming/${randomUUID()}`
    const fresh = `incoming/${randomUUID()}`
    const asset = `assets/${randomUUID()}/${randomUUID()}`
    for (const key of [stale, fresh, asset]) {
      const { error } = await serviceClient.storage.from(BUCKET).upload(key, new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
      expect(error, key).toBeNull()
      storageKeys.push(key)
    }
    // Only the database can age an object. The asset is the oldest of all: age alone never removes anything under assets/.
    await h.postgres.query("update storage.objects set created_at = now() - interval '25 hours' where bucket_id = $1 and name = $2", [BUCKET, stale])
    await h.postgres.query("update storage.objects set created_at = now() - interval '30 days' where bucket_id = $1 and name = $2", [BUCKET, asset])

    const run = await fetch(`${FUNCTIONS_URL}/outbox`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.JOBS_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ job: 'media_sweep' }),
    })
    const body = (await run.json()) as { ok: boolean; data: Array<{ job: string; status: string; paidFiles: number }> }
    expect(run.status, JSON.stringify(body)).toBe(200)
    expect(body.data[0]).toMatchObject({ job: 'media_sweep', status: 'ok' })
    expect(body.data[0]!.paidFiles).toBeGreaterThanOrEqual(1)

    expect(await objectExists(stale)).toBe(false)
    expect(await objectExists(fresh)).toBe(true)
    expect(await objectExists(asset)).toBe(true)
  })
})

// --- the gates -----------------------------------------------------------------------------------------------------------------

describe('the gates of the real functions', () => {
  it.each(['orders', 'download'] as const)('%s refuses a foreign origin, a missing one and a wrong method', async (name) => {
    const body = name === 'orders' ? { action: 'get', orderNumber: 'ABCD2345', accessToken: 'A'.repeat(43) } : { action: 'redeem', downloadToken: 'B'.repeat(43) }
    const foreign = await callFunction(name, body, { origin: 'https://evil.test' })
    expect(foreign.status).toBe(403)
    expect(foreign.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(foreign.headers.get('referrer-policy')).toBe('no-referrer')
    expect(foreign.headers.get('cache-control')).toBe('no-store')

    const noOrigin = await fetch(`${FUNCTIONS_URL}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(noOrigin.status).toBe(403)

    const get = await fetch(`${FUNCTIONS_URL}/${name}`, { method: 'GET', headers: { origin: SITE } })
    expect(get.status).toBe(405)
  })

  it('answers the same NOT_FOUND for an unknown number, a wrong token and an unknown download token, and puts no-store on it', async () => {
    const unknown = await callFunction('orders', { action: 'get', orderNumber: 'AAAAAAAA', accessToken: 'A'.repeat(43) })
    expect(unknown.status).toBe(404)
    expect(unknown.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(unknown.headers.get('cache-control')).toBe('no-store')
    const download = await redeem('B'.repeat(43))
    expect(download.status).toBe(404)
    expect(download.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(download.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await callFunction('download', 'not json')).status).toBe(400)
  })
})
