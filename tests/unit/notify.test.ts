// P08 round 8: the `notify` Edge Function's handler with an injected rpc and Turnstile
// verifier: no network, no database. The database's own invariants are proven in
// tests/integration/notify.test.ts and the real function in
// tests/integration/notify-http.test.ts; here the checks are the handler's: the gates
// (origin, method, content type, size, JSON, schema), that a sign-up needs no payment
// settings, the Turnstile action, that `subscribe` answers and calls the same for every
// outcome the SQL can have, and that `confirm` and `unsubscribe` recompute the mac from
// the pepper and the row's version, compare it with `secretsMatch`, give one 404 to every
// kind of bad token (and do the same work on a miss as on a hit), and expire a confirm
// link after 7 days but never an unsubscribe link. Nothing is ever logged.
import { createHmac, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONSOLE_METHODS, expectOnlyFaultLines } from '../support/console'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { handleNotify, type NotifyDeps } from '../../supabase/functions/_shared/notify.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'
import type { TurnstileResult } from '../../supabase/functions/_shared/turnstile.ts'

// The comparison is the module's own `secretsMatch`: the spy lets a test see it was used, on a hit and on every miss.
const secretsMatchSpy = vi.hoisted(() => vi.fn())
vi.mock('../../supabase/functions/_shared/env.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/env.ts')>()
  secretsMatchSpy.mockImplementation(actual.secretsMatch)
  return { ...actual, secretsMatch: secretsMatchSpy }
})

const SITE = 'http://localhost:3000'
const PEPPER = 'unit-test-pepper'
const VARIANT = randomUUID()
const ID = randomUUID()
const VERSION = 3
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

/** The token of a mailed link, computed here from the contract's formula, never by the module under test. */
const tokenOf = (id: string, version: number, key = PEPPER): string => `${id}.${createHmac('sha256', key).update(`notify:${id}:${version}`).digest('base64url')}`
const TOKEN = tokenOf(ID, VERSION)
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()

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
const deps = (over: Partial<NotifyDeps> = {}): NotifyDeps => ({ rpc: recorderRpc, verify: verifyOk, ...over })
const post = (request: Request, over: Partial<NotifyDeps> = {}) => handleNotify(request, deps(over))

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const subscribeBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: 'subscribe',
  variantId: VARIANT,
  email: 'Reader@Example.com ',
  consentRevision: 4,
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  ...over,
})
const linkBody = (action: 'confirm' | 'unsubscribe', token = TOKEN): Record<string, unknown> => ({ action, token })

type Reply = { ok: boolean; error?: { code: string; message: string; fields?: unknown }; data?: unknown }
const replyOf = async (response: Response): Promise<Reply> => (await response.json()) as Reply

const logs = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
const sign = vi.spyOn(crypto.subtle, 'sign')

beforeEach(() => {
  recorded.length = 0
  script.clear()
  verifyOk.mockClear()
  secretsMatchSpy.mockClear()
  sign.mockClear()
  for (const spy of logs) spy.mockClear()
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
  vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')
})

afterEach(() => {
  // Whatever a test did, nothing was logged but the fault lines of F3-1 (tests/support/console.ts): no token, key, URL, name or body.
  expectOnlyFaultLines(logs)
  vi.unstubAllEnvs()
})

