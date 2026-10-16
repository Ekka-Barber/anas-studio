'use client'

/**
 * «نقل إلى…» (P12 round R2): the way to move a card that needs no drag, at every width. One native `<dialog>`: the
 * project's columns (the card's own is chosen to begin with), then the positions of the chosen one, «الموضع n من m»;
 * a position moves the card there. `Modal` is the native dialog every dialog of the board uses: it opens when it is
 * mounted, closes by its own button or Escape, and says so through `onClose`, which unmounts it.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'

import { menuPositions, positionText, type BoardCard } from '@/lib/projects'

import admin from '../admin.module.css'
import styles from './projects.module.css'

interface ModalProps {
  labelledBy: string
  className?: string
  onClose: () => void
  /** The dialog's content; `close` shuts the dialog (then `onClose` runs). */
  children: (close: () => void) => ReactNode
}

export function Modal({ labelledBy, className, onClose, children }: ModalProps) {
  // The element is kept in state, not in a ref, so that `close` can be handed to the content while it renders.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)
  const close = useCallback(() => dialog?.close(), [dialog])
  useEffect(() => {
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [dialog])
  return (
    <dialog ref={setDialog} className={className === undefined ? admin.dialog : `${admin.dialog} ${className}`} aria-labelledby={labelledBy} onClose={onClose}>
      {children(close)}
    </dialog>
  )
}

interface MoveMenuProps {
  card: BoardCard
  /** Every column the board shows, with the open cards it holds (the whole list, not what a filter shows). */
  columns: ReadonlyArray<{ id: string; name: string; count: number }>
  onChoose: (columnId: string, position: number) => void
  onClose: () => void
}

export function MoveMenu({ card, columns, onChoose, onClose }: MoveMenuProps) {
  const id = useId()
  const [chosen, setChosen] = useState(card.columnId)
  const column = columns.find((entry) => entry.id === chosen) ?? columns[0]
  const total = column === undefined ? 0 : menuPositions(column.count, column.id === card.columnId)
  return (
    <Modal labelledBy={`${id}-title`} className={styles.menuDialog} onClose={onClose}>
      {(close) => (
        <>
          <h2 id={`${id}-title`}>نقل إلى…</h2>
          <div className={styles.cardForm}>
            <div className={styles.menuColumns} role="group" aria-labelledby={`${id}-title`}>
              {columns.map((entry) => (
                <button key={entry.id} type="button" className={admin.toolbarButton} aria-pressed={entry.id === chosen} onClick={() => setChosen(entry.id)}>
                  {entry.name}
                </button>
              ))}
            </div>
            <ol className={styles.menuPositions}>
              {Array.from({ length: total }, (_, index) => index + 1).map((position) => (
                <li key={position}>
                  <button
                    type="button"
                    className={admin.buttonSecondary}
                    aria-current={column?.id === card.columnId && position === card.position ? 'true' : undefined}
                    onClick={() => {
                      onChoose(chosen, position)
                      close()
                    }}
                  >
                    {positionText(position, total)}
                  </button>
                </li>
              ))}
            </ol>
            <div className={styles.dialogActions}>
              <button type="button" className={admin.buttonSecondary} onClick={close}>
                إغلاق
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
