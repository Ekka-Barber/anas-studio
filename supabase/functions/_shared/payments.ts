/**
 * The Edge Function side of the payment core (P08, PLANS/P08-CONTRACT.md
 * section 7): the invoice step `checkout` calls, the `payments` function (the
 * Moyasar webhook, the invoice callback, the return page's verify) and the
 * reconciliation job. Every database decision is a SQL function of
 * `20261002100000_payment_core.sql`; this file only talks to the provider and
 * hands the SQL what it fetched.
 *
 * - Payment is decided only by fetching the payment and its invoice with the
 *   secret key. A webhook, the invoice callback and the buyer's redirect are
 *   prompts; none of them is believed.
 * - Everything takes its dependencies (`PaymentDeps`), so unit tests reach every
 *   branch with a recording rpc and a stub client, and no network.
 * - A failed fetch is never read as "not paid": it is recorded as a failure and
 *   the work is tried again later.
 * - Nothing here logs but one line with the code of a refused webhook
 *   (`payments: webhook refused`). A body, a token, the webhook secret and a
 *   provider id never leave this module except to the SQL functions and the
 *   provider.
 */
import { z } from 'zod'

import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv, secretsMatch } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, NO_STORE, ok as okWith, siteOrigin } from './http.ts'
import {
  isUuid,
  moyasarClient,
  paymentsConfig,
  type MoyasarClient,
  type MoyasarInvoice,
  type MoyasarPayment,
  type MoyasarResult,
  type PaymentsConfig,
  type PaymentsConfigOk,
} from './payments/moyasar.ts'
import { clientKeyHash } from './rate-limit.ts'
import { orderAccessTokenHash, sha256Hex } from './tokens.ts'

const MAX_BODY_BYTES = 65_536
const MAX_WEBHOOK_BYTES = 262_144
/** An uncertain creation younger than this may still land at the provider: it is not abandoned yet. */
const YOUNG_MS = 60_000
/** Pages of the invoice list read for one uncertain attempt; past it, absence is not proven. */
const LIST_PAGES = 5
/**
 * How long one reconciliation run keeps taking rows. Each provider call can
 * take 10 seconds, so a hung provider would otherwise outlive the function and
 * the run would never be recorded; the rows left keep their lease.
 */
const RUN_BUDGET_MS = 60_000
/** The payment statuses that hold money: a canceled invoice that lists one is settled, never closed. */
const CHARGED = new Set(['paid', 'refunded', 'captured'])
/**
 * The payment statuses an invoice's own list sends to `apply_verified_payment`; every one is fetched first. A voided
 * one holds no money (it settles nothing), but the void of a paying payment must reach the SQL's `provider_status` alert.
 */
const APPLIED = new Set([...CHARGED, 'voided'])
/** The apply outcomes after which the attempt is paid or in review, so no "checked" is recorded. */
const SETTLED = new Set(['paid', 'already_paid', 'paid_needs_resolution', 'review'])
const ZERO_HASH = '0'.repeat(64)
const FAILED = 'تعذّر إكمال الإجراء.'
const NOT_ALLOWED = 'طلب غير مسموح.'

export type PaymentDeps = { rpc: Rpc; client: MoyasarClient; config: PaymentsConfigOk }

/** The dependencies from the environment, or null while payments are not configured (`paymentsConfig()` says why). */
export function defaultPaymentDeps(rpc: Rpc = serviceRpc()): PaymentDeps | null {
  const config = paymentsConfig()
  return config.ok ? { rpc, client: moyasarClient(config), config } : null
}

/**
 * The mode the buyer's pages bind their SQL functions to (`orders`, `download`). They never call the provider, so a
 * broken Moyasar key, base or webhook secret must not take the order page, its files, returns and recovery down with
 * checkout: the working configuration's mode, else `PAYMENTS_MODE` alone when it names one; null while no mode is set.
 */
export function buyerMode(config: PaymentsConfig): 'test' | 'live' | null {
  if (config.ok) return config.mode
  const mode = optionalEnv('PAYMENTS_MODE')
  return mode === 'test' || mode === 'live' ? mode : null
}

const failureCode = (what: 'PAYMENT' | 'INVOICE', result: { kind: string }): string => `${what}_FETCH_${result.kind.toUpperCase()}`

