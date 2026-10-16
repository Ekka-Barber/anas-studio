'use client'

/**
 * A card's dialog (P12 round R2): a native `<dialog>` with every field of the card: title, priority, due day, people,
 * labels, notes, checklist and link. «حفظ» sends only what changed (`cardChanges`), on the version the card had when it
 * was opened. A stale save keeps what was typed and shows the newer version beside it, with «احفظ نسختي» (what the form
 * changes at that press, against the card it was opened on, sent on the newer version) and «اعتمد الأحدث» (what was typed
 * is dropped). The card the form was opened on never moves without the form. «أرشفة البطاقة» archives it, and the screen
 * offers «تراجع». A viewer reads the card (its text fields read-only, so they still take the focus) and changes nothing.
 * Escape closes the dialog; the focus returns to the card.
 */
import { useId, useState } from 'react'

import {
  cardChanges,
  checklistText,
  fitChanges,
  formOf,
  linkValue,
  parseArchivedCard,
  parseCard,
  PRIORITIES,
  PRIORITY_LABELS,
  refusalText,
  SAVE_FAILED,
  LOAD_FAILED,
  STALE_CARD,
  UNPUBLISHED,
  withCard,
  writeRefusalText,
  type BoardCard,
  type BoardData,
  type BoardCall,
  type CardField,
  type CardForm,
  type ChecklistRow,
  type LinkTarget,
} from '@/lib/projects'

import admin from '../admin.module.css'
import { Modal } from './MoveMenu'
import styles from './projects.module.css'

interface CardDialogProps {
  card: BoardCard
  data: BoardData
  /** The documents a card can link to: null while they load, 'failed' when they could not be read. */
  targets: LinkTarget[] | 'failed' | null
  call: BoardCall
  onData: (update: (current: BoardData) => BoardData) => void
  /** Reads the project again: its new reading, or null when it could not be read. */
  onReload: () => Promise<BoardData | null>
  onArchived: (card: BoardCard) => void
  onClose: () => void
}

type Message = { text: string; error: boolean }
const INVALID_FIELDS: ReadonlySet<string> = new Set(['title', 'notes', 'due_on', 'checklist'])

