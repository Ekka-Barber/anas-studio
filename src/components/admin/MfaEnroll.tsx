'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { otpDigits } from '@/lib/digits'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import { useStaffRole } from './AdminShell'
import styles from './admin.module.css'

type Enrollment = { factorId: string; qrCode: string; secret: string }
type State =
  | { status: 'loading' }
  | { status: 'enrolled' }
  | { status: 'enrolling'; enrollment: Enrollment }
  | { status: 'error' }

/**
 * Owner TOTP enrolment (P03/D13): step-up for invite, role change and
 * revoke relies on a verified factor here. A stale unverified enrolment is
 * cleared before a fresh one is created, so retrying never piles up factors.
 */
export function MfaEnroll() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const role = useStaffRole()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [justEnabled, setJustEnabled] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = getSupabaseBrowserClient()
      const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors()
      if (!active) return
      if (factorError) {
        setState({ status: 'error' })
        return
      }
      const verified = factorData.all.find((f) => f.factor_type === 'totp' && f.status === 'verified')
      if (verified) {
        setState({ status: 'enrolled' })
        return
      }
      const stale = factorData.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified')
      for (const factor of stale) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (!active) return
      if (enrollError || enrolled.type !== 'totp') {
        setState({ status: 'error' })
        return
      }
      setState({
        status: 'enrolling',
        enrollment: { factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret },
      })
    }
    load()
    return () => {
      active = false
    }
  }, [])

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (state.status !== 'enrolling') return
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: state.enrollment.factorId,
      code,
    })
    setBusy(false)
    if (verifyError) {
      setError('الرمز غير صحيح.')
      return
    }
    setState({ status: 'enrolled' })
    setJustEnabled(true)
    // The form vanishes with this state: focus goes to the heading, not to <body>.
    headingRef.current?.focus()
  }

  if (state.status === 'loading') return null

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        الأمان
      </h1>
      {/* Mounted in every state: the form it reports on vanishes on success, and a
          region inserted together with its text is not reliably announced. */}
      <p role="status" className={styles.message}>
        {justEnabled ? 'تم تفعيل تطبيق المصادقة.' : null}
      </p>
      {state.status === 'error' && <p className={styles.error}>تعذّر تحميل بيانات المصادقة. حاول مرة أخرى.</p>}
      {state.status === 'enrolled' && (
        <>
          <p>تطبيق المصادقة مفعّل.</p>
          {role === 'owner' && <p className={styles.message}>مطلوب لتفعيل إجراءات الفريق: الدعوة وتغيير الدور والإيقاف.</p>}
        </>
      )}
      {state.status === 'enrolling' && (
        <>
          <p>امسح رمز الاستجابة السريعة بتطبيق المصادقة، أو أدخل الرمز السري يدويًا.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer (D15, D32); the QR code is a data URL */}
          <img className={styles.qr} src={state.enrollment.qrCode} alt="رمز الاستجابة السريعة لتطبيق المصادقة" />
          <p>
            <span className={styles.secret}>{state.enrollment.secret}</span>
          </p>
          <form className={styles.form} onSubmit={verify}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="totp-code">
                رمز التحقق
              </label>
              <input
                id="totp-code"
                className={styles.input}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(otpDigits(event.target.value))}
              />
            </div>
            <button type="submit" className={styles.button} disabled={busy}>
              تفعيل
            </button>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  )
}
