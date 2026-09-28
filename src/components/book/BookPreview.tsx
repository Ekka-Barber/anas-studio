'use client'

import { useState, useSyncExternalStore, type ComponentType } from 'react'

import { PREVIEW_URL } from '@/lib/book-preview'
import type { ImageSources } from '@/lib/images'

import { ClosedBook, Opening } from './ClosedBook'
import styles from './reader.module.css'

type Reader = ComponentType<{ cover: ImageSources; startPage?: number }>

const noSubscribe = () => () => {}

/**
 * The closed book on the book page, and the way in. Without JavaScript the
 * button, and each part under it, link to the preview PDF itself (at that
 * page). With it, «افتح الكتاب» (or a part) loads the reader, whose pdf.js
 * and page-flip come only then in their own chunk, and opens the book in
 * place: the closed book, the loading state and the open book all stand on
 * the same stage. A failed load says so and can be retried.
 */
export function BookPreview({ cover }: { cover: ImageSources }) {
  const scripted = useSyncExternalStore(noSubscribe, () => true, () => false)
  const [reader, setReader] = useState<{ Reader: Reader; startPage?: number } | null>(null)
  const [state, setState] = useState<'closed' | 'loading' | 'failed'>('closed')

  function open(startPage?: number) {
    setState('loading')
    import('./PdfBookReader').then(
      (module) => setReader({ Reader: module.default, startPage }),
      () => setState('failed'),
    )
  }

  if (reader) return <reader.Reader cover={cover} startPage={reader.startPage} />

  return (
    <div className={styles.reader}>
      <ClosedBook cover={cover} />
      <div className={styles.controls}>
        <Opening onOpen={scripted ? open : undefined} loading={state === 'loading'} />
        {state === 'failed' && (
          <p role="alert" className={styles.closedNote}>
            تعذّر تحميل القارئ. أعد المحاولة، أو <a href={PREVIEW_URL}>افتح الصفحات ملفاً (PDF)</a>.
          </p>
        )}
      </div>
    </div>
  )
}
