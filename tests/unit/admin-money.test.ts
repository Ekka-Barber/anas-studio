// P08 round 11b: the owner's money actions, the parts that need no React (`src/lib/admin-money.ts`): what a
// refund can still take (a line partly refunded, the shipping already allocated by a succeeded and by an
// in-flight refund), the allocation built from the fields, the refusal of an amount above its remainder, the
// idempotency key's life (kept across a step-up retry and a network retry, renewed after a change, dropped with
// a final answer), the step-up retry, the sentence each answer becomes, the dispute form's checks and body.
// The strict parsers of the three replies (their code is in admin-orders.ts, beside the other parsers) are proven
// here too; the screens are proven in tests/e2e/orders-money.spec.ts. FABLE-AUDIT F2b adds the cap of what the
// paying attempt can still give back (a refund recorded from Moyasar's dashboard included) and CHARGEBACK_RECORDED.
// F3-2 and F3-5 add the confirmed total a refund is built from (`expectedRefunded`) and how the key keeps it, the
// words of a refund-create reply whose key is kept, and the refund in flight that closes the form.
// RESIDUALS-1 R3b adds what a refund also does (ADMIN-COMMERCE-11), a payment Moyasar shows voided (-09), a review payment in another
// currency (-06), the lines of the open dispute form (-12), the order link of the other mode, and a dispute day that is not on the
// calendar (QUALITY-24); the last describe renders the refund form and the dispute form once, as static markup.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DisputeForm } from '../../src/components/admin/DisputeForm'
import { RefundView, ReviewMoney, type Money, type RefundSubject } from '../../src/components/admin/RefundView'
import {
  AMOUNT_ABOVE,
  AMOUNT_INVALID,
  attemptBalance,
  attemptRefundInFlight,
  BAD_REPLY,
  buildDispute,
  canReissueLink,
  CANCELLED,
  CHARGEBACK_RECORDED,
  CLOSE_PARKED,
  confirmedRefunded,
  currencyDigits,
  decisionsFor,
  DISPUTE_DUPLICATE,
  DISPUTE_PROBLEMS,
  DISPUTE_RECORDED,
  disputeLines,
  effectText,
  FOLLOW_REPLACES,
  FOLLOW_WAITS_FOR_LINES,
  followStart,
  followWaitSentence,
  IN_FLIGHT_SENTENCE,
  inFlight,
  isOtherMode,
  isParkedAttempt,
  isSarReview,
  isVoided,
  keptRequest,
  keyFor,
  LINES_FAILED,
  LINES_LOADING,
  linesAnswered,
  linesFor,
  linesSentence,
  NEEDS_AMOUNT,
  NEEDS_AMOUNT_REVIEW,
  NEEDS_REFUND_REASON,
  NOT_ENROLLED,
  orderRefundFields,
  OTHER_CURRENCY_SENTENCE,
  OTHER_MODE_SENTENCE,
  PARKED_CLOSED,
  paymentModeOf,
  readAmount,
  readCreateReply,
  readDisputeReply,
  readPaymentRecheck,
  readRefundReply,
  receivedReturns,
  refundBody,
  refundCurrency,
  refundEffects,
  refundForm,
  refundPanel,
  refundProblem,
  refundRequest,
  REFUND_FAILED,
  REFUND_KEPT_REPLY,
  REFUND_UNCERTAIN,
  reviewAmountText,
  reviewRefundFields,
  riyadhToday,
  shippingLeft,
  sum,
  TOTAL_ABOVE,
  VOIDED_SENTENCE,
  withStepUp,
  type DisputeInput,
  type DisputeLine,
  type Kept,
  type KeptForm,
  type RefundBody,
  type RefundField,
  type Verdict,
} from '../../src/lib/admin-money'
import { parseDisputeReply, parsePaymentRecheckReply, parseRefundReply } from '../../src/lib/admin-orders'
import { formatMoney } from '../../src/lib/format'
import type { FunctionResult } from '../../src/lib/supabase/functions'

// RefundView and DisputeForm (rendered once, as static markup, at the end of this file) import through the `@/` alias, which the unit
// config does not resolve; the libraries they use are the real ones, the rest is stubbed.
vi.mock('@/lib/admin-money', async () => import('../../src/lib/admin-money'))
vi.mock('@/lib/admin-orders', async () => import('../../src/lib/admin-orders'))
vi.mock('@/lib/format', async () => import('../../src/lib/format'))
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({}) }))
vi.mock('@/lib/supabase/functions', () => ({ callFunction: async () => ({}) }))
vi.mock('../../src/components/admin/StepUp', () => ({ StepUp: () => null }))
vi.mock('../../src/components/admin/OrdersView', () => ({ Enum: () => null, Fact: () => null, ltrLong: () => null }))

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

  // F3-2: the number `refund_request` compares `expectedRefunded` with, computed the way the SQL does it.
  it('adds the succeeded refunds of the paying attempt, whatever their source, and nothing else: the confirmed total a refund is built from', () => {
    const refunds = [
      { attemptId: D, status: 'succeeded', amount: 1000, source: 'admin' },
      { attemptId: D, status: 'succeeded', amount: 6000, source: 'provider_dashboard' },
      { attemptId: D, status: 'failed', amount: 500, source: 'admin' },
      { attemptId: D, status: 'uncertain', amount: 700, source: 'admin' },
      { attemptId: D, status: 'submitting', amount: 300, source: 'admin' },
      { attemptId: E, status: 'succeeded', amount: 900, source: 'admin' },
      // A review payment's refund of this order belongs to the payment, not to the attempt.
      { attemptId: null, status: 'succeeded', amount: 800, source: 'admin' },
    ]
    const detail = { attempts: [{ id: D, captured: 10600 }], refunds } as unknown as Parameters<typeof confirmedRefunded>[0] & Parameters<typeof attemptBalance>[0]
    expect(confirmedRefunded(detail, D)).toBe(7000)
    expect(confirmedRefunded(detail, E)).toBe(900)
    expect(confirmedRefunded(detail, A)).toBe(0)
    expect(confirmedRefunded({ refunds: [] } as unknown as Parameters<typeof confirmedRefunded>[0], D)).toBe(0)
    // What the cap takes off is the same number.
    expect(attemptBalance(detail, D)).toBe(10600 - confirmedRefunded(detail, D))
  })

  it('knows that a refund of the paying attempt is in flight (submitting or uncertain), and that no other refund counts', () => {
    const detail = (...statuses: Array<[string | null, string]>) =>
      ({ refunds: statuses.map(([attemptId, status]) => ({ attemptId, status })) }) as unknown as Parameters<typeof attemptRefundInFlight>[0]
    expect(attemptRefundInFlight(detail([D, 'submitting']), D)).toBe(true)
    expect(attemptRefundInFlight(detail([D, 'succeeded'], [D, 'uncertain']), D)).toBe(true)
    expect(attemptRefundInFlight(detail([D, 'succeeded'], [D, 'failed']), D)).toBe(false)
    // Another attempt's refund, a review payment's and no refund at all do not stop this attempt's form.
    expect(attemptRefundInFlight(detail([E, 'submitting'], [null, 'uncertain']), D)).toBe(false)
    expect(attemptRefundInFlight(detail(), D)).toBe(false)
    expect(IN_FLIGHT_SENTENCE).toBe('استرداد قيد التنفيذ على هذه الدفعة؛ انتظر نتيجته.')
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
    expectedRefunded: 0,
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
      expectedRefunded: 0,
    })
    expect(refundBody(args([[lineA, 0], [lineB, 4000], [shipping, 0]]))).toEqual({
      action: 'refund-create',
      orderId: C,
      attemptId: D,
      amount: 4000,
      reason: 'استرداد',
      allocation: { items: [{ itemId: B, amount: 4000 }] },
      expectedRefunded: 0,
    })
    // Shipping alone: no line, an empty list of them.
    expect(refundBody(args([[lineA, 0], [shipping, 2500]]))).toMatchObject({ amount: 2500, allocation: { items: [], shipping: 2500 } })
  })

  it('keeps the allocation equal to the amount, whatever the fields hold', () => {
    for (const amounts of [[3500, 0, 0], [1, 2, 3], [6000, 4000, 2500], [0, 0, 1]]) {
      const body = refundBody(args([[lineA, amounts[0]!], [lineB, amounts[1]!], [shipping, amounts[2]!]])) as unknown as {
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

  it('always says the confirmed total the form was built from, zero included (the function refuses a refund without it)', () => {
    expect(refundBody(args([[lineA, 3500]], { expectedRefunded: 3500 }))).toEqual({
      action: 'refund-create',
      orderId: C,
      attemptId: D,
      amount: 3500,
      reason: 'استرداد',
      allocation: { items: [{ itemId: A, amount: 3500 }] },
      expectedRefunded: 3500,
    })
    // Zero is a total: nothing refunded yet is what the function compares with.
    expect(refundBody(args([[lineA, 100]], { expectedRefunded: 0 }))).toMatchObject({ expectedRefunded: 0 })
    expect(refundBody(args([[lineA, 100]]))).toHaveProperty('expectedRefunded', 0)
    const review: RefundField = { key: 'amount', itemId: null, label: 'المبلغ', remainder: 10600 }
    expect(refundBody(args([[review, 5000]], { orderId: null, attemptId: null, reviewPaymentId: PAYMENT, expectedRefunded: 1000 }))).toEqual({
      action: 'refund-create',
      reviewPaymentId: PAYMENT,
      amount: 5000,
      reason: 'استرداد',
      allocation: {},
      expectedRefunded: 1000,
    })
    expect(refundBody(args([[review, 5000]], { orderId: null, attemptId: null, reviewPaymentId: PAYMENT }))).toHaveProperty('expectedRefunded', 0)
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
      expectedRefunded: 0,
    })
    const unmapped = refundBody(args([[review, 5000]], { orderId: null, attemptId: null, reviewPaymentId: PAYMENT }))
    expect(unmapped).toEqual({ action: 'refund-create', reviewPaymentId: PAYMENT, amount: 5000, reason: 'استرداد', allocation: {}, expectedRefunded: 0 })
    expect('orderId' in unmapped).toBe(false)
  })
})

