'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Mark } from '@/components/weave/Action'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

import styles from './admin.module.css'

const SENT_MESSAGE = 'إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رمزًا من 6 أرقام.'
const RATE_LIMITED_MESSAGE = 'أُرسلت رموز كثيرة في وقت قصير. انتظر قليلًا ثم اطلب رمزًا جديدًا.'
const BAD_CODE_MESSAGE = 'الرمز غير صحيح أو انتهت صلاحيته.'

/**
 * Passwordless staff sign-in (P03): a 6-digit email code. Step 1 never
 * reveals whether the address is a staff email; only a rate limit varies the
 * message. Google appears only once `NEXT_PUBLIC_AUTH_GOOGLE=on`.
 */
export function SignIn() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    setBusy(false)
    if (sendError?.status === 429) {
      setMessage(RATE_LIMITED_MESSAGE)
      return
    }
    setMessage(SENT_MESSAGE)
    setStep('code')
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setBusy(false)
    if (verifyError) {
      setError(BAD_CODE_MESSAGE)
      return
    }
    router.push('/admin')
  }

  async function signInWithGoogle() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/admin` },
    })
  }

  return (
    <main id="main" data-tone="sand" className={`${styles.page} ${styles.signIn}`}>
      <h1 className={`t-h3 ${styles.signInTitle}`}>
        <Mark />
        لوحة أنس
      </h1>
      {/* One status line for both steps, present from the start so a screen
          reader announces the code being sent and the rate limit. */}
      <p role="status" className={styles.message}>
        {message}
      </p>
      {step === 'email' ? (
        <form className={styles.form} onSubmit={submitEmail}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              className={styles.input}
              type="email"
              dir="ltr"
              spellCheck={false}
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button type="submit" className={styles.button} disabled={busy}>
            أرسل الرمز
          </button>
          {process.env.NEXT_PUBLIC_AUTH_GOOGLE === 'on' && (
            <button type="button" className={styles.buttonSecondary} onClick={signInWithGoogle}>
              الدخول عبر Google
            </button>
          )}
        </form>
      ) : (
        <form className={styles.form} onSubmit={submitCode}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              رمز الدخول
            </label>
            <input
              id="code"
              className={styles.input}
              inputMode="numeric"
              dir="ltr"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button type="submit" className={styles.button} disabled={busy}>
            تحقق
          </button>
          {/* The code lasts 10 minutes and the address may be mistyped: a way back to step 1. */}
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => {
              setStep('email')
              setCode('')
              setError(null)
              setMessage(null)
              requestAnimationFrame(() => document.getElementById('email')?.focus())
            }}
          >
            تغيير البريد أو طلب رمز جديد
          </button>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  )
}
