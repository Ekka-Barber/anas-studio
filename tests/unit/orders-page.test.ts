// P08 round 10a: the pure parts of the buyer's order page and the two notification link pages
// (src/lib/orders.ts): the order link in the address, the strict parser of the `orders` function's `get`
// reply, the words for each state, the return request's items, and the calls the pages make with `fetch`
// stubbed. The pages themselves are in tests/e2e/order-page.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clampQuantity,
  clearOrderAccess,
  failureOf,
  fetchOrder,
  formProblem,
  FULFILLMENT_LABELS,
  isFiled,
  isSent,
  lineName,
  normalizeReason,
  notifyStatus,
  ORDER_ACCESS_KEY,
  ORDER_STATUSES,
  PAYMENT_STATES,
  parseOrderFragment,
  parseOrderView,
  readOrderAccess,
  requestDownload,
  RETURN_LABELS,
  RETURN_STATES,
  returnableItems,
  returnRequestItems,
  STATUS_SENTENCES,
  statusKind,
  takeFragment,
  takeOrderFragment,
  type OrderLine,
} from '../../src/lib/orders'

const NUMBER = 'ABCD2345'
// 43 characters of base64url.
const TOKEN = 'Ab3-_'.repeat(9).slice(0, 43)
const DOWNLOAD_TOKEN = 'Zy9_-'.repeat(9).slice(0, 43)
const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '44444444-4444-4444-8444-444444444444'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('parseOrderFragment', () => {
  it('reads the number and the token of a mailed link, with or without the #', () => {
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN}`)).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
    expect(parseOrderFragment(`${NUMBER}.${TOKEN}`)).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
  })

  it('folds a lower-case number to upper case, as the function does, and keeps the token as it is', () => {
    expect(parseOrderFragment(`#${NUMBER.toLowerCase()}.${TOKEN}`)).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
    // The token is case-sensitive: folding it would be another token.
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN.toLowerCase()}`)?.accessToken).toBe(TOKEN.toLowerCase())
  })

  it('refuses a token that is not 43 characters of base64url', () => {
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN.slice(1)}`)).toBeNull()
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN}A`)).toBeNull()
    for (const bad of ['+', '/', '=', ' ', '%', '!']) {
      expect(parseOrderFragment(`#${NUMBER}.${TOKEN.slice(1)}${bad}`), `token ending in ${JSON.stringify(bad)}`).toBeNull()
    }
    expect(parseOrderFragment(`#${NUMBER}.`)).toBeNull()
  })

  it('refuses a number that is not an order number', () => {
    // Letters I and O, and digits 0 and 1, are never in a number; length is 8.
    for (const bad of ['ABCD234I', 'ABCD234O', 'ABCD2340', 'ABCD2341', 'ABCD234', 'ABCD23456', '', ' BCD2345']) {
      expect(parseOrderFragment(`#${bad}.${TOKEN}`), `number ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('refuses anything but exactly two parts', () => {
    expect(parseOrderFragment('')).toBeNull()
    expect(parseOrderFragment('#')).toBeNull()
    expect(parseOrderFragment(`#${NUMBER}`)).toBeNull()
    expect(parseOrderFragment(`#${TOKEN}`)).toBeNull()
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN}.extra`)).toBeNull()
    expect(parseOrderFragment(`#${NUMBER}.${TOKEN}.`)).toBeNull()
    expect(parseOrderFragment(`#test=${TOKEN}`)).toBeNull()
  })
})

/** A window with an address and a sessionStorage, which records what was stored and how the address was rewritten. */
function stubWindow(address: { hash: string; pathname?: string; search?: string }, stored: Record<string, string> = {}) {
  const storage: Record<string, string> = { ...stored }
  const replaceState = vi.fn()
  vi.stubGlobal('window', {
    location: { hash: address.hash, pathname: address.pathname ?? '/orders', search: address.search ?? '' },
    history: { state: { marker: 1 }, replaceState },
    sessionStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
    },
  })
  return { storage, replaceState }
}

