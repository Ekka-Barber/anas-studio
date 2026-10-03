// Relative, not `@/`: the unit tests (tests/unit/admin-orders.test.ts, admin-ops.test.ts) import this file, and the unit config has no alias.
import { ORDER_NUMBER } from './cart'

/**
 * The staff's order screens (P08 round 11a), the parts that need no React: the
 * Arabic words of every state, the strict parsers of what `orders_list`,
 * `order_detail` and `orders_alerts` answer (round 7b's SQL, read through the
 * signed-in session), the reading of the action replies, and the search box's
 * normalization.
 *
 * A reply is read key by key: a key too few, or a value of the wrong type, throws,
 * and the screen then says it could not load, never a half-drawn order. Extra
 * keys are ignored (these are staff screens, not the buyer's). A value out of an
 * enum is not refused: it is shown as its code (`labelOf`).
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const LOAD_FAILED = 'تعذّر التحميل.'
export const SAVE_FAILED = 'تعذّر الحفظ. حاول مرة أخرى.'
export const NO_PERMISSION = 'لا تملك صلاحية هذا الإجراء.'
export const ORDER_NOT_FOUND = 'لم نجد هذا الطلب.'
export const BAD_QUERY = 'أدخل رقم طلب كاملًا أو بريدًا إلكترونيًا.'
/** The badge of a sandbox order (a live one shows nothing). */
export const TEST_BADGE = 'تجريبي'

export const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending_payment: 'بانتظار الدفع',
  expired: 'انتهت المهلة',
  cancelled: 'ملغى',
  paid: 'مدفوع',
  paid_needs_resolution: 'مدفوع: يحتاج حلًا',
  refunded: 'مُعاد',
}

export const ORDER_FILTERS = ['all', 'paid', 'to_ship', 'needs_resolution', 'pending', 'refunded', 'review'] as const
export type OrderFilter = (typeof ORDER_FILTERS)[number]
export const ORDER_FILTER_LABELS: Readonly<Record<OrderFilter, string>> = {
  all: 'الكل',
  paid: 'المدفوعة',
  to_ship: 'للشحن',
  needs_resolution: 'تحتاج حلًا',
  pending: 'بانتظار الدفع',
  refunded: 'المُعادة',
  review: 'قيد المراجعة',
}

export const FULFILLMENT_TYPE_LABELS: Readonly<Record<string, string>> = { digital: 'رقمي', physical: 'ورقي', signed: 'موقّع' }
export const FULFILLMENT_STATE_LABELS: Readonly<Record<string, string>> = { preparing: 'قيد التجهيز', shipped: 'شُحن', delivered: 'سُلِّم' }
export const RETURN_STATE_LABELS: Readonly<Record<string, string>> = {
  requested: 'مطلوب',
  approved: 'مقبول',
  rejected: 'مرفوض',
  received: 'مُستلَم',
  refunded: 'أُعيد المبلغ',
}
export const ATTEMPT_STATUS_LABELS: Readonly<Record<string, string>> = {
  creating: 'قيد الإنشاء',
  pending: 'بانتظار الدفع',
  uncertain: 'غير مؤكد',
  paid: 'مدفوع',
  review: 'قيد المراجعة',
  failed: 'رفضه المزوّد',
  expired: 'انتهى',
  cancelled: 'ملغى',
  abandoned: 'متروك',
}
export const REVIEW_REASON_LABELS: Readonly<Record<string, string>> = {
  AMOUNT_MISMATCH: 'مبلغ مختلف',
  CURRENCY_MISMATCH: 'عملة مختلفة',
  UNEXPECTED_STATUS: 'حالة غير متوقعة',
  SECOND_PAYMENT: 'دفعة ثانية على فاتورة مدفوعة',
  ORDER_ALREADY_PAID: 'الطلب مدفوع بدفعة أخرى',
  UNMAPPED_INVOICE: 'فاتورة غير مرتبطة بطلب',
}
export const REFUND_STATUS_LABELS: Readonly<Record<string, string>> = {
  submitting: 'قيد الإرسال',
  uncertain: 'غير مؤكد',
  succeeded: 'تم',
  failed: 'لم يتم',
}
export const REFUND_SOURCE_LABELS: Readonly<Record<string, string>> = { admin: 'من اللوحة', provider_dashboard: 'من لوحة Moyasar' }

