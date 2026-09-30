// P07: the cart's pure storage logic (src/lib/cart.ts) — the localStorage
// format and its guards (DATA "Checkout transaction" step 1), the
// storage-denied fallback, and the create-request fingerprint that decides
// when the idempotency key is reused.
import { randomUUID } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addLine,
  cartCount,
  cartArea,
  CART_EVENT,
  CART_STORAGE_KEY,
  clearIdempotency,
  DEDICATIONS_KEY,
  digestText,
  EMPTY_CART,
  readIdempotency,
  writeIdempotency,
  fingerprintCreate,
  MAX_LINES,
  MAX_QUANTITY,
  parseCart,
  readCart,
  removeLine,
  removeLines,
  serializeCart,
  setDedication,
  setQuantity,
  toApiLines,
  writeCart,
  type CartArea,
  type CartV1,
} from '../../src/lib/cart'

const VARIANT_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const VARIANT_B = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e'
const VARIANT_C = '2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f'

/** A recording in-memory Storage stand-in. */
function memoryArea(): CartArea & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
}

function cart(variantIds: string[], quantity = 1): CartV1 {
  return { version: 1, lines: variantIds.map((variantId) => ({ variantId, quantity })) }
}

describe('parseCart', () => {
  it('round-trips a serialized cart', () => {
    const stored = serializeCart(cart([VARIANT_A, VARIANT_B], 2))
    expect(parseCart(stored)).toEqual(cart([VARIANT_A, VARIANT_B], 2))
  })

  it('discards malformed input', () => {
    expect(parseCart(null)).toBeNull()
    expect(parseCart('')).toBeNull()
    expect(parseCart('not json')).toBeNull()
    expect(parseCart('[]')).toBeNull()
    expect(parseCart('{"version":1}')).toBeNull()
    expect(parseCart('{"version":1,"lines":"x"}')).toBeNull()
    expect(parseCart('{"version":1,"lines":[{"variantId":"nope","quantity":1}]}')).toBeNull()
    expect(parseCart(`{"version":1,"lines":[{"variantId":"${VARIANT_A}","quantity":0}]}`)).toBeNull()
    expect(parseCart(`{"version":1,"lines":[{"variantId":"${VARIANT_A}","quantity":21}]}`)).toBeNull()
    expect(parseCart(`{"version":1,"lines":[{"variantId":"${VARIANT_A}","quantity":1.5}]}`)).toBeNull()
    expect(parseCart(`{"version":1,"lines":[{"variantId":"${VARIANT_A}","quantity":1,"dedication":5}]}`)).toBeNull()
  })

  it('discards another version instead of migrating it', () => {
    expect(parseCart('{"version":2,"lines":[]}')).toBeNull()
    expect(parseCart(`{"version":2,"lines":[{"variantId":"${VARIANT_A}","quantity":1}]}`)).toBeNull()
  })

  it('accepts upper-case variant ids, stored lower-case', () => {
    expect(parseCart(`{"version":1,"lines":[{"variantId":"${VARIANT_A.toUpperCase()}","quantity":3}]}`)).toEqual(
      cart([VARIANT_A], 3),
    )
  })
})

describe('addLine and the caps', () => {
  it('merges a duplicate variant line, capped at 20', () => {
    const withA = addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 15 })
    expect(withA.lines).toEqual([{ variantId: VARIANT_A, quantity: 15 }])
    const merged = addLine(withA, { variantId: VARIANT_A, quantity: 10 })
    expect(merged.lines).toEqual([{ variantId: VARIANT_A, quantity: MAX_QUANTITY }])
  })

  it('caps a single absurd quantity at 20', () => {
    expect(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 99 }).lines).toEqual([
      { variantId: VARIANT_A, quantity: MAX_QUANTITY },
    ])
  })

  it('keeps at most 50 lines', () => {
    let current = EMPTY_CART
    for (let index = 0; index < MAX_LINES + 5; index += 1) {
      current = addLine(current, { variantId: randomUUID(), quantity: 1 })
    }
    expect(current.lines.length).toBe(MAX_LINES)
  })

  it('trims a dedication to 200 characters', () => {
    const withLine = addLine(EMPTY_CART, { variantId: VARIANT_C, quantity: 1, dedication: 'ه'.repeat(300) })
    expect(withLine.lines[0]!.dedication?.length).toBe(200)
  })
})

