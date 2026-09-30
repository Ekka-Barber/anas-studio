'use client'

import { useEffect, useId, useRef } from 'react'

import { MediaBrowser, type MediaRow } from './MediaLibrary'
import styles from './admin.module.css'

/**
 * «اختر من المكتبة»: a native dialog over the same library browser the
 * media screen uses (search and paging included). Choosing a tile hands the
 * media id back to the field.
 */
export function MediaPicker({
  open,
  onClose,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  onChoose: (id: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function choose(row: MediaRow) {
    onChoose(row.id)
    onClose()
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>اختيار من المكتبة</h2>
      {/* Mounted only while open: a closed picker must not query the library, and reopening shows fresh rows. */}
      {open && <MediaBrowser folder={null} reloadToken={0} onSelect={choose} />}
      <div className={styles.row}>
        <button type="button" className={styles.buttonSecondary} onClick={onClose}>
          إغلاق
        </button>
      </div>
    </dialog>
  )
}
