// Relative, not `@/`: the unit tests (tests/unit/store-checkout.test.ts) import this file, and the unit config has no alias.
import { instantOf, readTestAccess } from '../../lib/cart'
import { formatDate } from '../../lib/format'

/**
 * The `checkout` Edge Function as the browser calls it (P07, P08): the live
 * `quote`, `create`, `pay` and `cancel` over plain `fetch`, and the `payments`
 * function's `verify` for the return page, with no `@supabase/supabase-js` on
 * public pages (the public JS budget, D32).
 *
 * The functions are public (`verify_jwt = false` in supabase/config.toml) and
 * check the site Origin themselves; the browser's cross-origin POST carries it
 * automatically. Every reply is shape-checked before anything renders, so a
 * malformed reply throws instead of showing nonsense prices, and a payment
 * this file does not recognise is never read as paid. The checks are
 * plain functions: the replies come from our own function (the inputs are
 * validated with Zod there, D14), and even `zod/mini` added 24 KiB of gzip
 * to the cart and checkout pages, past the 150 KiB public budget.
 */

const FULFILLMENTS = ['digital', 'physical', 'signed'] as const
type Fulfillment = (typeof FULFILLMENTS)[number]

function malformed(): never {
  throw new Error('تعذّر قراءة رد المتجر.')
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : malformed()
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : malformed()
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : malformed()
}
/** A non-negative integer: halalas, a quantity or a line number. */
function count(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : malformed()
}
function list<T>(value: unknown, item: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(item) : malformed()
}
function fulfillment(value: unknown): Fulfillment {
  return (FULFILLMENTS as readonly unknown[]).includes(value) ? (value as Fulfillment) : malformed()
}

/** A preorder line's delivery date (YYYY-MM-DD) and note, as the buyer was shown them. */
export interface Preorder {
  shipsOn: string
  note: string
}

/**
 * «طلب مسبق: يُسلَّم في 15 أكتوبر 2026»: the words of the product page (built
 * with it), the cart and the checkout summary, the same as the order page's. The
 * date is the Riyadh calendar day, Latin digits.
 */
export function preorderSentence(preorder: Preorder): string {
  return `طلب مسبق: يُسلَّم في ${formatDate(preorder.shipsOn)}`
}

/** The order statuses that mean a payment of the order arrived (a cancel also answers `review`: a charged payment waits for the owner). */
export const RECEIVED = new Set(['paid', 'paid_needs_resolution', 'refunded', 'review'])

export interface QuoteLine {
  line: number
  variantId: string
  productId: string
  productSlug: string
  productTitle: string
  variantTitle: string
  sku: string
  fulfillment: Fulfillment
  unitPrice: number
  quantity: number
  subtotal: number
  discount: number
  total: number
  dedication: string | null
  preorder: Preorder | null
}

export interface QuoteError {
  code: string
  line?: number
  variantId?: string
  available?: number
  minimum?: number
  /** `OUT_OF_STOCK` only: the units exist and another order's unpaid hold takes them (true for at most 20 minutes). */
  held?: boolean
}

export interface Price {
  ok: boolean
  errors: QuoteError[]
  lines: QuoteLine[]
  physical: boolean
  city: { key: string; name: string; fee: number } | null
  coupon: { id: string; code: string; kind: string; discount: number } | null
  subtotal: number
  discount: number
  shipping: number
  total: number
  quoteHash: string
}

export interface Quote extends Price {
  checkoutEnabled: boolean
  policyRevisions: Record<string, number>
  /** The payments run in test mode: no real money moves (P08 contract section 1). */
  testMode: boolean
}

export interface OrderSummary {
  id: string
  orderNumber: string
  status: string
  holdExpiresAt: string
  subtotal: number
  discount: number
  shipping: number
  total: number
  currency: string
  environment: string
  lines: Array<{
    sku: string
    productTitle: string
    variantTitle: string
    fulfillment: Fulfillment
    quantity: number
    unitPrice: number
    discount: number
    total: number
    preorder: Preorder | null
  }>
}

function parsePreorder(value: unknown): Preorder | null {
  if (value === null || value === undefined) return null
  const o = obj(value)
  return { shipsOn: str(o.shipsOn), note: str(o.note) }
}

/** An ISO timestamp the browser can read, such as the hold's end. */
function timestamp(value: unknown): string {
  const text = str(value)
  return Number.isNaN(instantOf(text)) ? malformed() : text
}

function parseLine(value: unknown): QuoteLine {
  const o = obj(value)
  return {
    line: count(o.line),
    variantId: str(o.variantId),
    productId: str(o.productId),
    productSlug: str(o.productSlug),
    productTitle: str(o.productTitle),
    variantTitle: str(o.variantTitle),
    sku: str(o.sku),
    fulfillment: fulfillment(o.fulfillment),
    unitPrice: count(o.unitPrice),
    quantity: count(o.quantity),
    subtotal: count(o.subtotal),
    discount: count(o.discount),
    total: count(o.total),
    dedication: o.dedication === null || o.dedication === undefined ? null : str(o.dedication),
    preorder: parsePreorder(o.preorder),
  }
}

