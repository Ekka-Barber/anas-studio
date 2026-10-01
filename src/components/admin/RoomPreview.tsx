'use client'

/**
 * The admin's draft preview of one room or one journal post (P04 part 2, D32).
 * The public site is static and shows only published content, so the preview
 * lives here: it reads the latest saved version through RLS as the signed-in
 * staff member, validates it with the document's schema, resolves library
 * images and renders the same view component the public page uses. Nothing
 * public changes.
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import type { z } from 'zod'

import {
  bookRoomSchema,
  builtRoomSchema,
  passedRoomSchema,
  postSchema,
  shelfRoomSchema,
  SITE_SETTINGS_DOC_ID,
  startedRoomSchema,
  taxonomySchema,
} from '@/admin/collections'
import { BookView } from '@/components/public/book/BookView'
import { PostView } from '@/components/public/journal/PostView'
import { BuiltRoomView } from '@/components/public/rooms/BuiltRoomView'
import { PassedRoomView } from '@/components/public/rooms/PassedRoomView'
import { ShelfRoomView } from '@/components/public/rooms/ShelfRoomView'
import { StartedRoomView } from '@/components/public/rooms/StartedRoomView'
import {
  replaceMediaIds,
  shapeBuiltRoom,
  shapePassedRoom,
  shapeStartedRoom,
  type MediaDerivative,
} from '@/lib/content'
import { selectMediaRows } from '@/lib/admin-publish'
import { shapePost } from '@/lib/journal'
import { collectMediaIds, MEDIA_ORIGIN } from '@/lib/media-ref'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { documentHref } from '@/lib/supabase/functions'

import styles from './admin.module.css'

/**
 * A previewable document: the schema its draft must satisfy, and how to draw
 * the validated draft. As on the public site, the draft is validated first and
 * its library images are resolved afterwards (a resolved reference is no image
 * id, so it would fail the schema). `labels` maps category slugs to their
 * names; only posts use it.
 */
interface Preview {
  schema: z.ZodTypeAny
  draw: (data: unknown, labels: Map<string, string>, journalName: string) => ReactNode
}

function preview<T>(
  schema: z.ZodType<T>,
  draw: (data: T, labels: Map<string, string>, journalName: string) => ReactNode,
): Preview {
  return { schema, draw: (data, labels, journalName) => draw(data as T, labels, journalName) }
}

/** The journal's name as the site shows it (`getJournalName`): its menu label, «المجلس» while blank. */
const JOURNAL_NAME = 'المجلس'

const ROOMS: Record<string, Preview> = {
  started: preview(startedRoomSchema, (room) => <StartedRoomView room={shapeStartedRoom(room)} />),
  built: preview(builtRoomSchema, (room) => <BuiltRoomView room={shapeBuiltRoom(room)} />),
  passed: preview(passedRoomSchema, (room) => <PassedRoomView room={shapePassedRoom(room)} />),
  shelf: preview(shelfRoomSchema, (room) => <ShelfRoomView room={room} />),
  book: preview(bookRoomSchema, (book, _labels, journalName) => <BookView book={book} journalName={journalName} />),
}

const POST: Preview = preview(postSchema, (post, labels, journalName) => (
  // The cover is resolved with the rest of the draft, so no media is left to
  // look up; a draft has no publication date, and the view shows none.
  <PostView post={shapePost(post, { id: '', publishedAt: '' }, labels, new Map())} journalName={journalName} />
))

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'invalid'; seq: number; liveSeq: number | null }
  | { status: 'ok'; seq: number; liveSeq: number | null; data: unknown; labels: Map<string, string>; journalName: string }

/** What the banner says about the previewed version, against the one that is live. */
function previewNote(seq: number, liveSeq: number | null): string {
  if (liveSeq === seq) return `معاينة النسخة المنشورة (نسخة ${seq}).`
  if (liveSeq === null) return `معاينة المسودة (نسخة ${seq}). لم تُنشر بعد.`
  return `معاينة المسودة (نسخة ${seq}). فيها تعديلات غير منشورة؛ المنشور حاليًا نسخة ${liveSeq}.`
}