/** The Arabic word of an enum value; a value the table does not know is its own code (the screens draw it `dir="ltr"`). */
export function labelOf(labels: Readonly<Record<string, string>>, code: string): string {
  return Object.hasOwn(labels, code) ? (labels[code] ?? code) : code
}

// ---------------------------------------------------------------------------
// The search box
// ---------------------------------------------------------------------------

/** An address as `orders_list` reads one: the contact grammar, 3 to 254 characters (any letter case). */
const EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i

/**
 * What to send as `p_query` for the typed text, trimmed: an order number upper-cased, an email
 * lower-cased (the SQL hashes `lower(btrim(email))`), or '' for nothing typed (no search). Null
 * when it is neither: the function raises 22023 for that, so the screen says so instead of asking.
 */
export function normalizeOrderQuery(text: string): string | null {
  const query = text.trim()
  if (query === '') return ''
  const number = query.toUpperCase()
  if (ORDER_NUMBER.test(number)) return number
  return query.length >= 3 && query.length <= 254 && EMAIL.test(query) ? query.toLowerCase() : null
}

// ---------------------------------------------------------------------------
// The replies, parsed strictly
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isUuid = (value: string): boolean => UUID.test(value)

function malformed(): never {
  throw new Error('تعذّر قراءة رد الطلبات.')
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : malformed()
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : malformed()
}
const nstr = (value: unknown): string | null => (value === null ? null : str(value))
/** A non-negative integer: halalas, a quantity or a count. */
function int(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : malformed()
}
const nint = (value: unknown): number | null => (value === null ? null : int(value))
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : malformed()
}
const nbool = (value: unknown): boolean | null => (value === null ? null : bool(value))
function id(value: unknown): string {
  const text = str(value)
  return UUID.test(text) ? text : malformed()
}
const nid = (value: unknown): string | null => (value === null ? null : id(value))
function number(value: unknown): string {
  const text = str(value)
  return ORDER_NUMBER.test(text) ? text : malformed()
}
/** A date or an ISO time with its offset, as the database writes them ('2026-10-02', '2026-10-03T01:03:24.796123+00:00'). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2}))?$/
/** An ISO time (or a date) the browser can read, as the database writes it: the text itself is kept (`next` goes back unchanged). */
function time(value: unknown): string {
  const text = str(value)
  return !ISO_TIME.test(text) || Number.isNaN(Date.parse(text)) ? malformed() : text
}
const ntime = (value: unknown): string | null => (value === null ? null : time(value))
function list<T>(value: unknown, item: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(item) : malformed()
}

function orderRowOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    orderNumber: number(o.orderNumber),
    status: str(o.status),
    environment: str(o.environment),
    createdAt: time(o.createdAt),
    paidAt: ntime(o.paidAt),
    total: int(o.total),
    name: str(o.name),
    email: str(o.email),
    items: int(o.items),
    toShip: int(o.toShip),
    refunded: int(o.refunded),
    review: bool(o.review),
  }
}

/** `orders_list`: `{rows, next}`; `next` is the cursor text of the last row while more remain, to be sent back as it is. */
export function parseOrdersList(value: unknown) {
  const o = obj(value)
  return { rows: list(o.rows, orderRowOf), next: ntime(o.next) }
}
export type OrdersPage = ReturnType<typeof parseOrdersList>
export type OrderRow = OrdersPage['rows'][number]

/** `orders_alerts`: the counts and the low-stock list. */
export function parseOrdersAlerts(value: unknown) {
  const o = obj(value)
  return {
    needsResolution: int(o.needsResolution),
    review: int(o.review),
    toShip: int(o.toShip),
    uncertainRefunds: int(o.uncertainRefunds),
    unverifiedAttempts: int(o.unverifiedAttempts),
    exhaustedEvents: int(o.exhaustedEvents),
    externalRefunds: int(o.externalRefunds),
    lowStock: list(o.lowStock, (entry) => {
      const low = obj(entry)
      return { variantId: id(low.variantId), sku: str(low.sku), title: str(low.title), stock: int(low.stock), threshold: int(low.threshold) }
    }),
  }
}
export type OrdersAlerts = ReturnType<typeof parseOrdersAlerts>

