'use client'

import { type FormEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ActionButton } from '@/components/weave/Action'
import { useTurnstile } from '@/lib/turnstile'

import styles from './contact.module.css'
import { servicePrefill } from './prefill'

type Field = 'name' | 'email' | 'message'
type Errors = Partial<Record<Field, string>>
const FIELDS: Field[] = ['name', 'email', 'message']

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The `contact` function refuses a body past 8 KiB (`MAX_BODY_BYTES` in supabase/functions/_shared/contact.ts). */
const MAX_BODY_BYTES = 8_192

type Values = { name: string; email: string; message: string; website: string }

/** The JSON the form sends: the fields trimmed, and the hidden field only when something filled it. */
function contactBody(values: Values, submissionKey: string, turnstileToken: string): string {
  return JSON.stringify({
    name: values.name.trim(),
    email: values.email.trim(),
    message: values.message.trim(),
    submissionKey,
    turnstileToken,
    ...(values.website ? { website: values.website } : {}),
  })
}

/**
 * Whether the request fits under the function's limit, measured as it is
 * sent: UTF-8 bytes of the JSON, where Arabic is two bytes a character and a
 * line break is written as two characters. The Turnstile token and the
 * submission key come after this check, so the margin is their longest:
 * Cloudflare's 2,048 characters and a UUID's 36 (EF-ACCESS-09).
 */
export function fitsContactLimit(values: Values): boolean {
  return new TextEncoder().encode(contactBody(values, '0'.repeat(36), '0'.repeat(2048))).length <= MAX_BODY_BYTES
}

/** The event a service's «اطلب جلسة» sends to put its name in the message. */
export const SERVICE_EVENT = 'anasaq:contact-service'

/** What the function's 422 says is wrong with a field the browser accepted. */
const REJECTED: Errors = {
  name: 'تأكد من كتابة الاسم بشكل صحيح.',
  email: 'تأكد من كتابة البريد بشكل صحيح.',
  message: 'تأكد من كتابة الرسالة بشكل صحيح.',
}

const noSubscribe = () => () => {}

/**
 * The contact form (D16, D31), wired to the `contact` Edge Function: name,
 * email and message, a hidden honeypot, Turnstile, and one submission key per
 * message so a double press stores it once. Errors sit under their fields and
 * the first one takes focus; the reply is announced in a live region. Nothing
 * claims the message arrived until the function says so.
 */