describe('the order link in the address and in the tab', () => {
  it('stores a good link and takes the fragment out of the address bar, keeping path and query', () => {
    const { storage, replaceState } = stubWindow({ hash: `#${NUMBER}.${TOKEN}`, search: '?from=mail' })
    expect(takeOrderFragment()).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
    expect(JSON.parse(storage[ORDER_ACCESS_KEY]!)).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
    expect(replaceState).toHaveBeenCalledWith({ marker: 1 }, '', '/orders?from=mail')
    expect(readOrderAccess()).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
  })

  it('stores nothing for a fragment that is not a link, but still takes it out of the address bar', () => {
    const { storage, replaceState } = stubWindow({ hash: `#${NUMBER}.${TOKEN.slice(1)}` })
    expect(takeOrderFragment()).toBeNull()
    expect(storage[ORDER_ACCESS_KEY]).toBeUndefined()
    expect(replaceState).toHaveBeenCalledTimes(1)
  })

  it('touches nothing when there is no fragment', () => {
    const { storage, replaceState } = stubWindow({ hash: '' })
    expect(takeOrderFragment()).toBeNull()
    expect(takeFragment()).toBe('')
    expect(replaceState).not.toHaveBeenCalled()
    expect(Object.keys(storage)).toEqual([])
  })

  it('gives a notification link\'s whole fragment, once, and takes it out of the address bar', () => {
    const { storage, replaceState } = stubWindow({ hash: '#0aaa.token-value', pathname: '/notify/confirm' })
    expect(takeFragment()).toBe('0aaa.token-value')
    expect(replaceState).toHaveBeenCalledWith({ marker: 1 }, '', '/notify/confirm')
    // Nothing is stored: the token lives in the page's memory only.
    expect(Object.keys(storage)).toEqual([])
  })

  it('reads only a stored value that has the shapes the function issues, and forgets it on request', () => {
    const { storage } = stubWindow({ hash: '' }, { [ORDER_ACCESS_KEY]: JSON.stringify({ orderNumber: NUMBER, accessToken: TOKEN }) })
    expect(readOrderAccess()).toEqual({ orderNumber: NUMBER, accessToken: TOKEN })
    clearOrderAccess()
    expect(storage[ORDER_ACCESS_KEY]).toBeUndefined()
    expect(readOrderAccess()).toBeNull()

    for (const bad of ['not json', 'null', '[]', JSON.stringify({ orderNumber: NUMBER }), JSON.stringify({ orderNumber: 'abcd2345', accessToken: TOKEN }), JSON.stringify({ orderNumber: NUMBER, accessToken: 'short' })]) {
      stubWindow({ hash: '' }, { [ORDER_ACCESS_KEY]: bad })
      expect(readOrderAccess(), bad).toBeNull()
    }
  })

  it('works without a window (the static export renders the shell on the server)', () => {
    expect(takeOrderFragment()).toBeNull()
    expect(takeFragment()).toBe('')
    expect(readOrderAccess()).toBeNull()
    expect(() => clearOrderAccess()).not.toThrow()
  })
})

/** A complete `get` reply as the function answers it: the order's summary with its three extras, the payment, the items and the returns. */
function reply() {
  return {
    order: {
      id: '22222222-2222-4222-8222-222222222222',
      orderNumber: NUMBER,
      status: 'paid',
      holdExpiresAt: '2026-10-03T12:00:00.123456+00:00',
      subtotal: 4720,
      discount: 0,
      shipping: 1130,
      total: 5850,
      currency: 'SAR',
      environment: 'test',
      lines: [
        {
          sku: 'E2E-P',
          productTitle: 'كتاب الاختبار',
          variantTitle: 'النسخة الورقية',
          fulfillment: 'physical',
          quantity: 2,
          unitPrice: 2360,
          discount: 0,
          total: 4720,
          preorder: null,
        },
      ],
      paidAt: '2026-10-03T11:45:00.123456+00:00',
      refunded: 0,
      testMode: true,
    },
    payment: { state: 'paid' },
    items: [
      {
        itemId: ITEM_ID,
        title: 'كتاب الاختبار',
        variantTitle: 'النسخة الورقية',
        quantity: 2,
        fulfillment: 'physical',
        preorder: null,
        returnable: 2,
        state: 'shipped',
        carrier: 'SMSA',
        tracking: 'TRK-123',
      },
    ],
    returns: [{ id: '33333333-3333-4333-8333-333333333333', state: 'requested', createdAt: '2026-10-03T12:30:00.123456+00:00' }],
  }
}

