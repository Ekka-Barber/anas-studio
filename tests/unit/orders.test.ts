// P08 round 7: the `orders` Edge Function's handler with an injected rpc, Turnstile
// verifier and payment settings — no network, no database. The database's own
// invariants are proven in tests/integration/orders-access.test.ts and the real
// function in tests/integration/orders-http.test.ts; here the checks are the
// handler's: the gates (origin, method, content type, size, JSON, schema, the payment
// settings), the three actions' arguments to the SQL, every SQL refusal's HTTP status,
// the recovery that always calls both SQL functions and always answers the same,
// the links it derives (a live one is never replaced), and that nothing is logged.
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { handleOrders, type OrdersDeps, recoveryItems } from '../../supabase/functions/_shared/orders.ts'
import type { PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'
import type { TurnstileResult } from '../../supabase/functions/_shared/turnstile.ts'

const SITE = 'http://localhost:3000'
const PEPPER = 'unit-test-pepper'
const NUMBER = 'ABCD2345'
const TOKEN = 'A'.repeat(43)
const ITEM = randomUUID()
const ORDER = randomUUID()

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://host.docker.internal:54390/v1',
  secretKey: 'sk_test_local_emulator_key_not_for_production',
  webhookSecret: 'local-moyasar-webhook-secret-not-for-production',
  mode: 'test',
  callbackBase: 'http://127.0.0.1:54321/functions/v1',
  storageBase: 'http://127.0.0.1:54321/storage/v1',
}

// The database is a recorder: every call's name and arguments, in order. A reply scripted for a function (the last one
// repeats) wins; every other function answers null.
const recorded: Array<{ fn: string; args: Record<string, unknown> }> = []
const script = new Map<string, unknown[]>()
const scripted = (fn: string, ...values: unknown[]): void => void script.set(fn, values)
const recorderRpc: Rpc = async (fn, args) => {
  recorded.push({ fn, args })
  const values = script.get(fn)
  if (!values) return null
  const value = values.length > 1 ? values.shift() : values[0]
  if (value instanceof Error) throw value
  return value
}
const names = (): string[] => recorded.map((entry) => entry.fn)
const calls = (fn: string): Array<Record<string, unknown>> => recorded.filter((entry) => entry.fn === fn).map((entry) => entry.args)
const dbError = (code: string): Error => Object.assign(new Error('detail that must never leave'), { code })

const verifyOk = vi.fn(async (): Promise<TurnstileResult> => ({ ok: true }))
const deps = (over: Partial<OrdersDeps> = {}): OrdersDeps => ({ rpc: recorderRpc, verify: verifyOk, config, ...over })
const post = (request: Request, over: Partial<OrdersDeps> = {}) => handleOrders(request, deps(over))

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const getBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'get', orderNumber: NUMBER.toLowerCase(), accessToken: TOKEN, ...over })
const recoverBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'recover', email: 'Buyer@Example.com ', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', ...over })
const returnBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'return-request',
  orderNumber: NUMBER,
  accessToken: TOKEN,
  items: [{ itemId: ITEM, quantity: 2 }],
  reason: 'المنتج وصلني تالفًا',
  ...over,
})

type Reply = { ok: boolean; error?: { code: string; message: string; fields?: any }; data?: any }
const replyOf = async (response: Response): Promise<Reply> => (await response.json()) as Reply

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const hashOf = (token: string): string => sha256(`${PEPPER}:order:${token}`)
const tokenOf = (idempotencyKey: string, version = 0): string =>
  createHmac('sha256', PEPPER).update(version === 0 ? `order-access:${idempotencyKey}` : `order-access:${idempotencyKey}:${version}`).digest('base64url')

const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))

beforeEach(() => {
  recorded.length = 0
  script.clear()
  verifyOk.mockClear()
  for (const spy of logs) spy.mockClear()
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
  vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
})

afterEach(() => {
  // Whatever a test did, the handler logged nothing: no token, address, body or detail.
  for (const spy of logs) expect(spy).not.toHaveBeenCalled()
  vi.unstubAllEnvs()
})