function parseError(value: unknown): QuoteError {
  const o = obj(value)
  return {
    code: str(o.code),
    ...(o.line === undefined ? {} : { line: count(o.line) }),
    ...(o.variantId === undefined ? {} : { variantId: str(o.variantId) }),
    ...(o.available === undefined ? {} : { available: count(o.available) }),
    ...(o.minimum === undefined ? {} : { minimum: count(o.minimum) }),
    ...(o.held === undefined ? {} : { held: bool(o.held) }),
  }
}

function parsePrice(value: unknown): Price {
  const o = obj(value)
  const hash = str(o.quoteHash)
  if (!/^[0-9a-f]{64}$/.test(hash)) malformed()
  const city = o.city === null ? null : obj(o.city)
  const coupon = o.coupon === null ? null : obj(o.coupon)
  return {
    ok: bool(o.ok),
    errors: list(o.errors, parseError),
    lines: list(o.lines, parseLine),
    physical: bool(o.physical),
    city: city && { key: str(city.key), name: str(city.name), fee: count(city.fee) },
    coupon: coupon && { id: str(coupon.id), code: str(coupon.code), kind: str(coupon.kind), discount: count(coupon.discount) },
    subtotal: count(o.subtotal),
    discount: count(o.discount),
    shipping: count(o.shipping),
    total: count(o.total),
    quoteHash: hash,
  }
}

function parseQuote(value: unknown): Quote {
  const o = obj(value)
  const revisions = obj(o.policyRevisions)
  return {
    ...parsePrice(o),
    checkoutEnabled: bool(o.checkoutEnabled),
    policyRevisions: Object.fromEntries(Object.entries(revisions).map(([key, seq]) => [key, count(seq)])),
    testMode: o.testMode === true,
  }
}

function parseOrder(value: unknown): OrderSummary {
  const o = obj(value)
  return {
    id: str(o.id),
    orderNumber: str(o.orderNumber),
    status: str(o.status),
    holdExpiresAt: timestamp(o.holdExpiresAt),
    subtotal: count(o.subtotal),
    discount: count(o.discount),
    shipping: count(o.shipping),
    total: count(o.total),
    currency: str(o.currency),
    environment: str(o.environment),
    lines: list(o.lines, (entry) => {
      const line = obj(entry)
      return {
        sku: str(line.sku),
        productTitle: str(line.productTitle),
        variantTitle: str(line.variantTitle),
        fulfillment: fulfillment(line.fulfillment),
        quantity: count(line.quantity),
        unitPrice: count(line.unitPrice),
        discount: count(line.discount),
        total: count(line.total),
        preorder: parsePreorder(line.preorder),
      }
    }),
  }
}

/** The parsers under the names the cart and checkout already call. */
export const priceSchema = { parse: parsePrice }
export const orderSchema = { parse: parseOrder }

/** Where the buyer may be sent: http(s) only, whatever a reply said. */
const WEB_URL = /^https?:\/\/\S+$/i

/** What `create` and `pay` say about paying an order (P08 contract section 7). */
export type PaymentView =
  | { state: 'ready'; url: string }
  | { state: 'preparing' }
  | { state: 'unavailable' }
  | { state: 'closed'; code: string; status?: string; reason?: string }

/** The `payment` of a `create` or `pay` reply. Anything not recognised is `preparing`: never paid, never closed, never a link to follow. */
export function parsePayment(value: unknown): PaymentView {
  if (typeof value !== 'object' || value === null) return { state: 'preparing' }
  const o = value as Record<string, unknown>
  if (o.state === 'ready' && typeof o.url === 'string' && WEB_URL.test(o.url)) return { state: 'ready', url: o.url }
  if (o.state === 'unavailable') return { state: 'unavailable' }
  if (o.state === 'closed' && typeof o.code === 'string') {
    return {
      state: 'closed',
      code: o.code,
      ...(typeof o.status === 'string' ? { status: o.status } : {}),
      ...(typeof o.reason === 'string' ? { reason: o.reason } : {}),
    }
  }
  return { state: 'preparing' }
}

const VERIFY_STATES = ['paid', 'needs_resolution', 'refunded', 'pending', 'review', 'expired', 'cancelled', 'unknown'] as const
export type VerifyState = (typeof VERIFY_STATES)[number]

/** What the `payments` function's `verify` answers for the return page. */
export interface Verify {
  state: VerifyState
  /** The token this tab sent matched the order. */
  hasToken: boolean
  invoiceUrl: string | null
  testMode: boolean
}

