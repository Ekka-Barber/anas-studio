// P08 round 11b: the owner's money actions, the parts that need no React (`src/lib/admin-money.ts`): what a
// refund can still take (a line partly refunded, the shipping already allocated by a succeeded and by an
// in-flight refund), the allocation built from the fields, the refusal of an amount above its remainder, the
// idempotency key's life (kept across a step-up retry and a network retry, renewed after a change, dropped with
// a final answer), the step-up retry, the sentence each answer becomes, the dispute form's checks and body.
// The strict parsers of the three replies (their code is in admin-orders.ts, beside the other parsers) are proven
// here too; the screens are proven in tests/e2e/orders-money.spec.ts. FABLE-AUDIT F2b adds the cap of what the
// paying attempt can still give back (a refund recorded from Moyasar's dashboard included) and CHARGEBACK_RECORDED.
import { describe, expect, it, vi } from 'vitest'

import {
  AMOUNT_ABOVE,
  AMOUNT_INVALID,
  attemptBalance,
  BAD_REPLY,
  buildDispute,
  CANCELLED,
  CHARGEBACK_RECORDED,
  decisionsFor,
  DISPUTE_DUPLICATE,
  DISPUTE_PROBLEMS,
  DISPUTE_RECORDED,
  disputeLines,
  inFlight,
  keyFor,
  linesFor,
  NEEDS_AMOUNT,
  NEEDS_AMOUNT_REVIEW,
  NEEDS_REFUND_REASON,
  NOT_ENROLLED,
  orderRefundFields,
  readAmount,
  readDisputeReply,
  readPaymentRecheck,
  readRefundReply,
  receivedReturns,
  refundBody,
  refundProblem,
  REFUND_FAILED,
  REFUND_UNCERTAIN,
  reviewRefundFields,
  riyadhToday,
  shippingLeft,
  sum,
  TOTAL_ABOVE,
  withStepUp,
  type DisputeInput,
  type DisputeLine,
  type Kept,
  type RefundField,
  type Verdict,
} from '../../src/lib/admin-money'
import { parseDisputeReply, parsePaymentRecheckReply, parseRefundReply } from '../../src/lib/admin-orders'
import { formatMoney } from '../../src/lib/format'
import type { FunctionResult } from '../../src/lib/supabase/functions'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'
const E = '55555555-5555-4555-8555-555555555555'
const PAYMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ISO = '2026-10-03T12:00:00.123456+00:00'

type Detail = Parameters<typeof orderRefundFields>[0]
const item = (id: string, name: string, total: number, refunded: number) => ({ id, productTitle: 'كتاب', variantTitle: name, total, refunded })
const refund = (status: string, allocation: Record<string, unknown>, attemptId: string | null = D) => ({ status, attemptId, allocation })
function detailOf(items: ReturnType<typeof item>[], shipping: number, refunds: ReturnType<typeof refund>[] = []): Detail {
  return { order: { shipping }, items, refunds } as unknown as Detail
}

const fail = (code: string, message = 'رسالة الدالة'): FunctionResult<unknown> => ({ ok: false, error: { code, message } })
const done = (data: unknown): FunctionResult<unknown> => ({ ok: true, data })

