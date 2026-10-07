// P08 round 4b: the pure parts of the checkout form, the hold view and the
// payment return page (src/lib/cart.ts, src/components/store/quote.ts): the
// built policy revisions against the quote's, which order and token the return
// page reads from its address, its verify schedule, how a payment reply is
// read (anything unknown is `preparing`, never paid) and how the sandbox access
// code travels. The screens themselves are in tests/e2e/cart-checkout.spec.ts.
// FABLE-AUDIT F2b adds the digital variant's add control (one copy, no
// quantity), the phone a digital-only cart does not send, and what the return
// page releases for each state.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddToCart } from '../../src/components/store/AddToCart'
import { VariantAction } from '../../src/components/store/VariantAction'
import {
  fetchQuote,
  orderSchema,
  parsePayment,
  parseVerify,
  postCheckout,
  postPayments,
  quoteErrorMessage,
} from '../../src/components/store/quote'
import { builtPolicyRevisions, phoneToSend, returnOrder, returnRelease, TEST_ACCESS_KEY, VERIFY_SCHEDULE_SECONDS } from '../../src/lib/cart'

const TOKEN = 'T'.repeat(43)
const HASH = 'a'.repeat(64)

describe('builtPolicyRevisions', () => {
  it('sends the built revisions, and is not stale when they equal the quote\'s', () => {
    expect(builtPolicyRevisions({ store: 3, delivery: 2, refund: 1 }, { store: 3, delivery: 2, refund: 1 })).toEqual({
      revisions: { store: 3, delivery: 2, refund: 1 },
      stale: false,
    })
  })

  it('sends only the keys the quote lists', () => {
    // The build also rendered the privacy policy; the quote does not ask for it.
    expect(builtPolicyRevisions({ store: 3, privacy: 9 }, { store: 3 })).toEqual({ revisions: { store: 3 }, stale: false })
    expect(builtPolicyRevisions({ store: 3 }, {})).toEqual({ revisions: {}, stale: false })
  })

  it('is stale when the build lacks a listed policy, and sends nothing for it', () => {
    expect(builtPolicyRevisions({ store: 3 }, { store: 3, delivery: 2 })).toEqual({ revisions: { store: 3 }, stale: true })
    expect(builtPolicyRevisions({}, { store: 3 })).toEqual({ revisions: {}, stale: true })
    // An inherited property is no built policy.
    expect(builtPolicyRevisions({}, { constructor: 1 })).toEqual({ revisions: {}, stale: true })
  })

  it('is stale when a revision differs either way, and carries the built number, not the quote\'s', () => {
    expect(builtPolicyRevisions({ store: 2, delivery: 2 }, { store: 3, delivery: 2 })).toEqual({
      revisions: { store: 2, delivery: 2 },
      stale: true,
    })
    expect(builtPolicyRevisions({ store: 4 }, { store: 3 })).toEqual({ revisions: { store: 4 }, stale: true })
  })
})

describe('returnOrder', () => {
  const stored = { orderNumber: 'ABCD2345', accessToken: TOKEN }

  it('takes the order number from the `order` query value, upper-cased, and no token without a stored order', () => {
    expect(returnOrder('?order=abcd2345', null)).toEqual({ orderNumber: 'ABCD2345', accessToken: null })
    expect(returnOrder('?order=KMNP6789', null)).toEqual({ orderNumber: 'KMNP6789', accessToken: null })
  })

  it('reads only the first 8 characters, so what the payment page appends is ignored', () => {
    expect(returnOrder('?order=ABCD2345?id=7f1e&status=paid&message=ok', null)).toEqual({ orderNumber: 'ABCD2345', accessToken: null })
    expect(returnOrder('?order=ABCD2345&id=7f1e&status=paid&message=ok', null)).toEqual({ orderNumber: 'ABCD2345', accessToken: null })
    expect(returnOrder('?id=7f1e&status=paid&order=ABCD2345', null)).toEqual({ orderNumber: 'ABCD2345', accessToken: null })
  })

  it('reads nothing else from the query: a forged status or id changes no part of the result', () => {
    const forged = returnOrder('?order=ABCD2345&status=paid&id=1&message=APPROVED', stored)
    expect(forged).toEqual({ orderNumber: 'ABCD2345', accessToken: TOKEN })
    expect(Object.keys(forged ?? {}).sort()).toEqual(['accessToken', 'orderNumber'])
    expect(returnOrder('?status=paid&id=1&message=APPROVED', null)).toBeNull()
  })

  it('gives the token only from the stored order and only for the same number', () => {
    expect(returnOrder('?order=ABCD2345', stored)).toEqual({ orderNumber: 'ABCD2345', accessToken: TOKEN })
    expect(returnOrder('?order=abcd2345', stored)).toEqual({ orderNumber: 'ABCD2345', accessToken: TOKEN })
    // Another order in the address: its number, and none of this tab's token.
    expect(returnOrder('?order=KMNP6789', stored)).toEqual({ orderNumber: 'KMNP6789', accessToken: null })
  })

  it('falls back to the stored order when the query holds no order number, and to nothing without one', () => {
    for (const search of ['', '?', '?order=', '?order=ABC', '?order=ABCD234', '?order=ABCI2345', '?order=ABCD2340', '?order=ABCD-2345', '?x=1']) {
      expect(returnOrder(search, stored), search).toEqual({ orderNumber: 'ABCD2345', accessToken: TOKEN })
      expect(returnOrder(search, null), search).toBeNull()
    }
  })
})

