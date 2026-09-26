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

import { formatNumber } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

type StaffRole = 'owner' | 'editor' | 'operations'
type Count = { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: number }

const ROLE_LABEL: Record<StaffRole, string> = { owner: 'مالك', editor: 'محرر', operations: 'تشغيل' }
const JOB_LABEL: Record<string, string> = { email_outbox: 'إرسال البريد' }
const JOB_STATUS_LABEL: Record<string, string> = { ok: 'سليم', partial: 'جزئي', failed: 'فاشل', skipped: 'متجاوز' }
/** Jobs that exist in code today; a job with no run yet shows «لم يعمل بعد». */
const KNOWN_JOBS = ['email_outbox'] as const

/** A last completion older than 10 minutes means the cron probably died and
 * the recorded «سليم» is stale (M4). */
const STALE_JOB_MS = 10 * 60 * 1000
/** `outbox_attention()` caps its result at 200 rows (its SQL limit), so once
 * the count reaches the cap it renders «200+» instead of a silent 200 (L6). */
const ATTENTION_CAP = 200

const LOADING: Count = { state: 'loading' }

interface JobRun {
  job: string
  status: string
  finished_at: string
}

function countText(count: Count): string {
  if (count.state === 'loading') return 'يحمّل...'
  if (count.state === 'error') return 'تعذّر التحميل'
  return formatNumber(count.value)
}

/** True when the job's last completion is older than STALE_JOB_MS — compared
 * client-side from the run's own finished_at (M4). */
function isStaleRun(run: JobRun): boolean {
  const finished = Date.parse(run.finished_at)
  return !Number.isNaN(finished) && Date.now() - finished > STALE_JOB_MS
}

export function AdminHome() {
  const [own, setOwn] = useState<{ display_name: string; role: StaffRole } | null>(null)
  const [emailProblems, setEmailProblems] = useState<Count>(LOADING)
  const [jobRuns, setJobRuns] = useState<{ state: 'loading' } | { state: 'error' } | { state: 'ok'; value: JobRun[] }>({
    state: 'loading',
  })
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
      setEmailProblems(error ? { state: 'error' } : { state: 'ok', value: (data as unknown[])?.length ?? 0 })
    }

    async function loadJobs() {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc('job_runs_latest')
      if (!active) return
      setJobRuns(error ? { state: 'error' } : { state: 'ok', value: (data as JobRun[]) ?? [] })
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
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data: sessionData } = await supabase.auth.getSession()
      const { data } = await supabase.from('staff').select('display_name, role').eq('user_id', userData.user.id).maybeSingle()
      if (!active || !data) return
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
      {own && (
        <p>
          مرحبًا <bdi>{own.display_name}</bdi> — {ROLE_LABEL[own.role] ?? own.role}
        </p>
      )}

      {(own?.role === 'owner' || own?.role === 'operations') && (
        <section>
          <h2>البريد</h2>
          <p>
            مشكلات تحتاج انتباهًا:{' '}
            {emailProblems.state === 'ok' && emailProblems.value >= ATTENTION_CAP
              ? `${ATTENTION_CAP}+`
              : countText(emailProblems)}
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
                return (
                  <li key={job}>
                    {JOB_LABEL[job] ?? job}:{' '}
                    {run ? (
                      isStaleRun(run) ? (
                        <span className={styles.error}>آخر تشغيل قديم — تأكد من الجدولة</span>
                      ) : (
                        `${JOB_STATUS_LABEL[run.status] ?? run.status} — ${formatRiyadh(run.finished_at)}`
                      )
                    ) : (
                      'لم يعمل بعد'
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
          {store.state === 'not-configured' && <p className={styles.message}>المتجر غير مُهيأ — يبدأ مع المتجر.</p>}
          <p>
            زيارات آخر 7 أيام:{' '}
            {visits.state === 'ok' ? formatNumber(visits.value) : visits.state === 'loading' ? 'يحمّل...' : 'غير متاحة'}
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
