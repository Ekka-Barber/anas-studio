// P08 round 1: the local Moyasar emulator (tests/support/moyasar-emulator.ts).
// It is a test harness, so these tests pin what the rest of P08 leans on: the
// documented routes and object shapes (contract section 2), the error bodies,
// Basic auth, pagination, expiry, the cancel and refund rules, every switch for
// what the documentation leaves open, every fault mode, the webhook and the
// invoice callback as they are delivered, the stand-in page, and the guards that
// keep the harness on the local machine. Real servers on loopback, no mocks;
// every server and timer is closed or cleared before a file ends.
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isLocalPeer,
  LOCAL_SECRET_KEY,
  LOCAL_WEBHOOK_SECRET,
  startEmulator,
  type Emulator,
  type InvoiceObject,
  type PaymentObject,
} from '../support/moyasar-emulator.ts'

const KEY = LOCAL_SECRET_KEY
const AUTH = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`
const SITE = 'http://localhost:3000'
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// The documented fields, by name (contract section 2).
const INVOICE_KEYS = [
  'amount',
  'amount_format',
  'back_url',
  'callback_url',
  'created_at',
  'currency',
  'description',
  'expired_at',
  'id',
  'logo_url',
  'metadata',
  'payments',
  'status',
  'success_url',
  'updated_at',
  'url',
]
const PAYMENT_KEYS = [
  'amount',
  'amount_format',
  'callback_url',
  'captured',
  'captured_at',
  'captured_format',
  'created_at',
  'currency',
  'description',
  'fee',
  'fee_format',
  'id',
  'invoice_id',
  'ip',
  'metadata',
  'refunded',
  'refunded_at',
  'refunded_format',
  'source',
  'status',
  'updated_at',
  'voided_at',
]
const SOURCE_KEYS = ['company', 'gateway_id', 'message', 'number', 'reference_number', 'transaction_url', 'type']
const AUTH_ERROR = { type: 'authentication_error', message: 'Invalid authorization credentials', errors: null }

type Json = Record<string, unknown>
interface Answer<T = Json> {
  status: number
  body: T
}

let emulator: Emulator

/** A call to the emulator; `auth` null sends no Authorization header. */
async function call<T = Json>(method: string, path: string, body?: unknown, auth: string | null = AUTH): Promise<Answer<T>> {
  const response = await fetch(`${emulator.url}${path}`, {
    method,
    headers: { ...(auth ? { authorization: auth } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as T }
}
const moyasar = (method: string, path: string, body?: unknown): Promise<Answer> => call(method, `/v1${path}`, body)
const harness = (path: string, body: unknown = {}): Promise<Answer> => call('POST', `/__emulator${path}`, body, null)

function invoiceBody(overrides: Json = {}): Json {
  return {
    amount: 6900,
    currency: 'SAR',
    description: 'طلب ABCD2345',
    callback_url: 'http://127.0.0.1:54321/functions/v1/payments/callback',
    success_url: `${SITE}/checkout/return?order=ABCD2345`,
    back_url: `${SITE}/checkout/return?order=ABCD2345`,
    expired_at: new Date(Date.now() + 3_600_000).toISOString(),
    metadata: { order_number: 'ABCD2345', attempt_id: randomUUID() },
    ...overrides,
  }
}

async function newInvoice(overrides: Json = {}): Promise<InvoiceObject> {
  const reply = await moyasar('POST', '/invoices', invoiceBody(overrides))
  expect(reply.status).toBe(201)
  return reply.body as unknown as InvoiceObject
}

async function pay(invoiceId: string, status: string, extra: Json = {}): Promise<PaymentObject> {
  const reply = await harness('/pay', { invoiceId, status, ...extra })
  expect(reply.status).toBe(200)
  return (reply.body as unknown as { payment: PaymentObject }).payment
}

async function paidPayment(amount = 6900): Promise<{ invoice: InvoiceObject; payment: PaymentObject }> {
  const invoice = await newInvoice({ amount })
  return { invoice, payment: await pay(invoice.id, 'paid') }
}

async function getPayment(id: string): Promise<PaymentObject> {
  return (await moyasar('GET', `/payments/${id}`)).body as unknown as PaymentObject
}

async function getInvoice(id: string): Promise<InvoiceObject> {
  return (await moyasar('GET', `/invoices/${id}`)).body as unknown as InvoiceObject
}

const refund = (paymentId: string, body?: unknown): Promise<Answer> => moyasar('POST', `/payments/${paymentId}/refund`, body)

/** A plain node:http request, for the cases fetch will not make (a chosen Host or Origin header, a bodiless POST). */
function rawRequest(
  url: string,
  headers: Record<string, string>,
  body?: string,
  method = body === undefined ? 'GET' : 'POST',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

interface Received {
  path: string
  headers: IncomingHttpHeaders
  body: unknown
}

/** A local server standing in for the Edge Function that receives the webhook and the callback. */
async function startReceiver(): Promise<{ url: string; received: Received[]; close(): Promise<void> }> {
  const received: Received[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      received.push({ path: req.url ?? '', headers: req.headers, body: text === '' ? undefined : JSON.parse(text) })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

beforeAll(async () => {
  // No automatic delivery by default: an invoice's callback_url names the local stack's port.
  emulator = await startEmulator({ autoWebhook: false, autoCallback: false })
})

afterAll(async () => {
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the server', () => {
  it('listens on a free port when asked for port 0, on loopback', () => {
    expect(emulator.port).toBeGreaterThan(0)
    expect(emulator.url).toBe(`http://127.0.0.1:${emulator.port}`)
  })

  it('close() stops the server, is safe to repeat, and leaves nothing behind', async () => {
    const extra = await startEmulator()
    const url = extra.url
    await extra.close()
    await extra.close()
    await expect(fetch(`${url}/v1/invoices`, { headers: { authorization: AUTH } })).rejects.toThrow()
  })

  it('close() also ends a request that is being held by a timeout fault', async () => {
    const extra = await startEmulator()
    await fetch(`${extra.url}/__emulator/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'GET /v1/invoices', mode: 'timeout' }),
    })
    const held = fetch(`${extra.url}/v1/invoices`, { headers: { authorization: AUTH } })
    const outcome = held.then(
      () => 'answered',
      () => 'cut',
    )
    await vi.waitFor(() => expect(extra.state().calls).toHaveLength(1))
    await extra.close()
    expect(await outcome).toBe('cut')
  })

  it('refuses to start when SITE_URL names a hosted site', async () => {
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    await expect(startEmulator()).rejects.toThrow(/hosted site/)
    vi.stubEnv('SITE_URL', SITE)
    const local = await startEmulator()
    await local.close()
  })

  it('refuses a webhookUrl that is not a local host at start', async () => {
    await expect(startEmulator({ webhookUrl: 'https://example.com/hook' })).rejects.toThrow(/local/)
  })
})

describe('authentication', () => {
  it.each([
    ['no Authorization header', null],
    ['the wrong key', `Basic ${Buffer.from('sk_test_other:').toString('base64')}`],
    ['the key as a bearer token', `Bearer ${KEY}`],
    ['the key with a non-empty password', `Basic ${Buffer.from(`${KEY}:secret`).toString('base64')}`],
    ['the key with no colon', `Basic ${Buffer.from(KEY).toString('base64')}`],
  ])('answers 401 authentication_error for %s', async (_label, auth) => {
    const reply = await call('GET', '/v1/invoices', undefined, auth)
    expect(reply.status).toBe(401)
    expect(reply.body).toEqual(AUTH_ERROR)
  })

  it('answers 401 before 404, so an unknown route does not reveal itself without the key', async () => {
    expect((await call('GET', '/v1/nothing', undefined, null)).status).toBe(401)
    expect((await moyasar('GET', '/nothing')).status).toBe(404)
  })

  it('accepts the key as the Basic user name with an empty password (scheme case does not matter)', async () => {
    expect((await call('GET', '/v1/invoices')).status).toBe(200)
    const lower = `basic ${Buffer.from(`${KEY}:`).toString('base64')}`
    expect((await call('GET', '/v1/invoices', undefined, lower)).status).toBe(200)
  })

  it('takes the key it was started with', async () => {
    const other = await startEmulator({ secretKey: 'sk_test_another_key_for_this_run' })
    try {
      const withLocalKey = await fetch(`${other.url}/v1/invoices`, { headers: { authorization: AUTH } })
      expect(withLocalKey.status).toBe(401)
      const own = `Basic ${Buffer.from('sk_test_another_key_for_this_run:').toString('base64')}`
      expect((await fetch(`${other.url}/v1/invoices`, { headers: { authorization: own } })).status).toBe(200)
    } finally {
      await other.close()
    }
  })
})

describe('POST /v1/invoices', () => {
  it('creates an invoice with every documented field and answers 201', async () => {
    const sent = invoiceBody()
    const reply = await moyasar('POST', '/invoices', sent)
    expect(reply.status).toBe(201)
    const invoice = reply.body as unknown as InvoiceObject
    expect(Object.keys(invoice).sort()).toEqual(INVOICE_KEYS)
    expect(invoice).toMatchObject({
      status: 'initiated',
      amount: 6900,
      currency: 'SAR',
      description: 'طلب ABCD2345',
      logo_url: null,
      amount_format: '69.00 SAR',
      callback_url: sent.callback_url,
      success_url: sent.success_url,
      back_url: sent.back_url,
      expired_at: sent.expired_at,
      metadata: sent.metadata,
      payments: [],
    })
    expect(invoice.id).toMatch(UUID_SHAPE)
    expect(invoice.url).toBe(`${emulator.url}/invoices/${invoice.id}`)
    expect(Number.isNaN(Date.parse(invoice.created_at))).toBe(false)
    expect(invoice.updated_at).toBe(invoice.created_at)
  })

  it('needs only amount, currency and description; the rest is null or empty', async () => {
    const reply = await moyasar('POST', '/invoices', { amount: 100, currency: 'SAR', description: 'x' })
    expect(reply.status).toBe(201)
    expect(reply.body).toMatchObject({ callback_url: null, success_url: null, back_url: null, expired_at: null, metadata: {} })
  })

  it('builds every url on publicBase, never on the Host header', async () => {
    const viaHost = await rawRequest(
      `${emulator.url}/v1/invoices`,
      { authorization: AUTH, 'content-type': 'application/json', host: 'host.docker.internal:54390' },
      JSON.stringify(invoiceBody()),
    )
    expect(viaHost.status).toBe(201)
    expect((JSON.parse(viaHost.body) as InvoiceObject).url).toMatch(new RegExp(`^${emulator.url}/invoices/`))

    // The stand-in page answers only under a local host name, so a base elsewhere is refused at start.
    await expect(startEmulator({ publicBase: 'http://browser.example.test:8080/' })).rejects.toThrow('publicBase must be a local http(s) URL.')
    const other = await startEmulator({ publicBase: 'http://localhost:8080/' })
    try {
      const reply = await fetch(`${other.url}/v1/invoices`, {
        method: 'POST',
        headers: { authorization: AUTH, 'content-type': 'application/json' },
        body: JSON.stringify(invoiceBody()),
      })
      const invoice = (await reply.json()) as InvoiceObject
      expect(invoice.url).toBe(`http://localhost:8080/invoices/${invoice.id}`)
    } finally {
      await other.close()
    }
  })

  const manyKeys = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`k${index}`, 'v']))
  it.each<[string, Json, string]>([
    ['no amount', { amount: undefined }, 'amount'],
    ['an amount under 100', { amount: 99 }, 'amount'],
    ['a fractional amount', { amount: 100.5 }, 'amount'],
    ['an amount sent as a string', { amount: '6900' }, 'amount'],
    ['no currency', { currency: undefined }, 'currency'],
    ['no description', { description: '' }, 'description'],
    ['a callback_url off the machine', { callback_url: 'https://evil.example/hook' }, 'callback_url'],
    ['a success_url off the machine', { success_url: 'https://evil.example/' }, 'success_url'],
    ['a back_url off the machine', { back_url: 'https://evil.example/' }, 'back_url'],
    ['a callback_url that is no URL', { callback_url: 'not a url' }, 'callback_url'],
    ['an expired_at that is not ISO 8601', { expired_at: 'tomorrow' }, 'expired_at'],
    ['a metadata value that is a number', { metadata: { a: 1 } }, 'metadata'],
    ['a metadata key of 41 characters', { metadata: { ['k'.repeat(41)]: 'v' } }, 'metadata'],
    ['a metadata value of 501 characters', { metadata: { a: 'v'.repeat(501) } }, 'metadata'],
    ['31 metadata keys', { metadata: manyKeys }, 'metadata'],
    ['metadata that is a list', { metadata: ['a'] }, 'metadata'],
  ])('refuses %s with the documented 400 body naming the field', async (_label, overrides, field) => {
    const reply = await moyasar('POST', '/invoices', invoiceBody(overrides))
    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ type: 'invalid_request_error', message: 'Validation Failed' })
    const errors = reply.body.errors as Record<string, string[]>
    expect(Object.keys(errors)).toEqual([field])
    expect(errors[field]).toEqual([expect.any(String)])
    expect(emulator.state().invoices).toHaveLength(0)
  })

  it('names every bad field at once, as a map of field to a list of strings', async () => {
    const reply = await moyasar('POST', '/invoices', { description: 'x' })
    expect(reply.status).toBe(400)
    expect(reply.body.errors).toEqual({ amount: [expect.any(String)], currency: [expect.any(String)] })
  })

  it.each([
    ['text that is not JSON', '{nope'],
    ['a JSON list', '[1]'],
    ['an empty body', ''],
  ])('refuses %s with 400', async (_label, text) => {
    const response = await fetch(`${emulator.url}/v1/invoices`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: text === '' ? undefined : text,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ type: 'invalid_request_error', message: 'Validation Failed' })
  })

  it('accepts a callback_url and a success_url on every local host', async () => {
    for (const host of ['localhost:3000', '127.0.0.1:54321', '[::1]:3000', 'host.docker.internal:54321']) {
      const reply = await moyasar('POST', '/invoices', invoiceBody({ callback_url: `http://${host}/cb`, success_url: `http://${host}/ok` }))
      expect(reply.status, host).toBe(201)
    }
  })
})

