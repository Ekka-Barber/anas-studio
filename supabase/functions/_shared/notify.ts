import { z } from 'zod'

import { EMAIL_SHAPE, toAsciiAddress } from './contact.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv, secretsMatch } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, logCause, ok as okWith, siteOrigin } from './http.ts'
import { clientKeyHash, requestIp } from './rate-limit.ts'
import { notificationToken, parseNotificationToken } from './tokens.ts'
import { isTurnstileUnavailable, type TurnstileResult, verifyTurnstile } from './turnstile.ts'

/**
 * The visitor's "tell me when it is back" endpoint: the `notify` Edge Function (P08 round 8,
 * PLANS/P08-CONTRACT.md sections 5, 6 and 7). Three actions on one discriminated body:
 *
 * - `subscribe` takes an address for a variant that is out of stock (Turnstile action `notify`). It answers
 *   200 `{sent: true}` for every outcome once the request is well formed and verified: `notify_subscribe`
 *   always answers `{ok: true}` (an unknown or sellable variant, an address that is already confirmed and a mail
 *   cap are the same silence) and nothing here reads more of its answer, so neither the reply nor the work
 *   depends on the address or the variant. Only the caller's own throttle (429) and a failure (500) differ.
 * - `confirm` and `unsubscribe` carry the token of a mailed link, `<subscription id>.<mac>`. The mac is derived
 *   from the pepper and the row's current token version, so nothing about it is stored: `notify_token_info` gives
 *   the version, the mac is recomputed and compared in constant time, and only then does `notify_confirm` or
 *   `notify_unsubscribe` move the row. A confirm link is valid for 7 days after its mail was queued; an
 *   unsubscribe link keeps working until it is used (using it bumps the version, which kills every older link).
 *   Every bad, stale, expired or unknown token gets the one refusal, 404 NOT_FOUND, and the mac is computed
 *   whatever came back, so a miss costs what a hit costs as far as this code can make it.
 *
 * The sign-up works while payments are not configured: nothing here needs `paymentsConfig()`.
 *
 * Order of checks, like `orders`: method → site and pepper → origin → content type → size → JSON → schema →
 * (subscribe) Turnstile → database. SQLSTATE 54000 is a throttle (429) and anything else a detail-free 500.
 * Every reply carries `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. A token, an address, a link
 * or a body is never logged.
 */

const MAX_BODY_BYTES = 65_536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FAILED = 'تعذّر إكمال الإجراء.'
/** A confirmation link is valid this long after its mail was queued (contract section 5). */
const CONFIRM_LINK_MS = 7 * 24 * 60 * 60 * 1000
/** The id a mac is computed for when the token names no subscription, so a miss still does the work of a hit. */
const NO_SUBSCRIPTION = '00000000-0000-4000-8000-000000000000'

// The address is normalized like checkout's and the contact form's, so it is stored the way it is looked up.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((email) => toAsciiAddress(email))
  .refine((email) => email.length <= 254 && EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' })

// A token is judged by its mac, not its shape: a malformed one is the same 404 as any other bad one, never a 422.
const tokenField = z.string().min(1).max(200)

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('subscribe'),
    variantId: z.string().regex(UUID),
    email: emailField,
    // The privacy policy seq the visitor's build showed, or null while none is published.
    consentRevision: z.number().int().min(1).max(2_147_483_647).nullable(),
    turnstileToken: z.string().min(1).max(2048),
  }),
  z.strictObject({ action: z.literal('confirm'), token: tokenField }),
  z.strictObject({ action: z.literal('unsubscribe'), token: tokenField }),
])

export type NotifyDeps = {
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

/** What `notify_token_info` answers for a subscription: null for an unknown id. */
function readInfo(info: unknown): { tokenVersion: number; confirmSentAt: number | null } | 'unreadable' | null {
  if (info === null) return null
  const { tokenVersion, confirmSentAt } = (typeof info === 'object' ? info : {}) as { tokenVersion?: unknown; confirmSentAt?: unknown }
  if (typeof tokenVersion !== 'number' || !Number.isInteger(tokenVersion)) return 'unreadable'
  return { tokenVersion, confirmSentAt: typeof confirmSentAt === 'string' ? Date.parse(confirmSentAt) : null }
}

export async function handleNotify(request: Request, deps: NotifyDeps = {}): Promise<Response> {
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
  // Without the site origin nothing below can be checked, and without the pepper no caller key or mac can be derived.
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

  /** A database call; a throttle is 429 and any other failure a detail-free 500. */
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown | Response> => {
    try {
      return await rpc(fn, args)
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '54000') return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
      logCause('notify', error)
      return fail(500, 'FAILED', FAILED)
    }
  }
  const ipHash = await clientKeyHash(request, pepper)

  if (input.action === 'subscribe') {
    const secret = optionalEnv('TURNSTILE_SECRET_KEY')
    if (!secret) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
    const verdict = await verify({
      token: input.turnstileToken,
      secret,
      remoteIp: requestIp(request),
      expectedAction: 'notify',
      expectedHostname: new URL(siteUrl).hostname,
    })
    if (!verdict.ok) {
      if (isTurnstileUnavailable(verdict.code)) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من الطلب.')
      return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
    }
    const result = await call('notify_subscribe', {
      p_ip_hash: ipHash,
      p_email: input.email,
      p_variant: input.variantId,
      p_consent_revision: input.consentRevision,
    })
    if (result instanceof Response) return result
    // Whatever else it says, the visitor is told the same thing.
    return (result as { ok?: unknown } | null)?.ok === true ? okReply({ sent: true }) : fail(500, 'FAILED', FAILED)
  }

  // `confirm` and `unsubscribe`
  const notFound = (): Response => fail(404, 'NOT_FOUND', 'الرابط غير صالح أو انتهت صلاحيته.')
  const throttled = await call('notify_link_throttle', { p_ip_hash: ipHash })
  if (throttled instanceof Response) return throttled
  const token = parseNotificationToken(input.token)
  const info = token ? await call('notify_token_info', { p_id: token.id }) : null
  if (info instanceof Response) return info
  const row = readInfo(info)
  if (row === 'unreadable') return fail(500, 'FAILED', FAILED)
  // The mac is computed and compared whatever came back (an unknown id, a malformed token), so a miss does the work of a hit.
  const expected = await notificationToken(pepper, token?.id ?? NO_SUBSCRIPTION, row?.tokenVersion ?? 0)
  const genuine = secretsMatch(input.token, expected)
  if (!token || !row || !genuine) return notFound()
  // A confirm link dies 7 days after its mail was queued (a row with no mail has no link); an unsubscribe link never expires.
  if (input.action === 'confirm' && (row.confirmSentAt === null || !(Date.now() - row.confirmSentAt <= CONFIRM_LINK_MS))) return notFound()

  const moved = await call(input.action === 'confirm' ? 'notify_confirm' : 'notify_unsubscribe', {
    p_id: token.id,
    p_token_version: row.tokenVersion,
  })
  if (moved instanceof Response) return moved
  const answer = moved as { ok?: unknown; code?: unknown } | null
  if (answer?.ok === true) return okReply({ status: input.action === 'confirm' ? 'confirmed' : 'unsubscribed' })
  return answer?.ok === false && answer.code === 'NOT_FOUND' ? notFound() : fail(500, 'FAILED', FAILED)
}
