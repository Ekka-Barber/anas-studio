/**
 * The only Moyasar client and the only reader of the payment environment (P08,
 * PLANS/P08-CONTRACT.md sections 1, 2 and 7). Shapes and rules come from the
 * Moyasar documentation read on 2026-10-02 (contract section 2); nothing else
 * about Moyasar is assumed.
 *
 * - `paymentsConfig()` decides whether payments exist at all and which base,
 *   key and mode are in force; a bad combination is refused with a reason code.
 * - Every call has one timeout. A reply is classified by its HTTP status alone,
 *   never by the error `type` string (the pages spell it differently).
 * - A write whose outcome is unknown (a 5xx, a timeout, a network error, an
 *   unreadable 2xx) is `uncertain`: the change may have happened, so the caller
 *   reconciles by reading and never repeats it blindly.
 * - Nothing here logs: no body, no key, no URL that holds an id.
 */
import { z } from 'zod'

import { isHostedSite, LOCAL_HOSTS, optionalEnv } from '../env.ts'

/** Above this the provider is treated as not answering; every staleness window in the contract is longer. */
export const MOYASAR_TIMEOUT_MS = 10_000

/** The one real API base (docs.moyasar.com/docs/api/api-introduction.md); the key is never sent anywhere else. */
const REAL_API_BASE = 'https://api.moyasar.com/v1'
// The two fixed strings `pnpm db:env` writes for the local emulator; neither may ever reach a hosted site.
const EMULATOR_SECRET_KEY = 'sk_test_local_emulator_key_not_for_production'
const EMULATOR_WEBHOOK_SECRET = 'local-moyasar-webhook-secret-not-for-production'
// `sk_<mode>_` then printable ASCII only: the key becomes a Basic header, and `btoa` throws on a character beyond Latin-1.
const SECRET_KEY = { test: /^sk_test_[\x21-\x7e]*$/, live: /^sk_live_[\x21-\x7e]*$/ }

// ---------------------------------------------------------------------------
// Configuration

export type PaymentsConfigReason =
  | 'NOT_CONFIGURED'
  | 'BAD_MODE'
  | 'KEY_MODE_MISMATCH'
  | 'WEAK_WEBHOOK_SECRET'
  | 'BAD_BASE_URL'
  | 'BAD_CALLBACK_BASE'
  | 'LIVE_ON_LOCAL'
  | 'EMULATOR_ON_HOSTED'
  | 'TEST_CODE_REQUIRED'

export type PaymentsConfig =
  | {
      ok: true
      baseUrl: string
      secretKey: string
      webhookSecret: string
      mode: 'test' | 'live'
      callbackBase: string
      storageBase: string
      /** Only on a hosted site in test mode (the sandbox fence). */
      testAccessCode?: string
    }
  | { ok: false; reason: PaymentsConfigReason }

export type PaymentsConfigOk = Extract<PaymentsConfig, { ok: true }>

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const refused = (reason: PaymentsConfigReason): PaymentsConfig => ({ ok: false, reason })

/**
 * Contract section 1, the rules in order. Unset means absent or empty. Never
 * throws and never logs a value: a failure is only its reason code.
 */
export function paymentsConfig(): PaymentsConfig {
  const baseUrl = optionalEnv('MOYASAR_API_BASE_URL')
  const secretKey = optionalEnv('MOYASAR_SECRET_KEY')
  const webhookSecret = optionalEnv('MOYASAR_WEBHOOK_SECRET')
  const modeValue = optionalEnv('PAYMENTS_MODE')
  const callbackBase = optionalEnv('FUNCTIONS_PUBLIC_URL')

  // 1. The five variables.
  if (!baseUrl || !secretKey || !webhookSecret || !modeValue || !callbackBase) return refused('NOT_CONFIGURED')
  // 2. The mode.
  if (modeValue !== 'test' && modeValue !== 'live') return refused('BAD_MODE')
  const mode = modeValue
  // 3. The key's prefix is the mode's, and the whole key is printable ASCII.
  if (!SECRET_KEY[mode].test(secretKey)) return refused('KEY_MODE_MISMATCH')
  // 4. The webhook secret is not guessable.
  if (webhookSecret.length < 32) return refused('WEAK_WEBHOOK_SECRET')
  // 5. Both bases parse and carry no trailing slash.
  const base = baseUrl.endsWith('/') ? null : parseUrl(baseUrl)
  if (!base) return refused('BAD_BASE_URL')
  const callback = callbackBase.endsWith('/') ? null : parseUrl(callbackBase)
  if (!callback) return refused('BAD_CALLBACK_BASE')

  const realBase = baseUrl === REAL_API_BASE
  const publicHttps = callback.protocol === 'https:' && !LOCAL_HOSTS.has(callback.hostname)
  let testAccessCode: string | undefined
  if (!isHostedSite()) {
    // 6. A local site: never live; the base is the emulator (a local host over http) or the real one through a tunnel.
    if (mode === 'live') return refused('LIVE_ON_LOCAL')
    const emulator = base.protocol === 'http:' && LOCAL_HOSTS.has(base.hostname)
    if (!emulator && !realBase) return refused('BAD_BASE_URL')
    if (realBase && !publicHttps) return refused('BAD_CALLBACK_BASE')
  } else {
    // 7. A hosted site: only the real base, a public https callback base, nothing from the local stack.
    if (!realBase) return refused('BAD_BASE_URL')
    if (!publicHttps) return refused('BAD_CALLBACK_BASE')
    if (secretKey === EMULATOR_SECRET_KEY || webhookSecret === EMULATOR_WEBHOOK_SECRET) return refused('EMULATOR_ON_HOSTED')
    if (mode === 'test') {
      const code = optionalEnv('PAYMENTS_TEST_ACCESS_CODE')
      if (!code || code.length < 16) return refused('TEST_CODE_REQUIRED')
      testAccessCode = code
    }
  }
  return {
    ok: true,
    baseUrl,
    secretKey,
    webhookSecret,
    mode,
    callbackBase,
    // `SUPABASE_URL` is an internal address inside the local runtime, so the public Storage base is built on the functions' public origin.
    storageBase: `${callback.origin}/storage/v1`,
    ...(testAccessCode ? { testAccessCode } : {}),
  }
}

