'use client'

import { useEffect, useRef, useState } from 'react'

import { Picture } from './Picture'
import styles from './public.module.css'

/**
 * Thumbnail grid plus a native `<dialog>` lightbox: a real focus trap and
 * Escape-to-close for free, and focus returns to the thumbnail button that
 * opened it once the dialog closes (the browser's default behaviour, since
 * that button held focus when `showModal()` was called).
 */
export function Gallery({ photos, roomImagesSizes }: { photos: { id: string; alt: string }[]; roomImagesSizes: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const onClose = () => setIndex(null)
    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [])

  function openAt(i: number) {
    setIndex(i)
    dialogRef.current?.showModal()
  }

  function step(delta: number) {
    setIndex((current) => {
      if (current === null) return current
      return (current + delta + photos.length) % photos.length
    })
  }

  function onDialogKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'ArrowRight') step(1)
    else if (event.key === 'ArrowLeft') step(-1)
  }

  const current = index === null ? null : photos[index]

  return (
    <>
      <ul className={styles.galleryGrid}>
        {photos.map((photo, i) => (
          <li key={photo.id}>
            <button type="button" className={styles.galleryThumb} onClick={() => openAt(i)}>
              <Picture id={photo.id} alt={photo.alt} sizes={roomImagesSizes} />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className={styles.lightbox}
        aria-label="معرض الصور"
        onKeyDown={onDialogKeyDown}
      >
        {current && (
          <div className={styles.lightboxInner}>
            <div className={styles.lightboxTop}>
              <span className={styles.lightboxCount}>
                {index !== null ? index + 1 : 0} / {photos.length}
              </span>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="إغلاق"
                onClick={() => dialogRef.current?.close()}
              >
                ×
              </button>
            </div>
            <Picture id={current.id} alt={current.alt} sizes="90vw" className={styles.lightboxImage} loading="eager" />
            <p className={styles.lightboxCaption}>{current.alt}</p>
            <div className={styles.lightboxNav}>
              <button type="button" onClick={() => step(-1)}>
                السابق
              </button>
              <button type="button" onClick={() => step(1)}>
                التالي
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
