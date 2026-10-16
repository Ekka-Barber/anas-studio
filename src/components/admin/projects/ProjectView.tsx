'use client'

/**
 * One project (P12 round R2): its title, the people on it, one tools row (search, «تصفية», the hidden columns,
 * «عمود جديد» for an owner and «بطاقة جديدة» for a member) and its board, with the card's dialog on top. The project's id
 * travels in `?id=` (a static export cannot know the projects made after the build), and `&card=` opens a card's dialog
 * (the links of «مهامي»). The list and the overview are round R3's: their buttons are not drawn yet.
 *
 * Nothing is optimistic beyond a card's own place: a write answers with the row it changed, the screen takes that and
 * reads the project again, and it reads again when the window gets the focus (no Realtime). A reading that started
 * before a write, or while a card is carried, is dropped: it is not what the screen holds now.
 */
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  callBoard,
  CARD_ARCHIVED,
  initialOf,
  isUuid,
  LOAD_FAILED,
  LOADING,
  NO_FILTERS,
  DUE_FILTERS,
  LINK_FILTERS,
  parseBoard,
  parseCard,
  parseLinkTargets,
  peoplePhrase,
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_GONE,
  PROJECT_ROLE_LABELS,
  riyadhToday,
  SAVE_FAILED,
  withCard,
  withoutCard,
  writeRefusalText,
  type BoardCall,
  type BoardCard,
  type BoardData,
  type Filters,
  type LinkTarget,
} from '@/lib/projects'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import admin from '../admin.module.css'
import { Board, type BoardHandle } from './Board'
import { focusCard } from './BoardCard'
import { CardDialog } from './CardDialog'
import styles from './projects.module.css'

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'gone' } | { kind: 'ready'; data: BoardData; today: string }
type Status = { text: string; error: boolean; undo?: string }

/** The people the row names before it counts the rest (a project holds at most 31). */
const PEOPLE_SHOWN = 4

