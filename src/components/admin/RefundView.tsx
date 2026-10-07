'use client'

/**
 * The owner's money controls (P08 round 11b): the refund form of an order's paying attempt or of a review
 * payment, its confirmation, and the recording of a refund made at the provider's own dashboard. Each is a
 * call of the `admin` function; the two that move money (`refund-create`, `refund-record-external`) ask for
 * a fresh authenticator code, which the step-up dialog collects before the same body is sent once more.
 *
 * A refund goes in one body with one idempotency key. The body is frozen when «إعادة المبلغ» passes the form's
 * checks (what the confirmation shows is what is sent), and the key is minted when the owner confirms. Both are
 * kept for a step-up retry and for a retry after a network failure (a repeat answers the stored refund and never
 * reaches the provider twice) and dropped when the form changes or a final answer arrives (`admin-money.ts`).
 * The body also says which confirmed refunded total the form was built from (`expectedRefunded`): a refund
 * confirmed since makes the function answer STALE, a final answer, and the screen reads the order again. A kept key
 * keeps the total it was minted with (`refundRequest`). While a refund of the same payment is in flight the form
 * gives way to a sentence, and a confirmation that has sent nothing is not sent on: the function would refuse it.
 * Nothing is optimistic: the screen that owns the controls reads its data again after every call and shows what
 * it says.
 *
 * The screens (the order view, the reconciliation screen) own the one status line and the one alert line, the
 * guard against a second press, the re-read and the focus that returns to the pressed control when the owner
 * closes the code dialog (`useFocusBack`): they hand the controls a `Money`.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  AMOUNT_PROBLEMS,
  attemptBalance,
  attemptRefundInFlight,
  confirmedRefunded,
  EXTERNAL_SENTENCE,
  IN_FLIGHT_SENTENCE,
  NEEDS_EXTERNAL_REASON,
  orderRefundFields,
  readAmount,
  readCreateReply,
  readPaymentRecheck,
  readRefundReply,
  receivedReturns,
  refundBody,
  refundForm,
  refundProblem,
  refundRequest,
  REFUND_WARNING,
  reviewRefundFields,
  sum,
  withStepUp,
  type Kept,
  type Verdict,
} from '@/lib/admin-money'
import { clean, DISPUTE_DIRECTION_LABELS, DISPUTE_KIND_LABELS, labelOf, type OrderDetail } from '@/lib/admin-orders'
import { formatMoney } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import styles from './admin.module.css'
import { StepUp } from './StepUp'

/** What a screen says on its status or alert line (a node when it carries a control). */
export interface Said {
  line: 'status' | 'alert'
  text: ReactNode
}

/** What a screen hands its money controls. */
export interface Money {
  /** A call of the screen is in flight, or its step-up dialog is open: every money control is off. */
  busy: boolean
  /**
   * One action: the screen's guard against a second press, its re-read afterwards (whatever the answer), and the
   * sentence on its status or alert line. `null` says nothing (the owner closed the dialog): the focus goes back to
   * the control that was pressed.
   */
  run: (key: string, task: () => Promise<Said | null>) => Promise<void>
  /** A refusal of the form itself, before any call. */
  say: (line: 'status' | 'alert', text: ReactNode) => void
  /** Empties both lines (a sentence about an earlier try is not about this one) without moving the focus. */
  clear: () => void
  /** Collects a fresh authenticator code. */
  ask: () => Promise<Verdict>
}

/**
 * The step-up of the screens (D13): `ask()` opens the dialog over the owner's enrolled factor and answers what it
 * came to; `dialog` is the element to mount once, always. The control that asked is off while its call is in
 * flight, so the browser has nowhere to return the focus to: the screen does (`useFocusBack`).
 */
export function useStepUp(): { ask: () => Promise<Verdict>; dialog: ReactNode } {
  const [factorId, setFactorId] = useState<string | null>(null)
  const waiting = useRef<((verdict: Verdict) => void) | null>(null)

  function finish(verdict: Verdict) {
    const resolve = waiting.current
    waiting.current = null
    setFactorId(null)
    // A dialog closes after a verified code too: the second ending finds nobody waiting.
    resolve?.(verdict)
  }

  async function ask(): Promise<Verdict> {
    const { data, error } = await getSupabaseBrowserClient().auth.mfa.listFactors()
    if (error) return 'failed'
    const verified = data.totp.find((factor) => factor.status === 'verified')
    if (!verified) return 'enroll'
    return new Promise<Verdict>((resolve) => {
      waiting.current = resolve
      setFactorId(verified.id)
    })
  }

  const dialog = <StepUp open={factorId !== null} factorId={factorId ?? ''} onVerified={() => finish('verified')} onClose={() => finish('cancelled')} />
  return { ask, dialog }
}

