'use client'

/**
 * The checkout screen (P07): the same live `quote` as the cart, shown as the
 * summary the buyer confirms. Digital-only carts see no phone, city or
 * address; physical and signed carts require all three. Policy consent links
 * the exact revisions the quote carried (the function rejects any other set
 * with POLICY_CHANGED). Turnstile renders explicitly with the site key and
 * action `checkout`; a missing site key disables submission honestly.
 *
 * `create` sends one `checkoutSession` per tab and an `idempotencyKey` reused
 * only when retrying the identical request (fingerprint in component state)
 * after a network failure. Success keeps `{orderNumber, accessToken}` in
 * sessionStorage only, never clears the cart (DATA step 5: nothing settles
 * before payment verification, P08) and offers «إلغاء الطلب».
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import {
  checkoutSession,
  clearPendingOrder,
  CITY_KEY,
  COUPON_KEY,
  fingerprintCreate,
  readPendingOrder,
  readSessionValue,
  toApiLines,
  writePendingOrder,
  writeSessionValue,
  type CreateRequestCore,
  type PendingOrder,
} from '@/lib/cart'
import { formatMoney, normalizeSaudiMobile } from '@/lib/format'

import { useCart } from './CartProvider'
import { fetchCities, fetchQuote, orderSchema, postCheckout, priceSchema, quoteSchema, type CityRate, type Quote } from './quote'
import styles from './store.module.css'

const POLICY_LABELS: Record<string, string> = {
  store: 'سياسة المتجر',
  delivery: 'سياسة التوصيل',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية',
}

/**
 * Loads the Turnstile script once per page with explicit rendering
 * (`…/turnstile/v0/api.js?render=explicit&onload=…`, the documented explicit
 * mode: developers.cloudflare.com/turnstile/get-started/client-side-rendering).
 */
let turnstileScript: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  const existing = (window as unknown as { turnstile?: unknown }).turnstile
  if (existing) return Promise.resolve()
  if (turnstileScript === null) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const global = window as unknown as Record<string, unknown>
      global.__anasaqTurnstileOnload = () => resolve()
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__anasaqTurnstileOnload'
      script.async = true
      script.onerror = () => reject(new Error('turnstile script failed to load'))
      document.head.appendChild(script)
    })
  }
  return turnstileScript
}

