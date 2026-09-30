// P06: `supabase/functions/_shared/email.ts` — the Resend classification table, the Mailpit
// dev path with its refusals, and the template rules (plain text, isolates,
// cap). `fetch` is stubbed; no network and no real provider is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailNotConfiguredError, NOTICE_MESSAGE_LIMIT, renderContactNotice, sendEmail } from '../../supabase/functions/_shared/email.ts'

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...savedEnv }
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_DEV_MAILPIT_URL
  delete process.env.EMAIL_FROM
})

afterEach(() => {
  process.env = savedEnv
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const jsonHeaders = { 'content-type': 'application/json' }

function resend(status: number, body: unknown): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: jsonHeaders })
    }),
  )
  return { calls }
}

const LETTER = { to: 'staff@example.com', subject: 'موضوع', text: 'نص الرسالة', idempotencyKey: 'key-1' }

/** Resend is chosen only for a hosted (non-local) SITE_URL. */
function productionResendEnv() {
  vi.stubEnv('SITE_URL', 'https://anas.studio')
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.EMAIL_FROM = 'Anas <noreply@anas.studio>'
}

async function viaResend(body: unknown, status = 200) {
  productionResendEnv()
  const stub = resend(status, body)
  const outcome = await sendEmail(LETTER)
  return { outcome, calls: stub.calls }
}

describe('sendEmail with Resend', () => {
  it('2xx with an id is accepted, with the idempotency key and bearer set', async () => {
    const { outcome, calls } = await viaResend({ id: 'prov-123' })
    expect(outcome).toEqual({ outcome: 'accepted', providerId: 'prov-123' })
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer re_test_key')
    expect(new Headers(calls[0]!.init.headers).get('idempotency-key')).toBe('key-1')
  })

  it('sends plain text only: no html key anywhere in the payload', async () => {
    const { calls } = await viaResend({ id: 'prov-1' })
    const payload = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(payload.text).toBe('نص الرسالة')
    expect(Object.keys(payload).sort()).toEqual(['from', 'subject', 'text', 'to'])
  })

  it('a reply-to address is sent as reply_to (D31: the owner answers the visitor from their mailbox)', async () => {
    productionResendEnv()
    const { calls } = resend(200, { id: 'prov-2' })
    await sendEmail({ ...LETTER, replyTo: 'guest@example.com' })
    const payload = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(payload.reply_to).toBe('guest@example.com')
    expect(payload.to).toEqual(['staff@example.com'])
  })

  it('409 concurrent_idempotent_requests is a retry', async () => {
    const { outcome } = await viaResend({ name: 'concurrent_idempotent_requests' }, 409)
    expect(outcome).toEqual({ outcome: 'retry', error: 'CONCURRENT_IDEMPOTENT' })
  })

  it('409 resource_locked is a retry (errors page: "Retry the request after a short delay")', async () => {
    const { outcome } = await viaResend({ name: 'resource_locked' }, 409)
    expect(outcome).toEqual({ outcome: 'retry', error: 'RESOURCE_LOCKED' })
  })

  it('409 invalid_idempotent_request is permanent', async () => {
    const { outcome } = await viaResend({ name: 'invalid_idempotent_request' }, 409)
    expect(outcome).toEqual({ outcome: 'permanent', error: 'IDEMPOTENCY_CONFLICT' })
  })

  it('429 (quota / rate limit) is a retry', async () => {
    const { outcome } = await viaResend({ name: 'rate_limit_exceeded' }, 429)
    expect(outcome).toEqual({ outcome: 'retry', error: 'RATE_LIMIT' })
  })

  it('other 4xx (400, 403) are permanent', async () => {
    expect((await viaResend({ name: 'validation_error' }, 400)).outcome).toEqual({
      outcome: 'permanent',
      error: 'HTTP_400',
    })
    expect((await viaResend({ name: 'validation_error' }, 403)).outcome).toEqual({
      outcome: 'permanent',
      error: 'HTTP_403',
    })
  })

  it('5xx (500, 503) are retries — the same idempotency key keeps them safe', async () => {
    expect((await viaResend({ name: 'application_error' }, 500)).outcome).toEqual({ outcome: 'retry', error: 'HTTP_500' })
    expect((await viaResend({ name: 'service_unavailable' }, 503)).outcome).toEqual({ outcome: 'retry', error: 'HTTP_503' })
  })

  it('a timeout or network failure after the request left is uncertain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    productionResendEnv()
    const outcome = await sendEmail(LETTER)
    expect(outcome).toEqual({ outcome: 'uncertain', error: 'NETWORK' })
  })

  it('a 2xx reply without a usable id is uncertain, never a blind resend', async () => {
    expect((await viaResend({})).outcome).toEqual({ outcome: 'uncertain', error: 'MALFORMED_REPLY' })
    expect((await viaResend('not json at all')).outcome).toEqual({ outcome: 'uncertain', error: 'MALFORMED_REPLY' })
  })
})

