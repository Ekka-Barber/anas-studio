'use client'

/**
 * The dispute form (P08 round 11b): what the owner read in Moyasar's emails and settlement files, recorded
 * through `dispute-record` and the step-up dialog. Moyasar shows no dispute through its API, so the owner
 * types the reference, the amount, who it is for, the day and what was decided. The form only records: it
 * never offers to create a refund, and a decision that acts on lines names them.
 *
 * It opens in three ways: «تسجيل فرق» (a payout or a fee difference, no payment), «تسجيل اعتراض» (a chargeback
 * or another dispute about one attempt or one review payment), and «إضافة متابعة» (the next row of a reference:
 * its reference, kind and payment are those of its first row and are not editable, and it follows its latest
 * row: it starts from that row's decision and lines, so that leaving the form as it is carries a stop on).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  actsOnLines,
  buildDispute,
  decisionsFor,
  DISPUTE_DIFFERENCE_KINDS,
  DISPUTE_PAYMENT_KINDS,
  DISPUTE_DIRECTIONS,
  DISPUTE_PROBLEMS,
  FOLLOW_REPLACES,
  FOLLOW_WAITS_FOR_LINES,
  followStart,
  linesFor,
  readDisputeReply,
  riyadhToday,
  type DisputeLine,
} from '@/lib/admin-money'
import { DISPUTE_DECISION_LABELS, DISPUTE_DIRECTION_LABELS, DISPUTE_KIND_LABELS } from '@/lib/admin-orders'

import styles from './admin.module.css'
import { Enum, Fact, ltrLong } from './OrdersView'
import { sendMoney, type Money } from './RefundView'

type Target = { attemptId?: string; reviewPaymentId?: string }

export type DisputeMode =
  | { kind: 'difference' }
  | { kind: 'payment'; target: { attemptId: string } | { reviewPaymentId: string } }
  | {
      kind: 'follow'
      target: Target
      providerRef: string
      disputeKind: string
      follows: number
      /** The decision and the lines of the latest row, which the follow-up starts from. */
      decision: string
      itemIds: readonly string[]
      orderNumber: string | null
    }

const TITLES = { difference: 'تسجيل فرق', payment: 'تسجيل اعتراض', follow: 'إضافة متابعة' } as const