describe('the verify schedule', () => {
  it('asks at 0, 2, 4, 8, 15 and 30 seconds', () => {
    expect([...VERIFY_SCHEDULE_SECONDS]).toEqual([0, 2, 4, 8, 15, 30])
  })
})

describe('what the return page releases', () => {
  it('ends a paid order with the cart that bought it', () => {
    expect(returnRelease('paid')).toBe('cart')
  })

  it('ends the order and keeps the cart for every other settled state, the two review states and a refund included', () => {
    for (const state of ['needs_resolution', 'review', 'refunded', 'expired', 'cancelled']) expect(returnRelease(state), state).toBe('order')
  })

  it('releases nothing while the payment is pending, for an order it does not know, or a state it does not know', () => {
    for (const state of ['pending', 'unknown', '', 'PAID', 'succeeded']) expect(returnRelease(state), state).toBeNull()
  })
})

describe('the phone a checkout sends', () => {
  it('is the one typed, trimmed, while the cart holds a physical or signed line', () => {
    expect(phoneToSend(true, ' 0501234567 ')).toBe('0501234567')
    expect(phoneToSend(true, '   ')).toBeUndefined()
    expect(phoneToSend(true, '')).toBeUndefined()
  })

  it('is none for a digital-only cart, whatever was typed before the cart changed', () => {
    expect(phoneToSend(false, '0501234567')).toBeUndefined()
    expect(phoneToSend(false, 'not a phone')).toBeUndefined()
  })
})

describe('a digital variant\'s add control', () => {
  const V = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

  it('has no quantity field: one copy', () => {
    const digital = renderToStaticMarkup(createElement(AddToCart, { variantId: V, label: 'كتاب: رقمي', digital: true }))
    expect(digital).not.toContain('type="number"')
    expect(digital).not.toContain('الكمية')
    expect(digital).toContain('أضف إلى السلة')
    const paper = renderToStaticMarkup(createElement(AddToCart, { variantId: V, label: 'كتاب: ورقي' }))
    expect(paper).toContain('type="number"')
    expect(paper).toContain('الكمية')
  })

  it('is what the product row passes on', () => {
    const row = (digital?: boolean) =>
      renderToStaticMarkup(createElement(VariantAction, { variantId: V, label: 'كتاب: رقمي', price: '12.40 ر.س', preorder: null, privacyRevision: null, digital }))
    expect(row(true)).not.toContain('type="number"')
    expect(row(false)).toContain('type="number"')
    expect(row()).toContain('type="number"')
  })
})

describe('parsePayment: anything not recognised is `preparing`, never paid', () => {
  it('reads the four documented states', () => {
    expect(parsePayment({ state: 'ready', url: 'http://127.0.0.1:54390/invoices/abc' })).toEqual({
      state: 'ready',
      url: 'http://127.0.0.1:54390/invoices/abc',
    })
    expect(parsePayment({ state: 'ready', url: 'https://checkout.example/invoices/abc' })).toEqual({
      state: 'ready',
      url: 'https://checkout.example/invoices/abc',
    })
    expect(parsePayment({ state: 'preparing' })).toEqual({ state: 'preparing' })
    expect(parsePayment({ state: 'unavailable' })).toEqual({ state: 'unavailable' })
    expect(parsePayment({ state: 'closed', code: 'HOLD_EXPIRED' })).toEqual({ state: 'closed', code: 'HOLD_EXPIRED' })
    expect(parsePayment({ state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 'paid' })).toEqual({
      state: 'closed',
      code: 'ORDER_NOT_PAYABLE',
      status: 'paid',
    })
  })

  it('treats a `ready` without a web address as `preparing`: no link to follow', () => {
    for (const url of [undefined, null, 5, '', 'javascript:alert(1)', 'data:text/html,x', '/invoices/abc', '//evil.test/x', 'ftp://x/y', 'http://']) {
      expect(parsePayment({ state: 'ready', url }), String(url)).toEqual({ state: 'preparing' })
    }
  })

  it('treats every other shape as `preparing`', () => {
    for (const value of [
      undefined,
      null,
      'ready',
      42,
      [],
      {},
      { state: 'paid' },
      { state: 'succeeded' },
      { state: 'READY', url: 'https://x.test/a' },
      { state: 'closed' },
      { state: 'closed', code: 5 },
    ]) {
      expect(parsePayment(value), JSON.stringify(value)).toEqual({ state: 'preparing' })
    }
  })

  it('keeps a closed payment\'s status only when it is a string', () => {
    expect(parsePayment({ state: 'closed', code: 'ORDER_NOT_PAYABLE', status: 5 })).toEqual({ state: 'closed', code: 'ORDER_NOT_PAYABLE' })
  })
})

