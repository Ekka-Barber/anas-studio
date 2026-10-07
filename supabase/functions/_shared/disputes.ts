/**
 * The owner's dispute action of the `admin` function (P08 round 9,
 * PLANS/P08-CONTRACT.md sections 6 and 7): `dispute-record`. `handleAdmin` has
 * already checked the role and the fresh TOTP; the SQL rechecks the owner again.
 *
 * - Moyasar shows no dispute, chargeback or payout difference through its API:
 *   the owner records them by hand from its emails and settlement files. So this
 *   action never calls the provider; it needs the payment settings only for the
 *   configured mode (a row belongs to the test or the live site, never both).
 * - Rows are append-only per reference. `follows` is the seq of the row a row
 *   follows (0 for the first): a repeated reconciliation answers the stored row
 *   (200, `duplicate: true`) and changes nothing; a new row is 201.
 * - A malformed request is refused here before any database call; what the SQL
 *   refuses keeps a stable code and a short Arabic message. A database failure
 *   answers a detail-free 500.
 */
import { z } from 'zod'

import { noControlCharacters } from './commerce-settings.ts'
import type { Rpc } from './db.ts'
import { corsHeaders, fail as failWith, logCause, ok as okWith } from './http.ts'
import type { PaymentDeps } from './payments.ts'
import { isUuid, paymentsConfig } from './payments/moyasar.ts'

/** What the action needs of `AdminDeps`. */
export interface DisputeDeps {
  rpc: Rpc
  /** Only tests set it; otherwise the configuration comes from the environment. */
  payments?: PaymentDeps
}

const CORS = corsHeaders('*')
const fail = (status: number, code: string, message: string, fields?: unknown): Response => failWith(status, code, message, fields, CORS)
const ok = (data: unknown, status: number): Response => okWith(data, status, CORS)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The SQL parameters are `integer`: nothing above this reaches them. */
const INT_MAX = 2_147_483_647
const uuid = z.string().regex(UUID)
/** One line of text, trimmed, within the column's bound. */
const line = (max: number) => z.string().trim().min(1).max(max).refine(noControlCharacters)

/** Riyadh is UTC+3 all year: the calendar day the owner is living in, as `YYYY-MM-DD`. */
const riyadhToday = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)

const KINDS = ['chargeback', 'payout_difference', 'fee_difference', 'other'] as const
const DECISIONS = ['none', 'entitlement_revoked', 'entitlement_kept', 'fulfillment_stopped'] as const

const disputeRecordSchema = z
  .strictObject({
    action: z.literal('dispute-record'),
    kind: z.enum(KINDS),
    providerRef: line(120),
    // A reference has a handful of rows; the bound only keeps `follows + 1` inside the SQL integer.
    follows: z.number().int().min(0).max(1000),
    attemptId: uuid.optional(),
    reviewPaymentId: z.string().refine(isUuid).optional(),
    amount: z.number().int().min(1).max(INT_MAX),
    direction: z.enum(['against_seller', 'for_seller']),
    occurredOn: z.iso.date().refine((day) => day <= riyadhToday()),
    reason: line(500),
    resolution: line(500).optional(),
    decision: z.enum(DECISIONS),
    itemIds: z.array(uuid).max(50).optional(),
  })
  // At most one target; only a payout or a fee difference may name none.
  .refine(
    (value) =>
      (value.attemptId === undefined || value.reviewPaymentId === undefined) &&
      (value.attemptId !== undefined || value.reviewPaymentId !== undefined || value.kind === 'payout_difference' || value.kind === 'fee_difference'),
  )
  // The two decisions that act on items name them (each once); the others name none.
  .refine((value) => {
    const items = value.itemIds ?? []
    return (value.decision === 'entitlement_revoked' || value.decision === 'fulfillment_stopped') === items.length > 0 && new Set(items).size === items.length
  })

const FAILED = 'تعذّر إكمال الإجراء.'

/** The SQL's business refusals: a stable code, a short Arabic message. */
const REFUSALS: Record<string, [status: number, message: string]> = {
  NOT_FOUND: [404, 'لم نجد الدفعة المقصودة.'],
  NOT_DISPUTABLE: [409, 'لا يمكن تسجيل نزاع على محاولة دفع غير مدفوعة.'],
  NO_PREDECESSOR: [409, 'لا يوجد سجل سابق بهذا الرقم لهذا المرجع. راجع رقم التسلسل.'],
  TARGET_MISMATCH: [409, 'السجل اللاحق يخص الدفعة نفسها التي سُجّل عليها أول المرجع.'],
  INVALID_ITEMS: [422, 'البنود المختارة لا تناسب هذا القرار.'],
  REFERENCE_IN_USE: [409, 'هذا المرجع مسجّل في بيئة أخرى.'],
}

/** A database failure: a revoked owner is 403, a malformed call 422, anything else a detail-free 500. */
function sqlFailure(error: unknown): Response {
  const code = (error as { code?: string } | null)?.code
  if (code === '42501') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
  if (code === '22023' || code === '22P02' || code === '23514') return fail(422, 'INVALID', 'بيانات غير صالحة.')
  logCause('disputes', error)
  return fail(500, 'FAILED', FAILED)
}

/** What `dispute_record` answers. */
type Recorded = { ok: false; code: string } | { ok: true; duplicate: boolean; dispute: Record<string, unknown> }

/** `dispute-record` (owner, fresh TOTP): one row of a reference, or the stored row when it is a repeat. */
export async function disputeRecord(deps: DisputeDeps, actor: string, body: unknown): Promise<Response> {
  const parsed = disputeRecordSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const request = parsed.data
  const config = deps.payments?.config ?? paymentsConfig()
  if (!config.ok) return fail(503, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')

  let recorded: Recorded | null
  try {
    recorded = (await deps.rpc('dispute_record', {
      p_actor: actor,
      p_kind: request.kind,
      p_provider_ref: request.providerRef,
      p_follows: request.follows,
      p_attempt: request.attemptId ?? null,
      p_review_payment: request.reviewPaymentId ?? null,
      p_amount: request.amount,
      p_direction: request.direction,
      p_occurred_on: request.occurredOn,
      p_reason: request.reason,
      p_resolution: request.resolution ?? null,
      p_decision: request.decision,
      p_item_ids: request.itemIds ?? [],
      p_environment: config.mode,
    })) as Recorded | null
  } catch (error) {
    return sqlFailure(error)
  }
  if (recorded?.ok === true) return ok({ duplicate: recorded.duplicate, dispute: recorded.dispute }, recorded.duplicate ? 200 : 201)
  if (recorded?.ok === false) {
    const [status, message] = REFUSALS[recorded.code] ?? [409, 'تعذّر تنفيذ الإجراء.']
    return fail(status, recorded.code, message)
  }
  return fail(500, 'FAILED', FAILED)
}