/**
 * The counts of the list's line and the home: «تحتاج مطابقة» is the owner's alone, the sum of what
 * the reconciliation screen lists (round 11b links it there).
 */
export function alertCounts(alerts: OrdersAlerts, owner: boolean): Array<{ label: string; value: number }> {
  return [
    { label: 'تحتاج حلًا', value: alerts.needsResolution },
    { label: 'للشحن', value: alerts.toShip },
    { label: 'دفعات قيد المراجعة', value: alerts.review },
    ...(owner
      ? [{ label: 'تحتاج مطابقة', value: alerts.uncertainRefunds + alerts.unverifiedAttempts + alerts.exhaustedEvents + alerts.externalRefunds }]
      : []),
  ]
}

function preorderOf(value: unknown) {
  const o = obj(value)
  return { shipsOn: time(o.shipsOn), note: str(o.note) }
}
function itemOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    lineNo: int(o.lineNo),
    sku: str(o.sku),
    productTitle: str(o.productTitle),
    variantTitle: str(o.variantTitle),
    fulfillment: str(o.fulfillment),
    quantity: int(o.quantity),
    unitPrice: int(o.unitPrice),
    discount: int(o.discount),
    total: int(o.total),
    dedication: nstr(o.dedication),
    preorder: o.preorder === null ? null : preorderOf(o.preorder),
    refunded: int(o.refunded),
    fullyRefunded: bool(o.fullyRefunded),
  }
}
function attemptOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    orderId: id(o.orderId),
    status: str(o.status),
    environment: str(o.environment),
    amount: int(o.amount),
    currency: str(o.currency),
    providerInvoiceId: nstr(o.providerInvoiceId),
    providerPaymentId: nstr(o.providerPaymentId),
    providerStatus: nstr(o.providerStatus),
    providerRefunded: int(o.providerRefunded),
    captured: nint(o.captured),
    fee: nint(o.fee),
    sourceType: nstr(o.sourceType),
    sourceCompany: nstr(o.sourceCompany),
    invoiceExpiresAt: time(o.invoiceExpiresAt),
    paidAt: ntime(o.paidAt),
    fetchedAt: ntime(o.fetchedAt),
    checkCount: int(o.checkCount),
    errorCount: int(o.errorCount),
    lastError: nstr(o.lastError),
    createdAt: time(o.createdAt),
  }
}
function reviewOf(value: unknown) {
  const o = obj(value)
  return {
    paymentId: str(o.paymentId),
    invoiceId: nstr(o.invoiceId),
    attemptId: nid(o.attemptId),
    orderId: nid(o.orderId),
    environment: str(o.environment),
    amount: nint(o.amount),
    currency: nstr(o.currency),
    providerStatus: nstr(o.providerStatus),
    reason: str(o.reason),
    providerRefunded: int(o.providerRefunded),
    refunded: int(o.refunded),
    closedAt: ntime(o.closedAt),
    closedReason: nstr(o.closedReason),
    createdAt: time(o.createdAt),
  }
}
function eventOf(value: unknown) {
  const o = obj(value)
  return {
    eventId: str(o.eventId),
    type: nstr(o.type),
    live: nbool(o.live),
    paymentId: nstr(o.paymentId),
    receivedAt: time(o.receivedAt),
    processedAt: ntime(o.processedAt),
    outcome: nstr(o.outcome),
    error: nstr(o.error),
    attempts: int(o.attempts),
    nextCheckAt: ntime(o.nextCheckAt),
  }
}
function fulfilmentOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    itemId: id(o.itemId),
    state: str(o.state),
    carrier: nstr(o.carrier),
    tracking: nstr(o.tracking),
    dedicationDone: bool(o.dedicationDone),
    shippedAt: ntime(o.shippedAt),
    deliveredAt: ntime(o.deliveredAt),
    updatedAt: time(o.updatedAt),
  }
}
function entitlementOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    itemId: id(o.itemId),
    grantedAt: time(o.grantedAt),
    revokedAt: ntime(o.revokedAt),
    revokeReason: nstr(o.revokeReason),
    hasFile: bool(o.hasFile),
    filename: nstr(o.filename),
  }
}
function refundOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    orderId: nid(o.orderId),
    attemptId: nid(o.attemptId),
    reviewPaymentId: nstr(o.reviewPaymentId),
    returnId: nid(o.returnId),
    status: str(o.status),
    amount: int(o.amount),
    reason: str(o.reason),
    source: str(o.source),
    allocation: obj(o.allocation),
    providerRefundedBefore: nint(o.providerRefundedBefore),
    providerRefundedAfter: nint(o.providerRefundedAfter),
    error: nstr(o.error),
    nextCheckAt: ntime(o.nextCheckAt),
    createdAt: time(o.createdAt),
    succeededAt: ntime(o.succeededAt),
  }
}
function quantityOf(value: unknown) {
  const o = obj(value)
  return { itemId: id(o.itemId), quantity: int(o.quantity) }
}
function returnOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    state: str(o.state),
    items: list(o.items, quantityOf),
    reason: str(o.reason),
    staffNote: nstr(o.staffNote),
    restocked: o.restocked === null ? null : list(o.restocked, quantityOf),
    refundId: nid(o.refundId),
    createdAt: time(o.createdAt),
    updatedAt: time(o.updatedAt),
  }
}
function disputeOf(value: unknown) {
  const o = obj(value)
  return {
    id: id(o.id),
    kind: str(o.kind),
    providerRef: str(o.providerRef),
    seq: int(o.seq),
    attemptId: nid(o.attemptId),
    reviewPaymentId: nstr(o.reviewPaymentId),
    environment: str(o.environment),
    amount: int(o.amount),
    direction: str(o.direction),
    occurredOn: time(o.occurredOn),
    reason: str(o.reason),
    resolution: nstr(o.resolution),
    decision: str(o.decision),
    itemIds: list(o.itemIds, id),
    createdAt: time(o.createdAt),
  }
}
function auditOf(value: unknown) {
  const o = obj(value)
  return {
    id: int(o.id),
    at: time(o.at),
    actor: nid(o.actor),
    action: str(o.action),
    entity: str(o.entity),
    entityId: nstr(o.entityId),
    summary: obj(o.summary),
  }
}
function orderOf(value: unknown) {
  const o = obj(value)
  const contact = obj(o.contact)
  const delivery = obj(o.delivery)
  return {
    id: id(o.id),
    orderNumber: number(o.orderNumber),
    status: str(o.status),
    environment: str(o.environment),
    createdAt: time(o.createdAt),
    updatedAt: time(o.updatedAt),
    paidAt: ntime(o.paidAt),
    holdExpiresAt: time(o.holdExpiresAt),
    subtotal: int(o.subtotal),
    discount: int(o.discount),
    shipping: int(o.shipping),
    total: int(o.total),
    currency: str(o.currency),
    couponCode: nstr(o.couponCode),
    refunded: int(o.refunded),
    contact: { name: str(contact.name), email: str(contact.email), phone: nstr(contact.phone) },
    delivery: { cityKey: nstr(delivery.cityKey), city: nstr(delivery.city), address: nstr(delivery.address) },
  }
}