describe('GET /v1/invoices/:id', () => {
  it('returns the invoice, and 404 record_not_found for an unknown or malformed id', async () => {
    const created = await newInvoice()
    const found = await moyasar('GET', `/invoices/${created.id}`)
    expect(found.status).toBe(200)
    expect(found.body).toEqual(created)
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const missing = await moyasar('GET', `/invoices/${id}`)
      expect(missing.status).toBe(404)
      expect(missing.body).toMatchObject({ type: 'record_not_found', errors: null })
    }
  })
})

describe('GET /v1/invoices', () => {
  it('lists newest first with the documented meta, 40 to a page', async () => {
    const ids: string[] = []
    for (let index = 0; index < 45; index += 1) ids.push((await newInvoice({ description: `invoice ${index}` })).id)

    const first = await moyasar('GET', '/invoices')
    expect(first.status).toBe(200)
    expect(Object.keys(first.body).sort()).toEqual(['invoices', 'meta'])
    const page1 = first.body.invoices as InvoiceObject[]
    expect(page1).toHaveLength(40)
    expect(page1[0]?.id).toBe(ids[44])
    expect(first.body.meta).toEqual({ current_page: 1, next_page: 2, prev_page: null, total_pages: 2, total_count: 45 })

    const second = await moyasar('GET', '/invoices?page=2')
    expect((second.body.invoices as InvoiceObject[]).map((invoice) => invoice.id)).toEqual(ids.slice(0, 5).reverse())
    expect(second.body.meta).toEqual({ current_page: 2, next_page: null, prev_page: 1, total_pages: 2, total_count: 45 })

    const beyond = await moyasar('GET', '/invoices?page=3')
    expect(beyond.body.invoices).toEqual([])
    expect(beyond.body.meta).toEqual({ current_page: 3, next_page: null, prev_page: 2, total_pages: 2, total_count: 45 })
  })

  it('answers an empty list with total_pages 0', async () => {
    const reply = await moyasar('GET', '/invoices')
    expect(reply.body).toEqual({
      invoices: [],
      meta: { current_page: 1, next_page: null, prev_page: null, total_pages: 0, total_count: 0 },
    })
  })

  it.each(['0', '-1', 'abc', '1.5'])('refuses page=%s with 400', async (page) => {
    const reply = await moyasar('GET', `/invoices?page=${page}`)
    expect(reply.status).toBe(400)
    expect(reply.body.errors).toEqual({ page: [expect.any(String)] })
  })

  it('filters by id, status and metadata[key], alone or together', async () => {
    const attempt = randomUUID()
    const a = await newInvoice({ metadata: { attempt_id: attempt, order_number: 'AAAA2222' } })
    const b = await newInvoice({ metadata: { attempt_id: randomUUID(), order_number: 'BBBB3333' } })
    await moyasar('PUT', `/invoices/${b.id}/cancel`)

    const ids = async (query: string): Promise<string[]> =>
      ((await moyasar('GET', `/invoices?${query}`)).body.invoices as InvoiceObject[]).map((invoice) => invoice.id)
    expect(await ids(`id=${a.id}`)).toEqual([a.id])
    expect(await ids('status=canceled')).toEqual([b.id])
    expect(await ids('status=initiated')).toEqual([a.id])
    expect(await ids(`metadata[attempt_id]=${attempt}`)).toEqual([a.id])
    expect(await ids(`metadata%5Battempt_id%5D=${attempt}`)).toEqual([a.id])
    expect(await ids('metadata[attempt_id]=nothing')).toEqual([])
    expect(await ids(`metadata[attempt_id]=${attempt}&metadata[order_number]=BBBB3333`)).toEqual([])
    expect(await ids(`metadata[order_number]=BBBB3333&status=canceled`)).toEqual([b.id])
  })
})

describe('invoice expiry', () => {
  it('reports expired once expired_at has passed, in a fetch, a list and a status filter', async () => {
    const invoice = await newInvoice()
    expect((await getInvoice(invoice.id)).status).toBe('initiated')
    expect((await harness('/invoice', { invoiceId: invoice.id, expiredAt: new Date(Date.now() - 1_000).toISOString() })).status).toBe(200)
    expect((await getInvoice(invoice.id)).status).toBe('expired')
    const listed = (await moyasar('GET', '/invoices?status=expired')).body.invoices as InvoiceObject[]
    expect(listed.map((entry) => entry.id)).toEqual([invoice.id])
  })

  it('an invoice created already past its expiry is expired at once', async () => {
    const invoice = await newInvoice({ expired_at: new Date(Date.now() - 60_000).toISOString() })
    expect((await getInvoice(invoice.id)).status).toBe('expired')
  })

  it('a paid invoice does not expire', async () => {
    const { invoice } = await paidPayment()
    await harness('/invoice', { invoiceId: invoice.id, expiredAt: new Date(Date.now() - 1_000).toISOString() })
    expect((await getInvoice(invoice.id)).status).toBe('paid')
  })
})