export function CheckoutForm() {
  const cartState = useCart()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [cities, setCities] = useState<CityRate[]>([])
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [couponDraft, setCouponDraft] = useState('')
  const [coupon, setCoupon] = useState('')
  const [consent, setConsent] = useState(false)
  const [token, setToken] = useState('')
  const [turnstile, setTurnstile] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading')
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [orderTotal, setOrderTotal] = useState<number | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const widgetBox = useRef<HTMLDivElement | null>(null)
  const quoteRun = useRef(0)
  const sessionRef = useRef<string | null>(null)
  const idempotencyRef = useRef<string | null>(null)
  const fingerprintRef = useRef<string | null>(null)

  useEffect(() => {
    // Deferred to a microtask so the setStates are not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => {
      setPending(readPendingOrder())
      const savedCity = readSessionValue(CITY_KEY)
      if (savedCity) setCity(savedCity)
      const savedCoupon = readSessionValue(COUPON_KEY)
      if (savedCoupon) {
        setCoupon(savedCoupon)
        setCouponDraft(savedCoupon)
      }
    })
    fetchCities().then(setCities).catch(() => setCities([]))
  }, [])

  // The live quote, debounced like the cart's.
  const cart = cartState?.cart
  const ready = cartState?.ready ?? false
  useEffect(() => {
    if (!ready || !cart) return
    if (cart.lines.length === 0) {
      // Same microtask deferral as above.
      void Promise.resolve().then(() => setQuote(null))
      return
    }
    const run = ++quoteRun.current
    const timer = setTimeout(() => {
      fetchQuote({ lines: toApiLines(cart.lines), cityKey: city || undefined, couponCode: coupon || undefined })
        .then((fresh) => {
          if (quoteRun.current !== run) return
          setQuote(fresh)
          setQuoteFailed(false)
        })
        .catch(() => {
          if (quoteRun.current !== run) return
          setQuoteFailed(true)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [ready, cart, city, coupon])

  // The Turnstile widget, rendered explicitly.
  useEffect(() => {
    if (!siteKey) {
      // Same microtask deferral as above.
      void Promise.resolve().then(() => setTurnstile('missing'))
      return
    }
    let widgetId: string | undefined
    let cancelled = false
    loadTurnstile()
      .then(() => {
        const api = (window as unknown as {
          turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void }
        }).turnstile
        if (cancelled || !api || !widgetBox.current) {
          if (!api) setTurnstile('failed')
          return
        }
        widgetId = api.render(widgetBox.current, {
          sitekey: siteKey,
          action: 'checkout',
          callback: (value: string) => setToken(value),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
        setTurnstile('ready')
      })
      .catch(() => setTurnstile('failed'))
    return () => {
      cancelled = true
      if (widgetId !== undefined) {
        ;(window as unknown as { turnstile?: { remove: (id: string) => void } }).turnstile?.remove(widgetId)
      }
    }
  }, [siteKey])

  const consentPolicies = useMemo(() => Object.keys(quote?.policyRevisions ?? {}), [quote])

  async function refreshQuote(): Promise<void> {
    if (!cart) return
    const run = ++quoteRun.current
    try {
      const fresh = await fetchQuote({ lines: toApiLines(cart.lines), cityKey: city || undefined, couponCode: coupon || undefined })
      if (quoteRun.current === run) {
        setQuote(fresh)
        setQuoteFailed(false)
      }
    } catch {
      setQuoteFailed(true)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!quote || !cart || submitting) return
    const problems: string[] = []
    const trimmedEmail = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) problems.push('أدخل بريدًا إلكترونيًا صحيحًا.')
    if (!name.trim()) problems.push('أدخل الاسم.')
    if (quote.physical) {
      if (normalizeSaudiMobile(phone) === null) problems.push('أدخل رقم جوال سعوديًا صحيحًا.')
      if (address.replace(/\s+/g, ' ').trim().length < 5) problems.push('أدخل عنوان التوصيل.')
    }
    if (!consent) problems.push('يجب الموافقة على السياسات.')
    if (problems.length > 0) {
      setSubmitError(problems.join(' '))
      return
    }

    const core: CreateRequestCore = {
      lines: toApiLines(cart.lines),
      cityKey: city || undefined,
      address: quote.physical ? address : undefined,
      couponCode: coupon || undefined,
      email: trimmedEmail,
      name,
      phone: phone.trim() || undefined,
      policyRevisions: quote.policyRevisions,
      quoteHash: quote.quoteHash,
    }
    // Reuse the idempotency key only for the identical request (a retry after
    // a network failure); any change to the request mints a new key.
    const fingerprint = fingerprintCreate(core)
    if (fingerprint !== fingerprintRef.current) {
      idempotencyRef.current = crypto.randomUUID()
      fingerprintRef.current = fingerprint
    }
    sessionRef.current ??= checkoutSession()

    setSubmitting(true)
    setSubmitError('')
    try {
      const reply = await postCheckout<{ order: unknown; accessToken?: string }>({
        action: 'create',
        idempotencyKey: idempotencyRef.current,
        checkoutSession: sessionRef.current,
        ...core,
        turnstileToken: token,
      })
      if (reply.ok && reply.data !== undefined) {
        const order = orderSchema.parse(reply.data.order)
        setOrderTotal(order.total)
        if (reply.data.accessToken) {
          const saved: PendingOrder = { orderNumber: order.orderNumber, accessToken: reply.data.accessToken }
          writePendingOrder(saved)
          setPending(saved)
        }
        return
      }
      const error = reply.error
      if (error?.code === 'QUOTE_CHANGED' && error.fields?.quote !== undefined) {
        // Re-render with the fresh quote and ask the buyer to confirm the new total.
        const fresh = priceSchema.parse(error.fields.quote)
        setQuote({ ...fresh, checkoutEnabled: quote.checkoutEnabled, policyRevisions: quote.policyRevisions })
        setSubmitError(error.message)
        return
      }
      if (error?.code === 'POLICY_CHANGED') {
        await refreshQuote()
        setConsent(false)
        setSubmitError(error.message)
        return
      }
      if (error?.code === 'ACTIVE_HOLD') {
        const mine = readPendingOrder()
        if (mine) {
          setPending(mine)
          setSubmitError('')
          return
        }
      }
      setSubmitError(error?.message ?? 'تعذّر إتمام الطلب.')
    } catch {
      // A network failure keeps the form; the retry reuses the same key.
      setSubmitError('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelOrder(): Promise<void> {
    if (pending === null || submitting) return
    setSubmitting(true)
    try {
      const reply = await postCheckout<{ status: string }>({
        action: 'cancel',
        orderNumber: pending.orderNumber,
        accessToken: pending.accessToken,
      })
      if (reply.ok) {
        clearPendingOrder()
        setCancelled(true)
        setSubmitError('')
      } else {
        setSubmitError(reply.error?.message ?? 'تعذّر إلغاء الطلب.')
      }
    } catch {
      setSubmitError('تعذّر الاتصال بالخدمة؛ أعد المحاولة.')
    } finally {
      setSubmitting(false)
    }
  }

  if (cartState === null || !cartState.ready) {
    return <p className={styles.note}>جارٍ تحميل الطلب…</p>
  }

  // A pending order this tab created: the hold view, with its cancel.
  if (pending !== null) {
    return (
      <div className={styles.orderBox}>
        <p className={styles.orderNumber}>
          رقم الطلب: <span dir="ltr">{pending.orderNumber}</span>
        </p>
        {orderTotal !== null && <p>الإجمالي: {formatMoney(orderTotal)}</p>}
        {cancelled ? (
          <p className={styles.note} role="status">
            أُلغي الطلب.
          </p>
        ) : (
          <>
            <p className={styles.note}>حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.</p>
            <button type="button" className={styles.button} onClick={cancelOrder} disabled={submitting}>
              إلغاء الطلب
            </button>
          </>
        )}
        {submitError !== '' && <p className={styles.warning} role="note">{submitError}</p>}
      </div>
    )
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div>
        <p className={styles.note}>سلتك فارغة.</p>
        <Link href="/store" prefetch={false} className={styles.plainLink}>
          العودة إلى المتجر
        </Link>
      </div>
    )
  }

  if (quoteFailed) {
    return <p className={styles.warning} role="note">تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.</p>
  }
  if (quote === null) {
    return <p className={styles.note}>جارٍ تسعير السلة…</p>
  }
  if (!quote.checkoutEnabled) {
    return <p className={styles.warning} role="note">الشراء غير متاح حاليًا، ويفتح قريبًا.</p>
  }

  const consentSentence = (
    <span>
      قرأت{' '}
      {consentPolicies.map((id, index) => (
        <span key={id}>
          {index > 0 ? ' و' : ''}
          <Link href={`/policies/${id}`} prefetch={false}>
            {POLICY_LABELS[id] ?? id}
          </Link>
        </span>
      ))}{' '}
      وأوافق عليها
    </span>
  )

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <fieldset className={styles.fields}>
        <legend>بيانات التواصل</legend>
        <label className={styles.field}>
          البريد الإلكتروني
          <input type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className={styles.field}>
          الاسم
          <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        {quote.physical && (
          <>
            <label className={styles.field}>
              رقم الجوال
              <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </label>
            <label className={styles.field}>
              مدينة التوصيل
              <select
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                  writeSessionValue(CITY_KEY, e.target.value)
                }}
                required
              >
                <option value="">اختر المدينة</option>
                {cities.map((rate) => (
                  <option key={rate.city_key} value={rate.city_key}>
                    {rate.name_ar}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              عنوان التوصيل
              <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={2000} required />
            </label>
          </>
        )}
        <div className={styles.coupon}>
          <label className={styles.field}>
            كود الخصم
            <input type="text" dir="ltr" value={couponDraft} onChange={(e) => setCouponDraft(e.target.value)} />
          </label>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              const applied = couponDraft.trim().toUpperCase()
              setCoupon(applied)
              writeSessionValue(COUPON_KEY, applied)
            }}
          >
            تطبيق
          </button>
        </div>
      </fieldset>

      <fieldset className={styles.fields}>
        <legend>ملخص الطلب</legend>
        <ul className={styles.summaryLines}>
          {quote.lines.map((line) => (
            <li key={line.variantId}>
              {line.productTitle}: {line.variantTitle} × {line.quantity}
              <span className={styles.summaryPrice}>{formatMoney(line.total)}</span>
            </li>
          ))}
        </ul>
        <dl className={styles.totals}>
          <div>
            <dt>المجموع الفرعي</dt>
            <dd>{formatMoney(quote.subtotal)}</dd>
          </div>
          {quote.discount > 0 && (
            <div>
              <dt>الخصم</dt>
              <dd>−{formatMoney(quote.discount)}</dd>
            </div>
          )}
          {quote.city !== null && (
            <div>
              <dt>التوصيل</dt>
              <dd>{formatMoney(quote.shipping)}</dd>
            </div>
          )}
          <div className={styles.totalRow}>
            <dt>الإجمالي</dt>
            <dd>{formatMoney(quote.total)}</dd>
          </div>
        </dl>
      </fieldset>

      <label className={styles.consent}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {consentSentence}
      </label>

      <div className={styles.turnstileBox} ref={widgetBox} />
      {turnstile === 'missing' && (
        <p className={styles.warning} role="note">
          التحقق غير متاح حاليًا.
        </p>
      )}
      {turnstile === 'failed' && (
        <p className={styles.warning} role="note">
          تعذّر تحميل التحقق؛ حدّث الصفحة.
        </p>
      )}

      {submitError !== '' && (
        <p className={styles.warning} role="alert">
          {submitError}
        </p>
      )}
      <button type="submit" className={styles.button} disabled={turnstile === 'missing' || token === '' || submitting}>
        {submitting ? 'جارٍ الإرسال…' : 'تأكيد الطلب'}
      </button>
    </form>
  )
}
