// P08 round 7: the `download` Edge Function's handler with an injected rpc, payment
// settings and Storage signer — no network, no database, no Storage. The database's own
// invariants are proven in tests/integration/download.test.ts and the real function,
// the real Storage and the signed URL in tests/integration/orders-http.test.ts; here the
// checks are the handler's: the gates, the token it mints (only its hash is stored), the
// 60-second signed URL rebuilt on the public Storage base with the file's own name, every
// SQL refusal's HTTP status, and that no token, key or URL is logged or returned beyond
// the one place it belongs.
import { createHash, randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONSOLE_METHODS, expectOnlyFaultLines } from '../support/console'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { type DownloadDeps, handleDownload, publicFileUrl } from '../../supabase/functions/_shared/download.ts'
import type { PaymentsConfigOk } from '../../supabase/functions/_shared/payments/moyasar.ts'
import { clientKeyHash } from '../../supabase/functions/_shared/rate-limit.ts'

const SITE = 'http://localhost:3000'
const PEPPER = 'unit-test-pepper'
const NUMBER = 'ABCD2345'
const TOKEN = 'A'.repeat(43)
const DOWNLOAD_TOKEN = 'B'.repeat(43)
const ITEM = randomUUID()
const STORAGE_KEY = `assets/${randomUUID()}/${randomUUID()}`
const FILENAME = 'كتاب أنس.pdf'
const INTERNAL = 'http://kong:8000/storage/v1'
const SIGNED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.signed-part.signature'

const config: PaymentsConfigOk = {
  ok: true,
  baseUrl: 'http://host.docker.internal:54390/v1',
  secretKey: 'sk_test_local_emulator_key_not_for_production',
  webhookSecret: 'local-moyasar-webhook-secret-not-for-production',
  mode: 'test',
  callbackBase: 'http://127.0.0.1:54321/functions/v1',
  storageBase: 'http://127.0.0.1:54321/storage/v1',
}

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

const signer = vi.fn(async (key: string, _seconds: number) => `${INTERNAL}/object/sign/paid-files/${key}?token=${SIGNED_TOKEN}`)
const deps = (over: Partial<DownloadDeps> = {}): DownloadDeps => ({ rpc: recorderRpc, config, signer, ...over })
const post = (request: Request, over: Partial<DownloadDeps> = {}) => handleDownload(request, deps(over))

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const issueBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'issue', orderNumber: NUMBER.toLowerCase(), accessToken: TOKEN, itemId: ITEM, ...over })
const redeemBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ action: 'redeem', downloadToken: DOWNLOAD_TOKEN, ...over })

type Reply = { ok: boolean; error?: { code: string; message: string; fields?: any }; data?: any }
const replyOf = async (response: Response): Promise<Reply> => (await response.json()) as Reply

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const logs = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))

beforeEach(() => {
  recorded.length = 0
  script.clear()
  signer.mockClear()
  for (const spy of logs) spy.mockClear()
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
  // The two payment variables the handler reads when the injected configuration is not working: unset unless a test sets them.
  vi.stubEnv('PAYMENTS_MODE', '')
  vi.stubEnv('FUNCTIONS_PUBLIC_URL', '')
})

afterEach(() => {
  // Whatever a test did, nothing was logged but the fault lines of F3-1 (tests/support/console.ts): no token, key, URL, name or body.
  expectOnlyFaultLines(logs)
  vi.unstubAllEnvs()
})

