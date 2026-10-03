// P08 round 10b: the preorder's words and the held `OUT_OF_STOCK` sentence of
// the cart and the checkout (src/components/store/quote.ts). The rest of the
// quote's parsing is in tests/unit/store-checkout.test.ts.
import { describe, expect, it } from 'vitest'

import { preorderSentence, priceSchema, quoteErrorMessage, RECEIVED } from '../../src/components/store/quote'

const HASH = 'a'.repeat(64)
const V = '11111111-1111-4111-8111-111111111111'

const priced = (over: Record<string, unknown> = {}) => ({
  ok: true,
  errors: [],
  lines: [],
  physical: false,
  city: null,
  coupon: null,
  subtotal: 0,
  discount: 0,
  shipping: 0,
  total: 0,
  quoteHash: HASH,
  ...over,
})

describe('preorderSentence', () => {
  it('says the delivery date as the Riyadh calendar day with Latin digits: the same words everywhere', () => {
    const sentence = preorderSentence({ shipsOn: '2026-10-15', note: 'يصل من المطبعة' })
    expect(sentence).toMatch(/^طلب مسبق: يُسلَّم في 15 \S+ 2026$/)
    expect(sentence).not.toMatch(/[٠-٩۰-۹]/)
    // A date, not a moment: the first and the last day of a year keep their own day in the Riyadh calendar.
    expect(preorderSentence({ shipsOn: '2026-01-01', note: 'x' })).toMatch(/ 1 \S+ 2026$/)
    expect(preorderSentence({ shipsOn: '2026-12-31', note: 'x' })).toMatch(/ 31 \S+ 2026$/)
  })
})

describe('the held OUT_OF_STOCK (P08 contract section 4)', () => {
  it('says the quantity is held for another order, not that it is gone', () => {
    expect(quoteErrorMessage({ code: 'OUT_OF_STOCK', line: 0, variantId: V, available: 0, held: true })).toBe(
      'الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.',
    )
    // The units that are held are not "available": the held sentence wins whatever the count says.
    expect(quoteErrorMessage({ code: 'OUT_OF_STOCK', available: 2, held: true })).toBe('الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.')
  })

  it('keeps the plain words for stock that is really short', () => {
    expect(quoteErrorMessage({ code: 'OUT_OF_STOCK', available: 3 })).toBe('الكمية المطلوبة غير متوفرة؛ المتاح: 3.')
    expect(quoteErrorMessage({ code: 'OUT_OF_STOCK', available: 3, held: false })).toBe('الكمية المطلوبة غير متوفرة؛ المتاح: 3.')
    expect(quoteErrorMessage({ code: 'OUT_OF_STOCK' })).toBe('الكمية المطلوبة غير متوفرة الآن.')
  })

  it('reads `held` from the quote\'s errors exactly as the SQL writes it, and refuses one that is not a boolean', () => {
    const errors = [{ code: 'OUT_OF_STOCK', line: 1, variantId: V, available: 0, held: true }]
    expect(priceSchema.parse(priced({ ok: false, errors })).errors).toEqual(errors)
    // Without `held` (the units are short for real) the error carries none.
    expect(priceSchema.parse(priced({ ok: false, errors: [{ code: 'OUT_OF_STOCK', line: 1, variantId: V, available: 0 }] })).errors).toEqual([
      { code: 'OUT_OF_STOCK', line: 1, variantId: V, available: 0 },
    ])
    expect(() => priceSchema.parse(priced({ ok: false, errors: [{ code: 'OUT_OF_STOCK', held: 'true' }] }))).toThrow()
  })
})

describe('the preorder a quote line and an order line carry', () => {
  const line = {
    line: 0,
    variantId: V,
    productId: '22222222-2222-4222-8222-222222222222',
    productSlug: 'book',
    productTitle: 'كتاب',
    variantTitle: 'النسخة الورقية',
    sku: 'S-1',
    fulfillment: 'physical',
    unitPrice: 2360,
    quantity: 1,
    subtotal: 2360,
    discount: 0,
    total: 2360,
    dedication: null,
  }

  it('reads the date and the note, and null for a line that is not a preorder', () => {
    const preorder = { shipsOn: '2026-11-20', note: 'تُشحن بعد وصول النسخ' }
    const parsed = priceSchema.parse(priced({ lines: [{ ...line, preorder }, { ...line, line: 1, preorder: null }] }))
    expect(parsed.lines.map((entry) => entry.preorder)).toEqual([preorder, null])
    expect(() => priceSchema.parse(priced({ lines: [{ ...line, preorder: { shipsOn: '2026-11-20' } }] }))).toThrow()
  })

  it('treats the statuses that mean a payment arrived as received, and no other', () => {
    for (const status of ['paid', 'paid_needs_resolution', 'refunded', 'review']) expect(RECEIVED.has(status), status).toBe(true)
    for (const status of ['pending_payment', 'expired', 'cancelled', 'unknown']) expect(RECEIVED.has(status), status).toBe(false)
  })
})