describe('PUT /v1/invoices/:id/cancel', () => {
  it('cancels an initiated invoice, and a second cancel answers 200 again', async () => {
    const invoice = await newInvoice()
    const first = await moyasar('PUT', `/invoices/${invoice.id}/cancel`)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id: invoice.id, status: 'canceled' })
    expect((await getInvoice(invoice.id)).status).toBe('canceled')
    const second = await moyasar('PUT', `/invoices/${invoice.id}/cancel`)
    expect(second.status).toBe(200)
    expect(second.body.status).toBe('canceled')
  })

  it('refuses a paid invoice with 400 by default, and answers 200 with status paid under cancelPaidReturns200', async () => {
    const { invoice } = await paidPayment()
    const refused = await moyasar('PUT', `/invoices/${invoice.id}/cancel`)
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ type: 'invalid_request_error', message: 'Validation Failed' })
    expect((await getInvoice(invoice.id)).status).toBe('paid')

    emulator.config({ cancelPaidReturns200: true })
    const lenient = await moyasar('PUT', `/invoices/${invoice.id}/cancel`)
    expect(lenient.status).toBe(200)
    expect(lenient.body.status).toBe('paid')
  })

  it('refuses an expired invoice with 400', async () => {
    const invoice = await newInvoice({ expired_at: new Date(Date.now() - 60_000).toISOString() })
    expect((await moyasar('PUT', `/invoices/${invoice.id}/cancel`)).status).toBe(400)
    expect((await getInvoice(invoice.id)).status).toBe('expired')
  })

  it('answers 404 for an unknown or malformed id', async () => {
    for (const id of [randomUUID(), 'nope']) {
      const reply = await moyasar('PUT', `/invoices/${id}/cancel`)
      expect(reply.status).toBe(404)
      expect(reply.body).toMatchObject({ type: 'record_not_found' })
    }
  })
})

describe('payments', () => {
  it('a paid payment has every documented field and is nested in its invoice', async () => {
    const sent = invoiceBody({ amount: 6900 })
    const invoice = (await moyasar('POST', '/invoices', sent)).body as unknown as InvoiceObject
    const made = await pay(invoice.id, 'paid')
    const payment = await getPayment(made.id)

    expect(Object.keys(payment).sort()).toEqual(PAYMENT_KEYS)
    expect(Object.keys(payment.source).sort()).toEqual(SOURCE_KEYS)
    expect(payment).toMatchObject({
      status: 'paid',
      amount: 6900,
      currency: 'SAR',
      fee: 0,
      refunded: 0,
      refunded_at: null,
      captured: 0,
      captured_at: null,
      voided_at: null,
      description: 'طلب ABCD2345',
      amount_format: '69.00 SAR',
      fee_format: '0.00 SAR',
      refunded_format: '0.00 SAR',
      captured_format: '0.00 SAR',
      invoice_id: invoice.id,
      ip: null,
      callback_url: sent.callback_url,
      metadata: sent.metadata,
    })
    expect(payment.source).toMatchObject({ type: 'creditcard', company: 'mada', message: 'APPROVED', transaction_url: null })
    expect(payment.source.number).toMatch(/^\d{6}X+\d{4}$/)
    expect(payment.id).toMatch(UUID_SHAPE)

    const refreshed = await getInvoice(invoice.id)
    expect(refreshed.status).toBe('paid')
    expect(refreshed.payments).toEqual([payment])
  })

  it('every amount is an integer and every *_format a string', async () => {
    const { payment } = await paidPayment(10_005)
    for (const field of ['amount', 'fee', 'refunded', 'captured'] as const) expect(Number.isInteger(payment[field])).toBe(true)
    expect(payment.amount_format).toBe('100.05 SAR')
    for (const field of ['amount_format', 'fee_format', 'refunded_format', 'captured_format'] as const) expect(typeof payment[field]).toBe('string')
  })

  it('GET /v1/payments/:id answers 404 record_not_found for an unknown or malformed id', async () => {
    for (const id of [randomUUID(), 'nope']) {
      const reply = await moyasar('GET', `/payments/${id}`)
      expect(reply.status).toBe(404)
      expect(reply.body).toMatchObject({ type: 'record_not_found', errors: null })
    }
  })

  it('lists newest first with meta, filters by id, status and metadata, 40 to a page', async () => {
    const invoice = await newInvoice({ metadata: { order_number: 'AAAA2222' } })
    const other = await newInvoice({ metadata: { order_number: 'BBBB3333' } })
    const ids: string[] = []
    for (let index = 0; index < 41; index += 1) ids.push((await pay(invoice.id, index === 0 ? 'failed' : 'initiated')).id)
    const lone = await pay(other.id, 'paid')

    const first = await moyasar('GET', '/payments')
    expect(Object.keys(first.body).sort()).toEqual(['meta', 'payments'])
    expect(first.body.payments as PaymentObject[]).toHaveLength(40)
    expect((first.body.payments as PaymentObject[])[0]?.id).toBe(lone.id)
    expect(first.body.meta).toEqual({ current_page: 1, next_page: 2, prev_page: null, total_pages: 2, total_count: 42 })
    expect(((await moyasar('GET', '/payments?page=2')).body.payments as PaymentObject[]).map((payment) => payment.id)).toEqual([ids[1], ids[0]])

    const listed = async (query: string): Promise<string[]> =>
      ((await moyasar('GET', `/payments?${query}`)).body.payments as PaymentObject[]).map((payment) => payment.id)
    expect(await listed(`id=${lone.id}`)).toEqual([lone.id])
    expect(await listed('status=paid')).toEqual([lone.id])
    expect(await listed('status=failed')).toEqual([ids[0]])
    expect(await listed('metadata[order_number]=BBBB3333')).toEqual([lone.id])
    expect(await listed('metadata[order_number]=AAAA2222&status=failed')).toEqual([ids[0]])
    expect((await moyasar('GET', '/payments?page=0')).status).toBe(400)
  })

  it('the payments list is not affected by ignoreMetadataFilter (that switch is for invoices)', async () => {
    await paidPayment()
    emulator.config({ ignoreMetadataFilter: true })
    const reply = await moyasar('GET', '/payments?metadata[order_number]=nothing')
    expect(reply.body.payments).toEqual([])
  })
})

describe('POST /__emulator/pay (any documented status)', () => {
  it.each(['initiated', 'paid', 'authorized', 'failed', 'refunded', 'captured', 'voided', 'verified', 'expired'])(
    'creates a %s payment',
    async (status) => {
      const invoice = await newInvoice()
      const payment = await pay(invoice.id, status)
      expect(payment.status).toBe(status)
      expect(payment.refunded).toBe(status === 'refunded' ? 6900 : 0)
      expect(payment.captured).toBe(status === 'captured' ? 6900 : 0)
      expect(payment.voided_at === null).toBe(status !== 'voided')
      expect(payment.source.message).toBe(status === 'paid' ? 'APPROVED' : status === 'failed' ? 'INSUFFICIENT FUNDS' : null)
      // Only a paid payment pays the invoice.
      expect((await getInvoice(invoice.id)).status).toBe(status === 'paid' ? 'paid' : 'initiated')
    },
  )

  it('takes an amount and a currency of its own (a wrong-amount payment)', async () => {
    const invoice = await newInvoice({ amount: 6900 })
    const payment = await pay(invoice.id, 'paid', { amount: 100, currency: 'USD' })
    expect(payment).toMatchObject({ amount: 100, currency: 'USD', amount_format: '1.00 USD' })
    expect((await getInvoice(invoice.id)).amount).toBe(6900)
  })

  // The three ways an invoice is past paying; each setup returns one in that state.
  const unpayable: Array<[string, () => Promise<InvoiceObject>]> = [
    ['expired', () => newInvoice({ expired_at: new Date(Date.now() - 60_000).toISOString() })],
    [
      'canceled',
      async () => {
        const invoice = await newInvoice()
        await moyasar('PUT', `/invoices/${invoice.id}/cancel`)
        return invoice
      },
    ],
    [
      'paid',
      async () => {
        const invoice = await newInvoice()
        await pay(invoice.id, 'paid')
        return invoice
      },
    ],
  ]

  it.each(unpayable)('refuses a payment on an invoice that is %s unless force is true, and creates none', async (state, setup) => {
    const invoice = await setup()
    const before = emulator.state().payments.length
    for (const extra of [{}, { force: false }]) {
      const reply = await harness('/pay', { invoiceId: invoice.id, status: 'paid', ...extra })
      expect(reply.status, JSON.stringify(extra)).toBe(409)
      expect(reply.body).toEqual({ error: expect.stringContaining(state) })
    }
    expect(emulator.state().payments).toHaveLength(before)
    expect((await getInvoice(invoice.id)).status).toBe(state)
  })

  it.each(unpayable)('force: true pays an invoice that is %s, as a late or a second payment, and the invoice keeps its status', async (state, setup) => {
    const invoice = await setup()
    const before = (await getInvoice(invoice.id)).payments.length
    expect((await pay(invoice.id, 'paid', { force: true })).status).toBe('paid')
    const refreshed = await getInvoice(invoice.id)
    expect(refreshed.status).toBe(state)
    expect(refreshed.payments).toHaveLength(before + 1)
  })

  it('refuses a force that is not a boolean, and creates nothing', async () => {
    const invoice = await newInvoice()
    for (const force of ['true', 1, null]) {
      expect((await harness('/pay', { invoiceId: invoice.id, status: 'paid', force })).status, String(force)).toBe(400)
    }
    expect(emulator.state().payments).toHaveLength(0)
  })

  it('refuses an unknown invoice, a bad status, a bad amount and a bad currency', async () => {
    const invoice = await newInvoice()
    expect((await harness('/pay', { invoiceId: randomUUID(), status: 'paid' })).status).toBe(404)
    expect((await harness('/pay', { invoiceId: invoice.id, status: 'settled' })).status).toBe(400)
    expect((await harness('/pay', { invoiceId: invoice.id })).status).toBe(400)
    expect((await harness('/pay', { invoiceId: invoice.id, status: 'paid', amount: 0 })).status).toBe(400)
    expect((await harness('/pay', { invoiceId: invoice.id, status: 'paid', amount: 1.5 })).status).toBe(400)
    expect((await harness('/pay', { invoiceId: invoice.id, status: 'paid', currency: '' })).status).toBe(400)
    expect(emulator.state().payments).toHaveLength(0)
  })
})

