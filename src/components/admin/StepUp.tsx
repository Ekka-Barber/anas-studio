'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { otpDigits } from '@/lib/digits'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'

/**
 * What a failed check says, by its HTTP status: a request that never reached
 * Auth has none, 429 is Auth's limit on MFA attempts, anything else is the code
 * (`wrong` is the sentence for it: the sign-in's own says the code may have
 * expired). The three code checks (sign-in, enrolment, step-up) share this.
 */
export function stepUpError(status: number | undefined, wrong = 'الرمز غير صحيح.'): string {
  if (!status) return 'تعذّر الاتصال. حاول مرة أخرى.'
  return status === 429 ? 'محاولات كثيرة. انتظر دقيقة ثم حاول.' : wrong
}

/**
 * Owner step-up (D13): a native `<dialog>` that verifies a fresh TOTP code
 * against the owner's already-enrolled factor, then hands control back to
 * the caller, which retries the original `staff-admin` call once.
 */
export function StepUp({
  open,
  factorId,
  onVerified,
  onClose,
}: {
  open: boolean
  factorId: string
  onVerified: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    // The button stays focusable while the code is checked (aria-disabled), so a press, or Enter in the field, must send nothing.
    if (busy) return
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (verifyError) {
      setError(stepUpError(verifyError.status))
      return
    }
    setCode('')
    onVerified()
  }

  function cancel() {
    setCode('')
    setError(null)
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="التحقق بتطبيق المصادقة"
      onClose={() => {
        // Escape, cancel and a finished check all end here: the next opening starts clean.
        setCode('')
        setError(null)
        onClose()
      }}
    >
      <form className={styles.form} onSubmit={submit}>
        <p>يلزم رمز تطبيق المصادقة لإكمال هذا الإجراء.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="step-up-code">
            رمز التحقق
          </label>
          <input
            id="step-up-code"
            className={styles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(otpDigits(event.target.value))}
          />
        </div>
        <div className={styles.row}>
          {/* aria-disabled, not disabled: the button keeps the focus while its own check runs. */}
          <button type="submit" className={styles.button} aria-disabled={busy || undefined}>
            تحقق
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={cancel}>
            إلغاء
          </button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    </dialog>
  )
}
