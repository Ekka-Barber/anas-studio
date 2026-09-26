'use client'

/**
 * The owner home (P06 round 2): real pending work, each count from a real
 * query under RLS, each item linking to its screen. A failed query shows
 * «تعذّر التحميل» — never 0 (D21: unavailable is unavailable, not zero).
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { formatNumber } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

type StaffRole = 'owner' | 'editor' | 'operations'
type Count = { state: 'loading' } | { state: 'error' } | { state: 'ok'; value: number }

const ROLE_LABEL: Record<StaffRole, string> = { owner: 'مالك', editor: 'محرر', operations: 'تشغيل' }
const JOB_LABEL: Record<string, string> = { email_outbox: 'إرسال البريد' }
const JOB_STATUS_LABEL: Record<string, string> = { ok: 'سليم', partial: 'جزئي', failed: 'فاشل', skipped: 'متجاوز' }
/** Jobs that exist in code today; a job with no run yet shows «لم يعمل بعد». */
const KNOWN_JOBS = ['email_outbox'] as const

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

export function AdminHome() {
  const [own, setOwn] = useState<{ display_name: string; role: StaffRole } | null>(null)
  const [inboxNew, setInboxNew] = useState<Count>(LOADING)
  const [emailProblems, setEmailProblems] = useState<Count>(LOADING)
  const [jobRuns, setJobRuns] = useState<{ state: 'loading' } | { state: 'error' } | { state: 'ok'; value: JobRun[] }>({
    state: 'loading',
  })
  const [scheduled, setScheduled] = useState<Count>(LOADING)
  const [visits, setVisits] = useState<
    { state: 'loading' } | { state: 'error' } | { state: 'unavailable' } | { state: 'ok'; value: number }
  >({ state: 'loading' })

  useEffect(() => {
    let active = true

    async function loadInbox() {
      const supabase = getSupabaseBrowserClient()
      const { count, error } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('status', 'new')
      if (!active) return
      setInboxNew(error || count === null ? { state: 'error' } : { state: 'ok', value: count })
    }

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

    async function loadVisits(token: string) {
      try {
        const response = await fetch('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } })
        if (!active) return
        if (!response.ok) {
          setVisits({ state: 'unavailable' })
          return
        }
        const body = (await response.json()) as { data?: { analytics?: { status: string; visits?: number } } }
        const analytics = body.data?.analytics
        setVisits(analytics?.status === 'ok' ? { state: 'ok', value: analytics.visits ?? 0 } : { state: 'unavailable' })
      } catch {
        if (active) setVisits({ state: 'error' })
      }
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

      const jobs = [loadInbox(), loadEmail(), loadJobs()]
      if (role === 'owner' || role === 'editor') jobs.push(loadScheduled())
      if (role === 'owner' && sessionData.session) jobs.push(loadVisits(sessionData.session.access_token))
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
          مرحبًا {own.display_name} — {ROLE_LABEL[own.role] ?? own.role}
        </p>
      )}

      {(own?.role === 'owner' || own?.role === 'operations') && (
        <section>
          <h2>الوارد</h2>
          <p>رسائل جديدة: {countText(inboxNew)}</p>
          <Link href="/admin/inbox">فتح الوارد</Link>
        </section>
      )}

      {(own?.role === 'owner' || own?.role === 'operations') && (
        <section>
          <h2>البريد</h2>
          <p>مشكلات تحتاج انتباهًا: {countText(emailProblems)}</p>
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
                    {run ? `${JOB_STATUS_LABEL[run.status] ?? run.status} — ${formatRiyadh(run.finished_at)}` : 'لم يعمل بعد'}
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