describe('POST /v1/payments/:id/refund', () => {
  it('a partial refund makes the status refunded and holds the running total', async () => {
    const { payment } = await paidPayment(6900)
    const reply = await refund(payment.id, { amount: 1000 })
    expect(reply.status).toBe(200)
    expect(Object.keys(reply.body).sort()).toEqual(PAYMENT_KEYS)
    expect(reply.body).toMatchObject({ id: payment.id, status: 'refunded', refunded: 1000, refunded_format: '10.00 SAR', amount: 6900 })
    expect(Number.isNaN(Date.parse(reply.body.refunded_at as string))).toBe(false)
    expect((await getPayment(payment.id)).refunded).toBe(1000)
    // The body the client sent is what the call log shows.
    const logged = emulator.state().calls.find((entry) => entry.route === 'POST /v1/payments/:id/refund')
    expect(logged).toMatchObject({ method: 'POST', body: { amount: 1000 }, status: 200 })
  })

  it('a refund leaves the invoice as it was: its status after a refund is not documented (E02 open item 6)', async () => {
    const { invoice, payment } = await paidPayment(6900)
    await refund(payment.id, { amount: 1000 })
    expect((await getInvoice(invoice.id)).status).toBe('paid')
    await refund(payment.id, { amount: 5900 })
    const refreshed = await getInvoice(invoice.id)
    expect(refreshed.status).toBe('paid')
    expect(refreshed.payments[0]).toMatchObject({ status: 'refunded', refunded: 6900 })
    // A test that needs the other reading sets it.
    expect(((await harness('/invoice', { invoiceId: invoice.id, status: 'refunded' })).body.invoice as InvoiceObject).status).toBe('refunded')
  })

  it('a second refund is accepted by default and the total accumulates; the last unit is the limit', async () => {
    const { payment } = await paidPayment(6900)
    expect((await refund(payment.id, { amount: 1000 })).body.refunded).toBe(1000)
    expect((await refund(payment.id, { amount: 500 })).body.refunded).toBe(1500)
    expect((await refund(payment.id, { amount: 5400 })).body).toMatchObject({ refunded: 6900, status: 'refunded' })
    expect((await refund(payment.id, { amount: 1 })).status).toBe(400)
    expect((await getPayment(payment.id)).refunded).toBe(6900)
  })

  it('no amount (or an empty object) refunds the full amount', async () => {
    const first = await paidPayment(6900)
    expect((await refund(first.payment.id)).body).toMatchObject({ refunded: 6900, status: 'refunded' })
    const second = await paidPayment(2500)
    expect((await refund(second.payment.id, {})).body).toMatchObject({ refunded: 2500, status: 'refunded' })
  })

  it('refuses more than what is left with 400 and the documented sentence, and changes nothing', async () => {
    const { payment } = await paidPayment(6900)
    const over = await refund(payment.id, { amount: 6901 })
    expect(over.status).toBe(400)
    expect(over.body).toMatchObject({ type: 'invalid_request_error', message: 'Validation Failed' })
    expect(over.body.errors).toEqual({ amount: ['Refund amount cannot exceed the charged amount'] })
    await refund(payment.id, { amount: 6000 })
    expect((await refund(payment.id, { amount: 901 })).status).toBe(400)
    expect((await getPayment(payment.id)).refunded).toBe(6000)
  })

  it.each([
    ['zero', { amount: 0 }],
    ['negative', { amount: -5 }],
    ['fractional', { amount: 1.5 }],
    ['a string', { amount: '100' }],
  ])('refuses an amount that is %s with 400', async (_label, body) => {
    const { payment } = await paidPayment()
    const reply = await refund(payment.id, body)
    expect(reply.status).toBe(400)
    expect(reply.body.errors).toEqual({ amount: [expect.any(String)] })
    expect((await getPayment(payment.id)).refunded).toBe(0)
  })

  it('refunds a captured payment, and refuses a payment that was never charged', async () => {
    const invoice = await newInvoice()
    const captured = await pay(invoice.id, 'captured')
    expect((await refund(captured.id, { amount: 100 })).status).toBe(200)
    for (const status of ['initiated', 'authorized', 'failed', 'voided', 'verified', 'expired']) {
      const reply = await refund((await pay(invoice.id, status)).id, { amount: 100 })
      expect(reply.status, status).toBe(400)
    }
  })

  it('answers 404 for an unknown or malformed payment id', async () => {
    for (const id of [randomUUID(), 'nope']) {
      const reply = await refund(id, { amount: 100 })
      expect(reply.status).toBe(404)
      expect(reply.body).toMatchObject({ type: 'record_not_found' })
    }
  })

  it('refuseSecondRefund: a refund of a payment already refunded answers 400', async () => {
    emulator.config({ refuseSecondRefund: true })
    const { payment } = await paidPayment(6900)
    expect((await refund(payment.id, { amount: 1000 })).status).toBe(200)
    const second = await refund(payment.id, { amount: 500 })
    expect(second.status).toBe(400)
    expect(second.body.errors).toEqual({ status: [expect.any(String)] })
    expect((await getPayment(payment.id)).refunded).toBe(1000)
  })

  it('partialRefundKeepsPaid: a partial refund leaves the status paid; only the last unit makes it refunded', async () => {
    emulator.config({ partialRefundKeepsPaid: true })
    const { payment } = await paidPayment(6900)
    expect((await refund(payment.id, { amount: 1000 })).body).toMatchObject({ status: 'paid', refunded: 1000 })
    expect((await refund(payment.id, { amount: 5900 })).body).toMatchObject({ status: 'refunded', refunded: 6900 })
  })

  it('both switches together: a partial refund keeps paid, so a second partial refund is still accepted', async () => {
    emulator.config({ partialRefundKeepsPaid: true, refuseSecondRefund: true })
    const { payment } = await paidPayment(6900)
    expect((await refund(payment.id, { amount: 1000 })).body.status).toBe('paid')
    expect((await refund(payment.id, { amount: 1000 })).body).toMatchObject({ status: 'paid', refunded: 2000 })
    expect((await refund(payment.id, { amount: 4900 })).body).toMatchObject({ status: 'refunded', refunded: 6900 })
    expect((await refund(payment.id, { amount: 1 })).status).toBe(400)
  })

  it('refuses a body that is not an object', async () => {
    const { payment } = await paidPayment()
    expect((await refund(payment.id, [100])).status).toBe(400)
    expect((await refund(payment.id, 100)).status).toBe(400)
  })
})

describe('the config and the switches', () => {
  it('POST /__emulator/config returns the whole config; an empty patch changes nothing', async () => {
    const reply = await harness('/config', { dropExpiredAt: true, live: true })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      refuseSecondRefund: false,
      partialRefundKeepsPaid: false,
      dropInvoiceMetadata: false,
      ignoreMetadataFilter: false,
      cancelPaidReturns200: false,
      dropExpiredAt: true,
      webhookUrl: null,
      webhookSecret: LOCAL_WEBHOOK_SECRET,
      autoWebhook: false,
      autoCallback: false,
      live: true,
    })
    expect((await harness('/config', {})).body).toEqual(reply.body)
  })

  it.each<[string, Json]>([
    ['an unknown setting', { nope: true }],
    ['a switch that is not a boolean', { dropExpiredAt: 'yes' }],
    ['a webhookUrl that is not a local host', { webhookUrl: 'https://example.com/hook' }],
    ['a webhookUrl that is not a URL', { webhookUrl: 'nope' }],
    ['an empty webhookSecret', { webhookSecret: '' }],
  ])('refuses %s with 400 and applies none of the patch', async (_label, patch) => {
    const before = (await harness('/config', {})).body
    const reply = await harness('/config', { live: true, ...patch })
    expect(reply.status).toBe(400)
    expect(reply.body.error).toEqual(expect.any(String))
    expect((await harness('/config', {})).body).toEqual(before)
  })

  it('accepts a webhookUrl on every local host, and null to switch the webhook off', async () => {
    for (const host of ['localhost:3000', '127.0.0.1:54321', '[::1]:3000', 'host.docker.internal:54321']) {
      expect((await harness('/config', { webhookUrl: `http://${host}/hook` })).status, host).toBe(200)
    }
    expect((await harness('/config', { webhookUrl: null })).body.webhookUrl).toBeNull()
  })

  it('config(patch) merges and returns a copy, and throws on a bad value', () => {
    const merged = emulator.config({ live: true })
    expect(merged.live).toBe(true)
    merged.live = false
    expect(emulator.config().live).toBe(true)
    expect(() => emulator.config({ dropExpiredAt: 'x' as unknown as boolean })).toThrow(/boolean/)
  })

  it('dropInvoiceMetadata: the invoice keeps no metadata, so the metadata filter finds nothing', async () => {
    emulator.config({ dropInvoiceMetadata: true })
    const attempt = randomUUID()
    const invoice = await newInvoice({ metadata: { attempt_id: attempt } })
    expect(invoice.metadata).toEqual({})
    expect((await getInvoice(invoice.id)).metadata).toEqual({})
    expect((await moyasar('GET', `/invoices?metadata[attempt_id]=${attempt}`)).body.invoices).toEqual([])
  })

  it('ignoreMetadataFilter: the invoice list returns every invoice whatever the filter says', async () => {
    const attempt = randomUUID()
    await newInvoice({ metadata: { attempt_id: attempt } })
    await newInvoice()
    await newInvoice()
    const filtered = (await moyasar('GET', `/invoices?metadata[attempt_id]=${attempt}`)).body.invoices as InvoiceObject[]
    expect(filtered).toHaveLength(1)
    emulator.config({ ignoreMetadataFilter: true })
    const ignored = (await moyasar('GET', `/invoices?metadata[attempt_id]=${attempt}`)).body.invoices as InvoiceObject[]
    expect(ignored).toHaveLength(3)
  })

  it('dropExpiredAt: no reply carries expired_at, yet the invoice still expires', async () => {
    emulator.config({ dropExpiredAt: true })
    const created = await moyasar('POST', '/invoices', invoiceBody())
    expect('expired_at' in created.body).toBe(false)
    const id = created.body.id as string
    expect('expired_at' in (await getInvoice(id))).toBe(false)
    expect('expired_at' in ((await moyasar('GET', '/invoices')).body.invoices as InvoiceObject[])[0]!).toBe(false)
    await harness('/invoice', { invoiceId: id, expiredAt: new Date(Date.now() - 1_000).toISOString() })
    expect((await getInvoice(id)).status).toBe('expired')
    emulator.config({ dropExpiredAt: false })
    expect('expired_at' in (await getInvoice(id))).toBe(true)
  })

  it('startEmulator takes the switches as options, and reset() returns to them', async () => {
    const started = await startEmulator({ dropExpiredAt: true, webhookSecret: 'a-secret-of-this-run' })
    try {
      expect(started.config()).toMatchObject({ dropExpiredAt: true, webhookSecret: 'a-secret-of-this-run', live: false })
      started.config({ dropExpiredAt: false, live: true })
      started.reset()
      expect(started.config()).toMatchObject({ dropExpiredAt: true, webhookSecret: 'a-secret-of-this-run', live: false })
    } finally {
      await started.close()
    }
    emulator.config({ autoWebhook: true, live: true })
    emulator.reset()
    expect(emulator.config()).toMatchObject({ autoWebhook: false, live: false })
  })
})

