// P06: `supabase/functions/_shared/email.ts` — the Resend classification table, the Mailpit
// dev path with its refusals, and the template rules (plain text, isolates,
// cap). `fetch` is stubbed; no network and no real provider is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AlertEmailData,
  EmailNotConfiguredError,
  NOTICE_MESSAGE_LIMIT,
  type NotifyEmailData,
  type OrderEmailData,
  renderAvailability,
  renderContactNotice,
  renderNotifyConfirm,
  renderOrderLink,
  renderOrderReady,
  renderOrderRefunded,
  renderOrderShipped,
  renderOwnerAlert,
  renderReceipt,
  sendEmail,
} from '../../supabase/functions/_shared/email.ts'

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

  // FABLE-AUDIT T-12: the outbox stops the run and gives the attempt back only on QUOTA, so the quota names must never
  // read as a plain rate limit (or the reverse).
  it.each([
    ['daily_quota_exceeded', 'QUOTA', 'You have reached your daily email sending quota.'],
    ['monthly_quota_exceeded', 'QUOTA', 'You have reached your monthly email sending quota.'],
    ['rate_limit_exceeded', 'RATE_LIMIT', 'Too many requests. Please limit the number of requests per second.'],
  ])('429 %s is a retry as %s', async (name, error, message) => {
    const { outcome } = await viaResend({ statusCode: 429, name, message }, 429)
    expect(outcome).toEqual({ outcome: 'retry', error })
  })

  it('other 4xx (400, 404, 422) are permanent', async () => {
    expect((await viaResend({ name: 'validation_error' }, 400)).outcome).toEqual({
      outcome: 'permanent',
      error: 'HTTP_400',
    })
    expect((await viaResend({ name: 'not_found' }, 404)).outcome).toEqual({ outcome: 'permanent', error: 'HTTP_404' })
    expect((await viaResend({ name: 'validation_error' }, 422)).outcome).toEqual({ outcome: 'permanent', error: 'HTTP_422' })
  })

  // FABLE-AUDIT F1-4: the account refused the call. Permanent, every queued mail was exhausted on its first attempt.
  it('403 validation_error about the domain is the account\'s refusal: a retry as PROVIDER_CONFIG, never permanent', async () => {
    const unverified = { statusCode: 403, name: 'validation_error', message: 'The anas.studio domain is not verified. Please, add and verify your domain.' }
    expect((await viaResend(unverified, 403)).outcome).toEqual({ outcome: 'retry', error: 'PROVIDER_CONFIG' })
  })

  it('401 (a missing or revoked key) is PROVIDER_CONFIG too', async () => {
    expect((await viaResend({ statusCode: 401, name: 'missing_api_key', message: 'Missing API key in the authorization header.' }, 401)).outcome).toEqual({
      outcome: 'retry',
      error: 'PROVIDER_CONFIG',
    })
    expect((await viaResend({ name: 'restricted_api_key' }, 401)).outcome).toEqual({ outcome: 'retry', error: 'PROVIDER_CONFIG' })
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

  it('drops the visitor\'s own embeddings, overrides and isolates from every value, so none can reverse the rest of its line (F1-6)', () => {
    const RLO = String.fromCharCode(0x202e)
    const controls = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((code) => String.fromCharCode(code))
    const OPEN = String.fromCharCode(0x2068)
    const CLOSE = String.fromCharCode(0x2069)
    const { text } = renderContactNotice({
      ...data,
      name: `${RLO}fdp.exe`,
      email: `guest${RLO}@example.com`,
      message: `سطر ${controls.join('')}أول\nsecond${RLO} line`,
    })
    expect(text).toContain(`الاسم: ${OPEN}fdp.exe${CLOSE}`)
    expect(text).toContain(`البريد: ${OPEN}guest@example.com${CLOSE}`)
    expect(text).toContain(`${OPEN}سطر أول${CLOSE}`)
    expect(text).toContain(`${OPEN}second line${CLOSE}`)
    expect(text).not.toContain(RLO)
    // Only our own isolates are left, one pair per value.
    const ours = text.replaceAll(OPEN, '').replaceAll(CLOSE, '')
    for (const control of controls) expect(ours).not.toContain(control)
    expect(text.split(OPEN).length).toBe(text.split(CLOSE).length)
  })

  // FABLE-AUDIT F3-16 (a), QUALITY-03: the name and the address are cleaned as every order mail's value is (`one()`), not by the narrower
  // rule of the message body: the C0 line and paragraph separators and the three invisible marks used to get through.
  it('cleans the name and the address as every order mail\'s value is: every control character and separator, every bidi control', () => {
    const OPEN = String.fromCharCode(0x2068)
    const CLOSE = String.fromCharCode(0x2069)
    // VT, FF, FS, GS, RS (mandatory breaks), US, NEL, LS and PS; LRM, RLM and ALM; and an override.
    const breaks = String.fromCharCode(0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x2028, 0x2029)
    const marks = String.fromCharCode(0x200e, 0x200f, 0x061c, 0x202e)
    const { text } = renderContactNotice({
      ...data,
      name: `مها${breaks}البريد: publisher@realpress.com${marks}${breaks}الوقت: 2026-01-01`,
      email: `guest${marks}@example${breaks}.com`,
    })
    const lines = text.split('\n')
    expect(lines.filter((line) => line.startsWith('البريد:'))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('الوقت:'))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('الاسم:'))).toEqual([`الاسم: ${OPEN}مها البريد: publisher@realpress.com الوقت: 2026-01-01${CLOSE}`])
    expect(lines.filter((line) => line.startsWith('البريد:'))).toEqual([`البريد: ${OPEN}guest@example .com${CLOSE}`])
    // Only our own isolates are left of the control characters and the marks, and every one is paired.
    const ours = text.replaceAll(OPEN, '').replaceAll(CLOSE, '')
    expect(ours).not.toMatch(/[\u000b\u000c\u001c-\u001f\u0085\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/u)
    expect(text.split(OPEN).length).toBe(text.split(CLOSE).length)
  })

  // FABLE-AUDIT F3 (the auditor's A6): the message keeps its lines, but every line and paragraph separator ends one, so none sits
  // inside a line's isolate (a paragraph separator would end it early), and each line is cleaned as one() cleans a value.
  it('ends a message line at every line and paragraph separator, and cleans each line of bidi and other control characters', () => {
    const OPEN = String.fromCharCode(0x2068)
    const CLOSE = String.fromCharCode(0x2069)
    const marks = String.fromCharCode(0x200e, 0x200f, 0x061c, 0x202e)
    // CRLF, CR, VT, FS, NEL, LS and PS between the lines; a tab and a unit separator (a segment separator) inside the last one.
    const message = `أ${marks}1\r\nب2\rج3\u000bد4\u001cه5\u0085و6\u2028ز7\u2029ح8\tنهاية\u001f`
    const { text } = renderContactNotice({ ...data, message })
    const lines = text.split('\n')
    const body = lines.slice(lines.indexOf('نص الرسالة:') + 1, lines.indexOf('نص الرسالة:') + 9)
    expect(body).toEqual([`${OPEN}أ1${CLOSE}`, `${OPEN}ب2${CLOSE}`, `${OPEN}ج3${CLOSE}`, `${OPEN}د4${CLOSE}`, `${OPEN}ه5${CLOSE}`, `${OPEN}و6${CLOSE}`, `${OPEN}ز7${CLOSE}`, `${OPEN}ح8 نهاية ${CLOSE}`])
    const ours = text.replaceAll(OPEN, '').replaceAll(CLOSE, '')
    expect(ours).not.toMatch(/[\r\t\u000b\u000c\u001c-\u001f\u0085\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/u)
    expect(text.split(OPEN).length).toBe(text.split(CLOSE).length)
  })

  it('is the whole inbox: no admin link, a hint to answer by Reply (D31)', () => {
    const { text, subject } = renderContactNotice(data)
    expect(text).not.toContain('/admin')
    expect(text).toContain('اضغط «رد»')
    expect(subject).toBe('رسالة جديدة من نموذج التواصل')
  })
})