export function ProjectView() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const cardParam = params.get('card') ?? ''
  const valid = isUuid(id)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [openCard, setOpenCard] = useState<string | null>(null)
  /** The open card as it was last read: its dialog stays, with what was typed, if a newer reading no longer holds it. */
  const [openSnapshot, setOpenSnapshot] = useState<BoardCard | null>(null)
  const [targets, setTargets] = useState<LinkTarget[] | 'failed' | null>(null)
  const [focus, setFocus] = useState<{ selector: string; n: number } | null>(null)
  const board = useRef<BoardHandle>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const filtersId = 'projects-filters'
  const seq = useRef(0)
  const writes = useRef(0)
  const dragging = useRef(false)

  /**
   * The project as the database holds it now. The reading is applied only when nothing newer began since: a write or a
   * second reading after it, or a card being carried. The reading itself is returned either way.
   */
  const read = useCallback(
    async (announce = false): Promise<BoardData | null> => {
      const mine = (seq.current += 1)
      const reply = await callBoard(getSupabaseBrowserClient(), 'board_project', { p_project: id }, parseBoard)
      const current = mine === seq.current && writes.current === 0 && !dragging.current
      if (reply.ok) {
        if (current) setLoad({ kind: 'ready', data: reply.value, today: riyadhToday() })
        return reply.value
      }
      if (reply.refusal?.code === 'NOT_FOUND') setLoad({ kind: 'gone' })
      else {
        setLoad((previous) => (previous.kind === 'ready' ? previous : { kind: 'failed' }))
        if (announce) setStatus({ text: LOAD_FAILED, error: true })
      }
      return null
    },
    [id],
  )

  /** A write: it holds readings back until it is answered. */
  const write: BoardCall = useCallback(async (fn, args, parse) => {
    writes.current += 1
    seq.current += 1
    try {
      return await callBoard(getSupabaseBrowserClient(), fn, args, parse)
    } finally {
      writes.current -= 1
    }
  }, [])

  /** What a write answered goes into the screen, and the project is read again. */
  const apply = useCallback(
    (update: (current: BoardData) => BoardData) => {
      setLoad((previous) => (previous.kind === 'ready' ? { ...previous, data: update(previous.data) } : previous))
      void read()
    },
    [read],
  )

  useEffect(() => {
    if (!valid) return
    void (async () => {
      const data = await read()
      // `&card=` opens that card once, when it is on the board.
      const asked = data !== null && isUuid(cardParam) ? data.cards.find((card) => card.id === cardParam) : undefined
      if (asked !== undefined) {
        setOpenSnapshot(asked)
        setOpenCard(asked.id)
      }
    })()
  }, [valid, read, cardParam])

  // No Realtime: the window gets the focus, the project is read again.
  useEffect(() => {
    if (!valid) return
    const again = () => {
      if (document.visibilityState === 'visible') void read()
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [valid, read])

  // The documents a card can link to, read once, when the first card is opened.
  useEffect(() => {
    if (openCard === null || targets !== null) return
    let active = true
    void (async () => {
      const reply = await callBoard(getSupabaseBrowserClient(), 'board_link_targets', {}, parseLinkTargets)
      if (active) setTargets(reply.ok ? reply.value : 'failed')
    })()
    return () => {
      active = false
    }
  }, [openCard, targets])

  useEffect(() => {
    if (focus === null) return
    const element = document.querySelector<HTMLElement>(focus.selector) ?? statusRef.current
    element?.focus()
  }, [focus])

  const say = useCallback((text: string | null, error = false) => setStatus(text === null ? null : { text, error }), [])

  if (!valid || load.kind === 'gone') {
    return (
      <>
        <p className={`${admin.message} ${styles.back}`}>
          <Link href="/admin/projects" className={admin.target}>
            كل المشاريع
          </Link>
        </p>
        <p className={admin.error}>{PROJECT_GONE}</p>
      </>
    )
  }
  if (load.kind === 'loading') {
    return (
      <p className={admin.message} role="status">
        {LOADING}
      </p>
    )
  }
  if (load.kind === 'failed') {
    return (
      <>
        <p className={`${admin.message} ${styles.back}`}>
          <Link href="/admin/projects" className={admin.target}>
            كل المشاريع
          </Link>
        </p>
        <p className={admin.error} role="alert">
          {LOAD_FAILED}
        </p>
        <button
          type="button"
          className={admin.buttonSecondary}
          onClick={() => {
            setLoad({ kind: 'loading' })
            void read()
          }}
        >
          إعادة المحاولة
        </button>
      </>
    )
  }

  const { data, today } = load
  const canEdit = data.role !== 'viewer'
  const isOwner = data.role === 'owner'
  const hiddenCount = data.columns.filter((column) => column.hidden).length
  const addTarget = [...data.columns].sort((a, b) => a.position - b.position).find((column) => !column.isDone && (showHidden || !column.hidden))
  const shownPeople = data.people.slice(0, PEOPLE_SHOWN)
  const card = openCard === null ? undefined : (data.cards.find((entry) => entry.id === openCard) ?? (openSnapshot?.id === openCard ? openSnapshot : undefined))

  function closeDialog() {
    const closed = openCard
    setOpenCard(null)
    setOpenSnapshot(null)
    // The address no longer names the card once its dialog is shut.
    if (cardParam !== '') window.history.replaceState(null, '', `/admin/projects/view?id=${id}`)
    if (closed !== null) focusCard(closed)
  }

  function archived(archivedCard: BoardCard) {
    // The next card of the column that is drawn now (a filter may hide some) takes the focus, else the column's «بطاقة
    // جديدة في» button, else this screen's status line. The card's place is read from the board, not from the dialog's copy.
    const at = data.cards.find((entry) => entry.id === archivedCard.id)?.position ?? archivedCard.position
    const next = data.cards
      .filter((entry) => entry.columnId === archivedCard.columnId && entry.position > at)
      .sort((a, b) => a.position - b.position)
      .find((entry) => document.querySelector(`[data-card="${entry.id}"]`) !== null)
    apply((current) => withoutCard(current, archivedCard.id))
    setOpenCard(null)
    setOpenSnapshot(null)
    setStatus({ text: CARD_ARCHIVED, error: false, undo: archivedCard.id })
    setFocus((previous) => ({ selector: next === undefined ? `[data-add="${archivedCard.columnId}"]` : `[data-card="${next.id}"]`, n: (previous?.n ?? 0) + 1 }))
  }

  async function undo(cardId: string) {
    setStatus(null)
    const reply = await write('board_card_restore', { p_card: cardId }, parseCard)
    if (reply.ok) {
      apply((current) => withCard(current, reply.value))
      setFocus((previous) => ({ selector: `[data-card="${cardId}"]`, n: (previous?.n ?? 0) + 1 }))
      return
    }
    setStatus({ text: writeRefusalText(reply.refusal, SAVE_FAILED), error: true })
    if (reply.refusal === null || reply.refusal.code === 'NOT_FOUND') void read()
  }

  return (
    <>
      <p className={`${admin.message} ${styles.back}`}>
        <Link href="/admin/projects" className={admin.target}>
          كل المشاريع
        </Link>
      </p>
      <h1>{data.project.name}</h1>

      <ul className={styles.people} aria-label="الأشخاص">
        {shownPeople.map((person) => (
          <li key={person.id} className={styles.person}>
            <span className={person.role === 'owner' ? styles.who : `${styles.who} ${styles.whoSecond}`} aria-hidden="true">
              {initialOf(person.name)}
            </span>
            <bdi className={styles.personName}>{person.name}</bdi> <small>{PROJECT_ROLE_LABELS[person.role]}</small>
          </li>
        ))}
        {data.people.length > shownPeople.length && <li className={styles.peopleMore}>{`و${peoplePhrase(data.people.length - shownPeople.length)}`}</li>}
        {data.people.length > 1 && <li className={styles.peopleMorePhone}>{`و${peoplePhrase(data.people.length - 1)}`}</li>}
      </ul>

      <div className={styles.tools}>
        <div className={styles.search}>
          <label className={admin.label} htmlFor="projects-search">
            بحث
          </label>
          <input id="projects-search" type="search" className={admin.input} value={query} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button type="button" className={admin.buttonSecondary} aria-expanded={filtersOpen} aria-controls={filtersOpen ? filtersId : undefined} onClick={() => setFiltersOpen((open) => !open)}>
          تصفية
        </button>
        <div className={styles.push}>
          {hiddenCount > 0 && (
            <button type="button" className={admin.buttonSecondary} aria-pressed={showHidden} onClick={() => setShowHidden((shown) => !shown)}>
              {`الأعمدة المخفية (${hiddenCount})`}
            </button>
          )}
          {isOwner && (
            <button type="button" className={admin.buttonSecondary} onClick={() => board.current?.newColumn()}>
              عمود جديد
            </button>
          )}
          {canEdit && (
            <button type="button" className={admin.button} disabled={addTarget === undefined} onClick={() => addTarget !== undefined && board.current?.newCard(addTarget.id)}>
              بطاقة جديدة
            </button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div id={filtersId} className={styles.filters}>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="projects-f-priority">
              الأولوية
            </label>
            <select id="projects-f-priority" className={admin.input} value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value as Filters['priority'] })}>
              <option value="all">الكل</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="projects-f-due">
              الموعد
            </label>
            <select id="projects-f-due" className={admin.input} value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value as Filters['due'] })}>
              {DUE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="projects-f-label">
              الوسم
            </label>
            <select id="projects-f-label" className={admin.input} value={filters.label} onChange={(event) => setFilters({ ...filters, label: event.target.value })}>
              <option value="all">الكل</option>
              {data.labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="projects-f-person">
              الشخص
            </label>
            <select id="projects-f-person" className={admin.input} value={filters.person} onChange={(event) => setFilters({ ...filters, person: event.target.value })}>
              <option value="all">الكل</option>
              {data.people
                .filter((person) => person.role !== 'viewer')
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </div>
          <div className={admin.field}>
            <label className={admin.label} htmlFor="projects-f-link">
              مرتبطة
            </label>
            <select id="projects-f-link" className={admin.input} value={filters.link} onChange={(event) => setFilters({ ...filters, link: event.target.value as Filters['link'] })}>
              {LINK_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div ref={statusRef} className={`${styles.status} ${status?.error ? admin.error : ''}`} role="status" tabIndex={-1}>
        {status?.text}
        {status?.undo !== undefined && (
          <button type="button" className={admin.buttonSecondary} onClick={() => void undo(status.undo!)}>
            تراجع
          </button>
        )}
      </div>

      <Board
        ref={board}
        data={data}
        today={today}
        query={query}
        filters={filters}
        showHidden={showHidden}
        call={write}
        onData={apply}
        onSay={say}
        onReload={() => read(true)}
        onDrag={(active) => {
          dragging.current = active
          // A reading dropped while the card was carried is made again once it is put down (a write reads anyway).
          if (!active) void read()
        }}
        onOpen={(cardId) => {
          say(null)
          setOpenSnapshot(data.cards.find((entry) => entry.id === cardId) ?? null)
          setOpenCard(cardId)
        }}
      />

      {card !== undefined && (
        <CardDialog
          key={card.id}
          card={card}
          data={data}
          targets={targets}
          call={write}
          onData={apply}
          onReload={() => read(true)}
          onArchived={archived}
          onClose={closeDialog}
        />
      )}
    </>
  )
}
