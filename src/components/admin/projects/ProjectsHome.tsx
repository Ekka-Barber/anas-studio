'use client'

/**
 * The projects (P12 round R2): a door for each project the caller may see (its name, its cards and the late ones in
 * words, its people), «مشروع جديد» for an owner and «مهامي» for everyone. The archived projects are round R3's page.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState, type FormEvent } from 'react'

import {
  callBoard,
  cardsPhrase,
  checkText,
  EMPTY_PROJECTS,
  EMPTY_PROJECTS_OWNER,
  latePhrase,
  LOAD_FAILED,
  LOADING,
  parseProjectRef,
  parseProjects,
  peopleParts,
  refusalText,
  SAVE_FAILED,
  type ProjectSummary,
} from '@/lib/projects'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from '../AdminShell'
import admin from '../admin.module.css'
import { Modal } from './MoveMenu'
import styles from './projects.module.css'

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; projects: ProjectSummary[] }

function NewProject({ onClose }: { onClose: () => void }) {
  const id = useId()
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const checked = checkText(name, 'name', 80)
    if (checked.error !== null) {
      setError(checked.error)
      return
    }
    setBusy(true)
    setError(null)
    const reply = await callBoard(getSupabaseBrowserClient(), 'board_project_create', { p_name: checked.value }, parseProjectRef)
    if (reply.ok) {
      // The new project opens on its board, where its columns are made.
      router.push(`/admin/projects/view?id=${reply.value.id}`)
      return
    }
    setBusy(false)
    setError((reply.refusal !== null && refusalText(reply.refusal)) || SAVE_FAILED)
  }

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose}>
      {(close) => (
        <>
          <h2 id={`${id}-title`}>مشروع جديد</h2>
          <form className={styles.cardForm} noValidate onSubmit={(event) => void submit(event)}>
            <div className={admin.field}>
              <label className={admin.label} htmlFor={`${id}-name`}>
                اسم المشروع
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
                حفظ
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

export function ProjectsHome() {
  const owner = useStaffRole() === 'owner'
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [round, setRound] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const reply = await callBoard(getSupabaseBrowserClient(), 'board_projects', {}, parseProjects)
      if (!active) return
      // A reading again that fails keeps the doors on screen; only a first reading that fails says so.
      setLoad((previous) => (reply.ok ? { kind: 'ready', projects: reply.value.filter((project) => !project.archived) } : previous.kind === 'ready' ? previous : { kind: 'failed' }))
    })()
    return () => {
      active = false
    }
  }, [round])

  // No Realtime: the window gets the focus, the projects are read again (as the board is).
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
      <h1>المشاريع</h1>
      <div className={`${admin.row} ${styles.homeActions}`}>
        {owner && (
          <button type="button" className={admin.button} onClick={() => setCreating(true)}>
            مشروع جديد
          </button>
        )}
        <Link className={admin.buttonSecondary} href="/admin/projects/mine">
          مهامي
        </Link>
      </div>
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
      {load.kind === 'ready' && load.projects.length === 0 && <p className={admin.message}>{owner ? EMPTY_PROJECTS_OWNER : EMPTY_PROJECTS}</p>}
      {load.kind === 'ready' && load.projects.length > 0 && (
        <div className={admin.grid}>
          {load.projects.map((project) => {
            const { first, rest } = peopleParts(project.people)
            return (
              <Link key={project.id} href={`/admin/projects/view?id=${project.id}`} className={`${admin.tile} ${styles.door}`}>
                <strong>{project.name}</strong>
                <span>
                  {cardsPhrase(project.cards)}
                  {project.overdue > 0 && (
                    <>
                      {' · '}
                      <span className={styles.lateCount}>{latePhrase(project.overdue)}</span>
                    </>
                  )}
                </span>
                <span>
                  {first !== null && <bdi>{first}</bdi>}
                  {rest}
                </span>
              </Link>
            )
          })}
        </div>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </>
  )
}