describe('the gates', () => {
  it('answers the CORS preflight for the site origin only, with the download headers', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/download', { method: 'OPTIONS', headers: { origin: SITE } }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('refuses a method other than POST with 405', async () => {
    const response = await post(new Request('http://127.0.0.1:54321/functions/v1/download', { method: 'GET', headers: { origin: SITE } }))
    expect(response.status).toBe(405)
    expect((await replyOf(response)).error?.code).toBe('METHOD_NOT_ALLOWED')
  })

  it.each([
    ['without SITE_URL', () => vi.stubEnv('SITE_URL', '')],
    ['without the pepper', () => vi.stubEnv('TOKEN_HASH_PEPPER', '')],
  ])('is unavailable %s and calls nothing', async (_label, unset) => {
    unset()
    const response = await post(request(redeemBody()))
    expect(response.status).toBe(503)
    expect(recorded).toHaveLength(0)
  })

  it('refuses a foreign origin and a missing one with 403 before anything is called', async () => {
    const foreign = await post(request(redeemBody(), { origin: 'https://evil.test' }))
    expect(foreign.status).toBe(403)
    // The refusal names the site, never the caller and never `*`: a page of another origin cannot read it.
    expect(foreign.headers.get('access-control-allow-origin')).toBe(SITE)
    const withOrigin = request(redeemBody())
    const headers = new Headers(withOrigin.headers)
    headers.delete('origin')
    expect((await post(new Request(withOrigin.url, { method: 'POST', headers, body: await withOrigin.text() }))).status).toBe(403)
    expect(recorded).toHaveLength(0)
    expect(signer).not.toHaveBeenCalled()
  })

  it('refuses a non-JSON content type with 415, unparseable JSON with 400 and a body over 64 KiB with 413', async () => {
    expect((await post(request('not json', { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await post(request('{nope'))).status).toBe(400)
    expect((await post(request(issueBody({ filler: 'x'.repeat(70_000) })))).status).toBe(413)
    expect(recorded).toHaveLength(0)
  })

  it.each([
    ['an unknown action', { action: 'list' }],
    ['an action of another function', { action: 'get', orderNumber: NUMBER, accessToken: TOKEN }],
    ['an issue with a number of the wrong shape', issueBody({ orderNumber: 'ABCD234' })],
    ['an issue with a token that is too short', issueBody({ accessToken: 'A'.repeat(42) })],
    ['an issue with an item that is not a uuid', issueBody({ itemId: 'x' })],
    ['an issue with an upper-case uuid', issueBody({ itemId: ITEM.toUpperCase() })],
    ['an issue with no item', issueBody({ itemId: undefined })],
    ['an issue with an extra key', issueBody({ extra: 1 })],
    ['a redeem with a token that is too short', redeemBody({ downloadToken: 'B'.repeat(42) })],
    ['a redeem with a token that is too long', redeemBody({ downloadToken: 'B'.repeat(44) })],
    ['a redeem with a character outside base64url', redeemBody({ downloadToken: `${'B'.repeat(42)}=` })],
    ['a redeem with an extra key', redeemBody({ orderNumber: NUMBER })],
  ])('refuses %s with 422 INVALID before the database', async (_label, body) => {
    const response = await post(request(body))
    expect(response.status).toBe(422)
    expect((await replyOf(response)).error?.code).toBe('INVALID')
    expect(recorded).toHaveLength(0)
  })

  it('is unavailable, and calls nothing, while no payment mode is set: no working configuration and no PAYMENTS_MODE', async () => {
    for (const body of [issueBody(), redeemBody()]) {
      const response = await post(request(body), { config: { ok: false, reason: 'NOT_CONFIGURED' } })
      expect(response.status).toBe(503)
    }
    expect(recorded).toHaveLength(0)
    expect(signer).not.toHaveBeenCalled()
  })

  // F1-16: neither action calls the provider, so a missing or broken Moyasar setting must not stop a buyer's files.
  it('with no Moyasar configuration, an issue and a redeem still answer: the mode from PAYMENTS_MODE, the link on the public base of FUNCTIONS_PUBLIC_URL', async () => {
    vi.stubEnv('PAYMENTS_MODE', 'test')
    vi.stubEnv('FUNCTIONS_PUBLIC_URL', 'http://127.0.0.1:54321/functions/v1')
    const unconfigured = { config: { ok: false, reason: 'NOT_CONFIGURED' } as const }
    scripted('download_issue', { ok: true, expiresAt: '2026-10-02T12:00:00Z' })
    scripted('download_redeem', { ok: true, storageKey: STORAGE_KEY, filename: FILENAME, mime: 'application/pdf' })

    const issued = await post(request(issueBody()), unconfigured)
    expect(issued.status).toBe(200)
    expect(calls('download_issue')[0]!.p_mode).toBe('test')

    const redeemed = await post(request(redeemBody()), unconfigured)
    expect(redeemed.status).toBe(200)
    expect(calls('download_redeem')[0]!.p_mode).toBe('test')
    const url = new URL((await replyOf(redeemed)).data.url)
    expect(url.origin + url.pathname).toBe(`http://127.0.0.1:54321/storage/v1/object/sign/paid-files/${STORAGE_KEY}`)
    expect(url.searchParams.get('download')).toBe(FILENAME)
  })

  it('with no Moyasar configuration and no usable public base, nothing is called: a redeem never spends a use on a link it cannot build', async () => {
    vi.stubEnv('PAYMENTS_MODE', 'live')
    for (const base of ['', 'not a url']) {
      vi.stubEnv('FUNCTIONS_PUBLIC_URL', base)
      for (const body of [issueBody(), redeemBody()]) {
        expect((await post(request(body), { config: { ok: false, reason: 'KEY_MODE_MISMATCH' } })).status).toBe(503)
      }
    }
    // A mode that is not one is no mode at all.
    vi.stubEnv('PAYMENTS_MODE', 'production')
    vi.stubEnv('FUNCTIONS_PUBLIC_URL', 'http://127.0.0.1:54321/functions/v1')
    expect((await post(request(redeemBody()), { config: { ok: false, reason: 'BAD_MODE' } })).status).toBe(503)
    expect(recorded).toHaveLength(0)
    expect(signer).not.toHaveBeenCalled()
  })

  it('puts Referrer-Policy: no-referrer and Cache-Control: no-store on every reply, whatever its status', async () => {
    scripted('download_issue', { ok: true, expiresAt: '2026-10-02T12:00:00Z' })
    scripted('download_redeem', { ok: true, storageKey: STORAGE_KEY, filename: FILENAME, mime: 'application/pdf' })
    const responses = [
      await post(request(issueBody())),
      await post(request(redeemBody())),
      await post(request(redeemBody(), { origin: 'https://evil.test' })),
      await post(request('{nope')),
      await post(request(redeemBody({ downloadToken: 'x' }))),
      await post(new Request('http://127.0.0.1:54321/functions/v1/download', { method: 'GET' })),
    ]
    scripted('download_redeem', { ok: false, code: 'NOT_FOUND' })
    responses.push(await post(request(redeemBody())))
    scripted('download_redeem', dbError('XX000'))
    responses.push(await post(request(redeemBody())))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 403, 400, 422, 405, 404, 500])
    for (const response of responses) {
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('issue', () => {
  it('mints a random token, stores only its hash, and answers the token and when it expires', async () => {
    scripted('download_issue', { ok: true, expiresAt: '2026-10-02T12:15:00.000Z' })
    const response = await post(request(issueBody()))
    expect(response.status).toBe(200)
    const reply = await replyOf(response)
    expect(reply.data).toEqual({ downloadToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: '2026-10-02T12:15:00.000Z' })
    const minted = reply.data.downloadToken as string

    expect(names()).toEqual(['download_issue'])
    expect(calls('download_issue')[0]).toEqual({
      p_order_number: NUMBER,
      p_access_token_hash: sha256(`${PEPPER}:order:${TOKEN}`),
      p_item: ITEM,
      p_download_token_hash: sha256(`${PEPPER}:download:${minted}`),
      p_ip_hash: await clientKeyHash(request(issueBody()), PEPPER),
      p_mode: 'test',
    })
    // Neither token reaches the database or the signer.
    expect(JSON.stringify(recorded)).not.toContain(minted)
    expect(JSON.stringify(recorded)).not.toContain(TOKEN)
    expect(signer).not.toHaveBeenCalled()
  })

  it('mints a different token every time', async () => {
    scripted('download_issue', { ok: true, expiresAt: 'x' })
    const tokens = new Set<string>()
    for (let i = 0; i < 20; i += 1) tokens.add((await replyOf(await post(request(issueBody())))).data.downloadToken)
    expect(tokens.size).toBe(20)
    expect(new Set(calls('download_issue').map((args) => args.p_download_token_hash)).size).toBe(20)
  })

  it.each([
    ['NOT_FOUND', 404],
    ['TOO_MANY_DOWNLOADS', 429],
  ])('maps %s to %i', async (code, status) => {
    scripted('download_issue', { ok: false, code })
    const response = await post(request(issueBody()))
    expect(response.status).toBe(status)
    expect((await replyOf(response)).error).toMatchObject({ code, message: expect.any(String) })
    // A refused issue hands out no token.
    expect(JSON.stringify(await replyOf(await post(request(issueBody()))))).not.toContain('downloadToken')
  })

  it('answers the throttle with 429, and anything else (a refusal it does not know, an unreadable answer, a failure) with a detail-free 500', async () => {
    scripted('download_issue', dbError('54000'))
    expect((await post(request(issueBody()))).status).toBe(429)
    for (const reply of [dbError('XX000'), null, { ok: false, code: 'SOMETHING_NEW' }]) {
      scripted('download_issue', reply)
      const response = await post(request(issueBody()))
      expect(response.status).toBe(500)
      expect(JSON.stringify(await replyOf(response))).not.toContain('detail that must never leave')
    }
  })
})

describe('redeem', () => {
  const good = { ok: true, storageKey: STORAGE_KEY, filename: FILENAME, mime: 'application/pdf' }

  it('answers a 60-second signed URL on the public Storage base with the file\'s own name, and only that', async () => {
    scripted('download_redeem', good)
    const response = await post(request(redeemBody()))
    expect(response.status).toBe(200)
    const reply = await replyOf(response)
    expect(Object.keys(reply.data)).toEqual(['url'])

    expect(names()).toEqual(['download_redeem'])
    expect(calls('download_redeem')[0]).toEqual({
      p_download_token_hash: sha256(`${PEPPER}:download:${DOWNLOAD_TOKEN}`),
      p_ip_hash: await clientKeyHash(request(redeemBody()), PEPPER),
      p_mode: 'test',
    })
    expect(signer).toHaveBeenCalledTimes(1)
    expect(signer).toHaveBeenCalledWith(STORAGE_KEY, 60)

    // Rebuilt on the public base: the runtime's internal address never reaches the browser.
    const url = new URL(reply.data.url)
    expect(url.origin).toBe('http://127.0.0.1:54321')
    expect(url.pathname).toBe(`/storage/v1/object/sign/paid-files/${STORAGE_KEY}`)
    expect(url.searchParams.get('token')).toBe(SIGNED_TOKEN)
    expect(url.searchParams.get('download')).toBe(FILENAME)
    expect(reply.data.url).not.toContain('kong')
    // The download token never goes to the database or the signer.
    expect(JSON.stringify(recorded)).not.toContain(DOWNLOAD_TOKEN)
    // The key is inside the URL and nowhere else in the reply.
    expect(JSON.stringify(reply).split(STORAGE_KEY)).toHaveLength(2)
  })

  it('uses the public Storage base of a hosted project', async () => {
    scripted('download_redeem', good)
    const hosted = { ...config, storageBase: 'https://abcdefghijklmnop.supabase.co/storage/v1' }
    const reply = await replyOf(await post(request(redeemBody()), { config: hosted }))
    const url = new URL(reply.data.url)
    expect(url.origin).toBe('https://abcdefghijklmnop.supabase.co')
    expect(url.pathname.startsWith('/storage/v1/object/sign/paid-files/')).toBe(true)
  })

  it.each([
    ['spaces and Arabic', 'كتاب أنس.pdf'],
    ['an ampersand, a hash and a question mark', 'a&b#c?d.pdf'],
    ['quotes and a percent sign', '"50%".epub'],
    ['a plus sign', 'c++ guide.pdf'],
  ])('carries a file name with %s to the browser exactly, encoded once', async (_label, filename) => {
    scripted('download_redeem', { ...good, filename })
    const reply = await replyOf(await post(request(redeemBody())))
    expect(new URL(reply.data.url).searchParams.get('download')).toBe(filename)
    // Encoded once: no `%25` (a percent sign that is itself encoded) unless the name has a percent sign.
    expect(reply.data.url.includes('%25')).toBe(filename.includes('%'))
  })

  it('answers NOT_FOUND with 404 and signs nothing, the throttle with 429, and anything else with a detail-free 500', async () => {
    scripted('download_redeem', { ok: false, code: 'NOT_FOUND' })
    const missing = await post(request(redeemBody()))
    expect(missing.status).toBe(404)
    expect((await replyOf(missing)).error).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) })
    expect(signer).not.toHaveBeenCalled()

    scripted('download_redeem', dbError('54000'))
    expect((await post(request(redeemBody()))).status).toBe(429)
    for (const reply of [dbError('XX000'), null, { ok: false, code: 'SOMETHING_NEW' }]) {
      scripted('download_redeem', reply)
      const response = await post(request(redeemBody()))
      expect(response.status).toBe(500)
      expect(JSON.stringify(await replyOf(response))).not.toContain('detail that must never leave')
    }
    expect(signer).not.toHaveBeenCalled()
  })

  it('answers a detail-free 500 when the database answers a file without its key or name, or Storage cannot sign', async () => {
    for (const reply of [{ ok: true }, { ok: true, storageKey: STORAGE_KEY }, { ok: true, filename: FILENAME }, { ok: true, storageKey: 7, filename: FILENAME }]) {
      scripted('download_redeem', reply)
      expect((await post(request(redeemBody()))).status).toBe(500)
    }
    expect(signer).not.toHaveBeenCalled()

    scripted('download_redeem', good)
    const throwing = vi.fn(async () => {
      throw new Error(`storage said ${STORAGE_KEY}`)
    })
    const failed = await post(request(redeemBody()), { signer: throwing })
    expect(failed.status).toBe(500)
    const text = JSON.stringify(await replyOf(failed))
    expect(text).not.toContain(STORAGE_KEY)
    expect(text).not.toContain('storage said')
    // A signer that answers something that is not a Storage signed-object URL is a fault too, and nothing is returned.
    const foreign = vi.fn(async () => 'https://elsewhere.test/file.pdf?token=x')
    const refused = await post(request(redeemBody()), { signer: foreign })
    expect(refused.status).toBe(500)
    expect(JSON.stringify(await replyOf(refused))).not.toContain('elsewhere')
  })
})

describe('publicFileUrl', () => {
  it('replaces the base, keeps the path and the token, and appends the name', () => {
    const url = publicFileUrl(`${INTERNAL}/object/sign/paid-files/assets/a/b?token=T.T.T`, 'https://x.supabase.co/storage/v1', 'f.pdf')
    expect(url).toBe('https://x.supabase.co/storage/v1/object/sign/paid-files/assets/a/b?token=T.T.T&download=f.pdf')
  })

  it('is null for a URL that is not a signed-object URL, or a base that is not a URL', () => {
    expect(publicFileUrl('https://elsewhere.test/file.pdf', 'https://x.supabase.co/storage/v1', 'f.pdf')).toBeNull()
    expect(publicFileUrl('', 'https://x.supabase.co/storage/v1', 'f.pdf')).toBeNull()
    expect(publicFileUrl(`${INTERNAL}/object/sign/paid-files/a?token=T`, 'not a url', 'f.pdf')).toBeNull()
  })
})
