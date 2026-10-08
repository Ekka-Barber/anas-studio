// P07: the cart's pure storage logic (src/lib/cart.ts) — the localStorage
// format and its guards (DATA "Checkout transaction" step 1), the
// storage-denied fallback, and the create-request fingerprint that decides
// when the idempotency key is reused. FABLE-AUDIT F3-8 adds the digest of the lines an order was made from, which
// the hold view and the return page compare the cart with.
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addLine,
  cartCount,
  cartArea,
  CART_EVENT,
  CART_STORAGE_KEY,
  clearIdempotency,
  COUPON_KEY,
  DEDICATIONS_KEY,
  digestText,
  EMPTY_CART,
  formatRiyadhTime,
  handedLinesDigest,
  heldOrder,
  instantOf,
  linesDigest,
  orderChanged,
  ORDER_NUMBER,
  OTHER_REQUEST,
  parseTestFragment,
  pendingOrderOf,
  PENDING_ORDER_KEY,
  readIdempotency,
  readPendingOrder,
  readTestAccess,
  readTestFragment,
  TEST_ACCESS_KEY,
  writeIdempotency,
  writePendingOrder,
  fingerprintCreate,
  MAX_COUPON,
  MAX_LINES,
  MAX_QUANTITY,
  normalizeCoupon,
  parseCart,
  readSavedCoupon,
  removeLine,
  removeLines,
  returnOrder,
  serializeCart,
  setDedication,
  setQuantity,
  toApiLines,
  type CartArea,
  type CartV1,
  type PendingOrder,
} from '../../src/lib/cart'

