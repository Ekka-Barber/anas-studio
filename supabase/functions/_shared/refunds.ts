/**
 * The owner's refund actions of the `admin` function (P08 round 6,
 * PLANS/P08-CONTRACT.md sections 6 and 7): `refund-create`, `refund-recheck`
 * and `refund-record-external`. `handleAdmin` has already checked the role and,
 * for the two that move money, the fresh TOTP; the SQL rechecks the owner again.
 *
 * - The provider documents no refund id: the evidence of a refund is the
 *   payment's own `refunded` total. So the total is fetched FIRST (a failed
 *   fetch answers 503, a payment the key cannot see 404, with nothing
 *   written), `refund_request` reserves the
 *   balance with it, and only a `new` refund goes on to the provider call, which
 *   always carries the amount. No SQL lock is held across that call.
 * - What the provider answers is only a prompt for `refund_result`: a 2xx with
 *   the new total is `succeeded`, a 4xx is `failed` (nothing moved), a timeout,
 *   a 5xx, a 429 or an unreadable reply is `uncertain` (it may have happened:
 *   the reconciliation job settles it from a fresh fetch). A 4xx is never
 *   `uncertain` and a timeout is never `failed`.
 * - A replay (the same idempotency key and the same request) answers the stored
 *   refund and never reaches the provider's refund route again.
 * - The answers carry `{refundId, status, amount}` and, on a refusal, its code.
 *   Nothing here logs, and no provider payload or buyer detail is kept.
 */
import { z } from 'zod'

import { noControlCharacters } from './commerce-settings.ts'
import type { Rpc } from './db.ts'
import { corsHeaders, fail as failWith, ok as okWith } from './http.ts'
import { defaultPaymentDeps, type PaymentDeps } from './payments.ts'
import { isUuid, type MoyasarPayment, type MoyasarResult } from './payments/moyasar.ts'
import { sha256Hex } from './tokens.ts'

/** What the three actions need of `AdminDeps`. */
export interface RefundDeps {
  rpc: Rpc
  /** Only tests set it; otherwise the payment dependencies come from the environment (null while payments are not configured). */
  payments?: PaymentDeps
}

const CORS = corsHeaders('*')
const fail = (status: number, code: string, message: string, fields?: unknown): Response => failWith(status, code, message, fields, CORS)
const ok = (data: unknown): Response => okWith(data, 200, CORS)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The SQL parameters are `integer`: nothing above this reaches them. */
const INT_MAX = 2_147_483_647
const uuid = z.string().regex(UUID)
const halalas = z.number().int().positive().max(INT_MAX)
const reason = z.string().trim().min(1).max(300).refine(noControlCharacters)
/** The provider's own payment id, as a review payment is keyed. */
const paymentId = z.string().refine(isUuid)

const allocationSchema = z.strictObject({
  items: z.array(z.strictObject({ itemId: uuid, amount: halalas })).max(50).optional(),
  shipping: z.number().int().min(0).max(INT_MAX).optional(),
})

const exactlyOneTarget = (value: { attemptId?: string; reviewPaymentId?: string }): boolean =>
  (value.attemptId === undefined) !== (value.reviewPaymentId === undefined)

/** `orderId` may be absent only for a review payment (one with no order at all). */
const refundCreateSchema = z
  .strictObject({
    action: z.literal('refund-create'),
    orderId: uuid.optional(),
    attemptId: uuid.optional(),
    reviewPaymentId: paymentId.optional(),
    amount: halalas,
    reason,
    allocation: allocationSchema,
    idempotencyKey: uuid,
    returnId: uuid.optional(),
  })
  .refine(exactlyOneTarget)
  .refine((value) => value.attemptId === undefined || value.orderId !== undefined)

const refundRecheckSchema = z.strictObject({ action: z.literal('refund-recheck'), refundId: uuid })

