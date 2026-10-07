/**
 * The buyer's cart (P07, DATA "Checkout transaction" step 1): pure storage
 * logic with no React, unit-tested in tests/unit/cart.test.ts.
 *
 * localStorage holds `anasaq:cart:v1` and nothing else:
 * `{ "version": 1, "lines": [{ "variantId": uuid, "quantity": 1..20 }] }` —
 * never a price, a total, a name, an address or a dedication (free text lives
 * in sessionStorage as `anasaq:dedications` and goes with the tab); prices
 * come from the live `quote` only. A malformed value or another
 * version is discarded. Duplicate variant lines merge with the quantity
 * capped at 20 (a digital variant's line stays one copy), and a cart holds at
 * most 50 lines. When localStorage throws,
 * the cart lives in memory for the tab and the UI shows the honest note.
 */
export const CART_STORAGE_KEY = 'anasaq:cart:v1'
export const CHECKOUT_SESSION_KEY = 'anasaq:checkout-session'
export const PENDING_ORDER_KEY = 'anasaq:pending-order'
export const CITY_KEY = 'anasaq:city'
export const COUPON_KEY = 'anasaq:coupon'
export const DEDICATIONS_KEY = 'anasaq:dedications'
export const IDEMPOTENCY_KEY = 'anasaq:idempotency'
/** The sandbox access code of a hosted site in test mode (P08 contract section 1), kept for the tab only. */
export const TEST_ACCESS_KEY = 'anasaq:test-access'
/** Fired on `window` after every cart write, so the «السلة (n)» link can refresh. */
export const CART_EVENT = 'anasaq:cart'

export const MAX_LINES = 50
export const MAX_QUANTITY = 20
export const MAX_DEDICATION = 200
/** The longest coupon code the checkout function accepts (its quote and create schemas). */
export const MAX_COUPON = 64

export interface CartLine {
  variantId: string
  quantity: number
  dedication?: string
}

export interface CartV1 {
  version: 1
  lines: CartLine[]
}

export const EMPTY_CART: CartV1 = { version: 1, lines: [] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The shape of an order number, as the checkout function and the SQL accept it. */
export const ORDER_NUMBER = /^[2-9A-HJ-NP-Z]{8}$/

// ---------------------------------------------------------------------------
// Pure parse / serialize
// ---------------------------------------------------------------------------

/** Parses a stored cart; null for malformed input or another version (discard). */
export function parseCart(value: unknown): CartV1 | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const cart = parsed as { version?: unknown; lines?: unknown }
  if (cart.version !== 1 || !Array.isArray(cart.lines)) return null
  const lines: CartLine[] = []
  for (const raw of cart.lines) {
    if (raw === null || typeof raw !== 'object') return null
    const line = raw as Record<string, unknown>
    const variantId = typeof line.variantId === 'string' ? line.variantId.toLowerCase() : null
    if (variantId === null || !UUID.test(variantId)) return null
    if (typeof line.quantity !== 'number' || !Number.isInteger(line.quantity)) return null
    if (line.quantity < 1 || line.quantity > MAX_QUANTITY) return null
    if (line.dedication !== undefined && typeof line.dedication !== 'string') return null
    const dedication =
      typeof line.dedication === 'string' ? line.dedication.slice(0, MAX_DEDICATION) : undefined
    lines.push(dedication === undefined ? { variantId, quantity: line.quantity } : { variantId, quantity: line.quantity, dedication })
  }
  if (lines.length > MAX_LINES) return null
  return { version: 1, lines }
}

export function serializeCart(cart: CartV1): string {
  // The dedication is free text: writeCart keeps it in sessionStorage, never here.
  return JSON.stringify({ version: 1, lines: cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) })
}

// ---------------------------------------------------------------------------
// Pure mutations (always return a fresh CartV1)
// ---------------------------------------------------------------------------

function clampQuantity(quantity: number): number {
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)))
}

/**
 * Adds a line, merging a duplicate variant and capping quantity and line count.
 * A digital variant (`single`) is one copy, since an order grants one file per
 * line and the checkout refuses any other quantity: its line holds 1, and
 * adding it again changes nothing.
 */
