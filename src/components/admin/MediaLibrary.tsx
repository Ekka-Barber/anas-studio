'use client'

/**
 * The media library screen (P05 round 2): folders, a searchable paged grid,
 * an edit panel over `mediaFields`, the where-used guard and deletion, and
 * the upload dialog. Reads and edits the `media` table through the browser
 * Supabase client as the signed-in owner/editor (RLS and the column grants
 * are the real enforcement); deletion goes through the `deleteMediaAction`
 * server action, which calls `media_delete` as `app_server`.
 *
 * `MediaBrowser` (the grid with search and paging) is exported for
 * `MediaPicker` — the same browser inside content forms' picker dialog.
 */
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { COLLECTION_LABELS, ROOM_DOC_LABELS } from '@/admin/collections'
import { mediaFields, mediaMetaSchema } from '@/admin/collections/media'
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

const MEDIA_COLUMNS =
  'id,name,folder,alt_ar,caption,rights,original_bytes,original_width,original_height,original_mime,derivatives,created_at'
const PAGE_SIZE = 40
/** Select-option sentinel for the root folder (whose real value is ''). */
const ROOT_OPTION = '__root__'

const STATE_LABELS: Record<string, string> = { live: 'منشورة', draft: 'مسودة', scheduled: 'مجدولة' }

/** `أ/ب` displays as «أ / ب»; the value stays the raw path. */
function folderLabel(folder: string): string {
  return folder.split('/').join(' / ')
}