const refundRecordExternalSchema = z
  .strictObject({
    action: z.literal('refund-record-external'),
    attemptId: uuid.optional(),
    reviewPaymentId: paymentId.optional(),
    reason,
  })
  .refine(exactlyOneTarget)

type CreateRequest = z.infer<typeof refundCreateSchema>

// ---------------------------------------------------------------------------
// Answers

const FAILED = 'تعذّر إكمال الإجراء.'
const FORBIDDEN = 'هذا الإجراء للمالك فقط.'

/** The SQL's business refusals: a stable code, a short Arabic message. */
const REFUSALS: Record<string, [status: number, message: string]> = {
  NOT_REFUNDABLE: [409, 'لا يمكن استرداد هذه الدفعة.'],
  REFUND_IN_FLIGHT: [409, 'يوجد استرداد قيد المعالجة لهذه الدفعة. انتظر نتيجته أو أعد فحصه.'],
  PROVIDER_AHEAD: [409, 'سُجّل لدى بوابة الدفع استرداد لا يظهر في السجل. سجّله أولًا ثم أعد المحاولة.'],
  PROVIDER_BEHIND: [409, 'المبلغ المسترد لدى بوابة الدفع أقل مما في السجل. راجع الدفعة قبل المتابعة.'],
  EXCEEDS_BALANCE: [409, 'المبلغ أكبر من المتبقي للاسترداد.'],
  INVALID_ALLOCATION: [422, 'توزيع المبلغ على البنود والشحن غير صحيح.'],
  INVALID_RETURN: [422, 'طلب الإرجاع غير صالح لهذا الاسترداد.'],
  IDEMPOTENCY_CONFLICT: [409, 'هذا المفتاح استُخدم لطلب استرداد مختلف.'],
  NO_DELTA: [409, 'لا يوجد فرق بين ما لدى بوابة الدفع وما في السجل.'],
}

const refusal = (code: string): Response => {
  const [status, message] = REFUSALS[code] ?? [409, 'تعذّر تنفيذ الإجراء.']
  return fail(status, code, message)
}

const unavailable = (): Response => fail(503, 'PROVIDER_UNAVAILABLE', 'تعذّر الوصول إلى بوابة الدفع الآن. لم يتغيّر شيء؛ حاول بعد قليل.')

/** A payment fetch that failed: one the configured key cannot see is 404 (asking again changes nothing), anything else 503. */
const fetchFailed = (result: { kind: string }): Response =>
  result.kind === 'not_found' ? fail(404, 'NOT_FOUND', 'لم تُعثر على الدفعة لدى بوابة الدفع.') : unavailable()

/** A database failure: a revoked owner is 403, a malformed call 422, anything else a detail-free 500. */
function sqlFailure(error: unknown): Response {
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return fail(403, 'FORBIDDEN', FORBIDDEN)
  if (code === '22023' || code === '22P02' || code === '23514') return fail(422, 'INVALID', 'بيانات غير صالحة.')
  return fail(500, 'FAILED', FAILED)
}

/** What the SQL answers about a refund: the stored row's few facts. */
type Stored = { refundId: string; status: string; amount: number }
const hasRefund = (value: unknown): value is Stored =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Stored).refundId === 'string' &&
  typeof (value as Stored).status === 'string' &&
  typeof (value as Stored).amount === 'number'
/** Only `{refundId, status, amount}` leaves: the screen needs nothing else. */
const shown = ({ refundId, status, amount }: Stored): Stored => ({ refundId, status, amount })

/** `refund_result` and `refund_settle`: a refund that is no longer in flight is answered as it is stored. */
function settledAnswer(settled: unknown): Response {
  if (hasRefund(settled)) return ok(shown(settled))
  if ((settled as { code?: string } | null)?.code === 'NOT_FOUND') return fail(404, 'NOT_FOUND', 'لم نجد عملية الاسترداد هذه.')
  return fail(500, 'FAILED', FAILED)
}

// ---------------------------------------------------------------------------
// The provider