/** A `verify` reply. A state this does not recognise is `pending`: the page keeps asking and never says paid. */
export function parseVerify(value: unknown): Verify {
  const o = obj(value)
  return {
    state: (VERIFY_STATES as readonly unknown[]).includes(o.state) ? (o.state as VerifyState) : 'pending',
    hasToken: o.hasToken === true,
    invoiceUrl: typeof o.invoiceUrl === 'string' && WEB_URL.test(o.invoiceUrl) ? o.invoiceUrl : null,
    testMode: o.testMode === true,
  }
}

export interface CheckoutError {
  code: string
  message: string
  /** `ACTIVE_HOLD` carries `holdExpiresAt` and, for the buyer who made the hold, `order` and `accessToken`. */
  fields?: {
    quote?: unknown
    policyRevisions?: unknown
    fieldErrors?: unknown
    order?: unknown
    accessToken?: unknown
    holdExpiresAt?: unknown
  }
}

type Reply<T> = { status: number; ok: boolean; data?: T; error?: CheckoutError }

async function postFunction<T>(name: string, body: unknown): Promise<Reply<T>> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = (await response.json()) as { ok: boolean; data?: T; error?: CheckoutError }
  return { status: response.status, ok: envelope.ok, data: envelope.data, error: envelope.error }
}

/** The actions that carry the sandbox access code; `cancel` and `verify` have strict schemas that refuse it. */
const WITH_TEST_ACCESS = new Set(['quote', 'create', 'pay'])

/** One checkout action; a rejected fetch means a network failure (caller retries). */
export function postCheckout<T>(body: { action: string; [field: string]: unknown }): Promise<Reply<T>> {
  const testAccess = WITH_TEST_ACCESS.has(body.action) ? readTestAccess() : null
  return postFunction<T>('checkout', testAccess === null ? body : { ...body, testAccess })
}

/** One `payments` action: the return page's `verify`. Same envelope and failure rules as `postCheckout`. */
export function postPayments<T>(body: { action: 'verify'; orderNumber: string; accessToken?: string }): Promise<Reply<T>> {
  return postFunction<T>('payments', body)
}

/** The cart's live price; throws (Arabic message) when the function is unreachable or malformed. */
export async function fetchQuote(input: {
  lines: Array<{ variantId: string; quantity: number; dedication?: string }>
  cityKey?: string
  couponCode?: string
}): Promise<Quote> {
  const reply = await postCheckout<unknown>({ action: 'quote', ...input })
  if (!reply.ok || reply.data === undefined) {
    throw new Error(reply.error?.message ?? 'تعذّر تحديث أسعار السلة.')
  }
  return parseQuote(reply.data)
}

/** The quote's error codes in Arabic, mirroring the function's own REFUSALS messages. */
export function quoteErrorMessage(error: QuoteError): string {
  switch (error.code) {
    case 'OUT_OF_STOCK':
      if (error.held === true) return 'الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.'
      return typeof error.available === 'number'
        ? `الكمية المطلوبة غير متوفرة؛ المتاح: ${error.available}.`
        : 'الكمية المطلوبة غير متوفرة الآن.'
    case 'UNAVAILABLE':
      return 'هذا المنتج غير متاح حاليًا.'
    case 'INVALID_QUANTITY':
      return 'الكمية يجب أن تكون بين 1 و20.'
    case 'CITY_REQUIRED':
      return 'اختر مدينة التوصيل.'
    case 'CITY_UNSUPPORTED':
      return 'لا نوصل إلى هذه المدينة حاليًا.'
    case 'COUPON_INVALID':
      return 'كود الخصم غير صالح.'
    case 'COUPON_MIN_SUBTOTAL':
      return 'قيمة السلة أقل من الحد الأدنى لهذا الكود.'
    case 'COUPON_EXHAUSTED':
      return 'استُنفدت الكمية المتاحة لهذا الكود.'
    case 'COUPON_NOT_APPLICABLE':
      return 'لا ينطبق هذا الكود على منتجات السلة.'
    case 'TOTAL_BELOW_MINIMUM':
      return 'قيمة الطلب أقل من الحد الأدنى للدفع.'
    case 'EMPTY_CART':
      return 'سلتك فارغة.'
    case 'DEDICATION_NOT_ALLOWED':
    case 'INVALID_DEDICATION':
      return 'تحقق من نص الإهداء.'
    default:
      return 'تحقق من محتويات السلة.'
  }
}

export interface CityRate {
  city_key: string
  name_ar: string
  fee_halalas: number
}

/** The enabled, priced cities anon may read (RLS returns exactly those); throws when the list cannot be read, so an empty list means none are served. */
export async function fetchCities(): Promise<CityRate[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/shipping_rates?select=city_key,name_ar,fee_halalas&order=sort_order,name_ar`,
    { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '' } },
  )
  if (!response.ok) throw new Error('تعذّر تحميل قائمة المدن.')
  return list(await response.json(), (entry) => {
    const row = obj(entry)
    return { city_key: str(row.city_key), name_ar: str(row.name_ar), fee_halalas: count(row.fee_halalas) }
  })
}