// ---------------------------------------------------------------------------
// P08 round 5: the order mail. Pure functions: no environment, no network.

const FSI = String.fromCharCode(0x2068)
const PDI = String.fromCharCode(0x2069)
const isolated = (value: string): string => `${FSI}${value}${PDI}`
// Every bidi formatting character: the marks, the embeddings and overrides, the isolates.
const BIDI = /\p{Bidi_Control}/u
const SITE = 'https://anas.studio'
const TOKEN = 'tok_AbC-123_xyz'
const SAR = 'ر.س'

const SIGNED = {
  itemId: 'item-signed',
  title: 'كتاب الورد',
  variantTitle: 'نسخة موقّعة',
  quantity: 1,
  total: 4500,
  fulfillment: 'signed',
  preorder: null,
  hasFile: false,
}
const DIGITAL = { ...SIGNED, itemId: 'item-digital', variantTitle: 'نسخة رقمية', quantity: 2, total: 1800, fulfillment: 'digital', hasFile: true }

function orderData(over: Partial<OrderEmailData> = {}): OrderEmailData {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    orderNumber: 'ABCD2345',
    status: 'paid',
    environment: 'live',
    customerName: 'منى',
    customerEmail: 'mona@example.com',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    tokenVersion: 0,
    totals: { subtotal: 7000, discount: 700, shipping: 2500, total: 8800 },
    lines: [SIGNED, DIGITAL],
    seller: { legalName: 'مؤسسة الورد', address: 'تبوك', registration: 'REG-1234' },
    paidAt: '2026-10-02T10:00:00.000Z',
    refundedHalalas: 0,
    ...over,
  }
}

