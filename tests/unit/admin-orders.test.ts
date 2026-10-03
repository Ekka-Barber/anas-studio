// P08 round 11a: the staff's order screens, the parts that need no React
// (`src/lib/admin-orders.ts`): the Arabic words of every state, the strict
// parsers of `orders_list`, `order_detail` and `orders_alerts` against the exact
// shapes round 7b documents (artifacts/acceptance/P08/rounds/round-07b.md), the
// reading of the action replies and their sentences, and the search box's
// normalization. The screens themselves are proven in tests/e2e/orders-admin.spec.ts.
import { describe, expect, it, vi } from 'vitest'

import { isWidePath } from '../../src/components/admin/AdminShell'
import {
  alertCounts,
  ATTEMPT_STATUS_LABELS,
  FULFILLMENT_STATE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  isUuid,
  labelOf,
  normalizeOrderQuery,
  ORDER_FILTER_LABELS,
  ORDER_FILTERS,
  ORDER_STATUS_LABELS,
  parseActionReply,
  parseOrderDetail,
  parseOrdersAlerts,
  parseOrdersList,
  REFUND_SOURCE_LABELS,
  REFUND_STATUS_LABELS,
  refusalText,
  RETURN_STATE_LABELS,
  REVIEW_REASON_LABELS,
  SAVE_FAILED,
  type OrderAction,
  type Refusal,
} from '../../src/lib/admin-orders'

// AdminShell imports through the `@/` alias, which the unit config does not resolve.
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({}) }))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'
const E = '55555555-5555-4555-8555-555555555555'
const F = '66666666-6666-4666-8666-666666666666'
const G = '77777777-7777-4777-8777-777777777777'
const H = '88888888-8888-4888-8888-888888888888'
const ISO = '2026-10-03T12:00:00.123456+00:00'
const INVOICE = '99999999-9999-4999-8999-999999999999'
const PAYMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('the words of every state', () => {
  const tables: Array<[string, Readonly<Record<string, string>>, Record<string, string>]> = [
    [
      'order status',
      ORDER_STATUS_LABELS,
      {
        pending_payment: 'بانتظار الدفع',
        expired: 'انتهت المهلة',
        cancelled: 'ملغى',
        paid: 'مدفوع',
        paid_needs_resolution: 'مدفوع: يحتاج حلًا',
        refunded: 'مُعاد',
      },
    ],
    [
      'filter',
      ORDER_FILTER_LABELS,
      {
        all: 'الكل',
        paid: 'المدفوعة',
        to_ship: 'للشحن',
        needs_resolution: 'تحتاج حلًا',
        pending: 'بانتظار الدفع',
        refunded: 'المُعادة',
        review: 'قيد المراجعة',
      },
    ],
    ['fulfilment type', FULFILLMENT_TYPE_LABELS, { digital: 'رقمي', physical: 'ورقي', signed: 'موقّع' }],
    ['fulfilment state', FULFILLMENT_STATE_LABELS, { preparing: 'قيد التجهيز', shipped: 'شُحن', delivered: 'سُلِّم' }],
    [
      'return state',
      RETURN_STATE_LABELS,
      { requested: 'مطلوب', approved: 'مقبول', rejected: 'مرفوض', received: 'مُستلَم', refunded: 'أُعيد المبلغ' },
    ],
    [
      'attempt status',
      ATTEMPT_STATUS_LABELS,
      {
        creating: 'قيد الإنشاء',
        pending: 'بانتظار الدفع',
        uncertain: 'غير مؤكد',
        paid: 'مدفوع',
        review: 'قيد المراجعة',
        failed: 'رفضه المزوّد',
        expired: 'انتهى',
        cancelled: 'ملغى',
        abandoned: 'متروك',
      },
    ],
    [
      'review reason',
      REVIEW_REASON_LABELS,
      {
        AMOUNT_MISMATCH: 'مبلغ مختلف',
        CURRENCY_MISMATCH: 'عملة مختلفة',
        UNEXPECTED_STATUS: 'حالة غير متوقعة',
        SECOND_PAYMENT: 'دفعة ثانية على فاتورة مدفوعة',
        ORDER_ALREADY_PAID: 'الطلب مدفوع بدفعة أخرى',
        UNMAPPED_INVOICE: 'فاتورة غير مرتبطة بطلب',
      },
    ],
    ['refund status', REFUND_STATUS_LABELS, { submitting: 'قيد الإرسال', uncertain: 'غير مؤكد', succeeded: 'تم', failed: 'لم يتم' }],
    ['refund source', REFUND_SOURCE_LABELS, { admin: 'من اللوحة', provider_dashboard: 'من لوحة Moyasar' }],
  ]

  it.each(tables)('%s: every value has its word, and no other', (_name, labels, expected) => {
    expect({ ...labels }).toEqual(expected)
    for (const [code, word] of Object.entries(expected)) expect(labelOf(labels, code)).toBe(word)
  })

  it.each(tables)('%s: a value it does not know is its own code, never blank and never an exception', (_name, labels) => {
    expect(labelOf(labels, 'something_new')).toBe('something_new')
    // Not what an object inherits: «constructor» is a word nobody defined.
    for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(labelOf(labels, inherited)).toBe(inherited)
  })

  it('lists the seven filters, «الكل» first', () => {
    expect(ORDER_FILTERS).toEqual(['all', 'paid', 'to_ship', 'needs_resolution', 'pending', 'refunded', 'review'])
  })
})

