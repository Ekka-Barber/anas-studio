'use client'

/**
 * Version history for one document (P04 part 2): every saved seq, which one
 * is live, which is scheduled, and a restore that inserts the chosen
 * version's data as the next version.
 */
import { useEffect, useState } from 'react'

import type { Collection } from '@/admin/collections'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { formatRiyadh } from '@/lib/format'
import styles from './admin.module.css'

interface VersionRow {
  seq: number
  created_at: string
  publish_at: string | null
}

interface VersionHistoryProps {
  collection: Collection
  docId: string
  liveSeq: number | null
  latestSeq: number
  onRestored: () => void
}

export function VersionHistory({ collection, docId, liveSeq, latestSeq, onRestored }: VersionHistoryProps) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const supabase = getSupabaseBrowserClient()
    const { data, error: loadError } = await supabase
      .from('content_versions')
      .select('seq, created_at, publish_at')
      .eq('collection', collection)
      .eq('doc_id', docId)
      .order('seq', { ascending: false })
    if (loadError) {
      setError('تعذّر تحميل سجل النسخ.')
      return
    }
    setVersions((data as VersionRow[]) ?? [])
  }

  useEffect(() => {
    // Deferred to a microtask so `load`'s first setState call is not
    // synchronous within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, docId])

  async function restoreVersion(seq: number) {
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { data, error: readError } = await supabase
      .from('content_versions')
      .select('data')
      .eq('collection', collection)
      .eq('doc_id', docId)
      .eq('seq', seq)
      .single()
    if (readError || !data) {
      setBusy(false)
      setError('تعذّرت قراءة هذه النسخة.')
      return
    }
    const { error: insertError } = await supabase
      .from('content_versions')
      .insert({ collection, doc_id: docId, seq: latestSeq + 1, data: (data as { data: unknown }).data })
    setBusy(false)
    if (insertError) {
      setError('تعذّرت الاستعادة. حدّث الصفحة وحاول مرة أخرى.')
      return
    }
    onRestored()
  }

  if (versions === null) {
    return <p className={styles.message}>{error ?? 'يحمّل سجل النسخ...'}</p>
  }

  return (
    <div className={styles.field}>
      <h2>سجل النسخ</h2>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>النسخة</th>
              <th>التاريخ</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.seq}>
                <td>{version.seq}</td>
                <td>{formatRiyadh(version.created_at)}</td>
                <td>
                  {version.seq === liveSeq && <span className={styles.badge}>مباشر</span>}
                  {version.publish_at && <span className={styles.badge}>مجدول</span>}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    disabled={busy}
                    onClick={() => restoreVersion(version.seq)}
                  >
                    استعادة
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
