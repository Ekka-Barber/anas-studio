'use client'

/**
 * The media library screen (P05 round 2): folders, a searchable paged grid,
 * an edit panel over `mediaFields`, the where-used guard and deletion, and
 * the upload dialog. Reads and edits the `media` table through the browser
 * Supabase client as the signed-in owner/editor (RLS and the column grants
 * are the real enforcement); deletion goes through the `admin` Edge Function's
 * `media-delete` action, which calls `media_delete` as `service_role`.
 *
 * `MediaBrowser` (the grid with search and paging) is exported for
 * `MediaPicker` — the same browser inside content forms' picker dialog.
 */
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { COLLECTION_LABELS, ROOM_DOC_LABELS } from '@/admin/collections'
import { mediaFields, mediaMetaSchema } from '@/admin/collections/media'
import { POLICY_DOC_LABELS } from '@/admin/collections/policies'
import { folderIsInvalid, mediaUrl } from '@/lib/media-ref'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction, documentHref } from '@/lib/supabase/functions'

import { FieldInput } from './FieldInput'
import { MediaUpload } from './MediaUpload'
import styles from './admin.module.css'

/** What `media_complete` recorded for one derivative. */
export interface MediaDerivative {
  width: number
  height: number
  bytes?: number
  key: string
}

/** The columns the library reads; keys and md5 stay unread. */
export interface MediaRow {
  id: string
  name: string
  folder: string
  alt_ar: string
  caption: string | null
  rights: string
  original_bytes: number
  original_width: number
  original_height: number
  original_mime: string
  derivatives: MediaDerivative[]
  created_at: string
}

interface WhereUsedRow {
  collection: string
  doc_id: string
  state: string
}

/** What `media_product_usage` returns: a product that names the image as its cover. */
interface ProductUsageRow {
  product_id: string
  title: string
  status: string
}

const MEDIA_COLUMNS =
  'id,name,folder,alt_ar,caption,rights,original_bytes,original_width,original_height,original_mime,derivatives,created_at'
const PAGE_SIZE = 40
const FOLDER_PAGE_SIZE = 1000
/** Select-option sentinel for the root folder (whose real value is ''). */
const ROOT_OPTION = '__root__'

const STATE_LABELS: Record<string, string> = { live: 'منشورة', draft: 'مسودة', scheduled: 'مجدولة' }
const PRODUCT_STATUS_LABELS: Record<string, string> = { draft: 'مسودة', published: 'منشور', archived: 'مؤرشف' }

/** `أ/ب` displays as «أ / ب»; the value stays the raw path. */
function folderLabel(folder: string): string {
  return folder.split('/').join(' / ')
}

/** A folder path after `media_rename_folder(from, to)`: the same prefix rule the SQL uses. */
export function movedFolder(folder: string, from: string, to: string): string {
  return folder === from || folder.startsWith(`${from}/`) ? to + folder.slice(from.length) : folder
}

/**
 * Why `from` → `to` cannot run, or null. The SQL length check applies to every
 * child path, so one overlong descendant fails the whole rename.
 */
export function renameProblem(folders: string[], from: string, to: string): string | null {
  if (from === '' || to === '' || folderIsInvalid(to)) return 'مسار مجلد جديد غير صالح.'
  if (folders.some((folder) => folderIsInvalid(movedFolder(folder, from, to)))) {
    return 'الاسم الجديد يجعل أحد المجلدات الفرعية أطول من 120 حرفًا.'
  }
  return null
}

