'use client'

/**
 * Loads, edits, saves, validates and publishes one document (P04 part 2).
 * Save appends the next `content_versions` row through the Data API as the
 * signed-in user; publish/schedule/cancel/archive go through
 * `src/lib/admin-publish.ts`. Autosave keeps an unsaved local copy in
 * `localStorage` so a conflict or a closed tab never loses text.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { collections, COLLECTION_LABELS, documentTitle, schemaFor, type Collection } from '@/admin/collections'
import {
  defaultsForFields,
  draftOffer,
  draftStorageAction,
  equalData,
  fieldPathLabel,
  withDefaults,
  type Field,
  type StoredDraft,
} from '@/admin/fields'
import { formatRiyadh } from '@/lib/format'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { FieldInput, type TaxonomiesByKind } from './FieldInput'
import { PublishBar } from './PublishBar'
import { VersionHistory } from './VersionHistory'
import styles from './admin.module.css'

/** Rooms whose public view exists and can therefore be previewed. */
const PREVIEW_ROOMS = new Set(['started', 'built', 'passed', 'shelf', 'book'])

const CONFLICT_MESSAGE = 'تغيّر هذا المستند منذ فتحته. نصّك محفوظ هنا؛ حمّل آخر نسخة ثم أعد التعديل.'

function fieldsFor(collection: Collection, docId: string): readonly Field[] {
  if (collection === 'rooms') {
    const roomFields = (collections.rooms.fields as Record<string, readonly Field[]>)[docId]
    if (!roomFields) throw new Error(`Unknown room: ${docId}`)
    return roomFields
  }
  return collections[collection].fields as readonly Field[]
}

/** The admin preview of a room's or a post's draft (D32); rooms without a built page have none. */
function previewPathFor(collection: Collection, docId: string): string | null {
  if (collection === 'rooms' && PREVIEW_ROOMS.has(docId)) return `/admin/preview?id=${docId}`
  if (collection === 'posts') return `/admin/preview?collection=posts&id=${docId}`
  return null
}

function draftKey(collection: Collection, docId: string): string {
  return `anasaq:draft:${collection}:${docId}`
}

function readStoredDraft(collection: Collection, docId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(collection, docId))
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    return null
  }
}