describe("the gates, in orders' order", () => {
  it('answers the CORS preflight for the site origin only, with the no-referrer header', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/notify', { method: 'OPTIONS', headers: { origin: SITE } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('refuses a method other than POST with 405', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/notify', { method: 'GET', headers: { origin: SITE } }))
    expect(response.status).toBe(405)
    expect((await replyOf(response)).error?.code).toBe('METHOD_NOT_ALLOWED')
  })

  it.each([
    ['without SITE_URL', () => vi.stubEnv('SITE_URL', '')],
    ['without the pepper', () => vi.stubEnv('TOKEN_HASH_PEPPER', '')],
  ])('is unavailable %s and calls nothing', async (_label, unset) => {
    unset()
    for (const body of [subscribeBody(), linkBody('confirm'), linkBody('unsubscribe')]) {
      const response = await post(request(body))
      expect(response.status).toBe(503)
      expect((await replyOf(response)).error?.code).toBe('UNAVAILABLE')
    }
    expect(recorded).toHaveLength(0)
    expect(verifyOk).not.toHaveBeenCalled()
  })

  it('refuses a foreign origin and a missing one with 403 before anything is called', async () => {
    const foreign = await post(request(subscribeBody(), { origin: 'https://evil.test' }))
    expect(foreign.status).toBe(403)
    // The refusal names the site, never the caller and never `*`: a page of another origin cannot read it.
    expect(foreign.headers.get('access-control-allow-origin')).toBe(SITE)
    const withOrigin = request(subscribeBody())
    const headers = new Headers(withOrigin.headers)
    headers.delete('origin')
    expect((await post(new Request(withOrigin.url, { method: 'POST', headers, body: await withOrigin.text() }))).status).toBe(403)
    expect((await post(request(linkBody('unsubscribe'), { origin: 'https://evil.test' }))).status).toBe(403)
    expect(recorded).toHaveLength(0)
    expect(verifyOk).not.toHaveBeenCalled()
  })

  it('refuses a non-JSON content type with 415, unparseable JSON with 400 and a body over 64 KiB with 413', async () => {
    expect((await post(request('not json', { 'content-type': 'text/plain' }))).status).toBe(415)
    const bad = await post(request('{nope'))
    expect(bad.status).toBe(400)
    expect((await replyOf(bad)).error?.code).toBe('BAD_JSON')
    expect((await post(request(subscribeBody({ email: `${'x'.repeat(70_000)}@example.com` })))).status).toBe(413)
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
    const streamed = new Request('http://127.0.0.1:54321/functions/v1/notify', {
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
    ['no action', { variantId: VARIANT, email: 'a@example.com', consentRevision: null, turnstileToken: 'x' }],
    ['a subscribe with no variant', subscribeBody({ variantId: undefined })],
    ['a variant that is not a uuid', subscribeBody({ variantId: 'not-a-uuid' })],
    ['an upper-case variant uuid', subscribeBody({ variantId: VARIANT.toUpperCase() })],
    ['an address that is not one', subscribeBody({ email: 'not-an-address' })],
    ['an address with a space in it', subscribeBody({ email: 'two words@example.com' })],
    ['an address that could carry a header', subscribeBody({ email: 'x@evil.test?bcc=y@z.co' })],
    ['an address of 255 characters', subscribeBody({ email: `${'a'.repeat(250)}@x.co` })],
    ['no address', subscribeBody({ email: undefined })],
    ['a missing consent revision', subscribeBody({ consentRevision: undefined })],
    ['a consent revision of zero', subscribeBody({ consentRevision: 0 })],
    ['a negative consent revision', subscribeBody({ consentRevision: -1 })],
    ['a fractional consent revision', subscribeBody({ consentRevision: 1.5 })],
    ['a consent revision that is a string', subscribeBody({ consentRevision: '3' })],
    ['a consent revision beyond a database integer', subscribeBody({ consentRevision: 2_147_483_648 })],
    ['a subscribe with no Turnstile token', subscribeBody({ turnstileToken: '' })],
    ['a Turnstile token of 2049 characters', subscribeBody({ turnstileToken: 'x'.repeat(2049) })],
    ['a subscribe with a stray key', subscribeBody({ website: 'x' })],
    ['a confirm with no token', { action: 'confirm' }],
    ['a confirm with an empty token', { action: 'confirm', token: '' }],
    ['a confirm with a token of 201 characters', { action: 'confirm', token: 'x'.repeat(201) }],
    ['a confirm with a stray key', { action: 'confirm', token: TOKEN, email: 'a@example.com' }],
    ['an unsubscribe with a token that is not a string', { action: 'unsubscribe', token: 5 }],
    ['an unsubscribe with a stray key', { action: 'unsubscribe', token: TOKEN, turnstileToken: 'x' }],
  ])('refuses %s with 422 INVALID before the database', async (_label, body) => {
    const response = await post(request(body))
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('INVALID')
    expect(recorded).toHaveLength(0)
    expect(verifyOk).not.toHaveBeenCalled()
  })

  it('needs no payment settings: a sign-up and a link work with none of them set', async () => {
    for (const name of ['PAYMENTS_MODE', 'MOYASAR_API_BASE_URL', 'MOYASAR_SECRET_KEY', 'MOYASAR_WEBHOOK_SECRET', 'FUNCTIONS_PUBLIC_URL']) vi.stubEnv(name, '')
    scripted('notify_subscribe', { ok: true })
    scripted('notify_token_info', { tokenVersion: VERSION, status: 'pending', confirmSentAt: ago(MINUTE) })
    scripted('notify_confirm', { ok: true, status: 'confirmed' })
    expect((await post(request(subscribeBody()))).status).toBe(200)
    expect((await post(request(linkBody('confirm')))).status).toBe(200)
  })

  it('puts Referrer-Policy: no-referrer and Cache-Control: no-store on every reply, whatever its status', async () => {
    scripted('notify_subscribe', { ok: true })
    scripted('notify_token_info', { tokenVersion: VERSION, status: 'confirmed', confirmSentAt: ago(MINUTE) })
    scripted('notify_unsubscribe', { ok: true, status: 'unsubscribed' })
    const responses = [
      await post(request(subscribeBody())),
      await post(request(linkBody('unsubscribe'))),
      await post(request(subscribeBody(), { origin: 'https://evil.test' })),
      await post(request('{nope')),
      await post(request(subscribeBody({ email: 'x' }))),
      await post(request(linkBody('unsubscribe', tokenOf(ID, 1)))),
      await post(new Request('http://127.0.0.1:54321/functions/v1/notify', { method: 'GET' })),
    ]
    scripted('notify_subscribe', dbError('54000'))
    responses.push(await post(request(subscribeBody())))
    scripted('notify_subscribe', dbError('XX000'))
    responses.push(await post(request(subscribeBody())))
    verifyOk.mockResolvedValueOnce({ ok: false, code: 'UNREACHABLE' })
    responses.push(await post(request(subscribeBody())))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 403, 400, 422, 404, 405, 429, 500, 503])
    for (const response of responses) {
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('subscribe', () => {
  it("verifies the human with the notify action for the site's own host", async () => {
    scripted('notify_subscribe', { ok: true })
    await post(request(subscribeBody()))
    expect(verifyOk).toHaveBeenCalledTimes(1)
    expect(verifyOk).toHaveBeenCalledWith({
      token: 'XXXX.DUMMY.TOKEN.XXXX',
      secret: '1x0000000000000000000000000000000AA',
      remoteIp: 'local',
      expectedAction: 'notify',
      expectedHostname: 'localhost',
    })
  })

  it('answers 503 with no secret, 503 when Turnstile is down, 400 when the human is not verified, and calls no SQL function', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const noSecret = await post(request(subscribeBody()))
    expect(noSecret.status).toBe(503)
    expect((await replyOf(noSecret)).error?.code).toBe('TURNSTILE_UNAVAILABLE')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA')

    for (const code of ['UNREACHABLE', 'MISCONFIGURED', 'TEST_SECRET_IN_PRODUCTION'] as const) {
      verifyOk.mockResolvedValueOnce({ ok: false, code })
      const down = await post(request(subscribeBody()))
      expect(down.status, code).toBe(503)
      expect((await replyOf(down)).error?.code).toBe('TURNSTILE_UNAVAILABLE')
    }
    for (const code of ['INVALID_TOKEN', 'ACTION_MISMATCH', 'HOSTNAME_MISMATCH'] as const) {
      verifyOk.mockResolvedValueOnce({ ok: false, code })
      const refused = await post(request(subscribeBody()))
      expect(refused.status, code).toBe(400)
      expect((await replyOf(refused)).error?.code).toBe('TURNSTILE')
    }
    expect(recorded).toHaveLength(0)
  })

  it("makes one call, notify_subscribe, with the caller's hash, the normalized address, the variant and the revision as given", async () => {
    scripted('notify_subscribe', { ok: true })
    const response = await post(request(subscribeBody({ email: '  Reader@Example.COM ', consentRevision: 4 })))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { sent: true } })
    expect(names()).toEqual(['notify_subscribe'])
    expect(calls('notify_subscribe')[0]).toEqual({
      p_ip_hash: await clientKeyHash(request(subscribeBody()), PEPPER),
      p_email: 'reader@example.com',
      p_variant: VARIANT,
      p_consent_revision: 4,
    })
    // The pepper and the raw caller address never reach the database.
    expect(JSON.stringify(recorded)).not.toContain(PEPPER)
  })

  it('passes a null revision as null and the largest integer as it is', async () => {
    scripted('notify_subscribe', { ok: true })
    await post(request(subscribeBody({ consentRevision: null })))
    await post(request(subscribeBody({ consentRevision: 2_147_483_647 })))
    expect(calls('notify_subscribe').map((args) => args.p_consent_revision)).toEqual([null, 2_147_483_647])
  })

  it('punycodes an international domain like checkout and the contact form do, so it is stored the way it is looked up', async () => {
    scripted('notify_subscribe', { ok: true })
    await post(request(subscribeBody({ email: 'Reader@Bücher.example' })))
    expect(calls('notify_subscribe')[0]!.p_email).toBe('reader@xn--bcher-kva.example')
  })

  it('answers the same reply and makes the same calls for every outcome the SQL can have', async () => {
    // A queued mail, an unknown variant, a sellable one, an address already confirmed, a spent address, a spent day:
    // the SQL answers {ok: true} for all of them, and nothing the handler does or says depends on the rest of its answer.
    const outcomes: Array<{ status: number; body: unknown; sequence: string[]; args: unknown }> = []
    for (const answer of [{ ok: true }, { ok: true, queued: true }, { ok: true, queued: false }, { ok: true, state: 'confirmed' }, { ok: true, anything: [1, 2] }]) {
      recorded.length = 0
      scripted('notify_subscribe', answer)
      const response = await post(request(subscribeBody()))
      outcomes.push({ status: response.status, body: await response.json(), sequence: names(), args: calls('notify_subscribe')[0] })
    }
    // The body carries a fresh request id each time: compare what is the same.
    const stripped = outcomes.map((outcome) => ({ ...outcome, body: { ...(outcome.body as object), requestId: undefined } }))
    expect(new Set(stripped.map((outcome) => JSON.stringify(outcome))).size).toBe(1)
    expect(outcomes[0]!.status).toBe(200)
    expect(outcomes[0]!.body).toEqual({ ok: true, data: { sent: true } })
    expect(outcomes[0]!.sequence).toEqual(['notify_subscribe'])
  })

  it('says nothing of the address or the variant, and the throttle answers the same whichever it was', async () => {
    scripted('notify_subscribe', { ok: true })
    const reply = JSON.stringify(await replyOf(await post(request(subscribeBody({ email: 'secret.reader@example.com' })))))
    for (const value of ['secret.reader@example.com', VARIANT, 'reader']) expect(reply).not.toContain(value)

    scripted('notify_subscribe', dbError('54000'))
    const first = await post(request(subscribeBody()))
    const second = await post(request(subscribeBody({ email: 'someone.else@example.com', variantId: randomUUID() })))
    expect(first.status).toBe(429)
    expect(second.status).toBe(429)
    const [a, b] = [await replyOf(first), await replyOf(second)]
    expect(a.error).toEqual(b.error)
    expect(a.error?.code).toBe('RATE_LIMITED')
  })

  it('answers a database failure with a detail-free 500, and an answer that is not {ok: true} too', async () => {
    for (const reply of [dbError('XX000'), dbError('23514'), null, { ok: false }, {}, 'ok']) {
      scripted('notify_subscribe', reply)
      const response = await post(request(subscribeBody()))
      expect(response.status).toBe(500)
      const text = JSON.stringify(await replyOf(response))
      expect(text).toContain('FAILED')
      expect(text).not.toContain('detail that must never leave')
    }
  })
})

