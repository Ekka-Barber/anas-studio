'use client'

/**
 * «مهامي» (P12 round R2): the caller's assigned cards across the projects they can see, grouped «متأخرة»، «اليوم»،
 * «هذا الأسبوع»، «لاحقًا»، «بلا موعد», each card a link to its dialog on its project's board. It is the landing page of
 * the board-only role: its «متأخرة» and «اليوم» are that person's reminder.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  addDays,
  callBoard,
  dueLabel,
  EMPTY_MINE,
  LOAD_FAILED,
  LOADING,
  parseMine,
  PRIORITY_LABELS,
  riyadhToday,
  type MineCard,
} from '@/lib/projects'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import admin from '../admin.module.css'
import styles from './projects.module.css'

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; cards: MineCard[]; today: string }
type Group = 'late' | 'today' | 'week' | 'later' | 'none'

const GROUPS: ReadonlyArray<{ group: Group; title: string }> = [
  { group: 'late', title: 'متأخرة' },
  { group: 'today', title: 'اليوم' },
  { group: 'week', title: 'هذا الأسبوع' },
  { group: 'later', title: 'لاحقًا' },
  { group: 'none', title: 'بلا موعد' },
]

/** The group a card belongs to: late, today, within the six days after today, later, or with no due day. */
function groupOf(dueOn: string | null, today: string): Group {
  if (dueOn === null) return 'none'
  if (dueOn < today) return 'late'
  if (dueOn === today) return 'today'
  return dueOn <= addDays(today, 6) ? 'week' : 'later'
}

export function MyCards() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [round, setRound] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      const reply = await callBoard(getSupabaseBrowserClient(), 'board_mine', {}, parseMine)
      // A reading again that fails keeps the list on screen; only a first reading that fails says so.
      if (active) setLoad((previous) => (reply.ok ? { kind: 'ready', cards: reply.value, today: riyadhToday() } : previous.kind === 'ready' ? previous : { kind: 'failed' }))
    })()
    return () => {
      active = false
    }
  }, [round])

  // No Realtime: the window gets the focus, the cards are read again (as the board is).
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') setRound((n) => n + 1)
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [])

  return (
    <>
      <h1>مهامي</h1>
      {load.kind === 'loading' && (
        <p className={admin.message} role="status">
          {LOADING}
        </p>
      )}
      {load.kind === 'failed' && (
        <>
          <p className={admin.error} role="alert">
            {LOAD_FAILED}
          </p>
          <button
            type="button"
            className={admin.buttonSecondary}
            onClick={() => {
              setLoad({ kind: 'loading' })
              setRound((value) => value + 1)
            }}
          >
            إعادة المحاولة
          </button>
        </>
      )}
      {load.kind === 'ready' && load.cards.length === 0 && <p className={admin.message}>{EMPTY_MINE}</p>}
      {load.kind === 'ready' &&
        GROUPS.map(({ group, title }) => {
          const cards = load.cards.filter((card) => groupOf(card.dueOn, load.today) === group)
          return cards.length === 0 ? null : (
            <section key={group} className={group === 'late' ? styles.mineLate : undefined}>
              <h2>{title}</h2>
              <ul className={`${admin.metaList} ${styles.mine}`}>
                {cards.map((card) => {
                  const due = dueLabel(card.dueOn, load.today)
                  return (
                    <li key={card.id}>
                      <Link href={`/admin/projects/view?id=${card.project.id}&card=${card.id}`}>{card.title}</Link>
                      {card.priority === 'urgent' && <span className={styles.urgent}>{PRIORITY_LABELS.urgent}</span>}
                      {card.priority === 'low' && <span className={styles.low}>{PRIORITY_LABELS.low}</span>}
                      {due !== null && <span className={`${styles.due} ${styles[due.tone]}`}>{due.text}</span>}
                      <span className={admin.message}>
                        <bdi>{card.project.name}</bdi>
                        {' · '}
                        <bdi>{card.column.name}</bdi>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
    </>
  )
}