/** The same reply with one object (found by `path`) changed in place. */
function changed(path: Array<string | number>, change: (target: Record<string, unknown>) => void, base: unknown = reply()): unknown {
  const copy = structuredClone(base) as Record<string, unknown>
  let node: unknown = copy
  for (const step of path) node = (node as Record<string | number, unknown>)[step]
  change(node as Record<string, unknown>)
  return copy
}

/** A reply that also has a preorder line with its file, and a payment with an invoice link. */
function richReply() {
  const rich = reply()
  rich.payment = { state: 'pending', invoiceUrl: 'https://pay.example.test/invoices/abc' } as typeof rich.payment
  rich.order.status = 'pending_payment'
  rich.items.push({
    itemId: OTHER_ID,
    title: 'كتاب إلكتروني',
    variantTitle: '',
    quantity: 1,
    fulfillment: 'digital',
    preorder: { shipsOn: '2026-12-01', note: 'يصل بعد الطباعة' },
    returnable: 0,
    download: { available: true, revoked: false },
  } as unknown as (typeof rich.items)[number])
  return rich
}

describe('parseOrderView', () => {
  it('reads a good reply into what the page shows', () => {
    expect(parseOrderView(reply())).toEqual({
      order: { orderNumber: NUMBER, status: 'paid', subtotal: 4720, discount: 0, shipping: 1130, total: 5850, refunded: 0, testMode: true },
      payment: { state: 'paid', invoiceUrl: null },
      items: [
        {
          itemId: ITEM_ID,
          title: 'كتاب الاختبار',
          variantTitle: 'النسخة الورقية',
          quantity: 2,
          fulfillment: 'physical',
          preorder: null,
          returnable: 2,
          state: 'shipped',
          carrier: 'SMSA',
          tracking: 'TRK-123',
          download: null,
        },
      ],
      returns: [{ id: '33333333-3333-4333-8333-333333333333', state: 'requested', createdAt: '2026-10-03T12:30:00.123456+00:00' }],
    })
  })

  it('reads the optional parts: the invoice link, a preorder, a download, and no shipment', () => {
    const view = parseOrderView(richReply())
    expect(view.payment).toEqual({ state: 'pending', invoiceUrl: 'https://pay.example.test/invoices/abc' })
    expect(view.items[1]).toMatchObject({
      preorder: { shipsOn: '2026-12-01', note: 'يصل بعد الطباعة' },
      download: { available: true, revoked: false },
      state: null,
      carrier: null,
      tracking: null,
    })
  })

  const LEVELS: Array<{ name: string; path: Array<string | number>; required: string[]; base?: () => unknown }> = [
    { name: 'the reply', path: [], required: ['order', 'payment', 'items', 'returns'] },
    {
      name: 'the order',
      path: ['order'],
      required: ['id', 'orderNumber', 'status', 'holdExpiresAt', 'subtotal', 'discount', 'shipping', 'total', 'currency', 'environment', 'lines', 'paidAt', 'refunded', 'testMode'],
    },
    {
      name: 'a line of the order summary',
      path: ['order', 'lines', 0],
      required: ['sku', 'productTitle', 'variantTitle', 'fulfillment', 'quantity', 'unitPrice', 'discount', 'total', 'preorder'],
    },
    { name: 'the payment', path: ['payment'], required: ['state'] },
    { name: 'an item', path: ['items', 0], required: ['itemId', 'title', 'variantTitle', 'quantity', 'fulfillment', 'preorder', 'returnable'] },
    { name: 'a return', path: ['returns', 0], required: ['id', 'state', 'createdAt'] },
    { name: 'a preorder', path: ['items', 1, 'preorder'], required: ['shipsOn', 'note'], base: richReply },
    { name: 'a download', path: ['items', 1, 'download'], required: ['available', 'revoked'], base: richReply },
  ]

  for (const level of LEVELS) {
    it(`refuses ${level.name} with a key missing, and with a key it does not know`, () => {
      const base = level.base ?? reply
      expect(() => parseOrderView(base())).not.toThrow()
      for (const key of level.required) {
        expect(() => parseOrderView(changed(level.path, (target) => delete target[key], base())), `without ${key}`).toThrow()
      }
      expect(() => parseOrderView(changed(level.path, (target) => (target.extra = 1), base())), 'with an unknown key').toThrow()
    })
  }

  it('refuses a value out of its set or of the wrong kind', () => {
    const refused: Array<[string, Array<string | number>, string, unknown]> = [
      ['an unknown order status', ['order'], 'status', 'shipped'],
      ['an order number that is not one', ['order'], 'orderNumber', 'abcd2345'],
      ['a fractional amount', ['order'], 'total', 12.5],
      ['a negative amount', ['order'], 'subtotal', -1],
      ['an amount as text', ['order'], 'shipping', '1130'],
      ['a refunded total as text', ['order'], 'refunded', '0'],
      ['test mode as text', ['order'], 'testMode', 'yes'],
      ['a hold time that is not a date', ['order'], 'holdExpiresAt', 'soon'],
      ['a paid time that is not a date', ['order'], 'paidAt', 'yesterday'],
      ['an order id that is not a uuid', ['order'], 'id', '123'],
      ['lines that are not a list', ['order'], 'lines', {}],
      ['a payment state out of its set', ['payment'], 'state', 'paidd'],
      ['the unknown payment state (an order that exists has a state)', ['payment'], 'state', 'unknown'],
      ['a link that is not http(s)', ['payment'], 'invoiceUrl', 'javascript:alert(1)'],
      ['a link that is not a url at all', ['payment'], 'invoiceUrl', 'pay now'],
      ['an item id that is not a uuid', ['items', 0], 'itemId', 'item-1'],
      ['a fractional quantity', ['items', 0], 'quantity', 1.5],
      ['a fulfilment out of its set', ['items', 0], 'fulfillment', 'download'],
      ['a shipment state out of its set', ['items', 0], 'state', 'lost'],
      ['a carrier that is not text', ['items', 0], 'carrier', 5],
      ['a tracking value that is not text', ['items', 0], 'tracking', ['TRK']],
      ['a returnable quantity as text', ['items', 0], 'returnable', '2'],
      ['a return state out of its set', ['returns', 0], 'state', 'closed'],
      ['a return time that is not a date', ['returns', 0], 'createdAt', 'later'],
    ]
    for (const [name, path, key, value] of refused) {
      const base = path[0] === 'payment' && key === 'invoiceUrl' ? richReply() : reply()
      expect(() => parseOrderView(changed(path, (target) => (target[key] = value), base)), name).toThrow()
    }
    expect(() => parseOrderView(changed(['items', 1, 'preorder'], (target) => (target.shipsOn = 'soon'), richReply())), 'a preorder date that is not a date').toThrow()
    expect(() => parseOrderView(changed(['items', 1, 'download'], (target) => (target.available = 'yes'), richReply())), 'a download flag as text').toThrow()
  })

  it('refuses a reply that is not an object of the right shape at all', () => {
    for (const bad of [undefined, null, 'ok', 7, [], [reply()], { ...reply(), items: {} }, { ...reply(), returns: null }, { ...reply(), items: [null] }]) {
      expect(() => parseOrderView(bad), JSON.stringify(bad)?.slice(0, 40)).toThrow()
    }
  })

  it('takes every status and state the contract names, and a paid time or none', () => {
    for (const status of ORDER_STATUSES) expect(parseOrderView(changed(['order'], (target) => (target.status = status))).order.status).toBe(status)
    for (const state of PAYMENT_STATES) expect(parseOrderView(changed(['payment'], (target) => (target.state = state))).payment.state).toBe(state)
    for (const state of RETURN_STATES) expect(parseOrderView(changed(['returns', 0], (target) => (target.state = state))).returns[0]!.state).toBe(state)
    expect(() => parseOrderView(changed(['order'], (target) => (target.paidAt = null)))).not.toThrow()
  })
})