describe('mutations', () => {
  it('sets and clamps a quantity', () => {
    const base = addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 3 })
    expect(setQuantity(base, VARIANT_A, 30).lines[0]!.quantity).toBe(MAX_QUANTITY)
    expect(setQuantity(base, VARIANT_A, 0).lines[0]!.quantity).toBe(1)
  })

  it('removes one line and several lines', () => {
    const base = addLine(addLine(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 1 }), { variantId: VARIANT_B, quantity: 2 }), { variantId: VARIANT_C, quantity: 3 })
    expect(removeLine(base, VARIANT_B).lines.map((l) => l.variantId)).toEqual([VARIANT_A, VARIANT_C])
    expect(removeLines(base, [VARIANT_A, VARIANT_C]).lines.map((l) => l.variantId)).toEqual([VARIANT_B])
  })

  it('sets a dedication and counts items', () => {
    const base = addLine(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 2 }), { variantId: VARIANT_B, quantity: 3 })
    expect(setDedication(base, VARIANT_A, 'إهداء').lines[0]!.dedication).toBe('إهداء')
    expect(cartCount(base)).toBe(5)
  })

  it('sends only a non-empty dedication to the API', () => {
    const base = addLine(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 1 }), { variantId: VARIANT_B, quantity: 1, dedication: '  ' })
    expect(toApiLines(base.lines)).toEqual([
      { variantId: VARIANT_A, quantity: 1 },
      { variantId: VARIANT_B, quantity: 1 },
    ])
  })
})

describe('storage', () => {
  it('persists through a working storage area and discards a malformed value', () => {
    const area = memoryArea()
    expect(readCart(area)).toEqual({ cart: EMPTY_CART, persistent: true })
    writeCart(cart([VARIANT_A], 2), area)
    expect(area.store.get(CART_STORAGE_KEY)).toBe(serializeCart(cart([VARIANT_A], 2)))
    expect(readCart(area)).toEqual({ cart: cart([VARIANT_A], 2), persistent: true })
    area.store.set(CART_STORAGE_KEY, '{"version":9,"lines":[]}')
    expect(readCart(area)).toEqual({ cart: EMPTY_CART, persistent: true })
    expect(area.store.has(CART_STORAGE_KEY)).toBe(false)
  })

  it('falls back to memory when storage is denied (persistent false, nothing thrown)', () => {
    expect(cartArea()).toBeNull() // no window in the unit-test environment
    const denied = readCart(null)
    expect(denied.persistent).toBe(false)
    expect(writeCart(cart([VARIANT_A], 4), null)).toBe(false)
    expect(readCart(null)).toEqual({ cart: cart([VARIANT_A], 4), persistent: false })
  })

  it('falls back to memory when setItem throws mid-session', () => {
    const throwing: CartArea = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined,
    }
    expect(writeCart(cart([VARIANT_B], 1), throwing)).toBe(false)
    expect(readCart(null).cart).toEqual(cart([VARIANT_B], 1))
  })
})

describe('audit fixes: dedications, stale storage, the kept key', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the dedication when the same variant is added again', () => {
    const typed = setDedication(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 1 }), VARIANT_A, 'إلى أمي')
    expect(addLine(typed, { variantId: VARIANT_A, quantity: 1 }).lines).toEqual([
      { variantId: VARIANT_A, quantity: 2, dedication: 'إلى أمي' },
    ])
    expect(addLine(typed, { variantId: VARIANT_A, quantity: 1, dedication: 'جديد' }).lines[0]!.dedication).toBe('جديد')
  })

  it('turns pasted control characters into spaces', () => {
    const base = addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 1 })
    expect(setDedication(base, VARIANT_A, 'إلى\tأمي\nمع الحب').lines[0]!.dedication).toBe('إلى أمي مع الحب')
  })

  it('reads the memory cart while a write has failed on a readable storage, until a write succeeds', () => {
    const stored = memoryArea()
    let full = true
    const flaky: CartArea = {
      getItem: (key) => stored.getItem(key),
      setItem: (key, value) => {
        if (full) throw new Error('quota')
        stored.setItem(key, value)
      },
      removeItem: (key) => stored.removeItem(key),
    }
    writeCart(cart([VARIANT_A]), stored)
    expect(writeCart(cart([VARIANT_A, VARIANT_B]), flaky)).toBe(false)
    expect(readCart(flaky)).toEqual({ cart: cart([VARIANT_A, VARIANT_B]), persistent: false })
    full = false
    expect(writeCart(cart([VARIANT_B]), flaky)).toBe(true)
    expect(readCart(flaky)).toEqual({ cart: cart([VARIANT_B]), persistent: true })
  })

  it('keeps the dedication out of localStorage, restores it from sessionStorage, and announces the write', () => {
    const local = memoryArea()
    const session = memoryArea()
    const fired: string[] = []
    vi.stubGlobal('window', { sessionStorage: session, dispatchEvent: (event: Event) => fired.push(event.type) })
    const typed = setDedication(addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 1 }), VARIANT_A, 'إلى سارة')
    writeCart(typed, local)
    expect(local.store.get(CART_STORAGE_KEY)).not.toContain('dedication')
    expect(local.store.get(CART_STORAGE_KEY)).not.toContain('إلى سارة')
    expect(readCart(local).cart).toEqual(typed)
    expect(fired).toEqual([CART_EVENT])
    writeCart(setDedication(typed, VARIANT_A, ''), local)
    expect(session.store.get(DEDICATIONS_KEY)).toBe('{}')
  })

  it('keeps the idempotency key and a digest of the request, never the request', () => {
    const session = memoryArea()
    vi.stubGlobal('window', { sessionStorage: session })
    expect(digestText('buyer@example.com')).toMatch(/^[0-9a-f]{16}$/)
    expect(digestText('a')).toBe(digestText('a'))
    expect(digestText('a')).not.toBe(digestText('b'))
    writeIdempotency({ digest: digestText('a'), key: VARIANT_A })
    expect(readIdempotency()).toEqual({ digest: digestText('a'), key: VARIANT_A })
    clearIdempotency()
    expect(readIdempotency()).toBeNull()
  })
})