const closeEvent = (deps: PaymentDeps, eventId: string, outcome: string, error: string | null = null): Promise<unknown> =>
  deps.rpc('payment_event_result', { p_event_id: eventId, p_outcome: outcome, p_error: error })

const checkAttempt = (
  deps: PaymentDeps,
  attemptId: string,
  source: 'job' | 'prompt',
  good: boolean,
  providerStatus: string | null,
  error: string | null,
): Promise<unknown> =>
  deps.rpc('payment_attempt_checked', {
    p_attempt: attemptId,
    p_source: source,
    p_ok: good,
    p_provider_status: providerStatus,
    p_error: error,
  })

const closeAttempt = (deps: PaymentDeps, attemptId: string, status: string, error: string | null): Promise<unknown> =>
  deps.rpc('payment_attempt_close', { p_attempt: attemptId, p_status: status, p_error: error })

/** Best effort: an invoice nobody can reach is only a loose end, never a reason to fail. */
async function cancelQuietly(deps: PaymentDeps, invoiceId: string): Promise<void> {
  try {
    await deps.client.cancelInvoice(invoiceId)
  } catch {
    // Nothing to do: the ledger does not map this invoice to a payable attempt.
  }
}

// ---------------------------------------------------------------------------
// The invoice step

export type PaymentView =
  | { state: 'ready'; url: string }
  | { state: 'preparing' }
  | { state: 'unavailable' }
  | { state: 'closed'; code: string; status?: string; reason?: string }

export type StartResult =
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'ok'; order: unknown; payment: PaymentView }

/** What `payment_attempt_begin` answers (the contract, section 6). */
type Begin =
  | { ok: false; code: string; status?: string; reason?: string; order?: unknown }
  | { ok: true; state: 'pending'; attemptId: string; invoiceUrl: string; order: unknown }
  | { ok: true; state: 'creating'; attemptId: string; order: unknown }
  | { ok: true; state: 'uncertain'; attemptId: string; createdAt: string; amount: number; currency: string; order: unknown }
  | { ok: true; state: 'new'; attemptId: string; amount: number; currency: string; expiresAt: string; order: unknown }

/** The facts the uncertain resolution needs: the begin reply, the claim and `payment_attempt_ref` all carry them. */
export type UncertainAttempt = { attemptId: string; createdAt: string; amount: number; currency: string }

export type Resolution =
  | { kind: 'adopted'; url: string }
  | { kind: 'abandoned' }
  | { kind: 'young' }
  | { kind: 'duplicates' }
  /** The ledger refused the invoice (its attempt was closed, or the id is mapped elsewhere). */
  | { kind: 'closed' }
  | { kind: 'unavailable' }

/** Maps the provider's answer to the ledger: the attempt becomes `pending`, or the invoice is cancelled and never shown. */
async function adopt(deps: PaymentDeps, attemptId: string, invoice: MoyasarInvoice): Promise<boolean> {
  const expires = invoice.expiredAt === null ? Number.NaN : Date.parse(invoice.expiredAt)
  const reply = (await deps.rpc('payment_attempt_created', {
    p_attempt: attemptId,
    p_invoice_id: invoice.id,
    p_invoice_url: invoice.url,
    p_expires_at: Number.isNaN(expires) ? null : new Date(expires).toISOString(),
  })) as { ok?: boolean } | null
  if (reply?.ok === true) return true
  // ATTEMPT_CLOSED or INVOICE_CONFLICT: a late 201 never hands the buyer a URL the ledger does not map.
  await cancelQuietly(deps, invoice.id)
  return false
}

/**
 * An uncertain creation, resolved by listing the invoices that carry this
 * attempt's id and checking each one's OWN metadata, amount and currency (the
 * provider's filter is not trusted). Exactly one match is adopted; none, once
 * the attempt is old enough, is proof that the call never landed. It never
 * begins an attempt: the job and the owner's recheck have no buyer to answer.
 */
