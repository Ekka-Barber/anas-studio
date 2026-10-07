// P06: `src/lib/turnstile.ts` — fail-closed siteverify checks. The shapes
// come from developers.cloudflare.com/turnstile/get-started/server-side-
// validation (fetched 2026-09-26); the test-secret reply shape
// (hostname "example.com", no action field) was verified live and is recorded
// in artifacts/acceptance/P06/siteverify-live-test-secret.json.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isTurnstileUnavailable, verifyTurnstile } from '../../supabase/functions/_shared/turnstile.ts'

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...savedEnv }
})

afterEach(() => {
  process.env = savedEnv
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const PASS_SECRET = '1x0000000000000000000000000000000AA'
const REAL_SECRET = '0x4AAAAAAA_real_secret_key_example'

const base = { token: 'tok', remoteIp: '203.0.113.7', expectedAction: 'contact', expectedHostname: 'anas.studio' }

function reply(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

describe('verifyTurnstile', () => {
  it('success with the expected action and hostname', async () => {
    reply({ success: true, action: 'contact', hostname: 'anas.studio' })
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: true })
  })

  it('a failed challenge (success:false) is INVALID_TOKEN', async () => {
    reply({ success: false, 'error-codes': ['invalid-input-response'] })
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'INVALID_TOKEN' })
  })

  it.each(['invalid-input-secret', 'missing-input-secret', 'internal-error'])(
    'the server-side code %s is MISCONFIGURED, logged by code only, not "you are not human"',
    async (code) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      reply({ success: false, 'error-codes': [code] })
      expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'MISCONFIGURED' })
      expect(warn.mock.calls).toEqual([[expect.any(String), [code]]])
      warn.mockRestore()
    },
  )

  it.each(['invalid-input-response', 'timeout-or-duplicate'])(
    'the visitor-side code %s stays INVALID_TOKEN and is not logged',
    async (code) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      reply({ success: false, 'error-codes': [code] })
      expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'INVALID_TOKEN' })
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    },
  )

  it('callers answer 503 for every failure that is not the visitor\'s', () => {
    for (const code of ['UNREACHABLE', 'MISCONFIGURED', 'TEST_SECRET_IN_PRODUCTION'] as const) {
      expect(isTurnstileUnavailable(code)).toBe(true)
    }
    for (const code of ['INVALID_TOKEN', 'ACTION_MISMATCH', 'HOSTNAME_MISMATCH'] as const) {
      expect(isTurnstileUnavailable(code)).toBe(false)
    }
  })

  it('a wrong action is ACTION_MISMATCH', async () => {
    reply({ success: true, action: 'login', hostname: 'anas.studio' })
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'ACTION_MISMATCH' })
  })

  it('a missing action is ACTION_MISMATCH too (the widget always sets one)', async () => {
    reply({ success: true, hostname: 'anas.studio' })
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'ACTION_MISMATCH' })
  })

  it('a wrong hostname is HOSTNAME_MISMATCH', async () => {
    reply({ success: true, action: 'contact', hostname: 'evil.example' })
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'HOSTNAME_MISMATCH' })
  })

  it('an unreachable siteverify is UNREACHABLE (fail closed, never assume ok)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'UNREACHABLE' })
  })

  it('a malformed reply is UNREACHABLE as well', async () => {
    reply('<html>not json</html>')
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: false, code: 'UNREACHABLE' })
  })

  it('a test secret is refused outright for a hosted site, without calling siteverify', async () => {
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await verifyTurnstile({ ...base, secret: PASS_SECRET })).toEqual({
      ok: false,
      code: 'TEST_SECRET_IN_PRODUCTION',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a test secret for a local SITE_URL skips hostname and action checks (its reply has neither of ours)', async () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    reply({ success: true, hostname: 'example.com' })
    expect(await verifyTurnstile({ ...base, secret: PASS_SECRET })).toEqual({ ok: true })
  })
})

// FABLE-AUDIT T-13: the request itself. A wrong URL or field name would fail every visitor against the real siteverify,
// and the visitor's address must not be sent when there is none.
describe('the siteverify request', () => {
  /** Records every request and answers a valid challenge. */
  function capture(): Array<{ url: string; init: RequestInit }> {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response(JSON.stringify({ success: true, action: 'contact', hostname: 'anas.studio' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    return calls
  }

  it('posts the secret, the token and the visitor address as JSON to Cloudflare, with a timeout', async () => {
    const calls = capture()
    expect(await verifyTurnstile({ ...base, secret: REAL_SECRET })).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(calls[0]!.init.method).toBe('POST')
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ secret: REAL_SECRET, response: 'tok', remoteip: '203.0.113.7' })
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['no address', undefined],
    ["the literal 'local' (a direct local call)", 'local'],
  ])('with %s, remoteip is left out of the body', async (_label, remoteIp) => {
    const calls = capture()
    expect(await verifyTurnstile({ ...base, remoteIp, secret: REAL_SECRET })).toEqual({ ok: true })
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ secret: REAL_SECRET, response: 'tok' })
  })
})