export function addLine(cart: CartV1, line: CartLine, single = false): CartV1 {
  const variantId = line.variantId.toLowerCase()
  if (!UUID.test(variantId)) return cart
  const quantity = single ? 1 : clampQuantity(line.quantity)
  const dedication = line.dedication?.slice(0, MAX_DEDICATION)
  const existing = cart.lines.find((l) => l.variantId === variantId)
  if (existing) {
    if (single) return cart
    return {
      version: 1,
      lines: cart.lines.map((l) =>
        l.variantId === variantId
          ? {
              ...l,
              quantity: Math.min(MAX_QUANTITY, l.quantity + quantity),
              ...(dedication !== undefined ? { dedication } : {}),
            }
          : l,
      ),
    }
  }
  if (cart.lines.length >= MAX_LINES) return cart
  const next: CartLine = dedication === undefined ? { variantId, quantity } : { variantId, quantity, dedication }
  return { version: 1, lines: [...cart.lines, next] }
}

export function setQuantity(cart: CartV1, variantId: string, quantity: number): CartV1 {
  const id = variantId.toLowerCase()
  return {
    version: 1,
    lines: cart.lines.map((l) => (l.variantId === id ? { ...l, quantity: clampQuantity(quantity) } : l)),
  }
}

/** Control characters (a pasted tab or line break) become spaces, so the text stays valid for the function. */
export function setDedication(cart: CartV1, variantId: string, dedication: string): CartV1 {
  const id = variantId.toLowerCase()
  return {
    version: 1,
    lines: cart.lines.map((l) =>
      l.variantId === id ? { ...l, dedication: dedication.replace(/\p{Cc}/gu, ' ').slice(0, MAX_DEDICATION) } : l,
    ),
  }
}

export function removeLine(cart: CartV1, variantId: string): CartV1 {
  const id = variantId.toLowerCase()
  return { version: 1, lines: cart.lines.filter((l) => l.variantId !== id) }
}

/** Removes every listed variant (the cart's «إزالة غير المتاح» button). */
export function removeLines(cart: CartV1, variantIds: readonly string[]): CartV1 {
  const ids = new Set(variantIds.map((id) => id.toLowerCase()))
  return { version: 1, lines: cart.lines.filter((l) => !ids.has(l.variantId)) }
}

/** The number of items (sum of quantities), for the «السلة» link. */
export function cartCount(cart: CartV1): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}

/** The lines as the checkout function's Zod schema accepts them. */
export function toApiLines(lines: readonly CartLine[]): Array<{ variantId: string; quantity: number; dedication?: string }> {
  return lines.map((line) => {
    const dedication = line.dedication?.trim()
    return dedication ? { variantId: line.variantId, quantity: line.quantity, dedication } : { variantId: line.variantId, quantity: line.quantity }
  })
}

// ---------------------------------------------------------------------------
// The create-request fingerprint (idempotency-key reuse)
// ---------------------------------------------------------------------------

/** What `create` sends besides the keys and the Turnstile token. */
export interface CreateRequestCore {
  lines: CartLine[]
  cityKey?: string
  address?: string
  couponCode?: string
  email: string
  name: string
  phone?: string
  policyRevisions: Record<string, number>
  quoteHash: string
}

/**
 * The phone `create` sends: the one typed, trimmed, only while the form shows
 * the field (the quote holds a physical or signed line). A digital-only cart
 * sends none, so a number typed before the cart changed is never sent unseen.
 */
export function phoneToSend(physical: boolean, phone: string): string | undefined {
  return physical ? phone.trim() || undefined : undefined
}

/** Deterministic JSON: object keys sorted at every depth, `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Normalized exactly as the Edge Function normalizes `create` (its canonicalJson peer). */
function normalizedCore(core: CreateRequestCore): Record<string, unknown> {
  return {
    lines: core.lines.map((line) => {
      const dedication = line.dedication?.trim()
      return {
        variantId: line.variantId.toLowerCase(),
        quantity: line.quantity,
        ...(dedication ? { dedication } : {}),
      }
    }),
    cityKey: core.cityKey?.trim() || null,
    address: core.address ? core.address.replace(/\s+/g, ' ').trim() || null : null,
    couponCode: core.couponCode?.trim() ? core.couponCode.trim().toUpperCase() : null,
    email: core.email.trim().toLowerCase(),
    name: core.name.trim(),
    phone: core.phone?.trim() || null,
    policyRevisions: core.policyRevisions,
    quoteHash: core.quoteHash,
  }
}

