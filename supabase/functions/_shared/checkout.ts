import { z } from 'zod'

import { noControlCharacters } from './commerce-settings.ts'
import { EMAIL_SHAPE, toAsciiAddress } from './contact.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { isHostedSite, optionalEnv, secretsMatch } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, logCause, ok, siteOrigin } from './http.ts'
import { defaultPaymentDeps, type PaymentDeps, settleInvoice, startPayment, type StartResult } from './payments.ts'
import { type MoyasarInvoice, type PaymentsConfig, type PaymentsConfigOk, paymentsConfig } from './payments/moyasar.ts'
import { clientKeyHash, requestIp } from './rate-limit.ts'
import { normalizeSaudiMobile } from './saudi-mobile.ts'
import { orderAccessToken, orderAccessTokenHash, sha256Hex } from './tokens.ts'
import { isTurnstileUnavailable, verifyTurnstile, type TurnstileResult } from './turnstile.ts'

/**
 * The store's public checkout endpoint: the `checkout` Edge Function (P07,
 * P08). Four actions on one discriminated body — `quote` prices the live cart,
 * `create` opens one pending order with its holds behind Turnstile and then
 * makes its invoice, `pay` makes (or returns) the invoice of an order the
 * caller holds the token of, `cancel` lets the buyer release their own hold
 * with the access token `create` returned. The SQL contract is
 * `supabase/migrations/20260927160000_catalog_and_checkout.sql` and
 * `20261002110000_checkout_payment.sql`; the invoice step is `startPayment`
 * (`payments.ts`). Nothing here trusts a browser total: `checkout_create`
 * re-prices under locks and compares `quoteHash`.
 *
 * Nothing is sold unless it can be paid: while the payment settings are not
 * working, or on a hosted site in test mode without the sandbox access code
 * (PLANS/P08-CONTRACT.md section 1, "The sandbox fence"), `quote` says the
 * store is closed and `create` and `pay` answer 503 before the database is
 * touched.
 *
 * Order of checks, like `contact`: origin → content type → size → JSON →
 * schema → (create) payments and fence → (create) Turnstile → database. Cart
 * refusals arrive as data inside a quote (HTTP 200) or as `{ok:false, code}`
 * from `checkout_create`, mapped below to a status and a short Arabic message;
 * SQLSTATE 54000 is the throttle (429) and anything else is a detail-free 500.
 * A body, an email, a name, a phone, an address, a token or the sandbox code is
 * never logged.
 */

const MAX_BODY_BYTES = 65_536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The payment statuses that mean money moved; an invoice that lists one is settled, never cancelled. */
const CHARGED = new Set(['paid', 'refunded', 'captured'])
const listsCharge = (invoice: MoyasarInvoice): boolean => invoice.payments.some((payment) => CHARGED.has(payment.status))
/**
 * `payment_state`'s word for an order the money settled (or went to review for) → the order's own status word, which
 * `checkout_cancel` answers in (`paid_needs_resolution`, not `needs_resolution`). Any other word means nothing settled.
 */
const SETTLED_STATUS: Record<string, string> = { paid: 'paid', needs_resolution: 'paid_needs_resolution', refunded: 'refunded', review: 'review' }

const dedicationField = z.string().max(200).nullable().optional()
// A variant id may arrive in either case; both actions lower-case it before the
// database sees it (the SQL accepts the lower-case form only).
const VARIANT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const lineSchema = z.strictObject({
  variantId: z.string().regex(VARIANT_ID),
  quantity: z.number().int().min(1).max(20),
  dedication: dedicationField,
})
const linesField = z.array(lineSchema).min(1).max(50)
// The sandbox access code (a hosted site in test mode only); compared in constant time, never stored.
const testAccessField = z.string().max(200).optional()

