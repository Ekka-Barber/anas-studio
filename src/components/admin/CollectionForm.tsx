'use client'

/**
 * Loads, edits, saves, validates and publishes one document (P04 part 2).
 * Save appends the next `content_versions` row through the Data API as the
 * signed-in user; publish/schedule/cancel/archive go through
 * `src/app/(admin)/admin/actions.ts`. Autosave keeps an unsaved local copy in
 * `localStorage` so a conflict or a closed tab never loses text.
 */
import { useEffect, useRef, useState } from 'react'

import { collections, schemaFor, type Collection } from '@/admin/collections'
import type { Field } from '@/admin/fields'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { defaultsForFields, FieldInput, type TaxonomiesByKind } from './FieldInput'
import { PublishBar } from './PublishBar'
import { VersionHistory } from './VersionHistory'
import styles from './admin.module.css'

const CONFLICT_MESSAGE = 'تغيّر هذا المستند منذ فتحته. نصّك محفوظ هنا؛ حمّل آخر نسخة ثم أعد التعديل.'

function fieldsFor(collection: Collection, docId: string): readonly Field[] {
  if (collection === 'rooms') {
    const roomFields = (collections.rooms.fields as Record<string, readonly Field[]>)[docId]
    if (!roomFields) throw new Error(`Unknown room: ${docId}`)
    return roomFields
  }
  return collections[collection].fields as readonly Field[]
}

function previewPathFor(collection: Collection, docId: string): string | null {
  if (collection === 'rooms') return `/${docId}`
  if (collection === 'site_settings') return '/'
  return null
}

function draftKey(collection: Collection, docId: string): string {
  return `anasaq:draft:${collection}:${docId}`
}

interface StoredDraft {
  baseSeq: number
  data: unknown
  savedAt: number
}

function readStoredDraft(collection: Collection, docId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(collection, docId))
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    return null
  }
}

