'use client'

/**
 * One collection's documents (P04 part 2): rows from `content_documents`,
 * plus the fixed rows (the rooms, `site_settings`, the four policies and the
 * scenes gallery) that may not have been edited yet. "جديد" creates a post (a generated uuid doc id) or a
 * taxonomy (a user-entered slug doc id).
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  COLLECTION_LABELS,
  documentTitle,
  POLICY_DOC_IDS,
  roomSchemas,
  SCENES_DOC_ID,
  SITE_SETTINGS_DOC_ID,
  type Collection,
} from '@/admin/collections'
import { liveStatus, scheduleIsBehind } from '@/lib/admin-publish'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { documentHref } from '@/lib/supabase/functions'

import { formatRiyadh } from '@/lib/format'
import styles from './admin.module.css'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

interface DocumentRow {
  doc_id: string
  latest_seq: number
  latest_data: Record<string, unknown>
  latest_at: string
  live_seq: number | null
  scheduled_at: string | null
  scheduled_seq: number | null
}

function statusFor(row: DocumentRow | undefined): string {
  if (!row) return 'مسودة لم تُنشر'
  if (row.scheduled_at) {
    const when = `مجدول في ${formatRiyadh(row.scheduled_at)}`
    return scheduleIsBehind(row.scheduled_seq, row.latest_seq)
      ? `${when}: نسخة ${row.scheduled_seq}، وهناك تعديلات أحدث غير مجدولة`
      : when
  }
  if (row.live_seq === null) return 'مسودة لم تُنشر'
  if (row.latest_seq > row.live_seq) return 'تعديلات غير منشورة'
  // The live version is the latest one: a post it hides is live but not on the site.
  return liveStatus(row.latest_data)
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
      const { data, error: loadError } = await supabase.from('content_documents')
        .select('*')
        .eq('collection', collection)
        .order('latest_at', { ascending: false })
      if (loadError) {
        setError('تعذّر تحميل القائمة.')
        return
      }
      const map = new Map<string, DocumentRow>()
      for (const row of (data as DocumentRow[]) ?? []) map.set(row.doc_id, row)
      setRows(map)
    })()
  }, [collection])

  // Fixed documents (rooms, site settings, policies, the scenes gallery) are
  // always listed, even before a first save; posts and taxonomies list what
  // exists.
  const docIds: string[] =
    collection === 'rooms'
      ? Object.keys(roomSchemas)
      : collection === 'site_settings'
        ? [SITE_SETTINGS_DOC_ID]
        : collection === 'policies'
          ? [...POLICY_DOC_IDS]
          : collection === 'scenes'
            ? [SCENES_DOC_ID]
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
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

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
            dir="auto"
            aria-invalid={newSlugError ? true : undefined}
            aria-describedby={newSlugError ? 'new-taxonomy-slug-error' : undefined}
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
      {newSlugError && (
        <p id="new-taxonomy-slug-error" role="alert" className={styles.error}>
          {newSlugError}
        </p>
      )}

      <div className={styles.tableWrap}>
        {/* Cards on phones, like the email and team tables: one long word in a
            title otherwise widened the table past its box and cut the dates. */}
        <table className={`${styles.table} ${styles.responsive}`}>
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
                  <td data-label="العنوان">
                    <Link href={documentHref(collection, docId)}>{documentTitle(collection, docId, row?.latest_data)}</Link>
                  </td>
                  <td data-label="الحالة">{statusFor(row)}</td>
                  <td data-label="آخر حفظ">{row ? formatRiyadh(row.latest_at) : 'لم يُحفظ بعد'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
