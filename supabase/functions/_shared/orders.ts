import { z } from 'zod'

import { noControlCharacters } from './commerce-settings.ts'
import { EMAIL_SHAPE, toAsciiAddress } from './contact.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, ok as okWith, siteOrigin } from './http.ts'
import { type PaymentsConfig, paymentsConfig } from './payments/moyasar.ts'
import { clientKeyHash, requestIp } from './rate-limit.ts'
import { orderAccessToken, orderAccessTokenHash } from './tokens.ts'
import { isTurnstileUnavailable, type TurnstileResult, verifyTurnstile } from './turnstile.ts'

/**
 * The buyer's order endpoint: the `orders` Edge Function (P08 round 7, PLANS/P08-CONTRACT.md
 * sections 6 and 7). Three actions on one discriminated body:
 *
 * - `get` shows an order by its number and the access token of its link (`order_access`).
 * - `recover` mails a new link for an address (Turnstile action `order-recover`). It answers 200
 *   `{sent: true}` whatever the address has: it always calls `order_recover_list` and then
 *   `order_recover_apply` (with an empty list on a miss), the SQL throttles in silence, and nothing in
 *   the reply or the work depends on whether an order was found. A link that still works keeps its
 *   token; only an expired one gets the next version's (`recoveryItems`).
 * - `return-request` files the buyer's return request for shipped goods (`return_request_create`).
 *
 * Order of checks, like `checkout`: method → site and pepper → origin → content type → size → JSON →
 * schema → payments configured (the mode every SQL function is bound to) → (recover) Turnstile →
 * database. A SQL refusal is mapped below to a status and a short Arabic message; SQLSTATE 54000 is a
 * throttle (429) and anything else a detail-free 500. Every reply carries `Referrer-Policy:
 * no-referrer` and `Cache-Control: no-store`. A body, an email, a token or an address is never logged.
 */

const MAX_BODY_BYTES = 65_536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FAILED = 'تعذّر إكمال الإجراء.'

// The buyer's order, by its number and the token of its link (the order page keeps the token in sessionStorage).
const orderRef = {
  orderNumber: z.string().trim().toUpperCase().regex(/^[2-9A-HJ-NP-Z]{8}$/),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}

const getSchema = z.strictObject({ action: z.literal('get'), ...orderRef })