// The storage bridge keeps the tab's memory cart and a write-failed flag in module state, so the three functions that
// read or write it come from a fresh copy of the module in every test: each test passes alone and in any order
// (FABLE-AUDIT T-14). Everything else imported above is pure.
let fresh: typeof import('../../src/lib/cart')
beforeEach(async () => {
  vi.resetModules()
  fresh = await import('../../src/lib/cart')
})
const readCart: typeof fresh.readCart = (...args) => fresh.readCart(...args)
const writeCart: typeof fresh.writeCart = (...args) => fresh.writeCart(...args)
const updateStoredCart: typeof fresh.updateStoredCart = (...args) => fresh.updateStoredCart(...args)
const emptyBoughtCart: typeof fresh.emptyBoughtCart = (...args) => fresh.emptyBoughtCart(...args)

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

  it('keeps a digital line at one copy: a new line holds 1, and adding it again changes nothing', () => {
    const once = addLine(EMPTY_CART, { variantId: VARIANT_A, quantity: 5 }, true)
    expect(once.lines).toEqual([{ variantId: VARIANT_A, quantity: 1 }])
    expect(addLine(once, { variantId: VARIANT_A, quantity: 1 }, true)).toBe(once)
    expect(addLine(once, { variantId: VARIANT_A.toUpperCase(), quantity: 3 }, true)).toBe(once)
    expect(cartCount(addLine(once, { variantId: VARIANT_A, quantity: 1 }, true))).toBe(1)
    // Any other variant still merges, up to 20.
    const both = addLine(addLine(once, { variantId: VARIANT_B, quantity: 2 }), { variantId: VARIANT_B, quantity: 2 })
    expect(both.lines).toEqual([
      { variantId: VARIANT_A, quantity: 1 },
      { variantId: VARIANT_B, quantity: 4 },
    ])
  })

  it('takes no new digital line into a cart of 50 lines', () => {
    let full = EMPTY_CART
    for (let index = 0; index < MAX_LINES; index += 1) full = addLine(full, { variantId: randomUUID(), quantity: 1 })
    expect(addLine(full, { variantId: VARIANT_A, quantity: 1 }, true)).toBe(full)
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

describe('audit 2: a stale tab and an over-long coupon', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('applies a change to the latest stored cart, so a line another tab added survives', () => {
    const area = memoryArea()
    writeCart(cart([VARIANT_A]), area)
    const staleCopy = readCart(area).cart // what this tab loaded
    writeCart(cart([VARIANT_A, VARIANT_B]), area) // another tab added B
    const { cart: next, saved } = updateStoredCart((latest) => setQuantity(latest, VARIANT_A, 2), area)
    expect(saved).toBe(true)
    expect(next.lines).toEqual([
      { variantId: VARIANT_A, quantity: 2 },
      { variantId: VARIANT_B, quantity: 1 },
    ])
    expect(readCart(area).cart).toEqual(next)
    // The old whole-snapshot write built on the stale copy would have dropped B.
    expect(setQuantity(staleCopy, VARIANT_A, 2).lines.map((l) => l.variantId)).toEqual([VARIANT_A])
  })

  it('leaves the rest alone when the changed line is already gone', () => {
    const area = memoryArea()
    writeCart(cart([VARIANT_B]), area) // another tab removed A
    expect(updateStoredCart((latest) => removeLine(latest, VARIANT_A), area).cart).toEqual(cart([VARIANT_B]))
    expect(updateStoredCart((latest) => setQuantity(latest, VARIANT_A, 5), area).cart).toEqual(cart([VARIANT_B]))
  })

  it('caps a typed coupon at 64 characters, upper-cased', () => {
    expect(normalizeCoupon('  demo10 ')).toBe('DEMO10')
    expect(normalizeCoupon('a'.repeat(70))).toHaveLength(MAX_COUPON)
    // Upper-casing expands ß to SS, which must not push the code past the limit.
    expect(normalizeCoupon('ß'.repeat(64))).toHaveLength(MAX_COUPON)
  })

  it('drops a saved coupon longer than the function accepts, once, and says so', () => {
    const session = memoryArea()
    vi.stubGlobal('window', { sessionStorage: session })
    expect(readSavedCoupon()).toEqual({ coupon: '', tooLong: false })
    session.setItem(COUPON_KEY, 'DEMO10')
    expect(readSavedCoupon()).toEqual({ coupon: 'DEMO10', tooLong: false })
    session.setItem(COUPON_KEY, 'X'.repeat(MAX_COUPON + 1))
    expect(readSavedCoupon()).toEqual({ coupon: '', tooLong: true })
    expect(session.store.get(COUPON_KEY)).toBe('')
    expect(readSavedCoupon()).toEqual({ coupon: '', tooLong: false })
  })
})

describe('P08: the sandbox access code in the URL fragment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads only a `#test=<code>` fragment, decoded, at most 200 characters', () => {
    expect(parseTestFragment('#test=secret-code-1234')).toBe('secret-code-1234')
    expect(parseTestFragment('#test=a%20b%2Bc')).toBe('a b+c')
    expect(parseTestFragment('#test=' + 'x'.repeat(200))).toHaveLength(200)
    expect(parseTestFragment('#test=' + 'x'.repeat(201))).toBeNull()
    // Any other fragment is left alone: an anchor, an empty code, a longer list, a broken escape.
    for (const hash of ['', '#', '#main', '#test=', '#test', '#testing=abc', '#test=abc&x=1', '#x&test=abc', '#test=%E0%A4%A']) {
      expect(parseTestFragment(hash), hash).toBeNull()
    }
  })

  it('stores the code for the tab, removes the fragment and keeps the path and query', () => {
    const session = memoryArea()
    const local = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    const location = { hash: '#test=secret-code-1234', pathname: '/checkout', search: '?utm=1' }
    const history = {
      state: { next: 1 },
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        // What the browser does: the address loses its fragment.
        location.hash = new URL(url, 'http://localhost:3000').hash
      }),
    }
    vi.stubGlobal('window', { sessionStorage: session, localStorage: local, location, history })
    expect(readTestAccess()).toBeNull()

    readTestFragment()
    expect(session.store.get(TEST_ACCESS_KEY)).toBe('secret-code-1234')
    expect(readTestAccess()).toBe('secret-code-1234')
    expect(history.replaceState).toHaveBeenCalledTimes(1)
    expect(history.replaceState).toHaveBeenCalledWith({ next: 1 }, '', '/checkout?utm=1')
    // Once: the fragment is gone, so a second call changes nothing and never overwrites the stored code.
    readTestFragment()
    expect(history.replaceState).toHaveBeenCalledTimes(1)
    expect(readTestAccess()).toBe('secret-code-1234')
    // Never localStorage.
    expect(local.getItem).not.toHaveBeenCalled()
    expect(local.setItem).not.toHaveBeenCalled()
  })

  it('does nothing without a fragment, and survives denied storage or history', () => {
    const session = memoryArea()
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      sessionStorage: session,
      location: { hash: '#main', pathname: '/cart', search: '' },
      history: { state: null, replaceState },
    })
    readTestFragment()
    expect(session.store.size).toBe(0)
    expect(replaceState).not.toHaveBeenCalled()

    vi.stubGlobal('window', {
      sessionStorage: session,
      location: { hash: '#test=secret-code-1234', pathname: '/cart', search: '' },
      history: {
        state: null,
        replaceState: () => {
          throw new DOMException('denied', 'SecurityError')
        },
      },
    })
    expect(() => readTestFragment()).not.toThrow()
    expect(readTestAccess()).toBe('secret-code-1234')

    vi.stubGlobal('window', {
      get sessionStorage(): never {
        throw new DOMException('denied', 'SecurityError')
      },
      location: { hash: '#test=secret-code-1234', pathname: '/cart', search: '' },
      history: { state: null, replaceState },
    })
    expect(() => readTestFragment()).not.toThrow()
    expect(readTestAccess()).toBeNull()
  })

  it('reads an empty stored code as no code', () => {
    const session = memoryArea()
    vi.stubGlobal('window', { sessionStorage: session })
    session.setItem(TEST_ACCESS_KEY, '')
    expect(readTestAccess()).toBeNull()
  })
})