export async function resolveUncertain(deps: PaymentDeps, attempt: UncertainAttempt): Promise<Resolution> {
  const matches: MoyasarInvoice[] = []
  let page: number | null = 1
  for (let read = 0; page !== null; read += 1) {
    if (read === LIST_PAGES) return { kind: 'unavailable' }
    const listed = await deps.client.listInvoices({ metadata: { attempt_id: attempt.attemptId }, page })
    if (!listed.ok) return { kind: 'unavailable' }
    for (const invoice of listed.data.invoices) {
      if (invoice.metadata.attempt_id === attempt.attemptId && invoice.amount === attempt.amount && invoice.currency === attempt.currency) {
        matches.push(invoice)
      }
    }
    page = listed.data.nextPage
  }
  if (matches.length > 1) {
    await deps.rpc('payment_attempt_duplicates', { p_attempt: attempt.attemptId })
    return { kind: 'duplicates' }
  }
  const [match] = matches
  if (match) return (await adopt(deps, attempt.attemptId, match)) ? { kind: 'adopted', url: match.url } : { kind: 'closed' }
  // No match: the first call may still land while the attempt is young (an unreadable date counts as young).
  if (!(Date.now() - Date.parse(attempt.createdAt) >= YOUNG_MS)) return { kind: 'young' }
  await closeAttempt(deps, attempt.attemptId, 'abandoned', 'CREATE_ABSENT')
  return { kind: 'abandoned' }
}

/** The provider call of a new attempt. No SQL lock is held across it, and it is never repeated blindly. */
async function createInvoice(
  deps: PaymentDeps,
  orderNumber: string,
  site: string,
  begun: Extract<Begin, { state: 'new' }>,
): Promise<PaymentView> {
  const returnUrl = `${site}/checkout/return?order=${orderNumber}`
  const created = await deps.client.createInvoice({
    amount: begun.amount,
    currency: begun.currency,
    description: `طلب ${orderNumber}`,
    callback_url: `${deps.config.callbackBase}/payments/callback`,
    success_url: returnUrl,
    back_url: returnUrl,
    expired_at: new Date(begun.expiresAt).toISOString(),
    // The order number and the attempt id only: nothing about the buyer.
    metadata: { order_number: orderNumber, attempt_id: begun.attemptId },
  })
  if (created.ok) {
    return (await adopt(deps, begun.attemptId, created.data)) ? { state: 'ready', url: created.data.url } : { state: 'preparing' }
  }
  // A 4xx or a 429 means nothing was created; anything else (a timeout, a 5xx, an unreadable 2xx) may have been.
  if (created.kind === 'refused' || created.kind === 'not_found' || created.kind === 'rate_limited') {
    // A refusal keeps the provider's HTTP status in its code (CREATE_REFUSED_401), which the owners' alert carries.
    const refused = typeof created.status === 'number' ? `CREATE_REFUSED_${created.status}` : 'CREATE_REFUSED'
    await closeAttempt(deps, begun.attemptId, 'failed', created.kind === 'rate_limited' ? 'CREATE_RATE_LIMITED' : refused)
    return { state: 'unavailable' }
  }
  await closeAttempt(deps, begun.attemptId, 'uncertain', 'CREATE_UNCERTAIN')
  return { state: 'preparing' }
}

/**
 * The invoice step of `create` and `pay` (contract section 7). `ipHash` is null
 * from `create` and the caller's hash from `pay`; a SQL throttle (54000) is
 * `rate_limited`, any other database failure is thrown for the caller to map.
 */
export async function startPayment(
  deps: PaymentDeps,
  input: { orderNumber: string; accessTokenHash: string; ipHash: string | null },
): Promise<StartResult> {
  const site = siteOrigin()
  if (!site) throw new Error('SITE_URL_MISSING')
  const orderNumber = input.orderNumber.toUpperCase()
  const begin = async (): Promise<Begin | 'limited'> => {
    try {
      return (await deps.rpc('payment_attempt_begin', {
        p_order_number: orderNumber,
        p_access_token_hash: input.accessTokenHash,
        p_mode: deps.config.mode,
        p_ip_hash: input.ipHash,
      })) as Begin
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '54000') return 'limited'
      throw error
    }
  }
  const answer = (order: unknown, payment: PaymentView): StartResult => ({ kind: 'ok', order, payment })

  let begun = await begin()
  if (begun === 'limited') return { kind: 'rate_limited' }
  if (begun.ok && begun.state === 'uncertain') {
    const resolved = await resolveUncertain(deps, begun)
    if (resolved.kind !== 'abandoned') {
      return answer(begun.order, resolved.kind === 'adopted' ? { state: 'ready', url: resolved.url } : { state: 'preparing' })
    }
    // The creation never landed: begin again, once. Whatever that finds is the answer.
    begun = await begin()
    if (begun === 'limited') return { kind: 'rate_limited' }
  }
  if (!begun.ok) {
    if (begun.code === 'NOT_FOUND') return { kind: 'not_found' }
    return answer(begun.order, {
      state: 'closed',
      code: begun.code,
      ...(begun.status ? { status: begun.status } : {}),
      ...(begun.reason ? { reason: begun.reason } : {}),
    })
  }
  if (begun.state === 'pending') return answer(begun.order, { state: 'ready', url: begun.invoiceUrl })
  if (begun.state === 'new') return answer(begun.order, await createInvoice(deps, orderNumber, site, begun))
  // Another request is creating it (`creating`), or it is uncertain again after the one retry.
  return answer(begun.order, { state: 'preparing' })
}

