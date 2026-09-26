'use client'

/**
 * The admin's draft preview of one room (P04 part 2, D32). The public site is
 * static and shows only published content, so the preview lives here: it
 * reads the room's latest saved version through RLS as the signed-in staff
 * member, validates it with the room's schema, resolves library images and
 * renders the same view component the public page uses. Nothing public
 * changes.
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { builtRoomSchema, passedRoomSchema, shelfRoomSchema, startedRoomSchema } from '@/admin/collections'
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
import { collectMediaIds, MEDIA_ORIGIN } from '@/lib/media-ref'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { documentHref } from '@/lib/supabase/functions'

import styles from './admin.module.css'

/** Each previewable room: how to validate its draft and how to draw it. */
const ROOMS: Record<string, (data: unknown) => ReactNode | null> = {
  started: (data) => {
    const parsed = startedRoomSchema.safeParse(data)
    return parsed.success ? <StartedRoomView room={shapeStartedRoom(parsed.data)} /> : null
  },
  built: (data) => {
    const parsed = builtRoomSchema.safeParse(data)
    return parsed.success ? <BuiltRoomView room={shapeBuiltRoom(parsed.data)} /> : null
  },
  passed: (data) => {
    const parsed = passedRoomSchema.safeParse(data)
    return parsed.success ? <PassedRoomView room={shapePassedRoom(parsed.data)} /> : null
  },
  shelf: (data) => {
    const parsed = shelfRoomSchema.safeParse(data)
    return parsed.success ? <ShelfRoomView room={parsed.data} /> : null
  },
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; seq: number; data: unknown }

export function RoomPreview() {
  const id = useSearchParams().get('id') ?? ''
  const render = ROOMS[id]
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!render) return
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
        .eq('collection', 'rooms')
        .eq('doc_id', id)
        .order('seq', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!active) return
      if (version.error || !version.data) {
        setState({ status: 'error', message: 'لا توجد مسودة متاحة لك.' })
        return
      }
      let data: unknown = version.data.data
      const ids = collectMediaIds(data)
      if (ids.length > 0) {
        const media = await supabase.from('media').select('id, derivatives').in('id', ids)
        if (!active) return
        if (media.error) {
          setState({ status: 'error', message: 'تعذّر تحميل صور المكتبة.' })
          return
        }
        const byId = new Map(
          (media.data as Array<{ id: string; derivatives: MediaDerivative[] }>).map((row) => [row.id, row.derivatives]),
        )
        data = replaceMediaIds(data, byId, MEDIA_ORIGIN)
      }
      setState({ status: 'ok', seq: version.data.seq as number, data })
    })()
    return () => {
      active = false
    }
  }, [id, render])

  if (!render) return <p className={styles.error}>لا معاينة لهذا المستند.</p>
  if (state.status === 'loading') return <p className={styles.message}>يحمّل...</p>
  if (state.status === 'error') return <p className={styles.error}>{state.message}</p>

  const view = render(state.data)
  return (
    <>
      <p className={styles.message} role="status">
        معاينة المسودة (نسخة {state.seq}) — لم تُنشر بعد.{' '}
        <Link href={documentHref('rooms', id)}>العودة للتحرير</Link>
      </p>
      {view ?? <p className={styles.error}>المسودة غير صالحة؛ صحّح الحقول ثم احفظ.</p>}
    </>
  )
}