/**
 * `order_detail`: `{found: false}` for `NOT_FOUND`, else the whole order. `disputes` and `audit` are
 * the owner's: for operations the reply has neither key and both are null here (an owner's empty
 * list is `[]`). Any other refusal, or a reply of another shape, throws.
 */
export function parseOrderDetail(value: unknown) {
  const o = obj(value)
  if (o.ok === false && o.code === 'NOT_FOUND') return { found: false as const }
  if (o.ok !== true) malformed()
  return {
    found: true as const,
    detail: {
      order: orderOf(o.order),
      items: list(o.items, itemOf),
      attempts: list(o.attempts, attemptOf),
      reviews: list(o.reviews, reviewOf),
      events: list(o.events, eventOf),
      fulfillments: list(o.fulfillments, fulfilmentOf),
      entitlements: list(o.entitlements, entitlementOf),
      refunds: list(o.refunds, refundOf),
      returns: list(o.returns, returnOf),
      disputes: o.disputes === undefined ? null : list(o.disputes, disputeOf),
      audit: o.audit === undefined ? null : list(o.audit, auditOf),
    },
  }
}
export type OrderDetail = Extract<ReturnType<typeof parseOrderDetail>, { found: true }>['detail']

// ---------------------------------------------------------------------------
// The action replies
// ---------------------------------------------------------------------------