// ---------------------------------------------------------------------------
// Settling what the provider holds

type Applied = { outcome: string }

/** The one call that decides: the fetched payment and its invoice, normalized, to `apply_verified_payment`. */
async function applyPayment(
  deps: PaymentDeps,
  invoiceId: string,
  payment: MoyasarPayment,
  invoice: MoyasarInvoice,
  live: boolean | null,
  eventId: string | null,
): Promise<Applied> {
  const reply = (await deps.rpc('apply_verified_payment', {
    p_invoice_id: invoiceId,
    p_payment: {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      fee: payment.fee,
      refunded: payment.refunded,
      invoiceId: payment.invoiceId,
      sourceType: payment.sourceType,
      sourceCompany: payment.sourceCompany,
    },
    p_invoice: { id: invoice.id, status: invoice.status, amount: invoice.amount, currency: invoice.currency },
    p_mode: deps.config.mode,
    p_live: live,
    p_event_id: eventId,
  })) as Applied | null
  if (typeof reply?.outcome !== 'string') throw new Error('UNEXPECTED_REPLY')
  return reply
}

/**
 * A webhook event's payment: fetch it and its invoice, apply, and close the
 * event with what happened. Returns the outcome it recorded. A payment our key
 * cannot see (404) is `unknown_payment`; any other failure is `retry`, which
 * the job repeats with a growing delay and, after ten tries, alerts.
 */
export async function settlePayment(deps: PaymentDeps, paymentId: string, live: boolean | null, eventId: string): Promise<string> {
  const finish = async (outcome: string, error: string | null = null): Promise<string> => {
    await closeEvent(deps, eventId, outcome, error)
    return outcome
  }
  const payment = await deps.client.fetchPayment(paymentId)
  if (!payment.ok) return payment.kind === 'not_found' ? finish('unknown_payment') : finish('retry', failureCode('PAYMENT', payment))
  const invoiceId = payment.data.invoiceId
  if (invoiceId === null) return finish('no_invoice')
  const invoice = await deps.client.fetchInvoice(invoiceId)
  if (!invoice.ok) return finish('retry', failureCode('INVOICE', invoice))
  let applied: Applied
  try {
    applied = await applyPayment(deps, invoiceId, payment.data, invoice.data, live, eventId)
  } catch {
    return finish('retry', 'APPLY_FAILED')
  }
  return finish(applied.outcome)
}

export type SettleReport = {
  /** The apply outcome of every charged payment the invoice lists, in the listed order. */
  outcomes: string[]
  /** The code of the first fetch or apply that failed, else null. */
  error: string | null
}

/**
 * An attempt's invoice: fetch it, apply every charged or voided payment it lists
 * (each fetched on its own), and, unless one of them settled the attempt, record the
 * check. A failed fetch is a failed check, never "not paid". `source` is `job`
 * (the reconciliation, which backs off) or `prompt` (a callback, a verify or
 * the owner's recheck, which only note the time).
 *
 * The charged payments are applied oldest first (by the time each fetched
 * payment carries; one without a time goes last, in the listed order), so the
 * payment that pays the order is the same whichever path settles it.
 *
 * An invoice the provider calls paid that nothing here could settle (it lists
 * no payment, or every apply was refused) is a FAILED check, never a good one:
 * the job keeps trying, and 24 hours after the expiry the owner is alerted
 * (`UNVERIFIED`). Money the provider holds is never filed as "expired".
 */
