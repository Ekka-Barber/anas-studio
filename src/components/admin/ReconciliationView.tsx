'use client'

/**
 * The reconciliation screen (P08 round 11b), the owner's alone: what does not yet agree with Moyasar. The
 * attempts that need a look, the review payments that are open, the refunds in flight, the webhook events
 * that need a person, and the disputes the owner has recorded. The data is `reconciliation_list` and
 * `disputes_list` under the signed-in session (both owner-only in the SQL; an operations member or an editor
 * is told there is no access and nothing is asked). Every action is a call, and after it both lists are read
 * again: the screen shows what they say, never what the call was hoped to do. The SQL lists the newest 100 of
 * each without saying so; the screen says it.
 */
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { BAD_REPLY, CAPPED, DISMISS_SENTENCE, disputeLines, EMPTY_LIST, inFlight as refundInFlight, LIST_CAP, REREAD_FAILED, type DisputeLine } from '@/lib/admin-money'
import {
  ATTEMPT_STATUS_LABELS,
  closeReason,
  DISPUTE_DECISION_LABELS,
  DISPUTE_DIRECTION_LABELS,
  DISPUTE_KIND_LABELS,
  LOAD_FAILED,
  NO_PERMISSION,
  parseActionReply,
  parseDisputes,
  parseOrderDetail,
  parseOrdersList,
  parseReconciliation,
  RECONCILIATION_REASON_LABELS,
  REFUND_STATUS_LABELS,
  refusalText,
  REVIEW_REASON_LABELS,
  SAVE_FAILED,
  type DisputeReference,
  type OrderAction,
  type Reconciliation,
} from '@/lib/admin-orders'
import { formatDate, formatMoney, formatNumber, formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'
import { DisputeForm, type DisputeMode } from './DisputeForm'
import { Enum, Fact, ltr, ltrLong, NONE, TestBadge } from './OrdersView'
import { ExternalRefund, recheckAttempt, recheckRefund, RefundView, useFocusBack, useStepUp, type Money, type Said } from './RefundView'

type Data = { rec: Reconciliation; disputes: DisputeReference[] }
type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: Data }
type Reply = { data: unknown; error: { code?: string } | null }
/** The dispute form that is open: which control opened it, how, and the order whose lines a decision may name. */
type OpenForm = { key: string; mode: DisputeMode; orderNumber: string | null }

const rpc = (fn: string, args: Record<string, unknown>): PromiseLike<Reply> => getSupabaseBrowserClient().rpc(fn, args)

/** Both lists as they are now; a reply that is not what it should be is a failure, not an empty list. */
async function readAll(): Promise<Load> {
  try {
    const supabase = getSupabaseBrowserClient()
    const [rec, disputes] = await Promise.all([supabase.rpc('reconciliation_list'), supabase.rpc('disputes_list')])
    if (rec.error || disputes.error) return { kind: 'failed' }
    return { kind: 'ready', data: { rec: parseReconciliation(rec.data), disputes: parseDisputes(disputes.data) } }
  } catch {
    return { kind: 'failed' }
  }
}

/** The lines of an order, found by its number, for a decision that names some; null when they cannot be read. */
async function orderLines(orderNumber: string): Promise<DisputeLine[] | null> {
  try {
    const supabase = getSupabaseBrowserClient()
    const found = await supabase.rpc('orders_list', { p_filter: 'all', p_query: orderNumber, p_before: null, p_limit: 1 })
    if (found.error) return null
    const order = parseOrdersList(found.data).rows[0]
    if (order === undefined) return null
    const detail = await supabase.rpc('order_detail', { p_order: order.id })
    if (detail.error) return null
    const parsed = parseOrderDetail(detail.data)
    return parsed.found ? disputeLines(parsed.detail) : null
  } catch {
    return null
  }
}

const orderLink = (id: string, number: string): ReactNode => (
  <Link className={styles.target} dir="ltr" href={`/admin/orders/view?id=${id}`}>
    {number}
  </Link>
)

