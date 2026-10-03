'use client'

/**
 * Owner-only statistics (P06 round 2): reads the `admin` function's `stats` with the
 * signed-in session token. Commerce stays «غير مُعدّ بعد» while payments are not
 * configured; analytics shows real numbers or «غير متاح» with the
 * reason — never an invented zero (D21).
 *
 * P08 round 11c: once payments are configured the «المتجر» section shows the ledger's
 * figures (`owner_commerce_stats`, read strictly by `src/lib/admin-commerce.ts`) for the
 * last 30 days, and for a range of Riyadh days the owner asks for. A refusal or a failed
 * call says so and keeps the figures drawn; it never shows a zero in their place. The
 * result of «عرض» takes the focus, on the status line or, for a refusal, the alert line.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  BAD_REPLY,
  commerceLines,
  COMMERCE_NOTE,
  LOAD_FAILED,
  parseCommerceStats,
  RANGE_HINT,
  STATS_UPDATED,
  statsRequest,
  TEST_DATA,
  type CommerceStats,
} from '@/lib/admin-commerce'
import { formatDate, formatNumber, formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import styles from './admin.module.css'

interface StatsPayload {
  generatedAt: string
  /** The ledger's figures (`owner_commerce_stats`), or null while payments are not configured. */
  commerce: unknown
  analytics:
    | {
        status: 'ok'
        range: { start: string; end: string }
        visits: number
        topPaths: Array<{ path: string; count: number }>
        fetchedAt: string
      }
    | { status: 'unavailable'; reason: string }
}

const REASON_LABEL: Record<string, string> = {
  NOT_CONFIGURED: 'الإحصاءات غير مُعدّة بعد. تحتاج إلى ANALYTICS_TOKEN و CLOUDFLARE_ZONE_ID.',
  HTTP_ERROR: 'تعذّر الوصول إلى خدمة الإحصاءات.',
  TIMEOUT: 'انتهت مهلة الاستعلام.',
  GRAPHQL_ERROR: 'ردّ الإحصاءات يحتوي على خطأ.',
  SAMPLED: 'البيانات معيّنة (sampled)، فلا تُعرض أرقام تقديرية.',
  // A short wait, not a refresh: the analytics side may need a moment to recover.
  UNEXPECTED_SHAPE: 'تعذّر قراءة بيانات الزيارات. جرّب بعد قليل.',
}

/** The figures as the function answered them, or null when the reply is not what it should be. */
function readFigures(value: unknown): CommerceStats | null {
  try {
    return parseCommerceStats(value)
  } catch {
    return null
  }
}

/** The days a set of figures covers, as the request that fetched them named them (empty: the function's last 30 days). */
function rangeLine(from: string, to: string): string {
  if (from === '' && to === '') return 'الأرقام لآخر 30 يومًا.'
  if (from === '') return `الأرقام للثلاثين يومًا حتى ${formatDate(to)}.`
  if (to === '') return `الأرقام من ${formatDate(from)} إلى الآن.`
  return `الأرقام من ${formatDate(from)} إلى ${formatDate(to)}.`
}