describe('faults', () => {
  const fault = (route: string, mode: string, extra: Json = {}): Promise<Answer> => harness('/fault', { route, mode, ...extra })
  const postInvoice = (): Promise<Response> =>
    fetch(`${emulator.url}/v1/invoices`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify(invoiceBody()),
    })

  it.each<[string, Json]>([
    ['an unknown route', { route: 'POST /v1/nothing', mode: '500' }],
    ['a route with no method', { route: '/v1/invoices', mode: '500' }],
    ['an unknown mode', { route: 'POST /v1/invoices', mode: 'explode' }],
    ['times 0', { route: 'POST /v1/invoices', mode: '500', times: 0 }],
    ['a fractional delay', { route: 'POST /v1/invoices', mode: 'commit_after_delay', delayMs: 1.5 }],
    ['a negative delay', { route: 'POST /v1/invoices', mode: 'commit_after_delay', delayMs: -1 }],
  ])('refuses %s with 400', async (_label, body) => {
    expect((await harness('/fault', body)).status).toBe(400)
    expect(emulator.state().faults).toEqual([])
  })

  it('500 answers an api_error and changes nothing, once; the next call works', async () => {
    await fault('POST /v1/invoices', '500')
    const failed = await postInvoice()
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ type: 'api_error' })
    expect(emulator.state().invoices).toHaveLength(0)
    expect((await postInvoice()).status).toBe(201)
    expect(emulator.state().calls.map((entry) => [entry.status, entry.fault])).toEqual([
      [500, '500'],
      [201, null],
    ])
  })

  it('429 answers a rate_limit_error and changes nothing', async () => {
    await fault('POST /v1/invoices', '429')
    const limited = await postInvoice()
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ type: 'rate_limit_error' })
    expect(emulator.state().invoices).toHaveLength(0)
  })

  it('times counts the calls it affects, and only on the named route', async () => {
    await fault('POST /v1/invoices', '500', { times: 2 })
    expect((await postInvoice()).status).toBe(500)
    expect((await moyasar('GET', '/invoices')).status).toBe(200)
    expect((await postInvoice()).status).toBe(500)
    expect((await postInvoice()).status).toBe(201)
    expect(emulator.state().faults).toEqual([])
  })

  it('an unauthorised call does not use a fault up', async () => {
    await fault('GET /v1/invoices', '500')
    expect((await call('GET', '/v1/invoices', undefined, null)).status).toBe(401)
    expect(emulator.state().faults).toHaveLength(1)
    expect((await moyasar('GET', '/invoices')).status).toBe(500)
  })

  it('drop_after_commit makes the change and cuts the connection before the reply', async () => {
    await fault('POST /v1/invoices', 'drop_after_commit')
    await expect(postInvoice()).rejects.toThrow()
    expect(emulator.state().invoices).toHaveLength(1)
    expect(emulator.state().calls.at(-1)).toMatchObject({ route: 'POST /v1/invoices', status: null, fault: 'drop_after_commit' })
  })

  it('drop_after_commit on a refund applies it', async () => {
    const { payment } = await paidPayment(6900)
    await fault('POST /v1/payments/:id/refund', 'drop_after_commit')
    await expect(refund(payment.id, { amount: 2000 })).rejects.toThrow()
    expect((await getPayment(payment.id)).refunded).toBe(2000)
  })

  it('commit_after_delay cuts the connection at once and makes the change delayMs later', async () => {
    // A second is far above any scheduling delay, so "not made yet" cannot fail on a loaded machine.
    await fault('POST /v1/invoices', 'commit_after_delay', { delayMs: 1_000 })
    await expect(postInvoice()).rejects.toThrow()
    expect(emulator.state().invoices).toHaveLength(0)
    await vi.waitFor(() => expect(emulator.state().invoices).toHaveLength(1), { timeout: 3_000 })
    expect(emulator.state().calls.at(-1)).toMatchObject({ status: null, fault: 'commit_after_delay' })
  })

  it('reset() cancels a commit that is still pending', async () => {
    await fault('POST /v1/invoices', 'commit_after_delay', { delayMs: 150 })
    await expect(postInvoice()).rejects.toThrow()
    emulator.reset()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(emulator.state().invoices).toHaveLength(0)
  })

  it('timeout never answers; the call is recorded and the client gives up on its own timer', async () => {
    const invoice = await newInvoice()
    await fault('GET /v1/invoices/:id', 'timeout')
    await expect(
      fetch(`${emulator.url}/v1/invoices/${invoice.id}`, { headers: { authorization: AUTH }, signal: AbortSignal.timeout(200) }),
    ).rejects.toThrow()
    expect(emulator.state().calls.at(-1)).toMatchObject({ route: 'GET /v1/invoices/:id', status: null, fault: 'timeout' })
    expect((await moyasar('GET', `/invoices/${invoice.id}`)).status).toBe(200)
  })

  it('timeout on a write makes no change', async () => {
    await fault('POST /v1/invoices', 'timeout')
    await expect(
      fetch(`${emulator.url}/v1/invoices`, {
        method: 'POST',
        headers: { authorization: AUTH, 'content-type': 'application/json' },
        body: JSON.stringify(invoiceBody()),
        signal: AbortSignal.timeout(200),
      }),
    ).rejects.toThrow()
    expect(emulator.state().invoices).toHaveLength(0)
  })

  it('faults can sit on every Moyasar route', async () => {
    const routes = [
      'POST /v1/invoices',
      'GET /v1/invoices',
      'GET /v1/invoices/:id',
      'PUT /v1/invoices/:id/cancel',
      'GET /v1/payments',
      'GET /v1/payments/:id',
      'POST /v1/payments/:id/refund',
    ]
    for (const route of routes) expect((await fault(route, '429')).status, route).toBe(200)
    expect(emulator.state().faults.map((entry) => entry.route)).toEqual(routes)
  })
})

