/**
 * The local Moyasar emulator (P08, PLANS/P08-CONTRACT.md section 9).
 *
 * A TEST HARNESS, not Moyasar: a plain node:http server, in memory, no
 * dependency. It implements only the routes and object shapes documented on
 * docs.moyasar.com (read 2026-10-02, contract section 2). Where the
 * documentation is silent or contradicts itself, `EmulatorConfig` holds a
 * switch for each reading, so the code under test is proven against both.
 * Nothing here calls Moyasar or leaves the machine: the webhook, the invoice
 * callback and the redirects only ever go to local hosts.
 *
 * Erasable TypeScript only (no enums, namespaces or parameter properties), so
 * `node tests/support/moyasar-emulator.ts` (`pnpm emulator`) runs it as it is.
 */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import { isHostedSite, LOCAL_HOSTS, secretsMatch } from '../../supabase/functions/_shared/env.ts'

/** The two fixed local values `pnpm db:env` writes; neither is a real credential. */
export const LOCAL_SECRET_KEY = 'sk_test_local_emulator_key_not_for_production'
export const LOCAL_WEBHOOK_SECRET = 'local-moyasar-webhook-secret-not-for-production'
const LOCAL_WEBHOOK_URL = 'http://127.0.0.1:54321/functions/v1/payments/webhook'
const STANDALONE_PORT = 54390

const PAGE_SIZE = 40
const DELIVERY_TIMEOUT_MS = 8_000
const FAULT_HANG_MS = 60_000
const MAX_BODY_BYTES = 1_000_000

const PAYMENT_STATUSES = new Set(['initiated', 'paid', 'authorized', 'failed', 'refunded', 'captured', 'voided', 'verified', 'expired'])
const INVOICE_STATUSES = new Set(['initiated', 'paid', 'failed', 'refunded', 'canceled', 'on_hold', 'expired', 'voided'])
/** Webhook event for a payment status; the failed one is spelled as the API pages spell it. */
const EVENT_TYPES: Record<string, string> = {
  paid: 'payment_paid',
  failed: 'payment_failed',
  refunded: 'payment_refunded',
  voided: 'payment_voided',
  authorized: 'payment_authorized',
  captured: 'payment_captured',
  verified: 'payment_verified',
}
const FAULT_MODES = new Set(['timeout', '500', '429', 'drop_after_commit', 'commit_after_delay'])
const SWITCHES = new Set([
  'refuseSecondRefund',
  'partialRefundKeepsPaid',
  'dropInvoiceMetadata',
  'ignoreMetadataFilter',
  'cancelPaidReturns200',
  'dropExpiredAt',
  'autoWebhook',
  'autoCallback',
  'live',
])
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
/** The sandbox test cards of docs.moyasar.com/docs/guides/card-payments/test-cards.md, masked. */
const APPROVED_CARD = '420132XXXXXX1010'
const DECLINED_CARD = '420132XXXXXX1101'

const BANNER = 'محاكي الدفع المحلي: لا يُخصم أي مبلغ'

export interface EmulatorConfig {
  /** A refund of a payment already `refunded` answers 400 (the documentation does not say). */
  refuseSecondRefund: boolean
  /** A partial refund leaves the status as it was; only a full one makes it `refunded`. */
  partialRefundKeepsPaid: boolean
  /** An invoice keeps no metadata (the create-invoice reference omits the field). */
  dropInvoiceMetadata: boolean
  /** The invoice list ignores `metadata[key]` and returns every invoice. */
  ignoreMetadataFilter: boolean
  /** A cancel of a paid invoice answers 200 with status `paid` instead of 400. */
  cancelPaidReturns200: boolean
  /** The invoice reply carries no `expired_at`; the invoice still expires. */
  dropExpiredAt: boolean
  /** Where the webhook goes (a local host only); null sends none. */
  webhookUrl: string | null
  webhookSecret: string
  autoWebhook: boolean
  autoCallback: boolean
  /** The webhook's `live` flag. */
  live: boolean
}

export interface EmulatorOptions extends Partial<EmulatorConfig> {
  /** 0 (the default) takes any free port. */
  port?: number
  host?: string
  secretKey?: string
  /** The origin of every invoice `url`; never taken from the Host header. */
  publicBase?: string
}

export interface PaymentSource {
  type: string
  company: string
  number: string
  message: string | null
  transaction_url: string | null
  gateway_id: string
  reference_number: string
}

/** The documented payment object (docs.moyasar.com/api/payments/02-fetch-payment). */
export interface PaymentObject {
  id: string
  status: string
  amount: number
  fee: number
  currency: string
  refunded: number
  refunded_at: string | null
  captured: number
  captured_at: string | null
  voided_at: string | null
  description: string
  amount_format: string
  fee_format: string
  refunded_format: string
  captured_format: string
  invoice_id: string
  ip: string | null
  callback_url: string | null
  created_at: string
  updated_at: string
  metadata: Record<string, string>
  source: PaymentSource
}

/** The documented invoice object (docs.moyasar.com/api/invoices/01-create-invoice). */
export interface InvoiceObject {
  id: string
  status: string
  amount: number
  currency: string
  description: string
  logo_url: string | null
  amount_format: string
  url: string
  callback_url: string | null
  /** Absent only under `dropExpiredAt`. */
  expired_at?: string | null
  created_at: string
  updated_at: string
  back_url: string | null
  success_url: string | null
  payments: PaymentObject[]
  metadata: Record<string, string>
}

type PaymentRecord = Omit<PaymentObject, 'amount_format' | 'fee_format' | 'refunded_format' | 'captured_format' | 'ip'>
type InvoiceRecord = Omit<InvoiceObject, 'amount_format' | 'logo_url' | 'payments' | 'expired_at'> & { expired_at: string | null }