const quoteSchema = z.strictObject({
  action: z.literal('quote'),
  lines: linesField,
  cityKey: z.string().max(80).optional(),
  couponCode: z.string().max(64).optional(),
  testAccess: testAccessField,
})

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((email) => toAsciiAddress(email))
  // Punycode can expand the domain, so the stored length is re-bounded here.
  .refine((email) => email.length <= 254 && EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' })

const createSchema = z.strictObject({
  action: z.literal('create'),
  idempotencyKey: z.string().regex(UUID),
  checkoutSession: z.string().regex(UUID),
  lines: linesField,
  cityKey: z.string().max(80).optional(),
  // The database bounds the folded address at 500 (checkout_create); a longer one is refused here, with the field named.
  address: z.string().max(500).optional(),
  couponCode: z.string().max(64).optional(),
  email: emailField,
  // The database refuses a control character in the name (INVALID_CONTACT); the schema names the field first.
  name: z.string().trim().min(1).max(120).refine(noControlCharacters, 'لا يُقبل اسم فيه رموز تحكم.'),
  phone: z.string().max(64).optional(),
  policyRevisions: z.record(z.string().max(64), z.number().int().min(0).max(2_147_483_647)),
  quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
  turnstileToken: z.string().min(1).max(2048),
  testAccess: testAccessField,
})

// The buyer's order, by its number and the token `create` returned (`pay` and `cancel`).
const orderRef = {
  orderNumber: z.string().trim().toUpperCase().regex(/^[2-9A-HJ-NP-Z]{8}$/),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}

const paySchema = z.strictObject({
  action: z.literal('pay'),
  ...orderRef,
  testAccess: testAccessField,
})

const cancelSchema = z.strictObject({
  action: z.literal('cancel'),
  ...orderRef,
})

const bodySchema = z.discriminatedUnion('action', [quoteSchema, createSchema, paySchema, cancelSchema])

/** A checkout create, normalized: what is hashed, and what the database is called with. */
type NormalizedCreate = {
  checkoutSession: string
  lines: Array<{ variantId: string; quantity: number; dedication: string | null }>
  cityKey: string | null
  address: string | null
  couponCode: string | null
  email: string
  name: string
  phone: string | null
  policyRevisions: Record<string, number>
  quoteHash: string
}

/**
 * Deterministic JSON for the request hash: object keys sorted at every depth,
 * arrays kept in order, `undefined` dropped — so only the values a buyer
 * confirmed, not the browser's key order, decide the hash.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** SQL refusals → HTTP status and a short Arabic message (no internal detail). */
const REFUSALS: Record<string, { status: number; message: string }> = {
  ACTIVE_HOLD: { status: 409, message: 'لديك طلب قيد الانتظار؛ أكمله أو ألغه أولًا.' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: 'تعذّر إتمام الطلب؛ أعد المحاولة من جديد.' },
  OUT_OF_STOCK: { status: 409, message: 'الكمية المطلوبة غير متوفرة الآن.' },
  COUPON_EXHAUSTED: { status: 409, message: 'استُنفدت الكمية المتاحة لهذا الكود.' },
  QUOTE_CHANGED: { status: 409, message: 'تغيّر السعر أو التوفر؛ راجع الملخص المحدث.' },
  POLICY_CHANGED: { status: 409, message: 'تغيّرت السياسات؛ راجعها ثم وافق من جديد.' },
  PAYMENT_ACTIVE: { status: 409, message: 'الدفع قيد المعالجة؛ حاول بعد لحظات.' },
  INVALID_CONTACT: { status: 422, message: 'تحقق من بيانات التواصل.' },
  ADDRESS_REQUIRED: { status: 422, message: 'أدخل عنوان التوصيل.' },
  PHONE_REQUIRED: { status: 422, message: 'أدخل رقم الجوال.' },
  INVALID_CART: { status: 422, message: 'تحقق من محتويات السلة.' },
  EMPTY_CART: { status: 422, message: 'تحقق من محتويات السلة.' },
  TOO_MANY_LINES: { status: 422, message: 'تحقق من محتويات السلة.' },
  INVALID_LINE: { status: 422, message: 'تحقق من محتويات السلة.' },
  INVALID_QUANTITY: { status: 422, message: 'تحقق من محتويات السلة.' },
  DUPLICATE_LINE: { status: 422, message: 'تحقق من محتويات السلة.' },
  CART_TOO_LARGE: { status: 422, message: 'تحقق من محتويات السلة.' },
  UNAVAILABLE: { status: 422, message: 'أحد المنتجات غير متاح حاليًا.' },
  DEDICATION_NOT_ALLOWED: { status: 422, message: 'تحقق من نص الإهداء.' },
  INVALID_DEDICATION: { status: 422, message: 'تحقق من نص الإهداء.' },
  CITY_REQUIRED: { status: 422, message: 'اختر مدينة التوصيل.' },
  CITY_UNSUPPORTED: { status: 422, message: 'لا نوصل إلى هذه المدينة حاليًا.' },
  COUPON_INVALID: { status: 422, message: 'كود الخصم غير صالح.' },
  COUPON_MIN_SUBTOTAL: { status: 422, message: 'قيمة السلة أقل من الحد الأدنى لهذا الكود.' },
  COUPON_NOT_APPLICABLE: { status: 422, message: 'لا ينطبق هذا الكود على منتجات السلة.' },
  TOTAL_BELOW_MINIMUM: { status: 422, message: 'قيمة الطلب أقل من الحد الأدنى للدفع.' },
  CHECKOUT_DISABLED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  SELLER_NOT_CONFIGURED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  POLICIES_NOT_CONFIGURED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  NOT_FOUND: { status: 404, message: 'لم نجد هذا الطلب.' },
}

/** What the SQL functions answer (a subset is read per call). */
type SqlReply = {
  ok?: boolean
  duplicate?: boolean
  tokenMatches?: boolean
  code?: string
  order?: unknown
  quote?: unknown
  policyRevisions?: unknown
  status?: unknown
  checkoutEnabled?: unknown
  /** ACTIVE_HOLD: when the hold ends, and, for the buyer who made it, the order and what its token derives from. */
  holdExpiresAt?: unknown
  idempotencyKey?: unknown
  tokenVersion?: unknown
  /** PAYMENT_ACTIVE: the attempt that is in the way. */
  attempt?: { attemptId?: unknown; status?: unknown; providerInvoiceId?: unknown }
  /** `payment_state`. */
  state?: unknown
} | null

export type CheckoutDeps = {
  /** The database path; the service-role Data API rpc unless a test injects one. */
  rpc?: Rpc
  /** The Turnstile verifier, injectable so unit tests make no network call. */
  verify?: (params: {
    token: string
    secret: string
    remoteIp?: string
    expectedAction: string
    expectedHostname: string
  }) => Promise<TurnstileResult>
  /** What `paymentsConfig()` says; read from the environment unless a test injects it. */
  config?: PaymentsConfig
  /** The invoice step's dependencies (the Moyasar client); null while payments are not configured. Built from the environment unless a test injects them. */
  payments?: PaymentDeps | null
}

/**
 * "The sandbox fence" (contract section 1): Moyasar's test cards are public, so
 * a hosted site in test mode serves only a caller who holds the access code.
 * Everywhere else the fence is open.
 */
function fencePassed(config: PaymentsConfigOk, testAccess: string | undefined): boolean {
  if (config.mode !== 'test' || !isHostedSite()) return true
  return config.testAccessCode !== undefined && testAccess !== undefined && secretsMatch(testAccess, config.testAccessCode)
}

export async function handleCheckout(request: Request, deps: CheckoutDeps = {}): Promise<Response> {
  const rpc = deps.rpc ?? serviceRpc()
  const verify = deps.verify ?? verifyTurnstile

  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  const siteUrl = optionalEnv('SITE_URL')
  const allowed = siteOrigin()
  const cors = allowed ? corsHeaders(allowed) : {}
  const fail = (status: number, code: string, message: string, fields?: unknown): Response =>
    failWith(status, code, message, fields, cors)
  const okReply = (data: unknown, status = 200): Response => ok(data, status, cors)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')
  // Without the site origin nothing below can be checked, and without the
  // pepper no caller key or token can be hashed: the endpoint does not exist.
  if (!siteUrl || !allowed || !pepper) return fail(503, 'UNAVAILABLE', 'تعذّر إكمال الإجراء.')
  if (request.headers.get('origin') !== allowed) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'أرسل الطلب بصيغة JSON.')
  }

  // The bounded read refuses an oversized body, declared or streamed, without buffering it.
  const text = await boundedText(request, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'TOO_LARGE', 'الطلب أطول من المسموح.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  }
  const input = parsed.data
  const config = deps.config ?? paymentsConfig()
  const payments = deps.payments === undefined ? defaultPaymentDeps(rpc) : deps.payments

  // The SQLSTATE answers (throttle 54000, unexpected errors) map the same for
  // every action.
  const call = async (fn: string, args: Record<string, unknown>): Promise<Response | SqlReply> => {
    try {
      return (await rpc(fn, args)) as SqlReply
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '54000') {
        return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
      }
      logCause('checkout', error)
      return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    }
  }
  const refusal = async (result: SqlReply): Promise<Response> => {
    const code = result?.code ?? ''
    const mapped = REFUSALS[code]
    if (!mapped) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    let fields: unknown
    if (code === 'POLICY_CHANGED') {
      fields = { policyRevisions: result?.policyRevisions }
    } else if (code === 'ACTIVE_HOLD') {
      // The hold's end for anyone; the order and its token only when the SQL
      // found the request's email to be the held order's own.
      fields = { holdExpiresAt: result?.holdExpiresAt }
      if (result?.order !== undefined && typeof result.idempotencyKey === 'string' && typeof result.tokenVersion === 'number') {
        fields = {
          holdExpiresAt: result.holdExpiresAt,
          order: result.order,
          accessToken: await orderAccessToken(pepper, result.idempotencyKey, result.tokenVersion),
        }
      }
    } else if (result?.quote !== undefined) {
      fields = { quote: result.quote }
    }
    return fail(mapped.status, code, mapped.message, fields)
  }
  const closed = (): Promise<Response> => refusal({ code: 'CHECKOUT_DISABLED' })

  if (input.action === 'quote') {
    const result = await call('checkout_quote', {
      p_ip_hash: await clientKeyHash(request, pepper),
      p_lines: input.lines.map((line) => ({ ...line, variantId: line.variantId.toLowerCase() })),
      p_city_key: input.cityKey ?? null,
      p_coupon_code: input.couponCode ?? null,
    })
    if (result instanceof Response) return result
    // Cart errors are data inside the quote, never HTTP errors.
    if (!result) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    // The store's switch, the seller and the policies (the SQL) and working payments and the fence (here): nothing is offered that cannot be paid.
    const open = config.ok && fencePassed(config, input.testAccess)
    return okReply({ ...result, checkoutEnabled: result.checkoutEnabled === true && open, testMode: config.ok && config.mode === 'test' })
  }

  if (input.action === 'pay') {
    if (!config.ok || !payments || !fencePassed(config, input.testAccess)) return closed()
    let started: StartResult
    try {
      started = await startPayment(payments, {
        orderNumber: input.orderNumber,
        accessTokenHash: await orderAccessTokenHash(pepper, input.accessToken),
        ipHash: await clientKeyHash(request, pepper),
      })
    } catch (error) {
      logCause('checkout', error)
      return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    }
    if (started.kind === 'not_found') return refusal({ code: 'NOT_FOUND' })
    if (started.kind === 'rate_limited') return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
    return okReply({ order: started.order, payment: started.payment })
  }

  if (input.action === 'cancel') {
    const tokenHash = await orderAccessTokenHash(pepper, input.accessToken)
    const cancelOrder = (): Promise<Response | SqlReply> =>
      call('checkout_cancel', { p_order_number: input.orderNumber, p_access_token_hash: tokenHash })
    const answer = (result: Response | SqlReply): Response | Promise<Response> => {
      if (result instanceof Response) return result
      return result?.ok === true ? okReply({ status: result.status }) : refusal(result)
    }

    const first = await cancelOrder()
    if (first instanceof Response || first?.code !== 'PAYMENT_ACTIVE') return answer(first)
    // An invoice may be payable at the provider, so the database cancelled nothing. Only an attempt that is pending
    // with an invoice can be settled here; one being created or resolved belongs to the payment job, and without
    // working payment settings the provider cannot be asked at all.
    const attemptId = first.attempt?.attemptId
    const invoiceId = first.attempt?.providerInvoiceId
    if (!payments || first.attempt?.status !== 'pending' || typeof attemptId !== 'string' || typeof invoiceId !== 'string') {
      return refusal(first)
    }
    const closeThenCancel = async (status: 'cancelled' | 'expired', error: string | null): Promise<Response> => {
      const done = await call('payment_attempt_close', { p_attempt: attemptId, p_status: status, p_error: error })
      return done instanceof Response ? done : answer(await cancelOrder())
    }

    const cancelled = await payments.client.cancelInvoice(invoiceId)
    // A canceled invoice that lists a charged payment (a 3-D Secure payment that completed around the cancel) is settled
    // below like any other: closing it would tell the buyer "cancelled" and release the holds while the card was charged.
    if (cancelled.ok && cancelled.data.status === 'canceled' && !listsCharge(cancelled.data)) return closeThenCancel('cancelled', 'BUYER_CANCELLED')
    // Any other answer: ask the provider what the invoice is now.
    const invoice = await payments.client.fetchInvoice(invoiceId)
    if (!invoice.ok) return refusal(first)
    if (listsCharge(invoice.data)) {
      // Paid while the buyer was cancelling: settle it, and answer what the order is now.
      try {
        await settleInvoice(payments, attemptId, invoiceId, 'prompt')
      } catch {
        return refusal(first)
      }
      const view = await call('payment_state', {
        p_order_number: input.orderNumber,
        p_access_token_hash: tokenHash,
        p_mode: payments.config.mode,
      })
      if (view instanceof Response) return view
      const state = view?.state
      if (typeof state !== 'string') return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
      // The settle also returns normally when the payment could not be fetched or applied. The order is then still open
      // while the buyer's card was charged, and a 200 would say the cancel went through: only a settled state is answered.
      const status = SETTLED_STATUS[state]
      return status ? okReply({ status }) : refusal(first)
    }
    if (invoice.data.status === 'canceled') return closeThenCancel('cancelled', 'BUYER_CANCELLED')
    if (invoice.data.status === 'expired') return closeThenCancel('expired', null)
    return refusal(first)
  }

  // `create`: the payments and the fence, then normalize, then Turnstile, then the database.
  if (!config.ok || !payments || !fencePassed(config, input.testAccess)) return closed()
  let phone: string | null = null
  const typedPhone = input.phone?.trim() ?? ''
  if (typedPhone !== '') {
    const normalized = normalizeSaudiMobile(typedPhone)
    if (!normalized) {
      return fail(422, 'INVALID', 'بيانات غير صالحة.', { fieldErrors: { phone: ['رقم جوال غير صالح.'] } })
    }
    phone = normalized
  }
  const normalized: NormalizedCreate = {
    checkoutSession: input.checkoutSession,
    lines: input.lines.map((line) => ({
      variantId: line.variantId.toLowerCase(),
      quantity: line.quantity,
      dedication: line.dedication ?? null,
    })),
    cityKey: input.cityKey?.trim() ? input.cityKey.trim() : null,
    address: input.address ? input.address.replace(/\s+/g, ' ').trim() || null : null,
    couponCode: input.couponCode?.trim() ? input.couponCode.trim().toUpperCase() : null,
    email: input.email,
    name: input.name,
    phone,
    policyRevisions: input.policyRevisions,
    quoteHash: input.quoteHash,
  }

  const secret = optionalEnv('TURNSTILE_SECRET_KEY')
  if (!secret) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
  const verdict = await verify({
    token: input.turnstileToken,
    secret,
    remoteIp: requestIp(request),
    expectedAction: 'checkout',
    expectedHostname: new URL(siteUrl).hostname,
  })
  if (!verdict.ok) {
    if (isTurnstileUnavailable(verdict.code)) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
    return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
  }

  const requestHash = await sha256Hex(canonicalJson(normalized))
  const token = await orderAccessToken(pepper, input.idempotencyKey)
  const tokenHash = await orderAccessTokenHash(pepper, token)
  const result = await call('checkout_create', {
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: requestHash,
    p_checkout_session: normalized.checkoutSession,
    p_ip_hash: await clientKeyHash(request, pepper),
    p_email: normalized.email,
    p_name: normalized.name,
    p_phone: normalized.phone,
    p_lines: normalized.lines,
    p_city_key: normalized.cityKey,
    p_address: normalized.address,
    p_coupon_code: normalized.couponCode,
    p_policy_revisions: normalized.policyRevisions,
    p_quote_hash: normalized.quoteHash,
    p_access_token_hash: tokenHash,
    p_environment: config.mode,
  })
  if (result instanceof Response) return result
  if (!result || result.ok !== true) return refusal(result)

  const order = result.order as { orderNumber?: unknown; status?: unknown } | null | undefined
  // A repeated request that no longer waits for its payment (or whose token is not this key's) answers as it always did.
  if (result.duplicate && !(result.tokenMatches === true && order?.status === 'pending_payment')) {
    return okReply({ order: result.order, ...(result.tokenMatches ? { accessToken: token } : {}) })
  }
  // The order exists whatever happens next: a failure of the invoice step is `preparing`, and the page retries with `pay`.
  let started: StartResult | null
  try {
    started = typeof order?.orderNumber === 'string' ? await startPayment(payments, { orderNumber: order.orderNumber, accessTokenHash: tokenHash, ipHash: null }) : null
  } catch {
    started = null
  }
  return okReply(
    {
      order: started?.kind === 'ok' && started.order ? started.order : result.order,
      accessToken: token,
      payment: started?.kind === 'ok' ? started.payment : { state: 'preparing' },
    },
    result.duplicate ? 200 : 201,
  )
}
