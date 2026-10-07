// Relative, not `@/`: tests/unit/admin-money.test.ts imports this file, and the unit config has no alias.
import {
  ATTEMPT_STATUS_LABELS,
  clean,
  labelOf,
  parseDisputeReply,
  parsePaymentRecheckReply,
  parseRefundReply,
  parseReissueReply,
  type OrderDetail,
} from './admin-orders'
import { formatMoney, formatNumber, formatRiyadh } from './format'
import { parseRiyals } from './money-input'
import type { FunctionResult } from './supabase/functions'

/**
 * The owner's money actions (P08 round 11b), the parts that need no React: what a refund form may send
 * (the remainders, the allocation, the body), the life of its idempotency key, the step-up retry, the
 * dispute form's checks and body, and the sentence each answer of the `admin` function becomes. All
 * money is integer halalas: an amount typed in riyals is read by `parseRiyals` (never multiplied as a
 * float), and every sum here adds integers.
 *
 * A refund also says which confirmed refunded total its form was built from (`expectedRefunded`), so the
 * function can refuse a request built from a stale reading (STALE) instead of refunding the same money
 * twice. That total is not part of what the idempotency key is bound to: see `refundRequest`.
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const BAD_REPLY = 'تعذّر قراءة الرد؛ حدّث الصفحة.'
/** What `refund-create` says of a reply it cannot read: its idempotency key is kept, so the same button sends the very same request again. */
export const REFUND_KEPT_REPLY = 'تعذّر قراءة الرد؛ أعد المحاولة من هذا الزر؛ المفتاح محفوظ.'
/** Said in place of the refund form while a refund of the same payment is in flight: another one would only be refused, after a code. */
export const IN_FLIGHT_SENTENCE = 'استرداد قيد التنفيذ على هذه الدفعة؛ انتظر نتيجته.'
/** Said after what an action said, when the screen could not read its data again (what is drawn is the last reading). */
export const REREAD_FAILED = 'تعذّر تحديث الصفحة؛ قد لا تظهر آخر البيانات.'
export const REFUND_UNCERTAIN = 'أُرسل الاسترداد ولم يتأكد بعد؛ تتحقق منه المطابقة خلال دقائق.'
export const REFUND_FAILED = 'رفضت بوابة الدفع الاسترداد؛ لم يُخصم شيء.'
export const REFUND_WARNING = 'سيُعاد المبلغ إلى وسيلة دفع العميل عبر Moyasar، ولا يمكن التراجع عنه.'
/** `refund_request`'s CHARGEBACK_RECORDED, which the function words only generically. */
export const CHARGEBACK_RECORDED = 'سُجّل استرجاع بنكي على هذه الدفعة؛ لا يمكن الاسترداد منها.'
export const EXTERNAL_SENTENCE = 'سجّل هنا استردادًا أو إلغاءً تمّ من لوحة Moyasar؛ يُقرأ المبلغ من Moyasar نفسها.'
export const DISMISS_SENTENCE = 'بعد مراجعتها في لوحة Moyasar.'
export const EMPTY_LIST = 'لا شيء هنا.'
export const LIST_CAP = 100
export const CAPPED = `تُعرض أحدث ${LIST_CAP}.`
export const DISPUTE_RECORDED = 'سُجّل.'
export const DISPUTE_DUPLICATE = 'هذا السجل مسجّل من قبل؛ لم يتغير شيء.'
const GENERIC = 'تعذّر إكمال الإجراء.'
const NEEDS_ENROLLMENT = 'يلزم تفعيل تطبيق المصادقة أولًا من صفحة الأمان.'

// What the forms say when they refuse before any call (the function's own refusals are shown as it words them).
export const AMOUNT_INVALID = 'أدخل مبلغًا صحيحًا بالريال، مثل 69 أو 69.50.'
export const AMOUNT_ABOVE = 'المبلغ أكبر من المتبقي.'
export const TOTAL_ABOVE = 'المجموع أكبر من المتبقي في الدفعة.'
export const NEEDS_AMOUNT = 'أدخل مبلغًا لعنصر أو للشحن.'
export const NEEDS_AMOUNT_REVIEW = 'أدخل المبلغ.'
export const NEEDS_REFUND_REASON = 'اكتب سبب الاسترداد في 300 حرف أو أقل.'
export const NEEDS_EXTERNAL_REASON = 'اكتب سبب التسجيل في 300 حرف أو أقل.'