describe('parseVerify', () => {
  it('reads the state, the token match, the invoice and the test mode', () => {
    expect(parseVerify({ state: 'pending', hasToken: true, invoiceUrl: 'http://127.0.0.1:54390/invoices/abc', testMode: true })).toEqual({
      state: 'pending',
      hasToken: true,
      invoiceUrl: 'http://127.0.0.1:54390/invoices/abc',
      testMode: true,
    })
    for (const state of ['paid', 'needs_resolution', 'refunded', 'pending', 'review', 'expired', 'cancelled', 'unknown']) {
      expect(parseVerify({ state, hasToken: false, testMode: false }).state).toBe(state)
    }
  })

  it('reads a state it does not know as `pending`, never as paid', () => {
    for (const state of ['succeeded', 'PAID', '', 5, null, undefined]) {
      expect(parseVerify({ state, hasToken: true }).state, String(state)).toBe('pending')
    }
  })

  it('is strict about the token match and the test mode, and drops an invoice that is no web address', () => {
    expect(parseVerify({ state: 'pending', hasToken: 'yes', testMode: 1 })).toEqual({ state: 'pending', hasToken: false, invoiceUrl: null, testMode: false })
    expect(parseVerify({ state: 'pending', hasToken: true, invoiceUrl: 'javascript:alert(1)' }).invoiceUrl).toBeNull()
  })

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'paid', 7, []]) expect(() => parseVerify(value)).toThrow()
  })
})

const LINE = {
  line: 1,
  variantId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  productId: '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
  productSlug: 'book',
  productTitle: 'كتاب',
  variantTitle: 'نسخة',
  sku: 'SKU-1',
  fulfillment: 'digital',
  unitPrice: 1240,
  quantity: 1,
  subtotal: 1240,
  discount: 0,
  total: 1240,
  dedication: null,
  preorder: null,
}
const QUOTE = {
  ok: true,
  errors: [],
  lines: [LINE],
  physical: false,
  city: null,
  coupon: null,
  subtotal: 1240,
  discount: 0,
  shipping: 0,
  total: 1240,
  quoteHash: HASH,
  checkoutEnabled: true,
  policyRevisions: { store: 1 },
  testMode: true,
}
const ORDER = {
  id: '2c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f',
  orderNumber: 'ABCD2345',
  status: 'pending_payment',
  holdExpiresAt: '2026-10-02T11:35:00.123456+00:00',
  subtotal: 1240,
  discount: 0,
  shipping: 0,
  total: 1240,
  currency: 'SAR',
  environment: 'test',
  lines: [
    {
      sku: 'SKU-1',
      productTitle: 'كتاب',
      variantTitle: 'نسخة',
      fulfillment: 'digital',
      quantity: 1,
      unitPrice: 1240,
      discount: 0,
      total: 1240,
      preorder: { shipsOn: '2026-10-10', note: 'يصل بعد الطباعة' },
    },
  ],
}

/** Stubs `fetch` with one reply and records what was sent. */
function stubFetch(reply: unknown = { ok: true, data: QUOTE }, status = 200) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> })
      return new Response(JSON.stringify(reply), { status })
    }),
  )
  return sent
}

/** A sessionStorage stand-in holding the sandbox access code, or none. */
function stubSession(code?: string) {
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => (key === TEST_ACCESS_KEY ? (code ?? null) : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  })
}