/** When a local copy was made, as Riyadh wall-clock text, or null for a time that cannot be read. */
function savedAtLabel(savedAt: unknown): string | null {
  const date = typeof savedAt === 'number' ? new Date(savedAt) : null
  return date && !Number.isNaN(date.getTime()) ? formatRiyadh(date.toISOString()) : null
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
  const [scheduledSeq, setScheduledSeq] = useState<number | null>(null)
  const [initialData, setInitialData] = useState<Record<string, unknown>>({})
  const [data, setData] = useState<Record<string, unknown>>({})
  const [localOffer, setLocalOffer] = useState<Record<string, unknown> | null>(null)
  // The version the offered copy was made from, when a newer one is saved now.
  const [staleBase, setStaleBase] = useState<number | null>(null)
  const [offerSavedAt, setOfferSavedAt] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [taxonomies, setTaxonomies] = useState<TaxonomiesByKind>({ category: [], tag: [] })
  const [loadGeneration, setLoadGeneration] = useState(0)
  const hydratedRef = useRef(false)
  const loadedOnceRef = useRef(false)
  const loadTicketRef = useRef(0)
  const userIdRef = useRef<string | undefined>(undefined)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const offerHeadingRef = useRef<HTMLHeadingElement>(null)
  // Set when the user answers the offer, so focus can return to the page once the banner is gone.
  const answeredRef = useRef(false)

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
      const { data: rows, error } = await supabase.from('published_documents').select('doc_id, data').eq('collection', 'taxonomies')
      if (error) {
        setTaxonomies({ category: [], tag: [], failed: true })
        return
      }
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
    // Only the newest load applies. An older answer landing later would replace
    // the form, and offer an edit made in between as an unsaved local copy.
    const ticket = ++loadTicketRef.current
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
      .select('latest_seq, latest_data, live_seq, scheduled_at, scheduled_seq')
      .eq('collection', collection)
      .eq('doc_id', docId)
      .maybeSingle()
    if (ticket !== loadTicketRef.current) return
    if (error) {
      setLoadError('تعذّر تحميل المستند.')
      setLoading(false)
      return
    }
    const { data: sessionData } = await supabase.auth.getSession()
    if (ticket !== loadTicketRef.current) return
    userIdRef.current = sessionData.session?.user.id
    const loadedSeq: number = row?.latest_seq ?? 0
    // Defaults go under the stored data, so a document that lacks a whole group
    // (the seeded settings have no `contact`) is not marked changed and its
    // group can be valid once one value is typed.
    const loadedData: Record<string, unknown> = row?.latest_data
      ? withDefaults(fields, row.latest_data)
      : defaultsForFields(fields)
    setBaseSeq(loadedSeq)
    setLiveSeq(row?.live_seq ?? null)
    setScheduledAt(row?.scheduled_at ?? null)
    setScheduledSeq(row?.scheduled_seq ?? null)
    setInitialData(loadedData)
    setData(loadedData)

    // The next autosave replaces or removes a copy that is not offered.
    const offer = draftOffer(readStoredDraft(collection, docId), userIdRef.current, loadedData, loadedSeq, fields)
    setLocalOffer(offer.offered)
    setOfferSavedAt(offer.savedAt === null ? null : savedAtLabel(offer.savedAt))
    setStaleBase(offer.staleBase)

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

  // Autosave into localStorage on every change, skipped until hydrated. It is
  // not on a timer: a timer is dropped by an unmount, a reload of the
  // document or a closed tab, and the text typed in that second is lost. A
  // form equal to its saved version keeps no copy: the copy a save removed
  // would otherwise come back and, once a restore or another session changed
  // the document, be offered as unsaved work. A copy still on offer stays
  // untouched until the user answers it, or the form would overwrite it (the
  // form itself stays hidden until then). Save relies on this rule to clear the
  // copy, because it runs after the save with the current offer.
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      const action = draftStorageAction(localOffer !== null, data, initialData)
      if (action === 'remove') {
        window.localStorage.removeItem(draftKey(collection, docId))
      } else if (action === 'write') {
        const draft: StoredDraft = { baseSeq, data, savedAt: Date.now(), userId: userIdRef.current }
        window.localStorage.setItem(draftKey(collection, docId), JSON.stringify(draft))
      }
    } catch {
      // Storage full or blocked: the form still works, only the local copy is lost.
    }
  }, [data, initialData, localOffer, baseSeq, collection, docId])

  function clearStoredDraft() {
    window.localStorage.removeItem(draftKey(collection, docId))
  }

  // Focus follows the banner: onto its heading when a copy is offered, and onto
  // the page title once it is answered, because its buttons unmount with it.
  useEffect(() => {
    if (localOffer) {
      offerHeadingRef.current?.focus()
    } else if (answeredRef.current) {
      answeredRef.current = false
      titleRef.current?.focus()
    }
  }, [localOffer])

  function acceptLocalOffer() {
    if (localOffer) {
      setData(localOffer)
      setLoadGeneration((generation) => generation + 1)
    }
    answeredRef.current = true
    setLocalOffer(null)
  }

  function discardLocalOffer() {
    clearStoredDraft()
    answeredRef.current = true
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
    // The stored copy is not cleared here: the form now equals its saved version,
    // so the autosave effect removes it, and never while a copy is on offer. A
    // guard on `localOffer` here would read this closure's stale value.
    setSaveMessage('تم الحفظ.')
  }

  if (loading) return <p className={styles.message}>يحمّل...</p>
  if (loadError) return <p className={styles.error}>{loadError}</p>

  const header = (
    <>
      <p>
        <Link href={`/admin/content/${collection}`}>{COLLECTION_LABELS[collection]}</Link>
      </p>
      <h1 ref={titleRef} tabIndex={-1}>
        {documentTitle(collection, docId, initialData)}
      </h1>
    </>
  )

  // A copy on offer is answered first. The form, Save and the publish bar stay
  // hidden until then, so nothing can be edited, saved or autosaved over it and
  // it stays in storage until the user chooses.
  if (localOffer) {
    const headingId = `${collection}-${docId}-offer`
    return (
      <div className={styles.field}>
        {header}
        <section aria-labelledby={headingId} className={styles.field}>
          <h2 id={headingId} ref={offerHeadingRef} tabIndex={-1}>
            يوجد تعديل غير محفوظ محليًا لهذا المستند.
          </h2>
          <p className={styles.message}>
            {offerSavedAt && `آخر تعديل محلي: ${offerSavedAt}. `}
            {staleBase !== null &&
              `هذه النسخة المحلية مبنية على النسخة ${staleBase}، والأحدث الآن ${baseSeq}؛ استرجاعها يستبدل ما حُفظ بعدها. `}
            استرجعها لتكمل من حيث توقفت، أو تجاهلها لتحذفها وتفتح آخر نسخة محفوظة.
          </p>
          <div className={styles.row}>
            <button type="button" className={styles.buttonSecondary} onClick={acceptLocalOffer}>
              استرجاع
            </button>
            <button type="button" className={styles.buttonSecondary} onClick={discardLocalOffer}>
              تجاهل
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className={styles.field}>
      {header}

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
            {parsed.error.issues.map((issue, index) => {
              const where = fieldPathLabel(fields, issue.path)
              return (
                <li key={index} className={styles.error}>
                  {where && `${where}: `}
                  {issue.message}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>
          حفظ
        </button>
        <p role="status" className={styles.message}>
          {saveMessage}
        </p>
      </div>

      {accessToken && baseSeq > 0 && (
        <PublishBar
          collection={collection}
          docId={docId}
          seq={baseSeq}
          liveSeq={liveSeq}
          scheduledAt={scheduledAt}
          scheduledSeq={scheduledSeq}
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
        // it. A plain save only changes `latestSeq`, which it refetches on.
        // Unlike PublishBar, VersionHistory has no in-flight message to lose
        // across a remount.
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