export async function settleInvoice(deps: PaymentDeps, attemptId: string, invoiceId: string, source: 'job' | 'prompt'): Promise<SettleReport> {
  const invoice = await deps.client.fetchInvoice(invoiceId)
  if (!invoice.ok) {
    const error = failureCode('INVOICE', invoice)
    await checkAttempt(deps, attemptId, source, false, null, error)
    return { outcomes: [], error }
  }
  let error: string | null = null
  const charged: MoyasarPayment[] = []
  for (const listed of invoice.data.payments) {
    if (!APPLIED.has(listed.status)) continue
    const payment = await deps.client.fetchPayment(listed.id)
    if (payment.ok) charged.push(payment.data)
    else error ??= failureCode('PAYMENT', payment)
  }
  const time = (payment: MoyasarPayment): number => {
    const at = payment.createdAt === null ? Number.NaN : Date.parse(payment.createdAt)
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
  }
  // A stable sort: equal or missing times keep the listed order.
  charged.sort((a, b) => (time(a) === time(b) ? 0 : time(a) - time(b)))
  const outcomes: string[] = []
  for (const payment of charged) {
    try {
      outcomes.push((await applyPayment(deps, invoiceId, payment, invoice.data, null, null)).outcome)
    } catch {
      error ??= 'APPLY_FAILED'
    }
  }
  // Also after a `rejected` or `not_paid` answer, so no attempt is leased for ever.
  if (!outcomes.some((outcome) => SETTLED.has(outcome))) {
    if (error === null && (invoice.data.status === 'paid' || invoice.data.status === 'refunded')) error = 'INVOICE_PAID_UNSETTLED'
    await checkAttempt(deps, attemptId, source, error === null, error === null ? invoice.data.status : null, error)
  }
  return { outcomes, error }
}

// ---------------------------------------------------------------------------
// The `payments` function

const webhookSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string(),
  secret_token: z.string(),
  live: z.boolean(),
  data: z.unknown().optional(),
})

const verifySchema = z.strictObject({
  action: z.literal('verify'),
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[2-9A-HJ-NP-Z]{8}$/),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
})

const accepted = (): Response => Response.json({ ok: true }, { headers: NO_STORE })

/** Routed by the end of the path: `/webhook`, `/callback`, else the return page's JSON `verify`. */
export async function handlePayments(request: Request, deps?: PaymentDeps): Promise<Response> {
  const payments = deps ?? defaultPaymentDeps()
  const { pathname } = new URL(request.url)
  if (pathname.endsWith('/webhook')) return webhook(request, payments)
  if (pathname.endsWith('/callback')) return callback(request, payments)
  return verify(request, payments)
}

