// P08 round 5: what the dispatcher (`supabase/functions/_shared/outbox.ts`) does
// with every kind of row, with an injected `rpc` standing in for the data
// functions and a stubbed `fetch` standing in for the provider (Resend, as for a
// hosted site). No database and no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Rpc } from '../../supabase/functions/_shared/db.ts'
import { LOW_RESERVE, RESERVE, runOutbox } from '../../supabase/functions/_shared/outbox.ts'
import { notificationToken, orderAccessToken } from '../../supabase/functions/_shared/tokens.ts'

const PEPPER = 'unit-test-pepper-0123456789abcdef'
const SITE = 'https://anas.studio'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const ORDER_KEY = '22222222-2222-4222-8222-222222222222'
const REFUND_ID = '33333333-3333-4333-8333-333333333333'
const ITEM_A = '44444444-4444-4444-8444-444444444444'
const ITEM_B = '55555555-5555-4555-8555-555555555555'
const NOTIFICATION_ID = '66666666-6666-4666-8666-666666666666'

beforeEach(() => {
  vi.stubEnv('SITE_URL', SITE)
  vi.stubEnv('RESEND_API_KEY', 're_test_key')
  vi.stubEnv('EMAIL_FROM', 'Anas <noreply@anas.studio>')
  vi.stubEnv('EMAIL_DEV_MAILPIT_URL', '')
  vi.stubEnv('TOKEN_HASH_PEPPER', PEPPER)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function line(itemId: string, over: Record<string, unknown> = {}) {
  return {
    itemId,
    title: 'كتاب الورد',
    variantTitle: itemId === ITEM_A ? 'نسخة رقمية' : 'نسخة موقّعة',
    quantity: 1,
    total: 3500,
    fulfillment: itemId === ITEM_A ? 'digital' : 'signed',
    preorder: null,
    hasFile: itemId === ITEM_A,
    ...over,
  }
}

function orderData(over: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    orderNumber: 'ABCD2345',
    status: 'paid',
    environment: 'live',
    customerName: 'منى',
    customerEmail: 'buyer@example.com',
    idempotencyKey: ORDER_KEY,
    tokenVersion: 0,
    totals: { subtotal: 7000, discount: 0, shipping: 0, total: 7000 },
    lines: [line(ITEM_A), line(ITEM_B)],
    seller: { legalName: 'مؤسسة الورد', registration: 'REG-1234' },
    paidAt: '2026-10-02T10:00:00.000Z',
    refundedHalalas: 0,
    ...over,
  }
}

function notifyData(status: string, tokenVersion = 3) {
  return { status, tokenVersion, email: 'guest@example.com', productTitle: 'كتاب الورد', variantTitle: 'نسخة موقّعة', slug: 'rose-book' }
}

type Call = [string, Record<string, unknown>]
type Sent = { to: string[]; subject: string; text: string }

/**
 * One run over one claimed row. `replies` answers the data functions by name
 * (anything else answers null, like a function that finds nothing). Returns
 * every rpc call in order, what reached the provider, and the outcome recorded
 * for the row.
 */
async function runOne(kind: string, payload: Record<string, unknown>, replies: Record<string, unknown> = {}, recipient = 'buyer@example.com') {
  const calls: Call[] = []
  const sent: Sent[] = []
  let claims = 0
  const rpc: Rpc = async (fn, args) => {
    calls.push([fn, args])
    if (fn === 'outbox_claim') {
      claims += 1
      return claims === 1 ? [{ id: '7', lease_id: 'lease-1', kind, recipient, payload, idempotency_key: 'idem-1', attempts: 1 }] : []
    }
    return replies[fn] ?? null
  }
  const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Sent)
    return new Response(JSON.stringify({ id: 'prov-1' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchSpy)
  const summary = await runOutbox(rpc)
  const fn = (name: string): Call[] => calls.filter(([called]) => called === name)
  return { summary, calls, sent, fn, result: fn('outbox_result')[0]?.[1], fetchSpy }
}

describe('the claim', () => {
  it('asks for the three tiers: the reserve and the low reserve go with every claim', async () => {
    const { fn } = await runOne('receipt', { orderId: ORDER_ID }, { order_email_data: orderData() })
    expect(fn('outbox_claim')[0]![1]).toEqual({
      p_limit: 1,
      p_lease_seconds: 120,
      p_daily_quota: 100,
      p_reserve: 20,
      p_monthly_quota: 3000,
      p_low_reserve: 30,
    })
    expect([RESERVE, LOW_RESERVE]).toEqual([20, 30])
  })
})

describe('every kind calls its data function and sends to the row recipient', () => {
  it('receipt: the order link carries the token derived from the key and the version', async () => {
    const run = await runOne('receipt', { orderId: ORDER_ID }, { order_email_data: orderData({ tokenVersion: 2 }) })
    expect(run.fn('order_email_data')).toEqual([['order_email_data', { p_order: ORDER_ID }]])
    expect(run.sent).toHaveLength(1)
    expect(run.sent[0]!.to).toEqual(['buyer@example.com'])
    expect(run.sent[0]!.subject).toContain('ABCD2345')
    const token = await orderAccessToken(PEPPER, ORDER_KEY, 2)
    expect(run.sent[0]!.text).toContain(`${SITE}/orders#ABCD2345.${token}`)
    expect(token).not.toBe(await orderAccessToken(PEPPER, ORDER_KEY, 0))
    expect(run.result).toMatchObject({ p_id: '7', p_lease_id: 'lease-1', p_outcome: 'accepted', p_provider_id: 'prov-1' })
  })

  it('order_link', async () => {
    const run = await runOne('order_link', { orderId: ORDER_ID, version: 0 }, { order_email_data: orderData() })
    expect(run.fn('order_email_data')).toEqual([['order_email_data', { p_order: ORDER_ID }]])
    expect(run.sent[0]!.to).toEqual(['buyer@example.com'])
    expect(run.sent[0]!.subject).toContain('رابط طلبك')
    expect(run.sent[0]!.text).toContain(`${SITE}/orders#ABCD2345.${await orderAccessToken(PEPPER, ORDER_KEY, 0)}`)
  })

  it('order_ready: only the listed items that have a file', async () => {
    const run = await runOne('order_ready', { orderId: ORDER_ID, itemIds: [ITEM_A] }, { order_email_data: orderData() })
    expect(run.fn('order_email_data')).toEqual([['order_email_data', { p_order: ORDER_ID }]])
    expect(run.sent).toHaveLength(1)
    expect(run.sent[0]!.subject).toContain('جاهزة')
    expect(run.sent[0]!.text).toContain('نسخة رقمية')
    expect(run.sent[0]!.text).not.toContain('نسخة موقّعة')
  })

  it('order_shipped: asks for the listed items and sends the carrier and the tracking value', async () => {
    const shipment = { carrier: 'سمسا', tracking: 'TRK998', itemIds: [ITEM_B] }
    const run = await runOne('order_shipped', { orderId: ORDER_ID, itemIds: [ITEM_B] }, { order_email_data: orderData({ shipment }) })
    expect(run.fn('order_email_data')).toEqual([['order_email_data', { p_order: ORDER_ID, p_item_ids: [ITEM_B] }]])
    expect(run.sent[0]!.to).toEqual(['buyer@example.com'])
    expect(run.sent[0]!.text).toContain('TRK998')
    expect(run.sent[0]!.text).toContain('سمسا')
    expect(run.sent[0]!.text).toContain(`${SITE}/orders#ABCD2345.`)
  })

  it('order_refunded: asks for the refund and sends its amount and the refunded total', async () => {
    const run = await runOne(
      'order_refunded',
      { orderId: ORDER_ID, refundId: REFUND_ID },
      { order_email_data: orderData({ refund: { amount: 2500 }, refundedHalalas: 2500 }) },
    )
    expect(run.fn('order_email_data')).toEqual([['order_email_data', { p_order: ORDER_ID, p_refund: REFUND_ID }]])
    expect(run.sent[0]!.text).toContain('25.00')
    expect(run.sent[0]!.text).not.toMatch(/chargeback/iu)
  })

  it('notify_confirm: the confirm link carries the notification token', async () => {
    const run = await runOne('notify_confirm', { notificationId: NOTIFICATION_ID }, { notify_email_data: notifyData('pending', 3) }, 'guest@example.com')
    expect(run.fn('notify_email_data')).toEqual([['notify_email_data', { p_id: NOTIFICATION_ID }]])
    expect(run.sent[0]!.to).toEqual(['guest@example.com'])
    expect(run.sent[0]!.text).toContain(`${SITE}/notify/confirm#${await notificationToken(PEPPER, NOTIFICATION_ID, 3)}`)
  })

  it('availability: the product link and the unsubscribe link carry the token of the current version', async () => {
    const run = await runOne('availability', { notificationId: NOTIFICATION_ID }, { notify_email_data: notifyData('confirmed', 4) }, 'guest@example.com')
    expect(run.sent[0]!.to).toEqual(['guest@example.com'])
    expect(run.sent[0]!.text).toContain(`${SITE}/store/rose-book`)
    expect(run.sent[0]!.text).toContain(`${SITE}/notify/unsubscribe#${await notificationToken(PEPPER, NOTIFICATION_ID, 4)}`)
  })

  it('owner_alert: the whole payload goes to alert_email_data and the owner gets the text and the admin link', async () => {
    const payload = { alert: 'low_stock', variantId: ITEM_A, orderId: ORDER_ID }
    const alert = { alert: 'low_stock', orderNumber: 'ABCD2345', sku: 'SKU-9', stock: 2, threshold: 3 }
    const run = await runOne('owner_alert', payload, { alert_email_data: alert }, 'owner@example.com')
    expect(run.fn('alert_email_data')).toEqual([['alert_email_data', { p_payload: payload }]])
    expect(run.sent[0]!.to).toEqual(['owner@example.com'])
    expect(run.sent[0]!.text).toContain('SKU-9')
    expect(run.sent[0]!.text).toContain(`${SITE}/admin/orders`)
  })

  it('an alert the data function does not know is sent as a generic line with its code', async () => {
    const run = await runOne('owner_alert', { alert: 'something_new' }, { alert_email_data: { alert: 'something_new' } }, 'owner@example.com')
    expect(run.sent).toHaveLength(1)
    expect(run.sent[0]!.subject).toBe('تنبيه جديد في المتجر')
    expect(run.sent[0]!.text).toContain('something_new')
  })

  // FABLE-AUDIT F1-17: alert_email_data answers payment_create_refused with its code alone; the refusal's own code is in
  // the alert's payload (payment_attempt_close wrote it), so the owner still reads which refusal it was.
  it('payment_create_refused: the refusal code comes from the alert\'s own payload while alert_email_data does not carry it', async () => {
    const payload = { alert: 'payment_create_refused', attemptId: REFUND_ID, orderId: ORDER_ID, error: 'CREATE_REFUSED_401' }
    const run = await runOne('owner_alert', payload, { alert_email_data: { alert: 'payment_create_refused' } }, 'owner@example.com')
    expect(run.fn('alert_email_data')).toEqual([['alert_email_data', { p_payload: payload }]])
    expect(run.sent[0]!.subject).toBe('تنبيه: بوابة الدفع ترفض إنشاء الفواتير')
    expect(run.sent[0]!.text).toContain('رفضت بوابة الدفع إنشاء فاتورة (⁨CREATE_REFUSED_401⁩).')
    // Once the data function carries the code, its answer wins; another kind never shows the payload's code.
    const answered = await runOne('owner_alert', payload, { alert_email_data: { alert: 'payment_create_refused', error: 'CREATE_REFUSED_403' } }, 'owner@example.com')
    expect(answered.sent[0]!.text).toContain('CREATE_REFUSED_403')
    expect(answered.sent[0]!.text).not.toContain('CREATE_REFUSED_401')
    const other = await runOne('owner_alert', { ...payload, alert: 'attempt_unverified' }, { alert_email_data: { alert: 'attempt_unverified', orderNumber: 'ABCD2345', amount: 7000 } }, 'owner@example.com')
    expect(other.sent[0]!.text).not.toContain('CREATE_REFUSED')
  })
})

describe('a row whose data is gone or whose state no longer allows the mail is closed, never sent', () => {
  const rows: Array<[string, Record<string, unknown>, string]> = [
    ['receipt', { orderId: ORDER_ID }, 'order_email_data'],
    ['order_link', { orderId: ORDER_ID }, 'order_email_data'],
    ['order_ready', { orderId: ORDER_ID, itemIds: [ITEM_A] }, 'order_email_data'],
    ['order_shipped', { orderId: ORDER_ID, itemIds: [ITEM_B] }, 'order_email_data'],
    ['order_refunded', { orderId: ORDER_ID, refundId: REFUND_ID }, 'order_email_data'],
    ['notify_confirm', { notificationId: NOTIFICATION_ID }, 'notify_email_data'],
    ['availability', { notificationId: NOTIFICATION_ID }, 'notify_email_data'],
    ['owner_alert', { alert: 'low_stock' }, 'alert_email_data'],
  ]

  it.each(rows)('%s: data null is GONE', async (kind, payload) => {
    const run = await runOne(kind, payload)
    expect(run.fetchSpy).not.toHaveBeenCalled()
    expect(run.result).toMatchObject({ p_outcome: 'permanent', p_error: 'GONE', p_provider_id: null })
    expect(run.summary).toMatchObject({ claimed: 1, accepted: 0, permanent: 1 })
  })

  it.each(rows.filter(([, payload]) => 'orderId' in payload || 'notificationId' in payload))(
    '%s: a payload without its id is GONE and no data function is asked',
    async (kind) => {
      const run = await runOne(kind, {})
      expect(run.fetchSpy).not.toHaveBeenCalled()
      expect(run.result).toMatchObject({ p_outcome: 'permanent', p_error: 'GONE' })
      expect(run.calls.map(([fn]) => fn).filter((fn) => fn.endsWith('_email_data'))).toEqual([])
    },
  )

  it.each([
    ['pending', 'NOT_CONFIRMED'],
    ['unsubscribed', 'NOT_CONFIRMED'],
  ])('availability: a subscriber who is %s gets nothing (%s)', async (status, code) => {
    const run = await runOne('availability', { notificationId: NOTIFICATION_ID }, { notify_email_data: notifyData(status) })
    expect(run.fetchSpy).not.toHaveBeenCalled()
    expect(run.result).toMatchObject({ p_outcome: 'permanent', p_error: code })
  })

  it.each(['confirmed', 'unsubscribed'])('notify_confirm: a subscriber who is %s gets nothing (NOT_PENDING)', async (status) => {
    const run = await runOne('notify_confirm', { notificationId: NOTIFICATION_ID }, { notify_email_data: notifyData(status) })
    expect(run.fetchSpy).not.toHaveBeenCalled()
    expect(run.result).toMatchObject({ p_outcome: 'permanent', p_error: 'NOT_PENDING' })
  })

  it('order_ready: listed items with no file are NO_FILE; a payload that names no line of the order is GONE', async () => {
    const noFile = orderData({ lines: [line(ITEM_A, { hasFile: false }), line(ITEM_B)] })
    const first = await runOne('order_ready', { orderId: ORDER_ID, itemIds: [ITEM_A] }, { order_email_data: noFile })
    expect(first.fetchSpy).not.toHaveBeenCalled()
    expect(first.result).toMatchObject({ p_outcome: 'permanent', p_error: 'NO_FILE' })
    // The only file belongs to an item the mail does not list.
    const unlisted = await runOne('order_ready', { orderId: ORDER_ID, itemIds: [ITEM_B] }, { order_email_data: orderData() })
    expect(unlisted.fetchSpy).not.toHaveBeenCalled()
    expect(unlisted.result).toMatchObject({ p_outcome: 'permanent', p_error: 'NO_FILE' })
    // No list at all, or ids that are no line of this order: the producer wrote another shape, and the row stays visible.
    const none = await runOne('order_ready', { orderId: ORDER_ID }, { order_email_data: orderData() })
    expect(none.fetchSpy).not.toHaveBeenCalled()
    expect(none.result).toMatchObject({ p_outcome: 'permanent', p_error: 'GONE' })
    const foreign = await runOne('order_ready', { orderId: ORDER_ID, itemIds: ['00000000-0000-4000-8000-00000000ffff'] }, { order_email_data: orderData() })
    expect(foreign.result).toMatchObject({ p_outcome: 'permanent', p_error: 'GONE' })
  })

  it('order_shipped without a shipment is NO_SHIPMENT; order_refunded without a refund is NO_REFUND', async () => {
    const shipped = await runOne('order_shipped', { orderId: ORDER_ID, itemIds: [ITEM_B] }, { order_email_data: orderData() })
    expect(shipped.fetchSpy).not.toHaveBeenCalled()
    expect(shipped.result).toMatchObject({ p_outcome: 'permanent', p_error: 'NO_SHIPMENT' })
    const refunded = await runOne('order_refunded', { orderId: ORDER_ID, refundId: REFUND_ID }, { order_email_data: orderData() })
    expect(refunded.fetchSpy).not.toHaveBeenCalled()
    expect(refunded.result).toMatchObject({ p_outcome: 'permanent', p_error: 'NO_REFUND' })
  })

  it('an unknown kind stays RENDER_FAILED and no data function is asked', async () => {
    const run = await runOne('mystery', { orderId: ORDER_ID })
    expect(run.fetchSpy).not.toHaveBeenCalled()
    expect(run.result).toMatchObject({ p_outcome: 'permanent', p_error: 'RENDER_FAILED' })
    expect(run.calls.map(([fn]) => fn).filter((fn) => fn.endsWith('_email_data'))).toEqual([])
  })

  it.each(['TOKEN_HASH_PEPPER', 'SITE_URL'])('without %s nothing is claimed: the run is skipped and no row spends an attempt', async (name) => {
    vi.stubEnv(name, '')
    const run = await runOne('receipt', { orderId: ORDER_ID }, { order_email_data: orderData() })
    // Without the site address the mail provider itself is not usable (it cannot tell a hosted site from a local one).
    const reason = name === 'SITE_URL' ? 'EMAIL_NOT_CONFIGURED' : 'SITE_NOT_CONFIGURED'
    expect(run.summary).toMatchObject({ status: 'skipped', reason, claimed: 0 })
    expect(run.fn('outbox_claim')).toEqual([])
    expect(run.fn('order_email_data')).toEqual([])
    expect(run.fn('outbox_result')).toEqual([])
    expect(run.fetchSpy).not.toHaveBeenCalled()
    expect(run.fn('job_run_record')[0]![1]).toMatchObject({ p_job: 'email_outbox', p_status: 'skipped', p_detail: { reason } })
  })
})

// FABLE-AUDIT F1-4: a revoked key or an unverified domain refuses every message the same way. As a permanent outcome
// it exhausted the whole queue in one run; now the first refusal stops the run and the row keeps its attempt.
describe('an account the provider refuses (401, 403) stops the run', () => {
  it.each([401, 403])('a %i: the row waits without spending an attempt, nothing more is claimed, and the run is recorded failed with PROVIDER_CONFIG', async (status) => {
    const calls: Call[] = []
    let claims = 0
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      if (fn === 'outbox_claim') {
        // Mail is due all day: every claim would find another row.
        claims += 1
        return [{ id: String(claims), lease_id: `lease-${claims}`, kind: 'receipt', recipient: 'buyer@example.com', payload: { orderId: ORDER_ID }, idempotency_key: `idem-${claims}`, attempts: 1 }]
      }
      return fn === 'order_email_data' ? orderData() : null
    }
    const refused = { statusCode: status, name: 'validation_error', message: 'The anas.studio domain is not verified.' }
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(refused), { status }))
    vi.stubGlobal('fetch', fetchSpy)
    const summary = await runOutbox(rpc)
    const fn = (name: string): Call[] => calls.filter(([called]) => called === name)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fn('outbox_claim')).toHaveLength(1)
    expect(fn('outbox_result')).toEqual([
      ['outbox_result', { p_id: '1', p_lease_id: 'lease-1', p_outcome: 'retry', p_provider_id: null, p_error: 'PROVIDER_CONFIG' }],
    ])
    expect(summary).toEqual({ job: 'email_outbox', status: 'failed', claimed: 1, accepted: 0, retry: 1, permanent: 0, uncertain: 0, reason: 'PROVIDER_CONFIG' })
    expect(fn('job_run_record')).toEqual([
      [
        'job_run_record',
        {
          p_job: 'email_outbox',
          p_status: 'failed',
          p_detail: { claimed: 1, accepted: 0, retry: 1, permanent: 0, uncertain: 0, reason: 'PROVIDER_CONFIG' },
          p_started_at: expect.any(String),
        },
      ],
    ])
  })

  it('a run whose sends went out before the account refused one is still failed with the reason', async () => {
    let claims = 0
    const runs: Array<Record<string, unknown>> = []
    const rpc: Rpc = async (fn, args) => {
      if (fn === 'job_run_record') runs.push(args)
      if (fn === 'outbox_claim') {
        claims += 1
        return [{ id: String(claims), lease_id: `lease-${claims}`, kind: 'receipt', recipient: 'buyer@example.com', payload: { orderId: ORDER_ID }, idempotency_key: `idem-${claims}`, attempts: 1 }]
      }
      return fn === 'order_email_data' ? orderData() : null
    }
    let sends = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        sends += 1
        return sends === 1 ? new Response(JSON.stringify({ id: 'prov-1' }), { status: 200 }) : new Response(JSON.stringify({ name: 'restricted_api_key' }), { status: 401 })
      }),
    )
    const summary = await runOutbox(rpc)
    expect(sends).toBe(2)
    expect(summary).toMatchObject({ status: 'failed', claimed: 2, accepted: 1, retry: 1, reason: 'PROVIDER_CONFIG' })
    expect(runs[0]).toMatchObject({ p_status: 'failed', p_detail: { claimed: 2, accepted: 1, retry: 1, reason: 'PROVIDER_CONFIG' } })
  })
})