// ---------------------------------------------------------------------------
// Normalized replies

export interface MoyasarPayment {
  id: string
  status: string
  /** Integer halalas. */
  amount: number
  currency: string
  fee: number
  /** The running refunded total: the only evidence of a refund (no refund id is documented). */
  refunded: number
  invoiceId: string | null
  createdAt: string | null
  sourceType: string | null
  sourceCompany: string | null
}

/**
 * A payment as an invoice lists it: only what says which payments to fetch.
 * The money facts always come from `fetchPayment`, so a sibling payment the
 * provider returns with a field missing can never make a paid invoice unreadable.
 */
export interface MoyasarInvoicePayment {
  id: string
  status: string
}

export interface MoyasarInvoice {
  id: string
  status: string
  amount: number
  currency: string
  /** The hosted checkout page; always an http(s) URL. */
  url: string
  expiredAt: string | null
  metadata: Record<string, string>
  payments: MoyasarInvoicePayment[]
}

export interface ListInvoicesData {
  invoices: MoyasarInvoice[]
  nextPage: number | null
}

export interface CreateInvoiceInput {
  amount: number
  currency: string
  description: string
  callback_url: string
  success_url: string
  back_url: string
  /** ISO 8601. */
  expired_at: string
  metadata: Record<string, string>
}

/**
 * `refused`: the provider answered 4xx (nothing changed). `not_found`: 404.
 * `rate_limited`: 429 (nothing changed). `unavailable`: a read that could not
 * be completed. `uncertain`: a write that could not be completed and may have
 * happened. `status` is the HTTP status when a reply arrived.
 */
export type MoyasarResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; kind: 'refused' | 'not_found' | 'rate_limited' | 'unavailable' | 'uncertain'; status?: number }

export interface MoyasarClient {
  createInvoice(input: CreateInvoiceInput): Promise<MoyasarResult<MoyasarInvoice>>
  fetchInvoice(id: string): Promise<MoyasarResult<MoyasarInvoice>>
  /** One page of invoices matching `metadata[key]=value`; the filter is not trusted, the caller checks each invoice's own metadata. */
  listInvoices(input: { metadata: Record<string, string>; page?: number }): Promise<MoyasarResult<ListInvoicesData>>
  cancelInvoice(id: string): Promise<MoyasarResult<MoyasarInvoice>>
  fetchPayment(id: string): Promise<MoyasarResult<MoyasarPayment>>
  /** Always sends the amount: a refund with no amount would refund the whole payment. */
  refundPayment(id: string, amountHalalas: number): Promise<MoyasarResult<MoyasarPayment>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The shape check every id passes before it is put in a URL path. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** The hosted checkout page ends up in a link for the buyer: only an http(s) URL is accepted from the provider. */
const httpUrl = z.string().refine((value) => {
  const protocol = parseUrl(value)?.protocol
  return protocol === 'https:' || protocol === 'http:'
})

// Unknown fields are dropped. `amount` and `refunded` are exact integers because money decisions rest on them;
// `fee` is only an estimate ("Estimated payment fee"), so a fractional one is rounded and a missing one is 0,
// never a reason to refuse the payment.
const paymentSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  fee: z.number().nullish(),
  refunded: z.number().int(),
  invoice_id: z.string().nullish(),
  created_at: z.string().nullish(),
  source: z.object({ type: z.string().nullish(), company: z.string().nullish() }).nullish(),
})

const invoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  url: httpUrl,
  expired_at: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  payments: z.array(z.object({ id: z.string(), status: z.string() })).nullish(),
})