describe('fingerprintCreate', () => {
  const core = {
    lines: [{ variantId: VARIANT_A, quantity: 2 }],
    cityKey: 'tabuk',
    address: 'شارع الأول',
    couponCode: 'demo10',
    email: 'Buyer@Example.com',
    name: 'مشترٍ',
    phone: '0501234567',
    policyRevisions: { store: 1, delivery: 1 },
    quoteHash: 'a'.repeat(64),
  }

  it('is equal for equal requests, whatever the key order', () => {
    expect(fingerprintCreate(core)).toBe(
      fingerprintCreate({
        quoteHash: core.quoteHash,
        policyRevisions: { delivery: 1, store: 1 },
        phone: core.phone,
        name: core.name,
        email: core.email,
        couponCode: core.couponCode,
        address: core.address,
        cityKey: core.cityKey,
        lines: core.lines,
      }),
    )
  })

  it('changes when any field the buyer confirmed changes', () => {
    const base = fingerprintCreate(core)
    expect(fingerprintCreate({ ...core, quoteHash: 'b'.repeat(64) })).not.toBe(base)
    expect(fingerprintCreate({ ...core, lines: [{ variantId: VARIANT_A, quantity: 3 }] })).not.toBe(base)
    expect(fingerprintCreate({ ...core, cityKey: 'riyadh' })).not.toBe(base)
    expect(fingerprintCreate({ ...core, address: 'شارع الثاني' })).not.toBe(base)
    expect(fingerprintCreate({ ...core, couponCode: undefined })).not.toBe(base)
    expect(fingerprintCreate({ ...core, email: 'other@example.com' })).not.toBe(base)
    expect(fingerprintCreate({ ...core, name: 'اسم آخر' })).not.toBe(base)
    expect(fingerprintCreate({ ...core, phone: undefined })).not.toBe(base)
    expect(fingerprintCreate({ ...core, policyRevisions: { store: 2, delivery: 1 } })).not.toBe(base)
  })

  it('ignores equivalent spellings the function normalizes away', () => {
    expect(fingerprintCreate({ ...core, couponCode: '  demo10  ' })).toBe(fingerprintCreate(core))
    expect(fingerprintCreate({ ...core, email: 'buyer@example.com ' })).toBe(fingerprintCreate(core))
    expect(fingerprintCreate({ ...core, lines: [{ variantId: VARIANT_A.toUpperCase(), quantity: 2 }] })).toBe(
      fingerprintCreate(core),
    )
  })

  it('never includes the Turnstile token or the keys', () => {
    // The extra per-attempt fields are passed in: the fingerprint must not move.
    const withExtras = fingerprintCreate({ ...core, turnstileToken: 'XXXX.T', idempotencyKey: 'k' } as never)
    expect(withExtras).toBe(fingerprintCreate(core))
    expect(withExtras).not.toContain('XXXX')
    expect(withExtras).not.toContain('turnstile')
    expect(withExtras).not.toContain('idempotency')
    expect(withExtras.length).toBeGreaterThan(0)
  })
})