describe('what a refund can still take', () => {
  it('offers a line partly refunded for what is left of it, and no line that is spent', () => {
    const fields = orderRefundFields(detailOf([item(A, 'أ', 6000, 2500), item(B, 'ب', 4000, 4000), item(C, 'ج', 3500, 0)], 0))
    expect(fields).toEqual([
      { key: A, itemId: A, label: 'كتاب: أ', remainder: 3500 },
      { key: C, itemId: C, label: 'كتاب: ج', remainder: 3500 },
    ])
  })

  it('offers the shipping less what a succeeded and an in-flight refund allocated, and not what a failed one asked', () => {
    const refunds = [refund('succeeded', { items: [], shipping: 1000 }), refund('uncertain', { items: [], shipping: 500 }), refund('failed', { items: [], shipping: 700 })]
    expect(shippingLeft({ shipping: 2500 }, refunds)).toBe(1000)
    expect(shippingLeft({ shipping: 2500 }, [...refunds, refund('submitting', { shipping: 1000 })])).toBe(0)
    expect(orderRefundFields(detailOf([item(A, 'أ', 100, 0)], 2500, refunds)).find((field) => field.key === 'shipping')).toEqual({
      key: 'shipping',
      itemId: null,
      label: 'الشحن',
      remainder: 1000,
    })
  })

  it('leaves out the shipping once it is all allocated, a refund of a review payment and an unallocated one', () => {
    expect(orderRefundFields(detailOf([item(A, 'أ', 100, 0)], 2500, [refund('succeeded', { shipping: 2500 })])).map((field) => field.key)).toEqual([A])
    // A review payment's refund (no attempt) and a dashboard refund (`{}`) took no shipping.
    expect(shippingLeft({ shipping: 2500 }, [refund('succeeded', { shipping: 900 }, null), refund('succeeded', {})])).toBe(2500)
    // Text, a float or a negative in the stored allocation is not shipping.
    expect(shippingLeft({ shipping: 2500 }, [refund('succeeded', { shipping: '900' }), refund('succeeded', { shipping: 9.5 }), refund('succeeded', { shipping: -4 })])).toBe(2500)
    expect(shippingLeft({ shipping: 100 }, [refund('succeeded', { shipping: 900 })])).toBe(0)
  })

  it('has no field for a spent order, and one for a review payment with something left', () => {
    expect(orderRefundFields(detailOf([item(A, 'أ', 100, 100)], 0))).toEqual([])
    expect(reviewRefundFields(10600)).toEqual([{ key: 'amount', itemId: null, label: 'المبلغ', remainder: 10600 }])
    expect(reviewRefundFields(0)).toEqual([])
  })

  it('offers no more than the paying attempt can still give back: what it captured less every succeeded refund of it, the dashboard\'s included', () => {
    const refunds = [
      { attemptId: D, status: 'succeeded', amount: 1000, source: 'admin' },
      // Recorded from Moyasar's dashboard: it allocates no line, so no line's remainder shows it.
      { attemptId: D, status: 'succeeded', amount: 6000, source: 'provider_dashboard' },
      { attemptId: D, status: 'failed', amount: 500, source: 'admin' },
      { attemptId: D, status: 'uncertain', amount: 700, source: 'admin' },
      { attemptId: E, status: 'succeeded', amount: 900, source: 'admin' },
      { attemptId: null, status: 'succeeded', amount: 800, source: 'admin' },
    ]
    const attempts = [{ id: D, captured: 10600 }, { id: E, captured: 2000 }]
    const balance = (id: string, over: Partial<{ attempts: unknown; refunds: unknown }> = {}) =>
      attemptBalance({ attempts, refunds, ...over } as unknown as Parameters<typeof attemptBalance>[0], id)
    expect(balance(D)).toBe(3600)
    expect(balance(E)).toBe(1100)
    // No capture yet, no such attempt, or more refunded than captured: nothing to give.
    expect(balance(D, { attempts: [{ id: D, captured: null }] })).toBe(0)
    expect(balance(A)).toBe(0)
    expect(balance(D, { attempts: [{ id: D, captured: 5000 }] })).toBe(0)

    // Each line and the shipping is offered up to the cap, and none once nothing is left.
    const detail = detailOf([item(A, 'أ', 6000, 1000), item(B, 'ب', 3000, 0)], 2500)
    expect(orderRefundFields(detail, 3600).map((field) => [field.key, field.remainder])).toEqual([
      [A, 3600],
      [B, 3000],
      ['shipping', 2500],
    ])
    expect(orderRefundFields(detail, 0)).toEqual([])
    // With no cap, each line's own remainder.
    expect(orderRefundFields(detail).map((field) => field.remainder)).toEqual([5000, 3000, 2500])
  })

  it('knows which refunds are in flight', () => {
    expect(['submitting', 'uncertain'].every(inFlight)).toBe(true)
    expect(['succeeded', 'failed', 'x'].some(inFlight)).toBe(false)
  })

  it('offers the received returns that no refund is linked to, by what they hold', () => {
    const detail = {
      items: [item(A, 'أ', 6000, 0)],
      returns: [
        { id: B, state: 'received', refundId: null, items: [{ itemId: A, quantity: 2 }], createdAt: ISO },
        { id: C, state: 'received', refundId: D, items: [{ itemId: A, quantity: 1 }], createdAt: ISO },
        { id: D, state: 'approved', refundId: null, items: [{ itemId: A, quantity: 1 }], createdAt: ISO },
      ],
    } as unknown as Parameters<typeof receivedReturns>[0]
    const offered = receivedReturns(detail)
    expect(offered.map((entry) => entry.id)).toEqual([B])
    expect(offered[0]!.label).toContain('كتاب: أ × 2')
  })
})

describe('an amount typed in riyals', () => {
  it('reads riyals as integer halalas, never through a float', () => {
    expect(readAmount('40', 4000)).toEqual({ halalas: 4000, problem: null })
    expect(readAmount('0.1', 4000).halalas + readAmount('0.2', 4000).halalas).toBe(30)
    expect(readAmount('69.5', 10000).halalas).toBe(6950)
    expect(readAmount('٣٫٥', 4000).halalas).toBe(350)
    expect(readAmount('', 4000)).toEqual({ halalas: 0, problem: null })
    expect(readAmount('0', 4000)).toEqual({ halalas: 0, problem: null })
    expect(readAmount('0.00', 4000)).toEqual({ halalas: 0, problem: null })
  })

  it('refuses an amount above its remainder, one below zero and one that is no amount', () => {
    expect(readAmount('40.01', 4000)).toEqual({ halalas: 0, problem: 'above' })
    expect(readAmount('40.00', 4000).problem).toBeNull()
    expect(readAmount('99999', 4000).problem).toBe('above')
    for (const text of ['-1', '-0.5', '1.234', 'abc', '1,5', '1e3', '12 ريال', '٫5', '.']) expect(readAmount(text, 4000), text).toEqual({ halalas: 0, problem: 'invalid' })
  })

  it('adds integers', () => {
    expect(sum([2500, 1500, 0])).toBe(4000)
    expect(sum([])).toBe(0)
  })
})