// The address is normalized like checkout's, so it hashes to the one the order stored.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((email) => toAsciiAddress(email))
  .refine((email) => email.length <= 254 && EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' })

const recoverSchema = z.strictObject({
  action: z.literal('recover'),
  email: emailField,
  turnstileToken: z.string().min(1).max(2048),
})

// A free-text reason is one line: runs of whitespace (a textarea's line breaks) fold to one space.
const reasonField = z
  .string()
  .max(2000)
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .refine((value) => value.length >= 1 && value.length <= 500 && noControlCharacters(value), { message: 'اكتب سبب الإرجاع في 500 حرف أو أقل.' })

const returnSchema = z.strictObject({
  action: z.literal('return-request'),
  ...orderRef,
  items: z.array(z.strictObject({ itemId: z.string().regex(UUID), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
  reason: reasonField,
})

const bodySchema = z.discriminatedUnion('action', [getSchema, recoverSchema, returnSchema])

/** SQL refusals → HTTP status and a short Arabic message (no internal detail). */
const REFUSALS: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'لم نجد هذا الطلب.' },
  NOT_RETURNABLE: { status: 409, message: 'لا يمكن طلب إرجاع هذه المنتجات الآن.' },
  INVALID_ITEMS: { status: 422, message: 'تحقق من المنتجات والكميات المطلوب إرجاعها.' },
  TOO_MANY_REQUESTS: { status: 429, message: 'أرسلت طلبات إرجاع كثيرة اليوم؛ حاول غدًا.' },
}

/** One order of what `order_recover_list` answers, and one entry of what `order_recover_apply` takes. */
export type RecoverableOrder = { orderId: string; idempotencyKey: string; tokenVersion: number; expired: boolean }
export type RecoverItem = { orderId: string; version: number; tokenHash?: string }

/**
 * Recovery never kills a working link: an order whose stored token has not expired derives nothing new
 * (`{orderId, version}` and no hash); an expired one gets the next version's token, of which only the
 * hash goes to the database.
 */
export function recoveryItems(pepper: string, orders: RecoverableOrder[]): Promise<RecoverItem[]> {
  return Promise.all(
    orders.map(async (order): Promise<RecoverItem> => {
      if (!order.expired) return { orderId: order.orderId, version: order.tokenVersion }
      const version = order.tokenVersion + 1
      return {
        orderId: order.orderId,
        version,
        tokenHash: await orderAccessTokenHash(pepper, await orderAccessToken(pepper, order.idempotencyKey, version)),
      }
    }),
  )
}

/** What the SQL functions answer (a subset is read per call). */
type SqlReply = {
  ok?: boolean
  code?: string
  returnId?: unknown
  order?: unknown
  payment?: unknown
  items?: unknown
  returns?: unknown
} | null

export type OrdersDeps = {
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
}

export async function handleOrders(request: Request, deps: OrdersDeps = {}): Promise<Response> {
  const rpc = deps.rpc ?? serviceRpc()
  const verify = deps.verify ?? verifyTurnstile

  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  const siteUrl = optionalEnv('SITE_URL')
  const allowed = siteOrigin()
  const headers = { ...(allowed ? corsHeaders(allowed) : {}), 'referrer-policy': 'no-referrer' }
  const fail = (status: number, code: string, message: string, fields?: unknown): Response => failWith(status, code, message, fields, headers)
  const okReply = (data: unknown, status = 200): Response => okWith(data, status, headers)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')
  // Without the site origin nothing below can be checked, and without the pepper no caller key or token can be hashed.
  if (!siteUrl || !allowed || !pepper) return fail(503, 'UNAVAILABLE', FAILED)
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
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const input = parsed.data
  // Every SQL function of the order page is bound to the configured mode; without payments there are no orders.
  const config = deps.config ?? paymentsConfig()
  if (!config.ok) return fail(503, 'UNAVAILABLE', FAILED)

  /** A database call; a throttle is 429 and any other failure a detail-free 500. */
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown | Response> => {
    try {
      return await rpc(fn, args)
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '54000') return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
      return fail(500, 'FAILED', FAILED)
    }
  }
  const refusal = (result: SqlReply): Response => {
    const mapped = REFUSALS[result?.code ?? '']
    return mapped ? fail(mapped.status, result!.code!, mapped.message) : fail(500, 'FAILED', FAILED)
  }

  if (input.action === 'recover') {
    const secret = optionalEnv('TURNSTILE_SECRET_KEY')
    if (!secret) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
    const verdict = await verify({
      token: input.turnstileToken,
      secret,
      remoteIp: requestIp(request),
      expectedAction: 'order-recover',
      expectedHostname: new URL(siteUrl).hostname,
    })
    if (!verdict.ok) {
      if (isTurnstileUnavailable(verdict.code)) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
      return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
    }
    const ipHash = await clientKeyHash(request, pepper)
    // Both calls on every request, with an empty list on a miss: the work and the reply are the same whatever the address has.
    const listed = await call('order_recover_list', { p_ip_hash: ipHash, p_email: input.email, p_mode: config.mode })
    if (listed instanceof Response) return listed
    if (!Array.isArray(listed)) return fail(500, 'FAILED', FAILED)
    const applied = await call('order_recover_apply', { p_ip_hash: ipHash, p_items: await recoveryItems(pepper, listed as RecoverableOrder[]) })
    if (applied instanceof Response) return applied
    return okReply({ sent: true })
  }

  const tokenHash = await orderAccessTokenHash(pepper, input.accessToken)
  const ipHash = await clientKeyHash(request, pepper)

  if (input.action === 'get') {
    const result = await call('order_access', {
      p_order_number: input.orderNumber,
      p_access_token_hash: tokenHash,
      p_ip_hash: ipHash,
      p_mode: config.mode,
    })
    if (result instanceof Response) return result
    const view = result as SqlReply
    if (view?.ok !== true) return refusal(view)
    if (view.order === undefined || view.payment === undefined || !Array.isArray(view.items) || !Array.isArray(view.returns)) {
      return fail(500, 'FAILED', FAILED)
    }
    // Only the buyer's view leaves, by name.
    return okReply({ order: view.order, payment: view.payment, items: view.items, returns: view.returns })
  }

  // `return-request`
  const result = await call('return_request_create', {
    p_order_number: input.orderNumber,
    p_access_token_hash: tokenHash,
    p_items: input.items,
    p_reason: input.reason,
    p_ip_hash: ipHash,
    p_mode: config.mode,
  })
  if (result instanceof Response) return result
  const created = result as SqlReply
  if (created?.ok === true && typeof created.returnId === 'string') return okReply({ returnId: created.returnId }, 201)
  return refusal(created)
}
