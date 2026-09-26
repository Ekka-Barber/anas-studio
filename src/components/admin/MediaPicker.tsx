'use client'

import { useEffect, useRef } from 'react'

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
    <dialog ref={dialogRef} className={styles.dialogWide} onClose={onClose}>
      <h2>اختيار من المكتبة</h2>
      <MediaBrowser folder={null} reloadToken={0} onSelect={choose} />
      <div className={styles.row}>
        <button type="button" className={styles.buttonSecondary} onClick={onClose}>
          إغلاق
        </button>
      </div>
    </dialog>
  )
}
