'use client'

/**
 * One order for the staff (P08 round 11a): `order_detail` under the signed-in
 * session, drawn section by section, and the five things a person can do here:
 * fulfilment (`fulfillment_update`), a return's decision and receipt
 * (`return_decide`, `return_receive`), the resolution of a paid order whose stock
 * was gone (`order_resolve`) and the closing of a review payment (`review_close`).
 * Every one is a function that rechecks the caller's role inside; the screen
 * only shapes itself by it (owner and operations; the owner's alone: the
 * restock, the resolution, the closing, the disputes and the audit). Nothing is
 * optimistic: after a call the order is read again and the screen shows that.
 * The contact is for fulfilment: no link, no other use is offered. The owner's money
 * actions (round 11b) are `RefundView`, `DisputeForm` and the rechecks: each a call of the
 * `admin` function (through the step-up dialog where it moves money), said on this screen's
 * one status line or alert line, and followed by a new reading of the order.
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { preorderSentence } from '@/components/store/quote'
import {
  ATTEMPT_STATUS_LABELS,
  clean,
  closeReason,
  DISPUTE_DECISION_LABELS,
  DISPUTE_DIRECTION_LABELS,
  DISPUTE_KIND_LABELS,
  FULFILLMENT_STATE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  isUuid,
  LOAD_FAILED,
  NO_PERMISSION,
  ORDER_NOT_FOUND,
  ORDER_STATUS_LABELS,
  parseActionReply,
  parseOrderDetail,
  REFUND_SOURCE_LABELS,
  REFUND_STATUS_LABELS,
  refusalText,
  RETURN_STATE_LABELS,
  REVIEW_REASON_LABELS,
  SAVE_FAILED,
  type Done,
  type OrderAction,
  type OrderDetail,
  type Refusal,
} from '@/lib/admin-orders'
import { disputeLines, inFlight as refundInFlight, REREAD_FAILED } from '@/lib/admin-money'
import { formatDate, formatMoney, formatNumber, formatRiyadh } from '@/lib/format'
import { clampQuantity } from '@/lib/orders'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'
import { DisputeForm } from './DisputeForm'
import { Enum, Fact, ltr, ltrLong, NONE, TestBadge } from './OrdersView'
import { recheckAttempt, recheckRefund, RefundView, useFocusBack, useStepUp, type Money, type Said } from './RefundView'

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'missing' } | { kind: 'ready'; detail: OrderDetail }
type Item = OrderDetail['items'][number]
type Reply = { data: unknown; error: { code?: string } | null }

const NO_ITEMS = 'اختر عناصر من هذا الطلب.'
const NEEDS_CARRIER = 'أدخل شركة الشحن ورقم التتبع.'

const nameOf = (item: Pick<Item, 'productTitle' | 'variantTitle'>): string =>
  [item.productTitle, item.variantTitle].filter((part) => part !== '').join(': ')
const when = (iso: string | null): string => (iso === null ? NONE : formatRiyadh(iso))

/** The order as `order_detail` answers now; a reply that is not what it should be is a failure, not a half-drawn order. */
async function fetchDetail(id: string): Promise<Load> {
  try {
    const { data, error } = await getSupabaseBrowserClient().rpc('order_detail', { p_order: id })
    if (error) return { kind: 'failed' }
    const reply = parseOrderDetail(data)
    return reply.found ? { kind: 'ready', detail: reply.detail } : { kind: 'missing' }
  } catch {
    return { kind: 'failed' }
  }
}

const rpc = (fn: string, args: Record<string, unknown>): PromiseLike<Reply> => getSupabaseBrowserClient().rpc(fn, args)