export function RoomPreview() {
  const params = useSearchParams()
  const collection = params.get('collection') === 'posts' ? 'posts' : 'rooms'
  const id = params.get('id') ?? ''
  const entry = collection === 'posts' ? POST : Object.hasOwn(ROOMS, id) ? ROOMS[id] : undefined
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!entry) return
    let active = true
    void (async () => {
      const supabase = getSupabaseBrowserClient()
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        if (active) setState({ status: 'error', message: 'سجّل الدخول أولًا.' })
        return
      }
      const version = await supabase
        .from('content_versions')
        .select('seq, data')
        .eq('collection', collection)
        .eq('doc_id', id)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!active) return
      if (version.error || !version.data) {
        setState({ status: 'error', message: 'لا توجد مسودة متاحة لك.' })
        return
      }
      const seq = version.data.seq as number
      const published = await supabase
        .from('published_documents')
        .select('seq')
        .eq('collection', collection)
        .eq('doc_id', id)
        .maybeSingle()
      if (!active) return
      if (published.error) {
        setState({ status: 'error', message: 'تعذّر تحميل حالة النشر.' })
        return
      }
      const liveSeq = (published.data?.seq as number | undefined) ?? null
      const parsed = entry.schema.safeParse(version.data.data)
      if (!parsed.success) {
        setState({ status: 'invalid', seq, liveSeq })
        return
      }
      let data: unknown = parsed.data
      const ids = collectMediaIds(data)
      if (ids.length > 0) {
        const media = await selectMediaRows('id, derivatives, alt_ar', ids)
        if (!active) return
        if (media.error) {
          setState({ status: 'error', message: 'تعذّر تحميل صور المكتبة.' })
          return
        }
        // With the alt written at upload, as the build carries it (`mediaById`).
        const byId = new Map(
          (media.data as Array<{ id: string; derivatives: MediaDerivative[]; alt_ar: string }>).map((row) => [
            row.id,
            { derivatives: row.derivatives, alt: row.alt_ar },
          ]),
        )
        data = replaceMediaIds(data, byId, MEDIA_ORIGIN)
      }
      // A post's categories show their names, from the latest saved taxonomies.
      const labels = new Map<string, string>()
      let journalName = JOURNAL_NAME
      if (collection === 'posts') {
        // The crumb names the journal by its menu label, from the latest saved settings.
        const settings = await supabase
          .from('content_documents')
          .select('latest_data')
          .eq('collection', 'site_settings')
          .eq('doc_id', SITE_SETTINGS_DOC_ID)
          .maybeSingle()
        if (!active) return
        const nav = (settings.data?.latest_data as { nav?: Array<{ href?: unknown; label?: unknown }> } | undefined)?.nav
        const label = nav?.find((item) => item.href === '/journal')?.label
        if (typeof label === 'string' && label.trim() !== '') journalName = label.trim()
        const taxonomies = await supabase
          .from('content_documents')
          .select('doc_id, latest_data')
          .eq('collection', 'taxonomies')
        if (!active) return
        if (taxonomies.error) {
          setState({ status: 'error', message: 'تعذّر تحميل التصنيفات.' })
          return
        }
        for (const row of taxonomies.data as Array<{ doc_id: string; latest_data: unknown }>) {
          const taxonomy = taxonomySchema.safeParse(row.latest_data)
          if (taxonomy.success && taxonomy.data.kind === 'category') labels.set(row.doc_id, taxonomy.data.label)
        }
      }
      setState({ status: 'ok', seq, liveSeq, data, labels, journalName })
    })()
    return () => {
      active = false
    }
  }, [collection, id, entry])

  if (!entry) return <p className={styles.error}>لا معاينة لهذا المستند.</p>
  if (state.status === 'loading') return <p className={styles.message}>يحمّل...</p>
  if (state.status === 'error') return <p className={styles.error}>{state.message}</p>

  return (
    <>
      <p className={styles.previewNote} role="status">
        {previewNote(state.seq, state.liveSeq)}{' '}
        <Link href={documentHref(collection, id)}>العودة للتحرير</Link>
      </p>
      {state.status === 'ok' ? (
        // The public page's surface (D39): its sand, its tones and its text
        // resets, so the draft looks exactly as it will be published.
        <div data-surface="site" data-tone="sand">
          {entry.draw(state.data, state.labels, state.journalName)}
        </div>
      ) : (
        <p className={styles.error}>المسودة غير صالحة؛ صحّح الحقول ثم احفظ.</p>
      )}
    </>
  )
}