export const DISPUTE_PROBLEMS = {
  reference: 'أدخل مرجع النزاع كما في رسالة Moyasar، حتى 120 حرفًا.',
  amount: 'أدخل مبلغًا أكبر من صفر بالريال، مثل 69 أو 69.50.',
  day: 'اختر يومًا لا يتجاوز اليوم.',
  reason: 'اكتب سبب النزاع في 500 حرف أو أقل.',
  resolution: 'اكتب الحل في 500 حرف أو أقل.',
  lines: 'اختر بندًا واحدًا على الأقل.',
  noLines: 'لا توجد بنود في هذا الطلب يناسبها هذا القرار.',
} as const

// ---------------------------------------------------------------------------
// What a refund can still take
// ---------------------------------------------------------------------------

/** The form's key of the shipping field; every other field is keyed by its item's id, and a review payment's one field by `amount`. */
export const SHIPPING_KEY = 'shipping'
export const REVIEW_KEY = 'amount'

export interface RefundField {
  key: string
  /** The order item it refunds, or null for the shipping and a review payment's amount. */
  itemId: string | null
  label: string
  /** Halalas still refundable here. */
  remainder: number
}

export const itemName = (item: { productTitle: string; variantTitle: string }): string =>
  [item.productTitle, item.variantTitle].filter((part) => part !== '').join(': ')

/** A refund that holds its share of the balance: confirmed, or still in flight. */
const HOLDS = ['succeeded', 'submitting', 'uncertain']
export const inFlight = (status: string): boolean => status === 'submitting' || status === 'uncertain'

/** What of a refund's allocation went to shipping (an unallocated refund, `{}`, took none). */
const shippingOf = (allocation: Record<string, unknown>): number =>
  Number.isInteger(allocation.shipping) && (allocation.shipping as number) > 0 ? (allocation.shipping as number) : 0

/** The shipping still to refund: the order's, less what the paying attempt's succeeded and in-flight refunds allocated to it. */
export function shippingLeft(
  order: { shipping: number },
  refunds: ReadonlyArray<{ status: string; attemptId: string | null; allocation: Record<string, unknown> }>,
): number {
  let taken = 0
  for (const refund of refunds) {
    if (refund.attemptId !== null && HOLDS.includes(refund.status)) taken += shippingOf(refund.allocation)
  }
  return Math.max(0, order.shipping - taken)
}

/**
 * What the paying attempt can still give back: what it captured less every succeeded refund of it, those recorded
 * from Moyasar's dashboard included (they allocate no line, so no line's remainder shows them). The rule of
 * `refund_request`'s EXCEEDS_BALANCE.
 */
export function attemptBalance(detail: Pick<OrderDetail, 'attempts' | 'refunds'>, attemptId: string): number {
  const captured = detail.attempts.find((attempt) => attempt.id === attemptId)?.captured ?? 0
  return Math.max(0, captured - confirmedRefunded(detail, attemptId))
}

/**
 * What the paying attempt's succeeded refunds add up to, whatever their source (a refund recorded from Moyasar's dashboard
 * included): `refund_request`'s own confirmed total, which a refund asked from this reading of the order is checked against
 * (`expectedRefunded`). A review payment's is the `refunded` of its row.
 */
export function confirmedRefunded(detail: Pick<OrderDetail, 'refunds'>, attemptId: string): number {
  return detail.refunds.reduce((total, refund) => (refund.attemptId === attemptId && refund.status === 'succeeded' ? total + refund.amount : total), 0)
}

/** Whether a refund of the paying attempt is still in flight (submitting, or uncertain): `refund_request` refuses another one until it is settled. */
export const attemptRefundInFlight = (detail: Pick<OrderDetail, 'refunds'>, attemptId: string): boolean =>
  detail.refunds.some((refund) => refund.attemptId === attemptId && inFlight(refund.status))

/**
 * An order's refund form: one field for each line with something left (its total less what was refunded of it), and
 * the shipping when some is left. No field offers more than `cap`, what the paying attempt can still give back.
 */