function equalData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function CollectionForm({ collection, docId }: { collection: Collection; docId: string }) {
  const fields = fieldsFor(collection, docId)
  const schema = schemaFor(collection, docId)
  const needsTaxonomies = fields.some((field) => field.type === 'relation')

  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [baseSeq, setBaseSeq] = useState(0)
  const [liveSeq, setLiveSeq] = useState<number | null>(null)
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown>>({})
  const [data, setData] = useState<Record<string, unknown>>({})
  const [localOffer, setLocalOffer] = useState<Record<string, unknown> | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [taxonomies, setTaxonomies] = useState<TaxonomiesByKind>({ category: [], tag: [] })
  const [loadGeneration, setLoadGeneration] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRef = useRef(false)
  const loadedOnceRef = useRef(false)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth
      .getSession()
      .then(({ data: sessionData }) => setAccessToken(sessionData.session?.access_token ?? null))
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) =>
      setAccessToken(session?.access_token ?? null),
    )
    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!needsTaxonomies) return
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const { data: rows } = await supabase.from('published_documents').select('doc_id, data').eq('collection', 'taxonomies')
      const category: TaxonomiesByKind['category'] = []
      const tag: TaxonomiesByKind['tag'] = []
      for (const row of (rows as { doc_id: string; data: { kind?: string; label?: string } }[]) ?? []) {
        const entry = { slug: row.doc_id, label: typeof row.data.label === 'string' ? row.data.label : row.doc_id }
        if (row.data.kind === 'tag') tag.push(entry)
        else category.push(entry)
      }
      setTaxonomies({ category, tag })
    })()
  }, [needsTaxonomies])

  async function load() {
    hydratedRef.current = false
    // Only the first load replaces the form with "يحمّل..."; a reload after
    // publish/schedule/archive/restore (via PublishBar's onChanged) must not
    // unmount PublishBar, or its just-set success message disappears before
    // it can ever be seen.
    if (!loadedOnceRef.current) setLoading(true)
    setLoadError(null)
    const supabase = getSupabaseBrowserClient()
    const { data: row, error } = await supabase
      .from('content_documents')
      .select('latest_seq, latest_data, live_seq, scheduled_at')
      .eq('collection', collection)
      .eq('doc_id', docId)
      .maybeSingle()
    if (error) {
      setLoadError('تعذّر تحميل المستند.')
      setLoading(false)
      return
    }
    const loadedSeq: number = row?.latest_seq ?? 0
    const loadedData: Record<string, unknown> = row?.latest_data ?? defaultsForFields(fields)
    setBaseSeq(loadedSeq)
    setLiveSeq(row?.live_seq ?? null)
    setScheduledAt(row?.scheduled_at ?? null)
    setInitialData(loadedData)
    setData(loadedData)

    const stored = readStoredDraft(collection, docId)
    setLocalOffer(stored && !equalData(stored.data, loadedData) ? (stored.data as Record<string, unknown>) : null)

    setLoading(false)
    loadedOnceRef.current = true
    setLoadGeneration((generation) => generation + 1)
    setTimeout(() => {
      hydratedRef.current = true
    }, 0)
  }

  useEffect(() => {
    // Deferred to a microtask so `load`'s first setState calls are not
    // synchronous within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, docId])

  // Autosave: debounce 1s into localStorage, skipped until hydrated.
  useEffect(() => {
    if (!hydratedRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const draft: StoredDraft = { baseSeq, data, savedAt: Date.now() }
      window.localStorage.setItem(draftKey(collection, docId), JSON.stringify(draft))
    }, 1000)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [data, baseSeq, collection, docId])

  function clearStoredDraft() {
    window.localStorage.removeItem(draftKey(collection, docId))
  }

  function acceptLocalOffer() {
    if (localOffer) {
      setData(localOffer)
      setLoadGeneration((generation) => generation + 1)
    }
    setLocalOffer(null)
  }

  function discardLocalOffer() {
    clearStoredDraft()
    setLocalOffer(null)
  }

  const parsed = schema.safeParse(data)
  const savedParsed = schema.safeParse(initialData)
  const hasUnsavedChanges = !equalData(data, initialData)
  const canPublish = savedParsed.success && !hasUnsavedChanges && baseSeq > 0

  async function save() {
    setSaving(true)
    setSaveMessage(null)
    const supabase = getSupabaseBrowserClient()
    const nextSeq = baseSeq + 1
    const { error } = await supabase.from('content_versions').insert({ collection, doc_id: docId, seq: nextSeq, data })
    setSaving(false)
    if (error) {
      setSaveMessage(error.code === '23505' ? CONFLICT_MESSAGE : 'تعذّر الحفظ.')
      return
    }
    setBaseSeq(nextSeq)
    setInitialData(data)
    clearStoredDraft()
    setSaveMessage('تم الحفظ.')
  }

  if (loading) return <p className={styles.message}>يحمّل...</p>
  if (loadError) return <p className={styles.error}>{loadError}</p>

  return (
    <div className={styles.field}>
      {localOffer && (
        <div className={styles.row}>
          <p className={styles.message}>يوجد تعديل غير محفوظ محليًا لهذا المستند.</p>
          <button type="button" className={styles.buttonSecondary} onClick={acceptLocalOffer}>
            استعادة النسخة غير المحفوظة
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={discardLocalOffer}>
            تجاهلها
          </button>
        </div>
      )}

      <div key={loadGeneration} className={styles.field}>
        {fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={data[field.name]}
            onChange={(value) => setData((prev) => ({ ...prev, [field.name]: value }))}
            id={`${collection}-${docId}-${field.name}`}
            taxonomies={taxonomies}
          />
        ))}
      </div>

      {!parsed.success && (
        <div>
          <p className={styles.error}>هناك مشاكل في البيانات:</p>
          <ul>
            {parsed.error.issues.map((issue, index) => (
              <li key={index} className={styles.error}>
                {issue.path.join('.')}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>
          حفظ
        </button>
        {saveMessage && <p className={styles.message}>{saveMessage}</p>}
      </div>

      {accessToken && baseSeq > 0 && (
        <PublishBar
          collection={collection}
          docId={docId}
          seq={baseSeq}
          liveSeq={liveSeq}
          scheduledAt={scheduledAt}
          accessToken={accessToken}
          canPublish={canPublish}
          canArchive={collection === 'posts' || collection === 'taxonomies'}
          previewPath={previewPathFor(collection, docId)}
          onChanged={() => void load()}
        />
      )}

      {baseSeq > 0 && (
        // Keyed by loadGeneration (like the fields div above, but with a
        // distinct key string: two siblings sharing one key value confuses
        // React's reconciliation and can duplicate DOM nodes). Its own
        // `versions` list is fetched once per mount, so a restore (which
        // inserts a new row) must force a remount or the table never shows
        // it. Unlike PublishBar, VersionHistory has no in-flight message to
        // lose across a remount.
        <VersionHistory
          key={`history-${loadGeneration}`}
          collection={collection}
          docId={docId}
          liveSeq={liveSeq}
          latestSeq={baseSeq}
          onRestored={() => void load()}
        />
      )}
    </div>
  )
}
