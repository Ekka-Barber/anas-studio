// Relative, not `@/`: the unit tests (tests/unit/orders-page.test.ts) import this file, and the unit config has no alias.
import { instantOf, ORDER_NUMBER, pendingOrderOf, readSessionValue, writeSessionValue, type PendingOrder } from './cart'

/**
 * The buyer's order page and the two notification link pages (P08 contract
 * sections 5, 7 and 10), the parts that need no React: the order link in the
 * address, the strict parser of the `orders` function's `get` reply, the words
 * for each state, and the three calls the pages make (`get`, the download's
 * `issue` then `redeem`, and the generic POST every page shares).
 *
 * Nothing here trusts the address or a reply. The address gives two things, the
 * order number and the 43-character token of the link, and only after they match
 * the shapes the function issues; every reply is parsed key by key, and one that
 * has a key too few, a key too many or a value out of its set is refused whole
 * (the page then shows the network sentence), like `quote.ts` for the cart.
 * No `@supabase/supabase-js` and no zod on a public page (the 150 KiB budget, D32).
 */

// ---------------------------------------------------------------------------
// The order link: `/orders#<orderNumber>.<token>`
// ---------------------------------------------------------------------------

/** What this tab keeps of the order link: the number and the token, in sessionStorage only. */
export const ORDER_ACCESS_KEY = 'anasaq:order-access'

export type OrderAccess = PendingOrder

/**
 * The fragment of a mailed order link: the order number (folded to upper case,
 * as the function folds it) and the 43-character base64url token, and nothing
 * else. Anything that does not fit is null.
 */
export function parseOrderFragment(hash: string): OrderAccess | null {
  const parts = hash.replace(/^#/, '').split('.')
  const [orderNumber, accessToken] = parts
  if (parts.length !== 2 || orderNumber === undefined || accessToken === undefined) return null
  return pendingOrderOf({ orderNumber: orderNumber.toUpperCase(), accessToken })
}

/** The order link this tab kept, or null. */
export function readOrderAccess(): OrderAccess | null {
  try {
    return pendingOrderOf(JSON.parse(readSessionValue(ORDER_ACCESS_KEY) ?? '{}') as { orderNumber?: unknown; accessToken?: unknown })
  } catch {
    // An unreadable value is no link.
    return null
  }
}

/** Forgets the link: the function no longer knows the order, or its token has expired. */
export function clearOrderAccess(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(ORDER_ACCESS_KEY)
  } catch {
    // Nothing to clean.
  }
}

/**
 * The address's fragment (without the `#`), taken out of the address bar: path
 * and query stay. A fragment never reaches a server log, and once it is read it
 * must not stay in the URL or reach a Referer. Empty when there is none.
 */
export function takeFragment(): string {
  if (typeof window === 'undefined' || window.location.hash === '') return ''
  const fragment = window.location.hash.slice(1)
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  } catch {
    // The address bar keeps the fragment; the caller has it all the same.
  }
  return fragment
}

/** Moves a good order link from the address into this tab's storage (and out of the address bar); null when the fragment is not one. */
export function takeOrderFragment(): OrderAccess | null {
  const access = parseOrderFragment(takeFragment())
  if (access !== null) writeSessionValue(ORDER_ACCESS_KEY, JSON.stringify(access))
  return access
}

// ---------------------------------------------------------------------------
// The functions, as the browser calls them
// ---------------------------------------------------------------------------

export const LOADING = 'جارٍ تحميل الطلب…'
export const NOT_FOUND = 'لم نجد هذا الطلب، أو انتهت صلاحية رابطه.'
export const LIMIT = 'حاول بعد قليل.'
export const NETWORK = 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.'
export const RECOVERED = 'إن وُجدت طلبات بهذا البريد فسنرسل روابطها إليه.'

export interface FunctionReply<T = unknown> {
  status: number
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}

/** One POST to an Edge Function; a rejected fetch or a reply that is not JSON throws (the caller treats it as a network failure). */
export async function postFunction<T = unknown>(name: 'orders' | 'download' | 'notify', body: unknown): Promise<FunctionReply<T>> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = (await response.json()) as { ok?: unknown; data?: T; error?: { code?: string; message?: string } }
  return { status: response.status, ok: envelope.ok === true, data: envelope.data, error: envelope.error }
}

/** How a reply that is not a success reads: the order is gone (404), a throttle (429), or anything else (the service, the network). */
export type Failure = 'missing' | 'limit' | 'network'