// FABLE-AUDIT F3-16 (b), QUALITY-10: a database call that fails mid-run used to leave no row, so the owner home pointed at the schedule,
// which works. The run is recorded failed with the SQLSTATE the database raised, like the other two jobs record theirs.
describe('a database failure mid-run', () => {
  const dbError = (code: string | undefined) => Object.assign(new Error('canceling statement due to statement timeout (10.0.0.5, buyer@example.com)'), { code })
  const COUNTS = { claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0 }

  /** A run whose `failing` data function raises `error`; every other one answers as `runOne` does for a receipt. */
  async function runFailing(failing: string, error: unknown, recordFails = false) {
    const calls: Call[] = []
    let claims = 0
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      if (fn === failing) throw error
      if (fn === 'job_run_record' && recordFails) throw dbError('57P01')
      if (fn === 'outbox_claim') {
        claims += 1
        return claims === 1 ? [{ id: '7', lease_id: 'lease-1', kind: 'receipt', recipient: 'buyer@example.com', payload: { orderId: ORDER_ID }, idempotency_key: 'idem-1', attempts: 1 }] : []
      }
      return fn === 'order_email_data' ? orderData() : null
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'prov-1' }), { status: 200 })))
    const summary = await runOutbox(rpc)
    return { summary, records: calls.filter(([fn]) => fn === 'job_run_record').map(([, args]) => args) }
  }

  it('is recorded failed, with the reason and the SQLSTATE, and never the error\'s message', async () => {
    const { summary, records } = await runFailing('outbox_claim', dbError('57014'))
    expect(summary).toEqual({ job: 'email_outbox', status: 'failed', ...COUNTS, reason: 'DB_FAILED' })
    expect(records).toEqual([
      { p_job: 'email_outbox', p_status: 'failed', p_detail: { ...COUNTS, reason: 'DB_FAILED', sqlstate: '57014' }, p_started_at: expect.any(String) },
    ])
    expect(JSON.stringify(records)).not.toMatch(/10\.0\.0\.5|buyer@|statement/)
  })

  it('keeps what the run had done before it failed: a row sent and then not written down is claimed and accepted', async () => {
    const { summary, records } = await runFailing('outbox_result', dbError('08006'))
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, accepted: 1, reason: 'DB_FAILED' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ p_status: 'failed', p_detail: { claimed: 1, accepted: 1, reason: 'DB_FAILED', sqlstate: '08006' } })
  })

  it('a failure with no SQLSTATE (a lost connection, a timeout) is recorded the same way without one', async () => {
    for (const error of [new TypeError('fetch failed'), new DOMException('timeout', 'TimeoutError'), dbError(undefined), dbError('timeout 10.0.0.5')]) {
      const { records } = await runFailing('outbox_claim', error)
      expect(records, String(error)).toEqual([{ p_job: 'email_outbox', p_status: 'failed', p_detail: { ...COUNTS, reason: 'DB_FAILED' }, p_started_at: expect.any(String) }])
    }
  })

  it('never throws, even when the failure record cannot be written either: the database being down is already a failed run', async () => {
    const { summary, records } = await runFailing('outbox_claim', dbError('57P01'), true)
    expect(summary).toMatchObject({ status: 'failed', reason: 'DB_FAILED' })
    expect(records).toHaveLength(1)
  })

  // The auditor's A8: the run's own record may have been written when its reply was lost, so its failure writes no second row
  // (a 'failed' row over a run that went well, or DB_FAILED over PROVIDER_CONFIG), and the run keeps its own reason.
  it('a run whose own record fails writes no second row over it, and keeps its reason', async () => {
    const { summary, records } = await runFailing('nothing fails before the record', null, true)
    expect(summary).toMatchObject({ status: 'failed', claimed: 1, accepted: 1 })
    expect(summary.reason).toBeUndefined()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ p_status: 'ok', p_detail: { claimed: 1, accepted: 1 } })
  })

  it('a run that does not fail is recorded once, as before: no DB_FAILED and no SQLSTATE', async () => {
    const calls: Call[] = []
    const rpc: Rpc = async (fn, args) => {
      calls.push([fn, args])
      return fn === 'outbox_claim' ? [] : null
    }
    vi.stubGlobal('fetch', vi.fn())
    // An empty claim is the quota hold, a partial run with its own reason.
    expect(await runOutbox(rpc)).toMatchObject({ status: 'partial', reason: 'QUOTA_HELD' })
    const records = calls.filter(([fn]) => fn === 'job_run_record')
    expect(records).toHaveLength(1)
    expect(records[0]![1]).toMatchObject({ p_status: 'partial', p_detail: { reason: 'QUOTA_HELD' } })
    expect(JSON.stringify(records)).not.toMatch(/DB_FAILED|sqlstate/)
  })
})

