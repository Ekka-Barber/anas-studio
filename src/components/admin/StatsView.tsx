'use client'

/**
 * Owner-only statistics (P06 round 2): reads the `admin` function's `stats` with the
 * signed-in session token. Commerce stays «غير مُعدّ بعد» until the store
 * arrives (P07/P08); analytics shows real numbers or «غير متاح» with the
 * reason — never an invented zero (D21).
 */
import { useEffect, useState } from 'react'

import { formatNumber, formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

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
  NOT_CONFIGURED: 'الإحصاءات غير مُعدّة بعد. تحتاج إلى ANALYTICS_TOKEN و CLOUDFLARE_ZONE_ID.',
  HTTP_ERROR: 'تعذّر الوصول إلى خدمة الإحصاءات.',
  TIMEOUT: 'انتهت مهلة الاستعلام.',
  GRAPHQL_ERROR: 'ردّ الإحصاءات يحتوي على خطأ.',
  SAMPLED: 'البيانات معيّنة (sampled)، فلا تُعرض أرقام تقديرية.',
  // A short wait, not a refresh: the analytics side may need a moment to recover.
  UNEXPECTED_SHAPE: 'تعذّر قراءة بيانات الزيارات. جرّب بعد قليل.',
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
        <p className={styles.message}>غير مُعدّ بعد. تظهر أرقامه عند افتتاح المتجر.</p>
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