describe('confirm and unsubscribe', () => {
  const info = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ tokenVersion: VERSION, status: 'pending', confirmSentAt: ago(MINUTE), ...over })

  it('throttles the caller, reads the row, and moves it at the version the link was derived for', async () => {
    scripted('notify_token_info', info())
    scripted('notify_confirm', { ok: true, status: 'confirmed' })
    const response = await post(request(linkBody('confirm')))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'confirmed' } })
    expect(names()).toEqual(['notify_link_throttle', 'notify_token_info', 'notify_confirm'])
    expect(calls('notify_link_throttle')[0]).toEqual({ p_ip_hash: await clientKeyHash(request(linkBody('confirm')), PEPPER) })
    expect(calls('notify_token_info')[0]).toEqual({ p_id: ID })
    expect(calls('notify_confirm')[0]).toEqual({ p_id: ID, p_token_version: VERSION })
    // The id is all the database ever sees of the token: the mac, the pepper and the caller's address stay out.
    expect(JSON.stringify(recorded)).not.toContain(TOKEN.split('.')[1])
    expect(JSON.stringify(recorded)).not.toContain(PEPPER)
  })

  it('unsubscribes with the same token shape, and answers unsubscribed', async () => {
    scripted('notify_token_info', info({ status: 'confirmed' }))
    scripted('notify_unsubscribe', { ok: true, status: 'unsubscribed' })
    const response = await post(request(linkBody('unsubscribe')))
    expect(response.status).toBe(200)
    expect(await replyOf(response)).toEqual({ ok: true, data: { status: 'unsubscribed' } })
    expect(names()).toEqual(['notify_link_throttle', 'notify_token_info', 'notify_unsubscribe'])
    expect(calls('notify_unsubscribe')[0]).toEqual({ p_id: ID, p_token_version: VERSION })
  })

  it('derives the mac for the version the row has now: the link of the new version works and the old one does not', async () => {
    scripted('notify_token_info', info({ tokenVersion: 5 }))
    scripted('notify_confirm', { ok: true, status: 'confirmed' })
    expect((await post(request(linkBody('confirm', tokenOf(ID, 5))))).status).toBe(200)
    expect(calls('notify_confirm')[0]).toEqual({ p_id: ID, p_token_version: 5 })
    recorded.length = 0
    expect((await post(request(linkBody('confirm', tokenOf(ID, VERSION))))).status).toBe(404)
    expect(names()).not.toContain('notify_confirm')
  })

  it('recomputes the mac from the pepper: a token of another pepper is a forgery', async () => {
    scripted('notify_token_info', info())
    const response = await post(request(linkBody('confirm', tokenOf(ID, VERSION, 'another-pepper'))))
    expect(response.status).toBe(404)
    expect(names()).not.toContain('notify_confirm')
  })

  describe('a confirm link lives 7 days after its mail was queued', () => {
    it.each([
      ['a minute ago', ago(MINUTE)],
      ['six days ago', ago(6 * DAY)],
      ['a minute short of 7 days', ago(7 * DAY - MINUTE)],
      ['a minute ahead (the two clocks differ a little)', new Date(Date.now() + MINUTE).toISOString()],
    ])('confirms a link queued %s', async (_label, confirmSentAt) => {
      scripted('notify_token_info', info({ confirmSentAt }))
      scripted('notify_confirm', { ok: true, status: 'confirmed' })
      expect((await post(request(linkBody('confirm')))).status).toBe(200)
      expect(names()).toContain('notify_confirm')
    })

    it.each([
      ['a minute past 7 days', ago(7 * DAY + MINUTE)],
      ['a year ago', ago(365 * DAY)],
      ['never (a sign-up that got no mail)', null],
      ['a time that cannot be read', 'not a time'],
    ])('refuses a link queued %s, with the one 404 and without touching the row', async (_label, confirmSentAt) => {
      scripted('notify_token_info', info({ confirmSentAt }))
      scripted('notify_confirm', { ok: true, status: 'confirmed' })
      const response = await post(request(linkBody('confirm')))
      expect(response.status).toBe(404)
      expect((await replyOf(response)).error?.code).toBe('NOT_FOUND')
      expect(names()).not.toContain('notify_confirm')
    })

    it('never expires an unsubscribe link: it keeps working until it is used', async () => {
      for (const confirmSentAt of [ago(7 * DAY + MINUTE), ago(400 * DAY), null]) {
        recorded.length = 0
        scripted('notify_token_info', info({ status: 'confirmed', confirmSentAt }))
        scripted('notify_unsubscribe', { ok: true, status: 'unsubscribed' })
        expect((await post(request(linkBody('unsubscribe')))).status).toBe(200)
        expect(names()).toContain('notify_unsubscribe')
      }
    })
  })

  describe('every bad, stale, expired or unknown token gets the same refusal', () => {
    const otherId = randomUUID()
    const refusals: Array<[string, string, () => void]> = [
      ['a token with no dot', 'x'.repeat(80), () => scripted('notify_token_info', info())],
      ['a token that is only a uuid', ID, () => scripted('notify_token_info', info())],
      ['a mac that is too short', `${ID}.${'A'.repeat(42)}`, () => scripted('notify_token_info', info())],
      ['a mac that is too long', `${TOKEN}A`, () => scripted('notify_token_info', info())],
      ['a token with a third part', `${TOKEN}.extra`, () => scripted('notify_token_info', info())],
      ['an id that is not a uuid', `not-a-uuid.${TOKEN.split('.')[1]}`, () => scripted('notify_token_info', info())],
      ['an upper-case id', `${ID.toUpperCase()}.${TOKEN.split('.')[1]}`, () => scripted('notify_token_info', info())],
      ['a forged mac', `${ID}.${'A'.repeat(43)}`, () => scripted('notify_token_info', info())],
      ['a mac with one character changed', `${TOKEN.slice(0, -1)}${TOKEN.endsWith('A') ? 'B' : 'A'}`, () => scripted('notify_token_info', info())],
      ['the mac of an older version', tokenOf(ID, VERSION - 1), () => scripted('notify_token_info', info())],
      ['the mac of a newer version', tokenOf(ID, VERSION + 1), () => scripted('notify_token_info', info())],
      ['the mac of another subscription', `${ID}.${tokenOf(otherId, VERSION).split('.')[1]}`, () => scripted('notify_token_info', info())],
      ['an id nobody has (the token is genuine for it, there is no row)', tokenOf(otherId, VERSION), () => scripted('notify_token_info', null)],
      ['an id nobody has, with the mac of version 0', tokenOf(otherId, 0), () => scripted('notify_token_info', null)],
    ]
    const actions = ['confirm', 'unsubscribe'] as const

    it.each(refusals.flatMap(([label, token, arrange]) => actions.map((action) => [`${action}: ${label}`, action, token, arrange] as const)))(
      '%s: 404 NOT_FOUND and the row is not touched',
      async (_label, action, token, arrange) => {
        arrange()
        const response = await post(request(linkBody(action, token)))
        expect(response.status).toBe(404)
        expect((await replyOf(response)).error).toEqual({ code: 'NOT_FOUND', message: 'الرابط غير صالح أو انتهت صلاحيته.' })
        expect(names()).not.toContain('notify_confirm')
        expect(names()).not.toContain('notify_unsubscribe')
      },
    )

    it('is one reply for all of them: the status, the code, the message and the headers do not tell them apart', async () => {
      const seen = new Set<string>()
      for (const [, token, arrange] of refusals) {
        arrange()
        const response = await post(request(linkBody('confirm', token)))
        const reply = await replyOf(response)
        seen.add(JSON.stringify([response.status, reply.error, [...response.headers].filter(([name]) => name !== 'content-length').sort()]))
      }
      // An expired link, and the SQL's own NOT_FOUND (a row that is not pending any more, a version that moved on meanwhile).
      scripted('notify_token_info', info({ confirmSentAt: ago(8 * DAY) }))
      const expired = await post(request(linkBody('confirm')))
      seen.add(JSON.stringify([expired.status, (await replyOf(expired)).error, [...expired.headers].filter(([name]) => name !== 'content-length').sort()]))
      scripted('notify_token_info', info())
      scripted('notify_confirm', { ok: false, code: 'NOT_FOUND' })
      const sql = await post(request(linkBody('confirm')))
      seen.add(JSON.stringify([sql.status, (await replyOf(sql)).error, [...sql.headers].filter(([name]) => name !== 'content-length').sort()]))
      expect(seen.size).toBe(1)
    })

    it.each([
      ['notify_confirm', 'confirm'],
      ['notify_unsubscribe', 'unsubscribe'],
    ] as const)("answers %s's NOT_FOUND (a row that is not in the state the link needs) with the same 404", async (fn, action) => {
      scripted('notify_token_info', info())
      scripted(fn, { ok: false, code: 'NOT_FOUND' })
      const response = await post(request(linkBody(action)))
      expect(response.status).toBe(404)
      expect((await replyOf(response)).error).toEqual({ code: 'NOT_FOUND', message: 'الرابط غير صالح أو انتهت صلاحيته.' })
      expect(names()).toEqual(['notify_link_throttle', 'notify_token_info', fn])
    })
  })

  describe('a miss does the work of a hit', () => {
    // A mac is computed (one HMAC) and compared with secretsMatch whatever the token and whatever the database knows.
    const cases: Array<[string, string, () => void]> = [
      ['a genuine token', TOKEN, () => scripted('notify_token_info', info())],
      ['a forged mac', `${ID}.${'A'.repeat(43)}`, () => scripted('notify_token_info', info())],
      ['the mac of an older version', tokenOf(ID, 1), () => scripted('notify_token_info', info())],
      ['an unknown id', tokenOf(randomUUID(), 1), () => scripted('notify_token_info', null)],
      ['a token that is not shaped like one', 'garbage', () => scripted('notify_token_info', null)],
    ]

    it.each(cases.flatMap(([label, token, arrange]) => (['confirm', 'unsubscribe'] as const).map((action) => [`${action}: ${label}`, action, token, arrange] as const)))(
      '%s: one mac computed, one constant-time comparison',
      async (_label, action, token, arrange) => {
        arrange()
        scripted('notify_confirm', { ok: true, status: 'confirmed' })
        scripted('notify_unsubscribe', { ok: true, status: 'unsubscribed' })
        await post(request(linkBody(action, token)))
        expect(sign).toHaveBeenCalledTimes(1)
        expect(secretsMatchSpy).toHaveBeenCalledTimes(1)
        // The comparison is between the presented token and the one recomputed from the pepper; it is never the other way round alone.
        expect(secretsMatchSpy.mock.calls[0]![0]).toBe(token)
        expect(typeof secretsMatchSpy.mock.calls[0]![1]).toBe('string')
      },
    )

    it('compares the whole presented token with the recomputed one, so a mac that is right for another id is wrong', async () => {
      scripted('notify_token_info', info())
      await post(request(linkBody('confirm', TOKEN)))
      expect(secretsMatchSpy.mock.calls[0]).toEqual([TOKEN, TOKEN])
    })
  })

  describe('the throttle and the failures', () => {
    it.each(['confirm', 'unsubscribe'] as const)('%s: answers the caller\'s throttle with 429 and does nothing else', async (action) => {
      scripted('notify_link_throttle', dbError('54000'))
      const response = await post(request(linkBody(action)))
      expect(response.status).toBe(429)
      expect((await replyOf(response)).error?.code).toBe('RATE_LIMITED')
      expect(names()).toEqual(['notify_link_throttle'])
    })

    it.each(['confirm', 'unsubscribe'] as const)('%s: takes the throttle before it even reads the token, so a garbage token spends it too', async (action) => {
      await post(request(linkBody(action, 'garbage')))
      expect(names()).toEqual(['notify_link_throttle'])
    })

    it.each(['notify_token_info', 'notify_confirm'] as const)('maps a 54000 from %s to 429 as well', async (fn) => {
      scripted('notify_token_info', info())
      scripted(fn, dbError('54000'))
      expect((await post(request(linkBody('confirm')))).status).toBe(429)
    })

    it('answers a database failure, an answer it cannot read and a refusal it does not know with a detail-free 500', async () => {
      const cases: Array<[string, unknown[]]> = [
        ['notify_link_throttle', [dbError('XX000')]],
        ['notify_token_info', [dbError('XX000'), { tokenVersion: '3' }, { status: 'pending' }, 'row', 7]],
        ['notify_confirm', [dbError('XX000'), null, { ok: false, code: 'SOMETHING_NEW' }, {}, { ok: false }]],
      ]
      for (const [fn, replies] of cases) {
        for (const reply of replies) {
          script.clear()
          scripted('notify_token_info', info())
          scripted(fn, reply)
          const response = await post(request(linkBody('confirm')))
          expect(response.status, `${fn}: ${JSON.stringify(reply)}`).toBe(500)
          const text = JSON.stringify(await replyOf(response))
          expect(text).toContain('FAILED')
          expect(text).not.toContain('detail that must never leave')
        }
      }
    })

    it('echoes neither the token nor the id in any reply', async () => {
      scripted('notify_token_info', info())
      scripted('notify_confirm', { ok: true, status: 'confirmed' })
      const hit = JSON.stringify(await replyOf(await post(request(linkBody('confirm')))))
      const miss = JSON.stringify(await replyOf(await post(request(linkBody('confirm', tokenOf(ID, 1))))))
      for (const text of [hit, miss]) {
        expect(text).not.toContain(ID)
        expect(text).not.toContain(TOKEN.split('.')[1])
      }
    })
  })
})
