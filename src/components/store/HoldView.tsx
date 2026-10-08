'use client'

/**
 * The checkout's hold view (P07, P08 contract section 10): what the buyer sees
 * once `create` has made the order, loaded on demand by `CheckoutForm` so the
 * checkout page's first script stays under the public budget (150 KiB gzip).
 * It shows the order, its total, the time the hold ends and, per the payment
 * the reply carried, «ادفع الآن» (a plain link to the invoice), a retry (`pay`)
 * or why payment cannot start; a view with no payment yet (a reload, or
 * ACTIVE_HOLD handing the order back) asks `pay` once. One timer, no interval
 * and nothing counting on screen, ends the view at the hold's end (DESIGN-AUDIT
 * 33): the device's clock only chooses when to ask, the function says whether
 * the hold is over. The form is told when the order ended (cancelled, expired,
 * hold over) so it forgets its token and its key, and when the function does
 * not know the order any more, so it shows the form again. A payment that
 * arrived is `received`: nothing is cleared then, the return page tells the
 * rest. Focus follows the buyer's own action (create, cancel, retry) into the
 * order box; not a page load. The view shows the order's own lines and, for one that
 * ships, where it goes (what the order says, never the cart); when the buyer has since
 * edited the cart (`changed`) it says the order was made before the edit.
 */
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

// Relative, not `@/`: tests/unit/store-checkout.test.ts renders this view, and the unit config has no alias.
import { formatRiyadhTime, instantOf, type PendingOrder } from '../../lib/cart'
import { formatMoney } from '../../lib/format'
import { ActionButton, ActionLink } from '../weave/Action'

import { orderSchema, parsePayment, postCheckout, RECEIVED, type OrderSummary, type PaymentView } from './quote'
import styles from './store.module.css'

/** What the hold view knows of the payment; `closed` is never shown as a payment: it ends the order or settles it. */
type LivePayment = Exclude<PaymentView, { state: 'closed' }>

/** Why the view has nothing to pay: the order ended, a payment of it arrived, or it cannot be paid from here (`blocked`: the order still holds its stock, so the view keeps the cancel). */
type Closed = 'cancelled' | 'expired' | 'received' | 'blocked'

/** Said when the cart is no longer what the order was made from: the order stands as it was made. */
export const ORDER_BEFORE_EDIT = 'هذا الطلب أُنشئ قبل تعديلك؛ ادفعه كما هو أو ألغه لتطلب من جديد.'
/** A line that ships (physical or signed) took the address typed when the order was made. */
export const SHIPS_TO_TYPED_ADDRESS = 'يُشحن إلى العنوان الذي أُدخل عند إنشاء الطلب'

interface Shown {
  total: number | null
  /** The order's own lines, as the order says them. */
  lines: OrderSummary['lines']
  /** The hold's end (an ISO time) while the order waits for payment. */
  holdEnds: string | null
  payment: LivePayment
  closed: Closed | null
}

const WAITING: Shown = { total: null, lines: [], holdEnds: null, payment: { state: 'preparing' }, closed: null }

/** What `create` said of the order: its summary and, when the reply carried one, its payment. */
export interface HoldStart {
  order: OrderSummary
  payment: PaymentView | null
}

/** What a `create` or `pay` reply says of the order: the hold view with its payment, or the reason there is none. */
function shownBy(order: OrderSummary, reply: PaymentView | null): Shown {
  const { total, lines } = order
  if (RECEIVED.has(order.status) || (reply?.state === 'closed' && RECEIVED.has(reply.status ?? ''))) return { ...WAITING, total, lines, closed: 'received' }
  if (order.status === 'expired' || order.status === 'cancelled') return { ...WAITING, total, lines, closed: order.status }
  if (reply?.state === 'closed') {
    // A payment of it waits for the owner's review: that is a payment received. A hold that ran out is over.
    // Anything else (the payment mode changed, too many attempts) claims no payment: the order cannot be paid
    // from here and still holds its stock, so the view offers the cancel.
    if (reply.reason === 'UNDER_REVIEW') return { ...WAITING, total, lines, closed: 'received' }
    return { ...WAITING, total, lines, closed: reply.code === 'HOLD_EXPIRED' ? 'expired' : 'blocked' }
  }
  return { total, lines, holdEnds: order.holdExpiresAt, payment: reply ?? { state: 'preparing' }, closed: null }
}

