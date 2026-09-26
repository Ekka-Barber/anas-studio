'use client'

/**
 * The contact inbox (P06 round 2): a client view reading `contacts` under
 * RLS (owner and operations). User text is always text — `dir="auto"` on the
 * message and email, never `dangerouslySetInnerHTML`. Opening a `new`
 * message marks it `read`; saving writes status, notes and assignment
 * through the Data API `.update()`.
 */
import { useEffect, useRef, useState } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { formatRiyadh } from './PublishBar'
import styles from './admin.module.css'

type ContactStatus = 'new' | 'read' | 'closed' | 'spam'

interface Contact {
  id: string
  name: string
  email: string
  message: string
  status: ContactStatus
  notes: string | null
  assigned_to: string | null
  created_at: string
}

const STATUS_LABEL: Record<ContactStatus, string> = { new: 'جديدة', read: 'مقروءة', closed: 'مغلقة', spam: 'مزعجة' }
const FILTERS: Array<'all' | ContactStatus> = ['all', 'new', 'read', 'closed', 'spam']
const FILTER_LABEL: Record<'all' | ContactStatus, string> = { all: 'الكل', ...STATUS_LABEL }
const PAGE_SIZE = 30
const MAILTO_SUBJECT = encodeURIComponent('رد: رسالتك إلى أنس')

export function InboxView() {
  const [filter, setFilter] = useState<'all' | ContactStatus>('all')
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusEdit, setStatusEdit] = useState<ContactStatus>('new')
  const [notesEdit, setNotesEdit] = useState('')
  const [assigned, setAssigned] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selectedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void getSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => setMyUserId(data.user?.id ?? null))
  }, [])

  async function loadPage(accumulated: Contact[], from: number) {
    const supabase = getSupabaseBrowserClient()
    let query = supabase.from('contacts').select('*').order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
    if (filter !== 'all') query = query.eq('status', filter)
    const { data, error } = await query
    if (error) {
      setLoadError(true)
      return
    }
    const rows = (data as Contact[]) ?? []
    setLoadError(false)
    setExhausted(rows.length < PAGE_SIZE)
    setContacts([...accumulated, ...rows])
  }

  useEffect(() => {
    // Deferred like CollectionForm's load, so no setState is synchronous in the effect body.
    void Promise.resolve().then(() => {
      setContacts(null)
      setSelectedId(null)
      setLoadError(false)
      void loadPage([], 0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  async function open(contact: Contact) {
    setSelectedId(contact.id)
    setStatusEdit(contact.status)
    setNotesEdit(contact.notes ?? '')
    setAssigned(contact.assigned_to)
    setSaveMessage(null)
    if (contact.status === 'new') {
      // Opening a new message marks it read automatically.
      const supabase = getSupabaseBrowserClient()
      const { error } = await supabase.from('contacts').update({ status: 'read' }).eq('id', contact.id)
      if (!error) {
        setContacts((rows) => rows?.map((row) => (row.id === contact.id ? { ...row, status: 'read' } : row)) ?? null)
        setStatusEdit('read')
      }
    }
    selectedRef.current?.querySelector('select')?.focus()
  }

  async function save() {
    if (!selectedId) return
    setSaving(true)
    setSaveMessage(null)
    const supabase = getSupabaseBrowserClient()
    const { error } = await supabase
      .from('contacts')
      .update({ status: statusEdit, notes: notesEdit === '' ? null : notesEdit, assigned_to: assigned })
      .eq('id', selectedId)
    setSaving(false)
    if (error) {
      setSaveMessage('تعذّر الحفظ.')
      return
    }
    setContacts(
      (rows) =>
        rows?.map((row) =>
          row.id === selectedId
            ? { ...row, status: statusEdit, notes: notesEdit === '' ? null : notesEdit, assigned_to: assigned }
            : row,
        ) ?? null,
    )
    setSaveMessage('حُفظ')
  }

  const selected = contacts?.find((row) => row.id === selectedId) ?? null

  return (
    <div>
      <h1>الوارد</h1>

      <div className={styles.row} role="group" aria-label="تصفية الحالة">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === filter ? styles.button : styles.buttonSecondary}
            aria-pressed={option === filter}
            onClick={() => setFilter(option)}
          >
            {FILTER_LABEL[option]}
          </button>
        ))}
      </div>

      {loadError && (
        <div className={styles.row}>
          <p className={styles.error}>تعذّر تحميل الرسائل.</p>
          <button type="button" className={styles.buttonSecondary} onClick={() => void loadPage([], 0)}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {!loadError && contacts !== null && contacts.length === 0 && <p className={styles.message}>لا توجد رسائل.</p>}

      {contacts !== null && contacts.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.responsive}`}>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>أول الرسالة</th>
                <th>الوقت</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className={contact.id === selectedId ? styles.rowSelected : undefined}>
                  <td data-label="الاسم">
                    <button type="button" className={styles.linkButton} onClick={() => open(contact)}>
                      <span dir="auto">{contact.name}</span>
                    </button>
                  </td>
                  <td dir="auto" data-label="البريد">
                    {contact.email}
                  </td>
                  <td
                    dir="auto"
                    data-label="أول الرسالة"
                    className={styles.cellEllipsis}
                    title={contact.message.split('\n')[0] || undefined}
                  >
                    {contact.message.split('\n')[0]}
                  </td>
                  <td data-label="الوقت">{formatRiyadh(contact.created_at)}</td>
                  <td data-label="الحالة">{STATUS_LABEL[contact.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {contacts !== null && !exhausted && contacts.length > 0 && (
        <button type="button" className={styles.buttonSecondary} onClick={() => loadPage(contacts, contacts.length)}>
          المزيد
        </button>
      )}

      {selected && (
        <div className={styles.fieldset} ref={selectedRef}>
          <h2 dir="auto">{selected.name}</h2>
          <p>
            <a dir="auto" href={`mailto:${encodeURIComponent(selected.email)}?subject=${MAILTO_SUBJECT}`}>
              {selected.email}
            </a>
          </p>
          <p dir="auto" className={styles.preWrap}>
            {selected.message}
          </p>
          <p className={styles.message}>{formatRiyadh(selected.created_at)}</p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="inbox-status">
              الحالة
            </label>
            <select
              id="inbox-status"
              className={styles.input}
              value={statusEdit}
              onChange={(event) => setStatusEdit(event.target.value as ContactStatus)}
            >
              {(Object.keys(STATUS_LABEL) as ContactStatus[]).map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="inbox-notes">
              ملاحظات
            </label>
            <textarea
              id="inbox-notes"
              className={styles.input}
              rows={4}
              value={notesEdit}
              onChange={(event) => setNotesEdit(event.target.value)}
            />
          </div>

          <div className={styles.row}>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => setAssigned(assigned === myUserId ? null : myUserId)}
            >
              {assigned === myUserId && myUserId ? 'إلغاء التعيين' : 'تعيين لي'}
            </button>
            <button type="button" className={styles.button} disabled={saving} onClick={save}>
              حفظ
            </button>
            {saveMessage && <span className={styles.message}>{saveMessage}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