describe('the status sentence', () => {
  it('has the words of the brief, once each', () => {
    expect(STATUS_SENTENCES).toEqual({
      paid: 'مدفوع.',
      pending: 'بانتظار الدفع.',
      review: 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.',
      refunded: 'أُعيد مبلغ هذا الطلب.',
      expired: 'انتهت مدة حجز الطلب.',
      cancelled: 'أُلغي الطلب.',
    })
  })

  it('is the right one for each state an order can really be in', () => {
    // [order status, payment state, what it says]: what `order_access` can answer.
    const real = [
      ['paid', 'paid', 'paid'],
      ['pending_payment', 'pending', 'pending'],
      ['pending_payment', 'review', 'review'],
      ['paid_needs_resolution', 'needs_resolution', 'review'],
      ['refunded', 'refunded', 'refunded'],
      ['expired', 'expired', 'expired'],
      ['expired', 'review', 'review'],
      // The hold ended but the attempt is still open (the job closes it later): the payment may still settle.
      ['expired', 'pending', 'pending'],
      ['cancelled', 'cancelled', 'cancelled'],
      ['cancelled', 'review', 'review'],
    ] as const
    for (const [status, payment, kind] of real) expect(statusKind(status, payment), `${status} / ${payment}`).toBe(kind)
  })

  it('says one of the six sentences for every combination, and «مدفوع» only for an order whose own status is paid', () => {
    for (const status of ORDER_STATUSES) {
      for (const payment of PAYMENT_STATES) {
        const kind = statusKind(status, payment)
        expect(Object.keys(STATUS_SENTENCES)).toContain(kind)
        if (kind === 'paid') expect(status, `${status} / ${payment}`).toBe('paid')
        // A payment under review is always said so; a refund is never hidden behind another word.
        const underReview = status === 'paid_needs_resolution' || payment === 'needs_resolution' || payment === 'review'
        if (underReview) expect(kind, `${status} / ${payment}`).toBe('review')
        else if (status === 'refunded' || payment === 'refunded') expect(kind, `${status} / ${payment}`).toBe('refunded')
      }
    }
  })
})

