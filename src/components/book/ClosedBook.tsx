import { ActionButton, ActionLink } from '@/components/weave/Action'
import { PARTS, PREVIEW_URL } from '@/lib/book-preview'
import type { ImageSources } from '@/lib/images'

import styles from './reader.module.css'

/**
 * The closed book on the reader's stage: cover B at the book's own 4:5,
 * standing exactly where the open book will lie, so opening it never moves
 * the page. Shared by the closed state and the loading state.
 */
export function ClosedBook({ cover }: { cover: ImageSources }) {
  return (
    <div className={styles.book}>
      <div className={styles.closedBook}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15); the srcset comes from the manifest */}
        <img
          src={cover.src}
          srcSet={cover.srcSet}
          sizes="(min-width: 1024px) 560px, 80vw"
          width={cover.width}
          height={cover.height}
          alt="غلاف خوص"
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
  )
}

/**
 * The way in, under the closed book: «افتح الكتاب» and «ابدأ من» with the
 * book's parts. Without JavaScript (`onOpen` absent) they are links to the
 * preview PDF, at their page. While the reader loads they stay in place,
 * disabled, so the stage keeps its height.
 */
export function Opening({ onOpen, loading = false }: { onOpen?: (startPage?: number) => void; loading?: boolean }) {
  return (
    <div className={styles.opening}>
      {onOpen ? (
        <ActionButton onClick={() => onOpen()} disabled={loading}>
          {loading ? 'جارٍ فتح الكتاب…' : 'افتح الكتاب'}
        </ActionButton>
      ) : (
        <ActionLink href={PREVIEW_URL}>افتح الصفحات (PDF)</ActionLink>
      )}
      <p className={styles.parts}>
        <span>ابدأ من</span>
        {PARTS.map((part) =>
          onOpen ? (
            <button key={part.page} type="button" className={styles.tool} onClick={() => onOpen(part.page)} disabled={loading}>
              {part.label}
            </button>
          ) : (
            <a key={part.page} href={`${PREVIEW_URL}#page=${part.page}`} className={styles.tool}>
              {part.label}
            </a>
          ),
        )}
      </p>
    </div>
  )
}