export function orderRefundFields(detail: Pick<OrderDetail, 'order' | 'items' | 'refunds'>, cap = Number.POSITIVE_INFINITY): RefundField[] {
  const fields: RefundField[] = []
  for (const item of detail.items) {
    const remainder = Math.min(item.total - item.refunded, cap)
    if (remainder > 0) fields.push({ key: item.id, itemId: item.id, label: itemName(item), remainder })
  }
  const shipping = Math.min(shippingLeft(detail.order, detail.refunds), cap)
  if (shipping > 0) fields.push({ key: SHIPPING_KEY, itemId: null, label: 'الشحن', remainder: shipping })
  return fields
}

/** A review payment's refund form: its one field, with what is left of the payment. */
export const reviewRefundFields = (remainder: number): RefundField[] =>
  remainder > 0 ? [{ key: REVIEW_KEY, itemId: null, label: 'المبلغ', remainder }] : []

/** The received returns that no refund is linked to yet, as the select offers them. */
export function receivedReturns(detail: Pick<OrderDetail, 'items' | 'returns'>): Array<{ id: string; label: string }> {
  return detail.returns
    .filter((returned) => returned.state === 'received' && returned.refundId === null)
    .map((returned) => ({
      id: returned.id,
      label: `${returned.items
        .map((line) => {
          const item = detail.items.find((candidate) => candidate.id === line.itemId)
          return `${item === undefined ? line.itemId : itemName(item)} × ${formatNumber(line.quantity)}`
        })
        .join('، ')} (${formatRiyadh(returned.createdAt)})`,
    }))
}

// ---------------------------------------------------------------------------
// An amount typed in riyals
// ---------------------------------------------------------------------------

export type AmountProblem = 'invalid' | 'above'
export interface AmountRead {
  /** Integer halalas; 0 for an empty field and for one that is refused. */
  halalas: number
  problem: AmountProblem | null
}
export const AMOUNT_PROBLEMS: Readonly<Record<AmountProblem, string>> = { invalid: AMOUNT_INVALID, above: AMOUNT_ABOVE }

/** The text of one field as halalas: empty is none, a text that is not an amount (a minus sign, letters, three decimals) or one above what is left is refused. */
export function readAmount(text: string, remainder: number): AmountRead {
  const parsed = parseRiyals(text)
  if (parsed === null) return { halalas: 0, problem: null }
  if (parsed === 'invalid') return { halalas: 0, problem: 'invalid' }
  if (parsed > remainder) return { halalas: 0, problem: 'above' }
  return { halalas: parsed, problem: null }
}

/** The sum of integers. */
export const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** The sentence that refuses a refund before the confirmation, or null when it may go on; `cap` is what the paying attempt can still give back. */
export function refundProblem(reads: readonly AmountRead[], reason: string, review: boolean, cap = Number.POSITIVE_INFINITY): string | null {
  for (const read of reads) if (read.problem !== null) return AMOUNT_PROBLEMS[read.problem]
  const total = sum(reads.map((read) => read.halalas))
  if (total === 0) return review ? NEEDS_AMOUNT_REVIEW : NEEDS_AMOUNT
  if (total > cap) return TOTAL_ABOVE
  const text = clean(reason)
  if (text === '' || text.length > 300) return NEEDS_REFUND_REASON
  return null
}

export interface RefundArgs {
  orderId: string | null
  /** The order's paying attempt, or null for a review payment. */
  attemptId: string | null
  reviewPaymentId: string | null
  reason: string
  amounts: ReadonlyArray<{ field: RefundField; halalas: number }>
  returnId: string | null
  /** The confirmed refunded total the form was built from; absent when the screen cannot say, and the request then carries none. */
  expectedRefunded?: number | null
}

/**
 * The body of `refund-create` without its idempotency key. An order's refund names the lines that have an
 * amount and the shipping only when it is above zero, and the amount is their sum; a review payment's
 * allocation is `{}`, and its `orderId` is sent only when the payment has one. `expectedRefunded` is the
 * confirmed total the form was built from, sent only when the screen has one.
 */
