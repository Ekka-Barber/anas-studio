'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'

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
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (verifyError) {
      setError('الرمز غير صحيح.')
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
    <dialog ref={dialogRef} className={styles.dialog} onClose={onClose}>
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
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={busy}>
            تحقق
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={cancel}>
            إلغاء
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </dialog>
  )
}