describe('the shell is wide for the orders list and an order view', () => {
  it('reads the width from the path', () => {
    for (const path of ['/admin/orders', '/admin/orders/', '/admin/orders/view', '/admin/orders/view/']) {
      expect(isWidePath(path), path).toBe(true)
    }
    for (const path of ['/admin/orders/reconciliation', '/admin/order', '/admin/ordersx']) expect(isWidePath(path), path).toBe(false)
  })
})

describe('normalizeOrderQuery', () => {
  it('upper-cases an order number and trims the spaces around it', () => {
    expect(normalizeOrderQuery('abcd2345')).toBe('ABCD2345')
    expect(normalizeOrderQuery('  Abcd2345  ')).toBe('ABCD2345')
    expect(normalizeOrderQuery('ABCD2345')).toBe('ABCD2345')
  })

  it('lower-cases an email, as the SQL hashes it, and trims it', () => {
    expect(normalizeOrderQuery('  Buyer.Name+Tag@Example.COM ')).toBe('buyer.name+tag@example.com')
    expect(normalizeOrderQuery('a@b.sa')).toBe('a@b.sa')
  })

  it('is empty for nothing typed: no search', () => {
    expect(normalizeOrderQuery('')).toBe('')
    expect(normalizeOrderQuery('   ')).toBe('')
  })

  it('is null for anything that is neither: the SQL raises 22023 for it', () => {
    // Not the 8 characters of a number: too short, too long, or a letter the numbers never use (0, 1, I, O).
    for (const text of ['ABCD234', 'ABCD23456', 'ABCD1234', 'ABCDO345', 'ABCI2345', 'ABCD 2345', 'ابحث عن طلب']) {
      expect(normalizeOrderQuery(text), text).toBeNull()
    }
    // Not an address.
    for (const text of ['buyer', 'buyer@', '@example.com', 'buyer@example', 'buyer@example.c', 'a b@example.com', 'buyer@exam ple.com', 'مشتر@example.com']) {
      expect(normalizeOrderQuery(text), text).toBeNull()
    }
    // An address past 254 characters.
    expect(normalizeOrderQuery(`${'a'.repeat(64)}@${'b'.repeat(190)}.com`)).toBeNull()
    expect(normalizeOrderQuery(`${'a'.repeat(64)}@${'b'.repeat(120)}.com`)).toBe(`${'a'.repeat(64)}@${'b'.repeat(120)}.com`)
  })
})

describe('isUuid', () => {
  it('accepts the database spelling and nothing else', () => {
    expect(isUuid(A)).toBe(true)
    for (const text of ['', 'new', PAYMENT.toUpperCase(), `${A}x`, A.slice(1), 'null']) expect(isUuid(text), text).toBe(false)
  })
})

// --- fixtures: the exact keys of round 7b (the SHAPE lines of its report, read against the SQL) ---------------------

const row = {
  id: A,
  orderNumber: 'ABCD2345',
  status: 'paid',
  environment: 'test',
  createdAt: ISO,
  paidAt: ISO,
  total: 10500,
  name: 'مشترٍ',
  email: 'buyer@example.com',
  items: 3,
  toShip: 2,
  refunded: 0,
  review: false,
}
const list = { rows: [row], next: ISO }