export function ContactForm() {
  const [values, setValues] = useState({ name: '', email: '', message: '', website: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'failed'; text: string }>({ kind: 'idle', text: '' })
  const submissionKey = useRef<string | null>(null)
  // The message the last «اطلب جلسة» put in, so the next service can replace it while it is untouched.
  const prefill = useRef('')
  // False in the static HTML and until React takes over: a native submit before then would send
  // the visitor's name, email and message in the address bar and lose them.
  const scripted = useSyncExternalStore(noSubscribe, () => true, () => false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const turnstile = useTurnstile('contact')
  const { box: turnstileBox, available: turnstileAvailable, failed: turnstileFailed } = turnstile

  // «اطلب جلسة» on a service: its name opens the message, and the message
  // field takes focus, ready for the rest.
  useEffect(() => {
    function onService(event: Event) {
      const name = (event as CustomEvent<string>).detail
      const text = `أرغب في جلسة استشارية: ${name}.\n`
      const previous = prefill.current
      prefill.current = text
      // An empty message, or one still exactly the previous service's line, is replaced; anything the visitor wrote stays.
      const { replace, resetKey } = servicePrefill(messageRef.current?.value ?? '', previous, text)
      if (replace) {
        // A different message is a different submission: it must not go out under the last one's key.
        if (resetKey) submissionKey.current = null
        setValues((v) => ({ ...v, message: text }))
      }
      setStatus({ kind: 'idle', text: '' })
      requestAnimationFrame(() => messageRef.current?.focus({ preventScroll: true }))
    }
    window.addEventListener(SERVICE_EVENT, onService)
    return () => window.removeEventListener(SERVICE_EVENT, onService)
  }, [])

  function update(field: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    if (field !== 'website') setErrors((e) => ({ ...e, [field]: undefined }))
    submissionKey.current = null
    if (status.kind === 'sent' || status.kind === 'failed') setStatus({ kind: 'idle', text: '' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (status.kind === 'sending') return
    const found: Errors = {}
    if (!values.name.trim()) found.name = 'اكتب اسمك.'
    if (!values.email.trim()) found.email = 'اكتب بريدك الإلكتروني.'
    else if (!EMAIL.test(values.email.trim())) found.email = 'تأكد من كتابة البريد بشكل صحيح.'
    if (!values.message.trim()) found.message = 'اكتب رسالتك.'
    else if (!fitsContactLimit(values)) found.message = 'رسالتك أطول من المسموح؛ اختصرها.'
    setErrors(found)
    const first = found.name ? nameRef : found.email ? emailRef : found.message ? messageRef : null
    if (first) {
      first.current?.focus()
      return
    }
    if (!turnstile.token) {
      setStatus({ kind: 'failed', text: 'أكمل التحقق من أنك لست آلياً، ثم أرسل.' })
      return
    }

    submissionKey.current ??= crypto.randomUUID()
    setStatus({ kind: 'sending', text: 'جارٍ الإرسال…' })
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: contactBody(values, submissionKey.current, turnstile.token),
      })
      const reply = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: { code: string; message: string; fields?: { fieldErrors?: Partial<Record<Field, string[]>> } }
      } | null
      if (reply?.ok || reply?.error?.code === 'CONFLICT') {
        setValues({ name: '', email: '', message: '', website: '' })
        submissionKey.current = null
        setStatus({ kind: 'sent', text: 'وصلت رسالتك. شكراً لك.' })
      } else {
        // The function's grammar is stricter than the browser's: mark the field it refused and put focus there.
        const refused = reply?.error?.code === 'INVALID' ? FIELDS.filter((f) => reply.error?.fields?.fieldErrors?.[f]?.length) : []
        if (refused.length > 0) {
          setErrors(Object.fromEntries(refused.map((f) => [f, REJECTED[f]])))
          const target = refused[0] === 'name' ? nameRef : refused[0] === 'email' ? emailRef : messageRef
          target.current?.focus()
        }
        setStatus({ kind: 'failed', text: reply?.error?.message ?? 'تعذّر إرسال الرسالة؛ حاول مرة أخرى.' })
      }
    } catch {
      setStatus({ kind: 'failed', text: 'تعذّر الاتصال؛ تحقق من الشبكة ثم أعد المحاولة.' })
    } finally {
      turnstile.reset()
    }
  }

  const field = (name: Field, label: string, input: ReactNode) => (
    <div className={styles.field}>
      <label htmlFor={`contact-${name}`} className={styles.label}>
        {label}
      </label>
      {input}
      <span id={`contact-${name}-error`} role="alert" className={styles.error}>
        {errors[name]}
      </span>
    </div>
  )

  return (
    <form id="contact-form" className={styles.form} noValidate onSubmit={submit} aria-label="راسلني">
      {field(
        'name',
        'الاسم',
        <input
          ref={nameRef}
          id="contact-name"
          name="name"
          dir="auto"
          autoComplete="name"
          maxLength={120}
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby="contact-name-error"
          className={styles.input}
        />,
      )}
      {field(
        'email',
        'البريد الإلكتروني',
        <input
          ref={emailRef}
          id="contact-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          maxLength={254}
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby="contact-email-error"
          className={`${styles.input} ${styles.ltr}`}
        />,
      )}
      {field(
        'message',
        'الرسالة',
        <textarea
          ref={messageRef}
          id="contact-message"
          name="message"
          dir="auto"
          rows={6}
          maxLength={5000}
          value={values.message}
          onChange={(e) => update('message', e.target.value)}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby="contact-message-error"
          className={`${styles.input} ${styles.textarea}`}
        />,
      )}
      {/* A field people never see; a bot that fills it is thanked and ignored. */}
      <div aria-hidden="true" className="visually-hidden">
        <label htmlFor="contact-website">اتركه فارغاً</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => update('website', e.target.value)} />
      </div>
      {turnstileAvailable ? (
        <div className={styles.turnstile} ref={turnstileBox} />
      ) : (
        <p className={styles.notice}>التحقق من المرسل غير مُعدّ بعد، فالإرسال متوقف مؤقتاً. راسلني عبر القنوات المجاورة.</p>
      )}
      {turnstileFailed && <p className={styles.notice}>تعذّر تحميل التحقق من المرسل. أعد تحميل الصفحة.</p>}
      <noscript>
        <p className={styles.notice}>الإرسال يحتاج JavaScript؛ راسلني عبر القنوات المجاورة.</p>
      </noscript>
      <div className={styles.submitRow}>
        {/* `disabled` for what cannot change by itself (no script, no check); while the message is being sent the button is
            aria-disabled so it keeps the focus (`submit` returns early when sending). */}
        <ActionButton type="submit" arrow disabled={!scripted || !turnstileAvailable} aria-disabled={status.kind === 'sending' || undefined}>
          أرسل
        </ActionButton>
        <p role="status" aria-live="polite" className={styles.status}>
          {status.text}
        </p>
      </div>
    </form>
  )
}