/** What `payment_attempt_ref` answers. */
type AttemptRef = { ok: false; code: string } | { ok: true; status: string; providerPaymentId: string | null }

/**
 * The provider payment id of the target: a review payment is its own, a paying
 * attempt's comes from `payment_attempt_ref` (as the configured mode's owner),
 * which only a paid attempt has. Anything else answers instead of an id.
 */
async function providerPaymentId(
  payments: PaymentDeps,
  actor: string,
  target: { attemptId?: string; reviewPaymentId?: string },
): Promise<string | Response> {
  if (target.reviewPaymentId !== undefined) return target.reviewPaymentId
  const ref = (await payments.rpc('payment_attempt_ref', {
    p_actor: actor,
    p_attempt: target.attemptId,
    p_mode: payments.config.mode,
  })) as AttemptRef
  if (!ref.ok) return fail(404, 'NOT_FOUND', 'لم نجد محاولة الدفع هذه.')
  return ref.status === 'paid' && ref.providerPaymentId ? ref.providerPaymentId : refusal('NOT_REFUNDABLE')
}

/** The one refund call, as the arguments of `refund_result`. Never throws. */
async function refundAtProvider(
  payments: PaymentDeps,
  paymentId: string,
  amount: number,
): Promise<{ p_outcome: 'succeeded' | 'failed' | 'uncertain'; p_provider_refunded: number | null; p_error: string | null }> {
  let result: MoyasarResult<MoyasarPayment>
  try {
    result = await payments.client.refundPayment(paymentId, amount)
  } catch {
    return { p_outcome: 'uncertain', p_provider_refunded: null, p_error: 'REFUND_ERROR' }
  }
  if (result.ok) return { p_outcome: 'succeeded', p_provider_refunded: result.data.refunded, p_error: null }
  // A 4xx means nothing moved. Anything else (a timeout, a 5xx, a 429, an unreadable reply) may have happened.
  if (result.kind === 'refused' || result.kind === 'not_found') {
    // A refusal keeps the provider's HTTP status in its code (REFUND_REFUSED_400) when the reply carried one.
    const refused = typeof result.status === 'number' ? `REFUND_REFUSED_${result.status}` : 'REFUND_REFUSED'
    return { p_outcome: 'failed', p_provider_refunded: null, p_error: result.kind === 'refused' ? refused : 'REFUND_NOT_FOUND' }
  }
  return { p_outcome: 'uncertain', p_provider_refunded: null, p_error: `REFUND_${result.kind.toUpperCase()}` }
}

/** The SHA-256 of the canonical request, so the same refund asked twice hashes the same whatever the order of its items. */
function requestHash(request: CreateRequest): Promise<string> {
  const items = [...(request.allocation.items ?? [])].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
  return sha256Hex(
    JSON.stringify({
      order: request.orderId ?? null,
      attempt: request.attemptId ?? null,
      review: request.reviewPaymentId ?? null,
      amount: request.amount,
      reason: request.reason,
      allocation: { items: items.map(({ itemId, amount }) => ({ itemId, amount })), shipping: request.allocation.shipping ?? 0 },
      returnId: request.returnId ?? null,
    }),
  )
}

// ---------------------------------------------------------------------------
// The actions

/** What `refund_request` answers. */
type Requested =
  | { ok: false; code: string }
  | { ok: true; state: 'duplicate'; refundId: string; status: string; amount: number }
  | { ok: true; state: 'new'; refundId: string; providerPaymentId: string; amount: number }