/** A list's two notes: nothing in it, or the SQL's silent cap. */
function Notes({ count }: { count: number }) {
  return (
    <>
      {count === 0 && <p className={styles.message}>{EMPTY_LIST}</p>}
      {count >= LIST_CAP && <p className={styles.message}>{CAPPED}</p>}
    </>
  )
}

export function ReconciliationView() {
  const role = useStaffRole()
  const owner = role === 'owner'
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [status, setStatus] = useState<ReactNode>('')
  const [alert, setAlert] = useState<ReactNode>('')
  const [focusLine, setFocusLine] = useState<{ line: 'status' | 'alert'; n: number } | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const step = useStepUp()
  const focusBack = useFocusBack()
  const [closeReasons, setCloseReasons] = useState<Record<string, string>>({})
  // The attempt whose «تسجيل استرداد خارجي» form is open.
  const [external, setExternal] = useState<string | null>(null)
  const [form, setForm] = useState<OpenForm | null>(null)
  const [formLines, setFormLines] = useState<{ order: string; lines: DisputeLine[] | null } | null>(null)

  useEffect(() => {
    if (!owner) return
    let active = true
    void (async () => {
      const next = await readAll()
      if (active) setLoad(next)
    })()
    return () => {
      active = false
    }
  }, [owner, round])

  // After an action the focus goes to the line that reports it.
  useEffect(() => {
    if (focusLine !== null) (focusLine.line === 'alert' ? alertRef : statusRef).current?.focus()
  }, [focusLine])

  function report(line: 'status' | 'alert', text: ReactNode) {
    setStatus(line === 'status' ? text : '')
    setAlert(line === 'alert' ? text : '')
    setFocusLine((current) => ({ line, n: (current?.n ?? 0) + 1 }))
  }

  /**
   * One call and what follows it: the button is off while it is in flight (a second press sends nothing), both
   * lists are read again whatever the answer, and the result goes to the status or the alert line, which takes
   * the focus. `task` answers the sentence, or null for none (the owner closed the code dialog: the focus goes back
   * to the control that was pressed). A reading that fails leaves the lists drawn as they were, and says so: they
   * hold the refund forms, and the idempotency key a repeat of a refund needs.
   */
  async function run(key: string, task: () => Promise<Said | null>): Promise<void> {
    if (inFlight.current || load.kind !== 'ready') return
    inFlight.current = true
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
    const next = await readAll()
    setLoad((current) => (next.kind === 'failed' && current.kind === 'ready' ? current : next))
    inFlight.current = false
    setBusy(null)
    if (next.kind === 'failed') report('alert', said === null ? REREAD_FAILED : <>{said.text} {REREAD_FAILED}</>)
    else if (said !== null) report(said.line, said.text)
    else focusBack.back()
  }

  /** A call of one of the SQL functions the screen reaches directly (`review_close`, `event_dismiss`). */
  function act(key: string, action: OrderAction, call: () => PromiseLike<Reply>, done: string): void {
    void run(key, async () => {
      const { data, error } = await call()
      if (error) return { line: 'alert', text: error.code === '42501' ? NO_PERMISSION : SAVE_FAILED }
      let reply: ReturnType<typeof parseActionReply>
      try {
        reply = parseActionReply(data)
      } catch {
        // Never read as done or as refused: the lists are read again and show what is.
        return { line: 'alert', text: BAD_REPLY }
      }
      return reply.ok ? { line: 'status', text: done } : { line: 'alert', text: refusalText(action, reply) }
    })
  }

  function closeReview(paymentId: string) {
    const reason = closeReason(closeReasons[paymentId] ?? '')
    if (!reason.ok) return report('alert', reason.message)
    act(`close:${paymentId}`, 'close', () => rpc('review_close', { p_payment: paymentId, p_reason: reason.reason }), 'أُغلقت المراجعة.')
  }

  function toggleForm(next: OpenForm) {
    const closing = form?.key === next.key
    setForm(closing ? null : next)
    setFormLines(null)
    const order = next.orderNumber
    if (!closing && order !== null) {
      void (async () => {
        const lines = await orderLines(order)
        setFormLines({ order, lines })
      })()
    }
  }

  function clear() {
    setStatus('')
    setAlert('')
  }

  function reload() {
    setLoad({ kind: 'loading' })
    setRound((value) => value + 1)
  }

  if (!owner) {
    return (
      <div>
        <h1>المطابقة</h1>
        <p className={styles.error}>لا تملك صلاحية الوصول</p>
      </div>
    )
  }

  const off = busy !== null
  const money: Money = { busy: off, run, say: report, clear, ask: step.ask }
  const data = load.kind === 'ready' ? load.data : null
  /** The order's lines for the open form: not asked for a form with no order, `'loading'` until they are read. */
  const linesOf = (open: OpenForm): DisputeLine[] | 'loading' | null =>
    open.orderNumber === null ? null : formLines?.order === open.orderNumber ? formLines.lines : 'loading'

  return (
    <div>
      <p>
        <Link className={styles.target} href="/admin/orders">
          العودة إلى الطلبات
        </Link>
      </p>
      <h1>المطابقة</h1>
      {/* Both always mounted, so what they say is announced when it is filled; the focus lands on the one that reports. */}
      <p role="status" ref={statusRef} tabIndex={-1} className={styles.message}>
        {status}
      </p>
      <p role="alert" ref={alertRef} tabIndex={-1} className={styles.error}>
        {alert}
      </p>
      {load.kind === 'loading' && <p className={styles.message}>يحمّل...</p>}
      {load.kind === 'failed' && (
        <div className={styles.row}>
          <p className={styles.error}>{LOAD_FAILED}</p>
          <button type="button" className={styles.buttonSecondary} onClick={reload}>
            تحديث
          </button>
        </div>
      )}
      {data !== null && (
        <>
          <section>
            <h2>محاولات تحتاج فحصًا</h2>
            <Notes count={data.rec.attempts.length} />
            <div className={styles.cards}>
              {data.rec.attempts.map((attempt) => (
                <div key={attempt.id} className={styles.listItem}>
                  <ul className={styles.metaList}>
                    <Fact label="رقم الطلب">
                      {orderLink(attempt.orderId, attempt.orderNumber)} <TestBadge environment={attempt.environment} />
                    </Fact>
                    <Fact label="الحالة">
                      <Enum labels={ATTEMPT_STATUS_LABELS} code={attempt.status} />
                    </Fact>
                    <Fact label="المبلغ">{formatMoney(attempt.amount)}</Fact>
                    <Fact label="رقم الفاتورة لدى Moyasar">{ltrLong(attempt.providerInvoiceId)}</Fact>
                    <Fact label="رقم الدفعة لدى Moyasar">{ltrLong(attempt.providerPaymentId)}</Fact>
                    <Fact label="الأسباب">
                      {attempt.reasons.map((reason, index) => (
                        <span key={reason}>
                          {index > 0 && '، '}
                          <Enum labels={RECONCILIATION_REASON_LABELS} code={reason} />
                        </span>
                      ))}
                    </Fact>
                  </ul>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      disabled={off}
                      onClick={() => void run(`recheck:${attempt.id}`, () => recheckAttempt(attempt.id))}
                    >
                      أعد الفحص
                    </button>
                  </div>
                  {(attempt.reasons.includes('EXTERNAL_REFUND') || attempt.reasons.includes('PROVIDER_STATUS')) && (
                    <ExternalRefund
                      target={{ attemptId: attempt.id }}
                      money={money}
                      open={external === attempt.id}
                      onOpenChange={(open) => setExternal(open ? attempt.id : null)}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>دفعات قيد المراجعة</h2>
            <Notes count={data.rec.reviews.length} />
            <div className={styles.cards}>
              {data.rec.reviews.map((review) => {
                const formKey = `review:${review.paymentId}`
                const open: OpenForm = {
                  key: formKey,
                  mode: { kind: 'payment', target: { reviewPaymentId: review.paymentId } },
                  orderNumber: review.orderNumber,
                }
                return (
                  <div key={review.paymentId} className={styles.listItem}>
                    <ul className={styles.metaList}>
                      <Fact label="السبب">
                        <Enum labels={REVIEW_REASON_LABELS} code={review.reason} />
                      </Fact>
                      <Fact label="المبلغ">{review.amount === null ? NONE : formatMoney(review.amount)}</Fact>
                      <Fact label="المُعاد">{formatMoney(review.refunded)}</Fact>
                      <Fact label="الطلب">
                        {review.orderNumber === null || review.orderId === null ? 'بلا طلب' : orderLink(review.orderId, review.orderNumber)}{' '}
                        <TestBadge environment={review.environment} />
                      </Fact>
                      <Fact label="رقم الدفعة لدى Moyasar">{ltrLong(review.paymentId)}</Fact>
                    </ul>
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
                      {review.orderId === null && (
                        <p className={styles.message}>دفعة بلا طلب تختفي من اللوحة بعد إغلاقها ولا تُعاد منها؛ أعدها قبل الإغلاق إن لزم.</p>
                      )}
                    </div>
                    <RefundView
                      subject={{
                        kind: 'review',
                        paymentId: review.paymentId,
                        orderId: review.orderId,
                        remainder: Math.max(0, (review.amount ?? 0) - review.refunded),
                        // The row's confirmed total (`refund_request` checks it: STALE) and whether one of its refunds is still settling.
                        refunded: review.refunded,
                        inFlight: data.rec.refunds.some((refund) => refund.reviewPaymentId === review.paymentId && refundInFlight(refund.status)),
                      }}
                      money={money}
                    />
                    <div className={styles.row}>
                      <button type="button" className={styles.buttonSecondary} aria-expanded={form?.key === formKey} disabled={off} onClick={() => toggleForm(open)}>
                        تسجيل اعتراض
                      </button>
                    </div>
                    {form?.key === formKey && <DisputeForm mode={form.mode} lines={linesOf(form)} money={money} onClose={() => setForm(null)} />}
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <h2>استردادات قيد المعالجة</h2>
            <Notes count={data.rec.refunds.length} />
            <div className={styles.cards}>
              {data.rec.refunds.map((refund) => (
                <div key={refund.id} className={styles.listItem}>
                  <ul className={styles.metaList}>
                    <Fact label="رقم الطلب">
                      {refund.orderNumber === null || refund.orderId === null ? 'بلا طلب' : orderLink(refund.orderId, refund.orderNumber)}
                    </Fact>
                    <Fact label="المبلغ">{formatMoney(refund.amount)}</Fact>
                    <Fact label="الحالة">
                      <Enum labels={REFUND_STATUS_LABELS} code={refund.status} />
                    </Fact>
                    <Fact label="وقت الطلب">{formatRiyadh(refund.createdAt)}</Fact>
                    {refund.error !== null && <Fact label="الخطأ">{ltrLong(refund.error)}</Fact>}
                  </ul>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      disabled={off}
                      onClick={() => void run(`recheck-refund:${refund.id}`, () => recheckRefund(refund.id))}
                    >
                      أعد الفحص
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>إشعارات الدفع</h2>
            <Notes count={data.rec.events.length} />
            <div className={styles.cards}>
              {data.rec.events.map((event) => (
                <div key={event.eventId} className={styles.listItem}>
                  <ul className={styles.metaList}>
                    <Fact label="النوع">{ltrLong(event.type)}</Fact>
                    <Fact label="وقت الاستلام">{formatRiyadh(event.receivedAt)}</Fact>
                    <Fact label="رقم الدفعة لدى Moyasar">{ltrLong(event.paymentId)}</Fact>
                    <Fact label="النتيجة">{ltrLong(event.outcome)}</Fact>
                    <Fact label="المحاولات">{formatNumber(event.attempts)}</Fact>
                    {event.error !== null && <Fact label="الخطأ">{ltrLong(event.error)}</Fact>}
                  </ul>
                  {event.outcome === 'exhausted' && (
                    <div className={styles.row}>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={off}
                        aria-describedby={`dismiss-${event.eventId}`}
                        onClick={() => act(`dismiss:${event.eventId}`, 'dismiss', () => rpc('event_dismiss', { p_event: event.eventId }), 'سُجّلت المراجعة.')}
                      >
                        تمت المراجعة
                      </button>
                      <span id={`dismiss-${event.eventId}`} className={styles.message}>
                        {DISMISS_SENTENCE}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>النزاعات</h2>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.buttonSecondary}
                aria-expanded={form?.key === 'difference'}
                disabled={off}
                onClick={() => toggleForm({ key: 'difference', mode: { kind: 'difference' }, orderNumber: null })}
              >
                تسجيل فرق
              </button>
            </div>
            {form?.key === 'difference' && <DisputeForm mode={form.mode} lines={null} money={money} onClose={() => setForm(null)} />}
            {data.disputes.length === 0 && <p className={styles.message}>{EMPTY_LIST}</p>}
            <div className={styles.cards}>
              {data.disputes.map((reference) => {
                const first = reference.rows[0]!
                const latest = reference.rows[reference.rows.length - 1]!
                const formKey = `follow:${reference.kind}:${reference.providerRef}`
                const open: OpenForm = {
                  key: formKey,
                  mode: {
                    kind: 'follow',
                    target: { attemptId: first.attemptId ?? undefined, reviewPaymentId: first.reviewPaymentId ?? undefined },
                    providerRef: reference.providerRef,
                    disputeKind: reference.kind,
                    follows: latest.seq,
                    orderNumber: first.orderNumber,
                  },
                  orderNumber: first.orderNumber,
                }
                return (
                  <div key={`${reference.kind}:${reference.providerRef}`} className={styles.listItem}>
                    <ul className={styles.metaList}>
                      <Fact label="المرجع">{ltrLong(reference.providerRef)}</Fact>
                      <Fact label="النوع">
                        <Enum labels={DISPUTE_KIND_LABELS} code={reference.kind} />
                      </Fact>
                      {first.orderNumber !== null && <Fact label="الطلب">{ltr(first.orderNumber)}</Fact>}
                    </ul>
                    {reference.rows.map((row) => (
                      <ul key={row.id} className={styles.metaList}>
                        <Fact label="التسلسل">
                          {formatNumber(row.seq)} <TestBadge environment={row.environment} />
                        </Fact>
                        <Fact label="المبلغ">{formatMoney(row.amount)}</Fact>
                        <Fact label="الاتجاه">
                          <Enum labels={DISPUTE_DIRECTION_LABELS} code={row.direction} />
                        </Fact>
                        <Fact label="التاريخ">{formatDate(row.occurredOn)}</Fact>
                        <Fact label="القرار">
                          <Enum labels={DISPUTE_DECISION_LABELS} code={row.decision} />
                        </Fact>
                        <Fact label="السبب">
                          <bdi>{row.reason}</bdi>
                        </Fact>
                        <Fact label="الحل">{row.resolution === null ? NONE : <bdi>{row.resolution}</bdi>}</Fact>
                      </ul>
                    ))}
                    <div className={styles.row}>
                      <button type="button" className={styles.buttonSecondary} aria-expanded={form?.key === formKey} disabled={off} onClick={() => toggleForm(open)}>
                        إضافة متابعة
                      </button>
                    </div>
                    {form?.key === formKey && <DisputeForm mode={form.mode} lines={linesOf(form)} money={money} onClose={() => setForm(null)} />}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
      {/* Always mounted. Closing it gives the focus back to the control that asked for the code (`run`: that control was off). */}
      {step.dialog}
    </div>
  )
}