describe('what refuses a refund before its confirmation', () => {
  const reads = (...texts: string[]) => texts.map((text) => readAmount(text, 4000))

  it('says the amount that is wrong, then that none was typed, then that there is no reason', () => {
    expect(refundProblem(reads('50'), 'سبب', false)).toBe(AMOUNT_ABOVE)
    expect(refundProblem(reads('1', '-1'), 'سبب', false)).toBe(AMOUNT_INVALID)
    expect(refundProblem(reads('', '0'), 'سبب', false)).toBe(NEEDS_AMOUNT)
    expect(refundProblem(reads(''), 'سبب', true)).toBe(NEEDS_AMOUNT_REVIEW)
    expect(refundProblem(reads('10'), '', false)).toBe(NEEDS_REFUND_REASON)
    expect(refundProblem(reads('10'), '   ', false)).toBe(NEEDS_REFUND_REASON)
    expect(refundProblem(reads('10'), 'س'.repeat(301), false)).toBe(NEEDS_REFUND_REASON)
  })

  it('lets a refund through with one positive amount and a reason of one to 300 characters', () => {
    expect(refundProblem(reads('', '10'), 'س', false)).toBeNull()
    expect(refundProblem(reads('10'), 'س'.repeat(300), true)).toBeNull()
  })

  it('refuses a total above what the paying attempt can still give back, each field being within its own', () => {
    expect(refundProblem(reads('30', '30'), 'سبب', false, 5000)).toBe(TOTAL_ABOVE)
    expect(refundProblem(reads('30', '20'), 'سبب', false, 5000)).toBeNull()
    expect(TOTAL_ABOVE).toBe('المجموع أكبر من المتبقي في الدفعة.')
    // A field above its own remainder, or nothing typed, is said first.
    expect(refundProblem(reads('50'), 'سبب', false, 1000)).toBe(AMOUNT_ABOVE)
    expect(refundProblem(reads(''), 'سبب', false, 0)).toBe(NEEDS_AMOUNT)
  })
})

describe('the body of refund-create', () => {
  const lineA: RefundField = { key: A, itemId: A, label: 'أ', remainder: 6000 }
  const lineB: RefundField = { key: B, itemId: B, label: 'ب', remainder: 4000 }
  const shipping: RefundField = { key: 'shipping', itemId: null, label: 'الشحن', remainder: 2500 }
  const args = (amounts: Array<[RefundField, number]>, over = {}) => ({
    orderId: C,
    attemptId: D,
    reviewPaymentId: null,
    reason: ' استرداد ',
    amounts: amounts.map(([field, halalas]) => ({ field, halalas })),
    returnId: null,
    ...over,
  })

  it('names only the lines with an amount and the shipping only above zero, and its amount is their sum', () => {
    expect(refundBody(args([[lineA, 3500], [lineB, 0], [shipping, 1500]]))).toEqual({
      action: 'refund-create',
      orderId: C,
      attemptId: D,
      amount: 5000,
      reason: 'استرداد',
      allocation: { items: [{ itemId: A, amount: 3500 }], shipping: 1500 },
    })
    expect(refundBody(args([[lineA, 0], [lineB, 4000], [shipping, 0]]))).toEqual({
      action: 'refund-create',
      orderId: C,
      attemptId: D,
      amount: 4000,
      reason: 'استرداد',
      allocation: { items: [{ itemId: B, amount: 4000 }] },
    })
    // Shipping alone: no line, an empty list of them.
    expect(refundBody(args([[lineA, 0], [shipping, 2500]]))).toMatchObject({ amount: 2500, allocation: { items: [], shipping: 2500 } })
  })

  it('keeps the allocation equal to the amount, whatever the fields hold', () => {
    for (const amounts of [[3500, 0, 0], [1, 2, 3], [6000, 4000, 2500], [0, 0, 1]]) {
      const body = refundBody(args([[lineA, amounts[0]!], [lineB, amounts[1]!], [shipping, amounts[2]!]])) as {
        amount: number
        allocation: { items: Array<{ amount: number }>; shipping?: number }
      }
      expect(body.amount).toBe(sum(amounts))
      expect(sum(body.allocation.items.map((entry) => entry.amount)) + (body.allocation.shipping ?? 0)).toBe(body.amount)
      expect(Object.keys(body.allocation).every((key) => key === 'items' || key === 'shipping')).toBe(true)
    }
  })

  it('links a return only when one is chosen, and carries no idempotency key (the confirmation mints it)', () => {
    expect(refundBody(args([[lineA, 100]], { returnId: E }))).toMatchObject({ returnId: E })
    expect('returnId' in refundBody(args([[lineA, 100]]))).toBe(false)
    expect('idempotencyKey' in refundBody(args([[lineA, 100]]))).toBe(false)
  })

  it('sends a review payment with its own id, an empty allocation, and its order only when it has one', () => {
    const review: RefundField = { key: 'amount', itemId: null, label: 'المبلغ', remainder: 10600 }
    expect(refundBody(args([[review, 5000]], { orderId: C, attemptId: null, reviewPaymentId: PAYMENT }))).toEqual({
      action: 'refund-create',
      orderId: C,
      reviewPaymentId: PAYMENT,
      amount: 5000,
      reason: 'استرداد',
      allocation: {},
    })
    const unmapped = refundBody(args([[review, 5000]], { orderId: null, attemptId: null, reviewPaymentId: PAYMENT }))
    expect(unmapped).toEqual({ action: 'refund-create', reviewPaymentId: PAYMENT, amount: 5000, reason: 'استرداد', allocation: {} })
    expect('orderId' in unmapped).toBe(false)
  })
})

