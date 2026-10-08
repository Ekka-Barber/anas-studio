'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Mark } from '@/components/weave/Action'
import { otpDigits } from '@/lib/digits'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { useTurnstile } from '@/lib/turnstile'

import styles from './admin.module.css'
import { stepUpError } from './StepUp'

/** The emailed code's length (`otp_length` in supabase/config.toml). */
const CODE_LENGTH = 8
const SENT_MESSAGE = 'إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رمزًا من 8 أرقام.'
const RATE_LIMITED_MESSAGE = 'أُرسلت رموز كثيرة في وقت قصير. انتظر قليلًا ثم اطلب رمزًا جديدًا.'
const OFFLINE_MESSAGE = 'تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.'
const SEND_FAILED_MESSAGE = 'تعذّر الإرسال الآن. حاول بعد قليل.'
const BAD_CODE_MESSAGE = 'الرمز غير صحيح أو انتهت صلاحيته.'
const CAPTCHA_MESSAGE = 'تعذّر التحقق من أنك لست روبوتًا؛ حدّث الصفحة وحاول مرة أخرى.'

/**
 * What step 1 says of Auth's answer to the request for a code, and the step that follows. Only an answer that says
 * nothing about the address varies the message: a request that never reached the server (no HTTP status), Auth's
 * rate limit, a refused Turnstile token (a 400 with the code `captcha_failed`: missing, expired or rejected, so
 * nothing was sent and the e-mail step stays) and a failure on Auth's side. Every other answer, a refusal for an
 * address that is no staff email included, is the masked «أرسلنا…».
 */
export function sendOutcome(error: { status?: number; code?: string } | null): { message: string; step: 'email' | 'code' } {
  if (error && !error.status) return { message: OFFLINE_MESSAGE, step: 'email' }
  if (error?.status === 429) return { message: RATE_LIMITED_MESSAGE, step: 'email' }
  if (error?.code === 'captcha_failed') return { message: CAPTCHA_MESSAGE, step: 'email' }
  // A failure on Auth's side (the mail could not be sent) says nothing about the address either, and no code is on its way.
  if (error?.status && error.status >= 500) return { message: SEND_FAILED_MESSAGE, step: 'email' }
  return { message: SENT_MESSAGE, step: 'code' }
}

/**
 * Passwordless staff sign-in (P03): an 8-digit email code, asked for behind
 * Turnstile, whose token Auth checks (`[auth.captcha]` in supabase/config.toml).
 * Step 1 never reveals whether the address is a staff email; only a rate
 * limit, the network or a failure on Auth's side varies the message. Google
 * appears only once `NEXT_PUBLIC_AUTH_GOOGLE=on`.
 */
export function SignIn() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const {
    box: turnstileBox,
    token: captchaToken,
    failed: turnstileFailed,
    reset: resetTurnstile,
    available: turnstileAvailable,
  } = useTurnstile('admin-sign-in')

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken },
    })
    // A token is accepted once, whatever the answer was: the next request needs a fresh one.
    resetTurnstile()
    setBusy(false)
    const outcome = sendOutcome(sendError)
    setMessage(outcome.message)
    if (outcome.step === 'code') setStep('code')
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setBusy(false)
    if (verifyError) {
      // A lost connection and Auth's attempt limit are not a wrong code.
      setError(stepUpError(verifyError.status, BAD_CODE_MESSAGE))
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
          {/* The button waits for Turnstile's token; without the widget (no
              site key, or its script failed) it stays off and says why. */}
          <div ref={turnstileBox} />
          {!turnstileAvailable && (
            <p className={styles.error} role="note">
              التحقق غير متاح حاليًا.
            </p>
          )}
          {turnstileFailed && (
            <p className={styles.error} role="note">
              تعذّر تحميل التحقق؛ حدّث الصفحة.
            </p>
          )}
          <button type="submit" className={styles.button} disabled={busy || !captchaToken}>
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
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(otpDigits(event.target.value, CODE_LENGTH))}
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