const alerts = {
  needsResolution: 1,
  review: 2,
  toShip: 3,
  uncertainRefunds: 4,
  unverifiedAttempts: 5,
  exhaustedEvents: 6,
  externalRefunds: 7,
  lowStock: [{ variantId: A, sku: 'SKU-1', title: 'كتاب', stock: 1, threshold: 5 }],
}

function detail(owner: boolean): Record<string, unknown> {
  const base = {
    ok: true,
    order: {
      id: A,
      orderNumber: 'ABCD2345',
      status: 'paid',
      environment: 'test',
      createdAt: ISO,
      updatedAt: ISO,
      paidAt: ISO,
      holdExpiresAt: ISO,
      subtotal: 9000,
      discount: 900,
      shipping: 2500,
      total: 10600,
      currency: 'SAR',
      couponCode: 'SAVE10',
      refunded: 1000,
      contact: { name: 'مشترٍ', email: 'buyer@example.com', phone: '966501234567' },
      delivery: { cityKey: 'tabuk', city: 'تبوك', address: 'تبوك شارع الرئيسي' },
    },
    items: [
      {
        id: B,
        lineNo: 1,
        sku: 'SKU-1',
        productTitle: 'كتاب',
        variantTitle: 'موقّع',
        fulfillment: 'signed',
        quantity: 1,
        unitPrice: 9000,
        discount: 900,
        total: 8100,
        dedication: 'إلى أنس',
        preorder: null,
        refunded: 1000,
        fullyRefunded: false,
      },
      {
        id: C,
        lineNo: 2,
        sku: 'SKU-2',
        productTitle: 'كتاب',
        variantTitle: 'رقمي',
        fulfillment: 'digital',
        quantity: 1,
        unitPrice: 3500,
        discount: 0,
        total: 3500,
        dedication: null,
        preorder: { shipsOn: '2030-01-01', note: 'يصلك بعد الطباعة' },
        refunded: 0,
        fullyRefunded: false,
      },
    ],
    attempts: [
      {
        id: D,
        orderId: A,
        status: 'paid',
        environment: 'test',
        amount: 10600,
        currency: 'SAR',
        providerInvoiceId: INVOICE,
        providerPaymentId: PAYMENT,
        providerStatus: 'paid',
        providerRefunded: 1000,
        captured: 10600,
        fee: 150,
        sourceType: 'creditcard',
        sourceCompany: 'mada',
        invoiceExpiresAt: ISO,
        paidAt: ISO,
        fetchedAt: ISO,
        checkCount: 1,
        errorCount: 0,
        lastError: null,
        createdAt: ISO,
      },
    ],
    reviews: [
      {
        paymentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        invoiceId: INVOICE,
        attemptId: D,
        orderId: A,
        environment: 'test',
        amount: 10600,
        currency: 'SAR',
        providerStatus: 'paid',
        reason: 'SECOND_PAYMENT',
        providerRefunded: 0,
        refunded: 0,
        closedAt: null,
        closedReason: null,
        createdAt: ISO,
      },
    ],
    events: [
      {
        eventId: 'evt-1',
        type: 'payment_paid',
        live: false,
        paymentId: PAYMENT,
        receivedAt: ISO,
        processedAt: ISO,
        outcome: 'paid',
        error: null,
        attempts: 1,
        nextCheckAt: null,
      },
    ],
    fulfillments: [
      { id: E, itemId: B, state: 'preparing', carrier: null, tracking: null, dedicationDone: false, shippedAt: null, deliveredAt: null, updatedAt: ISO },
    ],
    entitlements: [{ id: F, itemId: C, grantedAt: ISO, revokedAt: null, revokeReason: null, hasFile: false, filename: null }],
    refunds: [
      {
        id: G,
        orderId: A,
        attemptId: D,
        reviewPaymentId: null,
        returnId: null,
        status: 'succeeded',
        amount: 1000,
        reason: 'استرداد',
        source: 'admin',
        allocation: { items: [{ itemId: B, amount: 1000 }], shipping: 0 },
        providerRefundedBefore: 0,
        providerRefundedAfter: 1000,
        error: null,
        nextCheckAt: null,
        createdAt: ISO,
        succeededAt: ISO,
      },
    ],
    returns: [
      { id: H, state: 'requested', items: [{ itemId: B, quantity: 1 }], reason: 'سبب', staffNote: null, restocked: null, refundId: null, createdAt: ISO, updatedAt: ISO },
    ],
  }
  if (!owner) return base
  return {
    ...base,
    disputes: [
      {
        id: A,
        kind: 'chargeback',
        providerRef: 'CB-1',
        seq: 1,
        attemptId: D,
        reviewPaymentId: null,
        environment: 'test',
        amount: 500,
        direction: 'against_seller',
        occurredOn: '2026-10-02',
        reason: 'نزاع',
        resolution: null,
        decision: 'none',
        itemIds: [B],
        createdAt: ISO,
      },
    ],
    audit: [{ id: 7, at: ISO, actor: A, action: 'order.paid', entity: 'order', entityId: A, summary: { orderNumber: 'ABCD2345' } }],
  }
}