describe('words for the lines and the returns', () => {
  it('names a shipment and a return in the words of the brief', () => {
    expect(FULFILLMENT_LABELS).toEqual({ preparing: 'قيد التجهيز', shipped: 'شُحن', delivered: 'سُلّم' })
    expect(RETURN_LABELS).toMatchObject({ requested: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض', received: 'استُلم' })
    // The contract's fifth state (a refund linked to the return succeeded) has a label too.
    for (const state of RETURN_STATES) expect(RETURN_LABELS[state], state).not.toBe('')
  })

  it('names a line by its product and, when it has one, its variant', () => {
    expect(lineName({ title: 'كتاب', variantTitle: 'ورقية' })).toBe('كتاب: ورقية')
    expect(lineName({ title: 'كتاب', variantTitle: '' })).toBe('كتاب')
  })
})

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    itemId: ITEM_ID,
    title: 'كتاب',
    variantTitle: 'ورقية',
    quantity: 3,
    fulfillment: 'physical',
    preorder: null,
    returnable: 3,
    state: 'shipped',
    carrier: null,
    tracking: null,
    download: null,
    ...overrides,
  }
}

describe('the return request', () => {
  it('offers only the lines with something left to return', () => {
    const items = [line({ returnable: 0 }), line({ itemId: OTHER_ID, returnable: 2 })]
    expect(returnableItems(items).map((item) => item.itemId)).toEqual([OTHER_ID])
    expect(returnableItems([line({ returnable: 0 })])).toEqual([])
  })

  it('reads a quantity field as a whole number from 0 to what is returnable', () => {
    expect(clampQuantity('2', 3)).toBe(2)
    expect(clampQuantity('7', 3)).toBe(3)
    expect(clampQuantity('-1', 3)).toBe(0)
    expect(clampQuantity('1.9', 3)).toBe(1)
    expect(clampQuantity('', 3)).toBe(0)
    expect(clampQuantity('abc', 3)).toBe(0)
    expect(clampQuantity('Infinity', 3)).toBe(0)
  })

  it('sends only the chosen lines, each within its own limit, and nothing when nothing is chosen', () => {
    const items = [line({ returnable: 3 }), line({ itemId: OTHER_ID, returnable: 1 }), line({ itemId: '55555555-5555-4555-8555-555555555555', returnable: 0 })]
    expect(returnRequestItems(items, {})).toEqual([])
    expect(returnRequestItems(items, { [ITEM_ID]: '0', [OTHER_ID]: '' })).toEqual([])
    expect(returnRequestItems(items, { [ITEM_ID]: '2', [OTHER_ID]: '5' })).toEqual([
      { itemId: ITEM_ID, quantity: 2 },
      { itemId: OTHER_ID, quantity: 1 },
    ])
    // A line with nothing returnable is never sent, whatever the field says.
    expect(returnRequestItems(items, { '55555555-5555-4555-8555-555555555555': '1' })).toEqual([])
    // A quantity for a line the order does not have is not sent either.
    expect(returnRequestItems(items, { 'ffffffff-ffff-4fff-8fff-ffffffffffff': '1' })).toEqual([])
  })

  it('reads the reason as one line, as the function does', () => {
    expect(normalizeReason('  وصل  تالفًا\n\nوالغلاف\tممزق  ')).toBe('وصل تالفًا والغلاف ممزق')
    expect(normalizeReason('a\u0000b\u0085c')).toBe('a b c')
    expect(normalizeReason(' \n\t ')).toBe('')
  })
})