/** The «المتجر» section once payments are configured: a range of Riyadh days, and the figures of the ledger for it. */
function CommerceSection({ first }: { first: unknown }) {
  const [figures, setFigures] = useState<CommerceStats | null>(() => readFigures(first))
  // The days the figures on screen cover, set with them: the date fields can say something else until «عرض» succeeds.
  const [covered, setCovered] = useState(() => rangeLine('', ''))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [alert, setAlert] = useState(() => (readFigures(first) === null ? BAD_REPLY : ''))
  const [focusLine, setFocusLine] = useState<{ line: 'status' | 'alert'; n: number } | null>(null)
  const inFlight = useRef(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (focusLine !== null) (focusLine.line === 'alert' ? alertRef : statusRef).current?.focus()
  }, [focusLine])

  function say(line: 'status' | 'alert', text: string) {
    setStatus(line === 'status' ? text : '')
    setAlert(line === 'alert' ? text : '')
    setFocusLine((current) => ({ line, n: (current?.n ?? 0) + 1 }))
  }

  async function show(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    const request = statsRequest(from, to)
    if (!request.ok) {
      say('alert', request.message)
      return
    }
    inFlight.current = true
    setBusy(true)
    setStatus('يحمّل...')
    setAlert('')
    const result = await callFunction<{ commerce: unknown }>('admin', request.body)
    inFlight.current = false
    setBusy(false)
    if (!result.ok) {
      // The figures drawn stay: a failed call is never read as a range with nothing in it.
      const message = (result.error as { message?: unknown } | undefined)?.message
      say('alert', typeof message === 'string' && message !== '' ? message : LOAD_FAILED)
      return
    }
    const next = readFigures((result.data as { commerce?: unknown } | null)?.commerce)
    if (next === null) {
      say('alert', BAD_REPLY)
      return
    }
    setFigures(next)
    setCovered(rangeLine(from, to))
    say('status', STATS_UPDATED)
  }

  return (
    <>
      <form className={styles.form} onSubmit={(event) => void show(event)}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="stats-from">
            من
          </label>
          <input id="stats-from" className={styles.input} type="date" aria-describedby="stats-range-hint" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="stats-to">
            إلى
          </label>
          <input id="stats-to" className={styles.input} type="date" aria-describedby="stats-range-hint" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <p id="stats-range-hint" className={styles.message}>
          {RANGE_HINT}
        </p>
        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={busy}>
            عرض
          </button>
        </div>
      </form>
      {/* Always mounted, so what they say is announced when it is filled. */}
      <p id="stats-status" role="status" ref={statusRef} tabIndex={-1} className={styles.message}>
        {status}
      </p>
      <p id="stats-alert" role="alert" ref={alertRef} tabIndex={-1} className={styles.error}>
        {alert}
      </p>
      {figures !== null && (
        <>
          {figures.environment === 'test' && (
            <p>
              <span className={styles.badge}>{TEST_DATA}</span>
            </p>
          )}
          <p>{covered}</p>
          {commerceLines(figures).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className={styles.message}>{COMMERCE_NOTE}</p>
        </>
      )}
    </>
  )
}

export function StatsView() {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  // L6: 401/403 (role) is an owner-only note; anything else is a real failure.
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: sessionData } = await getSupabaseBrowserClient().auth.getSession()
      if (!sessionData.session) return
      const result = await callFunction<StatsPayload>('admin', { action: 'stats' })
      if (!active) return
      if (result.ok) setStats(result.data)
      else setError(result.error.code === 'UNAUTHENTICATED' || result.error.code === 'FORBIDDEN' ? 'forbidden' : 'failed')
    })()
    return () => {
      active = false
    }
  }, [])

  if (error === 'forbidden') {
    return (
      <div>
        <h1>الإحصاءات</h1>
        <p className={styles.error}>غير متاحة: الإحصاءات للمالك فقط.</p>
      </div>
    )
  }
  if (error === 'failed') {
    return (
      <div>
        <h1>الإحصاءات</h1>
        <p className={styles.error}>تعذّر تحميل الإحصاءات. حدّث الصفحة وجرّب مرة ثانية.</p>
      </div>
    )
  }
  if (!stats) {
    return (
      <div>
        <h1>الإحصاءات</h1>
        <p className={styles.message}>يحمّل...</p>
      </div>
    )
  }

  return (
    <div>
      <h1>الإحصاءات</h1>

      <section>
        <h2>المتجر</h2>
        {stats.commerce === null ? (
          <p className={styles.message}>غير مُعدّ بعد. تظهر أرقامه عند افتتاح المتجر.</p>
        ) : (
          <CommerceSection first={stats.commerce} />
        )}
      </section>

      <section>
        <h2>الزيارات</h2>
        {stats.analytics.status === 'ok' ? (
          <>
            <p>الزيارات في آخر 7 أيام: {formatNumber(stats.analytics.visits)}</p>
            <p className={styles.message}>
              المدى: من {formatRiyadh(stats.analytics.range.start)} إلى {formatRiyadh(stats.analytics.range.end)}
            </p>
            <p className={styles.message}>وقت الجلب: {formatRiyadh(stats.analytics.fetchedAt)}</p>
            <h3>أكثر الصفحات طلبًا</h3>
            {stats.analytics.topPaths.length === 0 ? (
              <p className={styles.message}>لا توجد صفحات في هذه الفترة.</p>
            ) : (
              <ul className={styles.metaList}>
                {stats.analytics.topPaths.map((path) => (
                  <li key={path.path}>
                    <span dir="ltr">{path.path}</span>: {formatNumber(path.count)}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          // N2-UI: a raw reason code must never reach the owner; unknown
          // reasons (anything added server-side later) fall back to Arabic copy.
          <p className={styles.message}>غير متاح: {REASON_LABEL[stats.analytics.reason] ?? 'خطأ غير معروف.'}</p>
        )}
      </section>

      <p className={styles.message}>وقت التوليد: {formatRiyadh(stats.generatedAt)}</p>
    </div>
  )
}