export function failureOf(status: number): Failure {
  return status === 404 ? 'missing' : status === 429 ? 'limit' : 'network'
}

export const FAILURE_SENTENCES: Record<Failure, string> = { missing: NOT_FOUND, limit: LIMIT, network: NETWORK }

/** The words a refused form shows: the function's own message when it sent one, else a short one. */
export function formProblem(reply: FunctionReply): string {
  const message = reply.error?.message
  return typeof message === 'string' && message !== '' ? message : reply.status === 429 ? LIMIT : NETWORK
}

// ---------------------------------------------------------------------------
// The small replies, judged by their exact shape (contract section 7): a success
// that does not say what it should is not read as one.
// ---------------------------------------------------------------------------

/** `return-request`: 201 `{returnId}`. */
export function isFiled(reply: FunctionReply): boolean {
  try {
    return reply.ok && reply.status === 201 && UUID.test(str(exact(reply.data, ['returnId']).returnId))
  } catch {
    return false
  }
}

/** `recover`: 200 `{sent: true}`. */
export function isSent(reply: FunctionReply): boolean {
  try {
    return reply.ok && reply.status === 200 && exact(reply.data, ['sent']).sent === true
  } catch {
    return false
  }
}

/** `confirm` and `unsubscribe`: 200 `{status}`; null for anything else. */
export function notifyStatus(reply: FunctionReply): string | null {
  try {
    return reply.ok && reply.status === 200 ? str(exact(reply.data, ['status']).status) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The reply of `orders` `get`, parsed strictly
// ---------------------------------------------------------------------------

const FULFILLMENTS = ['digital', 'physical', 'signed'] as const
export const ORDER_STATUSES = ['pending_payment', 'paid', 'paid_needs_resolution', 'refunded', 'expired', 'cancelled'] as const
export const PAYMENT_STATES = ['paid', 'needs_resolution', 'refunded', 'pending', 'review', 'expired', 'cancelled'] as const
export const FULFILLMENT_STATES = ['preparing', 'shipped', 'delivered'] as const
export const RETURN_STATES = ['requested', 'approved', 'rejected', 'received', 'refunded'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]
export type PaymentState = (typeof PAYMENT_STATES)[number]
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number]
export type ReturnState = (typeof RETURN_STATES)[number]

export interface OrderLine {
  itemId: string
  title: string
  variantTitle: string
  quantity: number
  fulfillment: (typeof FULFILLMENTS)[number]
  preorder: { shipsOn: string; note: string } | null
  /** What can still be asked back of this line (0: nothing). */
  returnable: number
  state: FulfillmentState | null
  carrier: string | null
  tracking: string | null
  download: { available: boolean; revoked: boolean } | null
}

export interface OrderReturn {
  id: string
  state: ReturnState
  createdAt: string
}

export interface OrderView {
  order: {
    orderNumber: string
    status: OrderStatus
    subtotal: number
    discount: number
    shipping: number
    total: number
    /** Confirmed refunds of the paying payment, in halalas. */
    refunded: number
    testMode: boolean
  }
  payment: { state: PaymentState; invoiceUrl: string | null }
  items: OrderLine[]
  returns: OrderReturn[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Where the buyer may be sent: http(s) only, whatever a reply said. */
const WEB_URL = /^https?:\/\/\S+$/i

function malformed(): never {
  throw new Error('تعذّر قراءة رد الطلب.')
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : malformed()
}
/** An object with exactly the keys it should have: every `required` one, any `optional` one, and no other. */
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const o = obj(value)
  const keys = Object.keys(o)
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) malformed()
  return o
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : malformed()
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : malformed()
}
/** A non-negative integer: halalas or a quantity. */
function count(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : malformed()
}
function list<T>(value: unknown, item: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(item) : malformed()
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : malformed()
}
function shaped(value: unknown, pattern: RegExp): string {
  const text = str(value)
  return pattern.test(text) ? text : malformed()
}
/** An ISO time the browser can read, as the database writes it. */
function instant(value: unknown): string {
  const text = str(value)
  return Number.isNaN(instantOf(text)) ? malformed() : text
}

function parsePreorder(value: unknown): OrderLine['preorder'] {
  if (value === null) return null
  const o = exact(value, ['shipsOn', 'note'])
  return { shipsOn: shaped(o.shipsOn, DATE), note: str(o.note) }
}

/** A line of the order summary: checked, then left out (the items carry what the page shows). */
function checkSummaryLine(value: unknown): void {
  const o = exact(value, ['sku', 'productTitle', 'variantTitle', 'fulfillment', 'quantity', 'unitPrice', 'discount', 'total', 'preorder'])
  str(o.sku)
  str(o.productTitle)
  str(o.variantTitle)
  oneOf(o.fulfillment, FULFILLMENTS)
  count(o.quantity)
  count(o.unitPrice)
  count(o.discount)
  count(o.total)
  parsePreorder(o.preorder)
}

function parseItem(value: unknown): OrderLine {
  const o = exact(
    value,
    ['itemId', 'title', 'variantTitle', 'quantity', 'fulfillment', 'preorder', 'returnable'],
    ['state', 'carrier', 'tracking', 'download'],
  )
  const download = o.download === undefined ? null : exact(o.download, ['available', 'revoked'])
  return {
    itemId: shaped(o.itemId, UUID),
    title: str(o.title),
    variantTitle: str(o.variantTitle),
    quantity: count(o.quantity),
    fulfillment: oneOf(o.fulfillment, FULFILLMENTS),
    preorder: parsePreorder(o.preorder),
    returnable: count(o.returnable),
    state: o.state === undefined ? null : oneOf(o.state, FULFILLMENT_STATES),
    carrier: o.carrier === undefined ? null : str(o.carrier),
    tracking: o.tracking === undefined ? null : str(o.tracking),
    download: download === null ? null : { available: bool(download.available), revoked: bool(download.revoked) },
  }
}

function parseReturn(value: unknown): OrderReturn {
  const o = exact(value, ['id', 'state', 'createdAt'])
  return { id: shaped(o.id, UUID), state: oneOf(o.state, RETURN_STATES), createdAt: instant(o.createdAt) }
}

/** The `data` of a `get` reply: `{order, payment, items, returns}`; throws when anything is missing, unknown or out of its set. */
export function parseOrderView(value: unknown): OrderView {
  const o = exact(value, ['order', 'payment', 'items', 'returns'])
  const order = exact(o.order, [
    'id',
    'orderNumber',
    'status',
    'holdExpiresAt',
    'subtotal',
    'discount',
    'shipping',
    'total',
    'currency',
    'environment',
    'lines',
    'paidAt',
    'refunded',
    'testMode',
  ])
  const payment = exact(o.payment, ['state'], ['invoiceUrl'])
  shaped(order.id, UUID)
  instant(order.holdExpiresAt)
  str(order.currency)
  str(order.environment)
  list(order.lines, checkSummaryLine)
  if (order.paidAt !== null) instant(order.paidAt)
  return {
    order: {
      orderNumber: shaped(order.orderNumber, ORDER_NUMBER),
      status: oneOf(order.status, ORDER_STATUSES),
      subtotal: count(order.subtotal),
      discount: count(order.discount),
      shipping: count(order.shipping),
      total: count(order.total),
      refunded: count(order.refunded),
      testMode: bool(order.testMode),
    },
    payment: {
      state: oneOf(payment.state, PAYMENT_STATES),
      invoiceUrl: payment.invoiceUrl === undefined ? null : shaped(payment.invoiceUrl, WEB_URL),
    },
    items: list(o.items, parseItem),
    returns: list(o.returns, parseReturn),
  }
}

export type OrderOutcome = { view: OrderView } | { failure: Failure }

/** `orders` `get` for the link this tab holds. Never throws: a reply that does not parse is a network failure. */
export async function fetchOrder(access: OrderAccess): Promise<OrderOutcome> {
  try {
    const reply = await postFunction('orders', { action: 'get', orderNumber: access.orderNumber, accessToken: access.accessToken })
    if (reply.ok && reply.data !== undefined) return { view: parseOrderView(reply.data) }
    return { failure: failureOf(reply.status) }
  } catch {
    return { failure: 'network' }
  }
}

// ---------------------------------------------------------------------------
// Words for the states
// ---------------------------------------------------------------------------

export type StatusKind = 'paid' | 'pending' | 'review' | 'refunded' | 'expired' | 'cancelled'

export const STATUS_SENTENCES: Record<StatusKind, string> = {
  paid: 'مدفوع.',
  pending: 'بانتظار الدفع.',
  review: 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.',
  refunded: 'أُعيد مبلغ هذا الطلب.',
  expired: 'انتهت مدة حجز الطلب.',
  cancelled: 'أُلغي الطلب.',
}

/**
 * What an order says of itself, from its status and the payment's state. A
 * payment under review or a refund is said first; «مدفوع» only for an order
 * whose own status is `paid`; a payment the provider may still settle stays
 * «بانتظار الدفع» even after the hold ended (the order's attempt stays open
 * until the job closes it), like the return page.
 */
export function statusKind(status: OrderStatus, payment: PaymentState): StatusKind {
  if (status === 'paid_needs_resolution' || payment === 'needs_resolution' || payment === 'review') return 'review'
  if (status === 'refunded' || payment === 'refunded') return 'refunded'
  if (status === 'paid') return 'paid'
  if (payment === 'pending') return 'pending'
  if (status === 'expired' || payment === 'expired') return 'expired'
  if (status === 'cancelled' || payment === 'cancelled') return 'cancelled'
  return 'pending'
}

export const FULFILLMENT_LABELS: Record<FulfillmentState, string> = {
  preparing: 'قيد التجهيز',
  shipped: 'شُحن',
  delivered: 'سُلّم',
}

export const RETURN_LABELS: Record<ReturnState, string> = {
  requested: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  received: 'استُلم',
  refunded: 'أُعيد المبلغ',
}

/** The line as the buyer knows it: the product, then the variant when it has a name. */
export function lineName(item: Pick<OrderLine, 'title' | 'variantTitle'>): string {
  return [item.title, item.variantTitle].filter((part) => part !== '').join(': ')
}

// ---------------------------------------------------------------------------
// The return request
// ---------------------------------------------------------------------------

export const NOTHING_CHOSEN = 'اختر كمية واحدة على الأقل.'

/** The lines a return can still be asked for. */
export function returnableItems(items: readonly OrderLine[]): OrderLine[] {
  return items.filter((item) => item.returnable > 0)
}

/** A quantity field's text as a whole number from 0 to `max`; anything that is not a number is 0. */
export function clampQuantity(text: string, max: number): number {
  const whole = Math.trunc(Number(text))
  return Number.isFinite(whole) ? Math.min(max, Math.max(0, whole)) : 0
}

/** What `return-request` sends as `items`: only the lines with a quantity, each within what is returnable. */
export function returnRequestItems(items: readonly OrderLine[], texts: Readonly<Record<string, string>>): Array<{ itemId: string; quantity: number }> {
  return returnableItems(items).flatMap((item) => {
    const quantity = clampQuantity(texts[item.itemId] ?? '', item.returnable)
    return quantity > 0 ? [{ itemId: item.itemId, quantity }] : []
  })
}

/** The reason as the function reads it: control characters and runs of white space become one space, and the ends are trimmed. */
export function normalizeReason(text: string): string {
  return text.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// The download: `issue`, then `redeem`
// ---------------------------------------------------------------------------

export const TOO_MANY_DOWNLOADS = 'طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.'
export const DOWNLOAD_FAILED = 'تعذّر تنزيل الملف.'

export type DownloadOutcome = { url: string } | { problem: string; refresh: boolean }

/** A refused call: the daily limit and a throttle say so, a 404 says the file is gone (and the order is worth reading again), the rest is the network. */
function downloadProblem(reply: FunctionReply): DownloadOutcome {
  if (reply.status === 429) return { problem: reply.error?.code === 'TOO_MANY_DOWNLOADS' ? TOO_MANY_DOWNLOADS : LIMIT, refresh: false }
  if (reply.status === 404) return { problem: DOWNLOAD_FAILED, refresh: true }
  return { problem: NETWORK, refresh: false }
}

/**
 * The file link of one line: `download` `issue` with the order's token, then
 * `redeem` with the download token it answers, which yields one 60-second signed
 * URL. Neither the download token nor the URL is kept: they live in this call.
 * Never throws.
 */
export async function requestDownload(access: OrderAccess, itemId: string): Promise<DownloadOutcome> {
  try {
    const issued = await postFunction('download', { action: 'issue', orderNumber: access.orderNumber, accessToken: access.accessToken, itemId })
    if (!issued.ok) return downloadProblem(issued)
    const { downloadToken } = exact(issued.data, ['downloadToken', 'expiresAt'])
    const redeemed = await postFunction('download', { action: 'redeem', downloadToken: shaped(downloadToken, /^[A-Za-z0-9_-]{43}$/) })
    if (!redeemed.ok) return downloadProblem(redeemed)
    return { url: shaped(exact(redeemed.data, ['url']).url, WEB_URL) }
  } catch {
    return { problem: NETWORK, refresh: false }
  }
}