const LINK = `${SITE}/orders#ABCD2345.${TOKEN}`

describe('renderReceipt', () => {
  it('a paid order: every line with its total, the totals, the order link, the seller', () => {
    const { subject, text } = renderReceipt(orderData(), SITE, TOKEN)
    expect(subject).toBe(`إيصال طلبك رقم ${isolated('ABCD2345')}`)
    expect(text).toContain(`مرحبًا ${isolated('منى')}،`)
    expect(text).toContain(`- ${isolated('كتاب الورد')} (${isolated('نسخة موقّعة')}) × 1: 45.00 ${SAR}`)
    expect(text).toContain(`- ${isolated('كتاب الورد')} (${isolated('نسخة رقمية')}) × 2: 18.00 ${SAR}`)
    expect(text).toContain(`المجموع الفرعي: 70.00 ${SAR}`)
    expect(text).toContain(`الخصم: 7.00 ${SAR}`)
    expect(text).toContain(`التوصيل: 25.00 ${SAR}`)
    expect(text).toContain(`الإجمالي المدفوع: 88.00 ${SAR}`)
    expect(text).toContain(LINK)
    expect(text).toContain(`البائع: ${isolated('مؤسسة الورد')}`)
    expect(text).toContain(`رقم التسجيل: ${isolated('REG-1234')}`)
  })

  it('a zero discount and a zero delivery fee leave no line', () => {
    const { text } = renderReceipt(orderData({ totals: { subtotal: 6300, discount: 0, shipping: 0, total: 6300 } }), SITE, TOKEN)
    expect(text).not.toContain('الخصم:')
    expect(text).not.toContain('التوصيل:')
  })

  it('a digital line says its file is on the order page, or that it will be added when there is none yet', () => {
    const ready = renderReceipt(orderData(), SITE, TOKEN).text
    expect(ready).toContain('الملف الرقمي: تجده في صفحة طلبك.')
    const waiting = renderReceipt(orderData({ lines: [{ ...DIGITAL, hasFile: false }] }), SITE, TOKEN).text
    expect(waiting).toContain('الملف الرقمي: سنضيفه إلى صفحة طلبك عند توفره.')
    expect(waiting).not.toContain('تجده في صفحة طلبك')
    // A digital line with nothing to hand out (revoked, or refunded before it was granted) promises no file.
    expect(renderReceipt(orderData({ lines: [{ ...DIGITAL, hasFile: null }] }), SITE, TOKEN).text).not.toContain('الملف الرقمي')
    // A physical line has no file note.
    expect(renderReceipt(orderData({ lines: [SIGNED] }), SITE, TOKEN).text).not.toContain('الملف الرقمي')
  })

  it('a preorder line carries its delivery date and note', () => {
    const preorder = { shipsOn: '2026-12-01', note: 'يصل بعد الطباعة الثانية' }
    const { text } = renderReceipt(orderData({ lines: [{ ...SIGNED, preorder }] }), SITE, TOKEN)
    expect(text).toContain(`طلب مسبق: التسليم المتوقع ${isolated('2026-12-01')}. ${isolated('يصل بعد الطباعة الثانية')}`)
  })

  it('a test order says it is a test and that no real money moved, in the subject and the first line', () => {
    const test = renderReceipt(orderData({ environment: 'test' }), SITE, TOKEN)
    expect(test.subject).toBe(`(تجريبي) إيصال طلبك رقم ${isolated('ABCD2345')}`)
    expect(test.text.split('\n')[0]).toBe('وضع تجريبي: لا يُخصم أي مبلغ حقيقي.')
    const live = renderReceipt(orderData(), SITE, TOKEN)
    expect(live.subject).not.toContain('تجريبي')
    expect(live.text).not.toContain('تجريبي')
  })

  it('an order that is paid_needs_resolution says the payment arrived and the order is being reviewed, and promises nothing else', () => {
    const { subject, text } = renderReceipt(orderData({ status: 'paid_needs_resolution' }), SITE, TOKEN)
    expect(subject).toBe(`وصلتنا دفعتك للطلب رقم ${isolated('ABCD2345')}`)
    expect(text).toContain(`وصلتنا دفعتك للطلب رقم ${isolated('ABCD2345')} بمبلغ 88.00 ${SAR}، ونراجع الطلب الآن.`)
    // No line, no delivery, no file, no shipping, and not called a receipt.
    for (const promise of ['كتاب الورد', 'التسليم', 'الملف', 'شحن', 'إيصال', 'التوصيل', 'المجموع']) {
      expect(`${subject}\n${text}`).not.toContain(promise)
    }
    expect(text).toContain(LINK)
  })

  it('an order already refunded says the payment arrived and went back, never that it is being reviewed, and promises nothing else (F1-5)', () => {
    const { subject, text } = renderReceipt(orderData({ status: 'refunded' }), SITE, TOKEN)
    expect(subject).toBe(`وصلتنا دفعتك للطلب رقم ${isolated('ABCD2345')} وأُعيد المبلغ`)
    expect(text).toContain(`وصلتنا دفعتك للطلب رقم ${isolated('ABCD2345')} بمبلغ 88.00 ${SAR}، وقد أُعيد المبلغ إليك؛ لا يلزمك شيء.`)
    expect(text).not.toContain('نراجع')
    for (const promise of ['كتاب الورد', 'التسليم', 'الملف', 'شحن', 'إيصال', 'التوصيل', 'المجموع']) {
      expect(`${subject}\n${text}`).not.toContain(promise)
    }
    expect(text).toContain(`البائع: ${isolated('مؤسسة الورد')}`)
    expect(text).toContain(LINK)
    // A refunded test order is labelled like every other buyer mail.
    const test = renderReceipt(orderData({ status: 'refunded', environment: 'test' }), SITE, TOKEN)
    expect(test.subject).toBe(`(تجريبي) وصلتنا دفعتك للطلب رقم ${isolated('ABCD2345')} وأُعيد المبلغ`)
  })

  it('is never called a tax invoice and states no tax (D34), paid, under review or refunded', () => {
    for (const status of ['paid', 'paid_needs_resolution', 'refunded']) {
      const { subject, text } = renderReceipt(orderData({ status }), SITE, TOKEN)
      expect(`${subject}\n${text}`).not.toMatch(/ضريب|فاتورة|VAT|tax/iu)
    }
  })
})