type Path = Array<string | number>
/** Free-form jsonb in the reply: the parser takes it as an object and looks no deeper. */
const OPAQUE = new Set(['allocation', 'summary'])

/** Every value of the fixture that the parser reads, as the path to it. */
function leaves(value: unknown, path: Path = []): Path[] {
  if (OPAQUE.has(String(path[path.length - 1]))) return [path]
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, [...path, index]))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) => leaves(entry, [...path, key]))
  }
  return [path]
}

/** A copy of `fixture` with the value at `path` removed (`undefined`) or replaced. */
function changed(fixture: unknown, path: Path, replacement: unknown): unknown {
  const copy = structuredClone(fixture) as Record<string | number, unknown>
  let at: Record<string | number, unknown> = copy
  for (const step of path.slice(0, -1)) at = at[step] as Record<string | number, unknown>
  const last = path[path.length - 1]!
  if (replacement === undefined) delete at[last]
  else at[last] = replacement
  return copy
}
const label = (path: Path): string => path.join('.')

/** Optional in the reply: the owner's two lists (an operations reply has neither key). */
const OPTIONAL = new Set(['disputes', 'audit'])

function expectStrict(parse: (value: unknown) => unknown, fixture: unknown, optional: ReadonlySet<string> = new Set()): void {
  expect(() => parse(fixture), 'the documented shape').not.toThrow()
  const paths = leaves(fixture)
  expect(paths.length).toBeGreaterThan(5)
  for (const path of paths) {
    // A missing key is refused (an element of a list cannot go missing on its own).
    if (typeof path[path.length - 1] === 'string' && !(path.length === 1 && optional.has(path[0] as string))) {
      expect(() => parse(changed(fixture, path, undefined)), `missing ${label(path)}`).toThrow()
    }
    // A value of the wrong type is refused: -1.5 is no string, no id, no boolean, no object, no list, no whole number.
    expect(() => parse(changed(fixture, path, -1.5)), `wrong type at ${label(path)}`).toThrow()
  }
}

describe('parseOrdersList', () => {
  it('reads the rows and the cursor as they are', () => {
    const page = parseOrdersList(list)
    expect(page.next).toBe(ISO)
    expect(page.rows).toEqual([row])
    expect(parseOrdersList({ rows: [], next: null })).toEqual({ rows: [], next: null })
    expect(parseOrdersList({ rows: [{ ...row, paidAt: null }], next: null }).rows[0]!.paidAt).toBeNull()
  })

  it('refuses a missing key or a wrong type, in the page and in every row', () => {
    expectStrict(parseOrdersList, list)
  })

  it('refuses an order number that is not one, money that is not a whole number of halalas, a time nobody can read', () => {
    for (const bad of [{ orderNumber: 'abcd2345' }, { orderNumber: 'ABCD1234' }, { total: 10.5 }, { total: -1 }, { total: '10500' }, { createdAt: 'yesterday' }, { createdAt: '1' }, { createdAt: '2026' }, { createdAt: 'Oct 3 2026' }, { createdAt: '2026-10-03 01:03' }, { id: 'x' }, { review: 'false' }]) {
      expect(() => parseOrdersList({ rows: [{ ...row, ...bad }], next: null }), JSON.stringify(bad)).toThrow()
    }
    expect(() => parseOrdersList({ rows: {}, next: null })).toThrow()
    expect(() => parseOrdersList(null)).toThrow()
    expect(() => parseOrdersList([])).toThrow()
  })

  it('ignores keys it does not know', () => {
    expect(() => parseOrdersList({ ...list, extra: 1, rows: [{ ...row, extra: true }] })).not.toThrow()
  })

  it('keeps an unknown status and environment as they come (the screen shows the code)', () => {
    expect(parseOrdersList({ rows: [{ ...row, status: 'something_new', environment: 'staging' }], next: null }).rows[0]).toMatchObject({
      status: 'something_new',
      environment: 'staging',
    })
  })
})