/** `refund-create` (owner, fresh TOTP): reserve, one provider call, record what it answered. */
export async function refundCreate(deps: RefundDeps, actor: string, body: unknown): Promise<Response> {
  const parsed = refundCreateSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const request = parsed.data
  const payments = deps.payments ?? defaultPaymentDeps(deps.rpc)
  if (!payments) return fail(503, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')

  let requested: Requested
  try {
    const target = await providerPaymentId(payments, actor, request)
    if (target instanceof Response) return target
    // The provider's total first: a failed fetch writes nothing.
    const fetched = await payments.client.fetchPayment(target)
    if (!fetched.ok) return fetchFailed(fetched)
    const items = request.allocation.items ?? []
    const shipping = request.allocation.shipping ?? 0
    requested = (await payments.rpc('refund_request', {
      p_actor: actor,
      p_order: request.orderId ?? null,
      p_attempt: request.attemptId ?? null,
      p_review_payment: request.reviewPaymentId ?? null,
      p_amount: request.amount,
      p_reason: request.reason,
      // A review payment has no items or shipping: its allocation is `{}`.
      p_allocation: request.reviewPaymentId !== undefined && items.length === 0 && shipping === 0 ? {} : { items, shipping },
      p_idempotency_key: request.idempotencyKey,
      p_request_hash: await requestHash(request),
      p_return: request.returnId ?? null,
      p_provider_refunded: fetched.data.refunded,
    })) as Requested
  } catch (error) {
    return sqlFailure(error)
  }
  if (!requested.ok) return refusal(requested.code)
  // A replay: the stored refund, and the provider is not asked again.
  if (requested.state === 'duplicate') return ok(shown(requested))

  const outcome = await refundAtProvider(payments, requested.providerPaymentId, request.amount)
  try {
    return settledAnswer(await payments.rpc('refund_result', { p_refund: requested.refundId, ...outcome }))
  } catch {
    // The refund row stays in flight and is due in a minute: the reconciliation job settles it from the provider's total.
    return fail(500, 'FAILED', 'تعذّر تسجيل نتيجة الاسترداد؛ ستُراجَع تلقائيًا خلال دقائق.')
  }
}

/** `refund-recheck` (owner): the owner's «أعد الفحص» on one refund, settled from a fresh fetch. */
export async function refundRecheck(deps: RefundDeps, actor: string, body: unknown): Promise<Response> {
  const parsed = refundRecheckSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const payments = deps.payments ?? defaultPaymentDeps(deps.rpc)
  if (!payments) return fail(503, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')
  try {
    const ref = (await payments.rpc('refund_ref', { p_actor: actor, p_refund: parsed.data.refundId })) as
      | { ok: false; code: string }
      | { ok: true; providerPaymentId: string | null }
    if (!ref.ok) return fail(404, 'NOT_FOUND', 'لم نجد عملية الاسترداد هذه.')
    const fetched = await payments.client.fetchPayment(ref.providerPaymentId ?? '')
    if (!fetched.ok) return fetchFailed(fetched)
    return settledAnswer(await payments.rpc('refund_settle', { p_refund: parsed.data.refundId, p_provider_refunded: fetched.data.refunded }))
  } catch (error) {
    return sqlFailure(error)
  }
}

/** `refund-record-external` (owner, fresh TOTP): a refund or a void made at the provider, recorded from its fetched total. */
export async function refundRecordExternal(deps: RefundDeps, actor: string, body: unknown): Promise<Response> {
  const parsed = refundRecordExternalSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const request = parsed.data
  const payments = deps.payments ?? defaultPaymentDeps(deps.rpc)
  if (!payments) return fail(503, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')
  try {
    const target = await providerPaymentId(payments, actor, request)
    if (target instanceof Response) return target
    const fetched = await payments.client.fetchPayment(target)
    if (!fetched.ok) return fetchFailed(fetched)
    const recorded = await payments.rpc('refund_record_external', {
      p_actor: actor,
      p_attempt: request.attemptId ?? null,
      p_review_payment: request.reviewPaymentId ?? null,
      p_provider_refunded: fetched.data.refunded,
      p_provider_status: fetched.data.status,
      p_reason: request.reason,
    })
    if (hasRefund(recorded)) return ok(shown(recorded))
    const code = (recorded as { code?: string } | null)?.code
    return code === undefined ? fail(500, 'FAILED', FAILED) : refusal(code)
  } catch (error) {
    return sqlFailure(error)
  }
}
