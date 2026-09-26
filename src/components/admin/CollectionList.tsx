'use client'

/**
 * One collection's documents (P04 part 2): rows from `content_documents`,
 * plus the fixed rows for `rooms`/`site_settings` that may not have been
 * edited yet. "جديد" creates a post (a generated uuid doc id) or a
 * taxonomy (a user-entered slug doc id).
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { COLLECTION_LABELS, ROOM_DOC_LABELS, roomSchemas, SITE_SETTINGS_DOC_ID, type Collection } from '@/admin/collections'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { documentHref } from '@/lib/supabase/functions'

import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

interface DocumentRow {
  doc_id: string
  latest_seq: number
  latest_data: Record<string, unknown>
  latest_at: string
  live_seq: number | null
  scheduled_at: string | null
}

function statusFor(row: DocumentRow | undefined): string {
  if (!row) return 'مسودة لم تُنشر'
  if (row.scheduled_at) return `مجدول في ${formatRiyadh(row.scheduled_at)}`
  if (row.live_seq === null) return 'مسودة لم تُنشر'
  if (row.latest_seq > row.live_seq) return 'تعديلات غير منشورة'
  return 'منشور'
}

function titleFor(collection: Collection, docId: string, row: DocumentRow | undefined): string {
  if (collection === 'rooms') {
    const fallback = docId in ROOM_DOC_LABELS ? ROOM_DOC_LABELS[docId as keyof typeof ROOM_DOC_LABELS] : docId
    const label = typeof row?.latest_data.roomLabel === 'string' ? row.latest_data.roomLabel : null
    const title = typeof row?.latest_data.title === 'string' ? row.latest_data.title : null
    return label && title ? `${label} — ${title}` : (title ?? fallback)
  }
  if (collection === 'site_settings') return COLLECTION_LABELS.site_settings
  if (collection === 'posts') {
    const title = row?.latest_data.title
    return typeof title === 'string' && title ? title : docId
  }
  const label = row?.latest_data.label
  return typeof label === 'string' && label ? label : docId
}

export function CollectionList({ collection }: { collection: Collection }) {
  const router = useRouter()
  const [rows, setRows] = useState<Map<string, DocumentRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newSlug, setNewSlug] = useState('')
  const [newSlugError, setNewSlugError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error: loadError } = await supabase.from('content_documents').select('*').eq('collection', collection)
      if (loadError) {
        setError('تعذّر تحميل القائمة.')
        return
      }
      const map = new Map<string, DocumentRow>()
      for (const row of (data as DocumentRow[]) ?? []) map.set(row.doc_id, row)
      setRows(map)
    })()
  }, [collection])

  const docIds: string[] =
    collection === 'rooms'
      ? Object.keys(roomSchemas)
      : collection === 'site_settings'
        ? [SITE_SETTINGS_DOC_ID]
        : rows
          ? Array.from(rows.keys())
          : []

  function createPost() {
    router.push(documentHref('posts', crypto.randomUUID().toLowerCase()))
  }

  function createTaxonomy() {
    if (!SLUG_PATTERN.test(newSlug)) {
      setNewSlugError('المعرّف يجب أن يتكوّن من حروف لاتينية صغيرة وأرقام وشرطات، ويبدأ بحرف أو رقم.')
      return
    }
    router.push(documentHref('taxonomies', newSlug))
  }

  return (
    <div className={styles.field}>
      <h1>{COLLECTION_LABELS[collection]}</h1>
      {error && <p className={styles.error}>{error}</p>}

      {collection === 'posts' && (
        <button type="button" className={styles.button} onClick={createPost}>
          جديد
        </button>
      )}
      {collection === 'taxonomies' && (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="new-taxonomy-slug">
            معرّف جديد
          </label>
          <input
            id="new-taxonomy-slug"
            className={styles.input}
            type="text"
            value={newSlug}
            onChange={(event) => {
              setNewSlug(event.target.value)
              setNewSlugError(null)
            }}
          />
          <button type="button" className={styles.button} onClick={createTaxonomy}>
            جديد
          </button>
        </div>
      )}
      {newSlugError && <p className={styles.error}>{newSlugError}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>العنوان</th>
              <th>الحالة</th>
              <th>آخر حفظ</th>
            </tr>
          </thead>
          <tbody>
            {docIds.map((docId) => {
              const row = rows?.get(docId)
              return (
                <tr key={docId}>
                  <td>
                    <Link href={documentHref(collection, docId)}>{titleFor(collection, docId, row)}</Link>
                  </td>
                  <td>{statusFor(row)}</td>
                  <td>{row ? formatRiyadh(row.latest_at) : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