describe('webhooks and the invoice callback', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>

  beforeAll(async () => {
    receiver = await startReceiver()
  })
  afterAll(async () => {
    await receiver.close()
  })
  beforeEach(() => {
    receiver.received.length = 0
    emulator.config({ webhookUrl: `${receiver.url}/webhook`, webhookSecret: 'webhook-secret-of-this-test', autoWebhook: true, autoCallback: true })
  })

  const payableInvoice = (overrides: Json = {}): Promise<InvoiceObject> => newInvoice({ callback_url: `${receiver.url}/callback`, ...overrides })
  // Never `paidPayment()` here: its invoice names the local stack as the callback target.
  const paid = async (amount = 6900): Promise<{ invoice: InvoiceObject; payment: PaymentObject }> => {
    const invoice = await payableInvoice({ amount })
    return { invoice, payment: await pay(invoice.id, 'paid') }
  }

  it('a paid payment sends the documented webhook and then the callback, before the call answers', async () => {
    const invoice = await payableInvoice()
    const reply = await harness('/pay', { invoiceId: invoice.id, status: 'paid' })
    const payment = (reply.body as unknown as { payment: PaymentObject }).payment

    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook', '/callback'])
    const [webhook, callback] = receiver.received
    expect(webhook?.headers['content-type']).toBe('application/json')
    expect(Object.keys(webhook?.body as Json).sort()).toEqual(['account_name', 'created_at', 'data', 'id', 'live', 'secret_token', 'type'])
    expect(webhook?.body).toMatchObject({ type: 'payment_paid', secret_token: 'webhook-secret-of-this-test', live: false, data: payment })
    expect((webhook?.body as { id: string }).id).toMatch(UUID_SHAPE)
    expect(Number.isNaN(Date.parse((webhook?.body as { created_at: string }).created_at))).toBe(false)
    expect(typeof (webhook?.body as { account_name: unknown }).account_name).toBe('string')

    // The callback is the invoice object and carries no secret_token (documented: it is unauthenticated).
    expect(Object.keys(callback?.body as Json).sort()).toEqual(INVOICE_KEYS)
    expect(callback?.body).toMatchObject({ id: invoice.id, status: 'paid', payments: [payment] })
    expect(callback?.body).not.toHaveProperty('secret_token')

    const deliveries = (reply.body as unknown as { deliveries: Array<{ kind: string; status: number }> }).deliveries
    expect(deliveries.map((entry) => [entry.kind, entry.status])).toEqual([
      ['webhook', 200],
      ['callback', 200],
    ])
    expect(emulator.state().deliveries).toHaveLength(2)
  })

  it('a failed payment sends payment_failed, no callback, and leaves the invoice payable', async () => {
    const invoice = await payableInvoice()
    await pay(invoice.id, 'failed')
    expect(receiver.received.map((entry) => [entry.path, (entry.body as { type?: string }).type])).toEqual([['/webhook', 'payment_failed']])
    expect((await getInvoice(invoice.id)).status).toBe('initiated')
  })

  it.each([
    ['paid', 'payment_paid'],
    ['failed', 'payment_failed'],
    ['refunded', 'payment_refunded'],
    ['voided', 'payment_voided'],
    ['authorized', 'payment_authorized'],
    ['captured', 'payment_captured'],
    ['verified', 'payment_verified'],
  ])('a %s payment sends the event %s', async (status, type) => {
    const invoice = await payableInvoice()
    await pay(invoice.id, status)
    expect((receiver.received[0]?.body as { type: string }).type).toBe(type)
  })

  it.each(['initiated', 'expired'])('a %s payment sends no webhook', async (status) => {
    const invoice = await payableInvoice()
    await pay(invoice.id, status)
    expect(receiver.received).toEqual([])
  })

  it('a second paid payment on an invoice that is already paid sends a webhook but no second callback', async () => {
    const invoice = await payableInvoice()
    await pay(invoice.id, 'paid')
    receiver.received.length = 0
    await pay(invoice.id, 'paid', { force: true })
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook'])
  })

  it('a payment refused for the invoice state sends nothing; a forced late one sends the webhook and no callback', async () => {
    const invoice = await payableInvoice({ expired_at: new Date(Date.now() - 60_000).toISOString() })
    expect((await harness('/pay', { invoiceId: invoice.id, status: 'paid' })).status).toBe(409)
    expect(receiver.received).toEqual([])
    expect(emulator.state().deliveries).toEqual([])
    await pay(invoice.id, 'paid', { force: true })
    // The invoice never became paid, so there is no callback.
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook'])
    expect((await getInvoice(invoice.id)).status).toBe('expired')
  })

  it('autoWebhook and autoCallback switch each delivery off on its own', async () => {
    emulator.config({ autoWebhook: false })
    await pay((await payableInvoice()).id, 'paid')
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/callback'])
    receiver.received.length = 0
    emulator.config({ autoWebhook: true, autoCallback: false })
    await pay((await payableInvoice()).id, 'paid')
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook'])
  })

  it('no webhookUrl sends no webhook; an invoice with no callback_url gets no callback', async () => {
    emulator.config({ webhookUrl: null })
    await pay((await payableInvoice()).id, 'paid')
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/callback'])
    receiver.received.length = 0
    emulator.config({ webhookUrl: `${receiver.url}/webhook` })
    await pay((await newInvoice({ callback_url: undefined })).id, 'paid')
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook'])
  })

  it('live and webhookSecret are what the webhook carries', async () => {
    emulator.config({ live: true, webhookSecret: 'another-secret' })
    await pay((await payableInvoice()).id, 'paid')
    expect(receiver.received[0]?.body).toMatchObject({ live: true, secret_token: 'another-secret' })
  })

  it('an unreachable receiver is recorded as a failed delivery and never breaks the call', async () => {
    const closed = await startReceiver()
    const gone = closed.url
    await closed.close()
    emulator.config({ webhookUrl: `${gone}/webhook`, autoCallback: false })
    const invoice = await payableInvoice()
    const reply = await harness('/pay', { invoiceId: invoice.id, status: 'paid' })
    expect(reply.status).toBe(200)
    expect(emulator.state().deliveries).toEqual([
      { kind: 'webhook', url: `${gone}/webhook`, type: 'payment_paid', eventId: expect.any(String), status: null, error: 'unreachable' },
    ])
  })

  describe('POST /__emulator/webhook', () => {
    it('sends the event for a payment the emulator holds, with that payment as data', async () => {
      const { payment } = await paid()
      receiver.received.length = 0
      const reply = await harness('/webhook', { paymentId: payment.id, type: 'payment_paid' })
      expect(reply.status).toBe(200)
      expect(receiver.received).toHaveLength(1)
      expect(receiver.received[0]?.body).toMatchObject({
        id: reply.body.eventId,
        type: 'payment_paid',
        secret_token: 'webhook-secret-of-this-test',
        live: false,
        data: payment,
      })
    })

    it('sends a payment the emulator does not hold as just its id, and no data id when none is named', async () => {
      const unknown = randomUUID()
      await harness('/webhook', { paymentId: unknown, type: 'payment_paid' })
      await harness('/webhook', { paymentId: 'not-a-uuid', type: 'payment_paid' })
      await harness('/webhook', { type: 'payment_paid' })
      expect(receiver.received.map((entry) => (entry.body as { data: unknown }).data)).toEqual([{ id: unknown }, { id: 'not-a-uuid' }, {}])
    })

    it('takes the secret token, live flag and event id as given, and an event type as it is spelled', async () => {
      await harness('/webhook', { type: 'payment_faild', secretToken: 'wrong', live: true, eventId: 'evt-1' })
      expect(receiver.received[0]?.body).toMatchObject({ id: 'evt-1', type: 'payment_faild', secret_token: 'wrong', live: true })
    })

    it('times repeats the same event, same id, one after the other', async () => {
      const reply = await harness('/webhook', { type: 'payment_paid', eventId: 'evt-2', times: 3 })
      expect(receiver.received).toHaveLength(3)
      expect(new Set(receiver.received.map((entry) => (entry.body as { id: string }).id))).toEqual(new Set(['evt-2']))
      expect((reply.body.deliveries as unknown[]).length).toBe(3)
    })

    it.each<[string, Json]>([
      ['no type', {}],
      ['an empty type', { type: '' }],
      ['times 0', { type: 'payment_paid', times: 0 }],
      ['times 21', { type: 'payment_paid', times: 21 }],
      ['a live flag that is not a boolean', { type: 'payment_paid', live: 'true' }],
      ['an event id that is empty', { type: 'payment_paid', eventId: '' }],
      ['a secret token that is a number', { type: 'payment_paid', secretToken: 1 }],
    ])('refuses %s with 400 and sends nothing', async (_label, body) => {
      expect((await harness('/webhook', body)).status).toBe(400)
      expect(receiver.received).toEqual([])
    })

    it('refuses when no webhookUrl is configured', async () => {
      emulator.config({ webhookUrl: null })
      const reply = await harness('/webhook', { type: 'payment_paid' })
      expect(reply.status).toBe(400)
      expect(reply.body.error).toMatch(/webhookUrl/)
    })
  })

  describe('POST /__emulator/payment and /__emulator/invoice (what the dashboard does)', () => {
    it('a dashboard refund sets the running total and the status, and sends no webhook of its own', async () => {
      const { invoice, payment } = await paid(6900)
      receiver.received.length = 0
      const reply = await harness('/payment', { paymentId: payment.id, refunded: 500 })
      expect(reply.status).toBe(200)
      expect((reply.body.payment as PaymentObject)).toMatchObject({ refunded: 500, status: 'refunded' })
      expect((await getInvoice(invoice.id)).status).toBe('paid')
      expect(receiver.received).toEqual([])
    })

    it('under partialRefundKeepsPaid a partial dashboard refund keeps paid, a full one does not', async () => {
      emulator.config({ partialRefundKeepsPaid: true })
      const { payment } = await paid(6900)
      expect(((await harness('/payment', { paymentId: payment.id, refunded: 500 })).body.payment as PaymentObject).status).toBe('paid')
      expect(((await harness('/payment', { paymentId: payment.id, refunded: 6900 })).body.payment as PaymentObject).status).toBe('refunded')
    })

    it('a dashboard void sets the status and voided_at; the total can also be set down', async () => {
      const { payment } = await paid(6900)
      const voided = (await harness('/payment', { paymentId: payment.id, status: 'voided' })).body.payment as PaymentObject
      expect(voided.status).toBe('voided')
      expect(Number.isNaN(Date.parse(voided.voided_at as string))).toBe(false)
      const lowered = (await harness('/payment', { paymentId: payment.id, refunded: 0 })).body.payment as PaymentObject
      expect(lowered).toMatchObject({ refunded: 0, refunded_at: null })
    })

    it('sets an explicit status and total together, as given', async () => {
      const { payment } = await paid(6900)
      const set = (await harness('/payment', { paymentId: payment.id, status: 'paid', refunded: 100 })).body.payment as PaymentObject
      expect(set).toMatchObject({ status: 'paid', refunded: 100 })
    })

    it.each<[string, Json, number]>([
      ['an unknown payment', { paymentId: randomUUID(), status: 'voided' }, 404],
      ['a status that is not documented', { status: 'settled' }, 400],
      ['a total above the payment amount', { refunded: 6901 }, 400],
      ['a negative total', { refunded: -1 }, 400],
      ['a fractional total', { refunded: 1.5 }, 400],
    ])('refuses %s', async (_label, body, status) => {
      const { payment } = await paid(6900)
      const reply = await harness('/payment', { paymentId: payment.id, ...body })
      expect(reply.status).toBe(status)
      expect(await getPayment(payment.id)).toMatchObject({ status: 'paid', refunded: 0 })
    })

    it('/__emulator/invoice sets the status and the expiry, and sends nothing', async () => {
      const invoice = await payableInvoice()
      const set = (await harness('/invoice', { invoiceId: invoice.id, status: 'on_hold' })).body.invoice as InvoiceObject
      expect(set.status).toBe('on_hold')
      const cleared = (await harness('/invoice', { invoiceId: invoice.id, status: 'initiated', expiredAt: null })).body.invoice as InvoiceObject
      expect(cleared).toMatchObject({ status: 'initiated', expired_at: null })
      expect(receiver.received).toEqual([])
    })

    it.each<[string, Json, number]>([
      ['an unknown invoice', { invoiceId: randomUUID() }, 404],
      ['a status that is not documented', { status: 'settled' }, 400],
      ['an expiry that is not ISO 8601', { expiredAt: 'soon' }, 400],
    ])('/__emulator/invoice refuses %s', async (_label, body, status) => {
      const invoice = await payableInvoice()
      expect((await harness('/invoice', { invoiceId: invoice.id, ...body })).status).toBe(status)
    })
  })
})

