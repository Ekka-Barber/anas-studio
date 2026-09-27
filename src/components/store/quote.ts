/**
 * The `checkout` Edge Function as the browser calls it (P07): the live
 * `quote`, `create` and `cancel` over plain `fetch`, with no
 * `@supabase/supabase-js` on public pages (the public JS budget, D32).
 *
 * The function is public (`verify_jwt = false` in supabase/config.toml) and
 * checks the site Origin itself; the browser's cross-origin POST carries it
 * automatically. Every reply is shape-checked before anything renders, so a
 * malformed reply throws instead of showing nonsense prices. The checks are
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
}

export interface QuoteError {
  code: string
  line?: number
  variantId?: string
  available?: number
  minimum?: number
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
  }>
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
  }
}

function parseOrder(value: unknown): OrderSummary {
  const o = obj(value)
  return {
    id: str(o.id),
    orderNumber: str(o.orderNumber),
    status: str(o.status),
    holdExpiresAt: str(o.holdExpiresAt),
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
      }
    }),
  }
}

/** The parsers under the names the cart and checkout already call. */
export const priceSchema = { parse: parsePrice }
export const quoteSchema = { parse: parseQuote }
export const orderSchema = { parse: parseOrder }

export interface CheckoutError {
  code: string
  message: string
  fields?: { quote?: unknown; policyRevisions?: unknown; fieldErrors?: unknown }
}

/** One checkout action; a rejected fetch means a network failure (caller retries). */
export async function postCheckout<T>(body: unknown): Promise<{ status: number; ok: boolean; data?: T; error?: CheckoutError }> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = (await response.json()) as { ok: boolean; data?: T; error?: CheckoutError }
  return { status: response.status, ok: envelope.ok, data: envelope.data, error: envelope.error }
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
    case 'EMPTY_CART':
      return 'سلتك فارغة.'
    default:
      return 'تحقق من محتويات السلة.'
  }
}

export interface CityRate {
  city_key: string
  name_ar: string
  fee_halalas: number
}

/** The enabled, priced cities anon may read (RLS returns exactly those). */
export async function fetchCities(): Promise<CityRate[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/shipping_rates?select=city_key,name_ar,fee_halalas&order=sort_order,name_ar`,
    { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '' } },
  )
  if (!response.ok) return []
  return list(await response.json(), (entry) => {
    const row = obj(entry)
    return { city_key: str(row.city_key), name_ar: str(row.name_ar), fee_halalas: count(row.fee_halalas) }
  })
}