describe('the other order mail', () => {
  it('order_link: the order number and the personal link', () => {
    const { subject, text } = renderOrderLink(orderData(), SITE, TOKEN)
    expect(subject).toBe(`رابط طلبك رقم ${isolated('ABCD2345')}`)
    expect(text).toContain(LINK)
  })

  it('order_ready: the listed files only', () => {
    const { subject, text } = renderOrderReady(orderData(), [DIGITAL], SITE, TOKEN)
    expect(subject).toBe(`ملفات طلبك رقم ${isolated('ABCD2345')} جاهزة`)
    expect(text).toContain(`- ${isolated('كتاب الورد')} (${isolated('نسخة رقمية')})`)
    expect(text).not.toContain('نسخة موقّعة')
    expect(text).toContain(LINK)
  })

  it('order_shipped: the carrier, the tracking value and only the shipped items', () => {
    const { subject, text } = renderOrderShipped(
      orderData(),
      { carrier: 'سمسا', tracking: 'TRK 998', itemIds: ['item-signed'] },
      SITE,
      TOKEN,
    )
    expect(subject).toBe(`شحنة جديدة من طلبك رقم ${isolated('ABCD2345')}`)
    expect(text).toContain(`شركة الشحن: ${isolated('سمسا')}`)
    expect(text).toContain(`رقم التتبع: ${isolated('TRK 998')}`)
    expect(text).toContain(`- ${isolated('كتاب الورد')} (${isolated('نسخة موقّعة')}) × 1`)
    expect(text).not.toContain('نسخة رقمية')
    expect(text).toContain(LINK)
  })

  it('order_refunded: the refund and the refunded total, in halalas with two decimals, never the word chargeback', () => {
    const { subject, text } = renderOrderRefunded(orderData({ refundedHalalas: 123456 }), { amount: 5 }, SITE, TOKEN)
    expect(subject).toBe(`استرداد من طلبك رقم ${isolated('ABCD2345')}`)
    expect(text).toContain(`تم استرداد 0.05 ${SAR} من طلبك`)
    expect(text).toContain(`إجمالي ما استُرد من هذا الطلب حتى الآن: 1234.56 ${SAR}.`)
    expect(`${subject}\n${text}`).not.toMatch(/chargeback/iu)
    expect(text).toContain(LINK)
  })

  it('every buyer mail about a test order is labelled', () => {
    const test = orderData({ environment: 'test' })
    const mails = [
      renderOrderLink(test, SITE, TOKEN),
      renderOrderReady(test, [DIGITAL], SITE, TOKEN),
      renderOrderShipped(test, { carrier: 'c', tracking: 't', itemIds: ['item-signed'] }, SITE, TOKEN),
      renderOrderRefunded(test, { amount: 100 }, SITE, TOKEN),
    ]
    for (const mail of mails) {
      expect(mail.subject.startsWith('(تجريبي) ')).toBe(true)
      expect(mail.text.startsWith('وضع تجريبي: لا يُخصم أي مبلغ حقيقي.')).toBe(true)
    }
  })
})