describe('the gates, in checkout\'s order', () => {
  it('answers the CORS preflight for the site origin only, with the order headers', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/orders', { method: 'OPTIONS', headers: { origin: SITE } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('refuses a method other than POST with 405', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/orders', { method: 'GET', headers: { origin: SITE } }))
    expect(response.status).toBe(405)
    expect((await replyOf(response)).error?.code).toBe('METHOD_NOT_ALLOWED')
  })

  it.each([
    ['without SITE_URL', () => vi.stubEnv('SITE_URL', '')],
    ['without the pepper', () => vi.stubEnv('TOKEN_HASH_PEPPER', '')],
  ])('is unavailable %s and calls nothing', async (_label, unset) => {
    unset()
    const response = await post(request(getBody()))
    expect(response.status).toBe(503)
    expect((await replyOf(response)).error?.code).toBe('UNAVAILABLE')
    expect(recorded).toHaveLength(0)
  })

  it('refuses a foreign origin and a missing one with 403 before anything is called', async () => {
    const foreign = await post(request(getBody(), { origin: 'https://evil.test' }))
    expect(foreign.status).toBe(403)
    // The refusal names the site, never the caller and never `*`: a page of another origin cannot read it.
    expect(foreign.headers.get('access-control-allow-origin')).toBe(SITE)
    const withOrigin = request(getBody())
    const headers = new Headers(withOrigin.headers)
    headers.delete('origin')
    expect((await post(new Request(withOrigin.url, { method: 'POST', headers, body: await withOrigin.text() }))).status).toBe(403)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a non-JSON content type with 415, unparseable JSON with 400 and a body over 64 KiB with 413', async () => {
    expect((await post(request('not json', { 'content-type': 'text/plain' }))).status).toBe(415)
    const bad = await post(request('{nope'))
    expect(bad.status).toBe(400)
    expect((await replyOf(bad)).error?.code).toBe('BAD_JSON')
    const big = await post(request(returnBody({ reason: 'x'.repeat(70_000) })))
    expect(big.status).toBe(413)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a body that declares a small size and streams a large one, without reading it all', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(8192))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 40) return controller.close()
        sent += 1
        controller.enqueue(chunk)
      },
    })
    const streamed = new Request('http://127.0.0.1:54321/functions/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect((await post(streamed)).status).toBe(413)
    expect(sent).toBeLessThan(40)
  })

  it.each([
    ['an unknown action', { action: 'delete' }],
    ['no action', { orderNumber: NUMBER, accessToken: TOKEN }],
    ['a get with an extra key', getBody({ extra: 1 })],
    ['an order number of the wrong shape', getBody({ orderNumber: 'ABCD234' })],
    ['an order number with a letter the alphabet leaves out', getBody({ orderNumber: 'ABCD234O' })],
    ['a token that is too short', getBody({ accessToken: 'A'.repeat(42) })],
    ['a token that is too long', getBody({ accessToken: 'A'.repeat(44) })],
    ['a token with a character outside base64url', getBody({ accessToken: `${'A'.repeat(42)}+` })],
    ['a recover with no Turnstile token', recoverBody({ turnstileToken: '' })],
    ['a recover with an address that is not one', recoverBody({ email: 'not-an-address' })],
    ['a recover with an address of 255 characters', recoverBody({ email: `${'a'.repeat(250)}@x.co` })],
    ['a recover with a stray key', recoverBody({ website: 'x' })],
    ['a return request with no items', returnBody({ items: [] })],
    ['a return request with 51 items', returnBody({ items: Array.from({ length: 51 }, () => ({ itemId: ITEM, quantity: 1 })) })],
    ['an item id that is not a uuid', returnBody({ items: [{ itemId: 'x', quantity: 1 }] })],
    ['a quantity of zero', returnBody({ items: [{ itemId: ITEM, quantity: 0 }] })],
    ['a quantity of 21', returnBody({ items: [{ itemId: ITEM, quantity: 21 }] })],
    ['a fractional quantity', returnBody({ items: [{ itemId: ITEM, quantity: 1.5 }] })],
    ['an item with an extra key', returnBody({ items: [{ itemId: ITEM, quantity: 1, price: 0 }] })],
    ['an empty reason', returnBody({ reason: '   ' })],
    ['a reason of 501 characters', returnBody({ reason: 'x'.repeat(501) })],
    ['a reason with a control character', returnBody({ reason: 'تالف\u0007' })],
  ])('refuses %s with 422 INVALID before the database', async (_label, body) => {
    const response = await post(request(body))
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('INVALID')
    expect(recorded).toHaveLength(0)
    expect(verifyOk).not.toHaveBeenCalled()
  })

  it('is unavailable, and calls nothing, while the payment settings are not working', async () => {
    for (const body of [getBody(), recoverBody(), returnBody()]) {
      const response = await post(request(body), { config: { ok: false, reason: 'NOT_CONFIGURED' } })
      expect(response.status).toBe(503)
      expect((await replyOf(response)).error?.code).toBe('UNAVAILABLE')
    }
    expect(recorded).toHaveLength(0)
    expect(verifyOk).not.toHaveBeenCalled()
  })

  it('puts Referrer-Policy: no-referrer and Cache-Control: no-store on every reply, whatever its status', async () => {
    scripted('order_access', { ok: true, order: {}, payment: {}, items: [], returns: [] })
    const responses = [
      await post(request(getBody())),
      await post(request(getBody(), { origin: 'https://evil.test' })),
      await post(request('{nope')),
      await post(request(getBody({ accessToken: 'x' }))),
      await post(request(getBody()), { config: { ok: false, reason: 'BAD_MODE' } }),
      await post(new Request('http://127.0.0.1:54321/functions/v1/orders', { method: 'GET' })),
    ]
    scripted('order_access', { ok: false, code: 'NOT_FOUND' })
    responses.push(await post(request(getBody())))
    scripted('order_access', dbError('XX000'))
    responses.push(await post(request(getBody())))
    expect(responses.map((response) => response.status)).toEqual([200, 403, 400, 422, 503, 405, 404, 500])
    for (const response of responses) {
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('get', () => {
  const view = { ok: true, order: { orderNumber: NUMBER }, payment: { state: 'paid' }, items: [{ itemId: ITEM }], returns: [] }

  it('asks order_access with the number folded, the token hashed with the pepper, the caller\'s hash and the configured mode', async () => {
    scripted('order_access', view)
    const response = await post(request(getBody({ orderNumber: ` ${NUMBER.toLowerCase()} ` })))
    expect(response.status).toBe(200)
    expect(names()).toEqual(['order_access'])
    expect(calls('order_access')[0]).toEqual({
      p_order_number: NUMBER,
      p_access_token_hash: hashOf(TOKEN),
      p_ip_hash: await clientKeyHash(request(getBody()), PEPPER),
      p_mode: 'test',
    })
    // The token itself never reaches the database.
    expect(JSON.stringify(recorded)).not.toContain(TOKEN)
  })

  it('answers the buyer\'s view and nothing else the SQL says', async () => {
    scripted('order_access', { ...view, secretColumn: 'x', customer_email: 'a@b.co', ok: true })
    const reply = await replyOf(await post(request(getBody())))
    expect(reply).toEqual({ ok: true, data: { order: view.order, payment: view.payment, items: view.items, returns: view.returns } })
  })

  it('uses the live mode when the settings say live', async () => {
    scripted('order_access', view)
    await post(request(getBody()), { config: { ...config, mode: 'live', secretKey: 'sk_live_x' } })
    expect(calls('order_access')[0]!.p_mode).toBe('live')
  })

  it('answers NOT_FOUND with 404, the throttle with 429, and anything else with a detail-free 500', async () => {
    scripted('order_access', { ok: false, code: 'NOT_FOUND' })
    const missing = await post(request(getBody()))
    expect(missing.status).toBe(404)
    expect((await replyOf(missing)).error).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) })

    scripted('order_access', dbError('54000'))
    const throttled = await post(request(getBody()))
    expect(throttled.status).toBe(429)
    expect((await replyOf(throttled)).error?.code).toBe('RATE_LIMITED')

    // A failure, no answer, a refusal the handler does not know, and a success that lacks the view: none is a view.
    for (const reply of [dbError('XX000'), null, { ok: false, code: 'SOMETHING_NEW' }, { ok: true }, { ...view, items: 'x' }]) {
      scripted('order_access', reply)
      const failed = await post(request(getBody()))
      expect(failed.status).toBe(500)
      const text = JSON.stringify(await replyOf(failed))
      expect(text).toContain('FAILED')
      expect(text).not.toContain('detail that must never leave')
    }
  })
})

