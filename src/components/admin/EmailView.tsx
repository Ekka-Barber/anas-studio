'use client'

/**
 * Email problems (P06 round 2): the `outbox_attention()` rows that need a
 * person, with replay through `outbox_replay(id, accept_duplicate_risk)`.
 * An uncertain row whose idempotency key expired may already have been
 * delivered, so replaying it opens a native `<dialog>` with a mandatory
 * confirmation checkbox. A suppressed recipient's refusal (SQLSTATE 23514)
 * is shown as the Arabic message from `docs/operations.md`.
 */
import { useEffect, useRef, useState } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { formatRiyadh } from '@/lib/format'
import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'

interface AttentionRow {
  id: number
  kind: string
  recipient: string
  status: string
  delivery: string | null
  attempts: number
  last_error: string | null
  first_attempt_at: string | null
  created_at: string
  replay_needs_confirmation: boolean
}

const KIND_LABEL: Record<string, string> = { receipt: 'إيصال', contact_notice: 'إشعار رسالة', availability: 'إشعار توفر' }
// `sent`: a bounce or complaint arrives on a row that was sent (delivery is set, status is not).
const STATUS_LABEL: Record<string, string> = { exhausted: 'مستنفد', uncertain: 'غير مؤكد', suppressed: 'محظور', sent: 'أُرسلت' }
const DELIVERY_LABEL: Record<string, string> = { bounced: 'ارتد', complained: 'شكوى', failed: 'فشل' }
/** An empty cell says so in words (a screen reader reads a bare dash as punctuation). */
const NONE = 'لا يوجد'
const SUPPRESSED_MESSAGE = 'المستلم محظور بعد ارتداد أو شكوى؛ لا يمكن الإرسال إليه.'
const INACTIVE_MESSAGE = 'المستلم لم يعد عضوًا نشطًا في فريق المالك أو العمليات؛ لا يمكن الإرسال إليه.'
const REPLAYED_MESSAGE = 'أُعيدت الرسالة إلى طابور الإرسال.'
/** `outbox_replay()` raises 55000 for a row that changed after the list loaded:
 * another session replayed it, or it crossed the 23-hour line that needs the
 * confirmation. The list is reloaded so the row shows what the database holds. */
const STALE_MESSAGE = 'تغيّرت حالة الرسالة منذ تحميل القائمة. حُدّثت القائمة، راجعها ثم أعد المحاولة.'
const NO_ACCESS_MESSAGE = 'لا تملك صلاحية الوصول'
/** `outbox_replay()` refuses anything but exhausted/uncertain rows (the
 * suppressed are hard-blocked), so the replay button only appears for them. */
const REPLAYABLE_STATUSES = new Set(['exhausted', 'uncertain'])

/** R3: the attention list is capped at 200 rows, so it is filtered locally.
 * «تحتاج تدخل» is exactly the rows a person can act on — the replayable ones
 * (exhausted, uncertain), the same rule as the replay button; «انتهت» is the
 * rest (suppressed recipients, sent rows with a bounce, complaint or
 * failure), where nothing is left to do. `outbox_attention()` never returns
 * a `sending` row. */
type ProblemFilter = 'all' | 'attention' | 'ended'
const PROBLEM_FILTERS: ProblemFilter[] = ['all', 'attention', 'ended']
const PROBLEM_FILTER_LABEL: Record<ProblemFilter, string> = { all: 'الكل', attention: 'تحتاج تدخل', ended: 'انتهت' }

