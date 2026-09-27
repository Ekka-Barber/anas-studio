/**
 * The buyer's cart (P07, DATA "Checkout transaction" step 1): pure storage
 * logic with no React, unit-tested in tests/unit/cart.test.ts.
 *
 * localStorage holds `anasaq:cart:v1` and nothing else:
 * `{ "version": 1, "lines": [{ "variantId": uuid, "quantity": 1..20,
 * "dedication"?: string }] }` — never a price, a total, a name or an address;
 * prices come from the live `quote` only. A malformed value or another
 * version is discarded. Duplicate variant lines merge with the quantity
 * capped at 20, and a cart holds at most 50 lines. When localStorage throws,
 * the cart lives in memory for the tab and the UI shows the honest note.
 */
export const CART_STORAGE_KEY = 'anasaq:cart:v1'
export const CHECKOUT_SESSION_KEY = 'anasaq:checkout-session'
export const PENDING_ORDER_KEY = 'anasaq:pending-order'
export const CITY_KEY = 'anasaq:city'
export const COUPON_KEY = 'anasaq:coupon'

export const MAX_LINES = 50
export const MAX_QUANTITY = 20
export const MAX_DEDICATION = 200

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
  return JSON.stringify({ version: 1, lines: cart.lines })
}

// ---------------------------------------------------------------------------
// Pure mutations (always return a fresh CartV1)
// ---------------------------------------------------------------------------

function clampQuantity(quantity: number): number {
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)))
}

/** Adds a line, merging a duplicate variant and capping quantity and line count. */
export function addLine(cart: CartV1, line: CartLine): CartV1 {
  const variantId = line.variantId.toLowerCase()
  if (!UUID.test(variantId)) return cart
  const quantity = clampQuantity(line.quantity)
  const dedication = line.dedication?.slice(0, MAX_DEDICATION)
  const existing = cart.lines.find((l) => l.variantId === variantId)
  if (existing) {
    return {
      version: 1,
      lines: cart.lines.map((l) =>
        l.variantId === variantId
          ? {
              variantId,
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

export function setDedication(cart: CartV1, variantId: string, dedication: string): CartV1 {
  const id = variantId.toLowerCase()
  return {
    version: 1,
    lines: cart.lines.map((l) =>
      l.variantId === id ? { ...l, dedication: dedication.slice(0, MAX_DEDICATION) } : l,
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

/** localStorage when it works, null when it throws (private mode, blocked, no window). */
export function cartArea(): CartArea {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readCart(area: CartArea = cartArea()): { cart: CartV1; persistent: boolean } {
  if (area === null) return { cart: memoryCart, persistent: false }
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
    return { cart: parsed, persistent: true }
  } catch {
    return { cart: memoryCart, persistent: false }
  }
}

/** Persists the cart; false means it only lives in memory for this tab. */
export function writeCart(cart: CartV1, area: CartArea = cartArea()): boolean {
  if (area === null) {
    memoryCart = cart
    return false
  }
  try {
    area.setItem(CART_STORAGE_KEY, serializeCart(cart))
    return true
  } catch {
    memoryCart = cart
    return false
  }
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

/** The pending order this tab created, in sessionStorage only (survives reload, never localStorage). */
export function readPendingOrder(): PendingOrder | null {
  const raw = readSessionValue(PENDING_ORDER_KEY)
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as { orderNumber?: unknown; accessToken?: unknown }
    if (
      typeof parsed.orderNumber === 'string' &&
      typeof parsed.accessToken === 'string' &&
      /^[2-9A-HJ-NP-Z]{8}$/.test(parsed.orderNumber) &&
      /^[A-Za-z0-9_-]{43}$/.test(parsed.accessToken)
    ) {
      return { orderNumber: parsed.orderNumber, accessToken: parsed.accessToken }
    }
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