describe('what the quote and the order carry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reads the quote\'s test mode, and a missing one as off', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession()
    stubFetch({ ok: true, data: QUOTE })
    expect((await fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).testMode).toBe(true)
    stubFetch({ ok: true, data: { ...QUOTE, testMode: false } })
    expect((await fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).testMode).toBe(false)
    const older: Record<string, unknown> = { ...QUOTE }
    delete older.testMode
    stubFetch({ ok: true, data: older })
    expect((await fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).testMode).toBe(false)
  })

  it('reads a preorder line as null or `{shipsOn, note}`, and refuses a malformed one', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession()
    const preorder = { shipsOn: '2026-10-10', note: 'يصل بعد الطباعة' }
    stubFetch({ ok: true, data: { ...QUOTE, lines: [{ ...LINE, preorder }] } })
    expect((await fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).lines[0]!.preorder).toEqual(preorder)
    stubFetch({ ok: true, data: QUOTE })
    expect((await fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).lines[0]!.preorder).toBeNull()
    stubFetch({ ok: true, data: { ...QUOTE, lines: [{ ...LINE, preorder: { shipsOn: 5, note: 'x' } }] } })
    await expect(fetchQuote({ lines: [{ variantId: LINE.variantId, quantity: 1 }] })).rejects.toThrow()
  })

  it('reads an order with its hold\'s end and its preorder lines, and refuses a hold that is no time', () => {
    const order = orderSchema.parse(ORDER)
    expect(order.holdExpiresAt).toBe('2026-10-02T11:35:00.123456+00:00')
    expect(order.lines[0]!.preorder).toEqual({ shipsOn: '2026-10-10', note: 'يصل بعد الطباعة' })
    expect(orderSchema.parse({ ...ORDER, lines: [{ ...ORDER.lines[0], preorder: null }] }).lines[0]!.preorder).toBeNull()
    expect(() => orderSchema.parse({ ...ORDER, holdExpiresAt: 'soon' })).toThrow()
    expect(() => orderSchema.parse({ ...ORDER, holdExpiresAt: null })).toThrow()
  })

  it('has a message for an order under the minimum', () => {
    expect(quoteErrorMessage({ code: 'TOTAL_BELOW_MINIMUM', minimum: 100 })).toBe('قيمة الطلب أقل من الحد الأدنى للدفع.')
  })
})

describe('the sandbox access code on the calls (P08 contract section 1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('goes with quote, create and pay, in the body, and never with cancel or verify', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession('sandbox-code-123456')
    const sent = stubFetch({ ok: true, data: {} })
    await postCheckout({ action: 'quote', lines: [] })
    await postCheckout({ action: 'create', email: 'a@b.c' })
    await postCheckout({ action: 'pay', orderNumber: 'ABCD2345', accessToken: TOKEN })
    await postCheckout({ action: 'cancel', orderNumber: 'ABCD2345', accessToken: TOKEN })
    await postPayments({ action: 'verify', orderNumber: 'ABCD2345', accessToken: TOKEN })
    expect(sent.map((call) => [call.body.action, call.body.testAccess])).toEqual([
      ['quote', 'sandbox-code-123456'],
      ['create', 'sandbox-code-123456'],
      ['pay', 'sandbox-code-123456'],
      ['cancel', undefined],
      ['verify', undefined],
    ])
    // The code is never in a URL.
    expect(sent.every((call) => !call.url.includes('sandbox-code'))).toBe(true)
  })

  it('adds nothing when the tab holds no code', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession()
    const sent = stubFetch({ ok: true, data: {} })
    await postCheckout({ action: 'quote', lines: [] })
    await postCheckout({ action: 'pay', orderNumber: 'ABCD2345', accessToken: TOKEN })
    expect(sent.map((call) => Object.keys(call.body).includes('testAccess'))).toEqual([false, false])
  })

  it('sends checkout to `checkout` and verify to `payments`, as one envelope', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession()
    const sent = stubFetch({ ok: true, data: { state: 'paid' } })
    expect(await postCheckout({ action: 'cancel', orderNumber: 'ABCD2345', accessToken: TOKEN })).toEqual({
      status: 200,
      ok: true,
      data: { state: 'paid' },
      error: undefined,
    })
    const verified = await postPayments({ action: 'verify', orderNumber: 'ABCD2345' })
    expect(verified.ok).toBe(true)
    expect(sent.map((call) => call.url)).toEqual([
      'http://127.0.0.1:54321/functions/v1/checkout',
      'http://127.0.0.1:54321/functions/v1/payments',
    ])
  })

  it('passes a refusal through with its status, so the page can tell a throttle from a failure', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    stubSession()
    stubFetch({ ok: false, error: { code: 'RATE_LIMITED', message: 'أرسلت طلبات كثيرة؛ حاول لاحقًا.' } }, 429)
    expect(await postPayments({ action: 'verify', orderNumber: 'ABCD2345' })).toEqual({
      status: 429,
      ok: false,
      data: undefined,
      error: { code: 'RATE_LIMITED', message: 'أرسلت طلبات كثيرة؛ حاول لاحقًا.' },
    })
  })
})