export function OrderView() {
  const role = useStaffRole()
  const allowed = role === 'owner' || role === 'operations'
  const owner = role === 'owner'
  const id = useSearchParams().get('id') ?? ''
  const valid = isUuid(id)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [status, setStatus] = useState<ReactNode>('')
  const [alert, setAlert] = useState<ReactNode>('')
  const [focusLine, setFocusLine] = useState<{ line: 'status' | 'alert'; n: number } | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [restock, setRestock] = useState<Record<string, string>>({})
  const [closeReasons, setCloseReasons] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const step = useStepUp()
  const focusBack = useFocusBack()
  // The attempt or review payment whose dispute form is open (`attempt:<id>` or `review:<paymentId>`).
  const [openDispute, setOpenDispute] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed || !valid) return
    let active = true
    void (async () => {
      const next = await fetchDetail(id)
      if (active) setLoad(next)
    })()
    return () => {
      active = false
    }
  }, [allowed, valid, id, round])

  // After an action the focus goes to the line that reports it.
  useEffect(() => {
    if (focusLine !== null) (focusLine.line === 'alert' ? alertRef : statusRef).current?.focus()
  }, [focusLine])
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  function report(line: 'status' | 'alert', text: ReactNode) {
    setStatus(line === 'status' ? text : '')
    setAlert(line === 'alert' ? text : '')
    setFocusLine((current) => ({ line, n: (current?.n ?? 0) + 1 }))
  }

  /** The sentence of a refusal; for a fulfilment, followed by the titles of the lines at fault. */
  function refused(action: OrderAction, reply: Refusal, items: readonly Item[]): ReactNode {
    const sentence = refusalText(action, reply)
    const names = action === 'fulfil' ? reply.itemIds.flatMap((itemId) => items.filter((item) => item.id === itemId).map(nameOf)) : []
    return names.length === 0 ? (
      sentence
    ) : (
      <>
        {sentence} <bdi>{names.join('، ')}</bdi>
      </>
    )
  }

  /**
   * The order read again after an action. A reading that fails leaves what is drawn as it is: an order replaced by
   * the failure would take its refund form, and the idempotency key a repeat of the refund needs, with it. True when
   * it failed, so that the screen says so.
   */
  async function reread(orderId: string): Promise<boolean> {
    const next = await fetchDetail(orderId)
    setLoad((current) => (next.kind === 'failed' && current.kind === 'ready' && current.detail.order.id === orderId ? current : next))
    return next.kind === 'failed'
  }

  /**
   * One call and what follows it: the button is off while it is in flight (a second press sends
   * nothing), the order is read again whatever the answer (a refusal may mean it changed), and the
   * result goes to the status or the alert line, which takes the focus.
   */
  async function act(key: string, action: OrderAction, call: () => PromiseLike<Reply>, done: (reply: Done) => ReactNode): Promise<void> {
    if (inFlight.current || load.kind !== 'ready') return
    inFlight.current = true
    const items = load.detail.items
    setBusy(key)
    setStatus('')
    setAlert('')
    let line: 'status' | 'alert' = 'alert'
    let text: ReactNode = SAVE_FAILED
    let unread = false
    try {
      const { data, error } = await call()
      if (error) {
        text = error.code === '42501' ? NO_PERMISSION : SAVE_FAILED
      } else {
        unread = await reread(load.detail.order.id)
        const reply = parseActionReply(data)
        if (reply.ok) {
          line = 'status'
          text = done(reply)
        } else {
          text = refused(action, reply, items)
        }
      }
    } catch {
      // The sentence stays «تعذّر الحفظ».
    }
    inFlight.current = false
    setBusy(null)
    if (unread) report('alert', <>{text} {REREAD_FAILED}</>)
    else report(line, text)
  }

  /**
   * A money action (the owner's calls of the `admin` function): the same guard as `act` against a second press
   * and the same new reading of the order whatever the answer; `task` answers the sentence, or null for none
   * (the owner closed the code dialog: the focus goes back to the control that was pressed).
   */
  async function moneyRun(key: string, task: () => Promise<Said | null>): Promise<void> {
    if (inFlight.current || load.kind !== 'ready') return
    inFlight.current = true
    const orderId = load.detail.order.id
    focusBack.mark()
    setBusy(key)
    setStatus('')
    setAlert('')
    let said: Said | null = { line: 'alert', text: SAVE_FAILED }
    try {
      said = await task()
    } catch {
      // The sentence stays «تعذّر الحفظ».
    }
    const unread = await reread(orderId)
    inFlight.current = false
    setBusy(null)
    if (unread) report('alert', said === null ? REREAD_FAILED : <>{said.text} {REREAD_FAILED}</>)
    else if (said !== null) report(said.line, said.text)
    else focusBack.back()
  }

  function reload() {
    setLoad({ kind: 'loading' })
    setRound((value) => value + 1)
  }

  function toggle(itemId: string, on: boolean) {
    setSelected((current) => (on ? [...current, itemId] : current.filter((entry) => entry !== itemId)))
  }

  function fulfil(state: 'preparing' | 'shipped' | 'delivered') {
    if (load.kind !== 'ready') return
    // Only lines that can still move: one chosen before a refund made it fully refunded (seen on the re-read) is not sent.
    const { fulfillments, items } = load.detail
    const sendable = selected.filter((itemId) => {
      const entry = fulfillments.find((candidate) => candidate.itemId === itemId)
      return entry !== undefined && !(entry.state === 'preparing' && items.find((item) => item.id === itemId)?.fullyRefunded === true)
    })
    if (sendable.length === 0) return report('alert', NO_ITEMS)
    const company = clean(carrier)
    const number = clean(tracking)
    if (state === 'shipped' && (company === '' || number === '')) return report('alert', NEEDS_CARRIER)
    void act(
      `fulfil:${state}`,
      'fulfil',
      () =>
        rpc('fulfillment_update', {
          p_order: load.detail.order.id,
          p_item_ids: sendable,
          p_state: state,
          p_carrier: state === 'shipped' ? company : null,
          p_tracking: state === 'shipped' ? number : null,
          p_dedication_done: state === 'preparing' ? true : null,
        }),
      (reply) => {
        if (reply.changed === 0) return 'لا تغيير.'
        // The dedication is the step before shipping the same lines: they stay chosen; shipped or delivered ones do not.
        if (state !== 'preparing') setSelected([])
        if (state === 'shipped') {
          setCarrier('')
          setTracking('')
        }
        return 'تم التحديث.'
      },
    )
  }

  function decide(returnId: string, decision: 'approved' | 'rejected') {
    const note = clean(notes[returnId] ?? '')
    void act(
      `decide:${returnId}`,
      'decide',
      () => rpc('return_decide', { p_return: returnId, p_decision: decision, p_note: note === '' ? null : note }),
      () => {
        setNotes((current) => ({ ...current, [returnId]: '' }))
        return 'تم تسجيل القرار.'
      },
    )
  }

  function receive(returned: OrderDetail['returns'][number]) {
    if (load.kind !== 'ready') return
    const { items } = load.detail
    // Only the owner says the goods are sellable again; operations always send none. A preorder line has no stock to restore.
    const entries = owner
      ? returned.items.flatMap((line) => {
          const item = items.find((candidate) => candidate.id === line.itemId)
          const quantity = clampQuantity(restock[`${returned.id}:${line.itemId}`] ?? '', line.quantity)
          return item !== undefined && item.preorder === null && quantity > 0 ? [{ itemId: line.itemId, quantity }] : []
        })
      : []
    void act(
      `receive:${returned.id}`,
      'receive',
      () => rpc('return_receive', { p_return: returned.id, p_restock: entries }),
      (reply) => (
        <>
          تم تسجيل الاستلام.
          {reply.restocked.map((put) => (
            <span key={put.itemId}>
              {' '}
              أُعيد إلى المخزون: <bdi dir="ltr">{items.find((item) => item.id === put.itemId)?.sku ?? put.itemId}</bdi> من {formatNumber(put.from)} إلى{' '}
              {formatNumber(put.to)}
            </span>
          ))}
        </>
      ),
    )
  }

  function resolve() {
    if (load.kind !== 'ready') return
    setConfirming(false)
    void act('resolve', 'resolve', () => rpc('order_resolve', { p_order: load.detail.order.id }), () => 'تم إكمال الطلب.')
  }

  function closeReview(paymentId: string) {
    const reason = closeReason(closeReasons[paymentId] ?? '')
    if (!reason.ok) return report('alert', reason.message)
    void act(`close:${paymentId}`, 'close', () => rpc('review_close', { p_payment: paymentId, p_reason: reason.reason }), () => 'أُغلقت المراجعة.')
  }

  function toggleDispute(key: string) {
    setOpenDispute((current) => (current === key ? null : key))
  }

  function clear() {
    setStatus('')
    setAlert('')
  }

  if (!allowed) {
    return (
      <div>
        <h1>الطلب</h1>
        <p className={styles.error}>لا تملك صلاحية الوصول</p>
      </div>
    )
  }

  const state = valid ? load.kind : 'missing'
  const detail = valid && load.kind === 'ready' ? load.detail : null
  const off = busy !== null
  // What the money controls need of this screen: the guard, the sentence on its two lines, the step-up.
  const money: Money = { busy: off, run: moneyRun, say: report, clear, ask: step.ask }

  return (
    <div>
      <p>
        <Link className={styles.target} href="/admin/orders">
          العودة إلى الطلبات
        </Link>
      </p>
      {detail === null ? <h1>الطلب</h1> : <Header detail={detail} />}
      {/* Both always mounted, so what they say is announced when it is filled; the focus lands on the one that reports. */}
      <p role="status" ref={statusRef} tabIndex={-1} className={styles.message}>
        {status}
      </p>
      <p role="alert" ref={alertRef} tabIndex={-1} className={styles.error}>
        {alert}
      </p>
      {state === 'loading' && <p className={styles.message}>يحمّل...</p>}
      {state === 'failed' && (
        <div className={styles.row}>
          <p className={styles.error}>{LOAD_FAILED}</p>
          <button type="button" className={styles.buttonSecondary} onClick={reload}>
            تحديث
          </button>
        </div>
      )}
      {state === 'missing' && <p>{ORDER_NOT_FOUND}</p>}
      {detail !== null && sections(detail)}
      {/* Always mounted. Closing it gives the focus back to the control that asked for the code (`moneyRun`: that control was off). */}
      {step.dialog}
    </div>
  )

  /** The sections below the header. A plain function, not a component: a component declared here would be a new type on every render and lose the focus on every keystroke. */
  function sections(d: OrderDetail): ReactNode {
    const { order, items } = d
    const itemOf = (itemId: string): Item | undefined => items.find((item) => item.id === itemId)
    const nameById = (itemId: string): string => {
      const item = itemOf(itemId)
      return item === undefined ? itemId : nameOf(item)
    }
    const controls = order.status === 'paid'
    // The owner's money controls: the lines a dispute can name, and the paying attempt a refund is made against (not once the order is refunded).
    const disputable = disputeLines(d)
    const refundTarget = owner && order.status !== 'refunded' ? (d.attempts.find((attempt) => attempt.status === 'paid') ?? null) : null
    // The owner's «أعد الفحص» of a refund in flight: a column only while there is one.
    const rechecks = owner && d.refunds.some((refund) => refundInFlight(refund.status))
    const picked = d.fulfillments.filter((entry) => selected.includes(entry.itemId))
    const dedicate = picked.some((entry) => itemOf(entry.itemId)?.fulfillment === 'signed' && !entry.dedicationDone)

    return (
      <>
        <section>
          <h2>العميل والتوصيل</h2>
          <ul className={styles.metaList}>
            <Fact label="الاسم">
              <bdi>{order.contact.name}</bdi>
            </Fact>
            <Fact label="البريد">{ltrLong(order.contact.email)}</Fact>
            <Fact label="الجوال">{ltr(order.contact.phone)}</Fact>
            <Fact label="المدينة">{order.delivery.city === null ? NONE : <bdi>{order.delivery.city}</bdi>}</Fact>
            <Fact label="العنوان">{order.delivery.address === null ? NONE : <bdi>{order.delivery.address}</bdi>}</Fact>
          </ul>
        </section>

        <section>
          <h2>العناصر</h2>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.responsive}`}>
              <thead>
                <tr>
                  <th>الرمز</th>
                  <th>العنصر</th>
                  <th>النوع</th>
                  <th>الكمية</th>
                  <th>السعر</th>
                  <th>الخصم</th>
                  <th>الإجمالي</th>
                  <th>المُعاد</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="الرمز">{ltr(item.sku)}</td>
                    <td data-label="العنصر">
                      <bdi>{nameOf(item)}</bdi>
                      {item.dedication !== null && (
                        <p>
                          الإهداء: <bdi>{item.dedication}</bdi>
                        </p>
                      )}
                      {item.preorder !== null && (
                        <p>
                          {preorderSentence(item.preorder)}
                          <br />
                          <bdi>{item.preorder.note}</bdi>
                        </p>
                      )}
                    </td>
                    <td data-label="النوع" className={styles.cellNowrap}>
                      <Enum labels={FULFILLMENT_TYPE_LABELS} code={item.fulfillment} />
                    </td>
                    <td data-label="الكمية">{formatNumber(item.quantity)}</td>
                    <td data-label="السعر" className={styles.cellNowrap}>
                      {formatMoney(item.unitPrice)}
                    </td>
                    <td data-label="الخصم" className={styles.cellNowrap}>
                      {formatMoney(item.discount)}
                    </td>
                    <td data-label="الإجمالي" className={styles.cellNowrap}>
                      {formatMoney(item.total)}
                    </td>
                    <td data-label="المُعاد">
                      {item.refunded > 0 && formatMoney(item.refunded)}
                      {item.refunded > 0 && item.fullyRefunded && ' '}
                      {item.fullyRefunded && 'مُعاد بالكامل'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={styles.metaList}>
            <Fact label="المجموع الفرعي">{formatMoney(order.subtotal)}</Fact>
            <Fact label="الخصم">
              {formatMoney(order.discount)}
              {order.couponCode !== null && (
                <>
                  {' '}
                  (كود الخصم {ltr(order.couponCode)})
                </>
              )}
            </Fact>
            <Fact label="الشحن">{formatMoney(order.shipping)}</Fact>
            <Fact label="الإجمالي">{formatMoney(order.total)}</Fact>
            <Fact label="المُعاد">{formatMoney(order.refunded)}</Fact>
          </ul>
        </section>

        <section>
          <h2>الدفع</h2>
          {d.attempts.length === 0 && <p className={styles.message}>لا توجد محاولات دفع.</p>}
          <div className={styles.cards}>
            {d.attempts.map((attempt) => (
              <div key={attempt.id} className={styles.listItem}>
                <ul className={styles.metaList}>
                  <Fact label="الحالة">
                    <Enum labels={ATTEMPT_STATUS_LABELS} code={attempt.status} /> <TestBadge environment={attempt.environment} />
                  </Fact>
                  <Fact label="المبلغ">{formatMoney(attempt.amount)}</Fact>
                  <Fact label="رقم الفاتورة لدى Moyasar">{ltrLong(attempt.providerInvoiceId)}</Fact>
                  <Fact label="رقم الدفعة لدى Moyasar">{ltrLong(attempt.providerPaymentId)}</Fact>
                  <Fact label="حالة المزوّد">{ltr(attempt.providerStatus)}</Fact>
                  <Fact label="المُعاد لدى المزوّد">{formatMoney(attempt.providerRefunded)}</Fact>
                  {attempt.captured !== null && <Fact label="المقبوض">{formatMoney(attempt.captured)}</Fact>}
                  {attempt.fee !== null && <Fact label="الرسوم">{formatMoney(attempt.fee)}</Fact>}
                  {attempt.sourceType !== null && <Fact label="نوع المصدر">{ltr(attempt.sourceType)}</Fact>}
                  {attempt.sourceCompany !== null && <Fact label="الشركة">{ltr(attempt.sourceCompany)}</Fact>}
                  {attempt.paidAt !== null && <Fact label="وقت الدفع">{formatRiyadh(attempt.paidAt)}</Fact>}
                  {attempt.fetchedAt !== null && <Fact label="آخر تحقق من المزوّد">{formatRiyadh(attempt.fetchedAt)}</Fact>}
                  {attempt.lastError !== null && <Fact label="آخر خطأ">{ltr(attempt.lastError)}</Fact>}
                </ul>
                {owner && (
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      disabled={off}
                      onClick={() => void money.run(`recheck:${attempt.id}`, () => recheckAttempt(attempt.id))}
                    >
                      أعد الفحص
                    </button>
                    {attempt.status === 'paid' && (
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-expanded={openDispute === `attempt:${attempt.id}`}
                        disabled={off}
                        onClick={() => toggleDispute(`attempt:${attempt.id}`)}
                      >
                        تسجيل اعتراض
                      </button>
                    )}
                  </div>
                )}
                {openDispute === `attempt:${attempt.id}` && (
                  <DisputeForm mode={{ kind: 'payment', target: { attemptId: attempt.id } }} lines={disputable} money={money} onClose={() => setOpenDispute(null)} />
                )}
              </div>
            ))}
          </div>
          {d.reviews.length > 0 && (
            <>
              <h3>دفعات قيد المراجعة</h3>
              <div className={styles.cards}>
                {d.reviews.map((review) => (
                  <div key={review.paymentId} className={styles.listItem}>
                    <ul className={styles.metaList}>
                      <Fact label="السبب">
                        <Enum labels={REVIEW_REASON_LABELS} code={review.reason} />
                      </Fact>
                      <Fact label="المبلغ">{review.amount === null ? NONE : formatMoney(review.amount)}</Fact>
                      <Fact label="رقم الدفعة لدى Moyasar">{ltrLong(review.paymentId)}</Fact>
                      <Fact label="حالة المزوّد">{ltr(review.providerStatus)}</Fact>
                      <Fact label="المُعاد">{formatMoney(review.refunded)}</Fact>
                      <Fact label="وقت الإنشاء">{formatRiyadh(review.createdAt)}</Fact>
                      <Fact label="الإغلاق">
                        {review.closedAt === null ? (
                          'مفتوحة'
                        ) : (
                          <>
                            أُغلقت {formatRiyadh(review.closedAt)}
                            {review.closedReason !== null && (
                              <>
                                : <bdi>{review.closedReason}</bdi>
                              </>
                            )}
                          </>
                        )}
                      </Fact>
                    </ul>
                    {owner && review.closedAt === null && (
                      <div className={styles.form}>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor={`close-${review.paymentId}`}>
                            سبب الإغلاق
                          </label>
                          <input
                            id={`close-${review.paymentId}`}
                            className={styles.input}
                            type="text"
                            maxLength={300}
                            value={closeReasons[review.paymentId] ?? ''}
                            onChange={(event) => setCloseReasons((current) => ({ ...current, [review.paymentId]: event.target.value }))}
                          />
                        </div>
                        <div className={styles.row}>
                          <button type="button" className={styles.button} disabled={off} onClick={() => closeReview(review.paymentId)}>
                            إغلاق المراجعة
                          </button>
                        </div>
                      </div>
                    )}
                    {owner && review.closedReason !== 'refunded' && (
                      <RefundView
                        subject={{
                          kind: 'review',
                          paymentId: review.paymentId,
                          orderId: review.orderId,
                          remainder: Math.max(0, (review.amount ?? 0) - review.refunded),
                        }}
                        money={money}
                      />
                    )}
                    {owner && (
                      <div className={styles.row}>
                        <button
                          type="button"
                          className={styles.buttonSecondary}
                          aria-expanded={openDispute === `review:${review.paymentId}`}
                          disabled={off}
                          onClick={() => toggleDispute(`review:${review.paymentId}`)}
                        >
                          تسجيل اعتراض
                        </button>
                      </div>
                    )}
                    {openDispute === `review:${review.paymentId}` && (
                      <DisputeForm
                        mode={{ kind: 'payment', target: { reviewPaymentId: review.paymentId } }}
                        lines={disputable}
                        money={money}
                        onClose={() => setOpenDispute(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <h3>إشعارات الدفع</h3>
          {d.events.length === 0 && <p className={styles.message}>لا توجد إشعارات.</p>}
          {d.events.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.responsive}`}>
                <thead>
                  <tr>
                    <th>النوع</th>
                    <th>النتيجة</th>
                    <th>وقت الاستلام</th>
                    <th>وقت المعالجة</th>
                    <th>المحاولات</th>
                    <th>الخطأ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.events.map((event) => (
                    <tr key={event.eventId}>
                      <td data-label="النوع">{ltrLong(event.type)}</td>
                      <td data-label="النتيجة">{ltrLong(event.outcome)}</td>
                      <td data-label="وقت الاستلام" className={styles.cellNowrap}>
                        {formatRiyadh(event.receivedAt)}
                      </td>
                      <td data-label="وقت المعالجة" className={styles.cellNowrap}>
                        {when(event.processedAt)}
                      </td>
                      <td data-label="المحاولات">{formatNumber(event.attempts)}</td>
                      <td data-label="الخطأ">{event.error !== null && ltrLong(event.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {d.fulfillments.length > 0 && (
          <section>
            <h2>الشحن</h2>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.responsive}`}>
                <thead>
                  <tr>
                    <th>العنصر</th>
                    <th>الحالة</th>
                    <th>شركة الشحن</th>
                    <th>رقم التتبع</th>
                    <th>الإهداء</th>
                    <th>وقت الشحن</th>
                    <th>وقت التسليم</th>
                  </tr>
                </thead>
                <tbody>
                  {d.fulfillments.map((entry) => {
                    const item = itemOf(entry.itemId)
                    // A fully refunded line still being prepared is shown but is not shipped.
                    const choosable = !(entry.state === 'preparing' && item?.fullyRefunded === true)
                    return (
                      <tr key={entry.id}>
                        <td data-label="العنصر">
                          {controls ? (
                            <label className={styles.target}>
                              <input
                                type="checkbox"
                                checked={choosable && selected.includes(entry.itemId)}
                                disabled={!choosable}
                                onChange={(event) => toggle(entry.itemId, event.target.checked)}
                              />
                              <bdi>{nameById(entry.itemId)}</bdi>
                            </label>
                          ) : (
                            <bdi>{nameById(entry.itemId)}</bdi>
                          )}
                        </td>
                        <td data-label="الحالة" className={styles.cellNowrap}>
                          <Enum labels={FULFILLMENT_STATE_LABELS} code={entry.state} />
                        </td>
                        <td data-label="شركة الشحن">{entry.carrier !== null && <bdi>{entry.carrier}</bdi>}</td>
                        <td data-label="رقم التتبع">{entry.tracking !== null && ltrLong(entry.tracking)}</td>
                        <td data-label="الإهداء">{item?.fulfillment === 'signed' && (entry.dedicationDone ? 'نعم' : 'لا')}</td>
                        <td data-label="وقت الشحن" className={styles.cellNowrap}>
                          {entry.shippedAt !== null && formatRiyadh(entry.shippedAt)}
                        </td>
                        <td data-label="وقت التسليم" className={styles.cellNowrap}>
                          {entry.deliveredAt !== null && formatRiyadh(entry.deliveredAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {controls && (
              <div className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ship-carrier">
                    شركة الشحن
                  </label>
                  <input
                    id="ship-carrier"
                    className={styles.input}
                    type="text"
                    maxLength={80}
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ship-tracking">
                    رقم التتبع
                  </label>
                  <input
                    id="ship-tracking"
                    className={styles.input}
                    type="text"
                    dir="ltr"
                    maxLength={120}
                    value={tracking}
                    onChange={(event) => setTracking(event.target.value)}
                  />
                </div>
                <div className={styles.row}>
                  {dedicate && (
                    <button type="button" className={styles.button} disabled={off} onClick={() => fulfil('preparing')}>
                      تم الإهداء
                    </button>
                  )}
                  <button type="button" className={styles.button} disabled={off} onClick={() => fulfil('shipped')}>
                    تم الشحن
                  </button>
                  <button type="button" className={styles.button} disabled={off} onClick={() => fulfil('delivered')}>
                    تم التسليم
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {d.entitlements.length > 0 && (
          <section>
            <h2>الملفات</h2>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.responsive}`}>
                <thead>
                  <tr>
                    <th>العنصر</th>
                    <th>الحالة</th>
                    <th>الملف</th>
                  </tr>
                </thead>
                <tbody>
                  {d.entitlements.map((entitlement) => (
                    <tr key={entitlement.id}>
                      <td data-label="العنصر">
                        <bdi>{nameById(entitlement.itemId)}</bdi>
                      </td>
                      <td data-label="الحالة">
                        {entitlement.revokedAt === null ? (
                          'ممنوح'
                        ) : (
                          <>
                            مسحوب{entitlement.revokeReason !== null && <> ({ltr(entitlement.revokeReason)})</>}
                          </>
                        )}
                      </td>
                      <td data-label="الملف">
                        {entitlement.hasFile ? <bdi>{entitlement.filename}</bdi> : entitlement.revokedAt === null && 'بانتظار الملف'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {d.returns.length > 0 && (
          <section>
            <h2>الإرجاع</h2>
            <div className={styles.cards}>
              {d.returns.map((returned) => (
                <div key={returned.id} className={styles.listItem}>
                  <ul className={styles.metaList}>
                    <Fact label="الحالة">
                      <Enum labels={RETURN_STATE_LABELS} code={returned.state} />
                    </Fact>
                    <Fact label="العناصر">
                      {returned.items.map((line, index) => (
                        <span key={line.itemId}>
                          {index > 0 && '، '}
                          <bdi>{nameById(line.itemId)}</bdi> × {formatNumber(line.quantity)}
                        </span>
                      ))}
                    </Fact>
                    <Fact label="السبب">
                      <bdi>{returned.reason}</bdi>
                    </Fact>
                    {returned.staffNote !== null && (
                      <Fact label="ملاحظة الفريق">
                        <bdi>{returned.staffNote}</bdi>
                      </Fact>
                    )}
                    {returned.restocked !== null && returned.restocked.length > 0 && (
                      <Fact label="أُعيد إلى المخزون">
                        {returned.restocked.map((line, index) => (
                          <span key={line.itemId}>
                            {index > 0 && '، '}
                            <bdi>{nameById(line.itemId)}</bdi> × {formatNumber(line.quantity)}
                          </span>
                        ))}
                      </Fact>
                    )}
                    <Fact label="وقت الطلب">{formatRiyadh(returned.createdAt)}</Fact>
                  </ul>
                  {returned.state === 'requested' && (
                    <div className={styles.form}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor={`note-${returned.id}`}>
                          ملاحظة (اختياري)
                        </label>
                        <input
                          id={`note-${returned.id}`}
                          className={styles.input}
                          type="text"
                          maxLength={500}
                          value={notes[returned.id] ?? ''}
                          onChange={(event) => setNotes((current) => ({ ...current, [returned.id]: event.target.value }))}
                        />
                      </div>
                      <div className={styles.row}>
                        <button type="button" className={styles.button} disabled={off} onClick={() => decide(returned.id, 'approved')}>
                          قبول
                        </button>
                        <button type="button" className={styles.button} disabled={off} onClick={() => decide(returned.id, 'rejected')}>
                          رفض
                        </button>
                      </div>
                    </div>
                  )}
                  {returned.state === 'approved' && (
                    <div className={styles.form}>
                      {owner &&
                        returned.items.map((line) => {
                          const item = itemOf(line.itemId)
                          if (item === undefined || item.preorder !== null) return null
                          const key = `${returned.id}:${line.itemId}`
                          return (
                            <div key={key} className={styles.field}>
                              <label className={styles.label} htmlFor={`restock-${key}`}>
                                يعود إلى المخزون: <bdi>{nameOf(item)}</bdi>
                              </label>
                              <input
                                id={`restock-${key}`}
                                className={styles.input}
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={line.quantity}
                                step={1}
                                value={restock[key] ?? '0'}
                                onChange={(event) => setRestock((current) => ({ ...current, [key]: event.target.value }))}
                              />
                            </div>
                          )
                        })}
                      <div className={styles.row}>
                        <button type="button" className={styles.button} disabled={off} onClick={() => receive(returned)}>
                          تم الاستلام
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {owner && order.status === 'paid_needs_resolution' && (
          <section>
            <h2>إكمال الطلب</h2>
            <p>يُخصم المخزون للعناصر غير المعادة، وتُمنح الملفات، ويُرسل إيصال.</p>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.buttonSecondary}
                aria-expanded={confirming}
                disabled={off}
                onClick={() => setConfirming((value) => !value)}
              >
                إكمال الطلب
              </button>
              {confirming && (
                <button ref={confirmRef} type="button" className={styles.button} disabled={off} onClick={resolve}>
                  تأكيد إكمال الطلب
                </button>
              )}
            </div>
          </section>
        )}

        {d.disputes !== null && (
          <section>
            <h2>النزاعات</h2>
            {d.disputes.length === 0 && <p className={styles.message}>لا توجد نزاعات.</p>}
            <div className={styles.cards}>
              {d.disputes.map((dispute) => (
                <div key={dispute.id} className={styles.listItem}>
                  <ul className={styles.metaList}>
                    <Fact label="النوع">
                      <Enum labels={DISPUTE_KIND_LABELS} code={dispute.kind} />
                    </Fact>
                    <Fact label="المرجع">{ltrLong(dispute.providerRef)}</Fact>
                    <Fact label="التسلسل">{formatNumber(dispute.seq)}</Fact>
                    <Fact label="المبلغ">{formatMoney(dispute.amount)}</Fact>
                    <Fact label="الاتجاه">
                      <Enum labels={DISPUTE_DIRECTION_LABELS} code={dispute.direction} />
                    </Fact>
                    <Fact label="التاريخ">{formatDate(dispute.occurredOn)}</Fact>
                    <Fact label="القرار">
                      <Enum labels={DISPUTE_DECISION_LABELS} code={dispute.decision} />
                    </Fact>
                    <Fact label="السبب">
                      <bdi>{dispute.reason}</bdi>
                    </Fact>
                    <Fact label="الحل">{dispute.resolution === null ? NONE : <bdi>{dispute.resolution}</bdi>}</Fact>
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {d.audit !== null && (
          <section>
            <h2>السجل</h2>
            {d.audit.length === 0 && <p className={styles.message}>لا يوجد سجل.</p>}
            {d.audit.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.responsive}`}>
                  <thead>
                    <tr>
                      <th>الوقت</th>
                      <th>الإجراء</th>
                      <th>التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.audit.map((row) => (
                      <tr key={row.id}>
                        <td data-label="الوقت" className={styles.cellNowrap}>
                          {formatRiyadh(row.at)}
                        </td>
                        <td data-label="الإجراء">{ltr(row.action)}</td>
                        <td data-label="التفاصيل">{ltrLong(JSON.stringify(row.summary))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {(d.refunds.length > 0 || refundTarget !== null) && (
          <section>
            <h2>الاستردادات</h2>
            {d.refunds.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={`${styles.table} ${styles.responsive}`}>
                  <thead>
                    <tr>
                      <th>الحالة</th>
                      <th>المبلغ</th>
                      <th>السبب</th>
                      <th>المصدر</th>
                      <th>وقت الطلب</th>
                      <th>وقت النجاح</th>
                      <th>الخطأ</th>
                      {rechecks && <th>إجراء</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.refunds.map((refund) => (
                      <tr key={refund.id}>
                        <td data-label="الحالة" className={styles.cellNowrap}>
                          <Enum labels={REFUND_STATUS_LABELS} code={refund.status} />
                        </td>
                        <td data-label="المبلغ" className={styles.cellNowrap}>
                          {formatMoney(refund.amount)}
                        </td>
                        <td data-label="السبب">
                          <bdi>{refund.reason}</bdi>
                        </td>
                        <td data-label="المصدر" className={styles.cellNowrap}>
                          <Enum labels={REFUND_SOURCE_LABELS} code={refund.source} />
                        </td>
                        <td data-label="وقت الطلب" className={styles.cellNowrap}>
                          {formatRiyadh(refund.createdAt)}
                        </td>
                        <td data-label="وقت النجاح" className={styles.cellNowrap}>
                          {refund.succeededAt !== null && formatRiyadh(refund.succeededAt)}
                        </td>
                        <td data-label="الخطأ">{refund.error !== null && ltr(refund.error)}</td>
                        {rechecks && (
                          <td data-label="إجراء">
                            {refundInFlight(refund.status) && (
                              <button
                                type="button"
                                className={styles.buttonSecondary}
                                disabled={off}
                                onClick={() => void money.run(`recheck-refund:${refund.id}`, () => recheckRefund(refund.id))}
                              >
                                أعد الفحص
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {refundTarget !== null && <RefundView subject={{ kind: 'order', detail: d, attemptId: refundTarget.id }} money={money} />}
          </section>
        )}
      </>
    )
  }
}

/** The order number, its status and its times. */
function Header({ detail }: { detail: OrderDetail }) {
  const { order } = detail
  return (
    <>
      <h1>
        <span dir="ltr">{order.orderNumber}</span>
      </h1>
      <ul className={styles.metaList}>
        <Fact label="الحالة">
          <Enum labels={ORDER_STATUS_LABELS} code={order.status} /> <TestBadge environment={order.environment} />
        </Fact>
        <Fact label="وقت الإنشاء">{formatRiyadh(order.createdAt)}</Fact>
        {order.paidAt !== null && <Fact label="وقت الدفع">{formatRiyadh(order.paidAt)}</Fact>}
        {order.status === 'pending_payment' && <Fact label="ينتهي الحجز">{formatRiyadh(order.holdExpiresAt)}</Fact>}
      </ul>
    </>
  )
}