export function refundBody(args: RefundArgs): Record<string, unknown> {
  const amount = sum(args.amounts.map((entry) => entry.halalas))
  const reason = clean(args.reason)
  const expected = typeof args.expectedRefunded === 'number' ? { expectedRefunded: args.expectedRefunded } : {}
  if (args.reviewPaymentId !== null) {
    return {
      action: 'refund-create',
      ...(args.orderId === null ? {} : { orderId: args.orderId }),
      reviewPaymentId: args.reviewPaymentId,
      amount,
      reason,
      allocation: {},
      ...expected,
    }
  }
  const items = args.amounts.flatMap(({ field, halalas }) => (field.itemId !== null && halalas > 0 ? [{ itemId: field.itemId, amount: halalas }] : []))
  const shipping = args.amounts.find(({ field }) => field.key === SHIPPING_KEY)?.halalas ?? 0
  return {
    action: 'refund-create',
    orderId: args.orderId,
    attemptId: args.attemptId,
    amount,
    reason,
    allocation: { items, ...(shipping > 0 ? { shipping } : {}) },
    ...(args.returnId === null ? {} : { returnId: args.returnId }),
    ...expected,
  }
}

// ---------------------------------------------------------------------------
// The idempotency key's life
// ---------------------------------------------------------------------------

/** The key of a refund request, the request (its body as text, without `expectedRefunded`) it was minted for, and the total that request carried. */
export interface Kept {
  key: string
  fingerprint: string
  /** The `expectedRefunded` the request carried when the key was minted; absent when it carried none. */
  expectedRefunded?: number
}

/**
 * The request to send for `fingerprint`: the one kept when it is the very same request (a step-up retry or a
 * retry after a network failure sends the same key, so a repeat answers the stored refund and never reaches
 * the provider twice), else a fresh key (the owner changed the form) that takes `expectedRefunded`.
 */
export function keyFor(kept: Kept | null, fingerprint: string, mint: () => string, expectedRefunded?: number): Kept {
  return kept !== null && kept.fingerprint === fingerprint
    ? kept
    : { key: mint(), fingerprint, ...(expectedRefunded === undefined ? {} : { expectedRefunded }) }
}

/**
 * What to send for the frozen body of a refund: the body with its idempotency key and its `expectedRefunded`.
 *
 * The key goes with the FORM, not with the screen's reading of the ledger: the fingerprint that decides whether the kept
 * key serves is the body without `expectedRefunded`. And a kept key sends the total it was minted with, never the current
 * one: the function hashes the total with the rest of the request, so only the very same request is a replay of the first.
 * A retry after a lost reply, after the code dialog or after «رجوع» and the same form again, made once a refund has been
 * confirmed (the screen read the order again meanwhile), would otherwise be another request under a used key
 * (IDEMPOTENCY_CONFLICT), or, under a fresh key, a second refund. A fresh key (the owner changed the form) takes the
 * current total. `STALE` is a final answer: the key goes (`readCreateReply`) and the screen reads the order again.
 */
export function refundRequest(
  kept: Kept | null,
  body: Readonly<Record<string, unknown>>,
  mint: () => string,
): { kept: Kept; body: Record<string, unknown> } {
  const { expectedRefunded, ...request } = body
  const next = keyFor(kept, JSON.stringify(request), mint, typeof expectedRefunded === 'number' ? expectedRefunded : undefined)
  return {
    kept: next,
    body: { ...request, ...(next.expectedRefunded === undefined ? {} : { expectedRefunded: next.expectedRefunded }), idempotencyKey: next.key },
  }
}

/**
 * The refund form's own inputs as one string (the amounts typed, the reason, the return chosen): whether the owner changed
 * the form. While a key is kept, the same inputs are the same request, and RefundView shows the kept request again rather
 * than rebuilding it from a reading taken since: that reading may have dropped a return the kept request linked, or a line
 * it refunded in full, and a request rebuilt from it would be another refund under a fresh key. An emptied field is a
 * field never typed in, and the order fields were typed in does not count.
 */