function whereUsedLabel(row: WhereUsedRow): string {
  if (row.collection === 'rooms') {
    const label = ROOM_DOC_LABELS[row.doc_id as keyof typeof ROOM_DOC_LABELS]
    if (label) return label
  }
  if (row.collection === 'site_settings' || row.collection === 'scenes') return COLLECTION_LABELS[row.collection]
  if (row.collection === 'policies') {
    const label = POLICY_DOC_LABELS[row.doc_id as keyof typeof POLICY_DOC_LABELS]
    if (label) return label
  }
  // Post ids are random UUIDs and the RPC returns no title: the section name plus the id's start keeps posts apart.
  return `${(COLLECTION_LABELS as Record<string, string>)[row.collection] ?? row.collection} · ${row.doc_id.slice(0, 8)}`
}

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} ميغابايت`
    : `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`
}

export function smallestDerivative(row: Pick<MediaRow, 'derivatives'>): MediaDerivative {
  return row.derivatives.reduce((smallest, derivative) => (derivative.width < smallest.width ? derivative : smallest))
}

/** One media row by id (RLS decides whether the caller may see it). */
export async function fetchMediaRow(id: string): Promise<MediaRow | null> {
  const { data } = await getSupabaseBrowserClient()
    .from('media')
    .select(MEDIA_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  return (data as MediaRow | null) ?? null
}

/** The columns the details form edits; `caption` is null when empty, as stored. */
type MediaPatch = Pick<MediaRow, 'name' | 'alt_ar' | 'caption' | 'rights' | 'folder'>

/**
 * Saves one image's details. `missing` when no row matched: PostgREST answers
 * 204 without an error for an update whose row was deleted or which RLS no
 * longer lets the caller touch, so the updated ids are read back.
 */
export async function updateMediaRow(id: string, patch: MediaPatch): Promise<'saved' | 'missing' | 'error'> {
  const { data, error } = await getSupabaseBrowserClient().from('media').update(patch).eq('id', id).select('id')
  if (error) return 'error'
  return data && data.length > 0 ? 'saved' : 'missing'
}

/** `patch` on `current` only while `current` is still the saved row; another image opened meanwhile stays as it is. */
export function patchSelected(current: MediaRow | null, id: string, patch: Partial<MediaRow>): MediaRow | null {
  return current?.id === id ? { ...current, ...patch } : current
}

/** `page` after `previous`, minus rows already shown: two requests for one range must not double a tile. */
export function appendPage(previous: MediaRow[], page: MediaRow[]): MediaRow[] {
  const shown = new Set(previous.map((row) => row.id))
  return [...previous, ...page.filter((row) => !shown.has(row.id))]
}

/** One page of the library list, newest first. */
async function loadMediaPage(folder: string | null, search: string, from: number): Promise<MediaRow[]> {
  let query = getSupabaseBrowserClient().from('media').select(MEDIA_COLUMNS)
  if (folder !== null) query = query.eq('folder', folder)
  const trimmed = search.trim()
  if (trimmed) query = query.ilike('name', `%${trimmed}%`)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MediaRow[]
}

/**
 * The shared library browser: newest first, 40 per page, search on `name`
 * (debounced), optional exact folder filter. `reloadToken` re-runs the query
 * from the first page after an upload, an edit or a folder rename.
 */
export function MediaBrowser({
  folder,
  reloadToken,
  selectedId,
  onSelect,
}: {
  folder: string | null
  reloadToken: number
  selectedId?: string | null
  onSelect: (row: MediaRow) => void
}) {
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<MediaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Bumped whenever a query's first page lands. A «المزيد» request started
  // before that must not append its rows to the new query's grid.
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    const timer = setTimeout(
      () => {
        void loadMediaPage(folder, search, 0)
          .then((page) => {
            if (!active) return
            setError(null)
            setRows(page)
            setMore(page.length === PAGE_SIZE)
          })
          .catch(() => {
            if (!active) return
            setError('تعذّر تحميل المكتبة.')
            setRows([])
            setMore(false)
          })
          .finally(() => {
            if (!active) return
            generation.current += 1
            setLoading(false)
            setLoadingMore(false)
          })
      },
      search ? 300 : 0,
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [search, folder, reloadToken])

  function loadMore() {
    // One page at a time: a second click would fetch the same range from the same `rows.length`.
    if (loadingMore) return
    const requested = generation.current
    setLoadingMore(true)
    void loadMediaPage(folder, search, rows.length)
      .then((page) => {
        if (requested !== generation.current) return
        setError(null)
        setRows((previous) => appendPage(previous, page))
        setMore(page.length === PAGE_SIZE)
      })
      .catch(() => {
        if (requested === generation.current) setError('تعذّر تحميل المكتبة.')
      })
      .finally(() => {
        // A superseded request leaves `loadingMore` to the new query's first page.
        if (requested === generation.current) setLoadingMore(false)
      })
  }

  return (
    <div className={styles.field}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={searchId}>
          بحث بالاسم
        </label>
        <input
          id={searchId}
          className={styles.input}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {loading && <p className={styles.message}>يحمّل...</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!loading && !error && rows.length === 0 && <p className={styles.message}>لا توجد صور.</p>}
      <div className={styles.mediaGrid}>
        {rows.map((row) => {
          const derivative = smallestDerivative(row)
          return (
            <button
              key={row.id}
              type="button"
              className={styles.mediaTile}
              aria-pressed={selectedId === undefined ? undefined : selectedId === row.id}
              onClick={() => onSelect(row)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15, D32) */}
              <img
                src={mediaUrl(derivative.key)}
                alt={row.alt_ar}
                width={derivative.width}
                height={derivative.height}
                loading="lazy"
              />
              <span className={styles.mediaTileName}>{row.name}</span>
            </button>
          )
        })}
      </div>
      {more && (
        <button type="button" className={styles.buttonSecondary} disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'يحمّل...' : 'المزيد'}
        </button>
      )}
    </div>
  )
}

export function MediaLibrary() {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [selected, setSelected] = useState<MediaRow | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [usedInState, setUsedInState] = useState<{
    id: string
    rows: WhereUsedRow[] | null
    products: ProductUsageRow[]
    error: boolean
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [renameMessage, setRenameMessage] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [folderError, setFolderError] = useState(false)
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const deleteTitleId = useId()
  const detailsRef = useRef<HTMLElement>(null)
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null)
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null)
  // The id of the image whose details are open. A save or delete that resolves
  // after the owner opened another image applies its result only while this
  // still matches the id it wrote.
  const selectedIdRef = useRef<string | null>(null)
  // Bumped on every selection so the details scroll into view and take focus
  // even when the same item is chosen again.
  const [selectionCount, setSelectionCount] = useState(0)

  useEffect(() => {
    if (selectionCount === 0) return
    detailsRef.current?.scrollIntoView({ block: 'start' })
    detailsHeadingRef.current?.focus({ preventScroll: true })
  }, [selectionCount])

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
    const dialog = deleteDialogRef.current
    if (!dialog) return
    if (deleteOpen && !dialog.open) dialog.showModal()
    if (!deleteOpen && dialog.open) dialog.close()
  }, [deleteOpen])

  // A delete unmounts the details panel, and the «حذف» button the closing dialog
  // would return focus to with it: the heading takes focus so the place is kept.
  // Declared after the dialog effect, so the modal is closed (the page no longer
  // inert) by the time focus moves.
  useEffect(() => {
    if (libraryMessage) libraryHeadingRef.current?.focus()
  }, [libraryMessage])

  useEffect(() => {
    // ponytail: the Data API has no DISTINCT, and a response is capped at
    // PostgREST's max_rows (1000), so `.limit()` cannot lift it. Read only the
    // folder column (RLS already scopes it to owner/editor) page by page and
    // dedupe here; a SQL function returning the distinct folders would replace this.
    // Paging runs to an empty page, not to a short one: max_rows may be lower than a page.
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const distinct = new Set<string>()
      for (let from = 0; active; ) {
        const { data, error } = await supabase
          .from('media')
          .select('folder')
          .order('folder')
          .range(from, from + FOLDER_PAGE_SIZE - 1)
        if (error) {
          // A failed page must not publish a partial list: keep the previous one and say so.
          if (active) setFolderError(true)
          return
        }
        const page = (data ?? []) as unknown as Array<{ folder: string }>
        for (const row of page) distinct.add(row.folder)
        if (page.length === 0) break
        from += page.length
      }
      if (active) {
        setFolders([...distinct])
        setFolderError(false)
      }
    })()
    return () => {
      active = false
    }
  }, [reloadToken])

  // The where-used list for the selected item only; a fetch result for a
  // different id is ignored, so switching selections never shows stale rows.
  const usedIn = selected && usedInState?.id === selected.id ? usedInState : null

  useEffect(() => {
    if (!selected) return
    let active = true
    const supabase = getSupabaseBrowserClient()
    // Content documents and product covers both block a delete, so both are listed.
    void Promise.all([
      supabase.rpc('media_where_used', { p_id: selected.id }),
      supabase.rpc('media_product_usage', { p_id: selected.id }),
    ]).then(([content, products]) => {
      if (!active) return
      const failed = Boolean(content.error || products.error)
      setUsedInState({
        id: selected.id,
        rows: failed ? null : ((content.data ?? []) as unknown as WhereUsedRow[]),
        products: failed ? [] : ((products.data ?? []) as unknown as ProductUsageRow[]),
        error: failed,
      })
    })
    return () => {
      active = false
    }
  }, [selected, reloadToken])

  function select(row: MediaRow) {
    selectedIdRef.current = row.id
    setLibraryMessage(null)
    setSelected(row)
    setValues({
      name: row.name,
      altAr: row.alt_ar,
      caption: row.caption ?? '',
      rights: row.rights,
      folder: row.folder,
    })
    setFieldErrors({})
    setSaveMessage(null)
    setSelectionCount((count) => count + 1)
  }

  async function save() {
    if (!selected) return
    const parsed = mediaMetaSchema.safeParse(values)
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const [name, list] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (list?.[0]) errors[name] = list[0]
      }
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    setSaving(true)
    setSaveMessage(null)
    const id = selected.id
    const patch: MediaPatch = {
      name: parsed.data.name,
      alt_ar: parsed.data.altAr,
      caption: parsed.data.caption ? parsed.data.caption : null,
      rights: parsed.data.rights,
      folder: parsed.data.folder,
    }
    const result = await updateMediaRow(id, patch)
    setSaving(false)
    // The panel may show another image by now: this result belongs to `id` only.
    const stillOpen = selectedIdRef.current === id
    if (result !== 'saved') {
      const text = result === 'missing' ? 'لم يُحفظ؛ الصورة محذوفة أو لا تملك صلاحية تعديلها.' : 'تعذّر الحفظ.'
      setSaveMessage(stillOpen ? text : `«${patch.name}»: ${text}`)
      if (result === 'missing') setReloadToken((token) => token + 1)
      return
    }
    setSelected((open) => patchSelected(open, id, patch))
    if (stillOpen) {
      setSaveMessage('حُفظ')
      setValues((previous) => ({ ...previous, folder: patch.folder, name: patch.name }))
    }
    setReloadToken((token) => token + 1)
  }

  async function renameFolder() {
    if (renaming) return
    const to = renameTo.trim()
    const problem = renameProblem(folders, renameFrom, to)
    if (problem) {
      setRenameMessage(problem)
      return
    }
    setRenaming(true)
    const { data, error } = await getSupabaseBrowserClient().rpc('media_rename_folder', {
      p_from: renameFrom,
      p_to: to,
    })
    setRenaming(false)
    if (error || typeof data !== 'number') {
      setRenameMessage('تعذّرت إعادة تسمية المجلد.')
      return
    }
    setRenameMessage(data > 0 ? `نُقلت ${data} صورة إلى «${folderLabel(to)}».` : 'لا توجد صور في هذا المجلد.')
    // The open details form and the filter still hold the old path: follow the rename, or a save would move the image back.
    // Functional updates: whatever is open or chosen now moved too, not what the closure held when the click came.
    setSelectedFolder((current) =>
      current !== null && current !== ROOT_OPTION ? movedFolder(current, renameFrom, to) : current,
    )
    setSelected((open) => (open ? { ...open, folder: movedFolder(open.folder, renameFrom, to) } : open))
    setValues((previous) =>
      previous.folder === undefined ? previous : { ...previous, folder: movedFolder(previous.folder, renameFrom, to) },
    )
    setRenameFrom('')
    setRenameTo('')
    setReloadToken((token) => token + 1)
  }

  async function confirmDelete() {
    if (!selected || !accessToken) return
    const id = selected.id
    setDeleting(true)
    setDeleteError(null)
    const result = await callFunction<{ id: string }>('admin', { action: 'media-delete', id })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.error.message)
      return
    }
    setDeleteError(null)
    setDeleteOpen(false)
    // Esc closes the dialog mid-request, so another image may be open by now.
    if (selectedIdRef.current === id) {
      selectedIdRef.current = null
      setSelected(null)
    }
    setLibraryMessage('حُذفت الصورة.')
    setReloadToken((token) => token + 1)
  }

  async function handleUploaded(id: string) {
    setUploadOpen(false)
    setReloadToken((token) => token + 1)
    const row = await fetchMediaRow(id)
    if (row) select(row)
  }

  return (
    <div className={styles.field}>
      <h1 ref={libraryHeadingRef} tabIndex={-1}>
        المكتبة
      </h1>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={() => setUploadOpen(true)}>
          رفع صورة
        </button>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="media-folder-filter">
            تصفية بالمجلد
          </label>
          <select
            id="media-folder-filter"
            className={styles.input}
            value={selectedFolder ?? ''}
            onChange={(event) => setSelectedFolder(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">الكل</option>
            <option value={ROOT_OPTION}>بلا مجلد</option>
            {folders
              .filter((folder) => folder !== '')
              .map((folder) => (
                <option key={folder} value={folder}>
                  {folderLabel(folder)}
                </option>
              ))}
          </select>
        </div>
        <p role="status" className={styles.message}>
          {libraryMessage}
        </p>
      </div>
      {folderError && (
        <p role="alert" className={styles.error}>
          تعذّر تحميل المجلدات.
        </p>
      )}
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>إعادة تسمية المجلد</legend>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="media-rename-from">
            المجلد الحالي
          </label>
          <select
            id="media-rename-from"
            className={styles.input}
            value={renameFrom}
            onChange={(event) => setRenameFrom(event.target.value)}
          >
            <option value="">اختر مجلدًا</option>
            {folders
              .filter((folder) => folder !== '')
              .map((folder) => (
                <option key={folder} value={folder}>
                  {folderLabel(folder)}
                </option>
              ))}
          </select>
        </div>
        <div className={styles.row}>
          <label className={styles.label} htmlFor="media-rename-to">
            الاسم الجديد للمجلد
          </label>
          <input
            id="media-rename-to"
            className={styles.input}
            type="text"
            value={renameTo}
            onChange={(event) => setRenameTo(event.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={renaming || renameFrom === '' || renameTo.trim() === ''}
            onClick={() => void renameFolder()}
          >
            إعادة تسمية المجلد
          </button>
          <p role="status" className={styles.message}>
            {renameMessage}
          </p>
        </div>
      </fieldset>
      <div className={styles.mediaLayout}>
        {selected && (
          <section ref={detailsRef} className={styles.fieldset} aria-label="تفاصيل الصورة">
            <h2 ref={detailsHeadingRef} tabIndex={-1}>
              {selected.name}
            </h2>
            {mediaFields.map((field) => (
              <div key={field.name} className={styles.field}>
                <FieldInput
                  field={field}
                  value={values[field.name]}
                  onChange={(value) =>
                    setValues((previous) => ({ ...previous, [field.name]: typeof value === 'string' ? value : '' }))
                  }
                  id={`media-edit-${field.name}`}
                />
                {fieldErrors[field.name] && (
                  <p role="alert" className={styles.error}>
                    {fieldErrors[field.name]}
                  </p>
                )}
              </div>
            ))}
            <div className={styles.row}>
              <button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>
                حفظ
              </button>
              <p role="status" className={styles.message}>
                {saveMessage}
              </p>
            </div>
            <p className={styles.message}>
              الأصل: {selected.original_width}×{selected.original_height} بكسل، {formatBytes(selected.original_bytes)}،{' '}
              {selected.original_mime}. المشتقات:
            </p>
            <ul className={styles.metaList}>
              {selected.derivatives.map((derivative) => (
                <li key={derivative.key}>
                  {derivative.width}×{derivative.height}
                  {derivative.bytes ? `، ${formatBytes(derivative.bytes)}` : ''}
                </li>
              ))}
            </ul>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>مستخدمة في</legend>
              {usedIn?.error && <p className={styles.error}>تعذّر معرفة الاستخدام؛ الخادم يمنع حذف المستخدمة.</p>}
              {!usedIn?.error && usedIn?.rows && usedIn.rows.length + usedIn.products.length === 0 && (
                <p className={styles.message}>غير مستخدمة</p>
              )}
              {usedIn?.rows?.map((row) => (
                <div key={`${row.collection}-${row.doc_id}-${row.state}`} className={styles.row}>
                  <Link href={documentHref(row.collection, row.doc_id)}>{whereUsedLabel(row)}</Link>
                  <span className={styles.badge}>{STATE_LABELS[row.state] ?? row.state}</span>
                </div>
              ))}
              {usedIn?.products.map((product) => (
                <div key={`product-${product.product_id}`} className={styles.row}>
                  <Link href={`/admin/store/products/edit?id=${product.product_id}`}>{product.title}</Link>
                  <span className={styles.badge}>{PRODUCT_STATUS_LABELS[product.status] ?? product.status}</span>
                </div>
              ))}
            </fieldset>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={!usedIn || usedIn.error || (usedIn.rows?.length ?? 0) + usedIn.products.length > 0}
              onClick={() => {
                setDeleteError(null)
                setDeleteOpen(true)
              }}
            >
              حذف
            </button>
          </section>
        )}
        <MediaBrowser
          folder={selectedFolder === null ? null : selectedFolder === ROOT_OPTION ? '' : selectedFolder}
          reloadToken={reloadToken}
          selectedId={selected?.id ?? null}
          onSelect={select}
        />
      </div>
      {accessToken && (
        <MediaUpload
          open={uploadOpen}
          folder={selectedFolder === null || selectedFolder === ROOT_OPTION ? '' : selectedFolder}
          onClose={() => setUploadOpen(false)}
          onUploaded={(id) => void handleUploaded(id)}
        />
      )}
      <dialog ref={deleteDialogRef} className={styles.dialog} aria-labelledby={deleteTitleId} onClose={() => setDeleteOpen(false)}>
        <h2 id={deleteTitleId}>حذف الصورة</h2>
        <p>سيحذف الأصل الخاص وكل المشتقات، ولن يمكن التراجع.</p>
        {deleteError && (
          <p role="alert" className={styles.error}>
            {deleteError}
          </p>
        )}
        <div className={styles.row}>
          <button type="button" className={styles.button} disabled={deleting} onClick={() => void confirmDelete()}>
            تأكيد الحذف
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={deleting}
            onClick={() => setDeleteOpen(false)}
          >
            إلغاء
          </button>
        </div>
      </dialog>
    </div>
  )
}