/**
 * A fingerprint of the normalized request the buyer confirmed. The
 * idempotency key is reused only when retrying the identical request (same
 * fingerprint) after a network failure; any change mints a new key. The
 * Turnstile token is not part of the request and never part of this.
 */
export function fingerprintCreate(core: CreateRequestCore): string {
  return canonicalJson(normalizedCore(core))
}

// ---------------------------------------------------------------------------
// Storage bridge: localStorage, with an in-memory fallback when it throws
// ---------------------------------------------------------------------------

/** The three Storage methods the cart needs, or null when storage is denied. */
export type CartArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

/** The tab's memory cart while storage is denied; one per loaded page. */
let memoryCart: CartV1 = EMPTY_CART

/** True after a setItem failed: storage still reads but is stale, so reads use the memory cart until a write succeeds. */
let writeFailed = false

/** localStorage when it works, null when it throws (private mode, blocked, no window). */
export function cartArea(): CartArea {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The dedications typed in this tab, by variant id (sessionStorage only: free text stays out of localStorage). */
function readDedications(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readSessionValue(DEDICATIONS_KEY) ?? 'null')
    if (parsed === null || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, text]) => typeof text === 'string'))
  } catch {
    return {}
  }
}

function withDedications(cart: CartV1): CartV1 {
  const saved = readDedications()
  return {
    version: 1,
    lines: cart.lines.map((l) => {
      const text = saved[l.variantId]
      return l.dedication === undefined && text !== undefined ? { ...l, dedication: text } : l
    }),
  }
}

export function readCart(area: CartArea = cartArea()): { cart: CartV1; persistent: boolean } {
  if (area === null || writeFailed) return { cart: withDedications(memoryCart), persistent: false }
  try {
    const raw = area.getItem(CART_STORAGE_KEY)
    if (raw === null) return { cart: EMPTY_CART, persistent: true }
    const parsed = parseCart(raw)
    if (parsed === null) {
      // Discard the malformed value so the next write starts clean.
      try {
        area.removeItem(CART_STORAGE_KEY)
      } catch {
        // Nothing more can be done; the cart below starts empty either way.
      }
      return { cart: EMPTY_CART, persistent: true }
    }
    return { cart: withDedications(parsed), persistent: true }
  } catch {
    return { cart: withDedications(memoryCart), persistent: false }
  }
}

/** Persists the cart; false means it only lives in memory for this tab. */
export function writeCart(cart: CartV1, area: CartArea = cartArea()): boolean {
  const dedications = cart.lines.flatMap((l): Array<[string, string]> => (l.dedication ? [[l.variantId, l.dedication]] : []))
  writeSessionValue(DEDICATIONS_KEY, JSON.stringify(Object.fromEntries(dedications)))
  let saved = false
  if (area !== null) {
    try {
      area.setItem(CART_STORAGE_KEY, serializeCart(cart))
      saved = true
    } catch {
      // Falls through to the memory cart below.
    }
  }
  if (!saved) memoryCart = cart
  writeFailed = area !== null && !saved
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CART_EVENT))
  return saved
}

/**
 * Applies one line-level change (`setQuantity`, `removeLines`, ...) to the
 * latest stored cart and persists the result. The page's own copy of the cart
 * may be older than storage (another tab added an item), so a change is never
 * written as a whole snapshot of that copy.
 */
export function updateStoredCart(
  change: (cart: CartV1) => CartV1,
  area: CartArea = cartArea(),
): { cart: CartV1; saved: boolean } {
  const next = change(readCart(area).cart)
  return { cart: next, saved: writeCart(next, area) }
}

// ---------------------------------------------------------------------------
// sessionStorage values (city, coupon, checkout session, pending order)
// ---------------------------------------------------------------------------

