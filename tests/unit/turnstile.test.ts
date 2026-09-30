// P06: `src/lib/turnstile.ts` — fail-closed siteverify checks. The shapes
// come from developers.cloudflare.com/turnstile/get-started/server-side-
// validation (fetched 2026-09-26); the test-secret reply shape
// (hostname "example.com", no action field) was verified live and is recorded
// in artifacts/acceptance/P06/siteverify-live-test-secret.json.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyTurnstile } from '../../supabase/functions/_shared/turnstile.ts'

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
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await verifyTurnstile({ ...base, secret: PASS_SECRET })).toEqual({
      ok: false,
      code: 'TEST_SECRET_IN_PRODUCTION',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a test secret for a local SITE_URL skips hostname and action checks (its reply has neither of ours)', async () => {
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    reply({ success: true, hostname: 'example.com' })
    expect(await verifyTurnstile({ ...base, secret: PASS_SECRET })).toEqual({ ok: true })
  })
})
