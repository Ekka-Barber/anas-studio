'use client'

/**
 * A card of the projects board (P12 round R2): what it shows (`CardFace`), the card that can be lifted (`SortableCard`)
 * and the card as it is carried (`LiftedCard`). The face is the one thing pressed, held and lifted: a mouse press held
 * for 250 ms, a touch held the same, Space from the keyboard; a plain click or Enter opens the card. «نقل إلى…» is the
 * face's sibling, never inside it, so no control sits inside another control and a screen reader reads each once.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useSyncExternalStore, type KeyboardEvent } from 'react'

import {
  checklistText,
  doneText,
  dueLabel,
  initialOf,
  PRIORITY_LABELS,
  UNPUBLISHED,
  type BoardCard,
  type BoardLabel,
  type ProjectPerson,
} from '@/lib/projects'

import styles from './projects.module.css'

const REDUCED = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Whether the visitor asked for no motion: nothing of a drag animates then. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  )
}

/** Puts the keyboard focus on a card's face (a card is found by its id, which is a uuid). */
export function focusCard(id: string): void {
  document.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus()
}

export interface FaceContext {
  labels: ReadonlyMap<string, BoardLabel>
  people: ReadonlyMap<string, ProjectPerson>
  today: string
}

/** A card's face: title, priority and due day, label tags, the link, the checklist's count and the people's marks. */
export function CardFace({ card, context, inDone }: { card: BoardCard; context: FaceContext; inDone: boolean }) {
  const due = inDone ? null : dueLabel(card.dueOn, context.today)
  const labels = card.labels.flatMap((id) => context.labels.get(id) ?? [])
  const people = card.people.flatMap((id) => context.people.get(id) ?? [])
  const checklist = checklistText(card)
  const meta = card.priority !== 'normal' || due !== null
  return (
    <>
      <p className={styles.cardTitle}>{card.title}</p>
      {inDone && card.doneAt !== null && <p className={`${styles.cardMeta} ${styles.muted}`}>{doneText(card.doneAt, context.today)}</p>}
      {!inDone && meta && (
        <p className={styles.cardMeta}>
          {card.priority === 'urgent' && <span className={styles.urgent}>{PRIORITY_LABELS.urgent}</span>}
          {card.priority === 'low' && <span className={styles.low}>{PRIORITY_LABELS.low}</span>}
          {due !== null && <span className={`${styles.due} ${styles[due.tone]}`}>{due.text}</span>}
        </p>
      )}
      {labels.length > 0 && (
        <ul className={styles.tags}>
          {labels.map((label) => (
            <li key={label.id} className={`${styles.tag} ${styles[label.tone]}`}>
              {label.name}
            </li>
          ))}
        </ul>
      )}
      {card.link !== null && <p className={styles.linked}>{card.link.title === null ? UNPUBLISHED : `مرتبطة بـ «${card.link.title}»`}</p>}
      {(checklist !== null || people.length > 0) && (
        <p className={styles.cardFoot}>
          <span>{checklist}</span>
          <span className={styles.whos}>
            {people.map((person) => (
              <span key={person.id} role="img" aria-label={person.name} className={person.role === 'owner' ? styles.who : `${styles.who} ${styles.whoSecond}`}>
                {initialOf(person.name)}
              </span>
            ))}
          </span>
        </p>
      )}
    </>
  )
}

interface SortableCardProps {
  card: BoardCard
  context: FaceContext
  inDone: boolean
  /** An owner or a member: the card can be lifted and «نقل إلى…» is offered. */
  canMove: boolean
  /** A move is in flight: no card is lifted until it ends. */
  busy: boolean
  /** The visitor asked for no motion: nothing of the lift animates (read once by the board, not by every card). */
  reduced: boolean
  onOpen: (cardId: string) => void
  onMove: (cardId: string) => void
}

/** A card in its column: lifted by mouse, touch or keyboard, opened by a click or Enter. */
export function SortableCard({ card, context, inDone, canMove, busy, reduced, onOpen, onMove }: SortableCardProps) {
  const liftable = canMove && !busy
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, active } = useSortable({
    id: card.id,
    disabled: !liftable,
    attributes: { roleDescription: 'بطاقة' },
    ...(reduced ? { transition: null, animateLayoutChanges: () => false } : {}),
  })
  // Enter opens the card (Space belongs to the lift); nothing opens while a card is being carried. The key is taken here:
  // left alone, its keypress would reach the dialog's first field, whose form it would submit, and the dialog would close.
  // A card that cannot be lifted (a viewer's, or any while a move is in flight) opens with Space too, as a button does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const own = event.target === event.currentTarget
    // A card the page was scrolled away from is brought back at once before it is lifted: dnd-kit would scroll to it
    // itself, smoothly on this page, and measure the board while it moved.
    if (liftable && event.code === 'Space' && own) event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    listeners?.onKeyDown?.(event)
    if (own && active === null && (event.key === 'Enter' || (!liftable && event.code === 'Space'))) {
      event.preventDefault()
      onOpen(card.id)
    }
  }
  return (
    <li
      ref={setNodeRef}
      className={styles.slip}
      style={{ transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition }}
      data-dragging={isDragging ? '' : undefined}
    >
      <div
        ref={canMove ? setActivatorNodeRef : undefined}
        {...(canMove ? { ...attributes, ...listeners } : { role: 'button', tabIndex: 0, 'aria-roledescription': 'بطاقة' })}
        aria-pressed={undefined}
        // While a move is in flight the card cannot be lifted but still opens: it is not a disabled control.
        aria-disabled={undefined}
        className={styles.face}
        data-card={card.id}
        onClick={() => onOpen(card.id)}
        onKeyDown={onKeyDown}
      >
        <CardFace card={card} context={context} inDone={inDone} />
      </div>
      {isDragging && (
        <span className={styles.slotText} aria-hidden="true">
          تُفلت البطاقة هنا
        </span>
      )}
      {canMove && (
        <button type="button" className={styles.moveTo} aria-label={`نقل إلى… «${card.title}»`} disabled={busy} onClick={() => onMove(card.id)}>
          نقل إلى…
        </button>
      )}
    </li>
  )
}

/** The card as it is carried: the site's solid ink shadow over the dashed place it will land. */
export function LiftedCard({ card, context, inDone }: { card: BoardCard; context: FaceContext; inDone: boolean }) {
  return (
    <div className={`${styles.slip} ${styles.lifted}`}>
      <div className={styles.face}>
        <CardFace card={card} context={context} inDone={inDone} />
      </div>
    </div>
  )
}