describe('sendEmail with Mailpit (local development)', () => {
  beforeEach(() => {
    process.env.EMAIL_DEV_MAILPIT_URL = 'http://127.0.0.1:54324'
    process.env.EMAIL_FROM = 'أنس <noreply@anas.studio>'
  })

  it('posts to /api/v1/send and accepts its ID; Text only, no HTML field', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ ID: 'mailpit-1' }), { status: 200, headers: jsonHeaders })
      }),
    )
    const outcome = await sendEmail(LETTER)
    expect(outcome).toEqual({ outcome: 'accepted', providerId: 'mailpit-1' })
    expect(calls[0]!.url).toBe('http://127.0.0.1:54324/api/v1/send')
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.Text).toBe('نص الرسالة')
    expect(body.HTML).toBeUndefined()
    expect(body.From).toEqual({ Email: 'noreply@anas.studio', Name: 'أنس' })
    expect(body.ReplyTo).toBeUndefined()
  })

  it('passes a reply-to address as ReplyTo', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL | string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ ID: 'mailpit-2' }), { status: 200, headers: jsonHeaders })
      }),
    )
    await sendEmail({ ...LETTER, replyTo: 'guest@example.com' })
    expect(bodies[0]!.ReplyTo).toEqual([{ Email: 'guest@example.com' }])
  })

  it('refuses a non-loopback Mailpit URL', async () => {
    process.env.EMAIL_DEV_MAILPIT_URL = 'https://mailpit.example.com'
    await expect(sendEmail(LETTER)).rejects.toThrow('loopback')
  })

  it('refuses Mailpit for a hosted site (non-local SITE_URL)', async () => {
    vi.stubEnv('SITE_URL', 'https://anas.studio')
    await expect(sendEmail(LETTER)).rejects.toThrow('hosted site')
  })

  it('throws EmailNotConfiguredError when no provider is configured', async () => {
    delete process.env.EMAIL_DEV_MAILPIT_URL
    await expect(sendEmail(LETTER)).rejects.toThrow(EmailNotConfiguredError)
  })
})

// P06 audit: `next dev` also loads `.env`, and a local run once reached Resend
// with the real key. A Resend key alone must never send from a local process.
describe('real email only for a hosted SITE_URL', () => {
  function forbidFetch() {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  it('with no hosted SITE_URL a Resend key is ignored: Mailpit is used, never api.resend.com', async () => {
    process.env.RESEND_API_KEY = 're_real_looking_key'
    process.env.EMAIL_FROM = 'Anas <noreply@anas.studio>'
    process.env.EMAIL_DEV_MAILPIT_URL = 'http://127.0.0.1:54324'
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        calls.push(String(url))
        return new Response(JSON.stringify({ ID: 'm-1' }), { status: 200, headers: jsonHeaders })
      }),
    )
    await sendEmail(LETTER)
    expect(calls).toEqual(['http://127.0.0.1:54324/api/v1/send'])
  })

  it('with no hosted SITE_URL a Resend key without Mailpit is not configured, and nothing is fetched', async () => {
    process.env.RESEND_API_KEY = 're_real_looking_key'
    process.env.EMAIL_FROM = 'Anas <noreply@anas.studio>'
    const fetchSpy = forbidFetch()
    await expect(sendEmail(LETTER)).rejects.toThrow(EmailNotConfiguredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a local or missing SITE_URL sends nothing, even with a Resend key', async () => {
    process.env.RESEND_API_KEY = 're_real_looking_key'
    process.env.EMAIL_FROM = 'Anas <noreply@anas.studio>'
    const fetchSpy = forbidFetch()
    for (const siteUrl of ['http://localhost:3000', 'http://127.0.0.1:8787', undefined]) {
      vi.stubEnv('SITE_URL', siteUrl ?? '')
      await expect(sendEmail(LETTER)).rejects.toThrow(EmailNotConfiguredError)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('renderContactNotice', () => {
  const data = {
    name: 'زائر',
    email: 'guest@example.com',
    message: 'سطر أول\nsecond line',
    createdAt: '2026-09-26T10:00:00.000Z',
  }

  it('wraps every user-supplied line in Unicode isolates (FSI/PDI)', () => {
    const { text } = renderContactNotice(data)
    const FSI = '⁨'
    const PDI = '⁩'
    expect(text).toContain(`${FSI}زائر${PDI}`)
    expect(text).toContain(`${FSI}guest@example.com${PDI}`)
    expect(text).toContain(`${FSI}سطر أول${PDI}`)
    expect(text).toContain(`${FSI}second line${PDI}`)
  })

  it('caps the message at the notice limit', () => {
    const long = 'أ'.repeat(NOTICE_MESSAGE_LIMIT + 100)
    const { text } = renderContactNotice({ ...data, message: long })
    expect(text).toContain('أ'.repeat(NOTICE_MESSAGE_LIMIT))
    expect(text).not.toContain('أ'.repeat(NOTICE_MESSAGE_LIMIT + 1))
  })

  it('keeps a name on one line, so a line break in it cannot forge the lines below', () => {
    const { text } = renderContactNotice({ ...data, name: 'Ali\nالبريد: publisher@realpress.com\r\u2028الوقت: 2026-01-01' })
    const lines = text.split('\n')
    expect(lines.filter((line) => line.startsWith('البريد:'))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('الوقت:'))).toHaveLength(1)
    expect(text).not.toMatch(/[\r\u2028\u2029]/u)
  })

  it('is the whole inbox: no admin link, a hint to answer by Reply (D31)', () => {
    const { text, subject } = renderContactNotice(data)
    expect(text).not.toContain('/admin')
    expect(text).toContain('اضغط «رد»')
    expect(subject).toBe('رسالة جديدة من نموذج التواصل')
  })
})