export function refundForm(texts: Readonly<Record<string, string>>, reason: string, returnChoice: string): string {
  const typed = Object.entries(texts)
    .filter(([, text]) => text !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([typed, reason, returnChoice])
}

/**
 * The answers after which the very same request may still be asked, so they keep its key: the call never arrived or the
 * function failed on its own (`refund_request` may have stored the request), and the provider could not be reached for the
 * payment's total (PROVIDER_UNAVAILABLE: that call wrote nothing, but an earlier call under this key may have, and the
 * same button sends it again in a moment). Every other answer is final and drops the key: a refusal, a made refund, STALE
 * (the order is read again) and PROVIDER_REFUSED (the payment settings need a fix before anything is asked again).
 */
const KEEP_CODES = new Set(['UNKNOWN', 'FAILED', 'PROVIDER_UNAVAILABLE'])

/**
 * A refusal's code and words. `callFunction` passes through any 2xx body that has an `ok` key, so `{ok: false}` can arrive
 * with no `error` in it, or one that is no `{code}`: null then, and the reader says it could not read the reply.
 */
function refusalOf(result: { ok: false; error?: unknown }): { code: string; message: string } | null {
  const { error } = result
  if (typeof error !== 'object' || error === null) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' ? { code, message: typeof message === 'string' ? message : '' } : null
}

// ---------------------------------------------------------------------------
// The step-up
// ---------------------------------------------------------------------------

/** What the dialog came to: a verified code, the owner closing it, no enrolled factor, or a failure to look. */
export type Verdict = 'verified' | 'cancelled' | 'enroll' | 'failed'
export const CANCELLED = 'CANCELLED'
export const NOT_ENROLLED = 'NOT_ENROLLED'

/**
 * One call and, when the function asks for a fresh code (`STEP_UP_REQUIRED`), the dialog and then the same call
 * once more: `send` builds nothing new, so the body (and a refund's key) is the same. A second
 * `STEP_UP_REQUIRED` is an answer like any other, never another dialog.
 */
export async function withStepUp<T>(send: () => Promise<FunctionResult<T>>, ask: () => Promise<Verdict>): Promise<FunctionResult<T>> {
  const first = await send()
  if (first.ok || refusalOf(first)?.code !== 'STEP_UP_REQUIRED') return first
  const verdict = await ask()
  if (verdict === 'cancelled') return { ok: false, error: { code: CANCELLED, message: '' } }
  if (verdict === 'enroll') return { ok: false, error: { code: NOT_ENROLLED, message: NEEDS_ENROLLMENT } }
  if (verdict === 'failed') return { ok: false, error: { code: 'UNKNOWN', message: 'تعذّر الاتصال بالخادم.' } }
  return send()
}

// ---------------------------------------------------------------------------
// What an answer says
// ---------------------------------------------------------------------------

export interface Reported {
  line: 'status' | 'alert'
  text: string
}
export interface RefundReading extends Reported {
  /** The refund is made or in the provider's hands: the form is spent. */
  done: boolean
  /** The answer leaves the request unknown: a retry must carry the same key. */
  keep: boolean
  /** The provider holds a refund the ledger does not: the owner is offered to record it. */
  ahead: boolean
}

const reading = (line: Reported['line'], text: string, over: Partial<Omit<RefundReading, 'line' | 'text'>> = {}): RefundReading => ({
  line,
  text,
  done: false,
  keep: false,
  ahead: false,
  ...over,
})

/**
 * What `refund-create`, `refund-recheck` and `refund-record-external` answered, as a sentence. A function's
 * own refusal keeps its words; a reply that is not `{refundId, status, amount}` (nor a refusal with a code) is never
 * read as a success or as a failure. `null` when the owner closed the step-up dialog: nothing was sent and there is
 * nothing to say. A reply it cannot read says «حدّث الصفحة»: only `refund-create` has a key to retry under
 * (`readCreateReply`).
 */
export function readRefundReply(result: FunctionResult<unknown>, external = false): RefundReading | null {
  return readRefund(result, external, BAD_REPLY)
}

/** `refund-create`'s answer: `readRefundReply` for a call whose idempotency key is kept when the reply cannot be read, so the same button retries safely. */
export function readCreateReply(result: FunctionResult<unknown>): RefundReading | null {
  return readRefund(result, false, REFUND_KEPT_REPLY)
}

function readRefund(result: FunctionResult<unknown>, external: boolean, unreadable: string): RefundReading | null {
  if (!result.ok) {
    const refusal = refusalOf(result)
    // A «no» with no refusal in it: the refund may exist, so a repeat of the same request must carry the same key.
    if (refusal === null) return reading('alert', unreadable, { keep: true })
    const { code, message } = refusal
    if (code === CANCELLED) return null
    if (code === 'CHARGEBACK_RECORDED') return reading('alert', CHARGEBACK_RECORDED)
    return reading('alert', message || GENERIC, { keep: KEEP_CODES.has(code) || code === NOT_ENROLLED, ahead: code === 'PROVIDER_AHEAD' })
  }
  let refund: ReturnType<typeof parseRefundReply>
  try {
    refund = parseRefundReply(result.data)
  } catch {
    // The refund may exist: a repeat of the same request answers it.
    return reading('alert', unreadable, { keep: true })
  }
  if (refund.status === 'succeeded') {
    return reading('status', external ? `سُجّل استرداد خارجي بمبلغ ${formatMoney(refund.amount)}.` : `تمت إعادة ${formatMoney(refund.amount)}.`, { done: true })
  }
  if (refund.status === 'failed') return reading('alert', REFUND_FAILED)
  // `uncertain`, and `submitting`, which is the same to the owner: the reconciliation settles it.
  return reading('status', REFUND_UNCERTAIN, { done: true })
}

/** `payment-recheck`: «الحالة الآن: …». */
export function readPaymentRecheck(result: FunctionResult<unknown>): Reported {
  if (!result.ok) {
    const refusal = refusalOf(result)
    return { line: 'alert', text: refusal === null ? BAD_REPLY : refusal.message || GENERIC }
  }
  try {
    return { line: 'status', text: `الحالة الآن: ${labelOf(ATTEMPT_STATUS_LABELS, parsePaymentRecheckReply(result.data).status)}.` }
  } catch {
    return { line: 'alert', text: BAD_REPLY }
  }
}

/** `dispute-record`: recorded, a repeat that changed nothing, or a refusal in the function's words. `null` when the dialog was closed. */
export function readDisputeReply(result: FunctionResult<unknown>): (Reported & { done: boolean }) | null {
  if (!result.ok) {
    const refusal = refusalOf(result)
    if (refusal?.code === CANCELLED) return null
    return { line: 'alert', text: refusal === null ? BAD_REPLY : refusal.message || GENERIC, done: false }
  }
  try {
    return { line: 'status', text: parseDisputeReply(result.data).duplicate ? DISPUTE_DUPLICATE : DISPUTE_RECORDED, done: true }
  } catch {
    return { line: 'alert', text: BAD_REPLY, done: false }
  }
}

// ---------------------------------------------------------------------------
// The order's link, sent again
// ---------------------------------------------------------------------------

export const REISSUE_CONFIRM = 'سيُغيّر بريد الطلب ويُبطل الرابط القديم. متابعة؟'
export const REISSUED = 'أُرسل رابط جديد إلى عنوان الطلب.'
export const REISSUED_NEW_EMAIL = 'غُيّر البريد وأُرسل رابط جديد.'
/** This screen's words for `order-link-reissue`'s refusals; any other keeps the function's own. */
const REISSUE_REFUSALS: Readonly<Record<string, string>> = {
  VERSION_MISMATCH: 'تغيّر الطلب؛ أعد التحميل.',
  INVALID_EMAIL: 'تحقق من البريد.',
  BAD_STATUS: 'لا يمكن إرسال رابط لهذا الطلب في حالته.',
}

/** The body of `order-link-reissue`: the order, and a new address only when one is typed (trimmed; the function lower-cases it and checks its shape). */
export function reissueBody(orderId: string, email: string): Record<string, unknown> {
  const address = email.trim()
  return { action: 'order-link-reissue', orderId, ...(address === '' ? {} : { email: address }) }
}

/** What `order-link-reissue` answered: a new link sent to the order's address or to the new one, or a refusal. `null` when the owner closed the code dialog. */
export function readReissueReply(result: FunctionResult<unknown>): Reported | null {
  if (!result.ok) {
    const refusal = refusalOf(result)
    if (refusal === null) return { line: 'alert', text: BAD_REPLY }
    if (refusal.code === CANCELLED) return null
    const own = Object.hasOwn(REISSUE_REFUSALS, refusal.code) ? REISSUE_REFUSALS[refusal.code] : undefined
    return { line: 'alert', text: own ?? (refusal.message || GENERIC) }
  }
  try {
    return { line: 'status', text: parseReissueReply(result.data).emailChanged ? REISSUED_NEW_EMAIL : REISSUED }
  } catch {
    return { line: 'alert', text: BAD_REPLY }
  }
}

// ---------------------------------------------------------------------------
// The dispute form
// ---------------------------------------------------------------------------

export const DISPUTE_DIFFERENCE_KINDS = ['payout_difference', 'fee_difference'] as const
export const DISPUTE_PAYMENT_KINDS = ['chargeback', 'other'] as const
export const DISPUTE_DIRECTIONS = ['against_seller', 'for_seller'] as const
export const DISPUTE_DECISIONS = ['none', 'entitlement_revoked', 'entitlement_kept', 'fulfillment_stopped'] as const

/** A line of the order a decision can name: whether it holds an entitlement, and whether it is still being prepared. */
export interface DisputeLine {
  id: string
  name: string
  entitled: boolean
  preparing: boolean
}

export function disputeLines(detail: Pick<OrderDetail, 'items' | 'entitlements' | 'fulfillments'>): DisputeLine[] {
  return detail.items.map((item) => ({
    id: item.id,
    name: itemName(item),
    entitled: detail.entitlements.some((entitlement) => entitlement.itemId === item.id),
    preparing: detail.fulfillments.some((entry) => entry.itemId === item.id && entry.state === 'preparing'),
  }))
}

/** The two decisions that act on lines. */
export const actsOnLines = (decision: string): boolean => decision === 'entitlement_revoked' || decision === 'fulfillment_stopped'

/** The lines a decision can name: the ones with a file to withdraw, or still being prepared; none for a decision that names none. */
export function linesFor(decision: string, lines: readonly DisputeLine[]): DisputeLine[] {
  if (decision === 'entitlement_revoked') return lines.filter((line) => line.entitled)
  if (decision === 'fulfillment_stopped') return lines.filter((line) => line.preparing)
  return []
}

/** The decisions a form offers: with no payment, or with no lines to name, only those that name none. */
export function decisionsFor(hasTarget: boolean, lines: readonly DisputeLine[] | null): Array<(typeof DISPUTE_DECISIONS)[number]> {
  if (!hasTarget) return ['none']
  return lines === null ? ['none', 'entitlement_kept'] : [...DISPUTE_DECISIONS]
}

/** Riyadh is UTC+3 all year: the calendar day the owner is living in, as `YYYY-MM-DD`. */
export const riyadhToday = (now: number = Date.now()): string => new Date(now + 3 * 3_600_000).toISOString().slice(0, 10)

export interface DisputeInput {
  providerRef: string
  kind: string
  /** Riyals as typed. */
  amount: string
  direction: string
  day: string
  reason: string
  resolution: string
  decision: string
  picked: readonly string[]
}

/** The SQL's integer. */
const INT_MAX = 2_147_483_647

/**
 * The body of `dispute-record` for what was typed, or the first sentence that refuses it. `follows` is the seq
 * of the row this one follows (0 for the first of a reference); `target` is the attempt or review payment, or none.
 */
export function buildDispute(
  input: DisputeInput,
  target: { attemptId?: string; reviewPaymentId?: string },
  follows: number,
  today: string,
  lines: readonly DisputeLine[] | null,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const providerRef = clean(input.providerRef)
  if (providerRef === '' || providerRef.length > 120) return { ok: false, message: DISPUTE_PROBLEMS.reference }
  const amount = parseRiyals(input.amount)
  if (typeof amount !== 'number' || amount < 1 || amount > INT_MAX) return { ok: false, message: DISPUTE_PROBLEMS.amount }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(input.day)) || input.day > today) {
    return { ok: false, message: DISPUTE_PROBLEMS.day }
  }
  const reason = clean(input.reason)
  if (reason === '' || reason.length > 500) return { ok: false, message: DISPUTE_PROBLEMS.reason }
  const resolution = clean(input.resolution)
  if (resolution.length > 500) return { ok: false, message: DISPUTE_PROBLEMS.resolution }
  let itemIds: string[] = []
  if (actsOnLines(input.decision)) {
    const fitting = linesFor(input.decision, lines ?? [])
    if (fitting.length === 0) return { ok: false, message: DISPUTE_PROBLEMS.noLines }
    itemIds = fitting.filter((line) => input.picked.includes(line.id)).map((line) => line.id)
    if (itemIds.length === 0) return { ok: false, message: DISPUTE_PROBLEMS.lines }
  }
  return {
    ok: true,
    body: {
      action: 'dispute-record',
      kind: input.kind,
      providerRef,
      follows,
      ...(target.attemptId === undefined ? {} : { attemptId: target.attemptId }),
      ...(target.reviewPaymentId === undefined ? {} : { reviewPaymentId: target.reviewPaymentId }),
      amount,
      direction: input.direction,
      occurredOn: input.day,
      reason,
      ...(resolution === '' ? {} : { resolution }),
      decision: input.decision,
      ...(itemIds.length === 0 ? {} : { itemIds }),
    },
  }
}