/** Moyasar's webhook: authenticated by the `secret_token` in its body (there is no signature), recorded before it is answered. */
async function webhook(request: Request, deps: PaymentDeps | null): Promise<Response> {
  // Unconfigured means the endpoint does not exist.
  if (!deps) return new Response(null, { status: 404 })
  // A refusal leaves one log line with its code, and nothing else: never the body, the token or any value.
  const refuse = (status: number, code: string, message: string): Response => {
    console.warn('payments: webhook refused', code)
    return failWith(status, code, message)
  }
  if (request.method !== 'POST') return refuse(405, 'METHOD_NOT_ALLOWED', NOT_ALLOWED)
  const text = await boundedText(request, MAX_WEBHOOK_BYTES)
  if (text === null) return refuse(413, 'TOO_LARGE', 'الطلب أطول من المسموح.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return refuse(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = webhookSchema.safeParse(body)
  if (!parsed.success) return refuse(422, 'INVALID', 'بيانات غير صالحة.')
  const event = parsed.data
  // Nothing is stored for a caller that does not hold the secret.
  if (!secretsMatch(event.secret_token, deps.config.webhookSecret)) return refuse(401, 'UNAUTHORIZED', 'تعذّر التحقق من الطلب.')

  const data = event.data
  const paymentId = typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string' ? data.id : null
  let recorded: unknown
  try {
    recorded = await deps.rpc('payment_event_record', {
      p_event_id: event.id,
      p_type: event.type,
      p_live: event.live,
      p_payment_id: paymentId,
      // The body holds the secret and card details: only its hash is kept.
      p_payload_hash: await sha256Hex(text),
    })
  } catch {
    // Not durable: a 500 makes Moyasar send it again.
    return failWith(500, 'FAILED', FAILED)
  }
  const state = (recorded as { state?: unknown } | null)?.state
  // The job owns an event that was recorded but not finished.
  if (state === 'duplicate') return accepted()
  if (state !== 'recorded') return failWith(500, 'FAILED', FAILED)

  try {
    if (!event.type.startsWith('payment_')) await closeEvent(deps, event.id, 'ignored')
    else if (!isUuid(paymentId)) await closeEvent(deps, event.id, 'no_payment_id')
    else if (event.live !== (deps.config.mode === 'live')) await closeEvent(deps, event.id, 'mode_mismatch')
    else await settlePayment(deps, paymentId.toLowerCase(), event.live, event.id)
  } catch {
    // The event is durable: the reconciliation job finishes it. Moyasar still gets its 200.
  }
  return accepted()
}

/**
 * The invoice callback: unauthenticated, so it is only a prompt. Reads the
 * invoice's `id` and nothing else. A POST is always answered 200; like the
 * webhook, the endpoint does not exist (404) while payments are not configured.
 */
async function callback(request: Request, deps: PaymentDeps | null): Promise<Response> {
  if (!deps) return new Response(null, { status: 404 })
  if (request.method !== 'POST') return failWith(405, 'METHOD_NOT_ALLOWED', NOT_ALLOWED)
  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  try {
    const text = await boundedText(request, MAX_BODY_BYTES)
    const id = text === null ? null : (JSON.parse(text) as { id?: unknown } | null)?.id
    if (isUuid(id) && pepper) {
      const begun = (await deps.rpc('payment_callback_begin', {
        // As the provider wrote it: the ledger stores the invoice id the same way.
        p_invoice_id: id,
        p_ip_hash: await clientKeyHash(request, pepper),
        p_mode: deps.config.mode,
      })) as { check?: { attemptId: string; providerInvoiceId: string } } | null
      if (begun?.check) await settleInvoice(deps, begun.check.attemptId, begun.check.providerInvoiceId, 'prompt')
    }
  } catch {
    // A prompt only: the job reconciles whatever this could not.
  }
  return accepted()
}

/** What `payment_check_begin` and `payment_state` answer for the return page. */
type View = { state: string; hasToken: boolean; invoiceUrl?: string; check?: { attemptId: string; providerInvoiceId: string } }

/** The return page's check, from the site only: settles what the provider holds, then answers the order's state. */
async function verify(request: Request, deps: PaymentDeps | null): Promise<Response> {
  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  const allowed = siteOrigin()
  const cors = allowed ? corsHeaders(allowed) : {}
  const fail = (status: number, code: string, message: string): Response => failWith(status, code, message, undefined, cors)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', NOT_ALLOWED)
  if (!deps || !allowed || !pepper) return fail(503, 'UNAVAILABLE', FAILED)
  if (request.headers.get('origin') !== allowed) return fail(403, 'FORBIDDEN', NOT_ALLOWED)
  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'أرسل الطلب بصيغة JSON.')
  }
  const text = await boundedText(request, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'TOO_LARGE', 'الطلب أطول من المسموح.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) return failWith(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten(), cors)
  const { orderNumber, accessToken } = parsed.data

  const tokenHash = accessToken ? await orderAccessTokenHash(pepper, accessToken) : ZERO_HASH
  let view: View
  try {
    view = (await deps.rpc('payment_check_begin', {
      p_order_number: orderNumber,
      p_access_token_hash: tokenHash,
      p_ip_hash: await clientKeyHash(request, pepper),
      p_mode: deps.config.mode,
    })) as View
    if (view.check) {
      try {
        await settleInvoice(deps, view.check.attemptId, view.check.providerInvoiceId, 'prompt')
      } catch {
        // A prompt: the state read below tells the truth whatever this managed.
      }
      view = (await deps.rpc('payment_state', {
        p_order_number: orderNumber,
        p_access_token_hash: tokenHash,
        p_mode: deps.config.mode,
      })) as View
    }
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '54000') return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
    return fail(500, 'FAILED', FAILED)
  }
  return okWith(
    { state: view.state, hasToken: view.hasToken, ...(view.invoiceUrl ? { invoiceUrl: view.invoiceUrl } : {}), testMode: deps.config.mode === 'test' },
    200,
    cors,
  )
}

// ---------------------------------------------------------------------------
// The reconciliation job

export interface PaymentsReconcileSummary {
  job: 'payments_reconcile'
  status: 'ok' | 'partial' | 'failed' | 'skipped'
  attempts: number
  events: number
  /** In-flight refunds the run leased (absent from the summary of a skipped run, which leased nothing). */
  refunds?: number
  /** Rows whose payment ended `paid` or `paid_needs_resolution`. */
  settled: number
  /** Pending attempts of an already paid order whose invoice was cancelled. */
  cancelled: number
  /** Rows that could not be finished (a failed fetch, or an exception) and will be tried again. */
  errors: number
  /** Rows left for the next run after the provider answered 429 or the run's time was spent. */
  skipped: number
  reason?: string
}