describe('recover', () => {
  const live = { orderId: ORDER, idempotencyKey: randomUUID(), tokenVersion: 0, expired: false }
  const expired = { orderId: randomUUID(), idempotencyKey: randomUUID(), tokenVersion: 2, expired: true }

  it('verifies the human with the order-recover action for the site\'s own host', async () => {
    scripted('order_recover_list', [])
    await post(request(recoverBody()))
    expect(verifyOk).toHaveBeenCalledTimes(1)
    expect(verifyOk).toHaveBeenCalledWith({
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      secret: '1x0000000000000000000000000000000AA',
      remoteIp: 'local',
      expectedAction: 'order-recover',
      expectedHostname: 'localhost',
    })
  })

  it('answers 503 with no secret, 503 when Turnstile is down, 400 when the human is not verified, and calls no SQL function', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const noSecret = await post(request(recoverBody()))
    expect(noSecret.status).toBe(503)
    expect((await replyOf(noSecret)).error?.code).toBe('TURNSTILE_UNAVAILABLE')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')

    for (const code of ['UNREACHABLE', 'MISCONFIGURED', 'TEST_SECRET_IN_PRODUCTION'] as const) {
      verifyOk.mockResolvedValueOnce({ ok: false, code })
      const down = await post(request(recoverBody()))
      expect(down.status, code).toBe(503)
      expect((await replyOf(down)).error?.code).toBe('TURNSTILE_UNAVAILABLE')
    }
    for (const code of ['INVALID_TOKEN', 'ACTION_MISMATCH', 'HOSTNAME_MISMATCH'] as const) {
      verifyOk.mockResolvedValueOnce({ ok: false, code })
      const refused = await post(request(recoverBody()))
      expect(refused.status, code).toBe(400)
      expect((await replyOf(refused)).error?.code).toBe('TURNSTILE')
    }
    expect(recorded).toHaveLength(0)
  })

  it('always calls both SQL functions, with the same caller hash and the normalized address, and answers {sent: true}', async () => {
    scripted('order_recover_list', [live])
    scripted('order_recover_apply', 1)
    const response = await post(request(recoverBody({ email: '  Buyer@Example.COM ' })))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { sent: true } })
    expect(names()).toEqual(['order_recover_list', 'order_recover_apply'])
    const ip = await clientKeyHash(request(recoverBody()), PEPPER)
    expect(calls('order_recover_list')[0]).toEqual({ p_ip_hash: ip, p_email: 'buyer@example.com', p_mode: 'test' })
    expect(calls('order_recover_apply')[0]).toEqual({ p_ip_hash: ip, p_items: [{ orderId: ORDER, version: 0 }] })
  })

  it('punycodes an international domain like checkout does, so it hashes to the address the order stored', async () => {
    scripted('order_recover_list', [])
    await post(request(recoverBody({ email: 'Buyer@Bücher.example' })))
    expect(calls('order_recover_list')[0]!.p_email).toBe('buyer@xn--bcher-kva.example')
  })

  it('answers the same for an address with orders, an address with none and a throttled one: the reply and the sequence of calls', async () => {
    const outcomes: Array<{ status: number; body: unknown; sequence: string[]; applyArgs: unknown }> = []
    for (const listed of [[live, expired], [], []]) {
      recorded.length = 0
      scripted('order_recover_list', listed)
      scripted('order_recover_apply', listed.length)
      const response = await post(request(recoverBody()))
      outcomes.push({ status: response.status, body: await response.json(), sequence: names(), applyArgs: calls('order_recover_apply')[0]!.p_items })
    }
    // A hit, a miss and a throttled address (the SQL answers [] for both of the last two): one reply, one sequence.
    expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome.body))).size).toBe(1)
    expect(outcomes[0]!.body).toEqual({ ok: true, data: { sent: true } })
    expect(outcomes.every((outcome) => outcome.status === 200)).toBe(true)
    expect(outcomes.every((outcome) => outcome.sequence.join() === 'order_recover_list,order_recover_apply')).toBe(true)
    // The miss still applies, with nothing.
    expect(outcomes[1]!.applyArgs).toEqual([])
    expect(outcomes[2]!.applyArgs).toEqual([])
  })

  it('derives a new token only for an expired link, and sends the database its hash, never the token', async () => {
    scripted('order_recover_list', [live, expired])
    await post(request(recoverBody()))
    const items = calls('order_recover_apply')[0]!.p_items as Array<Record<string, unknown>>
    const newToken = tokenOf(expired.idempotencyKey, 3)
    expect(items).toEqual([
      { orderId: ORDER, version: 0 },
      { orderId: expired.orderId, version: 3, tokenHash: hashOf(newToken) },
    ])
    expect('tokenHash' in items[0]!).toBe(false)
    const all = JSON.stringify(recorded)
    for (const secret of [newToken, tokenOf(expired.idempotencyKey, 2), tokenOf(live.idempotencyKey), expired.idempotencyKey, live.idempotencyKey, 'XXXX.DUMMY.TOKEN.XXXX']) {
      expect(all).not.toContain(secret)
    }
  })

  it('maps a database failure honestly: a throttle is 429, anything else a detail-free 500, a list that is not a list too', async () => {
    scripted('order_recover_list', dbError('54000'))
    expect((await post(request(recoverBody()))).status).toBe(429)
    scripted('order_recover_list', dbError('XX000'))
    const failedList = await post(request(recoverBody()))
    expect(failedList.status).toBe(500)
    expect(JSON.stringify(await replyOf(failedList))).not.toContain('detail that must never leave')
    scripted('order_recover_list', { not: 'a list' })
    expect((await post(request(recoverBody()))).status).toBe(500)

    recorded.length = 0
    scripted('order_recover_list', [live])
    scripted('order_recover_apply', dbError('XX000'))
    const failedApply = await post(request(recoverBody()))
    expect(failedApply.status).toBe(500)
    expect(names()).toEqual(['order_recover_list', 'order_recover_apply'])
    scripted('order_recover_apply', dbError('54000'))
    expect((await post(request(recoverBody()))).status).toBe(429)
  })
})

