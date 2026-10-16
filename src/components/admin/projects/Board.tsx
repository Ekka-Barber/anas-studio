'use client'

/*
 * The board's drag and drop (P12 round R2) is adapted from dnd-kit's own multi-column example, the story
 * `MultipleContainers.tsx` and its `multipleContainersKeyboardCoordinates.ts`
 * (https://github.com/clauderic/dnd-kit, stories/2 - Presets/Sortable/, read on 2026-10-16): the collision detection
 * that finds the card or the column under the pointer, the move of a lifted card into the column it passes over, the
 * layout kept apart from the database's until the drop and put back on a cancel, and the keyboard's coordinate getter.
 * Kept: those four. Left out: the story's trash, handles, virtualisation, sortable containers and its many options.
 * Added: the arrows in reading terms (`keyMove`), MouseSensor and TouchSensor held for 250 ms within 5 px, Space and
 * Escape as the only keys, the Arabic instructions and announcements, and `board_card_move` with the card's version.
 *
 * MIT License
 *
 * Copyright (c) 2021, Claudéric Demers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type Ref } from 'react'

import {
  cardsPhrase,
  checkText,
  columnItems,
  dropPosition,
  droppedText,
  EMPTY_COLUMN,
  EMPTY_SEARCH,
  hasFilters,
  keyMove,
  liftedText,
  matchesFilters,
  matchesSearch,
  MOVE_CANCELLED,
  MOVE_FAILED,
  MOVE_INSTRUCTIONS,
  neighbourColumn,
  overText,
  parseCard,
  parseColumn,
  parseMove,
  refusalText,
  SAVE_FAILED,
  applyMove,
  withCard,
  type BoardCall,
  type BoardCard,
  type BoardColumn,
  type BoardData,
  type Direction,
  type Filters,
  type Items,
  writeRefusalText,
} from '@/lib/projects'

import admin from '../admin.module.css'
import { LiftedCard, SortableCard, useReducedMotion, type FaceContext } from './BoardCard'
import { Modal, MoveMenu } from './MoveMenu'
import styles from './projects.module.css'

/** A touch or a mouse press is a lift only after 250 ms within 5 px, so a scroll is never a drag. */
const HOLD = { delay: 250, tolerance: 5 }
/** Space lifts and drops, Escape cancels (a Tab away drops where it is); Enter is the card's, it opens it. */
const KEYS = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Tab'] }

const byPosition = (a: { position: number }, b: { position: number }): number => a.position - b.position

/** The column an id belongs to: the id of a column itself, or the column that lists the card. */
function containerOf(items: Items, id: UniqueIdentifier): string | undefined {
  const key = String(id)
  return key in items ? key : Object.keys(items).find((column) => items[column]!.includes(key))
}

interface Live {
  items: Items
  columnIds: readonly string[]
}

/**
 * The keyboard coordinate getter of dnd-kit's multi-column example, with the arrows read in reading terms: Up and Down
 * go to the card above and below in the column, the side arrows to the neighbouring column in reading order (on a
 * right-to-left page the right arrow is the previous column). The card lands where the nearest card of that column is.
 */
function boardCoordinates(live: Live, ...[event, { context }]: Parameters<KeyboardCoordinateGetter>): ReturnType<KeyboardCoordinateGetter> {
  const { active, droppableRects, droppableContainers, collisionRect } = context
  const direction: Direction = getComputedStyle(document.documentElement).direction === 'rtl' ? 'rtl' : 'ltr'
  const move = keyMove(event.code, direction)
  if (move === null) return undefined
  event.preventDefault()
  if (!active || !collisionRect) return undefined
  const { items, columnIds } = live
  const from = containerOf(items, active.id)
  if (from === undefined) return undefined
  const target = move === 'up' || move === 'down' ? from : neighbourColumn(columnIds, from, move)
  if (target === null) return undefined
  const candidates: DroppableContainer[] = []
  for (const entry of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(entry.id)
    // Never the lifted card itself: its place is a pixel or two off the carried one, and it would be the nearest.
    // Nor a card of a column that is not drawn (on a phone, or zoomed in, one column shows): its rect is empty, at the corner.
    if (!rect || rect.width === 0 || entry.id === active.id || containerOf(items, entry.id) !== target) continue
    // A column that holds cards offers its cards; an empty one offers itself.
    if (String(entry.id) in items && items[String(entry.id)]!.length > 0) continue
    if (move === 'down' && !(collisionRect.top < rect.top)) continue
    if (move === 'up' && !(collisionRect.top > rect.top)) continue
    candidates.push(entry)
  }
  const closest = getFirstCollision(
    closestCorners({ active, collisionRect, droppableRects, droppableContainers: candidates, pointerCoordinates: null }),
    'id',
  )
  if (closest == null) return undefined
  const rect = droppableContainers.get(closest)?.rect.current
  return rect ? { x: rect.left, y: rect.top } : undefined
}