describe('P08: the hold\'s clock time and the pending order', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the hold\'s end as a 24-hour Riyadh clock time with Latin digits', () => {
    // Meaningful only where the process is not on Riyadh time: vitest.config.ts runs the unit tests in UTC.
    expect(new Date('2026-10-02T11:35:00Z').getHours()).toBe(11)
    expect(formatRiyadhTime('2026-10-02T11:35:00+00:00')).toBe('14:35')
    expect(formatRiyadhTime('2026-10-02T21:05:00Z')).toBe('00:05')
    // The database writes microseconds and an offset.
    expect(formatRiyadhTime('2026-10-02T11:35:59.123456+00:00')).toBe('14:35')
    expect(formatRiyadhTime('2026-10-02T09:07:00+03:00')).toBe('09:07')
  })

  it('reads the database\'s microsecond times as the same moment as their millisecond form, and nothing else as a time', () => {
    expect(instantOf('2026-10-02T11:35:59.123456+00:00')).toBe(Date.UTC(2026, 9, 2, 11, 35, 59, 123))
    expect(instantOf('2026-10-02T11:35:59.9+00:00')).toBe(Date.UTC(2026, 9, 2, 11, 35, 59, 900))
    expect(instantOf('2026-10-02T11:35:59+00:00')).toBe(Date.UTC(2026, 9, 2, 11, 35, 59))
    for (const bad of ['', 'soon', '2026-13-45T00:00:00Z']) expect(instantOf(bad), bad).toBeNaN()
  })

  it('accepts an order number and a token only in the shapes the function issues', () => {
    const token = 'A'.repeat(43)
    expect(ORDER_NUMBER.test('ABCD2345')).toBe(true)
    // No 0, 1, I, O, a lower-case letter or a wrong length.
    for (const bad of ['ABCD2340', 'ABCD2341', 'ABCI2345', 'ABCO2345', 'abcd2345', 'ABCD234', 'ABCD23456']) {
      expect(ORDER_NUMBER.test(bad), bad).toBe(false)
    }
    expect(pendingOrderOf({ orderNumber: 'ABCD2345', accessToken: token })).toEqual({ orderNumber: 'ABCD2345', accessToken: token })
    expect(pendingOrderOf({ orderNumber: 'ABCD2345', accessToken: 'short' })).toBeNull()
    expect(pendingOrderOf({ orderNumber: 'abcd2345', accessToken: token })).toBeNull()
    expect(pendingOrderOf({ orderNumber: 5, accessToken: token })).toBeNull()
    expect(pendingOrderOf({ orderNumber: 'ABCD2345' })).toBeNull()
    expect(pendingOrderOf({})).toBeNull()
  })

  it('keeps the pending order in sessionStorage and reads back only a well-formed one', () => {
    const session = memoryArea()
    vi.stubGlobal('window', { sessionStorage: session })
    const order = { orderNumber: 'ABCD2345', accessToken: 'B'.repeat(43) }
    expect(readPendingOrder()).toBeNull()
    writePendingOrder(order)
    expect(readPendingOrder()).toEqual(order)
    session.setItem(PENDING_ORDER_KEY, 'null')
    expect(readPendingOrder()).toBeNull()
    session.setItem(PENDING_ORDER_KEY, JSON.stringify({ orderNumber: 'ABCD2345', accessToken: 'x' }))
    expect(readPendingOrder()).toBeNull()
    session.setItem(PENDING_ORDER_KEY, 'not json')
    expect(readPendingOrder()).toBeNull()
  })
})

