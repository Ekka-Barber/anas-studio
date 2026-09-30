'use client'

/**
 * The owner home (P06 round 2): real pending work, each count from a real
 * query under RLS, each item linking to its screen. A failed query shows
 * «تعذّر التحميل» — never 0 (D21: unavailable is unavailable, not zero).
 * Contact messages are not counted here: they arrive in the owner's own
 * mailbox (D31).
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { formatNumber, formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import styles from './admin.module.css'
import { ROLE_LABEL, type StaffRole } from './TableList'

type Count = { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: number; capped?: boolean }

const JOB_LABEL: Record<string, string> = {
  email_outbox: 'إرسال البريد',
  site_build: 'بناء الموقع',
  media_sweep: 'تنظيف الوسائط',
  backup: 'النسخ الاحتياطي',
}
const JOB_STATUS_LABEL: Record<string, string> = { ok: 'سليم', partial: 'جزئي', failed: 'فاشل', skipped: 'متجاوز' }
/** Jobs that exist in code today; a job with no run yet shows «لم يعمل بعد». */
const KNOWN_JOBS = ['email_outbox', 'site_build', 'media_sweep', 'backup'] as const

/** How old a last completion may be before the cron probably died and the
 * recorded «سليم» is stale (M4). The site build runs only after a publish,
 * so it has no limit; the media sweep runs daily. The email job has no entry
 * (I35): since D32 it runs only while mail is due, so it warns by its own
 * rule in `emailWaiting` instead of by its last run's age. */
const STALE_JOB_MS: Partial<Record<string, number>> = {
  media_sweep: 26 * 60 * 60 * 1000,
  backup: 30 * 24 * 60 * 60 * 1000,
}
/** The backup is run by Anas himself (D35), not by a schedule, so its stale
 * and never-run texts name the backup instead of telling him to check a
 * scheduler; a manual job has no schedule to check. The email job's text
 * names the waiting mail (I35). */
const JOB_STALE_TEXT: Partial<Record<string, string>> = {
  email_outbox: 'بريد ينتظر الإرسال منذ أكثر من 10 دقائق. تأكد من الجدولة.',
  backup: 'آخر نسخة احتياطية أقدم من 30 يومًا.',
}
const JOB_NEVER_TEXT: Partial<Record<string, string>> = {
  backup: 'لا توجد نسخة بعد.',
}
/** `outbox_attention()` caps its result at 200 rows (its SQL limit), so a
 * result at the cap renders its count followed by «+», not a silent total (L6). */
const ATTENTION_CAP = 200

const LOADING: Count = { state: 'loading' }

interface JobRun {
  job: string
  status: string
  finished_at: string
}

/** The `outbox_attention()` rows a person can still act on: the replayable
 * ones, the same rule as EmailView's «تحتاج تدخل». Suppressed recipients and
 * sent rows with a bounce never clear, so counting them left a number the
 * owner could not bring back to zero. */
export function replayableCount(rows: readonly { status: string }[]): number {
  return rows.filter((row) => row.status === 'exhausted' || row.status === 'uncertain').length
}

function countText(count: Count): string {
  if (count.state === 'loading') return 'يحمّل...'
  if (count.state === 'error') return 'تعذّر التحميل'
  return formatNumber(count.value)
}

/** True when the job's last completion is older than its STALE_JOB_MS limit —
 * compared client-side from the run's own finished_at (M4). */
function isStaleRun(run: JobRun): boolean {
  const limit = STALE_JOB_MS[run.job]
  const finished = Date.parse(run.finished_at)
  return limit !== undefined && !Number.isNaN(finished) && Date.now() - finished > limit
}

/** I35: the email job runs only while mail is due (D32), so an hours-old last
 * run is healthy on a quiet site. The line is in trouble only when a row has
 * been due for more than 10 minutes and no run finished inside those 10
 * minutes. */
const EMAIL_WAITING_MS = 10 * 60 * 1000

function emailWaiting(run: JobRun | undefined, dueSince: string | null): boolean {
  if (dueSince === null) return false
  const due = Date.parse(dueSince)
  if (Number.isNaN(due) || Date.now() - due <= EMAIL_WAITING_MS) return false
  const finished = run ? Date.parse(run.finished_at) : NaN
  return Number.isNaN(finished) || Date.now() - finished > EMAIL_WAITING_MS
}