describe('parseOrdersAlerts and alertCounts', () => {
  it('reads the counts and the low-stock list', () => {
    expect(parseOrdersAlerts(alerts)).toEqual(alerts)
    expect(parseOrdersAlerts({ ...alerts, lowStock: [], extra: 1 }).lowStock).toEqual([])
  })

  it('refuses a missing key or a wrong type', () => {
    expectStrict(parseOrdersAlerts, alerts)
    expect(() => parseOrdersAlerts({ ...alerts, toShip: 1.5 })).toThrow()
    expect(() => parseOrdersAlerts({ ...alerts, toShip: '3' })).toThrow()
  })

  it('counts three things for operations and a fourth, the sum of what needs reconciling, for the owner alone', () => {
    const parsed = parseOrdersAlerts(alerts)
    expect(alertCounts(parsed, false)).toEqual([
      { label: 'تحتاج حلًا', value: 1 },
      { label: 'للشحن', value: 3 },
      { label: 'دفعات قيد المراجعة', value: 2 },
    ])
    expect(alertCounts(parsed, true)).toEqual([
      { label: 'تحتاج حلًا', value: 1 },
      { label: 'للشحن', value: 3 },
      { label: 'دفعات قيد المراجعة', value: 2 },
      // uncertainRefunds 4 + unverifiedAttempts 5 + exhaustedEvents 6 + externalRefunds 7
      { label: 'تحتاج مطابقة', value: 22 },
    ])
  })
})