describe('F3-8: the order and the cart it was made from', () => {
  afterEach(() => vi.unstubAllGlobals())

  const token = 'A'.repeat(43)
  const NUMBER = 'ABCD2345'
  /** The lines the checkout sent with `create`. */
  const ordered = [
    { variantId: VARIANT_A, quantity: 2 },
    { variantId: VARIANT_B, quantity: 1 },
  ]
  const cartOf = (lines: Array<{ variantId: string; quantity: number }>): CartV1 => ({ version: 1, lines })

  /** The tab's storage, with `window` as the cart code needs it. */
  function tab() {
    const session = memoryArea()
    vi.stubGlobal('window', { sessionStorage: session, dispatchEvent: () => true })
    return { session, local: memoryArea() }
  }

  it('digests the lines one way: variant ids and quantities, whatever the order, the case of the ids or a dedication', () => {
    const digest = linesDigest(ordered)
    expect(digest).toMatch(/^[0-9a-f]{16}$/)
    expect(linesDigest([...ordered].reverse())).toBe(digest)
    expect(linesDigest(ordered.map((line) => ({ ...line, variantId: line.variantId.toUpperCase() })))).toBe(digest)
    expect(linesDigest(ordered.map((line) => ({ ...line, dedication: 'إهداء' })))).toBe(digest)
    expect(linesDigest([{ variantId: VARIANT_A, quantity: 3 }, ordered[1]!])).not.toBe(digest)
    expect(linesDigest([ordered[0]!])).not.toBe(digest)
    expect(linesDigest([...ordered, { variantId: VARIANT_C, quantity: 1 }])).not.toBe(digest)
    expect(linesDigest([])).toMatch(/^[0-9a-f]{16}$/)
  })

  it('keeps the digest with the pending order, and drops one that cannot be read: it then counts as no digest', () => {
    const { session } = tab()
    const order: PendingOrder = { orderNumber: NUMBER, accessToken: token, lines: linesDigest(ordered) }
    writePendingOrder(order)
    expect(readPendingOrder()).toEqual(order)
    for (const lines of [5, null, '', 'zz', 'ABCDEF0123456789', '0123456789abcdef0', {}, ['0123456789abcdef']]) {
      session.setItem(PENDING_ORDER_KEY, JSON.stringify({ orderNumber: NUMBER, accessToken: token, lines }))
      expect(readPendingOrder(), JSON.stringify(lines)).toEqual({ orderNumber: NUMBER, accessToken: token })
    }
    // The mark of an order handed back to another request is a digest too.
    expect(pendingOrderOf({ orderNumber: NUMBER, accessToken: token, lines: OTHER_REQUEST })).toEqual({ orderNumber: NUMBER, accessToken: token, lines: OTHER_REQUEST })
  })

  it('a cart still the order\'s: no warning at the hold, and the return page empties the cart after payment', () => {
    const { local } = tab()
    writeCart(cartOf(ordered), local)
    writePendingOrder({ orderNumber: NUMBER, accessToken: token, lines: linesDigest(ordered) })
    const pending = readPendingOrder()!
    expect(orderChanged(pending, readCart(local).cart.lines)).toBe(false)
    // The return page reads the same digest from the stored order, and spends it.
    const target = returnOrder(`?order=${NUMBER}`, pending)!
    expect(target).toEqual({ orderNumber: NUMBER, accessToken: token, lines: linesDigest(ordered) })
    expect(emptyBoughtCart(target, local)).toBe(true)
    expect(readCart(local).cart.lines).toEqual([])
    expect(local.store.get(CART_STORAGE_KEY)).toBe(serializeCart(EMPTY_CART))
  })

  it('a cart changed after the order: the warning, and the return page leaves the cart as it is', () => {
    const { local } = tab()
    const order: PendingOrder = { orderNumber: NUMBER, accessToken: token, lines: linesDigest(ordered) }
    // A quantity edited, a line added, a line removed, the cart emptied.
    const edits = [
      [{ variantId: VARIANT_A, quantity: 3 }, ordered[1]!],
      [...ordered, { variantId: VARIANT_C, quantity: 1 }],
      [ordered[0]!],
      [],
    ]
    for (const edited of edits) {
      writeCart(cartOf(edited), local)
      expect(orderChanged(order, readCart(local).cart.lines), JSON.stringify(edited)).toBe(true)
      const before = local.store.get(CART_STORAGE_KEY)
      expect(emptyBoughtCart(returnOrder(`?order=${NUMBER}`, order)!, local), JSON.stringify(edited)).toBe(false)
      expect(local.store.get(CART_STORAGE_KEY)).toBe(before)
    }
  })

  it('an order stored without a digest behaves as it always did: no warning, and the paid order empties the cart', () => {
    const { local } = tab()
    const old: PendingOrder = { orderNumber: NUMBER, accessToken: token }
    writeCart(cartOf([{ variantId: VARIANT_C, quantity: 7 }]), local)
    expect(orderChanged(old, readCart(local).cart.lines)).toBe(false)
    expect(orderChanged(old, [])).toBe(false)
    const target = returnOrder(`?order=${NUMBER}`, old)!
    expect(target).toEqual({ orderNumber: NUMBER, accessToken: token })
    expect(emptyBoughtCart(target, local)).toBe(true)
    expect(readCart(local).cart.lines).toEqual([])
    // A number in the address that is not this tab's order has no token, no digest and no say over the cart.
    expect(returnOrder('?order=KMNP6789', old)).toEqual({ orderNumber: 'KMNP6789', accessToken: null })
  })

  it('ACTIVE_HOLD handing back an order for another request: the warning, whatever the cart holds, and the cart is kept', () => {
    const { local } = tab()
    const handed = pendingOrderOf({ orderNumber: NUMBER, accessToken: token })!
    // This tab has no record of the order: it was made by a request other than the one just sent.
    const held = heldOrder(handed, null)!
    expect(held).toEqual({ orderNumber: NUMBER, accessToken: token, lines: OTHER_REQUEST })
    writeCart(cartOf(ordered), local)
    expect(orderChanged(held, readCart(local).cart.lines)).toBe(true)
    expect(orderChanged(held, [])).toBe(true)
    expect(emptyBoughtCart(returnOrder(`?order=${NUMBER}`, held)!, local)).toBe(false)
    expect(readCart(local).cart.lines).toEqual(ordered)
    // The mark survives a reload of the tab.
    tab()
    writePendingOrder(held)
    expect(readPendingOrder()).toEqual(held)
  })

  // The auditor's B1: an order handed back to a tab that holds no record of it is no longer assumed to be another
  // request's. Its own lines (SKUs and quantities) are read through the quote the tab just sent, which carries both.
  it('ACTIVE_HOLD handing back an order this tab has no record of: compared by its own lines, read through the quote', () => {
    const { local } = tab()
    const quoteLines = [
      { sku: 'SKU-A', variantId: VARIANT_A },
      { sku: 'SKU-B', variantId: VARIANT_B },
    ]
    const orderLines = [
      { sku: 'SKU-B', quantity: 1 },
      { sku: 'SKU-A', quantity: 2 },
    ]
    // The cart the order was made from: the same digest, so no warning, and the paid order empties the cart.
    const same = handedLinesDigest(orderLines, quoteLines)
    expect(same).toBe(linesDigest(ordered))
    const held = heldOrder(pendingOrderOf({ orderNumber: NUMBER, accessToken: token, lines: same })!, null)!
    expect(held).toEqual({ orderNumber: NUMBER, accessToken: token, lines: same })
    writeCart(cartOf(ordered), local)
    expect(orderChanged(held, readCart(local).cart.lines)).toBe(false)
    expect(emptyBoughtCart(returnOrder(`?order=${NUMBER}`, held)!, local)).toBe(true)
    expect(readCart(local).cart.lines).toEqual([])
    // A quantity changed since the order: the warning.
    const fewer = handedLinesDigest([{ sku: 'SKU-A', quantity: 1 }, { sku: 'SKU-B', quantity: 1 }], quoteLines)
    expect(orderChanged(heldOrder(pendingOrderOf({ orderNumber: NUMBER, accessToken: token, lines: fewer })!, null)!, ordered)).toBe(true)
    // A line the quote does not hold: the order was made from other lines.
    expect(handedLinesDigest([...orderLines, { sku: 'SKU-C', quantity: 1 }], quoteLines)).toBe(OTHER_REQUEST)
    // An old record of the same order, stored without a digest, stays without one whatever the handed lines say.
    expect(heldOrder(pendingOrderOf({ orderNumber: NUMBER, accessToken: token, lines: same })!, { orderNumber: NUMBER, accessToken: token })).toEqual({
      orderNumber: NUMBER,
      accessToken: token,
    })
  })

  it('ACTIVE_HOLD for an order this tab stored itself keeps that record: its digest decides, as before', () => {
    const mine: PendingOrder = { orderNumber: NUMBER, accessToken: token, lines: linesDigest(ordered) }
    const handed = pendingOrderOf({ orderNumber: NUMBER, accessToken: token })!
    expect(heldOrder(handed, mine)).toEqual(mine)
    expect(orderChanged(heldOrder(handed, mine)!, ordered)).toBe(false)
    // An old record without a digest stays without one: today's behaviour.
    const old: PendingOrder = { orderNumber: NUMBER, accessToken: token }
    expect(heldOrder(handed, old)).toEqual(old)
    // Another order stored here is not this one: the handed order is for another request.
    const other = { orderNumber: 'KMNP6789', accessToken: token, lines: linesDigest(ordered) }
    expect(heldOrder(handed, other)).toEqual({ orderNumber: NUMBER, accessToken: token, lines: OTHER_REQUEST })
    // No order handed back (the email was not the held order's own): this tab's record, if any.
    expect(heldOrder(null, mine)).toEqual(mine)
    expect(heldOrder(null, null)).toBeNull()
  })
})
