import { z } from 'zod'

import { EMAIL_SHAPE, toAsciiAddress } from './contact.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { isHostedSite, optionalEnv } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, ok, siteOrigin } from './http.ts'
import { clientKeyHash, requestIp } from './rate-limit.ts'
import { normalizeSaudiMobile } from './saudi-mobile.ts'
import { verifyTurnstile, type TurnstileResult } from './turnstile.ts'

/**
 * The store's public checkout endpoint: the `checkout` Edge Function (P07).
 * Three actions on one discriminated body — `quote` prices the live cart,
 * `create` opens one pending order with its holds behind Turnstile, `cancel`
 * lets the buyer release their own hold with the access token `create`
 * returned. The SQL contract is `supabase/migrations/
 * 20260927160000_catalog_and_checkout.sql`; nothing here trusts a browser
 * total: `checkout_create` re-prices under locks and compares `quoteHash`.
 *
 * Order of checks, like `contact`: origin → content type → size → JSON →
 * schema → (create only) Turnstile → database. Cart refusals arrive as data
 * inside a quote (HTTP 200) or as `{ok:false, code}` from `checkout_create`,
 * mapped below to a status and a short Arabic message; SQLSTATE 54000 is the
 * throttle (429) and anything else is a detail-free 500. A body, an email, a
 * name, a phone, an address or a token is never logged.
 */

const MAX_BODY_BYTES = 65_536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

const quoteSchema = z.strictObject({
  action: z.literal('quote'),
  lines: linesField,
  cityKey: z.string().max(80).optional(),
  couponCode: z.string().max(64).optional(),
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
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(64).optional(),
  policyRevisions: z.record(z.string().max(64), z.number().int().min(0).max(2_147_483_647)),
  quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
  turnstileToken: z.string().min(1).max(2048),
})

const cancelSchema = z.strictObject({
  action: z.literal('cancel'),
  orderNumber: z.string().trim().toUpperCase().regex(/^[2-9A-HJ-NP-Z]{8}$/),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

const bodySchema = z.discriminatedUnion('action', [quoteSchema, createSchema, cancelSchema])

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** base64url(HMAC-SHA256) — 43 characters for a 32-byte signature. */
async function hmacBase64Url(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)))
  let binary = ''
  for (const byte of signature) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The buyer's order-access token: deterministic in the idempotency key, so a
 * retried request mints the same one (D08: private order links use expiring
 * hash-stored tokens). Only its peppered sha256 ever reaches the database.
 */
async function accessToken(pepper: string, idempotencyKey: string): Promise<string> {
  return hmacBase64Url(pepper, `order-access:${idempotencyKey}`)
}

async function accessTokenHash(pepper: string, token: string): Promise<string> {
  return sha256Hex(`${pepper}:order:${token}`)
}

/** SQL refusals → HTTP status and a short Arabic message (no internal detail). */
const REFUSALS: Record<string, { status: number; message: string }> = {
  ACTIVE_HOLD: { status: 409, message: 'لديك طلب قيد الانتظار؛ أكمله أو ألغه أولًا.' },
  IDEMPOTENCY_CONFLICT: { status: 409, message: 'تعذّر إتمام الطلب؛ أعد المحاولة من جديد.' },
  OUT_OF_STOCK: { status: 409, message: 'الكمية المطلوبة غير متوفرة الآن.' },
  COUPON_EXHAUSTED: { status: 409, message: 'استُنفدت الكمية المتاحة لهذا الكود.' },
  QUOTE_CHANGED: { status: 409, message: 'تغيّر السعر أو التوفر؛ راجع الملخص المحدث.' },
  POLICY_CHANGED: { status: 409, message: 'تغيّرت السياسات؛ راجعها ثم وافق من جديد.' },
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
  CHECKOUT_DISABLED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  SELLER_NOT_CONFIGURED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  POLICIES_NOT_CONFIGURED: { status: 503, message: 'الشراء غير متاح حاليًا، ويفتح قريبًا.' },
  NOT_FOUND: { status: 404, message: 'لم نجد هذا الطلب.' },
}

/** What `checkout_create` / `checkout_cancel` answer (a subset is read per call). */
type SqlReply = {
  ok?: boolean
  duplicate?: boolean
  tokenMatches?: boolean
  code?: string
  order?: unknown
  quote?: unknown
  policyRevisions?: unknown
  status?: unknown
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

  // The SQLSTATE answers (throttle 54000, unexpected errors) map the same for
  // every action.
  const call = async (fn: string, args: Record<string, unknown>): Promise<Response | SqlReply> => {
    try {
      return (await rpc(fn, args)) as SqlReply
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '54000') {
        return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
      }
      return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    }
  }
  const refusal = (result: SqlReply): Response => {
    const code = result?.code ?? ''
    const mapped = REFUSALS[code]
    if (!mapped) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    const fields =
      code === 'POLICY_CHANGED'
        ? { policyRevisions: result?.policyRevisions }
        : result?.quote !== undefined
          ? { quote: result.quote }
          : undefined
    return fail(mapped.status, code, mapped.message, fields)
  }

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
    return okReply(result)
  }

  if (input.action === 'cancel') {
    const result = await call('checkout_cancel', {
      p_order_number: input.orderNumber,
      p_access_token_hash: await accessTokenHash(pepper, input.accessToken),
    })
    if (result instanceof Response) return result
    if (!result || result.ok !== true) return refusal(result)
    return okReply({ status: result.status })
  }

  // `create`: normalize, then Turnstile, then the database.
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
    if (verdict.code === 'UNREACHABLE') return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
    return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
  }

  const requestHash = await sha256Hex(canonicalJson(normalized))
  const token = await accessToken(pepper, input.idempotencyKey)
  const tokenHash = await accessTokenHash(pepper, token)
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
    p_environment: optionalEnv('PAYMENTS_MODE') === 'live' && isHostedSite() ? 'live' : 'test',
  })
  if (result instanceof Response) return result
  if (!result || result.ok !== true) return refusal(result)
  if (result.duplicate) {
    return okReply({ order: result.order, ...(result.tokenMatches ? { accessToken: token } : {}) })
  }
  return okReply({ order: result.order, accessToken: token }, 201)
}