export function DisputeForm({
  mode,
  lines,
  money,
  onClose,
}: {
  mode: DisputeMode
  /** The order's lines for the decisions that name some; `'loading'` while they are being read, null when there is no order or they could not be read. */
  lines: DisputeLine[] | 'loading' | null
  money: Money
  onClose: () => void
}) {
  const [providerRef, setProviderRef] = useState('')
  const [kind, setKind] = useState<string>(mode.kind === 'payment' ? 'chargeback' : 'payout_difference')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<string>('against_seller')
  const [day, setDay] = useState('')
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState('')
  // Null until the owner changes them: a follow-up then shows what it starts from, whatever the lines read so far allow.
  const [chosen, setChosen] = useState<string | null>(null)
  const [ticked, setTicked] = useState<string[] | null>(null)
  // The latest day the field offers; the check at the press is made again on the day it is then.
  const [today] = useState(riyadhToday)
  // The control that opened the form still has the focus when the form mounts: «رجوع» removes itself with the form, so it gives it back.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  const known = lines === 'loading' ? null : lines
  const target: Target = mode.kind === 'difference' ? {} : mode.target
  const hasTarget = target.attemptId !== undefined || target.reviewPaymentId !== undefined
  const decisions = decisionsFor(hasTarget, known)
  const start = mode.kind === 'follow' ? followStart(mode, hasTarget, known) : { decision: 'none', picked: [] }
  const decision = chosen ?? start.decision
  const picked = ticked ?? start.picked
  const fitting = actsOnLines(decision) ? linesFor(decision, known ?? []) : []

  function submit(event: FormEvent) {
    event.preventDefault()
    // A follow-up of a row that names lines (a stop, a revocation) waits for the order's lines: before they are read it could
    // only start from «بلا إجراء», and sending that would lift the row's decision.
    if (mode.kind === 'follow' && known === null && actsOnLines(mode.decision)) return money.say('alert', FOLLOW_WAITS_FOR_LINES)
    const built = buildDispute(
      { providerRef: mode.kind === 'follow' ? mode.providerRef : providerRef, kind: mode.kind === 'follow' ? mode.disputeKind : kind, amount, direction, day, reason, resolution, decision, picked },
      target,
      mode.kind === 'follow' ? mode.follows : 0,
      riyadhToday(),
      known,
    )
    if (!built.ok) return money.say('alert', built.message)
    void money.run('dispute', async () => {
      const reading = readDisputeReply(await sendMoney(built.body, money.ask))
      if (reading?.done) onClose()
      return reading
    })
  }

  return (
    // noValidate: the day's `max` would otherwise stop the press with the browser's own sentence; the form's checks say it in the screen's words.
    <form className={styles.form} onSubmit={submit} aria-label={TITLES[mode.kind]} noValidate>
      {mode.kind === 'follow' ? (
        <ul className={styles.metaList}>
          <Fact label="المرجع">{ltrLong(mode.providerRef)}</Fact>
          <Fact label="النوع">
            <Enum labels={DISPUTE_KIND_LABELS} code={mode.disputeKind} />
          </Fact>
          {mode.orderNumber !== null && <Fact label="الطلب">{ltrLong(mode.orderNumber)}</Fact>}
        </ul>
      ) : (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dispute-ref">
              المرجع
            </label>
            <input
              id="dispute-ref"
              className={styles.input}
              type="text"
              dir="ltr"
              autoComplete="off"
              maxLength={120}
              value={providerRef}
              onChange={(event) => setProviderRef(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="dispute-kind">
              النوع
            </label>
            <select id="dispute-kind" className={styles.input} value={kind} onChange={(event) => setKind(event.target.value)}>
              {(mode.kind === 'payment' ? DISPUTE_PAYMENT_KINDS : DISPUTE_DIFFERENCE_KINDS).map((option) => (
                <option key={option} value={option}>
                  {DISPUTE_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dispute-amount">
          المبلغ
        </label>
        <div className={styles.row}>
          <input
            id="dispute-amount"
            className={styles.input}
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <span>ر.س</span>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dispute-direction">
          الاتجاه
        </label>
        <select id="dispute-direction" className={styles.input} value={direction} onChange={(event) => setDirection(event.target.value)}>
          {DISPUTE_DIRECTIONS.map((option) => (
            <option key={option} value={option}>
              {DISPUTE_DIRECTION_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dispute-day">
          التاريخ
        </label>
        <input id="dispute-day" className={styles.input} type="date" max={today} value={day} onChange={(event) => setDay(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dispute-reason">
          السبب
        </label>
        <input id="dispute-reason" className={styles.input} type="text" autoComplete="off" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="dispute-resolution">
          الحل (اختياري)
        </label>
        <input
          id="dispute-resolution"
          className={styles.input}
          type="text"
          autoComplete="off"
          maxLength={500}
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        />
      </div>
      {decisions.length > 1 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="dispute-decision">
            القرار
          </label>
          <select
            id="dispute-decision"
            className={styles.input}
            value={decision}
            aria-describedby={mode.kind === 'follow' && mode.decision === 'fulfillment_stopped' ? 'dispute-decision-note' : undefined}
            onChange={(event) => {
              setChosen(event.target.value)
              setTicked([])
            }}
          >
            {decisions.map((option) => (
              <option key={option} value={option}>
                {DISPUTE_DECISION_LABELS[option]}
              </option>
            ))}
          </select>
          {mode.kind === 'follow' && mode.decision === 'fulfillment_stopped' && (
            <p id="dispute-decision-note" className={styles.message}>
              {FOLLOW_REPLACES}
            </p>
          )}
        </div>
      )}
      {actsOnLines(decision) &&
        (fitting.length === 0 ? (
          <p className={styles.message}>{DISPUTE_PROBLEMS.noLines}</p>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>البنود</legend>
            {fitting.map((line) => (
              <label key={line.id} className={styles.target}>
                <input
                  type="checkbox"
                  checked={picked.includes(line.id)}
                  onChange={(event) =>
                    setTicked((current) => {
                      const now = current ?? picked
                      return event.target.checked ? [...now, line.id] : now.filter((entry) => entry !== line.id)
                    })
                  }
                />
                <bdi>{line.name}</bdi>
              </label>
            ))}
          </fieldset>
        ))}
      <div className={styles.row}>
        <button type="submit" className={styles.button} disabled={money.busy}>
          تأكيد التسجيل
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          disabled={money.busy}
          onClick={() => {
            onClose()
            opener.current?.focus()
          }}
        >
          رجوع
        </button>
      </div>
    </form>
  )
}