describe('the notification mail', () => {
  const data: NotifyEmailData = {
    status: 'pending',
    tokenVersion: 1,
    email: 'guest@example.com',
    productTitle: 'كتاب الورد',
    variantTitle: 'نسخة موقّعة',
    slug: 'rose-book',
  }

  it('notify_confirm: the confirm link built from the token, valid for 7 days, and no unsubscribe link', () => {
    const { subject, text } = renderNotifyConfirm(data, SITE, TOKEN)
    expect(subject).toBe('أكّد طلب التنبيه')
    expect(text).toContain(`${SITE}/notify/confirm#${TOKEN}`)
    expect(text).toContain('صالح لمدة 7 أيام')
    expect(text).not.toContain('/notify/unsubscribe')
    expect(text).toContain(isolated('كتاب الورد'))
  })

  it('availability: the product link and the unsubscribe link', () => {
    const { subject, text } = renderAvailability(data, SITE, TOKEN)
    expect(subject).toBe(`توفّر ${isolated('كتاب الورد')}`)
    expect(text).toContain(`توفّر ${isolated('كتاب الورد')} (${isolated('نسخة موقّعة')}) الذي طلبت أن نخبرك عنه.`)
    expect(text).toContain(`${SITE}/store/rose-book`)
    expect(text).toContain(`${SITE}/notify/unsubscribe#${TOKEN}`)
    expect(text).not.toContain('/notify/confirm')
    // A variant that is not a preorder, said so or not, is back in stock.
    expect(renderAvailability({ ...data, preorder: false }, SITE, TOKEN).subject).toBe(`توفّر ${isolated('كتاب الورد')}`)
  })

  it('availability of a preorder: open for preorder, never «توفّر»; the rest is the same (F1-7)', () => {
    const { subject, text } = renderAvailability({ ...data, preorder: true }, SITE, TOKEN)
    expect(subject).toBe(`أصبح متاحًا للطلب المسبق ${isolated('كتاب الورد')}`)
    expect(text).toContain(`أصبح متاحًا للطلب المسبق ${isolated('كتاب الورد')} (${isolated('نسخة موقّعة')}) الذي طلبت أن نخبرك عنه.`)
    expect(`${subject}\n${text}`).not.toContain('توفّر')
    expect(text).toContain(`${SITE}/store/rose-book`)
    expect(text).toContain(`${SITE}/notify/unsubscribe#${TOKEN}`)
  })

  it('a slug is encoded into the product link', () => {
    expect(renderAvailability({ ...data, slug: 'a b/c?d' }, SITE, TOKEN).text).toContain(`${SITE}/store/a%20b%2Fc%3Fd`)
  })

  it('the subscriber address is not repeated in either mail', () => {
    expect(renderNotifyConfirm(data, SITE, TOKEN).text).not.toContain('guest@example.com')
    expect(renderAvailability(data, SITE, TOKEN).text).not.toContain('guest@example.com')
  })
})