export function AdminHome() {
  const [own, setOwn] = useState<{ display_name: string; role: StaffRole } | null>(null)
  const [ownError, setOwnError] = useState(false)
  const [emailProblems, setEmailProblems] = useState<Count>(LOADING)
  const [jobRuns, setJobRuns] = useState<
    { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: JobRun[]; dueSince: string | null }
  >({ state: 'loading' })
  const [scheduled, setScheduled] = useState<Count>(LOADING)
  const [visits, setVisits] = useState<
    { state: 'loading' } | { state: 'error' } | { state: 'unavailable' } | { state: 'ok'; value: number }
  >({ state: 'loading' })
  // L8: the owner home states «المتجر غير مُهيأ» like the stats screen, from
  // the same `stats` answer's commerce status.
  const [store, setStore] = useState<{ state: 'loading' } | { state: 'not-configured' } | { state: 'ok' }>({
    state: 'loading',
  })

  useEffect(() => {
    let active = true

    async function loadEmail() {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc('outbox_attention')
      if (!active) return
      const rows = (data as { status: string }[] | null) ?? []
      setEmailProblems(
        error ? { state: 'error' } : { state: 'ok', value: replayableCount(rows), capped: rows.length >= ATTENTION_CAP },
      )
    }

    async function loadJobs() {
      const supabase = getSupabaseBrowserClient()
      const [runs, due] = await Promise.all([
        supabase.rpc('job_runs_latest'),
        supabase.rpc('outbox_due_since'),
      ])
      if (!active) return
      setJobRuns(
        runs.error || due.error
          ? { state: 'error' }
          : { state: 'ok', value: (runs.data as JobRun[]) ?? [], dueSince: (due.data as string | null) ?? null },
      )
    }

    async function loadScheduled() {
      const supabase = getSupabaseBrowserClient()
      const { count, error } = await supabase
        .from('content_documents')
        .select('doc_id', { count: 'exact', head: true })
        .not('scheduled_at', 'is', null)
      if (!active) return
      setScheduled(error || count === null ? { state: 'error' } : { state: 'ok', value: count })
    }

    async function loadVisits() {
      const result = await callFunction<{
        analytics?: { status: string; visits?: number }
        commerce?: { status?: string }
      }>('admin', { action: 'stats' })
      if (!active) return
      if (!result.ok) {
        setVisits(result.error.code === 'UNKNOWN' ? { state: 'error' } : { state: 'unavailable' })
        return
      }
      const analytics = result.data.analytics
      setVisits(analytics?.status === 'ok' ? { state: 'ok', value: analytics.visits ?? 0 } : { state: 'unavailable' })
      setStore(result.data.commerce?.status === 'not_configured' ? { state: 'not-configured' } : { state: 'ok' })
    }

    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (!active) return
      if (userError || !userData.user) {
        setOwnError(true)
        return
      }
      const { data: sessionData } = await supabase.auth.getSession()
      const { data, error: staffError } = await supabase.from('staff').select('display_name, role').eq('user_id', userData.user.id).maybeSingle()
      if (!active) return
      // D21: a failed lookup is shown as one, not as an empty page.
      if (staffError || !data) {
        setOwnError(true)
        return
      }
      const role = data.role as StaffRole
      setOwn({ display_name: data.display_name, role })

      const jobs = [loadEmail(), loadJobs()]
      if (role === 'owner' || role === 'editor') jobs.push(loadScheduled())
      if (role === 'owner' && sessionData.session) jobs.push(loadVisits())
      await Promise.all(jobs)
    })()

    return () => {
      active = false
    }
  }, [])

  return (
    <div>
      <h1>لوحة أنس</h1>
      {ownError && (
        <p role="alert" className={styles.error}>
          تعذّر التحميل
        </p>
      )}
      {own && (
        <p>
          مرحبًا <bdi>{own.display_name}</bdi> ({ROLE_LABEL[own.role] ?? own.role})
        </p>
      )}

      {(own?.role === 'owner' || own?.role === 'operations') && (
        <section>
          <h2>البريد</h2>
          <p>
            مشكلات تحتاج انتباهًا:{' '}
            {emailProblems.state === 'ok' && emailProblems.capped ? (
              <span dir="ltr">{countText(emailProblems)}+</span>
            ) : (
              countText(emailProblems)
            )}
          </p>
          <Link href="/admin/email">فتح البريد</Link>
        </section>
      )}

      {(own?.role === 'owner' || own?.role === 'operations') && (
        <section>
          <h2>مهام التشغيل</h2>
          {jobRuns.state === 'loading' && <p className={styles.message}>يحمّل...</p>}
          {jobRuns.state === 'error' && <p className={styles.error}>تعذّر التحميل</p>}
          {jobRuns.state === 'ok' && (
            <ul className={styles.metaList}>
              {KNOWN_JOBS.map((job) => {
                const run = jobRuns.value.find((row) => row.job === job)
                const trouble =
                  job === 'email_outbox' ? emailWaiting(run, jobRuns.dueSince) : run !== undefined && isStaleRun(run)
                return (
                  <li key={job}>
                    {JOB_LABEL[job] ?? job}:{' '}
                    {trouble ? (
                      <span className={styles.error}>{JOB_STALE_TEXT[job] ?? 'آخر تشغيل قديم. تأكد من الجدولة.'}</span>
                    ) : run ? (
                      `${JOB_STATUS_LABEL[run.status] ?? run.status} (${formatRiyadh(run.finished_at)})`
                    ) : (
                      JOB_NEVER_TEXT[job] ?? 'لم يعمل بعد'
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {(own?.role === 'owner' || own?.role === 'editor') && (
        <section>
          <h2>المحتوى المجدول</h2>
          <p>مستندات تنتظر موعد النشر: {countText(scheduled)}</p>
          <Link href="/admin/content">فتح المحتوى</Link>
        </section>
      )}

      {own?.role === 'owner' && (
        <section>
          <h2>الإحصاءات</h2>
          {store.state === 'not-configured' && <p className={styles.message}>المتجر غير مُهيأ بعد. تظهر أرقامه عند افتتاحه.</p>}
          <p>
            زيارات آخر 7 أيام:{' '}
            {visits.state === 'ok'
              ? formatNumber(visits.value)
              : visits.state === 'loading'
                ? 'يحمّل...'
                : visits.state === 'error'
                  ? 'تعذّر التحميل'
                  : 'غير متاحة'}
          </p>
          <Link href="/admin/stats">فتح الإحصاءات</Link>
        </section>
      )}

      <section>
        <h2>الاختصارات</h2>
        <ul className={styles.metaList}>
          <li>
            <Link href="/admin/security">الأمان</Link>
          </li>
          {own?.role === 'owner' && (
            <li>
              <Link href="/admin/team">الفريق</Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