export interface Restocked {
  itemId: string
  quantity: number
  from: number
  to: number
}
/** A call that did what it was asked (`changed` only for a fulfilment: how many items moved). */
export interface Done {
  ok: true
  changed: number | null
  restocked: Restocked[]
}
/** A business refusal: its code, and what the function adds to some (the state, the status, the items at fault). */
export interface Refusal {
  ok: false
  code: string
  state: string | null
  status: string | null
  itemIds: string[]
}

/**
 * What `fulfillment_update`, `return_decide`, `return_receive`, `order_resolve` and `review_close`
 * answer. `changed` is a count in the SQL (a boolean is read as 0 or 1, as the brief names it).
 */
export function parseActionReply(value: unknown): Done | Refusal {
  const o = obj(value)
  if (o.ok === true) {
    return {
      ok: true,
      changed: o.changed === undefined ? null : typeof o.changed === 'boolean' ? Number(o.changed) : int(o.changed),
      restocked:
        o.restocked === undefined
          ? []
          : list(o.restocked, (entry) => {
              const r = obj(entry)
              return { itemId: id(r.itemId), quantity: int(r.quantity), from: int(r.from), to: int(r.to) }
            }),
    }
  }
  if (o.ok !== false) malformed()
  return {
    ok: false,
    code: str(o.code),
    state: o.state === undefined ? null : str(o.state),
    status: o.status === undefined ? null : str(o.status),
    itemIds: o.itemIds === undefined ? [] : list(o.itemIds, id),
  }
}

export type OrderAction = 'fulfil' | 'decide' | 'receive' | 'resolve' | 'close'

const REFUSALS: Record<OrderAction, Readonly<Record<string, string>>> = {
  fulfil: {
    NOT_FOUND: ORDER_NOT_FOUND,
    ORDER_NOT_PAID: 'الطلب غير مدفوع، فلا يُشحن.',
    INVALID_ITEMS: 'اختر عناصر من هذا الطلب.',
    BAD_TRANSITION: 'لا تنتقل هذه العناصر إلى هذه الحالة.',
    ITEM_REFUNDED: 'عنصر مُعاد مبلغه بالكامل لا يُشحن.',
    DEDICATION_NOT_DONE: 'أكمل الإهداء قبل الشحن.',
  },
  decide: { NOT_FOUND: 'لم نجد طلب الإرجاع.' },
  receive: { NOT_FOUND: 'لم نجد طلب الإرجاع.', INVALID_ITEMS: 'كمية العودة إلى المخزون غير صحيحة.' },
  resolve: {
    NOT_FOUND: ORDER_NOT_FOUND,
    STOCK_UNAVAILABLE: 'المخزون لا يكفي لعنصر في هذا الطلب؛ عدّل المخزون أو أعد مبلغ العنصر أولًا.',
    REFUND_IN_FLIGHT: 'استرداد قيد المعالجة؛ أعد المحاولة بعد دقائق.',
  },
  close: { NOT_FOUND: 'لم نجد هذه الدفعة.', ALREADY_CLOSED: 'أُغلقت هذه المراجعة من قبل.' },
}

/** The sentence of a refusal; a code this screen does not know is the generic «تعذّر الحفظ». */
export function refusalText(action: OrderAction, reply: Refusal): string {
  if (reply.code === 'BAD_TRANSITION' && (action === 'decide' || action === 'receive')) {
    return `لا يمكن هذا الإجراء؛ حالة طلب الإرجاع الآن: ${labelOf(RETURN_STATE_LABELS, reply.state ?? '')}.`
  }
  if (reply.code === 'NOT_RESOLVABLE' && action === 'resolve') {
    return `لا يمكن إكمال هذا الطلب؛ حالته الآن: ${labelOf(ORDER_STATUS_LABELS, reply.status ?? '')}.`
  }
  const table = REFUSALS[action]
  return Object.hasOwn(table, reply.code) ? (table[reply.code] ?? SAVE_FAILED) : SAVE_FAILED
}
