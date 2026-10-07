'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import { useStaffRole } from './AdminShell'
import { StepUp } from './StepUp'
import styles from './admin.module.css'
import { ROLE_LABEL, type StaffRole } from './TableList'

type Member = {
  user_id: string
  email: string
  display_name: string
  role: StaffRole
  active: boolean
  has_totp: boolean
  created_at: string
}
/** What a successful action says on the screen's status line. */
export function doneText(body: Record<string, unknown>): string {
  if (body.action === 'invite') return 'أُرسلت الدعوة.'
  if (body.action === 'set_role') return 'غُيّر الدور.'
  return body.active === true ? 'استُعيد العضو.' : 'أُوقف العضو.'
}

/**
 * Owner-only team directory and actions (P03). Every mutation goes through
 * the `staff-admin` Edge Function; a `STEP_UP_REQUIRED` reply opens a fresh
 * TOTP challenge and the same action retries exactly once. A success is said
 * on the status line, a refusal in the function's own words on the alert line.
 */
export function TeamView() {
  const staffRole = useStaffRole()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState('')
  const [needsEnrollment, setNeedsEnrollment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepUp, setStepUp] = useState<{ factorId: string; body: Record<string, unknown> } | null>(null)
  const [roleEdits, setRoleEdits] = useState<Record<string, StaffRole>>({})
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<StaffRole>('editor')

  async function loadDirectory() {
    const supabase = getSupabaseBrowserClient()
    const { data, error } = await supabase.rpc('staff_directory')
    if (error) {
      // The owner's own revoke or demotion makes this reload fail with
      // insufficient_privilege: the table must not stay up with stale rows.
      if (error.code === '42501') {
        setMembers(null)
        setLoadError('لم تعد تملك صلاحية عرض الفريق. أعد تحميل الصفحة.')
        return
      }
      setLoadError('تعذّر تحميل الفريق.')
      return
    }
    setLoadError(null)
    setMembers((data as Member[]) ?? [])
  }

  useEffect(() => {
    if (staffRole !== 'owner') return
    void (async () => {
      await loadDirectory()
    })()
  }, [staffRole])

  function clearInvite() {
    setInviteEmail('')
    setInviteName('')
  }

  /** True only when the action succeeded; a step-up prompt or an error is false. */
  async function runAction(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setActionError(null)
    setDone('')
    setNeedsEnrollment(false)
    const result = await callFunction<unknown>('staff-admin', body)
    setBusy(false)
    if (result.ok) {
      setDone(doneText(body))
      await loadDirectory()
      return true
    }
    if (result.error.code === 'STEP_UP_REQUIRED') {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp.find((factor) => factor.status === 'verified')
      if (!verified) {
        setNeedsEnrollment(true)
        return false
      }
      setStepUp({ factorId: verified.id, body })
      return false
    }
    setActionError(result.error.message)
    // A refused action may still have changed the row (BAN_FAILED commits `active` first).
    await loadDirectory()
    return false
  }

  async function onStepUpVerified() {
    if (!stepUp) return
    const { body } = stepUp
    setStepUp(null)
    setBusy(true)
    setActionError(null)
    setDone('')
    const result = await callFunction<unknown>('staff-admin', body)
    setBusy(false)
    if (result.ok) {
      setDone(doneText(body))
      if (body.action === 'invite') clearInvite()
    } else {
      setActionError(result.error.message)
    }
    await loadDirectory()
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault()
    // A refused invite keeps what was typed; the owner corrects it and retries.
    if (await runAction({ action: 'invite', email: inviteEmail, displayName: inviteName, role: inviteRole })) clearInvite()
  }

  if (staffRole !== 'owner') {
    return (
      <div>
        <h1>الفريق</h1>
        <p className={styles.error}>هذه الصفحة للمالك فقط.</p>
      </div>
    )
  }

  if (members === null) {
    return (
      <div>
        <h1>الفريق</h1>
        {loadError ? (
          <p role="alert" className={styles.error}>
            {loadError}
          </p>
        ) : null}
      </div>
    )
  }

  // The team page is wide (AdminShell `wide`) and the table turns into cards
  // on phones, like the email screen: six columns inside the reading measure
  // scrolled sideways and hid the revoke button.
  return (
    <div>
      <h1>الفريق</h1>
      {/* A failed reload after an action leaves the old rows up: say so. */}
      {loadError && (
        <p role="alert" className={styles.error}>
          {loadError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.responsive}`}>
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>الدور</th>
              <th>الحالة</th>
              <th>تطبيق المصادقة</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const role = roleEdits[member.user_id] ?? member.role
              return (
                <tr key={member.user_id}>
                  <td dir="auto" data-label="الاسم">
                    {member.display_name}
                  </td>
                  <td dir="auto" data-label="البريد" className={styles.cellEllipsis} title={member.email}>
                    {member.email}
                  </td>
                  <td data-label="الدور">
                    <div className={styles.row}>
                      <select
                        className={styles.input}
                        aria-label={`دور ${member.display_name}`}
                        value={role}
                        disabled={busy}
                        onChange={(event) =>
                          setRoleEdits((prev) => ({ ...prev, [member.user_id]: event.target.value as StaffRole }))
                        }
                      >
                        {(Object.keys(ROLE_LABEL) as StaffRole[]).map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABEL[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
                        aria-label={`حفظ: ${member.display_name}`}
                        disabled={busy || role === member.role}
                        onClick={() => runAction({ action: 'set_role', userId: member.user_id, role })}
                      >
                        حفظ
                      </button>
                    </div>
                  </td>
                  <td data-label="الحالة" className={styles.cellNowrap}>
                    {member.active ? 'نشط' : 'موقوف'}
                  </td>
                  <td data-label="تطبيق المصادقة" className={styles.cellNowrap}>
                    {member.has_totp ? 'مفعّل' : 'غير مفعّل'}
                  </td>
                  <td data-label="إجراء">
                    <button
                      type="button"
                      className={`${styles.buttonSecondary} ${styles.cellNowrap}`}
                      aria-label={`${member.active ? 'إيقاف' : 'استعادة'}: ${member.display_name}`}
                      disabled={busy}
                      onClick={() => {
                        // A revoke bans the account at once, the caller's own row included.
                        if (member.active && !window.confirm(`إيقاف ${member.display_name}؟`)) return
                        void runAction({ action: 'set_active', userId: member.user_id, active: !member.active })
                      }}
                    >
                      {member.active ? 'إيقاف' : 'استعادة'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>دعوة عضو جديد</h2>
      <form className={styles.form} onSubmit={submitInvite}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-email">
            البريد الإلكتروني
          </label>
          <input
            id="invite-email"
            className={styles.input}
            type="email"
            dir="ltr"
            spellCheck={false}
            autoComplete="email"
            required
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-name">
            الاسم
          </label>
          <input
            id="invite-name"
            className={styles.input}
            type="text"
            required
            value={inviteName}
            onChange={(event) => setInviteName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invite-role">
            الدور
          </label>
          <select
            id="invite-role"
            className={styles.input}
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as StaffRole)}
          >
            {(Object.keys(ROLE_LABEL) as StaffRole[]).map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          دعوة
        </button>
      </form>

      {/* Always mounted, so a success is announced when it is written. */}
      <p role="status" className={styles.message}>
        {done}
      </p>
      {needsEnrollment && (
        <p role="alert" className={styles.error}>
          يلزم تفعيل تطبيق المصادقة أولًا. اذهب إلى <Link href="/admin/security">صفحة الأمان</Link>.
        </p>
      )}
      {actionError && (
        <p role="alert" className={styles.error}>
          {actionError}
        </p>
      )}

      {/* Always mounted: closing it calls dialog.close(), which returns focus to where the owner was. */}
      <StepUp
        open={stepUp !== null}
        factorId={stepUp?.factorId ?? ''}
        onVerified={onStepUpVerified}
        onClose={() => setStepUp(null)}
      />
    </div>
  )
}