/**
 * Where the focus goes when the owner closes the code dialog. `mark()` notes the control that has it as an action
 * begins (the control is disabled until the call and the re-read are over, and a disabled control cannot take the
 * focus back from a closing dialog); `back()`, once the screen is enabled again, gives it the focus.
 */
export function useFocusBack(): { mark: () => void; back: () => void } {
  const opener = useRef<HTMLElement | null>(null)
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    if (turn > 0) opener.current?.focus()
  }, [turn])
  return {
    mark: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    back: () => setTurn((value) => value + 1),
  }
}

/** A body for the `admin` function; a request for a fresh code opens the dialog and sends the same body once more. */
export const sendMoney = (body: Record<string, unknown>, ask: () => Promise<Verdict>) =>
  withStepUp(() => callFunction<unknown>('admin', body), ask)

/** The owner's «أعد الفحص» of a payment attempt (no code): `{status}`, then the screen reads again. */
export async function recheckAttempt(attemptId: string): Promise<Said> {
  return readPaymentRecheck(await callFunction<unknown>('admin', { action: 'payment-recheck', attemptId }))
}

/** The owner's «أعد الفحص» of a refund in flight (no code): the refund as it stands now. */
export async function recheckRefund(refundId: string): Promise<Said | null> {
  return readRefundReply(await callFunction<unknown>('admin', { action: 'refund-recheck', refundId }))
}