/** A call to a Moyasar route; headers (the Authorization one above all) are never kept. */
export interface EmulatorCall {
  method: string
  path: string
  /** The route key a fault names, such as `POST /v1/payments/:id/refund`. */
  route: string
  query: Record<string, string>
  body: unknown
  status: number | null
  fault: string | null
}

export interface EmulatorDelivery {
  kind: 'webhook' | 'callback'
  url: string
  type: string | null
  eventId: string | null
  status: number | null
  error: string | null
}

export interface EmulatorFault {
  route: string
  mode: string
  times: number
  delayMs: number
}

export interface EmulatorState {
  invoices: InvoiceObject[]
  payments: PaymentObject[]
  calls: EmulatorCall[]
  deliveries: EmulatorDelivery[]
  faults: EmulatorFault[]
}

export interface Emulator {
  /** `http://<host>:<port>`: the Moyasar API base is `url + '/v1'`. */
  url: string
  port: number
  server: Server
  /** Stops listening, drops every connection and cancels every pending timer. */
  close(): Promise<void>
  state(): EmulatorState
  /** Forgets every invoice, payment, call, delivery and fault; the config returns to what it was at the start. */
  reset(): void
  /** Applies a partial config (throws on a bad value) and returns the whole config. */
  config(patch?: Partial<EmulatorConfig>): EmulatorConfig
}

interface Reply {
  status: number
  body: unknown
}
type Json = Record<string, unknown>

interface Route {
  method: string
  pattern: RegExp
  key: string
  run(input: { id: string; query: URLSearchParams; body: unknown }): Reply
}

const DEFAULTS: EmulatorConfig = {
  refuseSecondRefund: false,
  partialRefundKeepsPaid: false,
  dropInvoiceMetadata: false,
  ignoreMetadataFilter: false,
  cancelPaidReturns200: false,
  dropExpiredAt: false,
  webhookUrl: null,
  webhookSecret: LOCAL_WEBHOOK_SECRET,
  autoWebhook: true,
  autoCallback: true,
  live: false,
}

// A body that was sent but is not JSON; kept apart from "no body".
const NOT_JSON = Symbol('not json')

const UNAUTHORIZED: Reply = {
  status: 401,
  body: { type: 'authentication_error', message: 'Invalid authorization credentials', errors: null },
}
const NOT_FOUND: Reply = { status: 404, body: { type: 'record_not_found', message: 'Record not found', errors: null } }

// The two 400 bodies as the sandbox answered them on 2026-10-02 (artifacts/acceptance/P08/moyasar-sandbox-2026-10-02.md):
// a refused field is `validation_error` with a map of field to messages; an operation the object's state refuses is
// `invalid_request_error` with a sentence and no map.
function invalid(errors: Record<string, string[]>): Reply {
  return { status: 400, body: { type: 'validation_error', message: 'Data validation failed', errors } }
}

