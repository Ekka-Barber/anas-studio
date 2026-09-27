'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { StepUp } from './StepUp'
import styles from './admin.module.css'

type Role = 'owner' | 'editor' | 'operations'
type Member = {
  user_id: string
  email: string
  display_name: string
  role: Role
  active: boolean
  has_totp: boolean
  created_at: string
}
type ActionResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }

const ROLE_LABEL: Record<Role, string> = { owner: 'مالك', editor: 'محرر', operations: 'تشغيل' }

async function callStaffAdmin(body: Record<string, unknown>): Promise<ActionResult> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase.functions.invoke('staff-admin', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const parsed = await error.context.json()
        if (parsed?.error) return { ok: false, error: parsed.error }
      } catch {
        // fall through to the generic message below
      }
    }
    return { ok: false, error: { code: 'UNKNOWN', message: 'تعذّر الاتصال بالخادم.' } }
  }
  return data as ActionResult
}

/**
 * Owner-only team directory and actions (P03). Every mutation goes through
 * the `staff-admin` Edge Function; a `STEP_UP_REQUIRED` reply opens a fresh
 * TOTP challenge and the same action retries exactly once.
 */
export function TeamView() {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [needsEnrollment, setNeedsEnrollment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stepUp, setStepUp] = useState<{ factorId: string; body: Record<string, unknown> } | null>(null)
  const [roleEdits, setRoleEdits] = useState<Record<string, Role>>({})
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('editor')

  async function loadDirectory() {
    const supabase = getSupabaseBrowserClient()
    const { data, error } = await supabase.rpc('staff_directory')
    if (error) {
      setLoadError('تعذّر تحميل الفريق.')
      return
    }
    setLoadError(null)
    setMembers((data as Member[]) ?? [])
  }

  useEffect(() => {
    void (async () => {
      await loadDirectory()
    })()
  }, [])

  async function runAction(body: Record<string, unknown>) {
    setBusy(true)
    setActionError(null)
    setNeedsEnrollment(false)
    const result = await callStaffAdmin(body)
    setBusy(false)
    if (result.ok) {
      await loadDirectory()
      return
    }
    if (result.error.code === 'STEP_UP_REQUIRED') {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp.find((factor) => factor.status === 'verified')
      if (!verified) {
        setNeedsEnrollment(true)
        return
      }
      setStepUp({ factorId: verified.id, body })
      return
    }
    setActionError(result.error.message)
  }

  async function onStepUpVerified() {
    if (!stepUp) return
    const { body } = stepUp
    setStepUp(null)
    setBusy(true)
    setActionError(null)
    const result = await callStaffAdmin(body)
    setBusy(false)
    if (result.ok) {
      await loadDirectory()
    } else {
      setActionError(result.error.message)
    }
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault()
    await runAction({ action: 'invite', email: inviteEmail, displayName: inviteName, role: inviteRole })
    setInviteEmail('')
    setInviteName('')
  }

  if (members === null) {
    return (
      <div>
        <h1>الفريق</h1>
        {loadError ? <p className={styles.error}>{loadError}</p> : null}
      </div>
    )
  }

  // The team page is wide (AdminShell `wide`) and the table turns into cards
  // on phones, like the email screen: six columns inside the reading measure
  // scrolled sideways and hid the revoke button.
  return (
    <div>
      <h1>الفريق</h1>

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
                        value={role}
                        disabled={busy}
                        onChange={(event) =>
                          setRoleEdits((prev) => ({ ...prev, [member.user_id]: event.target.value as Role }))
                        }
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABEL[option]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.buttonSecondary}
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
                      disabled={busy}
                      onClick={() =>
                        runAction({ action: 'set_active', userId: member.user_id, active: !member.active })
                      }
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
            onChange={(event) => setInviteRole(event.target.value as Role)}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((option) => (
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

      {needsEnrollment && (
        <p className={styles.error}>
          يلزم تفعيل تطبيق المصادقة أولًا. اذهب إلى <Link href="/admin/security">صفحة الأمان</Link>.
        </p>
      )}
      {actionError && <p className={styles.error}>{actionError}</p>}

      {stepUp && (
        <StepUp
          open
          factorId={stepUp.factorId}
          onVerified={onStepUpVerified}
          onClose={() => setStepUp(null)}
        />
      )}
    </div>
  )
}