function sessionArea(): CartArea {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function readSessionValue(key: string): string | null {
  const area = sessionArea()
  if (area === null) return null
  try {
    return area.getItem(key)
  } catch {
    return null
  }
}

export function writeSessionValue(key: string, value: string): void {
  const area = sessionArea()
  if (area === null) return
  try {
    area.setItem(key, value)
  } catch {
    // Keep going without persistence; the page still works.
  }
}

/** A coupon as the buyer typed it, in the form the function compares: trimmed, upper-case, at most 64 characters. */
export function normalizeCoupon(text: string): string {
  return text.trim().toUpperCase().slice(0, MAX_COUPON)
}

/**
 * The coupon kept for this tab. One longer than the function accepts (saved
 * before the input had a cap) fails every quote, so it is dropped here and
 * `tooLong` tells the page to say so.
 */
export function readSavedCoupon(): { coupon: string; tooLong: boolean } {
  const saved = readSessionValue(COUPON_KEY) ?? ''
  if (saved.length <= MAX_COUPON) return { coupon: saved, tooLong: false }
  writeSessionValue(COUPON_KEY, '')
  return { coupon: '', tooLong: true }
}

/** The code of a `#test=<code>` URL fragment, or null for any other fragment. At most 200 characters, the function's own limit. */
export function parseTestFragment(hash: string): string | null {
  const match = /^#test=([^&]+)$/.exec(hash)
  if (match === null) return null
  try {
    const code = decodeURIComponent(match[1]!)
    return code.length <= 200 ? code : null
  } catch {
    return null
  }
}

/**
 * The sandbox fence's browser half: moves a `#test=<code>` fragment into
 * sessionStorage and takes it out of the address bar (path and query stay).
 * A fragment never reaches a server log; the code itself goes nowhere but the
 * `testAccess` field of the checkout calls.
 */
export function readTestFragment(): void {
  if (typeof window === 'undefined') return
  const code = parseTestFragment(window.location.hash)
  if (code === null) return
  writeSessionValue(TEST_ACCESS_KEY, code)
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  } catch {
    // The address bar keeps the fragment; the code is stored all the same.
  }
}

/** The sandbox access code this tab holds, or null. */
export function readTestAccess(): string | null {
  return readSessionValue(TEST_ACCESS_KEY) || null
}

/**
 * The moment of an ISO time as the database writes it (microseconds and an
 * offset), in milliseconds, or NaN. The fraction is cut to milliseconds first:
 * that is the one form every browser's parser is specified to read.
 */
export function instantOf(iso: string): number {
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'))
}

/** A clock time in Riyadh as «14:35» (24-hour, Latin digits), for «محجوز حتى …». */
export function formatRiyadhTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    instantOf(iso),
  )
}

/**
 * The revisions `create` sends (P08 contract section 6): the ones the page's
 * build rendered, for the policies the quote lists and no others. `stale` when
 * the build lacks one of them or holds another revision: the policies are
 * being updated, so the form waits instead of binding a revision the buyer was
 * not shown.
 */
export function builtPolicyRevisions(
  built: Record<string, number>,
  quoted: Record<string, number>,
): { revisions: Record<string, number>; stale: boolean } {
  const revisions: Record<string, number> = {}
  let stale = false
  for (const [id, seq] of Object.entries(quoted)) {
    const mine = Object.hasOwn(built, id) ? built[id] : undefined
    if (mine === undefined) {
      stale = true
      continue
    }
    revisions[id] = mine
    if (mine !== seq) stale = true
  }
  return { revisions, stale }
}

/** Seconds after the return page opened at which it asks `verify`; «تحديث» takes over after the last. */
export const VERIFY_SCHEDULE_SECONDS = [0, 2, 4, 8, 15, 30] as const

/** The order the return page is about, and the token this tab may use for it (null: it holds none). */
export interface ReturnTarget {
  orderNumber: string
  accessToken: string | null
}

/**
 * The return page's order. The number is the `order` query value when its
 * first 8 characters (upper-cased) are an order number, since the payment page
 * may append its own parameters after it; else this tab's stored pending
 * order; else none. The token is the stored order's, and only when its number
 * is the same. Nothing else in the address is read.
 */