/** «تسجيل استرداد خارجي»: a refund or a void made in Moyasar's dashboard, recorded from what Moyasar itself holds. */
export function ExternalRefund({
  target,
  money,
  open,
  onOpenChange,
}: {
  target: { attemptId: string } | { reviewPaymentId: string }
  money: Money
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const id = useId()
  const reasonRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const key = 'attemptId' in target ? target.attemptId : target.reviewPaymentId

  useEffect(() => {
    if (open) reasonRef.current?.focus()
  }, [open])

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = clean(reason)
    if (text === '' || text.length > 300) return money.say('alert', NEEDS_EXTERNAL_REASON)
    void money.run(`external:${key}`, async () => {
      const reading = readRefundReply(await sendMoney({ action: 'refund-record-external', ...target, reason: text }, money.ask), true)
      if (reading?.done) {
        setReason('')
        onOpenChange(false)
      }
      return reading
    })
  }

  return (
    <>
      <div className={styles.row}>
        <button ref={toggleRef} type="button" className={styles.buttonSecondary} aria-expanded={open} disabled={money.busy} onClick={() => onOpenChange(!open)}>
          تسجيل استرداد خارجي
        </button>
      </div>
      {open && (
        <form className={styles.form} onSubmit={submit}>
          <p>{EXTERNAL_SENTENCE}</p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-reason`}>
              السبب
            </label>
            <input
              ref={reasonRef}
              id={`${id}-reason`}
              className={styles.input}
              type="text"
              autoComplete="off"
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" className={styles.button} disabled={money.busy}>
              تأكيد التسجيل
            </button>
            {/* The form goes with the button that was pressed: the focus goes back to the one that opened it. */}
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={money.busy}
              onClick={() => {
                onOpenChange(false)
                toggleRef.current?.focus()
              }}
            >
              رجوع
            </button>
          </div>
        </form>
      )}
    </>
  )
}

/**
 * What a refund form is for: an order's paying attempt (with its lines), or a review payment (with what is left of it).
 * An order's form reads the confirmed total and the refunds in flight from its detail. A review payment's screen says
 * both: `refunded`, the confirmed total of the row the form was built from, and whether one of its refunds is `inFlight`.
 * Without `refunded` the request carries no `expectedRefunded` (the function then does not check it).
 */
export type RefundSubject =
  | { kind: 'order'; detail: OrderDetail; attemptId: string }
  | { kind: 'review'; paymentId: string; orderId: string | null; remainder: number; refunded?: number; inFlight?: boolean }

/** The request under confirmation: its body, and what the confirmation repeats of it (the total and the lines with an amount). */
interface Frozen {
  body: Record<string, unknown>
  total: number
  lines: Array<{ key: string; label: string; halalas: number }>
}

/**
 * The refund form: an amount for each line that can still be refunded and for the shipping (a review payment has the
 * one amount), a reason, and «ربط بطلب الإرجاع» when a received return has no refund yet. «إعادة المبلغ» opens the
 * confirmation; «تأكيد الاسترداد» is the only thing that sends. An order's form offers no more than its paying attempt
 * can still give back (a refund made in Moyasar's dashboard allocates no line), says that cap, and lists the
 * chargebacks recorded on the attempt above its fields.
 */
export function RefundView({ subject, money }: { subject: RefundSubject; money: Money }) {
  const review = subject.kind === 'review'
  const cap = review ? Number.POSITIVE_INFINITY : attemptBalance(subject.detail, subject.attemptId)
  const fields = review ? reviewRefundFields(subject.remainder) : orderRefundFields(subject.detail, cap)
  const returns = review ? [] : receivedReturns(subject.detail)
  // The confirmed total this form was built from, and whether a refund of the same payment is still being settled.
  const expectedRefunded = review ? subject.refunded : confirmedRefunded(subject.detail, subject.attemptId)
  const waiting = review ? subject.inFlight === true : attemptRefundInFlight(subject.detail, subject.attemptId)
  const chargebacks = review
    ? []
    : (subject.detail.disputes ?? []).filter((dispute) => dispute.attemptId === subject.attemptId && dispute.kind === 'chargeback')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [returnChoice, setReturnChoice] = useState('')
  const [frozen, setFrozen] = useState<Frozen | null>(null)
  const [recording, setRecording] = useState(false)
  const kept = useRef<Kept | null>(null)
  // The form the kept key's request was frozen from, and that request: the same form again shows it again (`refundForm`).
  const keptForm = useRef<{ form: string; frozen: Frozen } | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const backToStart = useRef(false)
  const id = useId()

  // The confirmation takes the focus itself, never «تأكيد الاسترداد»: Enter in a field opens it, and a second Enter (or a
  // held one) must not confirm what the owner has not yet read. «رجوع» removes itself with the confirmation, so the
  // focus goes to the control that opened it, «إعادة المبلغ», once the form is back.
  useEffect(() => {
    if (frozen !== null) groupRef.current?.focus()
    else if (backToStart.current) {
      backToStart.current = false
      startRef.current?.focus()
    }
  }, [frozen])

  const reads = fields.map((field) => ({ field, ...readAmount(texts[field.key] ?? '', field.remainder) }))
  const total = sum(reads.map((read) => read.halalas))
  // A return linked since (the screen read again) is no longer offered, so it is no longer sent.
  const returnId = returns.some((returned) => returned.id === returnChoice) ? returnChoice : ''
  const external = review ? { reviewPaymentId: subject.paymentId } : { attemptId: subject.attemptId }

  function start(event: FormEvent) {
    event.preventDefault()
    // While a key is kept (an answer left its request unknown), the same form is that very request, sent again under its key
    // with its total, whatever the screen has read since.
    if (kept.current !== null && keptForm.current !== null && keptForm.current.form === refundForm(texts, reason, returnChoice)) {
      money.clear()
      return setFrozen(keptForm.current.frozen)
    }
    const problem = refundProblem(reads, reason, review, cap)
    if (problem !== null) return money.say('alert', problem)
    money.clear()
    // Frozen here: the confirmation shows, and `confirm` sends, exactly this, whatever the screen reads meanwhile.
    setFrozen({
      body: refundBody({
        orderId: review ? subject.orderId : subject.detail.order.id,
        attemptId: review ? null : subject.attemptId,
        reviewPaymentId: review ? subject.paymentId : null,
        reason,
        amounts: reads.map(({ field, halalas }) => ({ field, halalas })),
        returnId: returnId === '' ? null : returnId,
        expectedRefunded,
      }),
      total,
      lines: reads.filter((read) => read.halalas > 0).map((read) => ({ key: read.field.key, label: read.field.label, halalas: read.halalas })),
    })
  }

  function confirm() {
    if (frozen === null) return
    // A refund of this payment is in flight and nothing was sent under this confirmation: the function would refuse it, after a code.
    // A kept key is sent as it is: it may be the very refund in flight, and its replay answers it.
    if (waiting && kept.current === null) {
      setFrozen(null)
      return money.say('alert', IN_FLIGHT_SENTENCE)
    }
    // Minted here, once: a retry of the very same request (after the code, after a network failure) sends this key, and the
    // total it was minted with, again; a changed form takes a fresh key and the total of the reading it was built from.
    const sent = refundRequest(kept.current, frozen.body, () => crypto.randomUUID())
    kept.current = sent.kept
    keptForm.current = { form: refundForm(texts, reason, returnChoice), frozen }
    void money.run(`refund:${review ? subject.paymentId : subject.attemptId}`, async () => {
      const reading = readCreateReply(await sendMoney(sent.body, money.ask))
      if (reading === null) return null
      if (!reading.keep) {
        // A final answer: the key goes, and the confirmation with it.
        kept.current = null
        keptForm.current = null
        setFrozen(null)
      }
      if (reading.done) {
        setTexts({})
        setReason('')
        setReturnChoice('')
      }
      if (!reading.ahead) return reading
      return {
        line: reading.line,
        text: (
          <>
            {reading.text}{' '}
            <button type="button" className={styles.buttonSecondary} onClick={() => setRecording(true)}>
              تسجيل استرداد خارجي
            </button>
          </>
        ),
      }
    })
  }

  return (
    <>
      {chargebacks.length > 0 && (
        <ul className={styles.metaList}>
          {chargebacks.map((dispute) => (
            <li key={dispute.id}>
              نزاع مسجّل: {labelOf(DISPUTE_KIND_LABELS, dispute.kind)} <bdi dir="ltr">{dispute.providerRef}</bdi> {formatMoney(dispute.amount)}{' '}
              {labelOf(DISPUTE_DIRECTION_LABELS, dispute.direction)}
            </li>
          ))}
        </ul>
      )}
      {frozen !== null ? (
        <div ref={groupRef} tabIndex={-1} className={styles.form} role="group" aria-labelledby={`${id}-total`}>
          <p id={`${id}-total`}>الإجمالي: {formatMoney(frozen.total)}</p>
          {!review && (
            <ul className={styles.metaList}>
              {frozen.lines.map((line) => (
                <li key={line.key}>
                  <bdi>{line.label}</bdi>: {formatMoney(line.halalas)}
                </li>
              ))}
            </ul>
          )}
          <p>{REFUND_WARNING}</p>
          <div className={styles.row}>
            <button type="button" className={styles.button} disabled={money.busy} onClick={confirm}>
              تأكيد الاسترداد
            </button>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={money.busy}
              onClick={() => {
                backToStart.current = true
                setFrozen(null)
              }}
            >
              رجوع
            </button>
          </div>
        </div>
      ) : waiting ? (
        <p className={styles.message}>{IN_FLIGHT_SENTENCE}</p>
      ) : fields.length === 0 ? (
        <p className={styles.message}>لا يوجد مبلغ متبقٍ للاسترداد.</p>
      ) : (
        <form className={styles.form} onSubmit={start}>
          {reads.map(({ field, problem }) => {
            const fieldId = `${id}-${field.key}`
            return (
              <div key={field.key} className={styles.field}>
                <label className={styles.label} htmlFor={fieldId}>
                  <bdi>{field.label}</bdi>
                </label>
                <div className={styles.row}>
                  <input
                    id={fieldId}
                    className={styles.input}
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    autoComplete="off"
                    value={texts[field.key] ?? ''}
                    aria-invalid={problem !== null || undefined}
                    aria-describedby={problem === null ? `${fieldId}-hint` : `${fieldId}-hint ${fieldId}-error`}
                    onChange={(event) => setTexts((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                  <span>ر.س</span>
                </div>
                <span id={`${fieldId}-hint`} className={styles.message}>
                  المتبقي: {formatMoney(field.remainder)}
                </span>
                {problem !== null && (
                  <span id={`${fieldId}-error`} className={styles.error}>
                    {AMOUNT_PROBLEMS[problem]}
                  </span>
                )}
              </div>
            )
          })}
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-reason`}>
              السبب
            </label>
            <input
              id={`${id}-reason`}
              className={styles.input}
              type="text"
              autoComplete="off"
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {returns.length > 0 && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-return`}>
                ربط بطلب الإرجاع
              </label>
              <select id={`${id}-return`} className={styles.input} value={returnId} onChange={(event) => setReturnChoice(event.target.value)}>
                <option value="">بدون ربط</option>
                {returns.map((returned) => (
                  <option key={returned.id} value={returned.id}>
                    {returned.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!review && <p>المتبقي في الدفعة: {formatMoney(cap)}</p>}
          <p>الإجمالي: {formatMoney(total)}</p>
          <div className={styles.row}>
            <button ref={startRef} type="submit" className={styles.button} disabled={money.busy}>
              {review ? 'استرداد هذه الدفعة' : 'إعادة المبلغ'}
            </button>
          </div>
        </form>
      )}
      <ExternalRefund target={external} money={money} open={recording} onOpenChange={setRecording} />
    </>
  )
}