export function EmailView() {
  const role = useStaffRole()
  // The mail screens are for the owner and operations (the nav hides them from editors).
  const allowed = role === 'owner' || role === 'operations'
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rows, setRows] = useState<AttentionRow[] | null>(null)
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>('all')
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  async function load() {
    const supabase = getSupabaseBrowserClient()
    const { data, error } = await supabase.rpc('outbox_attention')
    if (error) {
      setLoadError(true)
      return
    }
    setLoadError(false)
    setRows((data as AttentionRow[]) ?? [])
  }

  useEffect(() => {
    if (allowed) void Promise.resolve().then(load)
  }, [allowed])

  async function replay(id: number, acceptDuplicateRisk: boolean) {
    setBusyId(id)
    setRowError(null)
    setNotice(null)
    const supabase = getSupabaseBrowserClient()
    const { error } = await supabase.rpc('outbox_replay', { p_id: id, p_accept_duplicate_risk: acceptDuplicateRisk })
    setBusyId(null)
    if (error) {
      if (error.code === '55000') {
        setNotice(STALE_MESSAGE)
        await load()
        return
      }
      const message =
        error.code === '23514' ? SUPPRESSED_MESSAGE : error.code === '22023' ? INACTIVE_MESSAGE : 'تعذّرت إعادة الإرسال.'
      setRowError({ id, message })
      return
    }
    await load()
    // The row and its focused button are gone: focus and announce the result here.
    setNotice(REPLAYED_MESSAGE)
    headingRef.current?.focus()
  }

  function startReplay(row: AttentionRow) {
    setRowError(null)
    if (row.replay_needs_confirmation) {
      setConfirmId(row.id)
      setConfirmed(false)
      dialogRef.current?.showModal()
      return
    }
    void replay(row.id, false)
  }

  async function confirmReplay() {
    dialogRef.current?.close()
    const id = confirmId
    setConfirmId(null)
    if (id !== null) await replay(id, true)
  }

  const visibleRows =
    rows === null
      ? null
      : problemFilter === 'all'
        ? rows
        : rows.filter((row) =>
            problemFilter === 'attention' ? REPLAYABLE_STATUSES.has(row.status) : !REPLAYABLE_STATUSES.has(row.status),
          )

  if (!allowed) {
    return (
      <div>
        <h1>البريد</h1>
        <p className={styles.error}>{NO_ACCESS_MESSAGE}</p>
      </div>
    )
  }

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        البريد
      </h1>
      <p className={styles.message}>
        قبول المزوّد للرسالة لا يعني وصولها؛ الوصول يتأكد فقط بحدث التسليم من المزوّد.
      </p>
      {/* Always mounted, so a replay's result is announced after its row is gone. */}
      <p role="status" className={styles.message}>
        {notice}
      </p>

      {rows !== null && rows.length > 0 && (
        <div className={styles.row} role="group" aria-label="تصفية المشكلات">
          {PROBLEM_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === problemFilter ? styles.button : styles.buttonSecondary}
              aria-pressed={option === problemFilter}
              onClick={() => setProblemFilter(option)}
            >
              {PROBLEM_FILTER_LABEL[option]}
            </button>
          ))}
        </div>
      )}

      {loadError && (
        <div className={styles.row}>
          <p className={styles.error}>تعذّر تحميل مشكلات البريد.</p>
          <button type="button" className={styles.buttonSecondary} onClick={() => void load()}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {!loadError && visibleRows !== null && visibleRows.length === 0 && (
        <p className={styles.message}>{rows?.length ? 'لا توجد مشكلات من هذا النوع.' : 'لا توجد مشكلات في البريد.'}</p>
      )}

      {visibleRows !== null && visibleRows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.responsive}`}>
            <thead>
              <tr>
                <th>المستلم</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>التسليم</th>
                <th>المحاولات</th>
                <th>آخر خطأ</th>
                <th>تاريخ المحاولة الأولى</th>
                <th>
                  <span className="visually-hidden">إجراء</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td dir="auto" data-label="المستلم" className={styles.cellEllipsis} title={row.recipient}>
                    {row.recipient}
                  </td>
                  <td data-label="النوع" className={styles.cellNowrap}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </td>
                  <td data-label="الحالة" className={styles.cellNowrap}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </td>
                  <td data-label="التسليم" className={styles.cellNowrap}>
                    {row.delivery ? (DELIVERY_LABEL[row.delivery] ?? row.delivery) : NONE}
                  </td>
                  <td data-label="المحاولات" className={styles.cellNowrap}>
                    {row.attempts}
                  </td>
                  <td
                    dir="auto"
                    data-label="آخر خطأ"
                    className={styles.cellEllipsis}
                    title={row.last_error ?? undefined}
                  >
                    {row.last_error ?? NONE}
                  </td>
                  <td data-label="تاريخ المحاولة الأولى" className={styles.cellNowrap}>
                    {row.first_attempt_at ? formatRiyadh(row.first_attempt_at) : NONE}
                  </td>
                  <td data-label="إجراء">
                    {REPLAYABLE_STATUSES.has(row.status) ? (
                      <button
                        type="button"
                        className={`${styles.buttonSecondary} ${styles.cellNowrap}`}
                        aria-label={`إعادة الإرسال: ${row.recipient}`}
                        disabled={busyId === row.id}
                        onClick={() => startReplay(row)}
                      >
                        إعادة الإرسال
                      </button>
                    ) : (
                      NONE
                    )}
                    {rowError?.id === row.id && (
                      <p role="alert" className={styles.error}>
                        {rowError.message}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setConfirmId(null)}
        aria-labelledby="replay-dialog-title"
      >
        <h2 id="replay-dialog-title">تأكيد إعادة الإرسال</h2>
        <p>قد تكون هذه الرسالة وصلت من قبل؛ إعادة إرسالها قد تكرّرها.</p>
        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> أفهم
            احتمال التكرار وأؤكد إعادة الإرسال
          </label>
        </div>
        <div className={styles.row}>
          <button type="button" className={styles.button} disabled={!confirmed} onClick={confirmReplay}>
            إعادة الإرسال
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => {
              dialogRef.current?.close()
              setConfirmId(null)
            }}
          >
            إلغاء
          </button>
        </div>
      </dialog>
    </div>
  )
}