export function returnOrder(search: string, stored: PendingOrder | null): ReturnTarget | null {
  const queried = new URLSearchParams(search).get('order')?.slice(0, 8).toUpperCase() ?? ''
  const orderNumber = ORDER_NUMBER.test(queried) ? queried : (stored?.orderNumber ?? null)
  if (orderNumber === null) return null
  return { orderNumber, accessToken: stored?.orderNumber === orderNumber ? stored.accessToken : null }
}

/**
 * What the return page releases once `verify` answers `state`. Every settled
 * state releases this tab's stored order and its key, so the checkout page no
 * longer shows that order: `paid` with the cart that bought it (`cart`), the
 * two review states (`needs_resolution`, `review`), `refunded`, `expired` and
 * `cancelled` keeping the cart (`order`). Null releases nothing (`pending`,
 * `unknown`, a state this page does not know).
 */
export function returnRelease(state: string): 'cart' | 'order' | null {
  if (state === 'paid') return 'cart'
  if (['needs_resolution', 'review', 'refunded', 'expired', 'cancelled'].includes(state)) return 'order'
  return null
}

/** The buyer's checkout session id, one per tab, minted once. */
export function checkoutSession(): string {
  const existing = readSessionValue(CHECKOUT_SESSION_KEY)
  if (existing && UUID.test(existing)) return existing
  const id = crypto.randomUUID()
  writeSessionValue(CHECKOUT_SESSION_KEY, id)
  return id
}

export interface PendingOrder {
  orderNumber: string
  accessToken: string
}

/** An order number and a token in the shapes the function issues, or null (what `ACTIVE_HOLD` hands back, or what storage holds). */
export function pendingOrderOf(value: { orderNumber?: unknown; accessToken?: unknown }): PendingOrder | null {
  if (
    typeof value.orderNumber === 'string' &&
    typeof value.accessToken === 'string' &&
    ORDER_NUMBER.test(value.orderNumber) &&
    /^[A-Za-z0-9_-]{43}$/.test(value.accessToken)
  ) {
    return { orderNumber: value.orderNumber, accessToken: value.accessToken }
  }
  return null
}

/** The pending order this tab created, in sessionStorage only (survives reload, never localStorage). */
export function readPendingOrder(): PendingOrder | null {
  const raw = readSessionValue(PENDING_ORDER_KEY)
  if (typeof raw !== 'string') return null
  try {
    return pendingOrderOf(JSON.parse(raw) as { orderNumber?: unknown; accessToken?: unknown })
  } catch {
    // Fall through: an unreadable value is no pending order.
  }
  return null
}

export function writePendingOrder(order: PendingOrder): void {
  writeSessionValue(PENDING_ORDER_KEY, JSON.stringify(order))
}

export function clearPendingOrder(): void {
  const area = sessionArea()
  if (area === null) return
  try {
    area.removeItem(PENDING_ORDER_KEY)
  } catch {
    // Nothing to clean.
  }
}

// ---------------------------------------------------------------------------
// The idempotency key of the last create request, kept across a reload
// ---------------------------------------------------------------------------

/**
 * A short digest of a string (cyrb53, 53 bits, not cryptographic). The
 * checkout keeps the digest of the confirmed request, never the request: that
 * holds the buyer's email, name, phone and address, which stay out of storage.
 */
export function digestText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** The key and the request digest of the last `create` this tab sent (sessionStorage only), or null. */
export function readIdempotency(): { digest: string; key: string } | null {
  try {
    const parsed = JSON.parse(readSessionValue(IDEMPOTENCY_KEY) ?? 'null') as { digest?: unknown; key?: unknown } | null
    if (typeof parsed?.digest === 'string' && typeof parsed.key === 'string' && UUID.test(parsed.key)) {
      return { digest: parsed.digest, key: parsed.key }
    }
  } catch {
    // An unreadable value is no key.
  }
  return null
}

export function writeIdempotency(value: { digest: string; key: string }): void {
  writeSessionValue(IDEMPOTENCY_KEY, JSON.stringify(value))
}

/** Forgets the key once its order has ended, so the same cart can be ordered again. */
export function clearIdempotency(): void {
  try {
    sessionArea()?.removeItem(IDEMPOTENCY_KEY)
  } catch {
    // Nothing to clean.
  }
}