describe("the idempotency key's life", () => {
  const body = (amount: number) => refundBody({ orderId: C, attemptId: D, reviewPaymentId: null, reason: 'سبب', amounts: [{ field: { key: A, itemId: A, label: 'أ', remainder: 9000 }, halalas: amount }], returnId: null })

  it('mints a key for a request nothing was kept for, and keeps it for the same request', () => {
    const mint = vi.fn(() => 'key-1')
    const first = keyFor(null, JSON.stringify(body(100)), mint)
    expect(first.key).toBe('key-1')
    expect(keyFor(first, JSON.stringify(body(100)), mint)).toBe(first)
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('renews it when the request changed: any field of it', () => {
    let n = 0
    const mint = () => `key-${(n += 1)}`
    const first = keyFor(null, JSON.stringify(body(100)), mint)
    const other = keyFor(first, JSON.stringify(body(101)), mint)
    expect(other.key).not.toBe(first.key)
    const reason = keyFor(first, JSON.stringify({ ...body(100), reason: 'غيره' }), mint)
    expect(reason.key).not.toBe(first.key)
    // A change undone is the very same request again.
    expect(keyFor(other, JSON.stringify(body(101)), mint)).toBe(other)
  })

  it('goes through a step-up retry and a network retry, and goes with a final answer', () => {
    let n = 0
    const mint = () => `key-${(n += 1)}`
    let kept: Kept | null = null
    // What the confirmation does for the body on screen, and what the answer then does to the kept request.
    const confirm = (amount: number): string => {
      kept = keyFor(kept, JSON.stringify(body(amount)), mint)
      return kept.key
    }
    const answered = (result: FunctionResult<unknown> | null): void => {
      const reading = result === null ? null : readRefundReply(result)
      if (reading !== null && !reading.keep) kept = null
    }

    const first = confirm(100)
    // The function asked for a code and the same body goes again: the same key.
    expect(confirm(100)).toBe(first)
    // The call never arrived, or the function failed on its own: the request is unknown, and a retry is the same one.
    answered(fail('UNKNOWN', 'تعذّر الاتصال بالخادم.'))
    expect(confirm(100)).toBe(first)
    answered(fail('FAILED'))
    expect(confirm(100)).toBe(first)
    // The owner closed the dialog: nothing was said, nothing was answered.
    answered(null)
    expect(confirm(100)).toBe(first)
    // The owner changes the amount: another request, another key.
    const second = confirm(200)
    expect(second).not.toBe(first)
    // A refusal is final, and so is a made refund: the next request starts from a new key.
    answered(fail('EXCEEDS_BALANCE'))
    const third = confirm(200)
    expect(third).not.toBe(second)
    answered(done({ refundId: E, status: 'succeeded', amount: 200 }))
    expect(confirm(200)).not.toBe(third)
    // A reply that cannot be read leaves the refund unknown: the same key stays.
    const fourth = confirm(300)
    answered(done({ status: 'paid' }))
    expect(confirm(300)).toBe(fourth)
  })
})

describe('the step-up retry', () => {
  const stepUp = fail('STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')

  it('sends once when the function does not ask for a code', async () => {
    const send = vi.fn(async () => done({ ok: 1 }))
    const ask = vi.fn(async (): Promise<Verdict> => 'verified')
    expect(await withStepUp(send, ask)).toEqual(done({ ok: 1 }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
    // Any other refusal is an answer, not a request for a code.
    const refused = vi.fn(async () => fail('EXCEEDS_BALANCE'))
    expect(await withStepUp(refused, ask)).toEqual(fail('EXCEEDS_BALANCE'))
    expect(refused).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks for the code and sends the same call once more', async () => {
    const send = vi.fn().mockResolvedValueOnce(stepUp).mockResolvedValueOnce(done({ ok: 2 }))
    const ask = vi.fn(async (): Promise<Verdict> => 'verified')
    expect(await withStepUp(send, ask)).toEqual(done({ ok: 2 }))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('never asks twice: a second request for a code is the answer', async () => {
    const send = vi.fn(async () => stepUp)
    const ask = vi.fn(async (): Promise<Verdict> => 'verified')
    expect(await withStepUp(send, ask)).toEqual(stepUp)
    expect(send).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('sends nothing more when the owner closes the dialog, has no factor, or the factors could not be read', async () => {
    for (const [verdict, code] of [
      ['cancelled', CANCELLED],
      ['enroll', NOT_ENROLLED],
      ['failed', 'UNKNOWN'],
    ] as const) {
      const send = vi.fn(async () => stepUp)
      const result = await withStepUp(send, async () => verdict)
      expect(send, verdict).toHaveBeenCalledTimes(1)
      expect(result.ok, verdict).toBe(false)
      expect(!result.ok && result.error.code, verdict).toBe(code)
    }
  })
})

describe('what a refund answer says', () => {
  const reply = (status: string, amount = 4000) => done({ refundId: E, status, amount })

  it('says «تمت إعادة» for a refund made, with its amount', () => {
    expect(readRefundReply(reply('succeeded'))).toEqual({ line: 'status', text: `تمت إعادة ${formatMoney(4000)}.`, done: true, keep: false, ahead: false })
  })

  it('says a refund that is sent and not yet confirmed the same way, submitting included', () => {
    for (const status of ['uncertain', 'submitting']) {
      expect(readRefundReply(reply(status)), status).toEqual({ line: 'status', text: REFUND_UNCERTAIN, done: true, keep: false, ahead: false })
    }
    expect(REFUND_UNCERTAIN).toBe('أُرسل الاسترداد ولم يتأكد بعد؛ تتحقق منه المطابقة خلال دقائق.')
  })

  it('says a refund the gateway refused as an alert, and keeps the form (nothing was taken)', () => {
    expect(readRefundReply(reply('failed'))).toEqual({ line: 'alert', text: REFUND_FAILED, done: false, keep: false, ahead: false })
    expect(REFUND_FAILED).toBe('رفضت بوابة الدفع الاسترداد؛ لم يُخصم شيء.')
  })

  it('says a refund recorded from the provider with its own words', () => {
    expect(readRefundReply(reply('succeeded', 2500), true)).toMatchObject({ line: 'status', text: `سُجّل استرداد خارجي بمبلغ ${formatMoney(2500)}.`, done: true })
  })

  it('shows the function’s own refusal, flags a refund the provider holds, and keeps the key only when the request is unknown', () => {
    expect(readRefundReply(fail('EXCEEDS_BALANCE', 'المبلغ أكبر من المتبقي للاسترداد.'))).toEqual({
      line: 'alert',
      text: 'المبلغ أكبر من المتبقي للاسترداد.',
      done: false,
      keep: false,
      ahead: false,
    })
    expect(readRefundReply(fail('PROVIDER_AHEAD', 'رسالة'))).toMatchObject({ ahead: true, keep: false })
    for (const code of ['UNKNOWN', 'FAILED', NOT_ENROLLED]) expect(readRefundReply(fail(code, 'x'))!.keep, code).toBe(true)
    for (const code of ['NOT_REFUNDABLE', 'REFUND_IN_FLIGHT', 'PROVIDER_BEHIND', 'INVALID_ALLOCATION', 'INVALID_RETURN', 'IDEMPOTENCY_CONFLICT', 'NO_DELTA', 'PROVIDER_UNAVAILABLE', 'FORBIDDEN', 'INVALID']) {
      expect(readRefundReply(fail(code, 'x'))!.keep, code).toBe(false)
    }
    // A refusal that carries no words still says something.
    expect(readRefundReply(fail('EXCEEDS_BALANCE', ''))!.text).not.toBe('')
  })

  it('says nothing when the owner closed the dialog', () => {
    expect(readRefundReply(fail(CANCELLED, ''))).toBeNull()
  })

  it('says a chargeback recorded on the payment in this screen\'s words (the function has only a generic one), as a final answer', () => {
    expect(readRefundReply(fail('CHARGEBACK_RECORDED', 'تعذّر تنفيذ الإجراء.'))).toEqual({
      line: 'alert',
      text: 'سُجّل استرجاع بنكي على هذه الدفعة؛ لا يمكن الاسترداد منها.',
      done: false,
      keep: false,
      ahead: false,
    })
    expect(CHARGEBACK_RECORDED).toBe('سُجّل استرجاع بنكي على هذه الدفعة؛ لا يمكن الاسترداد منها.')
  })

  it('never reads a reply it cannot parse as made or as failed: it says so, and keeps the request', () => {
    for (const data of [null, [], 'ok', {}, { status: 'succeeded' }, { refundId: E, status: 'paid', amount: 1 }, { refundId: E, status: 'succeeded', amount: 0 }, { refundId: E, status: 'succeeded', amount: 1.5 }, { refundId: 'x', status: 'succeeded', amount: 1 }]) {
      expect(readRefundReply(done(data)), JSON.stringify(data)).toEqual({ line: 'alert', text: BAD_REPLY, done: false, keep: true, ahead: false })
    }
    expect(BAD_REPLY).toBe('تعذّر قراءة الرد؛ حدّث الصفحة.')
  })
})

describe('what the other answers say', () => {
  it('says the status a recheck found, in its word, or as its code when it has none', () => {
    expect(readPaymentRecheck(done({ status: 'paid' }))).toEqual({ line: 'status', text: 'الحالة الآن: مدفوع.' })
    expect(readPaymentRecheck(done({ status: 'uncertain' }))).toEqual({ line: 'status', text: 'الحالة الآن: غير مؤكد.' })
    expect(readPaymentRecheck(done({ status: 'something_new' })).text).toBe('الحالة الآن: something_new.')
  })

  it('shows a refusal of a recheck as the function words it, and a reply it cannot read as such', () => {
    expect(readPaymentRecheck(fail('NOT_FOUND', 'لم نجد محاولة الدفع هذه.'))).toEqual({ line: 'alert', text: 'لم نجد محاولة الدفع هذه.' })
    for (const data of [null, {}, { status: 1 }, 'paid']) expect(readPaymentRecheck(done(data)), JSON.stringify(data)).toEqual({ line: 'alert', text: BAD_REPLY })
  })

  it('says a dispute recorded, a repeat that changed nothing, a refusal and a reply it cannot read', () => {
    const row = {
      id: A,
      kind: 'chargeback',
      providerRef: 'CB-1',
      seq: 1,
      attemptId: D,
      reviewPaymentId: null,
      environment: 'test',
      amount: 500,
      direction: 'against_seller',
      occurredOn: '2026-10-02',
      reason: 'نزاع',
      resolution: null,
      decision: 'none',
      itemIds: [],
      createdAt: ISO,
    }
    expect(readDisputeReply(done({ duplicate: false, dispute: row }))).toEqual({ line: 'status', text: DISPUTE_RECORDED, done: true })
    expect(readDisputeReply(done({ duplicate: true, dispute: row }))).toEqual({ line: 'status', text: DISPUTE_DUPLICATE, done: true })
    expect(readDisputeReply(fail('TARGET_MISMATCH', 'السجل اللاحق يخص الدفعة نفسها.'))).toEqual({ line: 'alert', text: 'السجل اللاحق يخص الدفعة نفسها.', done: false })
    expect(readDisputeReply(done({ duplicate: false }))).toEqual({ line: 'alert', text: BAD_REPLY, done: false })
    expect(readDisputeReply(fail(CANCELLED, ''))).toBeNull()
    expect(DISPUTE_RECORDED).toBe('سُجّل.')
    expect(DISPUTE_DUPLICATE).toBe('هذا السجل مسجّل من قبل؛ لم يتغير شيء.')
  })
})

describe('a 200 reply that says «ok: false» and carries no refusal', () => {
  // `callFunction` passes through any 2xx body that has an `ok` key, so these reach the readers and the step-up.
  const bare = [{ ok: false }, { ok: false, error: null }, { ok: false, error: 'FAILED' }, { ok: false, error: {} }, { ok: false, error: { code: 5, message: 'x' } }] as unknown as Array<
    FunctionResult<unknown>
  >

  it('is a reply the refund reader cannot read: it says so, and keeps the request (its key), never «تعذّر الحفظ»', () => {
    for (const result of bare) {
      expect(readRefundReply(result), JSON.stringify(result)).toEqual({ line: 'alert', text: BAD_REPLY, done: false, keep: true, ahead: false })
      expect(readRefundReply(result, true), JSON.stringify(result)).toEqual({ line: 'alert', text: BAD_REPLY, done: false, keep: true, ahead: false })
    }
  })

  it('is a reply the recheck and the dispute readers cannot read either', () => {
    for (const result of bare) {
      expect(readPaymentRecheck(result), JSON.stringify(result)).toEqual({ line: 'alert', text: BAD_REPLY })
      expect(readDisputeReply(result), JSON.stringify(result)).toEqual({ line: 'alert', text: BAD_REPLY, done: false })
    }
  })

  it('is no request for a code: the step-up gives it back as it is and opens nothing', async () => {
    for (const result of bare) {
      const ask = vi.fn(async (): Promise<Verdict> => 'verified')
      expect(await withStepUp(async () => result, ask), JSON.stringify(result)).toBe(result)
      expect(ask).not.toHaveBeenCalled()
    }
  })

  it('leaves a refusal that has a code as it was: its words, or a sentence of its own when it has none', () => {
    const noWords = { ok: false, error: { code: 'NOT_FOUND' } } as unknown as FunctionResult<unknown>
    for (const text of [readPaymentRecheck(noWords).text, readDisputeReply(noWords)!.text, readRefundReply(noWords)!.text]) {
      expect(text).not.toBe('')
      expect(text).not.toBe(BAD_REPLY)
    }
    expect(readRefundReply(noWords)).toMatchObject({ line: 'alert', keep: false, ahead: false })
  })
})

describe('the dispute form', () => {
  const lines: DisputeLine[] = [
    { id: A, name: 'كتاب رقمي', entitled: true, preparing: false },
    { id: B, name: 'كتاب ورقي', entitled: false, preparing: true },
    { id: C, name: 'كتاب مشحون', entitled: false, preparing: false },
  ]
  const input = (over: Partial<DisputeInput> = {}): DisputeInput => ({
    providerRef: ' CB-2026-1 ',
    kind: 'chargeback',
    amount: '45',
    direction: 'against_seller',
    day: '2026-10-02',
    reason: ' اعتراض من حامل البطاقة ',
    resolution: '',
    decision: 'none',
    picked: [],
    ...over,
  })
  const target = { attemptId: D }
  const build = (over: Partial<DisputeInput> = {}, follows = 0, tgt: { attemptId?: string; reviewPaymentId?: string } = target) =>
    buildDispute(input(over), tgt, follows, '2026-10-03', lines)

  it('builds the body of dispute-record from what was typed', () => {
    expect(build()).toEqual({
      ok: true,
      body: {
        action: 'dispute-record',
        kind: 'chargeback',
        providerRef: 'CB-2026-1',
        follows: 0,
        attemptId: D,
        amount: 4500,
        direction: 'against_seller',
        occurredOn: '2026-10-02',
        reason: 'اعتراض من حامل البطاقة',
        decision: 'none',
      },
    })
  })

  it('names a review payment instead of an attempt, a payout difference with no payment, and the row it follows', () => {
    expect(build({}, 0, { reviewPaymentId: PAYMENT })).toMatchObject({ ok: true, body: { reviewPaymentId: PAYMENT } })
    expect((build({}, 0, { reviewPaymentId: PAYMENT }) as { body: Record<string, unknown> }).body).not.toHaveProperty('attemptId')
    const difference = build({ kind: 'payout_difference', resolution: 'سُوّي' }, 0, {}) as { body: Record<string, unknown> }
    expect(difference.body).toMatchObject({ kind: 'payout_difference', resolution: 'سُوّي', follows: 0 })
    expect(difference.body).not.toHaveProperty('attemptId')
    expect(difference.body).not.toHaveProperty('reviewPaymentId')
    expect(build({}, 3)).toMatchObject({ body: { follows: 3 } })
  })

  it('refuses a missing reference, an amount that is not above zero, a day after today, a missing reason', () => {
    expect(build({ providerRef: '  ' })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.reference })
    expect(build({ providerRef: 'x'.repeat(121) })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.reference })
    expect(build({ providerRef: 'x'.repeat(120) }).ok).toBe(true)
    for (const amount of ['', '0', '0.00', '-5', 'abc', '99999999']) expect(build({ amount }), amount).toEqual({ ok: false, message: DISPUTE_PROBLEMS.amount })
    expect(build({ amount: '0.01' }).ok).toBe(true)
    for (const day of ['', '2026-10-04', '2027-01-01', '2026-13-45', '10/02/2026']) expect(build({ day }), day).toEqual({ ok: false, message: DISPUTE_PROBLEMS.day })
    // Today itself is allowed, the day after is not.
    expect(build({ day: '2026-10-03' }).ok).toBe(true)
    expect(build({ reason: '   ' })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.reason })
    expect(build({ reason: 'س'.repeat(501) })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.reason })
    expect(build({ resolution: 'س'.repeat(501) })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.resolution })
  })

  it('needs at least one line for a decision that acts on lines, and only lines that decision can name', () => {
    expect(build({ decision: 'entitlement_revoked' })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.lines })
    expect(build({ decision: 'fulfillment_stopped', picked: [] })).toEqual({ ok: false, message: DISPUTE_PROBLEMS.lines })
    expect(build({ decision: 'entitlement_revoked', picked: [A] })).toMatchObject({ ok: true, body: { decision: 'entitlement_revoked', itemIds: [A] } })
    expect(build({ decision: 'fulfillment_stopped', picked: [B, A] })).toMatchObject({ ok: true, body: { itemIds: [B] } })
    // A line picked under another decision is not sent: lines are named only by the decisions that act on them.
    const kept = build({ decision: 'entitlement_kept', picked: [A, B] }) as { body: Record<string, unknown> }
    expect(kept.body).not.toHaveProperty('itemIds')
    const none = build({ decision: 'none', picked: [A] }) as { body: Record<string, unknown> }
    expect(none.body).not.toHaveProperty('itemIds')
    // No line fits: the order has no file to withdraw.
    expect(buildDispute(input({ decision: 'entitlement_revoked', picked: [B] }), target, 0, '2026-10-03', [lines[1]!, lines[2]!])).toEqual({ ok: false, message: DISPUTE_PROBLEMS.noLines })
    expect(buildDispute(input({ decision: 'entitlement_revoked', picked: [A] }), target, 0, '2026-10-03', null)).toEqual({ ok: false, message: DISPUTE_PROBLEMS.noLines })
  })

  it('offers a line for the decision that can name it', () => {
    expect(linesFor('entitlement_revoked', lines).map((line) => line.id)).toEqual([A])
    expect(linesFor('fulfillment_stopped', lines).map((line) => line.id)).toEqual([B])
    expect(linesFor('none', lines)).toEqual([])
    expect(linesFor('entitlement_kept', lines)).toEqual([])
  })

  it('offers the decisions that fit: none for a difference, no line decisions while the lines are unknown', () => {
    expect(decisionsFor(false, lines)).toEqual(['none'])
    expect(decisionsFor(true, null)).toEqual(['none', 'entitlement_kept'])
    expect(decisionsFor(true, lines)).toEqual(['none', 'entitlement_revoked', 'entitlement_kept', 'fulfillment_stopped'])
  })

  it('reads the lines of an order from its items, entitlements and fulfilments', () => {
    const detail = {
      items: [item(A, 'رقمي', 3500, 0), item(B, 'ورقي', 4000, 0), item(C, 'مشحون', 4000, 0)],
      entitlements: [{ itemId: A }],
      fulfillments: [
        { itemId: B, state: 'preparing' },
        { itemId: C, state: 'shipped' },
      ],
    } as unknown as Parameters<typeof disputeLines>[0]
    expect(disputeLines(detail)).toEqual([
      { id: A, name: 'كتاب: رقمي', entitled: true, preparing: false },
      { id: B, name: 'كتاب: ورقي', entitled: false, preparing: true },
      { id: C, name: 'كتاب: مشحون', entitled: false, preparing: false },
    ])
  })

  it('reads today in Riyadh, three hours ahead of UTC', () => {
    expect(riyadhToday(Date.parse('2026-10-03T20:59:59Z'))).toBe('2026-10-03')
    expect(riyadhToday(Date.parse('2026-10-03T21:00:00Z'))).toBe('2026-10-04')
    expect(riyadhToday(Date.parse('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
    expect(riyadhToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('the strict parsers of the three replies of the admin function', () => {
  const refundReply = { refundId: E, status: 'succeeded', amount: 4000 }
  const disputeRow = {
    id: A,
    kind: 'chargeback',
    providerRef: 'CB-1',
    seq: 1,
    attemptId: D,
    reviewPaymentId: null,
    environment: 'test',
    amount: 500,
    direction: 'against_seller',
    occurredOn: '2026-10-02',
    reason: 'نزاع',
    resolution: null,
    decision: 'none',
    itemIds: [B],
    createdAt: ISO,
  }

  it('reads {refundId, status, amount} and nothing else of a refund, for each status it has a sentence for', () => {
    expect(parseRefundReply(refundReply)).toEqual(refundReply)
    for (const status of ['submitting', 'uncertain', 'succeeded', 'failed']) expect(parseRefundReply({ ...refundReply, status }).status).toBe(status)
    expect(() => parseRefundReply({ ...refundReply, extra: true })).not.toThrow()
  })

  it('refuses a refund reply with a key missing or of the wrong type, a status it cannot word, an amount that is not a positive whole number, an id that is not one', () => {
    for (const key of Object.keys(refundReply)) {
      expect(() => parseRefundReply({ ...refundReply, [key]: undefined }), `missing ${key}`).toThrow()
      expect(() => parseRefundReply({ ...refundReply, [key]: -1.5 }), `wrong type at ${key}`).toThrow()
    }
    for (const bad of [{ status: 'paid' }, { status: 'SUCCEEDED' }, { status: '' }, { amount: 0 }, { amount: -5 }, { amount: 10.5 }, { amount: '4000' }, { refundId: 'x' }, { refundId: PAYMENT.toUpperCase() }]) {
      expect(() => parseRefundReply({ ...refundReply, ...bad }), JSON.stringify(bad)).toThrow()
    }
    for (const reply of [null, [], 'x', 7, {}, { ok: true }]) expect(() => parseRefundReply(reply), JSON.stringify(reply)).toThrow()
  })

  it('reads {status} of a payment recheck, a status it has no word for as it comes, and refuses anything else', () => {
    expect(parsePaymentRecheckReply({ status: 'paid' })).toEqual({ status: 'paid' })
    expect(parsePaymentRecheckReply({ status: 'something_new' })).toEqual({ status: 'something_new' })
    for (const reply of [null, [], {}, { status: 1 }, { status: null }, 'paid']) expect(() => parsePaymentRecheckReply(reply), JSON.stringify(reply)).toThrow()
  })

  it('reads {duplicate, dispute} of a dispute, a repeat as true, and refuses a key missing or of the wrong type, in the reply and in the row', () => {
    const reply = { duplicate: false, dispute: disputeRow }
    expect(parseDisputeReply(reply)).toMatchObject({ duplicate: false, dispute: { seq: 1, providerRef: 'CB-1' } })
    expect(parseDisputeReply({ ...reply, duplicate: true }).duplicate).toBe(true)
    for (const key of Object.keys(disputeRow)) {
      expect(() => parseDisputeReply({ ...reply, dispute: { ...disputeRow, [key]: undefined } }), `missing ${key}`).toThrow()
      expect(() => parseDisputeReply({ ...reply, dispute: { ...disputeRow, [key]: -1.5 } }), `wrong type at ${key}`).toThrow()
    }
    for (const bad of [null, [], {}, { duplicate: 'true', dispute: disputeRow }, { duplicate: false }, { duplicate: false, dispute: null }, { dispute: disputeRow }]) {
      expect(() => parseDisputeReply(bad), JSON.stringify(bad)).toThrow()
    }
  })
})
