// P08 round 10b: the preorder's words and the held `OUT_OF_STOCK` sentence of
// the cart and the checkout (src/components/store/quote.ts). The rest of the
// quote's parsing is in tests/unit/store-checkout.test.ts. RESIDUALS-1 R1 adds the sentence of a refused `create`
// (I50 (3)) and the titles a refused line carries (I51 (2)).
import { describe, expect, it } from 'vitest'

import { createRefusalMessage, preorderSentence, priceSchema, quoteErrorMessage, RECEIVED } from '../../src/components/store/quote'

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

describe('the sentence of a refused create (RESIDUALS-1 I50 (3))', () => {
  const refused = (code: string, fields?: Record<string, unknown>) => ({ code, message: 'رسالة الدالة.', ...(fields ? { fields } : {}) })

  it('says the quantity is held for another order when the function says `held`, through the same sentence as the quote', () => {
    expect(createRefusalMessage(refused('OUT_OF_STOCK', { quote: {}, held: true }))).toBe('الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.')
    expect(createRefusalMessage(refused('OUT_OF_STOCK', { held: true }))).toBe(quoteErrorMessage({ code: 'OUT_OF_STOCK', held: true }))
  })

  it('keeps the plain words for stock that is really short, which are the words of the function itself', () => {
    expect(createRefusalMessage(refused('OUT_OF_STOCK', { quote: {} }))).toBe('الكمية المطلوبة غير متوفرة الآن.')
    expect(createRefusalMessage(refused('OUT_OF_STOCK'))).toBe('الكمية المطلوبة غير متوفرة الآن.')
    // Only a boolean `true` is a hold.
    expect(createRefusalMessage(refused('OUT_OF_STOCK', { held: 'true' }))).toBe('الكمية المطلوبة غير متوفرة الآن.')
  })

  it('leaves every other refusal its own message', () => {
    expect(createRefusalMessage(refused('QUOTE_CHANGED', { quote: {} }))).toBe('رسالة الدالة.')
    // A `held` that comes with another code is not read as a hold.
    expect(createRefusalMessage(refused('UNAVAILABLE', { held: true }))).toBe('رسالة الدالة.')
  })
})

describe('the titles of a refused line (RESIDUALS-1 I51 (2))', () => {
  const named = { code: 'OUT_OF_STOCK', line: 1, variantId: V, available: 0, productTitle: 'كتاب خوص', variantTitle: 'النسخة الورقية' }

  it('reads productTitle and variantTitle from a refused line, when the function names it', () => {
    expect(priceSchema.parse(priced({ ok: false, errors: [named] })).errors).toEqual([named])
    expect(priceSchema.parse(priced({ ok: false, errors: [{ ...named, held: true }] })).errors[0]).toMatchObject({ held: true, productTitle: 'كتاب خوص' })
  })

  it('reads a refusal with no titles as one with none (a variant that no longer exists), and a title that is not text as a malformed reply', () => {
    const bare = { code: 'UNAVAILABLE', line: 1, variantId: V }
    expect(priceSchema.parse(priced({ ok: false, errors: [bare] })).errors).toEqual([bare])
    expect(() => priceSchema.parse(priced({ ok: false, errors: [{ ...named, productTitle: 5 }] }))).toThrow()
    expect(() => priceSchema.parse(priced({ ok: false, errors: [{ ...named, variantTitle: null }] }))).toThrow()
  })

  it('takes them whole: the SQL bounds them by character, so a character outside the BMP is never cut in half', () => {
    const astral = { ...named, productTitle: `${'ا'.repeat(199)}🌙`, variantTitle: `${'ب'.repeat(119)}🌙` }
    const [error] = priceSchema.parse(priced({ ok: false, errors: [astral] })).errors
    expect(error!.productTitle).toBe(astral.productTitle)
    expect(error!.variantTitle).toBe(astral.variantTitle)
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