describe('a token never leaves the text', () => {
  const orderKinds: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ['receipt', { orderId: ORDER_ID }, {}],
    ['order_link', { orderId: ORDER_ID }, {}],
    ['order_ready', { orderId: ORDER_ID, itemIds: [ITEM_A] }, {}],
    ['order_shipped', { orderId: ORDER_ID, itemIds: [ITEM_B] }, { shipment: { carrier: 'DHL', tracking: 'T1', itemIds: [ITEM_B] } }],
    ['order_refunded', { orderId: ORDER_ID, refundId: REFUND_ID }, { refund: { amount: 100 } }],
  ]

  it.each(orderKinds)('%s: the order token is in the sent text and in no rpc argument, no log line and no stored value', async (kind, payload, extra) => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    const token = await orderAccessToken(PEPPER, ORDER_KEY, 0)
    const run = await runOne(kind, payload, { order_email_data: orderData(extra) })
    expect(run.sent).toHaveLength(1)
    expect(run.sent[0]!.text).toContain(token)
    // Not the key it is derived from, nor the pepper, in the mail.
    expect(run.sent[0]!.text).not.toContain(ORDER_KEY)
    expect(JSON.stringify(run.sent[0])).not.toContain(PEPPER)
    const arguments_ = JSON.stringify(run.calls.map(([, args]) => args))
    for (const secret of [token, ORDER_KEY, PEPPER]) expect(arguments_).not.toContain(secret)
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain(token)
    for (const log of logs) log.mockRestore()
  })

  it.each(['notify_confirm', 'availability'])('%s: the notification token is in the sent text and in no rpc argument', async (kind) => {
    const token = await notificationToken(PEPPER, NOTIFICATION_ID, 3)
    const status = kind === 'notify_confirm' ? 'pending' : 'confirmed'
    const run = await runOne(kind, { notificationId: NOTIFICATION_ID }, { notify_email_data: notifyData(status, 3) })
    expect(run.sent[0]!.text).toContain(token)
    const arguments_ = JSON.stringify(run.calls.map(([, args]) => args))
    expect(arguments_).not.toContain(token)
    expect(arguments_).not.toContain(PEPPER)
    // The mac half of the token is the secret; the id half is public (it is in the payload).
    expect(arguments_).not.toContain(token.split('.')[1]!)
  })
})