// ---------------------------------------------------------------------------
// «بطاقة جديدة في «…»»: a card's title, made at the end of its column
// ---------------------------------------------------------------------------

interface ComposerProps {
  column: BoardColumn
  call: BoardCall
  onCreated: (card: BoardCard) => void
  onRefused: () => void
  onClose: () => void
}

function Composer({ column, call, onCreated, onRefused, onClose }: ComposerProps) {
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    form.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const checked = checkText(title, 'title', 200)
    if (checked.error !== null) {
      setError(checked.error)
      return
    }
    setBusy(true)
    setError(null)
    const reply = await call('board_card_create', { p_column: column.id, p_title: checked.value }, parseCard)
    setBusy(false)
    if (reply.ok) return onCreated(reply.value)
    // A column that is gone is NOT_FOUND too: the save failed, and the reading that follows says if the project went.
    setError(writeRefusalText(reply.refusal, SAVE_FAILED))
    if (reply.refusal?.code === 'NOT_FOUND') onRefused()
  }

  return (
    <form
      ref={form}
      className={styles.composer}
      onSubmit={submit}
      noValidate
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className={admin.field}>
        <label className={admin.label} htmlFor={`${id}-title`}>
          العنوان
        </label>
        <input
          id={`${id}-title`}
          className={admin.input}
          value={title}
          autoFocus
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => setTitle(event.target.value)}
        />
        {error !== null && (
          <p id={`${id}-error`} className={`${admin.error} ${styles.fieldError}`} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.composerActions}>
        <button type="submit" className={admin.button} disabled={busy}>
          حفظ
        </button>
        <button type="button" className={admin.buttonSecondary} onClick={onClose}>
          إغلاق
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// «عمود جديد» and a column's «خيارات» (the owner's; R2 gives the options their «إعادة تسمية»)
// ---------------------------------------------------------------------------

type ColumnDialogState = { mode: 'create' } | { mode: 'options'; columnId: string }

interface ColumnDialogProps {
  state: ColumnDialogState
  data: BoardData
  call: BoardCall
  onData: (update: (current: BoardData) => BoardData) => void
  onReload: () => Promise<unknown>
  onCreated: (columnId: string) => void
  onClose: () => void
}

function ColumnDialog({ state, data, call, onData, onReload, onCreated, onClose }: ColumnDialogProps) {
  const id = useId()
  const column = state.mode === 'options' ? data.columns.find((entry) => entry.id === state.columnId) : undefined
  const [name, setName] = useState(column?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent, close: () => void) {
    event.preventDefault()
    if (busy) return
    const checked = checkText(name, 'name', 40)
    if (checked.error !== null) {
      setError(checked.error)
      return
    }
    setBusy(true)
    setError(null)
    if (state.mode === 'create') {
      const reply = await call('board_column_create', { p_project: data.project.id, p_name: checked.value }, parseColumn)
      setBusy(false)
      if (reply.ok) {
        onData((current) => ({ ...current, columns: [...current.columns, reply.value] }))
        onCreated(reply.value.id)
        return close()
      }
      setError((reply.refusal && refusalText(reply.refusal)) || SAVE_FAILED)
      return
    }
    if (column === undefined) return close()
    const reply = await call('board_column_update', { p_column: column.id, p_version: column.version, p_changes: { name: checked.value } }, parseColumn)
    setBusy(false)
    if (reply.ok) {
      onData((current) => ({ ...current, columns: current.columns.map((entry) => (entry.id === reply.value.id ? reply.value : entry)) }))
      return close()
    }
    // A stale version and a column that is gone both say the save failed (the card's sentence is the card dialog's).
    setError(writeRefusalText(reply.refusal, SAVE_FAILED))
    // A refused rename (a stale version, a column that is gone) is read again, so that the next press is on what is there now.
    if (reply.refusal === null || reply.refusal.code === 'STALE' || reply.refusal.code === 'NOT_FOUND') void onReload()
  }

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose}>
      {(close) => (
        <>
          <h2 id={`${id}-title`}>{state.mode === 'create' ? 'عمود جديد' : 'خيارات'}</h2>
          <form className={styles.cardForm} noValidate onSubmit={(event) => void submit(event, close)}>
            <div className={admin.field}>
              <label className={admin.label} htmlFor={`${id}-name`}>
                اسم العمود
              </label>
              <input
                id={`${id}-name`}
                className={admin.input}
                value={name}
                autoComplete="off"
                aria-invalid={error !== null}
                aria-describedby={error === null ? undefined : `${id}-error`}
                onChange={(event) => setName(event.target.value)}
              />
              {error !== null && (
                <p id={`${id}-error`} className={`${admin.error} ${styles.fieldError}`} role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className={styles.dialogActions}>
              <button type="submit" className={admin.button} disabled={busy}>
                {state.mode === 'create' ? 'حفظ' : 'إعادة تسمية'}
              </button>
              <button type="button" className={admin.buttonSecondary} onClick={close}>
                إغلاق
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// One column
// ---------------------------------------------------------------------------

interface ColumnProps {
  column: BoardColumn
  ids: readonly string[]
  cardsById: ReadonlyMap<string, BoardCard>
  context: FaceContext
  canEdit: boolean
  isOwner: boolean
  busy: boolean
  reduced: boolean
  isCurrent: boolean
  /** Another column or a search says the board has no card to show: this column says nothing of its own emptiness. */
  quiet: boolean
  composing: boolean
  composer: Omit<ComposerProps, 'column' | 'onClose'>
  onOpen: (cardId: string) => void
  onMove: (cardId: string) => void
  onOptions: (columnId: string) => void
  onCompose: (columnId: string | null) => void
}

function Column({ column, ids, cardsById, context, canEdit, isOwner, busy, reduced, isCurrent, quiet, composing, composer, onOpen, onMove, onOptions, onCompose }: ColumnProps) {
  const headId = useId()
  const { setNodeRef } = useDroppable({ id: column.id })
  const classes = [styles.column, column.isDone ? styles.done : '', isCurrent ? styles.current : ''].filter(Boolean).join(' ')
  return (
    <div role="group" aria-labelledby={headId} className={classes}>
      <div className={styles.colHead} data-tone={column.isDone ? 'night' : undefined}>
        <h2 id={headId}>{column.name}</h2>
        <span className={styles.count}>
          <span aria-hidden="true">{ids.length}</span>
          <span className="visually-hidden">{cardsPhrase(ids.length)}</span>
        </span>
        {isOwner && (
          <button type="button" className={styles.colMenu} aria-label={`خيارات العمود ${column.name}`} onClick={() => onOptions(column.id)}>
            ⋯
          </button>
        )}
      </div>
      {column.isDone && <div className={styles.weave} aria-hidden="true" />}
      <SortableContext id={column.id} items={ids as string[]} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className={styles.cards}>
          {ids.map((id) => {
            const card = cardsById.get(id)
            return card === undefined ? null : (
              <SortableCard key={id} card={card} context={context} inDone={column.isDone} canMove={canEdit} busy={busy} reduced={reduced} onOpen={onOpen} onMove={onMove} />
            )
          })}
        </ol>
      </SortableContext>
      {ids.length === 0 && !quiet && <p className={styles.emptyColumn}>{EMPTY_COLUMN}</p>}
      {canEdit &&
        !column.isDone &&
        (composing ? (
          <Composer column={column} {...composer} onClose={() => onCompose(null)} />
        ) : (
          <button type="button" className={styles.addCard} data-add={column.id} onClick={() => onCompose(column.id)}>
            {`بطاقة جديدة في «${column.name}»`}
          </button>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export interface BoardHandle {
  /** «بطاقة جديدة»: the composer of a column. */
  newCard: (columnId: string) => void
  /** «عمود جديد». */
  newColumn: () => void
}

interface BoardProps {
  ref?: Ref<BoardHandle>
  data: BoardData
  today: string
  query: string
  filters: Filters
  showHidden: boolean
  call: BoardCall
  onData: (update: (current: BoardData) => BoardData) => void
  /** Says something on the screen's status line (null clears it). */
  onSay: (text: string | null, error?: boolean) => void
  onReload: () => Promise<unknown>
  /** A card is being carried (true) or was put down (false): a reading of the project waits for it. */
  onDrag: (active: boolean) => void
  onOpen: (cardId: string) => void
}

export function Board({ ref, data, today, query, filters, showHidden, call, onData, onSay, onReload, onDrag, onOpen }: BoardProps) {
  const canEdit = data.role !== 'viewer'
  const isOwner = data.role === 'owner'
  const reduced = useReducedMotion()

  const columns = useMemo(() => data.columns.filter((column) => showHidden || !column.hidden).sort(byPosition), [data.columns, showHidden])
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns])
  const doneIds = useMemo(() => new Set(data.columns.filter((column) => column.isDone).map((column) => column.id)), [data.columns])
  const cardsById = useMemo(() => new Map(data.cards.map((card) => [card.id, card] as const)), [data.cards])
  const context: FaceContext = useMemo(
    () => ({ labels: new Map(data.labels.map((label) => [label.id, label] as const)), people: new Map(data.people.map((person) => [person.id, person] as const)), today }),
    [data.labels, data.people, today],
  )
  const filtering = query.trim() !== '' || hasFilters(filters)
  const layout = useMemo(
    () => columnItems(data.cards, columns, (card) => matchesSearch(card, query) && matchesFilters(card, filters, today, doneIds.has(card.columnId))),
    [data.cards, columns, query, filters, today, doneIds],
  )

  // The cards by column as the board shows them. A drag changes it at once; the database's answer replaces it (a new
  // `layout`), and a refusal puts it back.
  const [source, setSource] = useState(layout)
  const [items, setItems] = useState(layout)
  if (source !== layout) {
    setSource(layout)
    setItems(layout)
  }

  const [activeId, setActiveId] = useState<string | null>(null)
  const [clonedItems, setClonedItems] = useState<Items | null>(null)
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [composer, setComposer] = useState<string | null>(null)
  const [moveMenu, setMoveMenu] = useState<string | null>(null)
  const [columnDialog, setColumnDialog] = useState<ColumnDialogState | null>(null)
  const [focus, setFocus] = useState<{ selector: string; n: number } | null>(null)
  const sending = useRef(false)
  const viaKeyboard = useRef(false)
  const lastOverId = useRef<UniqueIdentifier | null>(null)
  const recentlyMovedToNewContainer = useRef(false)
  const justLifted = useRef(false)
  const live = useRef<Live & { cardsById: ReadonlyMap<string, BoardCard> }>({ items, columnIds, cardsById })
  useEffect(() => {
    live.current = { items, columnIds, cardsById }
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false
    })
  })
  useEffect(() => {
    if (focus !== null) document.querySelector<HTMLElement>(focus.selector)?.focus()
  }, [focus])

  const currentId = current !== null && columnIds.includes(current) ? current : columnIds[0]
  const requestFocus = (selector: string) => setFocus((previous) => ({ selector, n: (previous?.n ?? 0) + 1 }))
  const none = filtering && columnIds.every((id) => (items[id] ?? []).length === 0)

  useImperativeHandle(
    ref,
    () => ({
      newCard(columnId) {
        setCurrent(columnId)
        setComposer(columnId)
      },
      newColumn() {
        setColumnDialog({ mode: 'create' })
      },
    }),
    [],
  )

  // ---- the move --------------------------------------------------------------------------------------------------

  /** One call of `board_card_move`; the card goes back, the project is read again and the screen says so when it is refused. */
  async function send(card: BoardCard, columnId: string, position: number, how: 'pointer' | 'keyboard' | 'menu') {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    onSay(null)
    const reply = await call('board_card_move', { p_card: card.id, p_version: card.version, p_column: columnId, p_position: position }, parseMove)
    sending.current = false
    setBusy(false)
    if (reply.ok) {
      onData((latest) => applyMove(latest, reply.value))
      // A keyboard drop keeps the focus where dnd-kit puts it back; a move from the menu leaves it on the moved card.
      if (how === 'menu') {
        setCurrent(columnId)
        requestFocus(`[data-card="${card.id}"]`)
      }
      return
    }
    setItems(layout)
    // An archived card or a deleted column is NOT_FOUND too: the move failed, and the reading after it says if the project went.
    onSay(writeRefusalText(reply.refusal, MOVE_FAILED), true)
    await onReload()
    requestFocus(`[data-card="${card.id}"]`)
  }

  /** The card at `index` among the cards its column shows after the drop, as a position in the column's whole list. */
  function drop(cardId: string, columnId: string, index: number, after: Items) {
    const card = cardsById.get(cardId)
    if (card === undefined) return
    const full = data.cards
      .filter((entry) => entry.columnId === columnId && entry.id !== cardId)
      .sort(byPosition)
      .map((entry) => entry.id)
    const shown = (after[columnId] ?? []).filter((id) => id !== cardId)
    void send(card, columnId, dropPosition(full, shown, index), viaKeyboard.current ? 'keyboard' : 'pointer')
  }

  // ---- dnd-kit (the multi-column example's handlers) ----------------------------------------------------------------

  const getCoordinates: KeyboardCoordinateGetter = useCallback((event, args) => boardCoordinates(live.current, event, args), [])
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: HOLD }),
    useSensor(TouchSensor, { activationConstraint: HOLD }),
    // dnd-kit scrolls smoothly by default: under reduced motion nothing animates, its scroll included.
    useSensor(KeyboardSensor, { coordinateGetter: getCoordinates, keyboardCodes: KEYS, scrollBehavior: reduced ? 'auto' : 'smooth' }),
  )

  /**
   * The pointer's own container first; then the card nearest to the active one inside it. When a lifted card moves to
   * another column the layout shifts and nothing may be under the pointer for a frame: the last match stands.
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerIntersections = pointerWithin(args)
      const intersections = pointerIntersections.length > 0 ? pointerIntersections : rectIntersection(args)
      const first = getFirstCollision(intersections, 'id')
      if (first != null) {
        let target: UniqueIdentifier = first
        const inside = items[String(first)]
        if (inside !== undefined && inside.length > 0) {
          const hit = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((container) => container.id !== first && inside.includes(String(container.id))),
          })[0]
          target = hit?.id ?? first
        }
        lastOverId.current = target
        return [{ id: target }]
      }
      if (recentlyMovedToNewContainer.current) lastOverId.current = activeId
      return lastOverId.current != null ? [{ id: lastOverId.current }] : []
    },
    [activeId, items],
  )

  function onDragStart({ active, activatorEvent }: DragStartEvent) {
    onSay(null)
    onDrag(true)
    viaKeyboard.current = activatorEvent instanceof KeyboardEvent
    setActiveId(String(active.id))
    setClonedItems(items)
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const overId = over?.id
    if (overId == null) return
    const overContainer = containerOf(items, overId)
    const activeContainer = containerOf(items, active.id)
    if (overContainer === undefined || activeContainer === undefined || activeContainer === overContainer) return
    recentlyMovedToNewContainer.current = true
    setItems((latest) => {
      const activeItems = latest[activeContainer] ?? []
      const overItems = latest[overContainer] ?? []
      const activeIndex = activeItems.indexOf(String(active.id))
      const overIndex = overItems.indexOf(String(overId))
      let newIndex: number
      if (String(overId) in latest) {
        newIndex = overItems.length + 1
      } else {
        const translated = active.rect.current.translated
        const below = translated !== null && translated !== undefined && translated.top > over!.rect.top + over!.rect.height
        newIndex = overIndex >= 0 ? overIndex + (below ? 1 : 0) : overItems.length + 1
      }
      return {
        ...latest,
        [activeContainer]: activeItems.filter((id) => id !== String(active.id)),
        [overContainer]: [...overItems.slice(0, newIndex), activeItems[activeIndex]!, ...overItems.slice(newIndex)],
      }
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const cardId = String(active.id)
    const origin = clonedItems ?? items
    onDrag(false)
    setActiveId(null)
    setClonedItems(null)
    const column = containerOf(items, cardId)
    if (over == null || column === undefined) {
      setItems(origin)
      return
    }
    let after = items
    const activeIndex = items[column]!.indexOf(cardId)
    const overIndex = items[column]!.indexOf(String(over.id))
    if (containerOf(items, over.id) === column && overIndex >= 0 && activeIndex !== overIndex) {
      after = { ...items, [column]: arrayMove(items[column]!, activeIndex, overIndex) }
      setItems(after)
    }
    const fromColumn = containerOf(origin, cardId)
    const fromIndex = fromColumn === undefined ? -1 : origin[fromColumn]!.indexOf(cardId)
    const toIndex = after[column]!.indexOf(cardId)
    if (fromColumn === column && fromIndex === toIndex) return
    drop(cardId, column, toIndex, after)
  }

  function onDragCancel() {
    onDrag(false)
    setItems(clonedItems ?? items)
    setActiveId(null)
    setClonedItems(null)
  }

  /** What a screen reader hears: section 7's sentences, the card's place read from the layout as it stands. */
  const announcements: Announcements = useMemo(() => {
    const titleOf = (id: UniqueIdentifier) => live.current.cardsById.get(String(id))?.title ?? ''
    const place = (id: UniqueIdentifier, overId: UniqueIdentifier) => {
      const { items: now } = live.current
      const column = containerOf(now, overId)
      if (column === undefined) return null
      const list = now[column]!
      const total = list.length + (list.includes(String(id)) ? 0 : 1)
      const index = list.indexOf(String(overId))
      return { column, position: index >= 0 ? index + 1 : total, total }
    }
    const nameOf = (columnId: string) => data.columns.find((entry) => entry.id === columnId)?.name ?? ''
    return {
      onDragStart: ({ active }) => {
        justLifted.current = true
        return liftedText(titleOf(active.id))
      },
      // The first «over» is the card over its own place, right after it was lifted: it would cut the lift's sentence short.
      onDragOver: ({ active, over }) => {
        const first = justLifted.current
        justLifted.current = false
        if (over === null || (first && over.id === active.id)) return undefined
        const at = place(active.id, over.id)
        return at === null ? undefined : overText(nameOf(at.column), at.position, at.total)
      },
      onDragEnd: ({ active, over }) => {
        const at = over === null ? null : place(active.id, over.id)
        return at === null ? MOVE_CANCELLED : droppedText(nameOf(at.column))
      },
      onDragCancel: () => MOVE_CANCELLED,
    }
  }, [data.columns])

  // ---- what the columns do -----------------------------------------------------------------------------------------

  function chooseFromMenu(card: BoardCard, columnId: string, position: number) {
    setMoveMenu(null)
    if (columnId === card.columnId && position === card.position) return
    void send(card, columnId, position, 'menu')
  }

  const activeCard = activeId === null ? undefined : cardsById.get(activeId)
  const menuCard = moveMenu === null ? undefined : cardsById.get(moveMenu)

  return (
    <div className={styles.boardRoot}>
      <div className={styles.switcher} role="group" aria-label="الأعمدة">
        {columns.map((column) => (
          <button key={column.id} type="button" className={admin.toolbarButton} aria-pressed={column.id === currentId} onClick={() => setCurrent(column.id)}>
            {column.name} <span className={styles.num}>{(items[column.id] ?? []).length}</span>
          </button>
        ))}
      </div>
      {none && <p className={admin.message}>{EMPTY_SEARCH}</p>}
      {data.columns.length === 0 && <p className={admin.message}>لا بطاقات.</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: MOVE_INSTRUCTIONS } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className={styles.board}>
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              ids={items[column.id] ?? []}
              cardsById={cardsById}
              context={context}
              canEdit={canEdit}
              isOwner={isOwner}
              busy={busy}
              reduced={reduced}
              isCurrent={column.id === currentId}
              quiet={none}
              composing={composer === column.id}
              composer={{
                call,
                onCreated: (card) => {
                  onData((latest) => withCard(latest, card))
                  setComposer(null)
                  requestFocus(`[data-card="${card.id}"]`)
                },
                onRefused: () => void onReload(),
              }}
              onOpen={onOpen}
              onMove={setMoveMenu}
              onOptions={(columnId) => setColumnDialog({ mode: 'options', columnId })}
              onCompose={(columnId) => {
                setComposer(columnId)
                if (columnId === null) requestFocus(`[data-add="${column.id}"]`)
              }}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={reduced ? null : undefined}>
          {activeCard === undefined ? null : <LiftedCard card={activeCard} context={context} inDone={doneIds.has(activeCard.columnId)} />}
        </DragOverlay>
      </DndContext>
      {menuCard !== undefined && (
        <MoveMenu
          key={menuCard.id}
          card={menuCard}
          columns={columns.map((column) => ({ id: column.id, name: column.name, count: data.cards.filter((card) => card.columnId === column.id).length }))}
          onChoose={(columnId, position) => chooseFromMenu(menuCard, columnId, position)}
          onClose={() => setMoveMenu(null)}
        />
      )}
      {columnDialog !== null && (
        <ColumnDialog
          state={columnDialog}
          data={data}
          call={call}
          onData={onData}
          onReload={onReload}
          onCreated={(columnId) => setCurrent(columnId)}
          onClose={() => setColumnDialog(null)}
        />
      )}
    </div>
  )
}