function refusedOperation(message: string): Reply {
  return { status: 400, body: { type: 'invalid_request_error', message, errors: null } }
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Integer halalas as the `*_format` strings show them; no floating point near money. */
function money(halalas: number, currency: string): string {
  return `${Math.trunc(halalas / 100)}.${String(halalas % 100).padStart(2, '0')} ${currency}`
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/** Loopback and private (RFC 1918, unique-local, link-local) peers; nothing else may drive the harness. */
export function isLocalPeer(address: string | undefined): boolean {
  if (!address) return false
  const ip = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  if (ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true
  const parts = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip)
  if (!parts) return false
  const first = Number(parts[1])
  const second = Number(parts[2])
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

/**
 * The `Host` header, and the `Origin` header when a browser sent one, must name a local host too: a web page open in
 * the developer's browser (a foreign Origin, or a rebound DNS name in the Host) must not be able to drive the harness.
 */
function isLocalRequest(req: IncomingMessage): boolean {
  const host = /^([^:/@\s]+|\[[0-9a-f:]+\])(?::\d+)?$/i.exec(req.headers.host ?? '')?.[1]
  const { origin } = req.headers
  return host !== undefined && LOCAL_HOSTS.has(host.toLowerCase()) && (origin === undefined || isLocalUrl(origin))
}

function metadataProblem(value: unknown): string | null {
  if (!isObject(value)) return 'must be an object'
  const entries = Object.entries(value)
  if (entries.length > 30) return 'must have at most 30 keys'
  for (const [key, item] of entries) {
    if (key.length > 40) return 'keys must be at most 40 characters'
    if (typeof item !== 'string' || item.length > 500) return 'values must be strings of at most 500 characters'
  }
  return null
}

function paymentOut(p: PaymentRecord): PaymentObject {
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    fee: p.fee,
    currency: p.currency,
    refunded: p.refunded,
    refunded_at: p.refunded_at,
    captured: p.captured,
    captured_at: p.captured_at,
    voided_at: p.voided_at,
    description: p.description,
    amount_format: money(p.amount, p.currency),
    fee_format: money(p.fee, p.currency),
    refunded_format: money(p.refunded, p.currency),
    captured_format: money(p.captured, p.currency),
    invoice_id: p.invoice_id,
    ip: null,
    callback_url: p.callback_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
    metadata: { ...p.metadata },
    source: { ...p.source },
  }
}

function paginate<T>(items: T[], page: number): { items: T[]; meta: Json } {
  const totalPages = Math.ceil(items.length / PAGE_SIZE)
  return {
    items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    meta: {
      current_page: page,
      next_page: page < totalPages ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null,
      total_pages: totalPages,
      total_count: items.length,
    },
  }
}

/** The list `page` parameter; null when it is not a positive integer. */
function pageOf(query: URLSearchParams): number | null {
  const raw = query.get('page')
  if (raw === null) return 1
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
}

function matchesMetadata(metadata: Record<string, string>, query: URLSearchParams): boolean {
  for (const [name, value] of query) {
    const key = /^metadata\[(.+)\]$/.exec(name)?.[1]
    if (key !== undefined && metadata[key] !== value) return false
  }
  return true
}

function send(res: ServerResponse, status: number, type: string, payload: string): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' })
  res.end(payload)
}
const json = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
const html = (res: ServerResponse, status: number, markup: string): void => send(res, status, 'text/html; charset=utf-8', markup)

function redirect(res: ServerResponse, location: string): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(303, { location, 'cache-control': 'no-store' })
  res.end()
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:1rem;background:#f6f6f6}main{max-width:32rem;margin:0 auto;background:#fff;padding:1rem;border:1px solid #ccc}.banner{background:#fff3cd;border:1px solid #d4a72c;padding:.5rem;font-weight:700}button{display:block;width:100%;margin:.5rem 0;padding:.75rem;font:inherit}</style>
</head>
<body>
<main>
<p class="banner" role="note">${BANNER}</p>
${inner}
</main>
</body>
</html>`
}

function invoicePage(inv: InvoiceObject, notice?: string): string {
  const payable = inv.status === 'initiated'
  const actions = payable
    ? `<button type="submit" name="action" value="pay">دفع ناجح</button>
<button type="submit" name="action" value="fail">دفع مرفوض</button>
<button type="submit" name="action" value="3ds">دفع بتحقق 3-D Secure</button>
`
    : ''
  const state = notice ?? (payable ? '' : stateNotice(inv.status))
  return shell(
    'صفحة دفع الفاتورة',
    `<h1>دفع الفاتورة</h1>
<dl><dt>الوصف</dt><dd>${esc(inv.description)}</dd><dt>المبلغ</dt><dd dir="ltr">${esc(inv.amount_format)}</dd><dt>الحالة</dt><dd dir="ltr">${esc(inv.status)}</dd></dl>
${state ? `<p role="status">${esc(state)}</p>` : ''}
<form method="post" action="/invoices/${esc(inv.id)}/action">
${actions}<button type="submit" name="action" value="back">رجوع</button>
</form>`,
  )
}

function challengePage(inv: InvoiceObject, paymentId: string): string {
  return shell(
    'التحقق 3-D Secure',
    `<h1>التحقق 3-D Secure (محاكاة)</h1>
<p>أكّد العملية أو ارفضها لإكمال الدفع التجريبي.</p>
<form method="post" action="/invoices/${esc(inv.id)}/action">
<input type="hidden" name="payment" value="${esc(paymentId)}">
<button type="submit" name="action" value="approve">موافقة</button>
<button type="submit" name="action" value="reject">رفض</button>
<button type="submit" name="action" value="back">رجوع</button>
</form>`,
  )
}

function stateNotice(status: string): string {
  if (status === 'paid') return 'تم دفع هذه الفاتورة.'
  if (status === 'expired') return 'انتهت صلاحية هذه الفاتورة، ولا يمكن دفعها.'
  if (status === 'canceled') return 'أُلغيت هذه الفاتورة، ولا يمكن دفعها.'
  return `لا يمكن دفع هذه الفاتورة (الحالة: ${status}).`
}

export async function startEmulator(options: EmulatorOptions = {}): Promise<Emulator> {
  if (isHostedSite()) {
    throw new Error('The Moyasar emulator refuses to run when SITE_URL names a hosted site.')
  }
  const { port: wantedPort = 0, host = '127.0.0.1', secretKey = LOCAL_SECRET_KEY, publicBase: wantedBase, ...switches } = options
  // The stand-in page answers only under a local host name, so a base anywhere else would hand out links nobody can open.
  if (wantedBase !== undefined && !isLocalUrl(wantedBase)) {
    throw new Error('publicBase must be a local http(s) URL.')
  }

  const config: EmulatorConfig = { ...DEFAULTS }
  const invoices = new Map<string, InvoiceRecord>()
  const payments = new Map<string, PaymentRecord>()
  const calls: EmulatorCall[] = []
  const deliveries: EmulatorDelivery[] = []
  let faults: EmulatorFault[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  // Cuts the webhook and callback deliveries still in flight on reset() and close(), so a receiver that never answers
  // neither keeps the process alive nor writes into the next test's delivery log.
  let deliveryAbort = new AbortController()
  let publicBase = ''

  /** Validates the whole patch first, so a bad one changes nothing; returns the problem or null. */
  function applyConfig(patch: Record<string, unknown>): string | null {
    const given = Object.entries(patch).filter(([, value]) => value !== undefined)
    for (const [key, value] of given) {
      if (SWITCHES.has(key)) {
        if (typeof value !== 'boolean') return `${key} must be a boolean`
      } else if (key === 'webhookUrl') {
        if (value !== null && (typeof value !== 'string' || !isLocalUrl(value))) return 'webhookUrl must be null or a local http(s) URL'
      } else if (key === 'webhookSecret') {
        if (typeof value !== 'string' || value === '') return 'webhookSecret must be a non-empty string'
      } else {
        return `unknown setting ${key}`
      }
    }
    Object.assign(config, Object.fromEntries(given))
    return null
  }
  const problem = applyConfig(switches)
  if (problem) throw new Error(problem)
  const initial: EmulatorConfig = { ...config }

  function later(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timer.unref()
    timers.add(timer)
    return timer
  }

  // ---- state ----------------------------------------------------------------

  function expireIfDue(inv: InvoiceRecord): void {
    if (inv.status === 'initiated' && inv.expired_at !== null && Date.parse(inv.expired_at) <= Date.now()) {
      inv.status = 'expired'
      inv.updated_at = new Date().toISOString()
    }
  }

  function invoiceById(id: string): InvoiceRecord | undefined {
    const inv = invoices.get(id)
    if (inv) expireIfDue(inv)
    return inv
  }

  function invoiceOut(inv: InvoiceRecord): InvoiceObject {
    expireIfDue(inv)
    return {
      id: inv.id,
      status: inv.status,
      amount: inv.amount,
      currency: inv.currency,
      description: inv.description,
      logo_url: null,
      amount_format: money(inv.amount, inv.currency),
      url: inv.url,
      callback_url: inv.callback_url,
      ...(config.dropExpiredAt ? {} : { expired_at: inv.expired_at }),
      created_at: inv.created_at,
      updated_at: inv.updated_at,
      back_url: inv.back_url,
      success_url: inv.success_url,
      payments: [...payments.values()].filter((p) => p.invoice_id === inv.id).map(paymentOut),
      metadata: { ...inv.metadata },
    }
  }

  function newPayment(inv: InvoiceRecord, status: string, amount = inv.amount, currency = inv.currency): PaymentRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const payment: PaymentRecord = {
      id,
      status,
      amount,
      fee: 0,
      currency,
      refunded: status === 'refunded' ? amount : 0,
      refunded_at: status === 'refunded' ? now : null,
      captured: status === 'captured' ? amount : 0,
      captured_at: status === 'captured' ? now : null,
      voided_at: status === 'voided' ? now : null,
      description: inv.description,
      invoice_id: inv.id,
      callback_url: inv.callback_url,
      created_at: now,
      updated_at: now,
      // Not documented: a payment made through an invoice carries a copy of the invoice's metadata.
      metadata: { ...inv.metadata },
      source: {
        type: 'creditcard',
        company: 'mada',
        number: status === 'failed' ? DECLINED_CARD : APPROVED_CARD,
        message: status === 'paid' ? 'APPROVED' : status === 'failed' ? 'INSUFFICIENT FUNDS' : null,
        transaction_url: null,
        gateway_id: 'emulator',
        reference_number: `emulator-${id.slice(0, 8)}`,
      },
    }
    payments.set(id, payment)
    return payment
  }

  /**
   * The invoice follows its payments in one case only, the one the callback page
   * documents: a paid payment pays a payable invoice. What a failure or a refund
   * makes of the invoice is open item 6 of E02, so both leave it as it was; a test
   * that needs the other reading sets it with `/__emulator/invoice`. True when
   * this call made the invoice paid (the only case the callback is sent for).
   */
  function mirrorInvoice(payment: PaymentRecord): boolean {
    const inv = invoiceById(payment.invoice_id)
    if (!inv || payment.status !== 'paid' || inv.status !== 'initiated') return false
    inv.status = 'paid'
    inv.updated_at = new Date().toISOString()
    return true
  }

  // ---- outbound deliveries (webhook, invoice callback) --------------------------

  async function post(
    kind: EmulatorDelivery['kind'],
    url: string,
    body: unknown,
    label: { type?: string; eventId?: string } = {},
  ): Promise<EmulatorDelivery> {
    const record: EmulatorDelivery = { kind, url, type: label.type ?? null, eventId: label.eventId ?? null, status: null, error: null }
    const cut = deliveryAbort.signal
    if (!isLocalUrl(url)) {
      record.error = 'not a local host'
    } else {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.any([cut, AbortSignal.timeout(DELIVERY_TIMEOUT_MS)]),
        })
        record.status = response.status
        await response.body?.cancel()
      } catch (cause) {
        record.error = cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'unreachable'
      }
    }
    // A delivery cut by reset() or close() belongs to a state that is gone: it is not logged.
    if (!cut.aborted) deliveries.push(record)
    return record
  }

  function webhookBody(type: string, eventId: string, secretToken: string, live: boolean, data: unknown): Json {
    return {
      id: eventId,
      type,
      created_at: new Date().toISOString(),
      secret_token: secretToken,
      account_name: 'emulator',
      live,
      data,
    }
  }

  /** The webhook and the callback a new payment causes, as configured, before the caller answers. */
  async function deliverPayment(payment: PaymentRecord, inv: InvoiceRecord, becamePaid: boolean): Promise<EmulatorDelivery[]> {
    const sent: EmulatorDelivery[] = []
    const type = EVENT_TYPES[payment.status]
    if (config.autoWebhook && config.webhookUrl && type) {
      const eventId = randomUUID()
      sent.push(await post('webhook', config.webhookUrl, webhookBody(type, eventId, config.webhookSecret, config.live, paymentOut(payment)), { type, eventId }))
    }
    if (config.autoCallback && becamePaid && inv.callback_url) {
      sent.push(await post('callback', inv.callback_url, invoiceOut(inv)))
    }
    return sent
  }

  // ---- the Moyasar routes (contract section 2, nothing else) ----------------------

  function createInvoice(body: unknown): Reply {
    if (!isObject(body)) return invalid({ body: ['must be a JSON object'] })
    const errors: Record<string, string[]> = {}
    const { amount, currency, description, expired_at: expiredAt, metadata } = body
    if (amount === undefined || amount === null) errors.amount = ['is required']
    else if (!Number.isInteger(amount) || (amount as number) < 100) errors.amount = ['The value must be greater than or equal to 100.']
    if (typeof currency !== 'string' || currency === '') errors.currency = ['is required']
    if (typeof description !== 'string' || description === '') errors.description = ['is required']
    for (const field of ['callback_url', 'success_url', 'back_url']) {
      const value = body[field]
      if (value !== undefined && value !== null && (typeof value !== 'string' || !isLocalUrl(value))) {
        errors[field] = ['must be a local http(s) URL (emulator guard)']
      }
    }
    if (expiredAt !== undefined && expiredAt !== null && (typeof expiredAt !== 'string' || !ISO_DATE_TIME.test(expiredAt) || Number.isNaN(Date.parse(expiredAt)))) {
      errors.expired_at = ['must be an ISO 8601 date and time']
    } else if (typeof expiredAt === 'string' && Date.parse(expiredAt) < Date.now()) {
      // The sandbox refuses an expiry that has already passed.
      errors.expired_at = [`The value must be greater than or equal to ${new Date().toISOString()}.`]
    }
    const metadataError = metadata === undefined || metadata === null ? null : metadataProblem(metadata)
    if (metadataError) errors.metadata = [metadataError]
    if (Object.keys(errors).length > 0) return invalid(errors)

    const id = randomUUID()
    const now = new Date().toISOString()
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
    const inv: InvoiceRecord = {
      id,
      status: 'initiated',
      amount: amount as number,
      currency: currency as string,
      description: description as string,
      url: `${publicBase}/invoices/${id}`,
      callback_url: text(body.callback_url),
      expired_at: text(expiredAt),
      created_at: now,
      updated_at: now,
      back_url: text(body.back_url),
      success_url: text(body.success_url),
      metadata: config.dropInvoiceMetadata || !isObject(metadata) ? {} : { ...(metadata as Record<string, string>) },
    }
    invoices.set(id, inv)
    return { status: 201, body: invoiceOut(inv) }
  }

  function listInvoices(query: URLSearchParams): Reply {
    const page = pageOf(query)
    if (page === null) return invalid({ page: ['must be a positive integer'] })
    let list = [...invoices.values()].reverse()
    list.forEach(expireIfDue)
    const id = query.get('id')
    if (id) list = list.filter((inv) => inv.id === id)
    const status = query.get('status')
    if (status) list = list.filter((inv) => inv.status === status)
    if (!config.ignoreMetadataFilter) list = list.filter((inv) => matchesMetadata(inv.metadata, query))
    const { items, meta } = paginate(list, page)
    return { status: 200, body: { invoices: items.map(invoiceOut), meta } }
  }

  function cancelInvoice(id: string): Reply {
    const inv = invoiceById(id)
    if (!inv) return NOT_FOUND
    if (inv.status === 'initiated') {
      inv.status = 'canceled'
      inv.updated_at = new Date().toISOString()
    } else if (inv.status === 'paid' && config.cancelPaidReturns200) {
      // A paid one answers 200 only under the switch.
    } else {
      // The sandbox's own words for a canceled and for an expired invoice; the other statuses follow the same sentence.
      return refusedOperation(`Cancel failed. The Invoice is already ${inv.status}.`)
    }
    return { status: 200, body: invoiceOut(inv) }
  }

  function listPayments(query: URLSearchParams): Reply {
    const page = pageOf(query)
    if (page === null) return invalid({ page: ['must be a positive integer'] })
    let list = [...payments.values()].reverse()
    const id = query.get('id')
    if (id) list = list.filter((p) => p.id === id)
    const status = query.get('status')
    if (status) list = list.filter((p) => p.status === status)
    list = list.filter((p) => matchesMetadata(p.metadata, query))
    const { items, meta } = paginate(list, page)
    return { status: 200, body: { payments: items.map(paymentOut), meta } }
  }

  function refundPayment(id: string, body: unknown): Reply {
    const payment = payments.get(id)
    if (!payment) return NOT_FOUND
    if (body !== undefined && !isObject(body)) return invalid({ body: ['must be a JSON object'] })
    // No amount means the full amount of the payment; a refund can never take it past the charge.
    const given = isObject(body) ? body.amount : undefined
    const amount = given === undefined || given === null ? payment.amount : given
    if (!Number.isInteger(amount) || (amount as number) < 1) return invalid({ amount: ['must be a positive integer'] })
    if (payment.status !== 'paid' && payment.status !== 'captured' && payment.status !== 'refunded') {
      return invalid({ status: [`a ${payment.status} payment cannot be refunded`] })
    }
    if (payment.status === 'refunded' && config.refuseSecondRefund) return invalid({ status: ['the payment is already refunded'] })
    if (payment.refunded + (amount as number) > payment.amount) return invalid({ amount: ['Refund amount cannot exceed the charged amount'] })
    const now = new Date().toISOString()
    payment.refunded += amount as number
    payment.refunded_at = now
    payment.updated_at = now
    if (payment.refunded === payment.amount || !config.partialRefundKeepsPaid) payment.status = 'refunded'
    return { status: 200, body: paymentOut(payment) }
  }

  const routes: Route[] = [
    { method: 'POST', pattern: /^\/v1\/invoices$/, key: 'POST /v1/invoices', run: ({ body }) => createInvoice(body) },
    { method: 'GET', pattern: /^\/v1\/invoices$/, key: 'GET /v1/invoices', run: ({ query }) => listInvoices(query) },
    {
      method: 'GET',
      pattern: /^\/v1\/invoices\/([^/]+)$/,
      key: 'GET /v1/invoices/:id',
      run: ({ id }) => {
        const inv = invoiceById(id)
        return inv ? { status: 200, body: invoiceOut(inv) } : NOT_FOUND
      },
    },
    { method: 'PUT', pattern: /^\/v1\/invoices\/([^/]+)\/cancel$/, key: 'PUT /v1/invoices/:id/cancel', run: ({ id }) => cancelInvoice(id) },
    { method: 'GET', pattern: /^\/v1\/payments$/, key: 'GET /v1/payments', run: ({ query }) => listPayments(query) },
    {
      method: 'GET',
      pattern: /^\/v1\/payments\/([^/]+)$/,
      key: 'GET /v1/payments/:id',
      run: ({ id }) => {
        const payment = payments.get(id)
        return payment ? { status: 200, body: paymentOut(payment) } : NOT_FOUND
      },
    },
    { method: 'POST', pattern: /^\/v1\/payments\/([^/]+)\/refund$/, key: 'POST /v1/payments/:id/refund', run: ({ id, body }) => refundPayment(id, body) },
  ]
  const routeKeys = new Set(routes.map((route) => route.key))

  function authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? ''
    if (!/^basic /i.test(header)) return false
    const decoded = Buffer.from(header.slice('basic '.length), 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    // The key is the user name and the password stays empty.
    return colon >= 0 && decoded.slice(colon + 1) === '' && secretsMatch(decoded.slice(0, colon), secretKey)
  }

  function takeFault(route: string): EmulatorFault | null {
    const fault = faults.find((entry) => entry.route === route)
    if (!fault) return null
    fault.times -= 1
    faults = faults.filter((entry) => entry.times > 0)
    return fault
  }

  function answer(res: ServerResponse, call: EmulatorCall, reply: Reply): void {
    call.status = reply.status
    json(res, reply.status, reply.body)
  }

  async function api(req: IncomingMessage, res: ServerResponse, method: string, pathname: string, query: URLSearchParams): Promise<void> {
    let route: Route | undefined
    let id = ''
    for (const candidate of routes) {
      const match = candidate.method === method ? candidate.pattern.exec(pathname) : null
      if (match) {
        route = candidate
        id = match[1] ?? ''
        break
      }
    }
    const text = await readBody(req)
    if (text === null) return
    let body: unknown
    try {
      body = text === '' ? undefined : JSON.parse(text)
    } catch {
      body = NOT_JSON
    }
    const call: EmulatorCall = {
      method,
      path: pathname,
      route: route?.key ?? `${method} ${pathname}`,
      query: Object.fromEntries(query),
      body: body === NOT_JSON ? text : body,
      status: null,
      fault: null,
    }
    calls.push(call)
    if (!authorized(req)) return answer(res, call, UNAUTHORIZED)
    if (!route) return answer(res, call, NOT_FOUND)

    const matched = route
    const run = (): Reply => matched.run({ id, query, body })
    const fault = takeFault(matched.key)
    if (fault) {
      call.fault = fault.mode
      if (fault.mode === '500') return answer(res, call, { status: 500, body: { type: 'api_error', message: 'Internal server error', errors: null } })
      if (fault.mode === '429') return answer(res, call, { status: 429, body: { type: 'rate_limit_error', message: 'Too many requests', errors: null } })
      if (fault.mode === 'timeout') return hang(req.socket)
      if (fault.mode === 'drop_after_commit') {
        run()
        return void req.socket.destroy()
      }
      if (fault.mode === 'commit_after_delay') {
        req.socket.destroy()
        later(fault.delayMs, () => {
          try {
            run()
          } catch {
            // The client was already cut off; there is nobody to tell.
          }
        })
        return
      }
    }
    answer(res, call, run())
  }

  /** Never answers; the socket is destroyed after a long delay, or sooner when the client gives up. */
  function hang(socket: Socket): void {
    const timer = later(FAULT_HANG_MS, () => socket.destroy())
    socket.once('close', () => {
      clearTimeout(timer)
      timers.delete(timer)
    })
  }

  // ---- the stand-in for the hosted invoice page ------------------------------------

  async function standIn(req: IncomingMessage, res: ServerResponse, method: string, id: string, action: boolean, query: URLSearchParams): Promise<void> {
    const inv = invoiceById(id)
    if (!inv) return html(res, 404, shell('الفاتورة غير موجودة', '<p>لا توجد فاتورة بهذا المعرّف.</p>'))
    if (!action) {
      if (method !== 'GET') return html(res, 405, shell('غير مسموح', '<p>الطريقة غير مسموحة.</p>'))
      const pending = payments.get(query.get('payment') ?? '')
      if (pending && pending.invoice_id === inv.id && pending.status === 'initiated') return html(res, 200, challengePage(invoiceOut(inv), pending.id))
      return html(res, 200, invoicePage(invoiceOut(inv)))
    }
    if (method !== 'POST') return html(res, 405, shell('غير مسموح', '<p>الطريقة غير مسموحة.</p>'))

    const text = await readBody(req)
    if (text === null) return
    const form = new URLSearchParams(text)
    const choice = form.get('action')
    const notice = (message: string, status = 200): void => html(res, status, invoicePage(invoiceOut(inv), message))
    const finish = async (payment: PaymentRecord, message: string): Promise<void> => {
      const becamePaid = mirrorInvoice(payment)
      await deliverPayment(payment, inv, becamePaid)
      if (payment.status === 'paid') return inv.success_url ? redirect(res, inv.success_url) : notice('تم الدفع (محاكاة).')
      return notice(message)
    }

    if (choice === 'back') return inv.back_url ? redirect(res, inv.back_url) : notice('لا يوجد عنوان رجوع لهذه الفاتورة.')
    // An invoice past its expiry, canceled or already paid refuses every payment step.
    if (inv.status !== 'initiated') return notice(stateNotice(inv.status), 409)
    if (choice === 'pay') return finish(newPayment(inv, 'paid'), '')
    if (choice === 'fail') return finish(newPayment(inv, 'failed'), 'فشل الدفع: رصيد غير كافٍ (محاكاة). يمكنك المحاولة مرة أخرى.')
    if (choice === '3ds') {
      const payment = newPayment(inv, 'initiated')
      payment.source.transaction_url = `${publicBase}/invoices/${inv.id}?payment=${payment.id}`
      return redirect(res, `/invoices/${inv.id}?payment=${payment.id}`)
    }
    if (choice === 'approve' || choice === 'reject') {
      const payment = payments.get(form.get('payment') ?? '')
      if (!payment || payment.invoice_id !== inv.id || payment.status !== 'initiated') return notice('لا توجد عملية تحقق معلقة.', 400)
      payment.status = choice === 'approve' ? 'paid' : 'failed'
      payment.source.message = choice === 'approve' ? 'APPROVED' : 'DECLINED'
      payment.updated_at = new Date().toISOString()
      return finish(payment, 'فشل التحقق من 3-D Secure (محاكاة). يمكنك المحاولة مرة أخرى.')
    }
    return notice('إجراء غير معروف.', 400)
  }

  // ---- the control routes of the harness ---------------------------------------------

  const bad = (error: string, status = 400): Reply => ({ status, body: { error } })
  const positiveInt = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0

  async function harnessPay(body: Json): Promise<Reply> {
    const inv = typeof body.invoiceId === 'string' ? invoiceById(body.invoiceId) : undefined
    if (!inv) return bad('invoice not found', 404)
    if (typeof body.status !== 'string' || !PAYMENT_STATUSES.has(body.status)) return bad('status must be a documented payment status')
    if (body.amount !== undefined && !positiveInt(body.amount)) return bad('amount must be a positive integer')
    if (body.currency !== undefined && (typeof body.currency !== 'string' || body.currency === '')) return bad('currency must be a non-empty string')
    if (body.force !== undefined && typeof body.force !== 'boolean') return bad('force must be a boolean')
    // Like the page, an invoice that is expired, canceled or already paid refuses payment; `force` is how a test makes a
    // late or a second payment on purpose.
    if (inv.status !== 'initiated' && body.force !== true) return bad(`the invoice is ${inv.status}; send force: true to pay it anyway`, 409)
    const payment = newPayment(inv, body.status, body.amount as number | undefined, body.currency as string | undefined)
    const becamePaid = mirrorInvoice(payment)
    const sent = await deliverPayment(payment, inv, becamePaid)
    return { status: 200, body: { payment: paymentOut(payment), invoice: invoiceOut(inv), deliveries: sent } }
  }

  function harnessPayment(body: Json): Reply {
    const payment = typeof body.paymentId === 'string' ? payments.get(body.paymentId) : undefined
    if (!payment) return bad('payment not found', 404)
    const { status, refunded } = body
    if (status !== undefined && (typeof status !== 'string' || !PAYMENT_STATUSES.has(status))) return bad('status must be a documented payment status')
    if (refunded !== undefined && (!Number.isInteger(refunded) || (refunded as number) < 0 || (refunded as number) > payment.amount)) {
      return bad('refunded must be an integer from 0 to the payment amount')
    }
    const now = new Date().toISOString()
    if (refunded !== undefined) {
      payment.refunded = refunded as number
      payment.refunded_at = payment.refunded > 0 ? now : null
    }
    if (typeof status === 'string') {
      payment.status = status
      if (status === 'voided') payment.voided_at = now
      if (status === 'captured') {
        payment.captured = payment.amount
        payment.captured_at = now
      }
    } else if (refunded !== undefined && payment.refunded > 0 && (payment.refunded === payment.amount || !config.partialRefundKeepsPaid)) {
      payment.status = 'refunded'
    }
    payment.updated_at = now
    mirrorInvoice(payment)
    return { status: 200, body: { payment: paymentOut(payment) } }
  }

  function harnessInvoice(body: Json): Reply {
    const inv = typeof body.invoiceId === 'string' ? invoiceById(body.invoiceId) : undefined
    if (!inv) return bad('invoice not found', 404)
    const { status, expiredAt } = body
    if (status !== undefined && (typeof status !== 'string' || !INVOICE_STATUSES.has(status))) return bad('status must be a documented invoice status')
    if (expiredAt !== undefined && expiredAt !== null && (typeof expiredAt !== 'string' || !ISO_DATE_TIME.test(expiredAt))) {
      return bad('expiredAt must be null or an ISO 8601 date and time')
    }
    if (typeof status === 'string') inv.status = status
    if (expiredAt !== undefined) inv.expired_at = expiredAt as string | null
    inv.updated_at = new Date().toISOString()
    return { status: 200, body: { invoice: invoiceOut(inv) } }
  }

  async function harnessWebhook(body: Json): Promise<Reply> {
    const url = config.webhookUrl
    if (!url) return bad('webhookUrl is not configured')
    const { type, paymentId, secretToken, live, eventId, times } = body
    if (typeof type !== 'string' || type === '') return bad('type is required')
    if (paymentId !== undefined && typeof paymentId !== 'string') return bad('paymentId must be a string')
    if (secretToken !== undefined && typeof secretToken !== 'string') return bad('secretToken must be a string')
    if (live !== undefined && typeof live !== 'boolean') return bad('live must be a boolean')
    if (eventId !== undefined && (typeof eventId !== 'string' || eventId === '')) return bad('eventId must be a non-empty string')
    if (times !== undefined && (!positiveInt(times) || times > 20)) return bad('times must be an integer from 1 to 20')
    // The payment may be one the emulator does not hold (another account, a forged id); then only its id is sent.
    const held = typeof paymentId === 'string' ? payments.get(paymentId) : undefined
    const data = held ? paymentOut(held) : typeof paymentId === 'string' ? { id: paymentId } : {}
    const id = eventId ?? randomUUID()
    const event = webhookBody(type, id, secretToken ?? config.webhookSecret, live ?? config.live, data)
    const sent: EmulatorDelivery[] = []
    for (let count = 0; count < (times ?? 1); count += 1) sent.push(await post('webhook', url, event, { type, eventId: id }))
    return { status: 200, body: { eventId: id, deliveries: sent } }
  }

  function harnessFault(body: Json): Reply {
    const { route, mode, times, delayMs } = body
    if (typeof route !== 'string' || !routeKeys.has(route)) return bad(`route must be one of: ${[...routeKeys].join(', ')}`)
    if (typeof mode !== 'string' || !FAULT_MODES.has(mode)) return bad(`mode must be one of: ${[...FAULT_MODES].join(', ')}`)
    if (times !== undefined && !positiveInt(times)) return bad('times must be a positive integer')
    if (delayMs !== undefined && (!Number.isInteger(delayMs) || (delayMs as number) < 0)) return bad('delayMs must be a non-negative integer')
    faults.push({ route, mode, times: times ?? 1, delayMs: (delayMs as number | undefined) ?? 0 })
    return { status: 200, body: { faults } }
  }

  function setConfig(patch: Json): Reply {
    const failure = applyConfig(patch)
    return failure ? bad(failure) : { status: 200, body: { ...config } }
  }

  function state(): EmulatorState {
    return {
      invoices: [...invoices.values()].map(invoiceOut),
      payments: [...payments.values()].map(paymentOut),
      calls: structuredClone(calls),
      deliveries: structuredClone(deliveries),
      faults: structuredClone(faults),
    }
  }

  function reset(): void {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    deliveryAbort.abort()
    deliveryAbort = new AbortController()
    invoices.clear()
    payments.clear()
    calls.length = 0
    deliveries.length = 0
    faults = []
    Object.assign(config, initial)
  }

  async function harness(req: IncomingMessage, res: ServerResponse, method: string, pathname: string): Promise<void> {
    // Every control POST must say it is JSON, an empty one too. A page open in the developer's browser can send any other
    // type (or none, with no body) without asking first, but JSON only after a CORS preflight, which this server never
    // grants. With the Host and Origin check in onRequest, no foreign page can drive the harness.
    if (method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      return json(res, 415, bad('send the body as application/json').body)
    }
    const text = await readBody(req)
    if (text === null) return
    let body: unknown = {}
    try {
      if (text.trim() !== '') body = JSON.parse(text)
    } catch {
      body = null
    }
    if (!isObject(body)) return json(res, 400, bad('the body must be a JSON object').body)
    const key = `${method} ${pathname}`
    let reply: Reply
    if (key === 'POST /__emulator/pay') reply = await harnessPay(body)
    else if (key === 'POST /__emulator/payment') reply = harnessPayment(body)
    else if (key === 'POST /__emulator/invoice') reply = harnessInvoice(body)
    else if (key === 'POST /__emulator/webhook') reply = await harnessWebhook(body)
    else if (key === 'POST /__emulator/fault') reply = harnessFault(body)
    else if (key === 'POST /__emulator/config') reply = setConfig(body)
    else if (key === 'POST /__emulator/reset') {
      reset()
      reply = { status: 200, body: { ok: true } }
    } else if (key === 'GET /__emulator/state') reply = { status: 200, body: state() }
    else reply = bad('not found', 404)
    json(res, reply.status, reply.body)
  }

  // ---- the server ----------------------------------------------------------------------

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method ?? 'GET'
      const target = req.url ?? '/'
      const at = target.indexOf('?')
      const pathname = at < 0 ? target : target.slice(0, at)
      const query = new URLSearchParams(at < 0 ? '' : target.slice(at + 1))
      if (pathname === '/v1' || pathname.startsWith('/v1/')) return await api(req, res, method, pathname, query)
      // Everything below is the harness, not Moyasar: loopback and private peers only, and no foreign web page.
      if (!isLocalPeer(req.socket.remoteAddress) || !isLocalRequest(req)) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden')
      if (pathname.startsWith('/__emulator/')) return await harness(req, res, method, pathname)
      const page = /^\/invoices\/([^/]+?)(\/action)?$/.exec(pathname)
      if (page) return await standIn(req, res, method, page[1] ?? '', page[2] !== undefined, query)
      return json(res, 404, bad('not found').body)
    } catch (error) {
      if (res.headersSent) res.destroy()
      else json(res, 500, { type: 'api_error', message: error instanceof Error ? error.message : 'Emulator error', errors: null })
    }
  }

  const server = createServer((req, res) => {
    void onRequest(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(wantedPort, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  publicBase = (wantedBase ?? `http://127.0.0.1:${port}`).replace(/\/+$/, '')

  return {
    url: `http://${host}:${port}`,
    port,
    server,
    state,
    reset,
    config(patch = {}) {
      const failure = applyConfig(patch)
      if (failure) throw new Error(failure)
      return { ...config }
    },
    async close() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      deliveryAbort.abort()
      if (!server.listening) return
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}

// `pnpm emulator`: listens on the port the local stack's functions expect (supabase/functions/.env).
if (import.meta.main) {
  startEmulator({ port: STANDALONE_PORT, webhookUrl: LOCAL_WEBHOOK_URL }).then(
    (emulator) => {
      console.log(`Moyasar emulator (local test harness, no real payment) listening on ${emulator.url}`)
      const stop = (): void => void emulator.close().then(() => process.exit(0))
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'The Moyasar emulator could not start.')
      process.exit(1)
    },
  )
}