type ClaimedAttempt = UncertainAttempt & { status: string; providerInvoiceId: string | null; orderPaid: boolean }
type ClaimedEvent = { eventId: string; paymentId: string | null; live: boolean | null }
type ClaimedRefund = { refundId: string; providerPaymentId: string | null }

/** After the first 429 every further call answers rate_limited at once, so the rest of the run never touches the provider. */
function stopAfterLimit(client: MoyasarClient, state: { limited: boolean }): MoyasarClient {
  const guard =
    <A extends unknown[], T>(call: (...args: A) => Promise<MoyasarResult<T>>) =>
    async (...args: A): Promise<MoyasarResult<T>> => {
      if (state.limited) return { ok: false, kind: 'rate_limited' }
      const result = await call(...args)
      if (!result.ok && result.kind === 'rate_limited') state.limited = true
      return result
    }
  return {
    ...client,
    fetchInvoice: guard((id: string) => client.fetchInvoice(id)),
    fetchPayment: guard((id: string) => client.fetchPayment(id)),
    listInvoices: guard((input: Parameters<MoyasarClient['listInvoices']>[0]) => client.listInvoices(input)),
    cancelInvoice: guard((id: string) => client.cancelInvoice(id)),
  }
}

type RowResult = 'settled' | 'cancelled' | 'retry' | 'done'

async function reconcileAttempt(deps: PaymentDeps, attempt: ClaimedAttempt): Promise<RowResult> {
  if (attempt.status === 'uncertain') {
    const resolved = await resolveUncertain(deps, attempt)
    if (resolved.kind === 'unavailable') {
      await checkAttempt(deps, attempt.attemptId, 'job', false, null, 'INVOICE_LIST_FAILED')
      return 'retry'
    }
    // Several invoices, or a ledger refusal: a person looks (the owner was alerted); the check backs off.
    if (resolved.kind === 'duplicates' || resolved.kind === 'closed') await checkAttempt(deps, attempt.attemptId, 'job', true, null, null)
    return 'done'
  }
  if (!attempt.providerInvoiceId) {
    await checkAttempt(deps, attempt.attemptId, 'job', true, null, null)
    return 'done'
  }
  // Another attempt of the order was paid: this invoice must not stay payable.
  if (attempt.status === 'pending' && attempt.orderPaid) {
    const cancelled = await deps.client.cancelInvoice(attempt.providerInvoiceId)
    // A canceled invoice that lists a charged payment is settled below, never closed (the buyer's cancel has the same rule).
    if (cancelled.ok && cancelled.data.status === 'canceled' && !cancelled.data.payments.some((payment) => CHARGED.has(payment.status))) {
      await closeAttempt(deps, attempt.attemptId, 'cancelled', null)
      return 'cancelled'
    }
    // Anything else (a refusal, a paid invoice): settle it like any other.
  }
  const report = await settleInvoice(deps, attempt.attemptId, attempt.providerInvoiceId, 'job')
  if (report.outcomes.some((outcome) => outcome === 'paid' || outcome === 'paid_needs_resolution')) return 'settled'
  return report.error === null ? 'done' : 'retry'
}

async function reconcileEvent(deps: PaymentDeps, event: ClaimedEvent): Promise<RowResult> {
  // An event of the other mode is closed, never settled (the claim leases it whatever its mode).
  if (event.live !== null && event.live !== (deps.config.mode === 'live')) {
    await closeEvent(deps, event.eventId, 'mode_mismatch')
    return 'done'
  }
  if (!isUuid(event.paymentId)) {
    await closeEvent(deps, event.eventId, 'no_payment_id')
    return 'done'
  }
  const outcome = await settlePayment(deps, event.paymentId, event.live, event.eventId)
  return outcome === 'retry' ? 'retry' : outcome === 'paid' || outcome === 'paid_needs_resolution' ? 'settled' : 'done'
}

/**
 * An in-flight refund: the payment is fetched and `refund_settle` decides from
 * its refunded total (a refund has no id at the provider, its evidence is that
 * total); a fetch that failed is `refund_checked`, which backs the refund off and,
 * after 24 hours, raises it to the owners. Nothing settled is touched again: the
 * claim leases only refunds still in flight.
 */