export function HoldView({
  pending,
  start,
  testMode,
  focusOnOpen,
  changed,
  onEnd,
  onForget,
}: {
  pending: PendingOrder
  /** The `create` reply's order and payment; null when the view has to learn them from `pay` (a reload, ACTIVE_HOLD). */
  start: HoldStart | null
  /** The payments run in test mode: no real money moves. */
  testMode: boolean
  /** The buyer's own action opened the view: it takes the focus. */
  focusOnOpen: boolean
  /** The cart is no longer what the order was made from (`orderChanged`). */
  changed: boolean
  /** The order ended (cancelled, or its hold is over): the form forgets its token and its key. */
  onEnd: () => void
  /** The function does not know the order, or its token no longer fits: the form is shown again, with these words. */
  onForget: (message: string) => void
}) {
  const [shown, setShown] = useState<Shown>(() => (start === null ? WAITING : shownBy(start.order, start.payment)))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const orderBoxRef = useRef<HTMLDivElement>(null)
  const focusOrderBox = useRef(focusOnOpen)
  const opened = useRef(false)
  const { total, lines, holdEnds, payment, closed } = shown
  // What the order still holds for the buyer: shown while it can be paid or cancelled.
  const holds = (closed === null || closed === 'blocked') && lines.length > 0

  // The order is over: the form forgets its token and its key, and the view says why.
  const show = useCallback(
    (order: OrderSummary, reply: PaymentView | null) => {
      const next = shownBy(order, reply)
      setShown(next)
      if (next.closed === 'cancelled' || next.closed === 'expired') {
        onEnd()
        setSubmitError('')
      }
    },
    [onEnd],
  )

  // `pay` for this order: its summary and the state of its payment (after a reload, for «أعد المحاولة», and when the hold's time has passed).
  const loadPayment = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setSubmitError('')
    try {
      const reply = await postCheckout<{ order: unknown; payment: unknown }>({
        action: 'pay',
        orderNumber: pending.orderNumber,
        accessToken: pending.accessToken,
      })
      if (reply.ok && reply.data !== undefined) {
        show(orderSchema.parse(reply.data.order), parsePayment(reply.data.payment))
      } else if (reply.error?.code === 'NOT_FOUND') {
        onForget(reply.error.message)
      } else if (reply.error?.code === 'CHECKOUT_DISABLED') {
        setShown((current) => ({ ...current, payment: { state: 'unavailable' } }))
        setSubmitError('الشراء غير متاح حاليًا، ويفتح قريبًا.')
      } else {
        setSubmitError(reply.error?.message ?? 'تعذّر تجهيز الدفع؛ حاول بعد لحظات.')
      }
    } catch {
      setSubmitError('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')
    } finally {
      setSubmitting(false)
    }
  }, [pending, show, onForget])

  // Once, on opening: an order that ended already tells the form; one whose payment is not known (read back from
  // storage, handed back by ACTIVE_HOLD, or a `create` reply that lacked it) is asked of `pay`.
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (shown.closed === 'cancelled' || shown.closed === 'expired') onEnd()
    else if (start === null || (start.payment === null && start.order.status === 'pending_payment')) {
      // Deferred like the other mount effects (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => loadPayment())
    }
  }, [shown.closed, start, onEnd, loadPayment])

  // One timer to the hold's end: no interval, and nothing counts on screen (DESIGN-AUDIT 33). The device's clock only
  // decides when to ask: the function says whether the hold is over, so a clock that runs ahead ends nothing.
  useEffect(() => {
    if (holdEnds === null || closed !== null) return
    const timer = setTimeout(() => void loadPayment(), Math.max(0, instantOf(holdEnds) - Date.now()))
    return () => clearTimeout(timer)
  }, [holdEnds, closed, loadPayment])

  // Focus follows the buyer's own action (create, cancel, retry) into the order box, which replaces the form and the
  // button that had it. Not on a page load.
  useEffect(() => {
    if (!focusOrderBox.current) return
    focusOrderBox.current = false
    orderBoxRef.current?.focus()
  }, [shown])

  async function cancelOrder(): Promise<void> {
    if (submitting) return
    setSubmitting(true)
    try {
      const reply = await postCheckout<{ status: string }>({
        action: 'cancel',
        orderNumber: pending.orderNumber,
        accessToken: pending.accessToken,
      })
      // The function answers the order's status: a hold that already ran out says
      // `expired`; a payment that arrived meanwhile says what became of it (nothing is
      // cleared then, the return page tells the rest); anything else is no release.
      const status = reply.data?.status
      if (reply.ok && (status === 'cancelled' || status === 'expired')) {
        focusOrderBox.current = true
        setShown((current) => ({ ...current, closed: status }))
        onEnd()
        setSubmitError('')
      } else if (reply.ok && status !== undefined && RECEIVED.has(status)) {
        focusOrderBox.current = true
        setShown((current) => ({ ...current, closed: 'received' }))
        setSubmitError('')
      } else if (reply.error?.code === 'NOT_FOUND') {
        onForget(reply.error.message)
      } else {
        setSubmitError(reply.error?.message ?? 'تعذّر إلغاء الطلب.')
      }
    } catch {
      setSubmitError('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={orderBoxRef}
      tabIndex={-1}
      role="group"
      aria-labelledby="checkout-order-number"
      aria-describedby={
        [closed !== null || holdEnds !== null ? 'checkout-order-state' : '', changed && closed === null ? 'checkout-order-warning' : '']
          .filter((id) => id !== '')
          .join(' ') || undefined
      }
      className={styles.orderBox}
    >
      <p id="checkout-order-number" className={styles.orderNumber}>
        رقم الطلب: <span dir="ltr">{pending.orderNumber}</span>
      </p>
      {total !== null && <p>الإجمالي: {formatMoney(total)}</p>}
      {holds && (
        <>
          <ul className={styles.summaryLines}>
            {lines.map((line) => (
              <li key={line.sku}>
                {line.productTitle}: {line.variantTitle} × {line.quantity}
                <span className={styles.summaryPrice}>{formatMoney(line.total)}</span>
              </li>
            ))}
          </ul>
          {lines.some((line) => line.fulfillment !== 'digital') && <p className={styles.note}>{SHIPS_TO_TYPED_ADDRESS}</p>}
        </>
      )}
      {changed && closed === null && (
        <p id="checkout-order-warning" className={styles.warning} role="note">
          {ORDER_BEFORE_EDIT}
        </p>
      )}
      {closed === 'received' ? (
        <>
          <p id="checkout-order-state" className={styles.note} role="status">
            وصلتنا دفعة هذا الطلب.
          </p>
          <Link href={`/checkout/return?order=${pending.orderNumber}`} prefetch={false} className={styles.plainLink}>
            عرض حالة الطلب
          </Link>
        </>
      ) : closed === 'blocked' ? (
        <>
          <p id="checkout-order-state" className={styles.note} role="status">
            تعذّر تجهيز الدفع لهذا الطلب. ألغِ الطلب ثم اطلب من جديد.
          </p>
          {/* aria-disabled, not disabled: the button keeps the focus while its own request runs (`cancelOrder` returns early). */}
          <ActionButton variant="outline" onClick={cancelOrder} aria-disabled={submitting || undefined}>
            إلغاء الطلب
          </ActionButton>
        </>
      ) : closed !== null ? (
        <>
          <p id="checkout-order-state" className={styles.note} role="status">
            {closed === 'expired' ? 'انتهت مدة حجز الطلب.' : 'أُلغي الطلب.'}
          </p>
          <Link href="/cart" prefetch={false} className={styles.plainLink}>
            العودة إلى السلة
          </Link>
        </>
      ) : (
        <>
          {holdEnds !== null && (
            <p id="checkout-order-state" className={styles.note}>
              محجوز حتى <span dir="ltr">{formatRiyadhTime(holdEnds)}</span> بتوقيت الرياض
            </p>
          )}
          {payment.state === 'ready' && <ActionLink href={payment.url}>ادفع الآن</ActionLink>}
          {payment.state === 'preparing' && (
            <p className={styles.note} role="status">
              نجهّز صفحة الدفع…
            </p>
          )}
          {payment.state === 'unavailable' && (
            <p className={styles.warning} role="alert">
              تعذّر تجهيز الدفع؛ حاول بعد لحظات.
            </p>
          )}
          {payment.state !== 'ready' && (
            <ActionButton
              variant="outline"
              onClick={() => {
                if (submitting) return
                focusOrderBox.current = true
                void loadPayment()
              }}
              aria-disabled={submitting || undefined}
            >
              أعد المحاولة
            </ActionButton>
          )}
          <ActionButton variant="outline" onClick={cancelOrder} aria-disabled={submitting || undefined}>
            إلغاء الطلب
          </ActionButton>
        </>
      )}
      {testMode && (
        <p className={styles.note} role="note">
          وضع تجريبي: لا يُخصم أي مبلغ حقيقي
        </p>
      )}
      {submitError !== '' && <p className={styles.warning} role="alert">{submitError}</p>}
    </div>
  )
}