describe("the idempotency key's life", () => {
  const body = (amount: number) =>
    refundBody({ orderId: C, attemptId: D, reviewPaymentId: null, reason: 'سبب', amounts: [{ field: { key: A, itemId: A, label: 'أ', remainder: 9000 }, halalas: amount }], returnId: null, expectedRefunded: 0 })

  it('mints a key for a request nothing was kept for, and keeps it for the same request', () => {
    const mint = vi.fn(() => 'key-1')
    const first = keyFor(null, JSON.stringify(body(100)), mint, 0)
    expect(first.key).toBe('key-1')
    expect(keyFor(first, JSON.stringify(body(100)), mint, 0)).toBe(first)
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('renews it when the request changed: any field of it', () => {
    let n = 0
    const mint = () => `key-${(n += 1)}`
    const first = keyFor(null, JSON.stringify(body(100)), mint, 0)
    const other = keyFor(first, JSON.stringify(body(101)), mint, 0)
    expect(other.key).not.toBe(first.key)
    const reason = keyFor(first, JSON.stringify({ ...body(100), reason: 'غيره' }), mint, 0)
    expect(reason.key).not.toBe(first.key)
    // A change undone is the very same request again.
    expect(keyFor(other, JSON.stringify(body(101)), mint, 0)).toBe(other)
  })

  it('goes through a step-up retry and a network retry, and goes with a final answer', () => {
    let n = 0
    const mint = () => `key-${(n += 1)}`
    let kept: Kept | null = null
    // What the confirmation does for the body on screen, and what the answer then does to the kept request.
    const confirm = (amount: number): string => {
      kept = keyFor(kept, JSON.stringify(body(amount)), mint, 0)
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

// F3-2 (ADMIN-COMMERCE-05): the body also says which confirmed total the form was built from. The function hashes that total with
// the rest of the request, so the key must keep protecting the owner from a second refund: it goes with the form, and a kept key
// sends the total it was minted with.
describe('the idempotency key and the confirmed total', () => {
  const framed = (amount: number, expectedRefunded = 0): RefundBody =>
    refundBody({ orderId: C, attemptId: D, reviewPaymentId: null, reason: 'سبب', amounts: [{ field: { key: A, itemId: A, label: 'أ', remainder: 9000 }, halalas: amount }], returnId: null, expectedRefunded })
  /** What the key is bound to: the body without its confirmed total. */
  const fingerprintOf = (amount: number): string => {
    const { expectedRefunded: _total, ...request } = framed(amount)
    return JSON.stringify(request)
  }
  const counter = () => {
    let n = 0
    return vi.fn(() => `key-${(n += 1)}`)
  }

  it('sends the body with a fresh key and the total it was built from', () => {
    const sent = refundRequest(null, framed(100, 3500), counter())
    expect(sent.body).toEqual({ ...framed(100, 3500), idempotencyKey: 'key-1' })
    expect(sent.kept).toEqual({ key: 'key-1', fingerprint: fingerprintOf(100), expectedRefunded: 3500 })
    // Nothing refunded yet is a total too, and goes with the body.
    const none = refundRequest(null, framed(100), counter())
    expect(none.body).toEqual({ ...framed(100, 0), idempotencyKey: 'key-1' })
    expect(none.body).toHaveProperty('expectedRefunded', 0)
    expect(none.kept).toHaveProperty('expectedRefunded', 0)
  })

  it('(a) a retry of the same form after the order changed keeps the key and the total it was first sent with', () => {
    const mint = counter()
    const first = refundRequest(null, framed(100, 0), mint)
    // A refund was confirmed meanwhile and the screen read the order again: the same form, confirmed again, now says 3 500.
    const retry = refundRequest(first.kept, framed(100, 3500), mint)
    expect(retry.kept).toBe(first.kept)
    expect(retry.body).toEqual(first.body)
    expect(retry.body).toMatchObject({ idempotencyKey: 'key-1', expectedRefunded: 0 })
    // And again, after the code dialog and after a network failure: the very same request each time.
    const third = refundRequest(retry.kept, framed(100, 9999), mint)
    expect(third.body).toEqual(first.body)
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('(b) a changed form mints a fresh key and takes the current total', () => {
    const mint = counter()
    const first = refundRequest(null, framed(100, 0), mint)
    const changed = refundRequest(first.kept, framed(200, 3500), mint)
    expect(changed.body).toMatchObject({ idempotencyKey: 'key-2', expectedRefunded: 3500, amount: 200 })
    expect(changed.kept.key).not.toBe(first.kept.key)
    // Any field of the form is the form: the reason too.
    const reason = refundRequest(first.kept, { ...framed(100, 3500), reason: 'غيره' }, mint)
    expect(reason.body).toMatchObject({ idempotencyKey: 'key-3', expectedRefunded: 3500 })
    // The change undone is the form it was: its own key and total come back with it.
    expect(refundRequest(changed.kept, framed(200, 7000), mint).body).toEqual(changed.body)
  })

  it('(c) STALE is a final answer: the key goes, and the next request takes a fresh key and the total the order now says', () => {
    const mint = counter()
    let kept: Kept | null = null
    const confirm = (amount: number, expectedRefunded: number): Record<string, unknown> => {
      const sent = refundRequest(kept, framed(amount, expectedRefunded), mint)
      kept = sent.kept
      return sent.body
    }
    const first = confirm(100, 0)
    const stale = readCreateReply(fail('STALE', 'تغيّر المسترد منذ فتحت هذه الصفحة؛ راجع جدول الاستردادات ثم أعد المحاولة.'))
    expect(stale).toEqual({
      line: 'alert',
      text: 'تغيّر المسترد منذ فتحت هذه الصفحة؛ راجع جدول الاستردادات ثم أعد المحاولة.',
      done: false,
      keep: false,
      ahead: false,
    })
    // What the screen does with a reading that does not keep the request.
    if (stale !== null && !stale.keep) kept = null
    const next = confirm(100, 3500)
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey)
    expect(next.expectedRefunded).toBe(3500)
  })

  it('keeps the key through the answers that leave the same request to ask again, with the total it had, and drops it with every final one', () => {
    const mint = counter()
    let kept: Kept | null = null
    const confirm = (expectedRefunded: number): Record<string, unknown> => {
      const sent = refundRequest(kept, framed(100, expectedRefunded), mint)
      kept = sent.kept
      return sent.body
    }
    const first = confirm(0)
    // The call never arrived, the function failed on its own, the provider could not be reached: the same request again.
    for (const code of ['UNKNOWN', 'FAILED', 'PROVIDER_UNAVAILABLE']) {
      const reading = readCreateReply(fail(code))
      expect(reading!.keep, code).toBe(true)
      expect(confirm(3500), code).toEqual(first)
    }
    // A reply that cannot be read: the same.
    expect(readCreateReply(done({ status: 'paid' }))!.keep).toBe(true)
    expect(confirm(3500)).toEqual(first)
    // Final answers: a refusal of the request, a stale reading, a refused key, a refund made.
    for (const final of [fail('EXCEEDS_BALANCE'), fail('STALE'), fail('PROVIDER_REFUSED'), done({ refundId: E, status: 'succeeded', amount: 100 })]) {
      expect(readCreateReply(final)!.keep, JSON.stringify(final)).toBe(false)
    }
  })
})

describe('the same form while a key is kept (refundForm, keptRequest)', () => {
  // The owner's inputs, not the request they make: a reading taken since may drop a linked return or a line refunded in full
  // from the request, while the inputs stay what the owner typed. RefundView shows the kept request again for the same inputs.
  it('is the same for the same inputs, whatever order the amounts were typed in, and an emptied field is one never typed in', () => {
    const one = refundForm({ [A]: '30', shipping: '15' }, 'تالف', 'r1')
    expect(refundForm({ shipping: '15', [A]: '30' }, 'تالف', 'r1')).toBe(one)
    expect(refundForm({ [A]: '30', shipping: '15', [B]: '' }, 'تالف', 'r1')).toBe(one)
  })

  it('reads what the inputs say, not how they were typed: one amount however written, the reason as it is sent', () => {
    const one = refundForm({ [A]: '10' }, 'تالف', 'r1')
    for (const same of [
      refundForm({ [A]: '10.00' }, 'تالف', 'r1'),
      refundForm({ [A]: '١٠' }, 'تالف', 'r1'),
      refundForm({ [A]: ' 10 ' }, 'تالف', 'r1'),
      refundForm({ [A]: '10' }, '  تالف ', 'r1'),
    ]) {
      expect(same).toBe(one)
    }
    // A text that is not an amount is kept as typed, so it is never mistaken for one.
    expect(refundForm({ [A]: '1O' }, 'تالف', 'r1')).not.toBe(one)
    expect(refundForm({ [A]: '1O' }, 'تالف', 'r1')).toBe(refundForm({ [A]: '1O' }, 'تالف', 'r1'))
  })

  it('differs when the owner changed anything: an amount, a line, the reason or the return', () => {
    const one = refundForm({ [A]: '30' }, 'تالف', 'r1')
    for (const other of [
      refundForm({ [A]: '31' }, 'تالف', 'r1'),
      refundForm({ [A]: '30', [B]: '5' }, 'تالف', 'r1'),
      refundForm({ [B]: '30' }, 'تالف', 'r1'),
      refundForm({ [A]: '30' }, 'تالف جدًا', 'r1'),
      refundForm({ [A]: '30' }, 'تالف', ''),
      refundForm({ [A]: '30' }, 'تالف', 'r2'),
    ]) {
      expect(other).not.toBe(one)
    }
  })

  // The auditor's A3 path, end to end through the two pure steps RefundView takes: `keptRequest` when «إعادة المبلغ» is
  // pressed, `refundRequest` when the confirmation is sent.
  it('after a lost reply, «رجوع» and the same form send the kept request again (its key, its total), never a second refund', () => {
    let n = 0
    const mint = vi.fn(() => `key-${(n += 1)}`)
    const field = (key: string, remainder: number) => ({ key, itemId: key, label: key, remainder })
    // The form as first frozen: 30 riyals of line A and 15 of line B, with the return r1, on a reading with nothing refunded.
    const typed = { [A]: '30', [B]: '15' }
    const body0 = refundBody({ orderId: C, attemptId: D, reviewPaymentId: null, reason: 'تالف', amounts: [{ field: field(A, 3000), halalas: 3000 }, { field: field(B, 5000), halalas: 1500 }], returnId: 'r1', expectedRefunded: 0 })
    const frozen0 = { body: body0, total: 4500 }
    const first = refundRequest(null, frozen0.body, mint)
    const keptForm: KeptForm<typeof frozen0> = { form: refundForm(typed, 'تالف', 'r1'), frozen: frozen0 }

    // The reply is lost (the key is kept); the refund went through. The order read again: line A refunded in full (its
    // field is gone), the return r1 linked (no longer offered), 4 500 confirmed. Rebuilt from that reading, the same inputs
    // would make another request, B's 15 riyals alone, under a fresh key: a second refund the server would accept.
    const rebuilt = refundBody({ orderId: C, attemptId: D, reviewPaymentId: null, reason: 'تالف', amounts: [{ field: field(B, 3500), halalas: 1500 }], returnId: null, expectedRefunded: 4500 })
    expect(refundRequest(first.kept, rebuilt, mint).body.idempotencyKey).not.toBe(first.body.idempotencyKey)

    // So «إعادة المبلغ» with the same inputs (however typed) shows the kept request, and its confirmation is the first one.
    const again = keptRequest(first.kept, keptForm, refundForm({ [B]: '15.00', [A]: '٣٠' }, ' تالف', 'r1'))
    expect(again).toBe(frozen0)
    expect(refundRequest(first.kept, again!.body, mint).body).toEqual(first.body)
    expect(first.body).toMatchObject({ idempotencyKey: 'key-1', expectedRefunded: 0, returnId: 'r1', amount: 4500 })

    // A changed input is a new request: nothing kept is shown, and its key is fresh, with the total the order now says.
    expect(keptRequest(first.kept, keptForm, refundForm({ [B]: '10' }, 'تالف', ''))).toBeNull()
    // No kept key (a final answer dropped it, and the form with it): the form builds its request anew.
    expect(keptRequest(null, keptForm, keptForm.form)).toBeNull()
    expect(keptRequest(first.kept, null, keptForm.form)).toBeNull()
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

  it('shows the function’s own refusal, flags a refund the provider holds, and keeps the key only when the same request may still be asked', () => {
    expect(readRefundReply(fail('EXCEEDS_BALANCE', 'المبلغ أكبر من المتبقي للاسترداد.'))).toEqual({
      line: 'alert',
      text: 'المبلغ أكبر من المتبقي للاسترداد.',
      done: false,
      keep: false,
      ahead: false,
    })
    expect(readRefundReply(fail('PROVIDER_AHEAD', 'رسالة'))).toMatchObject({ ahead: true, keep: false })
    // F3-5 (a): a payment that could not be reached for its total (503 PROVIDER_UNAVAILABLE) is not an answer about the request: an earlier call under the
    // same key may have stored it, and the same button sends it again in a moment, so the key stays.
    for (const code of ['UNKNOWN', 'FAILED', 'PROVIDER_UNAVAILABLE', NOT_ENROLLED]) expect(readRefundReply(fail(code, 'x'))!.keep, code).toBe(true)
    for (const code of ['NOT_REFUNDABLE', 'REFUND_IN_FLIGHT', 'PROVIDER_BEHIND', 'INVALID_ALLOCATION', 'INVALID_RETURN', 'IDEMPOTENCY_CONFLICT', 'NO_DELTA', 'STALE', 'PROVIDER_REFUSED', 'FORBIDDEN', 'INVALID']) {
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

  // F3-5 (a): only `refund-create` has a key to retry under, so only its words promise the retry; the recheck, the external record and
  // every other reader keep «حدّث الصفحة», which is what they can truthfully say.
  it('says a refund-create reply it cannot read with its key kept: the same button retries safely', () => {
    const unreadable = [null, [], 'ok', {}, { status: 'succeeded' }, { refundId: E, status: 'paid', amount: 1 }, { refundId: E, status: 'succeeded', amount: 0 }]
    for (const data of unreadable) {
      expect(readCreateReply(done(data)), JSON.stringify(data)).toEqual({ line: 'alert', text: REFUND_KEPT_REPLY, done: false, keep: true, ahead: false })
      expect(readRefundReply(done(data)), JSON.stringify(data)).toMatchObject({ text: BAD_REPLY, keep: true })
    }
    // A «no» with no refusal in it is the same.
    const bare = { ok: false, error: null } as unknown as FunctionResult<unknown>
    expect(readCreateReply(bare)).toEqual({ line: 'alert', text: REFUND_KEPT_REPLY, done: false, keep: true, ahead: false })
    expect(readRefundReply(bare)).toMatchObject({ text: BAD_REPLY })
    expect(readRefundReply(bare, true)).toMatchObject({ text: BAD_REPLY })
    expect(REFUND_KEPT_REPLY).toBe('تعذّر قراءة الرد؛ أعد المحاولة من هذا الزر؛ المفتاح محفوظ.')
    expect(REFUND_KEPT_REPLY).not.toContain('حدّث الصفحة')
  })

  it('reads every other reply of a refund-create as `readRefundReply` does', () => {
    const replies: Array<FunctionResult<unknown>> = [
      reply('succeeded'),
      reply('uncertain'),
      reply('submitting'),
      reply('failed'),
      fail('EXCEEDS_BALANCE', 'المبلغ أكبر من المتبقي للاسترداد.'),
      fail('PROVIDER_AHEAD', 'رسالة'),
      fail('PROVIDER_UNAVAILABLE', 'تعذّر الوصول إلى بوابة الدفع الآن. لم يتغيّر شيء؛ حاول بعد قليل.'),
      fail('CHARGEBACK_RECORDED', 'x'),
      fail(NOT_ENROLLED, 'x'),
      fail(CANCELLED, ''),
    ]
    for (const result of replies) expect(readCreateReply(result), JSON.stringify(result)).toEqual(readRefundReply(result))
    // The gateway not reached keeps the key and says what the function said: nothing changed, try in a moment.
    expect(readCreateReply(fail('PROVIDER_UNAVAILABLE', 'حاول بعد قليل'))).toEqual({ line: 'alert', text: 'حاول بعد قليل', done: false, keep: true, ahead: false })
    // A key the provider refuses is its own answer, final: the key goes.
    expect(readCreateReply(fail('PROVIDER_REFUSED', 'رفضت بوابة الدفع المفتاح؛ تحقق من إعدادات الدفع.'))).toEqual({
      line: 'alert',
      text: 'رفضت بوابة الدفع المفتاح؛ تحقق من إعدادات الدفع.',
      done: false,
      keep: false,
      ahead: false,
    })
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
    // QUALITY-24: a day that is not on the calendar is refused as the function refuses it (V8 reads 2026-02-30 as 2 March).
    for (const day of ['', '2026-10-04', '2027-01-01', '2026-13-45', '10/02/2026', '2026-02-30', '2026-02-29', '2026-04-31', '20261-01-01']) {
      expect(build({ day }), day).toEqual({ ok: false, message: DISPUTE_PROBLEMS.day })
    }
    expect(build({ day: '2024-02-29' }).ok, 'a real leap day').toBe(true)
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

  it('starts a follow-up from the reference\'s latest row, so that leaving it as it is carries a stop on (F3-3)', () => {
    const latest = { decision: 'fulfillment_stopped', itemIds: [B] }
    const start = followStart(latest, true, lines)
    expect(start).toEqual({ decision: 'fulfillment_stopped', picked: [B] })
    // The form, untouched, records the stop again for the same line instead of ending it with «بلا إجراء».
    expect(build({ decision: start.decision, picked: start.picked }, 2)).toMatchObject({ ok: true, body: { follows: 2, decision: 'fulfillment_stopped', itemIds: [B] } })
    // A revoke is carried on the same way, with the lines that still hold a file.
    expect(followStart({ decision: 'entitlement_revoked', itemIds: [A] }, true, lines)).toEqual({ decision: 'entitlement_revoked', picked: [A] })
    expect(followStart({ decision: 'entitlement_kept', itemIds: [] }, true, lines)).toEqual({ decision: 'entitlement_kept', picked: [] })
    expect(followStart({ decision: 'none', itemIds: [] }, true, lines)).toEqual({ decision: 'none', picked: [] })
  })

  it('drops from a follow-up\'s start what the form can no longer offer', () => {
    // An item the latest row names that is no longer a line of that decision (shipped meanwhile) or no longer a line of the order at all.
    expect(followStart({ decision: 'fulfillment_stopped', itemIds: [B, C, E] }, true, lines)).toEqual({ decision: 'fulfillment_stopped', picked: [B] })
    expect(followStart({ decision: 'fulfillment_stopped', itemIds: [C, E] }, true, lines)).toEqual({ decision: 'fulfillment_stopped', picked: [] })
    expect(followStart({ decision: 'entitlement_revoked', itemIds: [A, B] }, true, lines)).toEqual({ decision: 'entitlement_revoked', picked: [A] })
    // The order's own lines in the order the form draws them, each once, however the row lists them.
    expect(followStart({ decision: 'fulfillment_stopped', itemIds: [B, B] }, true, lines).picked).toEqual([B])
    // While the lines are not known, the decisions that name lines are not on offer: the start is «بلا إجراء» (it is read again when they arrive).
    expect(followStart({ decision: 'fulfillment_stopped', itemIds: [B] }, true, null)).toEqual({ decision: 'none', picked: [] })
    expect(followStart({ decision: 'entitlement_kept', itemIds: [] }, true, null)).toEqual({ decision: 'entitlement_kept', picked: [] })
    // A reference with no payment offers «بلا إجراء» alone; a decision the form does not know falls back to it too.
    expect(followStart({ decision: 'fulfillment_stopped', itemIds: [B] }, false, lines)).toEqual({ decision: 'none', picked: [] })
    expect(followStart({ decision: 'something_new', itemIds: [A] }, true, lines)).toEqual({ decision: 'none', picked: [] })
  })

  it('says under the decision that a follow-up replaces the previous decision of the reference', () => {
    expect(FOLLOW_REPLACES).toBe('قرار هذا السجل يحل محل القرار السابق للمرجع؛ «بلا إجراء» يرفع إيقاف الشحن.')
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

// CONTRACT-04, ADMIN-COMMERCE-08 and -17 (RESIDUALS-1 R2b): once the site's payment mode has changed, the money controls of a payment of
// the mode that was left give way to one sentence; the choice, and what is said, are these.
describe('the other payment mode', () => {
  it('says what the brief words, to the letter', () => {
    expect(OTHER_MODE_SENTENCE).toBe('دفعة من وضع الدفع الآخر؛ تُدار من لوحة Moyasar.')
    expect(CLOSE_PARKED).toBe('إغلاق بعد المراجعة')
    expect(PARKED_CLOSED).toBe('سُجّلت المراجعة.')
    // Product copy: no em dash, and the line ends with a full stop.
    expect(`${OTHER_MODE_SENTENCE}${CLOSE_PARKED}${PARKED_CLOSED}`).not.toContain('—')
  })

  it('reads the mode from the status reply, and nothing from a reply that does not name one', () => {
    const status = (payments: unknown): FunctionResult<unknown> => ({ ok: true, data: { email: { provider: 'resend' }, payments } })
    expect(paymentModeOf(status({ configured: true, mode: 'test', emulator: true }))).toBe('test')
    expect(paymentModeOf(status({ configured: true, mode: 'live', emulator: false }))).toBe('live')
    // The payments are not configured (no mode), a mode that is none, a reply of another shape and a call that failed: unreadable.
    for (const unreadable of [
      status({ configured: false, reason: 'NOT_CONFIGURED', emulator: false }),
      status({ configured: true, mode: 'staging' }),
      status({ configured: true, mode: 'TEST' }),
      status(null),
      status('live'),
      { ok: true, data: null } as FunctionResult<unknown>,
      { ok: true, data: 'live' } as FunctionResult<unknown>,
      { ok: true, data: {} } as FunctionResult<unknown>,
      { ok: false, error: { code: 'FORBIDDEN', message: 'x' } } as FunctionResult<unknown>,
      { ok: false, error: { code: 'UNKNOWN', message: 'x' } } as FunctionResult<unknown>,
    ]) {
      expect(paymentModeOf(unreadable), JSON.stringify(unreadable)).toBeNull()
    }
  })

  it('a payment is of the other mode when its environment is not the site\'s; with no mode read, nothing is, so the controls stay', () => {
    expect(isOtherMode('live', 'test')).toBe(true)
    expect(isOtherMode('test', 'live')).toBe(true)
    expect(isOtherMode('test', 'test')).toBe(false)
    expect(isOtherMode('live', 'live')).toBe(false)
    expect(isOtherMode(null, 'test')).toBe(false)
    expect(isOtherMode(null, 'live')).toBe(false)
    // A value that is no mode is not the site's either, but it is no reason to hide a control when the mode is unknown.
    expect(isOtherMode('live', 'staging')).toBe(true)
  })

  it('an attempt is closable only when the job parked it: marked MODE_CHANGED, with an invoice, and not paid or in review', () => {
    const parked = { status: 'expired', lastError: 'MODE_CHANGED', providerInvoiceId: A }
    expect(isParkedAttempt(parked)).toBe(true)
    expect(isParkedAttempt({ ...parked, status: 'pending' })).toBe(true)
    expect(isParkedAttempt({ ...parked, status: 'paid' })).toBe(false)
    expect(isParkedAttempt({ ...parked, status: 'review' })).toBe(false)
    expect(isParkedAttempt({ ...parked, providerInvoiceId: null })).toBe(false)
    expect(isParkedAttempt({ ...parked, lastError: 'UNVERIFIED' })).toBe(false)
    expect(isParkedAttempt({ ...parked, lastError: null })).toBe(false)
  })
})

// ADMIN-COMMERCE-11 (RESIDUALS-1 R3b): what the confirmation of an order's refund lists besides the money, from the order, the frozen lines,
// the total and what the paying attempt can still give back. The ledger's rule is `finance.item_fully_refunded`.
describe('what a refund also does', () => {
  type EffectDetail = Parameters<typeof refundEffects>[0]
  const P1 = '66666666-6666-4666-8666-666666666666'
  const P2 = '77777777-7777-4777-8777-777777777777'
  /** A line of the order as `order_detail` gives it: a paper one (SKU `BOOK-P`) unless told otherwise. */
  const line = (id: string, variantTitle: string, over: Record<string, unknown> = {}) => ({
    id,
    productTitle: 'كتاب',
    variantTitle,
    sku: 'BOOK-P',
    fulfillment: 'physical',
    total: 5000,
    refunded: 0,
    fullyRefunded: false,
    stopped: false,
    preorder: null,
    ...over,
  })
  const digital = (id = A, over: Record<string, unknown> = {}) => line(id, 'رقمي', { sku: 'BOOK-D', fulfillment: 'digital', total: 3500, ...over })
  const paper = (id = B, over: Record<string, unknown> = {}) => line(id, 'ورقي', over)
  const preparing = (itemId: string, state = 'preparing') => ({ itemId, state })
  const entitled = (itemId: string, revokedAt: string | null = null) => ({ itemId, revokedAt })

  /** What the confirmation lists, as plain sentences. */
  function listed(
    items: Array<ReturnType<typeof line>>,
    fulfillments: Array<ReturnType<typeof preparing>>,
    entitlements: Array<ReturnType<typeof entitled>>,
    lines: Array<[string, number]>,
    balance: number,
  ): string[] {
    const total = lines.reduce((all, [, halalas]) => all + halalas, 0)
    return refundEffects(
      { items, fulfillments, entitlements } as unknown as EffectDetail,
      lines.map(([key, halalas]) => ({ key, halalas })),
      total,
      balance,
    ).map(effectText)
  }

  it('lists nothing for a line refunded in part', () => {
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [[A, 1000], [B, 2500]], 8500)).toEqual([])
    // Also a line that has already been refunded in part: it counts when this amount is what is left of it.
    expect(listed([digital(A, { refunded: 1000 })], [], [entitled(A)], [[A, 1000]], 9000)).toEqual([])
  })

  it('says the file of a digital line refunded in full is withdrawn: its amount is what is left of it', () => {
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [[A, 3500]], 8500)).toEqual(['سيُسحب الملف: كتاب: رقمي'])
    // A line partly refunded before counts for what is left of it.
    expect(listed([digital(A, { refunded: 1000 })], [], [entitled(A)], [[A, 2500]], 9000)).toEqual(['سيُسحب الملف: كتاب: رقمي'])
  })

  it('says a paper or signed line refunded in full that is still being prepared will not ship, and once for the SKU that the stock does not come back', () => {
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [[B, 5000]], 8500)).toEqual([
      'لن يُشحن: كتاب: ورقي',
      'لا يعود المخزون تلقائيًا؛ عدّل مخزون BOOK-P بعد الاسترداد.',
    ])
    expect(listed([paper(B, { fulfillment: 'signed' })], [preparing(B)], [], [[B, 5000]], 5000)).toEqual([
      'لن يُشحن: كتاب: ورقي',
      'لا يعود المخزون تلقائيًا؛ عدّل مخزون BOOK-P بعد الاسترداد.',
    ])
  })

  it('says it for every line when the total takes all the payment can still give back, whatever the lines say', () => {
    // A refund of 4000 on a payment with 4000 left: the order becomes refunded, every line counts as refunded in full.
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [[B, 4000]], 4000)).toEqual([
      'سيُسحب الملف: كتاب: رقمي',
      'لن يُشحن: كتاب: ورقي',
      'لا يعود المخزون تلقائيًا؛ عدّل مخزون BOOK-P بعد الاسترداد.',
    ])
    // The shipping alone can empty it too.
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [['shipping', 1500]], 1500)).toHaveLength(3)
    // One halala less than all of it, and the lines decide again.
    expect(listed([digital(), paper()], [preparing(B)], [entitled(A)], [[B, 3999]], 4000)).toEqual([])
  })

  it('lists nothing for a physical line that has shipped or been delivered, even when everything is refunded', () => {
    for (const state of ['shipped', 'delivered']) {
      expect(listed([paper()], [preparing(B, state)], [], [[B, 5000]], 5000), state).toEqual([])
    }
    // A line with no fulfilment at all (an order awaiting its resolution) has nothing to stop either.
    expect(listed([paper()], [], [], [[B, 5000]], 5000)).toEqual([])
  })

  it('lists nothing for a line a dispute already stopped', () => {
    expect(listed([paper(B, { stopped: true })], [preparing(B)], [], [[B, 5000]], 5000)).toEqual([])
  })

  it('lists nothing for a line already refunded in full, even when the total empties the payment', () => {
    expect(listed([digital(A, { fullyRefunded: true, refunded: 3500 }), paper(B, { fullyRefunded: true, refunded: 5000 })], [preparing(B)], [entitled(A)], [['shipping', 1500]], 1500)).toEqual([])
  })

  it('says the stock once for each SKU: two lines of one SKU, and one of another', () => {
    expect(listed([paper(P1), paper(P2), paper(B, { sku: 'BOOK-Q' })], [preparing(P1), preparing(P2), preparing(B)], [], [[P1, 5000], [P2, 5000], [B, 5000]], 20000)).toEqual([
      'لن يُشحن: كتاب: ورقي',
      'لا يعود المخزون تلقائيًا؛ عدّل مخزون BOOK-P بعد الاسترداد.',
      'لن يُشحن: كتاب: ورقي',
      'لن يُشحن: كتاب: ورقي',
      'لا يعود المخزون تلقائيًا؛ عدّل مخزون BOOK-Q بعد الاسترداد.',
    ])
  })

  it('says no file is withdrawn when there is none to withdraw: a file already withdrawn, or none granted yet', () => {
    expect(listed([digital()], [], [entitled(A, '2026-10-03T00:00:00+00:00')], [[A, 3500]], 3500)).toEqual([])
    expect(listed([digital()], [], [], [[A, 3500]], 3500)).toEqual([])
  })

  it('does not tell the owner to adjust the stock of a preorder line: it took none, and its capacity is released', () => {
    expect(listed([paper(B, { preorder: { shipsOn: '2026-12-01', note: 'x' } })], [preparing(B)], [], [[B, 5000]], 5000)).toEqual(['لن يُشحن: كتاب: ورقي'])
  })

  it("draws the SKU on its own, left to right, and the line's name as a name", () => {
    const [ship, stock] = refundEffects(
      { items: [paper()], fulfillments: [preparing(B)], entitlements: [] } as unknown as EffectDetail,
      [{ key: B, halalas: 5000 }],
      5000,
      5000,
    )
    expect(ship).toEqual({ lead: 'لن يُشحن: ', subject: 'كتاب: ورقي', tail: '', ltr: false })
    expect(stock).toEqual({ lead: 'لا يعود المخزون تلقائيًا؛ عدّل مخزون ', subject: 'BOOK-P', tail: ' بعد الاسترداد.', ltr: true })
  })

  it('lists nothing for an order with no line, or a refund of nothing', () => {
    expect(listed([], [], [], [], 0)).toEqual([])
    expect(listed([paper()], [preparing(B)], [], [], 0)).toEqual([])
  })
})

// ADMIN-COMMERCE-09 and -06 (RESIDUALS-1 R3b): a payment Moyasar shows voided, and a review payment in another currency.
describe('a payment Moyasar shows voided, a review payment in another currency', () => {
  it('says what the brief words, to the letter', () => {
    expect(VOIDED_SENTENCE).toBe('أُلغيت هذه الدفعة لدى Moyasar؛ سجّل الإلغاء هنا.')
    expect(OTHER_CURRENCY_SENTENCE).toBe('دفعة بعملة أخرى؛ أعدها من لوحة Moyasar ثم سجّلها هنا.')
    expect(`${VOIDED_SENTENCE}${OTHER_CURRENCY_SENTENCE}`).not.toContain('—')
  })

  it('knows a void by the provider status, and nothing else', () => {
    expect(isVoided('voided')).toBe(true)
    for (const status of ['paid', 'refunded', 'captured', 'authorized', 'VOIDED', '', null]) expect(isVoided(status), String(status)).toBe(false)
  })

  it("the refund form gives way to the void's sentence while no refund is in flight, then to the other currency's, then to «nothing left»", () => {
    const state = { waiting: false, voided: false, otherCurrency: false, fields: 2 }
    expect(refundPanel(state)).toBe('form')
    expect(refundPanel({ ...state, voided: true })).toBe('voided')
    expect(refundPanel({ ...state, otherCurrency: true })).toBe('other-currency')
    expect(refundPanel({ ...state, fields: 0 })).toBe('empty')
    // A void with nothing drawn for it, and a void beside a currency: the void's sentence.
    expect(refundPanel({ ...state, voided: true, fields: 0 })).toBe('voided')
    expect(refundPanel({ ...state, voided: true, otherCurrency: true })).toBe('voided')
    expect(refundPanel({ ...state, otherCurrency: true, fields: 0 })).toBe('other-currency')
    // A refund in flight comes first: another would be refused, whatever the void or the currency says.
    expect(refundPanel({ waiting: true, voided: true, otherCurrency: true, fields: 0 })).toBe('waiting')
    expect(refundPanel({ ...state, waiting: true })).toBe('waiting')
  })

  it('a review payment is in riyals only when its currency is SAR', () => {
    expect(isSarReview('SAR')).toBe(true)
    for (const currency of ['USD', 'KWD', 'sar', '', null]) expect(isSarReview(currency), String(currency)).toBe(false)
  })

  it('reads the digits of a currency from Intl: 2 for a code it does not know', () => {
    expect(currencyDigits('SAR')).toBe(2)
    expect(currencyDigits('USD')).toBe(2)
    expect(currencyDigits('KWD')).toBe(3)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('XYZ')).toBe(2)
    // Not a currency code at all.
    expect(currencyDigits('')).toBe(2)
    expect(currencyDigits('NOT A CODE')).toBe(2)
  })

  it("writes the amount in the currency's own units with its code, and never as riyals: SAR, USD, KWD, an unknown code", () => {
    expect(reviewAmountText(1000, 'SAR')).toBe(formatMoney(1000))
    expect(reviewAmountText(1000, 'SAR')).toBe('10.00 ر.س')
    // 1000 minor units: USD 10.00 (not 10.00 riyals), KWD 1.000 (a thousandth each), and 10000 of them are KWD 10.000.
    expect(reviewAmountText(1000, 'USD')).toBe('10.00 USD')
    expect(reviewAmountText(10_000, 'KWD')).toBe('10.000 KWD')
    expect(reviewAmountText(1000, 'KWD')).toBe('1.000 KWD')
    expect(reviewAmountText(500, 'JPY')).toBe('500 JPY')
    expect(reviewAmountText(1234, 'XYZ')).toBe('12.34 XYZ')
    expect(reviewAmountText(0, 'USD')).toBe('0.00 USD')
    expect(reviewAmountText(5, 'USD')).toBe('0.05 USD')
    expect(reviewAmountText(2_147_483_647, 'KWD')).toBe('2147483.647 KWD')
    for (const currency of ['USD', 'KWD', 'JPY', 'XYZ', null]) expect(reviewAmountText(1000, currency), String(currency)).not.toContain('ر.س')
    // A missing currency has no code to draw: the number alone, never as riyals.
    expect(reviewAmountText(1000, null)).toBe('10.00')
  })

  it('says the recorded refund of such a payment in its currency too, never as riyals', () => {
    const recorded = done({ refundId: A, status: 'succeeded', amount: 600 })
    expect(readRefundReply(recorded, true)?.text).toBe(`سُجّل استرداد خارجي بمبلغ ${formatMoney(600)}.`)
    expect(readRefundReply(recorded, true, 'SAR')?.text).toBe(`سُجّل استرداد خارجي بمبلغ ${formatMoney(600)}.`)
    expect(readRefundReply(recorded, true, 'USD')?.text).toBe('سُجّل استرداد خارجي بمبلغ 6.00 USD.')
    expect(readRefundReply(recorded, true, 'KWD')?.text).toBe('سُجّل استرداد خارجي بمبلغ 0.600 KWD.')
    // The refund of an order's payment is in riyals, as it always was.
    expect(readRefundReply(recorded)?.text).toBe(`تمت إعادة ${formatMoney(600)}.`)
    expect(readCreateReply(recorded)?.text).toBe(`تمت إعادة ${formatMoney(600)}.`)
  })

  it("says a refund row, and its recheck, in its review payment's currency: riyals for the order's own payment or a review the screen does not list", () => {
    const reviews = [
      { paymentId: 'pay_usd', currency: 'USD' },
      { paymentId: 'pay_sar', currency: 'SAR' },
      { paymentId: 'pay_none', currency: null },
    ]
    expect(refundCurrency({ reviewPaymentId: 'pay_usd' }, reviews)).toBe('USD')
    expect(refundCurrency({ reviewPaymentId: 'pay_sar' }, reviews)).toBe('SAR')
    // A listed payment with no currency stays without one (never riyals); the amount is then the number alone.
    expect(refundCurrency({ reviewPaymentId: 'pay_none' }, reviews)).toBeNull()
    expect(refundCurrency({ reviewPaymentId: null }, reviews)).toBe('SAR')
    expect(refundCurrency({ reviewPaymentId: 'pay_gone' }, reviews)).toBe('SAR')
    expect(reviewAmountText(1000, refundCurrency({ reviewPaymentId: 'pay_usd' }, reviews))).toBe('10.00 USD')
    expect(readRefundReply(done({ refundId: A, status: 'succeeded', amount: 1000 }), false, refundCurrency({ reviewPaymentId: 'pay_usd' }, reviews))?.text).toBe('تمت إعادة 10.00 USD.')
  })
})

// ADMIN-COMMERCE-12 (RESIDUALS-1 R3b): the lines read for a dispute form, and what the form says while they load or when they failed.
describe('the lines of the open dispute form', () => {
  const lines: DisputeLine[] = [{ id: A, name: 'كتاب', entitled: true, preparing: false }]

  it('keeps an answer for the form that is open, whatever it holds', () => {
    expect(linesAnswered('review:x', { key: 'review:x', order: 'ABCD2345', lines })).toEqual({ order: 'ABCD2345', lines })
    expect(linesAnswered('review:x', { key: 'review:x', order: 'ABCD2345', lines: 'failed' })).toEqual({ order: 'ABCD2345', lines: 'failed' })
  })

  it('drops the answer of a form that is no longer the open one: another form was opened, or this one was closed', () => {
    // Form X asked, form Y was opened and answered first, then X answered late: X's answer must not replace Y's.
    expect(linesAnswered('review:y', { key: 'review:x', order: 'ABCD2345', lines })).toBeNull()
    expect(linesAnswered(null, { key: 'review:x', order: 'ABCD2345', lines })).toBeNull()
    expect(linesAnswered('review:y', { key: 'review:x', order: 'ABCD2345', lines: 'failed' })).toBeNull()
  })

  it("says «يحمّل بنود الطلب…» while they load, and the failure in the brief's words, and nothing otherwise", () => {
    expect(LINES_LOADING).toBe('يحمّل بنود الطلب…')
    expect(LINES_FAILED).toBe('تعذّر قراءة بنود الطلب؛ أغلق النموذج وافتحه من جديد أو سجّل من صفحة الطلب.')
    expect(linesSentence('loading')).toBe(LINES_LOADING)
    expect(linesSentence('failed')).toBe(LINES_FAILED)
    expect(linesSentence(lines)).toBeNull()
    expect(linesSentence([])).toBeNull()
    // A form with no order has no lines to wait for.
    expect(linesSentence(null)).toBeNull()
  })

  it('a follow-up pressed before its lines are known says to wait while they load, and to reopen the form when they could not be read', () => {
    expect(followWaitSentence('loading')).toBe(FOLLOW_WAITS_FOR_LINES)
    // The read is never retried: waiting would not help.
    expect(followWaitSentence('failed')).toBe(LINES_FAILED)
  })

  it('offers, loading or failed, what it offers without lines: the decisions that name none', () => {
    // `DisputeForm` hands decisionsFor `null` in both cases.
    expect(decisionsFor(true, null)).toEqual(['none', 'entitlement_kept'])
    expect(decisionsFor(false, null)).toEqual(['none'])
  })
})

// The order's link of the other payment mode (RESIDUALS-1 R3b, R2b's audit): the order page answers such a link NOT_FOUND.
describe('the order link', () => {
  it("is offered for the statuses `order_link_reissue` takes, on an order of the site's own mode", () => {
    for (const status of ['paid', 'paid_needs_resolution', 'refunded']) {
      expect(canReissueLink(status, 'test', 'test'), status).toBe(true)
      expect(canReissueLink(status, 'live', 'live'), status).toBe(true)
    }
    for (const status of ['pending_payment', 'expired', 'cancelled']) expect(canReissueLink(status, 'test', 'test'), status).toBe(false)
  })

  it('is not offered on an order of the other payment mode', () => {
    expect(canReissueLink('paid', 'live', 'test')).toBe(false)
    expect(canReissueLink('paid', 'test', 'live')).toBe(false)
    expect(canReissueLink('refunded', 'live', 'test')).toBe(false)
  })

  it('stays when the mode could not be read, as the money controls do', () => {
    expect(canReissueLink('paid', null, 'test')).toBe(true)
    expect(canReissueLink('paid', null, 'live')).toBe(true)
    expect(canReissueLink('pending_payment', null, 'test')).toBe(false)
  })
})

// The screens' own wiring of the above, rendered once as static markup (the state a screen mounts in; the e2e specs click through it).
describe('what the refund form and the dispute form draw (RESIDUALS-1 R3b)', () => {
  const money: Money = { busy: false, run: async () => undefined, say: () => undefined, clear: () => undefined, ask: async () => 'cancelled' }
  const orderOf = (attempt: Record<string, unknown>, refunds: unknown[] = []): RefundSubject => ({
    kind: 'order',
    attemptId: D,
    detail: {
      order: { shipping: 0, id: E },
      items: [{ id: A, productTitle: 'كتاب', variantTitle: 'ورقي', sku: 'BOOK-P', total: 5000, refunded: 0 }],
      attempts: [{ id: D, captured: 5000, providerStatus: 'paid', ...attempt }],
      refunds,
      returns: [],
      disputes: null,
    } as unknown as Extract<RefundSubject, { kind: 'order' }>['detail'],
  })
  const reviewOf = (currency: string | null, over: Partial<Extract<RefundSubject, { kind: 'review' }>> = {}): RefundSubject => ({
    kind: 'review',
    paymentId: PAYMENT,
    orderId: null,
    remainder: 1000,
    refunded: 0,
    currency,
    ...over,
  })
  const draw = (subject: RefundSubject): string => renderToStaticMarkup(createElement(RefundView, { subject, money }))

  it('a payment Moyasar shows voided: the sentence, the external record already open, and no refund form', () => {
    const html = draw(orderOf({ providerStatus: 'voided' }))
    expect(html).toContain(VOIDED_SENTENCE)
    expect(html).not.toContain('إعادة المبلغ')
    expect(html).not.toContain('الإجمالي')
    // The external record is open: its sentence, its reason field and its confirmation are drawn, with «رجوع» to close it.
    expect(html).toContain('سجّل هنا استردادًا أو إلغاءً تمّ من لوحة Moyasar')
    expect(html).toContain('تأكيد التسجيل')
    expect(html).toContain('رجوع')
  })

  it('a payment that is paid draws the refund form, and the external record closed behind its button', () => {
    const html = draw(orderOf({}))
    expect(html).toContain('إعادة المبلغ')
    expect(html).not.toContain(VOIDED_SENTENCE)
    expect(html).toContain('تسجيل استرداد خارجي')
    expect(html).not.toContain('تأكيد التسجيل')
  })

  it('a refund in flight comes before the void: its sentence, not the void\'s', () => {
    const html = draw(orderOf({ providerStatus: 'voided' }, [{ status: 'uncertain', attemptId: D, amount: 1000, allocation: {} }]))
    expect(html).toContain(IN_FLIGHT_SENTENCE)
    expect(html).not.toContain(VOIDED_SENTENCE)
  })

  it('a review payment in another currency: the sentence in place of the form, and the external record kept', () => {
    for (const currency of ['USD', 'KWD', null]) {
      const html = draw(reviewOf(currency))
      expect(html, String(currency)).toContain(OTHER_CURRENCY_SENTENCE)
      expect(html, String(currency)).not.toContain('استرداد هذه الدفعة')
      expect(html, String(currency)).not.toContain('المتبقي')
      expect(html, String(currency)).toContain('تسجيل استرداد خارجي')
    }
  })

  it('a review payment in riyals draws the form it always did', () => {
    const html = draw(reviewOf('SAR'))
    expect(html).toContain('استرداد هذه الدفعة')
    expect(html).toContain('المتبقي')
    expect(html).not.toContain(OTHER_CURRENCY_SENTENCE)
  })

  it("draws a review payment's money in riyals as text, and in another currency in its own units, left to right", () => {
    const sar = renderToStaticMarkup(createElement(ReviewMoney, { minor: 1000, currency: 'SAR' }))
    expect(sar).toBe(formatMoney(1000))
    expect(sar).not.toContain('<bdi')
    expect(renderToStaticMarkup(createElement(ReviewMoney, { minor: 1000, currency: 'USD' }))).toBe('<bdi dir="ltr">10.00 USD</bdi>')
    expect(renderToStaticMarkup(createElement(ReviewMoney, { minor: 10_000, currency: 'KWD' }))).toBe('<bdi dir="ltr">10.000 KWD</bdi>')
    expect(renderToStaticMarkup(createElement(ReviewMoney, { minor: 1000, currency: null }))).toBe('<bdi dir="ltr">10.00</bdi>')
  })

  it('the dispute form says the order\'s lines load, or could not be read, and draws the decisions that name none in both cases', () => {
    const form = (lines: Parameters<typeof linesSentence>[0]): string =>
      renderToStaticMarkup(createElement(DisputeForm, { mode: { kind: 'payment', target: { reviewPaymentId: PAYMENT } }, lines, money, onClose: () => undefined }))
    const loading = form('loading')
    expect(loading).toContain(LINES_LOADING)
    expect(loading).toContain('role="status"')
    expect(loading).not.toContain(LINES_FAILED)
    const failed = form('failed')
    expect(failed).toContain(LINES_FAILED)
    expect(failed).toContain('role="alert"')
    expect(failed).not.toContain(LINES_LOADING)
    for (const html of [loading, failed]) {
      // `بلا إجراء` and `إبقاء الملفات` only: nothing that names a line.
      expect(html).toContain('>بلا إجراء<')
      expect(html).toContain('>إبقاء الملفات<')
      expect(html).not.toContain('>سحب الملفات<')
      expect(html).not.toContain('>إيقاف الشحن<')
    }
    // Lines read, or no order at all: no sentence.
    const read = form([{ id: A, name: 'كتاب', entitled: true, preparing: false }])
    expect(read).not.toContain(LINES_LOADING)
    expect(read).not.toContain(LINES_FAILED)
    expect(read).toContain('>سحب الملفات<')
    expect(form(null)).not.toContain(LINES_LOADING)
    expect(form(null)).not.toContain(LINES_FAILED)
  })
})