const listSchema = z.object({
  invoices: z.array(invoiceSchema),
  meta: z.object({ next_page: z.number().int().nullish() }).nullish(),
})

function toPayment(payment: z.infer<typeof paymentSchema>): MoyasarPayment {
  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    fee: Math.round(payment.fee ?? 0),
    refunded: payment.refunded,
    invoiceId: payment.invoice_id ?? null,
    createdAt: payment.created_at ?? null,
    sourceType: payment.source?.type ?? null,
    sourceCompany: payment.source?.company ?? null,
  }
}

function toInvoice(invoice: z.infer<typeof invoiceSchema>): MoyasarInvoice {
  return {
    id: invoice.id,
    status: invoice.status,
    amount: invoice.amount,
    currency: invoice.currency,
    url: invoice.url,
    expiredAt: invoice.expired_at ?? null,
    // Only string values count: a reconciliation compares them with ids it minted.
    metadata: Object.fromEntries(Object.entries(invoice.metadata ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    payments: (invoice.payments ?? []).map((payment) => ({ id: payment.id, status: payment.status })),
  }
}

function parseInvoice(json: unknown): MoyasarInvoice | null {
  const result = invoiceSchema.safeParse(json)
  return result.success ? toInvoice(result.data) : null
}

function parsePayment(json: unknown): MoyasarPayment | null {
  const result = paymentSchema.safeParse(json)
  return result.success ? toPayment(result.data) : null
}

function parseList(json: unknown): ListInvoicesData | null {
  const result = listSchema.safeParse(json)
  return result.success ? { invoices: result.data.invoices.map(toInvoice), nextPage: result.data.meta?.next_page ?? null } : null
}

// ---------------------------------------------------------------------------
// The client

/** An id that is not a UUID never reaches the network. */
function refusedLocally<T>(): Promise<MoyasarResult<T>> {
  return Promise.resolve<MoyasarResult<T>>({ ok: false, kind: 'refused' })
}

export function moyasarClient(config: Pick<PaymentsConfigOk, 'baseUrl' | 'secretKey'>, fetchImpl: typeof fetch = fetch): MoyasarClient {
  // HTTP Basic: the secret key is the user name and the password is empty (docs.moyasar.com/docs/api/authentication.md).
  const authorization = `Basic ${btoa(`${config.secretKey}:`)}`

  async function send<T>(
    write: boolean,
    method: string,
    path: string,
    parse: (json: unknown) => T | null,
    body?: unknown,
  ): Promise<MoyasarResult<T>> {
    // A write that could not be completed may still have happened, so it is never just "unavailable".
    const lost = write ? 'uncertain' : 'unavailable'
    let response: Response
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          authorization,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // The key must not follow a redirect anywhere; a 3xx is just an unusable reply.
        redirect: 'manual',
        signal: AbortSignal.timeout(MOYASAR_TIMEOUT_MS),
      })
    } catch {
      return { ok: false, kind: lost }
    }
    const { status } = response
    if (status >= 200 && status < 300) {
      try {
        const data = parse(await response.json())
        if (data !== null) return { ok: true, status, data }
      } catch {
        // Not JSON, or the body stalled past the timeout: unreadable, below.
      }
      return { ok: false, kind: lost, status }
    }
    // Only the status classifies a failure; the error body is never read or kept.
    await response.body?.cancel().catch(() => undefined)
    if (status === 404) return { ok: false, kind: 'not_found', status }
    if (status === 429) return { ok: false, kind: 'rate_limited', status }
    if (status >= 400 && status < 500) return { ok: false, kind: 'refused', status }
    return { ok: false, kind: lost, status }
  }

  return {
    createInvoice: (input) =>
      send(true, 'POST', '/invoices', parseInvoice, {
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        callback_url: input.callback_url,
        success_url: input.success_url,
        back_url: input.back_url,
        expired_at: input.expired_at,
        metadata: input.metadata,
      }),
    fetchInvoice: (id) => (isUuid(id) ? send(false, 'GET', `/invoices/${id}`, parseInvoice) : refusedLocally()),
    listInvoices: ({ metadata, page }) => {
      const params = new URLSearchParams()
      if (page !== undefined) params.set('page', String(page))
      for (const [key, value] of Object.entries(metadata)) params.set(`metadata[${key}]`, value)
      const query = params.toString()
      return send(false, 'GET', query ? `/invoices?${query}` : '/invoices', parseList)
    },
    cancelInvoice: (id) => (isUuid(id) ? send(true, 'PUT', `/invoices/${id}/cancel`, parseInvoice) : refusedLocally()),
    fetchPayment: (id) => (isUuid(id) ? send(false, 'GET', `/payments/${id}`, parsePayment) : refusedLocally()),
    refundPayment: (id, amountHalalas) =>
      isUuid(id) && Number.isSafeInteger(amountHalalas) && amountHalalas > 0
        ? send(true, 'POST', `/payments/${id}/refund`, parsePayment, { amount: amountHalalas })
        : refusedLocally(),
  }
}