export function CardDialog({ card, data, targets, call, onData, onReload, onArchived, onClose }: CardDialogProps) {
  const id = useId()
  const canEdit = data.role !== 'viewer'
  const [base, setBase] = useState(card)
  const [form, setForm] = useState<CardForm>(() => formOf(card))
  const [newer, setNewer] = useState<BoardCard | null>(null)
  const [errors, setErrors] = useState<Partial<Record<CardField, string>>>({})
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)
  const [newRow, setNewRow] = useState<string | null>(null)

  const assignable = data.people.filter((person) => person.role !== 'viewer')
  const edit = (change: Partial<CardForm>) => setForm((current) => ({ ...current, ...change }))
  const toggle = (list: string[], value: string, on: boolean): string[] => (on ? [...list, value] : list.filter((entry) => entry !== value))
  const setRow = (key: string, change: Partial<ChecklistRow>) =>
    setForm((current) => ({ ...current, checklist: current.checklist.map((row) => (row.key === key ? { ...row, ...change } : row)) }))

  /** The documents the link can name, and the card's own link first when the caller's list does not hold it. */
  const listed = Array.isArray(targets) ? targets.map((target) => ({ value: linkValue(target), label: target.title })) : []
  const own = base.link
  const options = own !== null && !listed.some((option) => option.value === linkValue(own)) ? [{ value: linkValue(own), label: own.title ?? UNPUBLISHED }, ...listed] : listed

  /** The card's newer reading after a stale answer, or null when the card is no longer on the board. */
  async function newerReading(): Promise<BoardCard | null> {
    const fresh = await onReload()
    return fresh?.cards.find((entry) => entry.id === card.id) ?? null
  }

  async function send(changes: Record<string, unknown>, version: number, close: () => void) {
    setBusy(true)
    setMessage(null)
    const reply = await call('board_card_update', { p_card: card.id, p_version: version, p_changes: changes }, parseCard)
    if (reply.ok) {
      setBusy(false)
      onData((current) => withCard(current, reply.value))
      close()
      return
    }
    const refusal = reply.refusal
    if (refusal?.code === 'STALE') {
      const latest = await newerReading()
      setBusy(false)
      if (latest === null) {
        setMessage({ text: SAVE_FAILED, error: true })
        return
      }
      setNewer(latest)
      setMessage({ text: STALE_CARD, error: true })
      return
    }
    setBusy(false)
    if (refusal?.code === 'INVALID' && INVALID_FIELDS.has(refusal.detail)) {
      setErrors({ [refusal.detail]: refusalText(refusal) ?? SAVE_FAILED })
      return
    }
    setMessage({ text: writeRefusalText(refusal, SAVE_FAILED), error: true })
    if (refusal?.code === 'NOT_FOUND') void onReload()
  }

  async function save(close: () => void) {
    const { changes, errors: found } = cardChanges(form, base)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // Nothing changed: there is nothing to send.
    if (Object.keys(changes).length === 0) return close()
    await send(fitChanges(changes, data), base.version, close)
  }

  /** «احفظ نسختي»: what the form changes now, typing after the stale answer included, sent on the newer version. */
  async function saveMine(close: () => void, latest: BoardCard) {
    const { changes, errors: found } = cardChanges(form, base)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    // The form is back to the card it was opened on: the newer version is all there is to keep.
    if (Object.keys(changes).length === 0) return adopt(latest)
    await send(fitChanges(changes, data, latest), latest.version, close)
  }

  async function archive(close: () => void) {
    setBusy(true)
    setMessage(null)
    const reply = await call('board_card_archive', { p_card: card.id, p_version: base.version }, parseArchivedCard)
    if (reply.ok) {
      setBusy(false)
      // The card as it stood: its column and place say where the focus goes next.
      onArchived(base)
      close()
      return
    }
    if (reply.refusal?.code === 'STALE') {
      const latest = await newerReading()
      setBusy(false)
      if (latest === null) {
        setMessage({ text: SAVE_FAILED, error: true })
        return
      }
      // The card moved on. With nothing typed, the dialog takes the newer version and the next press archives it. With
      // something typed, both are shown, as after a stale save: nothing typed is lost, and nothing is saved over the newer one.
      const typed = cardChanges(form, base)
      if (Object.keys(typed.changes).length === 0 && Object.keys(typed.errors).length === 0) {
        adopt(latest)
        setMessage({ text: STALE_CARD, error: true })
      } else {
        setNewer(latest)
      }
      return
    }
    setBusy(false)
    setMessage({ text: writeRefusalText(reply.refusal, SAVE_FAILED), error: true })
    if (reply.refusal?.code === 'NOT_FOUND') void onReload()
  }

  function adopt(latest: BoardCard) {
    setBase(latest)
    setForm(formOf(latest))
    setNewer(null)
    setErrors({})
    setMessage(null)
  }

  const names = (ids: readonly string[], list: ReadonlyArray<{ id: string; name: string }>) =>
    ids.flatMap((entry) => list.find((item) => item.id === entry)?.name ?? []).join('، ')

  const checklistLegend = checklistText({ checklist: form.checklist.filter((row) => row.text.trim() !== '').map((row) => ({ id: row.key, text: row.text, done: row.done })) }) ?? 'البنود'
  const field = (name: CardField) =>
    errors[name] === undefined ? null : (
      <p id={`${id}-${name}-error`} className={`${admin.error} ${styles.fieldError}`} role="alert">
        {errors[name]}
      </p>
    )
  const invalid = (name: CardField) => ({ 'aria-invalid': errors[name] !== undefined, 'aria-describedby': errors[name] === undefined ? undefined : `${id}-${name}-error` })

  return (
    <Modal labelledBy={`${id}-title`} className={styles.cardDialog} onClose={onClose}>
      {(close) => (
        <>
          <h2 id={`${id}-title`}>{`بطاقة: ${base.title}`}</h2>
          <div className={styles.sideBySide}>
            {newer !== null && (
              <aside className={styles.newer} aria-label={STALE_CARD}>
                <p className={admin.error} role="alert">
                  {STALE_CARD}
                </p>
                <ul className={admin.metaList}>
                  <li>
                    <strong>العنوان</strong> {newer.title}
                  </li>
                  <li>
                    <strong>الأولوية</strong> {PRIORITY_LABELS[newer.priority]}
                  </li>
                  <li>
                    <strong>الموعد</strong> <span className={styles.ltr}>{newer.dueOn ?? ''}</span>
                  </li>
                  <li>
                    <strong>الوسوم</strong> {names(newer.labels, data.labels)}
                  </li>
                  <li>
                    <strong>الأشخاص</strong> {names(newer.people, data.people)}
                  </li>
                  <li>
                    <strong>الملاحظات</strong> {newer.notes}
                  </li>
                  <li>
                    <strong>{checklistText(newer) ?? 'البنود'}</strong> {newer.checklist.map((item) => `${item.done ? '✓ ' : ''}${item.text}`).join('، ')}
                  </li>
                  <li>
                    <strong>مرتبطة بـ</strong> {newer.link === null ? '' : (newer.link.title ?? UNPUBLISHED)}
                  </li>
                </ul>
                <div className={styles.dialogActions}>
                  <button type="button" className={admin.button} disabled={busy} onClick={() => void saveMine(close, newer)}>
                    احفظ نسختي
                  </button>
                  <button type="button" className={admin.buttonSecondary} disabled={busy} onClick={() => adopt(newer)}>
                    اعتمد الأحدث
                  </button>
                </div>
              </aside>
            )}
            <form
              className={styles.cardForm}
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                if (canEdit && !busy && newer === null) void save(close)
              }}
            >
              {/* A viewer's text fields are read-only rather than disabled: they still take the focus and scroll (long notes). */}
              <fieldset className={styles.bare}>
                <div className={admin.field}>
                  <label className={admin.label} htmlFor={`${id}-title-input`}>
                    العنوان
                  </label>
                  <input id={`${id}-title-input`} className={admin.input} value={form.title} readOnly={!canEdit} autoComplete="off" onChange={(event) => edit({ title: event.target.value })} {...invalid('title')} />
                  {field('title')}
                </div>

                <div className={styles.split}>
                  <fieldset disabled={!canEdit}>
                    <legend>الأولوية</legend>
                    <div className={styles.segmented}>
                      {PRIORITIES.map((priority) => (
                        <label key={priority} className={priority === 'urgent' ? styles.urgentChoice : undefined}>
                          <input type="radio" name={`${id}-priority`} value={priority} checked={form.priority === priority} onChange={() => edit({ priority })} />
                          {PRIORITY_LABELS[priority]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className={admin.field}>
                    <label className={admin.label} htmlFor={`${id}-due`}>
                      الموعد
                    </label>
                    <input id={`${id}-due`} type="date" className={`${admin.input} ${styles.ltr}`} value={form.dueOn} readOnly={!canEdit} onChange={(event) => edit({ dueOn: event.target.value })} {...invalid('due_on')} />
                    {field('due_on')}
                  </div>
                </div>

                {assignable.length > 0 && (
                  <fieldset disabled={!canEdit}>
                    <legend>الأشخاص</legend>
                    <div className={`${styles.checks} ${styles.peopleChecks}`}>
                      {assignable.map((person) => (
                        <label key={person.id} className={styles.check}>
                          <input type="checkbox" checked={form.people.includes(person.id)} onChange={(event) => edit({ people: toggle(form.people, person.id, event.target.checked) })} />
                          {person.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                {data.labels.length > 0 && (
                  <fieldset disabled={!canEdit}>
                    <legend>الوسوم</legend>
                    <div className={styles.checks}>
                      {data.labels.map((label) => (
                        <label key={label.id} className={styles.check}>
                          <input type="checkbox" checked={form.labels.includes(label.id)} onChange={(event) => edit({ labels: toggle(form.labels, label.id, event.target.checked) })} />
                          <span className={`${styles.tag} ${styles[label.tone]}`}>{label.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <div className={admin.field}>
                  <label className={admin.label} htmlFor={`${id}-notes`}>
                    الملاحظات
                  </label>
                  <textarea id={`${id}-notes`} className={admin.input} rows={4} value={form.notes} readOnly={!canEdit} onChange={(event) => edit({ notes: event.target.value })} {...invalid('notes')} />
                  {field('notes')}
                </div>

                <fieldset>
                  <legend>{checklistLegend}</legend>
                  <ul className={styles.checklist}>
                    {form.checklist.map((row, index) => (
                      <li key={row.key} className={row.done ? `${styles.checkRow} ${styles.itemDone}` : styles.checkRow}>
                        <label className={styles.tick}>
                          <input type="checkbox" checked={row.done} disabled={!canEdit} aria-labelledby={`${id}-row-${row.key}`} onChange={(event) => setRow(row.key, { done: event.target.checked })} />
                        </label>
                        <input
                          id={`${id}-row-${row.key}`}
                          type="text"
                          aria-label={`بند ${index + 1}`}
                          className={admin.input}
                          value={row.text}
                          readOnly={!canEdit}
                          autoComplete="off"
                          autoFocus={row.key === newRow}
                          onChange={(event) => setRow(row.key, { text: event.target.value })}
                        />
                        {canEdit && (
                          <button type="button" className={admin.buttonSecondary} onClick={() => setForm((current) => ({ ...current, checklist: current.checklist.filter((entry) => entry.key !== row.key) }))}>
                            إزالة
                          </button>
                        )}
                      </li>
                    ))}
                    {canEdit && (
                      <li className={styles.checkAdd}>
                        <button
                          type="button"
                          className={admin.buttonSecondary}
                          onClick={() => {
                            const key = crypto.randomUUID()
                            setNewRow(key)
                            setForm((current) => ({ ...current, checklist: [...current.checklist, { key, id: null, text: '', done: false }] }))
                          }}
                        >
                          بند جديد
                        </button>
                      </li>
                    )}
                  </ul>
                  {field('checklist')}
                </fieldset>

                <div className={admin.field}>
                  <label className={admin.label} htmlFor={`${id}-link`}>
                    مرتبطة بـ
                  </label>
                  <select id={`${id}-link`} className={admin.input} value={form.link} disabled={!canEdit} aria-busy={targets === null} onChange={(event) => edit({ link: event.target.value })}>
                    <option value="">غير مرتبطة</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {targets === 'failed' && <p className={`${admin.error} ${styles.fieldError}`}>{LOAD_FAILED}</p>}
                  <p className={admin.message}>الربط لا ينشر شيئًا ولا يغيّر حالة المنشور أو الغرفة.</p>
                </div>
              </fieldset>

              {message !== null && newer === null && (
                <p className={message.error ? admin.error : admin.message} role={message.error ? 'alert' : 'status'}>
                  {message.text}
                </p>
              )}
              <div className={styles.dialogActions}>
                {canEdit && (
                  <button type="submit" className={admin.button} disabled={busy || newer !== null}>
                    حفظ
                  </button>
                )}
                <button type="button" className={admin.buttonSecondary} onClick={close}>
                  إغلاق
                </button>
                {canEdit && (
                  <button type="button" className={`${admin.buttonSecondary} ${styles.end}`} disabled={busy || newer !== null} onClick={() => void archive(close)}>
                    أرشفة البطاقة
                  </button>
                )}
              </div>
            </form>
          </div>
        </>
      )}
    </Modal>
  )
}