async function reconcileRefund(deps: PaymentDeps, refund: ClaimedRefund): Promise<RowResult> {
  const payment = await deps.client.fetchPayment(refund.providerPaymentId ?? '')
  if (!payment.ok) {
    await deps.rpc('refund_checked', { p_refund: refund.refundId, p_error: failureCode('PAYMENT', payment) })
    return 'retry'
  }
  await deps.rpc('refund_settle', { p_refund: refund.refundId, p_provider_refunded: payment.data.refunded })
  return 'done'
}

/**
 * One run of the `payments_reconcile` job: lease the due attempts, events and
 * in-flight refunds of the configured mode, settle each from what the provider
 * holds, record the run with counts only. Never begins an attempt (it has no
 * buyer's token): an uncertain one is only adopted or abandoned. Repeating it
 * changes nothing that is already settled. Never throws: a failure is a failed
 * run.
 */
export async function runPaymentsReconcile(deps: PaymentDeps): Promise<PaymentsReconcileSummary> {
  const began = Date.now()
  const startedAt = new Date(began).toISOString()
  const summary: PaymentsReconcileSummary = { job: 'payments_reconcile', status: 'ok', attempts: 0, events: 0, refunds: 0, settled: 0, cancelled: 0, errors: 0, skipped: 0 }
  const limit = { limited: false }
  const job: PaymentDeps = { ...deps, client: stopAfterLimit(deps.client, limit) }
  // After a 429, or once the run's time is spent, the rest keep their lease and are picked up when it runs out.
  const stop = (): boolean => limit.limited || Date.now() - began >= RUN_BUDGET_MS
  const tally = (result: RowResult): void => {
    if (result === 'settled') summary.settled += 1
    else if (result === 'cancelled') summary.cancelled += 1
    else if (result === 'retry') summary.errors += 1
  }
  try {
    const claim = (await deps.rpc('payment_reconcile_claim', { p_mode: deps.config.mode })) as {
      attempts?: ClaimedAttempt[]
      events?: ClaimedEvent[]
      refunds?: ClaimedRefund[]
    } | null
    const attempts = claim?.attempts ?? []
    const events = claim?.events ?? []
    const refunds = claim?.refunds ?? []
    summary.attempts = attempts.length
    summary.events = events.length
    summary.refunds = refunds.length
    for (const row of attempts) {
      if (stop()) {
        summary.skipped += 1
        continue
      }
      try {
        tally(await reconcileAttempt(job, row))
      } catch {
        summary.errors += 1
        // A row that keeps throwing must still back off and reach the terminal rule, which live in this SQL call.
        try {
          await checkAttempt(deps, row.attemptId, 'job', false, null, 'ROW_FAILED')
        } catch {
          // The lease is the fallback.
        }
      }
    }
    for (const row of events) {
      if (stop()) {
        summary.skipped += 1
        continue
      }
      try {
        tally(await reconcileEvent(job, row))
      } catch {
        summary.errors += 1
      }
    }
    for (const row of refunds) {
      if (stop()) {
        summary.skipped += 1
        continue
      }
      try {
        tally(await reconcileRefund(job, row))
      } catch {
        summary.errors += 1
        // Like an attempt: a row that keeps throwing must still back off and reach the 24-hour rule, which live in this SQL call.
        try {
          await deps.rpc('refund_checked', { p_refund: row.refundId, p_error: 'ROW_FAILED' })
        } catch {
          // The lease is the fallback.
        }
      }
    }
    const rows = summary.attempts + summary.events + refunds.length
    summary.status = summary.errors + summary.skipped === 0 ? 'ok' : summary.errors >= rows ? 'failed' : 'partial'
  } catch {
    summary.status = 'failed'
  }
  try {
    await deps.rpc('job_run_record', {
      p_job: 'payments_reconcile',
      p_status: summary.status,
      p_detail: {
        attempts: summary.attempts,
        events: summary.events,
        refunds: summary.refunds,
        settled: summary.settled,
        cancelled: summary.cancelled,
        errors: summary.errors,
        skipped: summary.skipped,
      },
      p_started_at: startedAt,
    })
  } catch {
    // The database being down is already a failed run.
    summary.status = 'failed'
  }
  return summary
}