describe('the stand-in page', () => {
  let receiver: Awaited<ReturnType<typeof startReceiver>>

  beforeAll(async () => {
    receiver = await startReceiver()
  })
  afterAll(async () => {
    await receiver.close()
  })
  beforeEach(() => {
    receiver.received.length = 0
    emulator.config({ webhookUrl: `${receiver.url}/webhook`, autoWebhook: true, autoCallback: true })
  })

  const pageInvoice = (overrides: Json = {}): Promise<InvoiceObject> => newInvoice({ callback_url: `${receiver.url}/callback`, ...overrides })
  const page = (path: string): Promise<Response> => fetch(`${emulator.url}${path}`)
  const act = (id: string, fields: Record<string, string>): Promise<Response> =>
    fetch(`${emulator.url}/invoices/${id}/action`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    })

  it('GET /invoices/:id is an Arabic right-to-left page, clearly labelled, with the four buttons', async () => {
    const invoice = await pageInvoice()
    const response = await page(`/invoices/${invoice.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const markup = await response.text()
    expect(markup).toContain('lang="ar"')
    expect(markup).toContain('dir="rtl"')
    expect(markup).toContain('محاكي الدفع المحلي: لا يُخصم أي مبلغ')
    expect(markup).toContain('69.00 SAR')
    for (const action of ['pay', 'fail', '3ds', 'back']) expect(markup).toContain(`name="action" value="${action}"`)
    // The page is not Moyasar's API: no key is asked for.
    expect(markup).not.toContain(KEY)
  })

  it('escapes what an invoice says about itself', async () => {
    const invoice = await pageInvoice({ description: '<script>alert(1)</script>' })
    const markup = await (await page(`/invoices/${invoice.id}`)).text()
    expect(markup).not.toContain('<script>alert(1)')
    expect(markup).toContain('&lt;script&gt;')
  })

  it('pay: a paid payment, the webhook and the callback, then a redirect to success_url', async () => {
    const invoice = await pageInvoice()
    const response = await act(invoice.id, { action: 'pay' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(invoice.success_url)
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook', '/callback'])
    const refreshed = await getInvoice(invoice.id)
    expect(refreshed.status).toBe('paid')
    expect(refreshed.payments).toHaveLength(1)
    expect(refreshed.payments[0]).toMatchObject({ status: 'paid', amount: 6900, source: { message: 'APPROVED' } })
  })

  it('fail: a failed payment and its webhook, the page stays and the invoice can still be paid', async () => {
    const invoice = await pageInvoice()
    const response = await act(invoice.id, { action: 'fail' })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('فشل الدفع')
    expect(receiver.received.map((entry) => (entry.body as { type?: string }).type)).toEqual(['payment_failed'])
    expect(await getInvoice(invoice.id)).toMatchObject({ status: 'initiated', payments: [{ status: 'failed' }] })
    expect((await act(invoice.id, { action: 'pay' })).status).toBe(303)
    expect((await getInvoice(invoice.id)).payments.map((payment) => payment.status)).toEqual(['failed', 'paid'])
  })

  it('3-D Secure: an initiated payment first, then approve pays and reject fails', async () => {
    const invoice = await pageInvoice()
    const started = await act(invoice.id, { action: '3ds' })
    expect(started.status).toBe(303)
    const location = started.headers.get('location') as string
    const pending = (await getInvoice(invoice.id)).payments[0] as PaymentObject
    expect(location).toBe(`/invoices/${invoice.id}?payment=${pending.id}`)
    expect(pending.status).toBe('initiated')
    expect(pending.source.transaction_url).toBe(`${emulator.url}${location}`)
    expect(receiver.received).toEqual([])

    const challenge = await (await page(location)).text()
    expect(challenge).toContain('محاكي الدفع المحلي: لا يُخصم أي مبلغ')
    expect(challenge).toContain('name="action" value="approve"')
    expect(challenge).toContain('name="action" value="reject"')

    const approved = await act(invoice.id, { action: 'approve', payment: pending.id })
    expect(approved.status).toBe(303)
    expect(approved.headers.get('location')).toBe(invoice.success_url)
    expect(await getPayment(pending.id)).toMatchObject({ status: 'paid', source: { message: 'APPROVED' } })
    expect((await getInvoice(invoice.id)).status).toBe('paid')
    expect(receiver.received.map((entry) => entry.path)).toEqual(['/webhook', '/callback'])

    const second = await pageInvoice()
    await act(second.id, { action: '3ds' })
    const waiting = (await getInvoice(second.id)).payments[0] as PaymentObject
    const rejected = await act(second.id, { action: 'reject', payment: waiting.id })
    expect(rejected.status).toBe(200)
    expect(await getPayment(waiting.id)).toMatchObject({ status: 'failed' })
    expect((await getInvoice(second.id)).status).toBe('initiated')
  })

  it('refuses to approve a payment that is not waiting, or one of another invoice', async () => {
    const invoice = await pageInvoice()
    const other = await pageInvoice()
    await act(other.id, { action: '3ds' })
    const foreign = (await getInvoice(other.id)).payments[0] as PaymentObject
    expect((await act(invoice.id, { action: 'approve', payment: foreign.id })).status).toBe(400)
    expect((await act(invoice.id, { action: 'approve', payment: randomUUID() })).status).toBe(400)
    expect((await act(invoice.id, { action: 'approve' })).status).toBe(400)
    expect((await act(other.id, { action: 'approve', payment: foreign.id })).status).toBe(303)
    expect((await act(other.id, { action: 'approve', payment: foreign.id })).status).toBe(409)
  })

  it('back: a redirect to back_url, also from a paid invoice', async () => {
    const invoice = await pageInvoice()
    const response = await act(invoice.id, { action: 'back' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(invoice.back_url)
    await act(invoice.id, { action: 'pay' })
    expect((await act(invoice.id, { action: 'back' })).headers.get('location')).toBe(invoice.back_url)
  })

  it('with no success_url or back_url the page says so instead of redirecting', async () => {
    const invoice = await pageInvoice({ success_url: undefined, back_url: undefined })
    const back = await act(invoice.id, { action: 'back' })
    expect(back.status).toBe(200)
    const paid = await act(invoice.id, { action: 'pay' })
    expect(paid.status).toBe(200)
    expect((await getInvoice(invoice.id)).status).toBe('paid')
  })

  it.each([
    ['expired', async (id: string) => harness('/invoice', { invoiceId: id, expiredAt: new Date(Date.now() - 1_000).toISOString() })],
    ['canceled', async (id: string) => moyasar('PUT', `/invoices/${id}/cancel`)],
  ])('refuses every payment step of an invoice that is %s, and creates no payment', async (state, setup) => {
    const invoice = await pageInvoice()
    await setup(invoice.id)
    const markup = await (await page(`/invoices/${invoice.id}`)).text()
    expect(markup).not.toContain('value="pay"')
    expect(markup).not.toContain('value="fail"')
    expect(markup).not.toContain('value="3ds"')
    expect(markup).toContain('value="back"')
    for (const action of ['pay', 'fail', '3ds']) expect((await act(invoice.id, { action })).status, `${state} ${action}`).toBe(409)
    expect((await getInvoice(invoice.id)).payments).toEqual([])
    expect(receiver.received).toEqual([])
  })

  it('a paid invoice refuses a second payment', async () => {
    const invoice = await pageInvoice()
    await act(invoice.id, { action: 'pay' })
    expect((await act(invoice.id, { action: 'pay' })).status).toBe(409)
    expect((await getInvoice(invoice.id)).payments).toHaveLength(1)
  })

  it('answers 404 for an unknown invoice and 400 for an unknown action', async () => {
    expect((await page(`/invoices/${randomUUID()}`)).status).toBe(404)
    expect((await act(randomUUID(), { action: 'pay' })).status).toBe(404)
    const invoice = await pageInvoice()
    expect((await act(invoice.id, { action: 'steal' })).status).toBe(400)
    expect((await page(`/invoices/${invoice.id}/action`)).status).toBe(405)
  })

  it('the invoice url the API hands out is this page', async () => {
    const invoice = await pageInvoice()
    expect((await fetch(invoice.url)).status).toBe(200)
  })
})

describe('the harness guards', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.12.0.9', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['10.0.0.5', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.65.1', true],
    ['::ffff:192.168.1.20', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.169.0.1', false],
    ['11.0.0.1', false],
    ['8.8.8.8', false],
    ['::ffff:8.8.8.8', false],
    ['2001:4860:4860::8888', false],
    ['not an address', false],
    ['', false],
    [undefined, false],
  ])('isLocalPeer(%s) is %s', (address, expected) => {
    expect(isLocalPeer(address)).toBe(expected)
  })

  it('answers the control routes and the stand-in page to a loopback peer, and 403 to any other peer', async () => {
    const invoice = await newInvoice()
    expect((await harness('/config', {})).status).toBe(200)
    expect((await fetch(`${emulator.url}/invoices/${invoice.id}`)).status).toBe(200)

    const guarded = await startEmulator()
    try {
      // Pretend every connection comes from a public address.
      guarded.server.on('connection', (socket) => Object.defineProperty(socket, 'remoteAddress', { value: '8.8.8.8' }))
      const made = await fetch(`${guarded.url}/v1/invoices`, {
        method: 'POST',
        headers: { authorization: AUTH, 'content-type': 'application/json' },
        body: JSON.stringify(invoiceBody()),
      })
      const id = ((await made.json()) as InvoiceObject).id
      for (const [method, path] of [
        ['GET', '/__emulator/state'],
        ['POST', '/__emulator/reset'],
        ['POST', '/__emulator/pay'],
        ['POST', '/__emulator/config'],
        ['GET', `/invoices/${id}`],
        ['POST', `/invoices/${id}/action`],
      ] as const) {
        const response = await fetch(`${guarded.url}${path}`, { method })
        expect(response.status, `${method} ${path}`).toBe(403)
      }
      expect(guarded.state().payments).toEqual([])
    } finally {
      await guarded.close()
    }
  })

  it('records no Authorization header, key or credential, whatever the call', async () => {
    await newInvoice()
    await call('GET', '/v1/invoices', undefined, `Basic ${Buffer.from('sk_test_intruder:').toString('base64')}`)
    await call('GET', '/v1/invoices', undefined, `Bearer ${KEY}`)
    const recorded = JSON.stringify(emulator.state())
    expect(recorded).not.toMatch(/authorization/i)
    expect(recorded).not.toContain(KEY)
    expect(recorded).not.toContain(Buffer.from(`${KEY}:`).toString('base64'))
    expect(recorded).not.toContain('sk_test_intruder')
    expect(recorded).not.toMatch(/basic /i)
    expect(emulator.state().calls).toHaveLength(3)
  })

  it('does not answer a method or path it has not been given', async () => {
    expect((await call('GET', '/__emulator/pay', undefined, null)).status).toBe(404)
    expect((await call('POST', '/__emulator/state', {}, null)).status).toBe(404)
    expect((await call('POST', '/__emulator/nothing', {}, null)).status).toBe(404)
    expect((await call('GET', '/elsewhere', undefined, null)).status).toBe(404)
    expect((await call('DELETE', '/v1/invoices')).status).toBe(404)
    expect((await call('POST', '/__emulator/config', {}, null)).status).toBe(200)
  })

  it('refuses a control body that is not a JSON object', async () => {
    for (const text of ['{nope', '[1]', '"x"']) {
      const response = await fetch(`${emulator.url}/__emulator/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
      })
      expect(response.status, text).toBe(400)
    }
  })

  it('refuses a control body that is not sent as application/json, so no foreign web page can drive it', async () => {
    // A cross-origin "simple" request carries text/plain or a form type, and no preflight is made for it.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await fetch(`${emulator.url}/__emulator/config`, {
        method: 'POST',
        headers: { 'content-type': type },
        body: JSON.stringify({ live: true }),
      })
      expect(response.status, type).toBe(415)
    }
    expect(emulator.config().live).toBe(false)
    const withCharset = await fetch(`${emulator.url}/__emulator/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ live: true }),
    })
    expect(withCharset.status).toBe(200)
    expect(emulator.config().live).toBe(true)
    // The preflight a browser would need is not answered either.
    expect((await fetch(`${emulator.url}/__emulator/config`, { method: 'OPTIONS' })).headers.get('access-control-allow-origin')).toBeNull()
  })

  it('requires application/json on every control POST, an empty body too, so a bodiless cross-origin POST cannot reset it', async () => {
    const invoice = await newInvoice()
    const types: Array<Record<string, string>> = [{}, { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }]
    for (const headers of types) {
      const reset = await fetch(`${emulator.url}/__emulator/reset`, { method: 'POST', headers })
      expect(reset.status, JSON.stringify(headers)).toBe(415)
    }
    expect((await getInvoice(invoice.id)).status).toBe('initiated')
    // The same call as JSON is the one that works.
    expect((await harness('/reset')).status).toBe(200)
    expect(emulator.state().invoices).toEqual([])
  })

  it('refuses a Host header that is not a local host, on the control routes and the stand-in page alike (DNS rebinding)', async () => {
    const invoice = await newInvoice()
    const { port } = emulator
    const json = 'application/json'
    for (const host of ['evil.example', `evil.example:${port}`, `10.0.0.5:${port}`, `localhost.evil.example:${port}`, '127.0.0.1@evil.example']) {
      expect((await rawRequest(`${emulator.url}/__emulator/state`, { host })).status, host).toBe(403)
      expect((await rawRequest(`${emulator.url}/__emulator/reset`, { host, 'content-type': json }, '{}')).status, host).toBe(403)
      expect((await rawRequest(`${emulator.url}/invoices/${invoice.id}`, { host })).status, host).toBe(403)
      const form = { host, 'content-type': 'application/x-www-form-urlencoded' }
      expect((await rawRequest(`${emulator.url}/invoices/${invoice.id}/action`, form, 'action=pay')).status, host).toBe(403)
    }
    expect(emulator.state().invoices.map((entry) => entry.id)).toEqual([invoice.id])
    expect(emulator.state().payments).toEqual([])
    for (const host of ['127.0.0.1', `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`, `host.docker.internal:${port}`]) {
      expect((await rawRequest(`${emulator.url}/__emulator/state`, { host })).status, host).toBe(200)
    }
  })

  it('refuses a foreign Origin, a bodiless POST included, and lets a local one through', async () => {
    const invoice = await newInvoice()
    const json = 'application/json'
    const form = 'application/x-www-form-urlencoded'
    for (const origin of ['https://evil.example', 'http://evil.example:3000', 'null', 'http://localhost.evil.example', 'file://']) {
      // What a cross-origin "simple" POST is: no content type and no body, so the browser asks nothing first.
      expect((await rawRequest(`${emulator.url}/__emulator/reset`, { origin }, undefined, 'POST')).status, origin).toBe(403)
      expect((await rawRequest(`${emulator.url}/__emulator/config`, { origin, 'content-type': json }, '{"live":true}')).status, origin).toBe(403)
      expect((await rawRequest(`${emulator.url}/__emulator/state`, { origin })).status, origin).toBe(403)
      expect((await rawRequest(`${emulator.url}/invoices/${invoice.id}/action`, { origin, 'content-type': form }, 'action=pay')).status, origin).toBe(403)
    }
    expect(emulator.state().invoices.map((entry) => entry.id)).toEqual([invoice.id])
    expect(emulator.state().payments).toEqual([])
    expect(emulator.config().live).toBe(false)
    // The page's own form posts from the emulator's origin, and a local test page may drive the control routes.
    for (const origin of [emulator.url, 'http://localhost:3000', 'http://[::1]:3000', 'http://host.docker.internal:3000']) {
      expect((await rawRequest(`${emulator.url}/invoices/${invoice.id}/action`, { origin, 'content-type': form }, 'action=back')).status, origin).toBe(303)
      expect((await rawRequest(`${emulator.url}/__emulator/config`, { origin, 'content-type': json }, '{}')).status, origin).toBe(200)
    }
  })
})

describe('state() and reset()', () => {
  it('state() shows the invoices (oldest first), the payments, the calls with their route keys, the deliveries and the faults', async () => {
    const attempt = randomUUID()
    const first = await newInvoice({ metadata: { attempt_id: attempt } })
    const second = await newInvoice()
    const payment = await pay(first.id, 'paid')
    await moyasar('GET', `/invoices/${first.id}`)
    await moyasar('GET', `/invoices?metadata[attempt_id]=${attempt}`)
    await moyasar('PUT', `/invoices/${second.id}/cancel`)
    await moyasar('GET', '/payments')
    await moyasar('GET', `/payments/${payment.id}`)
    await refund(payment.id, { amount: 100 })
    await harness('/fault', { route: 'GET /v1/payments', mode: '500', times: 2 })

    const state = emulator.state()
    expect(state.invoices.map((invoice) => invoice.id)).toEqual([first.id, second.id])
    expect(state.payments.map((entry) => entry.id)).toEqual([payment.id])
    expect(state.calls.map((entry) => entry.route)).toEqual([
      'POST /v1/invoices',
      'POST /v1/invoices',
      'GET /v1/invoices/:id',
      'GET /v1/invoices',
      'PUT /v1/invoices/:id/cancel',
      'GET /v1/payments',
      'GET /v1/payments/:id',
      'POST /v1/payments/:id/refund',
    ])
    expect(state.calls[3]).toMatchObject({ method: 'GET', path: '/v1/invoices', query: { 'metadata[attempt_id]': attempt }, status: 200 })
    expect(state.calls[0]?.body).toMatchObject({ amount: 6900, currency: 'SAR' })
    expect(state.faults).toEqual([{ route: 'GET /v1/payments', mode: '500', times: 2, delayMs: 0 }])
    expect(state.deliveries).toEqual([])
    // The control routes are not calls to Moyasar.
    expect(state.calls.some((entry) => entry.path.startsWith('/__emulator'))).toBe(false)
  })

  it('state() hands out copies: changing one changes nothing inside', async () => {
    const invoice = await newInvoice()
    const state = emulator.state()
    state.invoices[0]!.status = 'paid'
    state.calls.length = 0
    expect((await getInvoice(invoice.id)).status).toBe('initiated')
    // The create and the fetch are both still on record.
    expect(emulator.state().calls.map((entry) => entry.route)).toEqual(['POST /v1/invoices', 'GET /v1/invoices/:id'])
  })

  it('GET /__emulator/state serves the same view, and POST /__emulator/reset forgets everything', async () => {
    const invoice = await newInvoice()
    await pay(invoice.id, 'paid')
    await harness('/fault', { route: 'POST /v1/invoices', mode: '500' })
    await harness('/config', { live: true })
    const served = await call('GET', '/__emulator/state', undefined, null)
    expect(served.status).toBe(200)
    expect((served.body.invoices as InvoiceObject[]).map((entry) => entry.id)).toEqual([invoice.id])
    expect((served.body.payments as PaymentObject[]).length).toBe(1)

    expect((await harness('/reset')).body).toEqual({ ok: true })
    expect(emulator.state()).toEqual({ invoices: [], payments: [], calls: [], deliveries: [], faults: [] })
    expect(emulator.config().live).toBe(false)
    expect((await moyasar('GET', `/invoices/${invoice.id}`)).status).toBe(404)
  })
})