describe('renderOwnerAlert', () => {
  const ADMIN = `${SITE}/admin/orders`
  const alerts: Array<[AlertEmailData, string[]]> = [
    [
      { alert: 'low_stock', orderNumber: 'ABCD2345', sku: 'SKU-9', stock: 2, threshold: 3 },
      [isolated('SKU-9'), isolated('2'), isolated('3'), isolated('ABCD2345')],
    ],
    [{ alert: 'needs_resolution', orderNumber: 'ABCD2345', amount: 8800 }, [isolated('ABCD2345'), `88.00 ${SAR}`]],
    [
      { alert: 'payment_review', orderNumber: 'ABCD2345', amount: 150, reason: 'AMOUNT_MISMATCH', paymentId: 'pay-1' },
      [isolated('ABCD2345'), `1.50 ${SAR}`, isolated('AMOUNT_MISMATCH'), isolated('pay-1')],
    ],
    [{ alert: 'external_refund', orderNumber: 'ABCD2345', total: 2500 }, [isolated('ABCD2345'), `25.00 ${SAR}`]],
    [{ alert: 'provider_status', orderNumber: 'ABCD2345', status: 'voided' }, [isolated('ABCD2345'), isolated('voided')]],
    [{ alert: 'event_exhausted', eventType: 'payment_paid', paymentId: 'pay-2' }, [isolated('payment_paid'), isolated('pay-2')]],
    [{ alert: 'attempt_unverified', orderNumber: 'ABCD2345', amount: 8800 }, [isolated('ABCD2345'), `88.00 ${SAR}`]],
    [{ alert: 'attempt_duplicate_invoices', orderNumber: 'ABCD2345', amount: 8800 }, [isolated('ABCD2345'), `88.00 ${SAR}`]],
    [{ alert: 'refund_mismatch', orderNumber: 'ABCD2345', amount: 1000 }, [isolated('ABCD2345'), `10.00 ${SAR}`]],
    [{ alert: 'refund_unverified', orderNumber: 'ABCD2345', amount: 1000 }, [isolated('ABCD2345'), `10.00 ${SAR}`]],
    [{ alert: 'refund_total_decreased', orderNumber: 'ABCD2345', amount: 1000 }, [isolated('ABCD2345'), `10.00 ${SAR}`]],
    [
      { alert: 'attempt_mode_changed', orderNumber: 'ABCD2345' },
      [
        `تغيّر وضع الدفع (تجريبي/حقيقي) بينما كانت دفعة الطلب ${isolated('ABCD2345')} قيد التنفيذ؛ راجعها في لوحة بوابة الدفع وفي شاشة المطابقة.`,
      ],
    ],
    [
      { alert: 'refund_mode_changed', orderNumber: 'ABCD2345' },
      [
        `تغيّر وضع الدفع (تجريبي/حقيقي) بينما كان استرداد الطلب ${isolated('ABCD2345')} قيد التنفيذ؛ راجعه في لوحة بوابة الدفع وفي شاشة المطابقة.`,
      ],
    ],
    [
      { alert: 'payment_create_refused', error: 'CREATE_REFUSED_401' },
      [
        `رفضت بوابة الدفع إنشاء فاتورة (${isolated('CREATE_REFUSED_401')}). تحقق من مفتاح الدفع ووضعه في إعدادات الدوال؛ لا يستطيع أي مشترٍ الدفع حتى يُصلح ذلك.`,
      ],
    ],
  ]

  it.each(alerts)('%j: its facts, and the admin link', (alert, facts) => {
    const { subject, text } = renderOwnerAlert(alert, SITE)
    expect(subject.startsWith('تنبيه: ')).toBe(true)
    for (const fact of facts) expect(text).toContain(fact)
    expect(text).toContain(ADMIN)
  })

  it('a different text for each alert type', () => {
    const subjects = alerts.map(([alert]) => renderOwnerAlert(alert, SITE).subject)
    expect(new Set(subjects).size).toBe(alerts.length)
  })

  it('the three alert kinds of the payment audit have their own subjects (F1-17)', () => {
    expect(renderOwnerAlert({ alert: 'attempt_mode_changed', orderNumber: 'ABCD2345' }, SITE).subject).toBe('تنبيه: دفعة من وضع آخر تحتاج متابعة')
    expect(renderOwnerAlert({ alert: 'refund_mode_changed', orderNumber: 'ABCD2345' }, SITE).subject).toBe('تنبيه: استرداد من وضع آخر يحتاج متابعة')
    expect(renderOwnerAlert({ alert: 'payment_create_refused', error: 'CREATE_REFUSED_401' }, SITE).subject).toBe('تنبيه: بوابة الدفع ترفض إنشاء الفواتير')
  })

  it('what alert_email_data answers today for those kinds, the code alone, still reads: an unknown order and an unknown error (F1-17)', () => {
    const mode = renderOwnerAlert({ alert: 'attempt_mode_changed' }, SITE)
    expect(mode.subject).toBe('تنبيه: دفعة من وضع آخر تحتاج متابعة')
    expect(mode.text).toContain('دفعة الطلب غير معروف قيد التنفيذ')
    const refused = renderOwnerAlert({ alert: 'payment_create_refused' }, SITE)
    expect(refused.text).toContain('رفضت بوابة الدفع إنشاء فاتورة (غير معروف).')
    for (const { text } of [mode, refused]) expect(text).not.toMatch(/null|undefined/u)
  })

  it('an alert it does not know, or one with no code, gets a generic line with its code', () => {
    const unknown = renderOwnerAlert({ alert: 'something_new' }, SITE)
    expect(unknown.subject).toBe('تنبيه جديد في المتجر')
    expect(unknown.text).toContain(isolated('something_new'))
    expect(unknown.text).toContain(ADMIN)
    expect(renderOwnerAlert({ alert: null }, SITE).subject).toBe('تنبيه جديد في المتجر')
  })

  it('a missing fact reads as unknown, never as a number or the word null', () => {
    const { text } = renderOwnerAlert({ alert: 'needs_resolution', orderNumber: null, amount: null }, SITE)
    expect(text).toContain('غير معروف')
    expect(text).not.toMatch(/null|undefined|NaN/u)
  })

  it('carries no buyer contact detail, even when the data does', () => {
    const leaky = { alert: 'needs_resolution', orderNumber: 'ABCD2345', amount: 100, customerEmail: 'mona@example.com', phone: '966501234567', address: 'تبوك' }
    const { subject, text } = renderOwnerAlert(leaky, SITE)
    for (const detail of ['mona@example.com', '966501234567', 'تبوك']) expect(`${subject}\n${text}`).not.toContain(detail)
  })
})