function whereUsedLabel(row: WhereUsedRow): string {
  if (row.collection === 'rooms') {
    const label = ROOM_DOC_LABELS[row.doc_id as keyof typeof ROOM_DOC_LABELS]
    if (label) return label
  }
  if (row.collection === 'site_settings') return COLLECTION_LABELS.site_settings
  return row.doc_id
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
            if (active) setLoading(false)
          })
      },
      search ? 300 : 0,
    )
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [search, folder, reloadToken])

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
              aria-pressed={selectedId === row.id}
              onClick={() => onSelect(row)}
            >
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
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={() => {
            void loadMediaPage(folder, search, rows.length).then((page) => {
              setRows((previous) => [...previous, ...page])
              setMore(page.length === PAGE_SIZE)
            })
          }}
        >
          المزيد
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
  const [usedInState, setUsedInState] = useState<{ id: string; rows: WhereUsedRow[] | null; error: boolean } | null>(
    null,
  )
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [renameMessage, setRenameMessage] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const detailsRef = useRef<HTMLElement>(null)
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null)
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

  useEffect(() => {
    // ponytail: the Data API has no DISTINCT; read only the folder column of
    // every row (RLS already scopes it to owner/editor) and dedupe here.
    void getSupabaseBrowserClient()
      .from('media')
      .select('folder')
      .order('folder')
      .limit(10000)
      .then(({ data }) => {
        const distinct = new Set<string>(((data ?? []) as unknown as Array<{ folder: string }>).map((row) => row.folder))
        setFolders([...distinct])
      })
  }, [reloadToken])

  // The where-used list for the selected item only; a fetch result for a
  // different id is ignored, so switching selections never shows stale rows.
  const usedIn = selected && usedInState?.id === selected.id ? usedInState : null

  useEffect(() => {
    if (!selected) return
    let active = true
    void getSupabaseBrowserClient()
      .rpc('media_where_used', { p_id: selected.id })
      .then(({ data, error }) => {
        if (!active) return
        setUsedInState({ id: selected.id, rows: error ? null : ((data ?? []) as unknown as WhereUsedRow[]), error: Boolean(error) })
      })
    return () => {
      active = false
    }
  }, [selected, reloadToken])

  function select(row: MediaRow) {
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
    const { error } = await getSupabaseBrowserClient()
      .from('media')
      .update({
        name: parsed.data.name,
        alt_ar: parsed.data.altAr,
        caption: parsed.data.caption ? parsed.data.caption : null,
        rights: parsed.data.rights,
        folder: parsed.data.folder,
      })
      .eq('id', selected.id)
    setSaving(false)
    if (error) {
      setSaveMessage('تعذّر الحفظ.')
      return
    }
    setSaveMessage('حُفظ')
    const patch: Partial<MediaRow> = {
      name: parsed.data.name,
      alt_ar: parsed.data.altAr,
      caption: parsed.data.caption ?? null,
      rights: parsed.data.rights,
      folder: parsed.data.folder,
    }
    setSelected({ ...selected, ...patch })
    setValues((previous) => ({ ...previous, folder: parsed.data.folder, name: parsed.data.name }))
    setReloadToken((token) => token + 1)
  }

  async function renameFolder() {
    const to = renameTo.trim()
    if (renameFrom === '' || to === '' || folderIsInvalid(to)) {
      setRenameMessage('مسار مجلد جديد غير صالح.')
      return
    }
    const { data, error } = await getSupabaseBrowserClient().rpc('media_rename_folder', {
      p_from: renameFrom,
      p_to: to,
    })
    if (error || typeof data !== 'number') {
      setRenameMessage('تعذّرت إعادة تسمية المجلد.')
      return
    }
    setRenameMessage(data > 0 ? `نُقلت ${data} صورة إلى «${folderLabel(to)}».` : 'لا توجد صور في هذا المجلد.')
    if (selectedFolder === renameFrom) setSelectedFolder(to)
    setRenameFrom('')
    setRenameTo('')
    setReloadToken((token) => token + 1)
  }

  async function confirmDelete() {
    if (!selected || !accessToken) return
    setDeleting(true)
    setDeleteError(null)
    const result = await callFunction<{ id: string }>('admin', { action: 'media-delete', id: selected.id })
    setDeleting(false)
    if (!result.ok) {
      setDeleteError(result.error.message)
      return
    }
    setDeleteError(null)
    setDeleteOpen(false)
    setSelected(null)
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
      <h1>المكتبة</h1>
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
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folderLabel(folder)}
              </option>
            ))}
          </select>
        </div>
      </div>
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
            disabled={renameFrom === '' || renameTo.trim() === ''}
            onClick={() => void renameFolder()}
          >
            إعادة تسمية المجلد
          </button>
          {renameMessage && <p className={styles.message}>{renameMessage}</p>}
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
                {fieldErrors[field.name] && <p className={styles.error}>{fieldErrors[field.name]}</p>}
              </div>
            ))}
            <div className={styles.row}>
              <button type="button" className={styles.button} disabled={saving} onClick={() => void save()}>
                حفظ
              </button>
              {saveMessage && <p className={styles.message}>{saveMessage}</p>}
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
              {!usedIn?.error && usedIn?.rows && usedIn.rows.length === 0 && <p className={styles.message}>غير مستخدمة</p>}
              {usedIn?.rows?.map((row) => (
                <div key={`${row.collection}-${row.doc_id}-${row.state}`} className={styles.row}>
                  <Link href={documentHref(row.collection, row.doc_id)}>{whereUsedLabel(row)}</Link>
                  <span className={styles.badge}>{STATE_LABELS[row.state] ?? row.state}</span>
                </div>
              ))}
            </fieldset>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={!usedIn || (usedIn.rows?.length ?? 0) > 0}
              onClick={() => setDeleteOpen(true)}
            >
              حذف
            </button>
          </section>
        )}
        <MediaBrowser
          folder={selectedFolder === null ? null : selectedFolder === ROOT_OPTION ? '' : selectedFolder}
          reloadToken={reloadToken}
          selectedId={selected?.id}
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
      <dialog ref={deleteDialogRef} className={styles.dialog} onClose={() => setDeleteOpen(false)}>
        <h2>حذف الصورة</h2>
        <p>سيحذف الأصل الخاص وكل المشتقات، ولن يمكن التراجع.</p>
        {deleteError && <p className={styles.error}>{deleteError}</p>}
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