describe('recoveryItems', () => {
  it('keeps a live link as it is and gives only an expired one the next version\'s token hash', async () => {
    const a = { orderId: randomUUID(), idempotencyKey: randomUUID(), tokenVersion: 0, expired: false }
    const b = { orderId: randomUUID(), idempotencyKey: randomUUID(), tokenVersion: 0, expired: true }
    const c = { orderId: randomUUID(), idempotencyKey: randomUUID(), tokenVersion: 4, expired: true }
    expect(await recoveryItems(PEPPER, [a, b, c])).toEqual([
      { orderId: a.orderId, version: 0 },
      { orderId: b.orderId, version: 1, tokenHash: hashOf(tokenOf(b.idempotencyKey, 1)) },
      { orderId: c.orderId, version: 5, tokenHash: hashOf(tokenOf(c.idempotencyKey, 5)) },
    ])
    expect(await recoveryItems(PEPPER, [])).toEqual([])
  })
})

describe('return-request', () => {
  it('passes the order, the hashed token, the items, the one-line reason and the caller\'s hash, and answers 201 with the id', async () => {
    const returnId = randomUUID()
    scripted('return_request_create', { ok: true, returnId })
    const response = await post(request(returnBody({ reason: '  المنتج\n\nوصلني   تالفًا\t' })))
    expect(response.status).toBe(201)
    expect(await replyOf(response)).toEqual({ ok: true, data: { returnId } })
    expect(calls('return_request_create')[0]).toEqual({
      p_order_number: NUMBER,
      p_access_token_hash: hashOf(TOKEN),
      p_items: [{ itemId: ITEM, quantity: 2 }],
      p_reason: 'المنتج وصلني تالفًا',
      p_ip_hash: await clientKeyHash(request(returnBody()), PEPPER),
      p_mode: 'test',
    })
    expect(JSON.stringify(recorded)).not.toContain(TOKEN)
  })

  it.each([
    ['NOT_FOUND', 404],
    ['NOT_RETURNABLE', 409],
    ['INVALID_ITEMS', 422],
    ['TOO_MANY_REQUESTS', 429],
  ])('maps %s to %i', async (code, status) => {
    scripted('return_request_create', { ok: false, code })
    const response = await post(request(returnBody()))
    expect(response.status).toBe(status)
    expect((await replyOf(response)).error).toMatchObject({ code, message: expect.any(String) })
  })

  it('answers the throttle with 429, and anything else (a refusal it does not know, an unreadable answer, a failure) with a detail-free 500', async () => {
    scripted('return_request_create', dbError('54000'))
    expect((await post(request(returnBody()))).status).toBe(429)
    for (const reply of [dbError('XX000'), null, { ok: false, code: 'SOMETHING_NEW' }, { ok: true }, { ok: true, returnId: 7 }]) {
      scripted('return_request_create', reply)
      const response = await post(request(returnBody()))
      expect(response.status).toBe(500)
      expect(JSON.stringify(await replyOf(response))).not.toContain('detail that must never leave')
    }
  })
})
