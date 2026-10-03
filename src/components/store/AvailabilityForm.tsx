'use client'

/**
 * The availability sign-up under an out-of-stock variant (P08 contract
 * sections 6, 7 and 10): an email, Turnstile (action `notify`) and «أخبرني عند
 * توفره». It asks `notify` `subscribe`, and every 200 gets the same sentence,
 * whether the address is new, already confirmed or held back by a cap: the
 * form is replaced by it and the sentence takes the focus. The privacy policy
 * this build rendered is linked beside the button and its revision (`seq`)
 * travels with the request; with none published there is no link and the
 * revision is null. Nothing else is said of what is done with the address:
 * that wording is the owner's.
 *
 * Turnstile loads only once the form is focused or scrolled into view, never
 * with the page; its space is kept from the start, so the row does not move
 * when it arrives. A token is single-use: every attempt resets it. A refusal
 * keeps the form and says why in words, and the alert regions are in the page
 * before they have any. Calm and official: no motion, no icon.
 */
// Relative, not `@/`: the unit tests import `VariantAction`, which imports this file, and the unit config has no alias.
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { useTurnstile } from '../../lib/turnstile'
import { ActionButton } from '../weave/Action'

import styles from './store.module.css'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_ERROR = 'أدخل بريدًا إلكترونيًا صحيحًا.'
const SENT = 'إن لم تكن مشتركًا من قبل فستصلك رسالة لتأكيد الاشتراك.'
const NETWORK = 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.'

/**
 * `notify` `subscribe`, as the browser calls it: the function's envelope, and nothing of
 * `src/lib/orders.ts`, which a page carries whole (the product page's first script is at the public budget).
 * A rejected fetch, or a reply that is not JSON, throws: the caller treats it as a network failure.
 */
async function subscribe(body: unknown): Promise<{ status: number; sent: boolean; message: string }> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = (await response.json()) as { ok?: unknown; data?: unknown; error?: { message?: unknown } }
  const data = envelope.data
  // Judged by its exact shape (200 `{sent: true}`): a success that does not say so is not read as one.
  const sent =
    envelope.ok === true &&
    response.status === 200 &&
    typeof data === 'object' &&
    data !== null &&
    Object.keys(data).length === 1 &&
    (data as { sent?: unknown }).sent === true
  // A refusal says the function's own words when it sent some, else a short one; a success that is not one is the network sentence.
  const own = envelope.ok !== true && typeof envelope.error?.message === 'string' ? envelope.error.message : ''
  return { status: response.status, sent, message: own !== '' ? own : response.status === 429 ? 'حاول بعد قليل.' : NETWORK }
}

export function AvailabilityForm({
  variantId,
  label,
  privacyRevision,
}: {
  variantId: string
  /** The variant's name for the form's accessible name: «<product>: <variant>». */
  label: string
  /** The `seq` of the privacy policy this build rendered, or null while none is published. */
  privacyRevision: number | null
}) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  // Turnstile's script and widget wait for the form to be reached.
  const [armed, setArmed] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const sentRef = useRef<HTMLParagraphElement>(null)
  const { box: turnstileBox, token, failed: turnstileFailed, reset: resetTurnstile, available: turnstileAvailable } = useTurnstile('notify')

  // Scrolled into view: the other way to reach the form besides focus.
  useEffect(() => {
    const form = formRef.current
    if (armed || form === null || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setArmed(true)
    })
    watcher.observe(form)
    return () => watcher.disconnect()
  }, [armed])

  // The sentence replaces the form that had the focus: it takes it.
  useEffect(() => {
    if (sent) sentRef.current?.focus()
  }, [sent])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) {
      setProblem('')
      setEmailError(EMAIL_ERROR)
      emailRef.current?.focus()
      return
    }
    setEmailError('')
    if (token === '') {
      setProblem(turnstileFailed ? 'تعذّر تحميل التحقق؛ حدّث الصفحة.' : 'أكمل التحقق من أنك لست آلياً، ثم أرسل.')
      return
    }
    setProblem('')
    setBusy(true)
    try {
      const reply = await subscribe({ action: 'subscribe', variantId, email: address, consentRevision: privacyRevision, turnstileToken: token })
      if (reply.sent) {
        // The same sentence whatever the address has: the form is replaced by it.
        setSent(true)
      } else if (reply.status === 422) {
        setEmailError(EMAIL_ERROR)
        emailRef.current?.focus()
      } else {
        setProblem(reply.message)
      }
    } catch {
      setProblem(NETWORK)
    } finally {
      setBusy(false)
      // Siteverify accepts a token once, whatever the answer was: a retry needs a fresh one.
      resetTurnstile()
    }
  }

  return (
    <div className={styles.availability}>
      {/* In the page before it has words, so a screen reader announces it; once the form is gone it takes the focus. */}
      <p ref={sentRef} tabIndex={-1} role="status" aria-live="polite" className={sent ? styles.note : 'visually-hidden'}>
        {sent ? SENT : ''}
      </p>
      {!sent && (
        <form
          ref={formRef}
          className={styles.smallForm}
          onSubmit={submit}
          onFocus={() => setArmed(true)}
          noValidate
          aria-label={`أخبرني عند توفره: ${label}`}
        >
          <div className={styles.field}>
            <label htmlFor={`${id}-email`}>بريدك الإلكتروني</label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              type="email"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError('')
              }}
              aria-invalid={emailError !== '' ? true : undefined}
              aria-describedby={`${id}-email-error`}
            />
            <span id={`${id}-email-error`} className={styles.fieldError} role="alert">
              {emailError}
            </span>
          </div>
          <div className={styles.turnstileBox} ref={armed ? turnstileBox : undefined} />
          {!turnstileAvailable && (
            <p className={styles.warning} role="note">
              التحقق غير متاح حاليًا.
            </p>
          )}
          {turnstileFailed && (
            <p className={styles.warning} role="note">
              تعذّر تحميل التحقق؛ حدّث الصفحة.
            </p>
          )}
          <div>
            <div className={styles.formActions}>
              <ActionButton type="submit" disabled={!turnstileAvailable} aria-disabled={busy || undefined}>
                {busy ? 'جارٍ الإرسال…' : 'أخبرني عند توفره'}
              </ActionButton>
              {privacyRevision !== null && (
                // A new tab: what is typed here lives only in this page's state.
                <Link href="/policies/privacy" prefetch={false} target="_blank" rel="noopener" className={styles.plainLink}>
                  سياسة الخصوصية
                  <span className="visually-hidden"> (تفتح في نافذة جديدة)</span>
                </Link>
              )}
            </div>
            <p tabIndex={-1} role="alert" className={problem === '' ? 'visually-hidden' : styles.warning}>
              {problem}
            </p>
          </div>
        </form>
      )}
    </div>
  )
}