describe('parseOrderDetail', () => {
  it("reads the owner's reply, with the disputes and the audit", () => {
    const reply = parseOrderDetail(detail(true))
    expect(reply.found).toBe(true)
    if (!reply.found) return
    expect(reply.detail.order).toMatchObject({ orderNumber: 'ABCD2345', total: 10600, couponCode: 'SAVE10', contact: { phone: '966501234567' } })
    expect(reply.detail.items.map((item) => item.sku)).toEqual(['SKU-1', 'SKU-2'])
    expect(reply.detail.items[1]!.preorder).toEqual({ shipsOn: '2030-01-01', note: 'يصلك بعد الطباعة' })
    expect(reply.detail.disputes).toHaveLength(1)
    expect(reply.detail.audit).toHaveLength(1)
    expect(reply.detail.audit![0]!.summary).toEqual({ orderNumber: 'ABCD2345' })
  })

  it("reads the operations reply, which has neither of the owner's keys: both are null, not empty", () => {
    const reply = parseOrderDetail(detail(false))
    expect(reply.found).toBe(true)
    if (!reply.found) return
    expect(reply.detail.disputes).toBeNull()
    expect(reply.detail.audit).toBeNull()
    expect(reply.detail.returns).toHaveLength(1)
  })

  it("tells an owner's empty list from an operations reply with none", () => {
    const reply = parseOrderDetail({ ...detail(false), disputes: [], audit: [] })
    expect(reply.found && reply.detail.disputes).toEqual([])
    expect(reply.found && reply.detail.audit).toEqual([])
  })

  it("refuses a missing key or a wrong type anywhere in the owner's reply", () => {
    expectStrict(parseOrderDetail, detail(true), OPTIONAL)
  })

  it('refuses a missing key or a wrong type anywhere in the operations reply', () => {
    expectStrict(parseOrderDetail, detail(false))
  })

  it('accepts the values a nullable column can hold, and refuses the ones it cannot', () => {
    const base = detail(false) as { order: Record<string, unknown>; attempts: Array<Record<string, unknown>> }
    // A digital-only order has no city and no address, and a buyer may have no phone.
    const digital = {
      ...base,
      order: { ...base.order, couponCode: null, contact: { name: 'م', email: 'a@b.sa', phone: null }, delivery: { cityKey: null, city: null, address: null } },
    }
    expect(() => parseOrderDetail(digital)).not.toThrow()
    // A pending attempt has no invoice, no payment, no amounts yet.
    const pending = {
      ...base,
      attempts: [{ ...base.attempts[0], providerInvoiceId: null, providerPaymentId: null, providerStatus: null, captured: null, fee: null, sourceType: null, sourceCompany: null, paidAt: null, fetchedAt: null }],
    }
    expect(() => parseOrderDetail(pending)).not.toThrow()
    // The hold's end is always there; a refunded amount is a whole number.
    expect(() => parseOrderDetail({ ...base, order: { ...base.order, holdExpiresAt: null } })).toThrow()
    expect(() => parseOrderDetail({ ...base, order: { ...base.order, refunded: 1000.5 } })).toThrow()
  })

  it('answers «not found» for NOT_FOUND, and refuses any other refusal or a reply of another shape', () => {
    expect(parseOrderDetail({ ok: false, code: 'NOT_FOUND' })).toEqual({ found: false })
    for (const reply of [{ ok: false, code: 'FORBIDDEN' }, { ok: false }, { code: 'NOT_FOUND' }, { ok: 'true' }, null, [], 'x', {}]) {
      expect(() => parseOrderDetail(reply), JSON.stringify(reply)).toThrow()
    }
  })

  it('ignores keys it does not know', () => {
    const fixture = detail(true) as { order: Record<string, unknown>; items: Array<Record<string, unknown>> }
    expect(() => parseOrderDetail({ ...fixture, extra: 1, order: { ...fixture.order, extra: 1 }, items: [{ ...fixture.items[0], extra: 1 }, fixture.items[1]] })).not.toThrow()
  })

  it('keeps an unknown enum value as it comes', () => {
    const fixture = detail(true) as { attempts: Array<Record<string, unknown>>; reviews: Array<Record<string, unknown>> }
    const reply = parseOrderDetail({
      ...fixture,
      attempts: [{ ...fixture.attempts[0], status: 'paused' }],
      reviews: [{ ...fixture.reviews[0], reason: 'NEW_REASON' }],
    })
    expect(reply.found && reply.detail.attempts[0]!.status).toBe('paused')
    expect(reply.found && reply.detail.reviews[0]!.reason).toBe('NEW_REASON')
  })
})

describe('the action replies', () => {
  it('reads a fulfilment that moved items, one that changed nothing, and the boolean the brief names', () => {
    expect(parseActionReply({ ok: true, changed: 2, itemIds: [B, C] })).toEqual({ ok: true, changed: 2, restocked: [] })
    expect(parseActionReply({ ok: true, changed: 0, itemIds: [] })).toEqual({ ok: true, changed: 0, restocked: [] })
    expect(parseActionReply({ ok: true, changed: false })).toMatchObject({ changed: 0 })
    expect(parseActionReply({ ok: true, changed: true })).toMatchObject({ changed: 1 })
  })

  it('reads a decision, a resolution and a closing, which carry no count', () => {
    expect(parseActionReply({ ok: true, returnId: H, state: 'approved' })).toEqual({ ok: true, changed: null, restocked: [] })
    expect(parseActionReply({ ok: true, orderNumber: 'ABCD2345', status: 'paid' })).toMatchObject({ ok: true })
    expect(parseActionReply({ ok: true, paymentId: PAYMENT, closedAt: ISO })).toMatchObject({ ok: true })
  })

  it('reads what a receipt put back on the shelf', () => {
    const reply = parseActionReply({ ok: true, returnId: H, state: 'received', restocked: [{ itemId: B, variantId: C, quantity: 1, from: 8, to: 9 }] })
    expect(reply).toEqual({ ok: true, changed: null, restocked: [{ itemId: B, quantity: 1, from: 8, to: 9 }] })
  })

  it('reads a refusal with what the function adds to it', () => {
    expect(parseActionReply({ ok: false, code: 'DEDICATION_NOT_DONE', itemIds: [B] })).toEqual({
      ok: false,
      code: 'DEDICATION_NOT_DONE',
      state: null,
      status: null,
      itemIds: [B],
    })
    expect(parseActionReply({ ok: false, code: 'BAD_TRANSITION', state: 'approved' })).toMatchObject({ state: 'approved', itemIds: [] })
    expect(parseActionReply({ ok: false, code: 'NOT_RESOLVABLE', status: 'paid' })).toMatchObject({ status: 'paid' })
  })

  it('refuses a reply that is not one', () => {
    for (const reply of [null, [], 'x', {}, { ok: 'yes' }, { ok: false }, { ok: false, code: 5 }, { ok: true, changed: 1.5 }, { ok: true, restocked: [{ itemId: 'x', quantity: 1, from: 1, to: 2 }] }, { ok: false, code: 'X', itemIds: ['x'] }]) {
      expect(() => parseActionReply(reply), JSON.stringify(reply)).toThrow()
    }
  })
})