/** Stubs `fetch` with replies in turn (the last one repeats) and records what was sent. */
function stubFetch(...replies: Array<{ status?: number; body: unknown } | 'reject'>) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  const sent: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
  let turn = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; body: string }) => {
      sent.push({ url, method: init.method, body: JSON.parse(init.body) as Record<string, unknown> })
      const next = replies[Math.min(turn, replies.length - 1)]!
      turn += 1
      if (next === 'reject') throw new TypeError('fetch failed')
      return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 })
    }),
  )
  return sent
}

const ACCESS = { orderNumber: NUMBER, accessToken: TOKEN }
const refusal = (status: number, code: string, message = 'رسالة') => ({ status, body: { ok: false, error: { code, message } } })

describe('fetchOrder', () => {
  it('asks `orders` with the number and the token, and answers the parsed view', async () => {
    const sent = stubFetch({ body: { ok: true, data: reply() } })
    const outcome = await fetchOrder(ACCESS)
    expect(sent).toEqual([
      { url: 'http://127.0.0.1:54321/functions/v1/orders', method: 'POST', body: { action: 'get', orderNumber: NUMBER, accessToken: TOKEN } },
    ])
    expect(outcome).toEqual({ view: parseOrderView(reply()) })
  })

  it('tells a missing order from a throttle from everything else', async () => {
    stubFetch(refusal(404, 'NOT_FOUND'))
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'missing' })
    stubFetch(refusal(429, 'RATE_LIMITED'))
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'limit' })
    stubFetch(refusal(503, 'UNAVAILABLE'))
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
    stubFetch(refusal(500, 'FAILED'))
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
  })

  it('reads a lost connection, a reply that is not JSON and a reply that does not parse as the network sentence\'s case', async () => {
    stubFetch('reject')
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
    stubFetch({ body: '<html>bad gateway</html>', status: 502 })
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
    stubFetch({ body: { ok: true, data: { ...reply(), extra: 1 } } })
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
    stubFetch({ body: { ok: true } })
    expect(await fetchOrder(ACCESS)).toEqual({ failure: 'network' })
  })

  it('classifies a status', () => {
    expect([404, 429, 503, 500, 400, 200].map(failureOf)).toEqual(['missing', 'limit', 'network', 'network', 'network', 'network'])
  })
})

describe('the small replies, by their exact shape', () => {
  const RETURN_ID = '44444444-4444-4444-8444-444444444444'
  it('reads a filed return only from a 201 that names it', () => {
    expect(isFiled({ status: 201, ok: true, data: { returnId: RETURN_ID } })).toBe(true)
    for (const reply of [
      { status: 201, ok: true, data: {} },
      { status: 201, ok: true, data: { returnId: 'x' } },
      { status: 201, ok: true, data: { returnId: RETURN_ID, extra: 1 } },
      { status: 200, ok: true, data: { returnId: RETURN_ID } },
      { status: 201, ok: false, data: { returnId: RETURN_ID } },
    ]) {
      expect(isFiled(reply), JSON.stringify(reply)).toBe(false)
    }
  })
  it('reads a sent recovery only from 200 {sent: true}', () => {
    expect(isSent({ status: 200, ok: true, data: { sent: true } })).toBe(true)
    for (const data of [{}, { sent: false }, { sent: 'true' }, { sent: true, extra: 1 }, null]) {
      expect(isSent({ status: 200, ok: true, data }), JSON.stringify(data)).toBe(false)
    }
  })
  it('reads a link action only from 200 {status}', () => {
    expect(notifyStatus({ status: 200, ok: true, data: { status: 'confirmed' } })).toBe('confirmed')
    for (const data of [{}, { status: 1 }, { status: 'confirmed', extra: 1 }, null]) {
      expect(notifyStatus({ status: 200, ok: true, data }), JSON.stringify(data)).toBeNull()
    }
    expect(notifyStatus({ status: 404, ok: false, data: { status: 'confirmed' } })).toBeNull()
  })
})

