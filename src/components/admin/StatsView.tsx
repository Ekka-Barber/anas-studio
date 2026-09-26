'use client'

/**
 * Owner-only statistics (P06 round 2): reads `GET /api/admin/stats` with the
 * signed-in session token. Commerce stays «غير مُعدّ بعد» until the store
 * arrives (P07/P08); analytics shows real numbers or «غير متاح» with the
 * reason — never an invented zero (D21).
 */
import { useEffect, useState } from 'react'

import { formatNumber } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

interface StatsPayload {
  generatedAt: string
  commerce: { status: string }
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
  NOT_CONFIGURED: 'الإحصاءات غير مُعدّة بعد (تتطلب ANALYTICS_TOKEN و CLOUDFLARE_ZONE_ID).',
  HTTP_ERROR: 'تعذّر الوصول إلى خدمة الإحصاءات.',
  TIMEOUT: 'انتهت مهلة الاستعلام.',
  GRAPHQL_ERROR: 'ردّ الإحصاءات يحتوي على خطأ.',
  SAMPLED: 'البيانات معيّنة (sampled)، فلا تُعرض أرقام تقديرية.',
}

export function StatsView() {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: sessionData } = await getSupabaseBrowserClient().auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      try {
        const response = await fetch('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } })
        if (!active) return
        if (!response.ok) {
          setError(true)
          return
        }
        const body = (await response.json()) as { data?: StatsPayload }
        if (body.data) setStats(body.data)
        else setError(true)
      } catch {
        if (active) setError(true)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <div>
        <h1>الإحصاءات</h1>
        <p className={styles.error}>غير متاحة — الإحصاءات للمالك فقط.</p>
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
        <p className={styles.message}>غير مُعدّ بعد — يبدأ مع المتجر.</p>
      </section>

      <section>
        <h2>الزيارات</h2>
        {stats.analytics.status === 'ok' ? (
          <>
            <p>الزيارات في آخر 7 أيام: {formatNumber(stats.analytics.visits)}</p>
            <p className={styles.message}>
              المدى: {formatRiyadh(stats.analytics.range.start)} — {formatRiyadh(stats.analytics.range.end)}
            </p>
            <p className={styles.message}>وقت الجلب: {formatRiyadh(stats.analytics.fetchedAt)}</p>
            <h3>أكثر الصفحات طلبًا</h3>
            {stats.analytics.topPaths.length === 0 ? (
              <p className={styles.message}>لا توجد صفحات في هذه الفترة.</p>
            ) : (
              <ul className={styles.metaList}>
                {stats.analytics.topPaths.map((path) => (
                  <li key={path.path}>
                    <span dir="ltr">{path.path}</span> — {formatNumber(path.count)}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className={styles.message}>غير متاح — {REASON_LABEL[stats.analytics.reason] ?? stats.analytics.reason}</p>
        )}
      </section>

      <p className={styles.message}>وقت التوليد: {formatRiyadh(stats.generatedAt)}</p>
    </div>
  )
}