describe('the sentence of a refusal', () => {
  const refusal = (code: string, over: Partial<Refusal> = {}): Refusal => ({ ok: false, code, state: null, status: null, itemIds: [], ...over })
  const text = (action: OrderAction, code: string, over: Partial<Refusal> = {}): string => refusalText(action, refusal(code, over))

  it('says what the brief gives for a fulfilment', () => {
    expect(text('fulfil', 'ORDER_NOT_PAID')).toBe('الطلب غير مدفوع، فلا يُشحن.')
    expect(text('fulfil', 'INVALID_ITEMS')).toBe('اختر عناصر من هذا الطلب.')
    expect(text('fulfil', 'BAD_TRANSITION')).toBe('لا تنتقل هذه العناصر إلى هذه الحالة.')
    expect(text('fulfil', 'ITEM_REFUNDED')).toBe('عنصر مُعاد مبلغه بالكامل لا يُشحن.')
    expect(text('fulfil', 'DEDICATION_NOT_DONE')).toBe('أكمل الإهداء قبل الشحن.')
    expect(text('fulfil', 'NOT_FOUND')).toBe('لم نجد هذا الطلب.')
  })

  it('says the three things a resolution can refuse, with the status of one that cannot be resolved', () => {
    expect(text('resolve', 'STOCK_UNAVAILABLE')).toBe('المخزون لا يكفي لعنصر في هذا الطلب؛ عدّل المخزون أو أعد مبلغ العنصر أولًا.')
    expect(text('resolve', 'REFUND_IN_FLIGHT')).toBe('استرداد قيد المعالجة؛ أعد المحاولة بعد دقائق.')
    expect(text('resolve', 'NOT_RESOLVABLE', { status: 'paid' })).toContain('مدفوع')
    expect(text('resolve', 'NOT_RESOLVABLE', { status: 'paid_needs_resolution' })).toContain('يحتاج حلًا')
    expect(text('resolve', 'NOT_FOUND')).toBe('لم نجد هذا الطلب.')
  })

  it('says a return that moved on, with its state, and the other refusals of a return', () => {
    expect(text('decide', 'BAD_TRANSITION', { state: 'approved' })).toContain('مقبول')
    expect(text('receive', 'BAD_TRANSITION', { state: 'received' })).toContain('مُستلَم')
    expect(text('receive', 'INVALID_ITEMS')).not.toBe(SAVE_FAILED)
    expect(text('decide', 'NOT_FOUND')).toBe('لم نجد طلب الإرجاع.')
    expect(text('receive', 'NOT_FOUND')).toBe('لم نجد طلب الإرجاع.')
  })

  it('says the two refusals of a closing', () => {
    expect(text('close', 'ALREADY_CLOSED')).toBe('أُغلقت هذه المراجعة من قبل.')
    expect(text('close', 'NOT_FOUND')).toBe('لم نجد هذه الدفعة.')
  })

  it('says «could not save» for a code it does not know, and never an exception', () => {
    for (const action of ['fulfil', 'decide', 'receive', 'resolve', 'close'] as const) {
      expect(text(action, 'SOMETHING_NEW'), action).toBe(SAVE_FAILED)
      expect(text(action, 'constructor'), action).toBe(SAVE_FAILED)
    }
    // A code that is another action's: not this one's.
    expect(text('close', 'ORDER_NOT_PAID')).toBe(SAVE_FAILED)
  })
})