describe('formProblem', () => {
  it('shows the function\'s own message, else a short one', () => {
    expect(formProblem({ status: 409, ok: false, error: { code: 'NOT_RETURNABLE', message: 'لا يمكن.' } })).toBe('لا يمكن.')
    expect(formProblem({ status: 429, ok: false })).toBe('حاول بعد قليل.')
    expect(formProblem({ status: 429, ok: false, error: { message: '' } })).toBe('حاول بعد قليل.')
    expect(formProblem({ status: 500, ok: false })).toBe('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')
  })
})

describe('requestDownload', () => {
  const issued = { body: { ok: true, data: { downloadToken: DOWNLOAD_TOKEN, expiresAt: '2026-10-03T12:15:00.000Z' } } }
  const redeemed = { body: { ok: true, data: { url: 'https://files.example.test/object/sign/paid-files/assets/x?token=t&download=b.pdf' } } }

  it('issues with the order token, then redeems with the download token it got, and answers the file url', async () => {
    const sent = stubFetch(issued, redeemed)
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ url: 'https://files.example.test/object/sign/paid-files/assets/x?token=t&download=b.pdf' })
    expect(sent.map((call) => call.url)).toEqual(['http://127.0.0.1:54321/functions/v1/download', 'http://127.0.0.1:54321/functions/v1/download'])
    expect(sent[0]!.body).toEqual({ action: 'issue', orderNumber: NUMBER, accessToken: TOKEN, itemId: ITEM_ID })
    expect(sent[1]!.body).toEqual({ action: 'redeem', downloadToken: DOWNLOAD_TOKEN })
  })

  it('says why a file did not come: the daily limit, a throttle, a file that is gone, the network', async () => {
    stubFetch(refusal(429, 'TOO_MANY_DOWNLOADS'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.', refresh: false })
    stubFetch(refusal(429, 'RATE_LIMITED'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'حاول بعد قليل.', refresh: false })
    // A refund or a revocation may have taken it: the order is worth reading again.
    stubFetch(refusal(404, 'NOT_FOUND'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'تعذّر تنزيل الملف.', refresh: true })
    stubFetch(refusal(500, 'FAILED'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.', refresh: false })
    stubFetch('reject')
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.', refresh: false })
  })

  it('stops at the second call when it is refused, and reads its refusal the same way', async () => {
    const sent = stubFetch(issued, refusal(404, 'NOT_FOUND'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toEqual({ problem: 'تعذّر تنزيل الملف.', refresh: true })
    expect(sent).toHaveLength(2)
    stubFetch(issued, refusal(429, 'TOO_MANY_DOWNLOADS'))
    expect(await requestDownload(ACCESS, ITEM_ID)).toMatchObject({ refresh: false })
  })

  it('never follows a reply that does not fit: no download token, a malformed one, no url, a url that is not http(s)', async () => {
    const bad: Array<unknown[]> = [
      [{ body: { ok: true, data: {} } }],
      [{ body: { ok: true, data: { downloadToken: 'short', expiresAt: 'x' } } }],
      [{ body: { ok: true, data: { downloadToken: DOWNLOAD_TOKEN, expiresAt: 'x', extra: 1 } } }],
      [issued, { body: { ok: true, data: {} } }],
      [issued, { body: { ok: true, data: { url: 'javascript:alert(1)' } } }],
      [issued, { body: { ok: true, data: { url: 'https://x.test/f', extra: 1 } } }],
    ]
    for (const replies of bad) {
      stubFetch(...(replies as Parameters<typeof stubFetch>))
      expect(await requestDownload(ACCESS, ITEM_ID), JSON.stringify(replies).slice(0, 60)).toEqual({ problem: 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.', refresh: false })
    }
  })
})