describe('values a buyer, the catalog or the provider supplied', () => {
  // A line break, a Unicode separator, a NEL, a right-to-left override, our own
  // isolate closer, an isolate opener and a right-to-left mark.
  const HOSTILE = [
    'Ali\nالإجمالي المدفوع: 0.00 ',
    SAR,
    '\r',
    String.fromCharCode(0x2028, 0x2029, 0x85, 0x202e, 0x2069, 0x2066, 0x200f),
    'x',
  ].join('')

  const hostileOrder = (): OrderEmailData =>
    orderData({
      orderNumber: `AB${HOSTILE}`,
      customerName: HOSTILE,
      lines: [{ ...SIGNED, title: HOSTILE, variantTitle: HOSTILE, preorder: { shipsOn: HOSTILE, note: HOSTILE } }, { ...DIGITAL, title: HOSTILE }],
      seller: { legalName: HOSTILE, registration: HOSTILE },
    })
  const hostileNotify: NotifyEmailData = { status: 'confirmed', tokenVersion: 1, email: 'g@example.com', productTitle: HOSTILE, variantTitle: HOSTILE, slug: 'x' }
  const hostileAlert: AlertEmailData = {
    alert: HOSTILE,
    orderNumber: HOSTILE,
    amount: 100,
    total: 100,
    reason: HOSTILE,
    sku: HOSTILE,
    stock: 1,
    threshold: 2,
    status: HOSTILE,
    eventType: HOSTILE,
    paymentId: HOSTILE,
    error: HOSTILE,
  }
  const ALERT_TYPES = [
    'low_stock',
    'needs_resolution',
    'payment_review',
    'external_refund',
    'provider_status',
    'event_exhausted',
    'attempt_unverified',
    'attempt_duplicate_invoices',
    'refund_mismatch',
    'refund_unverified',
    'refund_total_decreased',
    'attempt_mode_changed',
    'refund_mode_changed',
    'payment_create_refused',
    HOSTILE,
  ]

  function mails() {
    const order = hostileOrder()
    return [
      renderReceipt(order, SITE, TOKEN),
      renderReceipt({ ...order, status: 'paid_needs_resolution' }, SITE, TOKEN),
      renderReceipt({ ...order, status: 'refunded' }, SITE, TOKEN),
      renderOrderLink(order, SITE, TOKEN),
      renderOrderReady(order, order.lines, SITE, TOKEN),
      renderOrderShipped(order, { carrier: HOSTILE, tracking: HOSTILE, itemIds: order.lines.map((line) => line.itemId) }, SITE, TOKEN),
      renderOrderRefunded(order, { amount: 100 }, SITE, TOKEN),
      renderNotifyConfirm(hostileNotify, SITE, TOKEN),
      renderAvailability(hostileNotify, SITE, TOKEN),
      renderAvailability({ ...hostileNotify, preorder: true }, SITE, TOKEN),
      ...ALERT_TYPES.map((alert) => renderOwnerAlert({ ...hostileAlert, alert }, SITE)),
    ]
  }

  it('no line break reaches a subject, and a separator reaches no text', () => {
    for (const { subject, text } of mails()) {
      expect(subject).not.toMatch(/[\r\n\x85\p{Zl}\p{Zp}]/u)
      expect(text).not.toMatch(/[\r\x85\p{Zl}\p{Zp}]/u)
    }
  })

  it('no bidi control of a value survives: only our own isolates are left, balanced', () => {
    for (const { subject, text } of mails()) {
      for (const part of [subject, text]) {
        expect(part.replaceAll(FSI, '').replaceAll(PDI, '')).not.toMatch(BIDI)
        expect(part.split(FSI).length).toBe(part.split(PDI).length)
      }
    }
  })

  it('a value cannot forge a line of the receipt', () => {
    const lines = renderReceipt(hostileOrder(), SITE, TOKEN).text.split('\n')
    // Only the genuine totals line, from the real totals, is a line of its own.
    expect(lines.filter((line) => line.startsWith('الإجمالي المدفوع:'))).toEqual([`الإجمالي المدفوع: 88.00 ${SAR}`])
    expect(lines.filter((line) => line.startsWith('البائع:'))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith('رقم التسجيل:'))).toHaveLength(1)
    // The hostile order number is percent-encoded in the link, so it cannot break the line either.
    expect(lines.filter((line) => line.startsWith(`${SITE}/orders#`))).toHaveLength(1)
  })

  it('every value sits inside one isolate pair', () => {
    const { text } = renderOrderShipped(
      orderData({ lines: [{ ...SIGNED, title: 'Ali' }] }),
      { carrier: 'DHL', tracking: 'T-1', itemIds: ['item-signed'] },
      SITE,
      TOKEN,
    )
    expect(text).toContain(`شركة الشحن: ${isolated('DHL')}`)
    expect(text).toContain(`- ${isolated('Ali')} (`)
  })
})
