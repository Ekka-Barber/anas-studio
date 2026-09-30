'use client'

/**
 * The checkout screen (P07): the same live `quote` as the cart, shown as the
 * summary the buyer confirms. Digital-only carts see no phone, city or
 * address; physical and signed carts require all three. Policy consent links
 * the exact revisions the quote carried (the function rejects any other set
 * with POLICY_CHANGED). Turnstile renders explicitly with the site key and
 * action `checkout` into its box when the box mounts, and every create
 * attempt resets it: a token is single-use, so a retry gets a fresh one. A
 * missing site key disables submission honestly; otherwise the button stays
 * enabled, and a press before the check has finished waits for its token and
 * then submits. Errors sit under their fields, like the contact form's, and
 * the first invalid field takes focus.
 *
 * `create` sends one `checkoutSession` per tab and an `idempotencyKey` reused
 * only when retrying the identical request (a digest of it, kept with the key
 * in sessionStorage so a reload keeps the retry) after a network failure.
 * Success keeps `{orderNumber, accessToken}` in
 * sessionStorage only, never clears the cart (DATA step 5: nothing settles
 * before payment verification, P08) and offers «إلغاء الطلب».
 */

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import {
  checkoutSession,
  clearIdempotency,
  clearPendingOrder,
  CITY_KEY,
  COUPON_KEY,
  digestText,
  fingerprintCreate,
  readIdempotency,
  readPendingOrder,
  readSessionValue,
  toApiLines,
  writeIdempotency,
  writePendingOrder,
  writeSessionValue,
  type CartLine,
  type CreateRequestCore,
  type PendingOrder,
} from '@/lib/cart'
import { ActionButton } from '@/components/weave/Action'
import { formatMoney, normalizeSaudiMobile } from '@/lib/format'
import { useTurnstile } from '@/lib/turnstile'

import { useCart } from './CartProvider'
import { fetchCities, fetchQuote, orderSchema, postCheckout, priceSchema, quoteErrorMessage, type CityRate, type Quote } from './quote'
import styles from './store.module.css'

type Field = 'email' | 'name' | 'phone' | 'city' | 'address' | 'consent'

/** What a quote is for: the lines, city and coupon it priced. A quote with another key than the current one is stale. */
const quoteKeyOf = (lines: CartLine[], city: string, coupon: string) => JSON.stringify([toApiLines(lines), city, coupon])

const POLICY_LABELS: Record<string, string> = {
  store: 'سياسة المتجر',
  delivery: 'سياسة التوصيل',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية',
}

export function CheckoutForm() {
  const cartState = useCart()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteKey, setQuoteKey] = useState('')
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
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [orderTotal, setOrderTotal] = useState<number | null>(null)
  const [closed, setClosed] = useState<'cancelled' | 'expired' | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [awaitingToken, setAwaitingToken] = useState(false)

  const {
    box: turnstileBox,
    token,
    failed: turnstileFailed,
    reset: resetTurnstile,
    available: turnstileAvailable,
  } = useTurnstile('checkout')
  const quoteRun = useRef(0)
  const sessionRef = useRef<string | null>(null)
  const idempotencyRef = useRef<string | null>(null)
  const fingerprintRef = useRef<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const orderBoxRef = useRef<HTMLDivElement>(null)
  const focusOrderBox = useRef(false)

  useEffect(() => {
    // Deferred to a microtask so the setStates are not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => {
      setPending(readPendingOrder())
      // A reload keeps the retry of a request whose reply was lost.
      const kept = readIdempotency()
      if (kept !== null) {
        idempotencyRef.current = kept.key
        fingerprintRef.current = kept.digest
      }
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
  const currentKey = cart ? quoteKeyOf(cart.lines, city, coupon) : ''
  // Stale: the buyer changed the cart, city or coupon and the new quote is not in yet.
  const stale = quote !== null && !quoteFailed && quoteKey !== currentKey
  const waiting = awaitingToken && !turnstileFailed
  useEffect(() => {
    if (!ready || !cart) return
    if (cart.lines.length === 0) {
      // Same microtask deferral as above.
      void Promise.resolve().then(() => setQuote(null))
      return
    }
    const run = ++quoteRun.current
    const key = quoteKeyOf(cart.lines, city, coupon)
    const timer = setTimeout(() => {
      fetchQuote({ lines: toApiLines(cart.lines), cityKey: city || undefined, couponCode: coupon || undefined })
        .then((fresh) => {
          if (quoteRun.current !== run) return
          setQuote(fresh)
          setQuoteKey(key)
          setQuoteFailed(false)
        })
        .catch(() => {
          if (quoteRun.current !== run) return
          setQuoteFailed(true)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [ready, cart, city, coupon])

  // A press made before the check finished goes through once its token arrives.
  useEffect(() => {
    if (awaitingToken && token !== '') formRef.current?.requestSubmit()
  }, [awaitingToken, token])

  // Focus follows the buyer's own action (create, cancel) into the order box,
  // which replaces the form and the button that had it. Not on a page load.
  useEffect(() => {
    if (!focusOrderBox.current) return
    focusOrderBox.current = false
    orderBoxRef.current?.focus()
  }, [pending, closed])

  // In the store's own order (store, delivery, refund, privacy), not the
  // stored JSON's key order.
  const consentPolicies = useMemo(() => {
    const order = Object.keys(POLICY_LABELS)
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length)
    return Object.keys(quote?.policyRevisions ?? {}).sort((a, b) => rank(a) - rank(b))
  }, [quote])

  async function refreshQuote(): Promise<void> {
    if (!cart) return
    const run = ++quoteRun.current
    try {
      const fresh = await fetchQuote({ lines: toApiLines(cart.lines), cityKey: city || undefined, couponCode: coupon || undefined })
      if (quoteRun.current === run) {
        setQuote(fresh)
        setQuoteKey(currentKey)
        setQuoteFailed(false)
      }
    } catch {
      setQuoteFailed(true)
    }
  }

  function applyCoupon() {
    const applied = couponDraft.trim().toUpperCase()
    setCoupon(applied)
    writeSessionValue(COUPON_KEY, applied)
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!quote || !cart || submitting) return
    // In the fields' own order, so the first one found is the first on screen.
    const found: Partial<Record<Field, string>> = {}
    const trimmedEmail = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(trimmedEmail)) found.email = 'أدخل بريدًا إلكترونيًا صحيحًا.'
    if (!name.trim()) found.name = 'أدخل الاسم.'
    if (quote.physical) {
      if (normalizeSaudiMobile(phone) === null) found.phone = 'أدخل رقم جوال سعوديًا صحيحًا.'
      if (!city) found.city = 'اختر مدينة التوصيل.'
      if (address.replace(/\s+/g, ' ').trim().length < 5) found.address = 'أدخل عنوان التوصيل.'
    }
    if (!consent) found.consent = 'يجب الموافقة على السياسات.'
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first !== undefined) {
      setAwaitingToken(false)
      setSubmitError('')
      document.getElementById(`checkout-${first}`)?.focus()
      return
    }
    if (stale || !quote.ok) {
      // The summary already says why; a create now would only spend an attempt.
      setAwaitingToken(false)
      setSubmitError('راجع ملخص الطلب أولًا.')
      return
    }
    if (token === '') {
      if (turnstileFailed) {
        setSubmitError('تعذّر تحميل التحقق؛ حدّث الصفحة.')
      } else {
        setSubmitError('')
        setAwaitingToken(true)
      }
      return
    }
    setAwaitingToken(false)

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
    const fingerprint = digestText(fingerprintCreate(core))
    if (fingerprint !== fingerprintRef.current) {
      const key = crypto.randomUUID()
      idempotencyRef.current = key
      fingerprintRef.current = fingerprint
      writeIdempotency({ digest: fingerprint, key })
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
        if (order.status === 'expired' || order.status === 'cancelled') {
          // A duplicate reply for an order that already ended is no live hold:
          // show it closed, keep its token out of storage, mint a new key next time.
          clearIdempotency()
          idempotencyRef.current = null
          fingerprintRef.current = null
          focusOrderBox.current = true
          setPending({ orderNumber: order.orderNumber, accessToken: reply.data.accessToken ?? '' })
          setClosed(order.status)
          return
        }
        if (reply.data.accessToken) {
          const saved: PendingOrder = { orderNumber: order.orderNumber, accessToken: reply.data.accessToken }
          writePendingOrder(saved)
          focusOrderBox.current = true
          setPending(saved)
        }
        return
      }
      const error = reply.error
      if (error?.fields?.quote !== undefined) {
        // QUOTE_CHANGED or a cart refusal: re-render with the fresh quote (the
        // new total, or the cart's own errors) and ask the buyer to confirm.
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
      if (error?.code === 'INVALID') {
        // The function names the fields it refused: show them under their inputs.
        const fieldErrors = (error.fields?.fieldErrors ?? {}) as Record<string, unknown>
        const mapped: Partial<Record<Field, string>> = {}
        for (const field of ['email', 'name', 'phone', 'address'] as const) {
          const messages = fieldErrors[field]
          if (Array.isArray(messages) && typeof messages[0] === 'string') mapped[field] = messages[0]
        }
        const firstInvalid = Object.keys(mapped)[0]
        if (firstInvalid !== undefined) {
          setErrors(mapped)
          document.getElementById(`checkout-${firstInvalid}`)?.focus()
          return
        }
      }
      if (error?.code === 'ACTIVE_HOLD') {
        const mine = readPendingOrder()
        if (mine) {
          focusOrderBox.current = true
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
      // Siteverify accepts a token once, whatever the answer was, so the next
      // attempt (a retry with the same key included) needs a fresh one
      // (developers.cloudflare.com/turnstile/get-started/server-side-validation).
      resetTurnstile()
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
      // The function answers the order's status; a hold that already ran out
      // says `expired`, and anything else is no release this tab can show.
      const status = reply.data?.status
      if (reply.ok && (status === 'cancelled' || status === 'expired')) {
        clearPendingOrder()
        // The order has ended: its key must not be reused for a new one.
        clearIdempotency()
        idempotencyRef.current = null
        fingerprintRef.current = null
        focusOrderBox.current = true
        setClosed(status)
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
      <div ref={orderBoxRef} tabIndex={-1} role="group" aria-labelledby="checkout-order-number" className={styles.orderBox}>
        <p id="checkout-order-number" className={styles.orderNumber}>
          رقم الطلب: <span dir="ltr">{pending.orderNumber}</span>
        </p>
        {orderTotal !== null && <p>الإجمالي: {formatMoney(orderTotal)}</p>}
        {closed !== null ? (
          <>
            <p className={styles.note} role="status">
              {closed === 'expired' ? 'انتهت مدة حجز الطلب.' : 'أُلغي الطلب.'}
            </p>
            <Link href="/cart" prefetch={false} className={styles.plainLink}>
              العودة إلى السلة
            </Link>
          </>
        ) : (
          <>
            <p className={styles.note}>حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.</p>
            <ActionButton variant="outline" onClick={cancelOrder} disabled={submitting}>
              إلغاء الطلب
            </ActionButton>
          </>
        )}
        {submitError !== '' && <p className={styles.warning} role="alert">{submitError}</p>}
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

  if (quoteFailed && quote === null) {
    return (
      <div>
        <p className={styles.warning} role="alert">تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.</p>
        <ActionButton variant="outline" onClick={() => void refreshQuote()}>
          أعد المحاولة
        </ActionButton>
      </div>
    )
  }
  if (quote === null) {
    return <p className={styles.note}>جارٍ تسعير السلة…</p>
  }
  if (!quote.checkoutEnabled) {
    return <p className={styles.warning} role="note">الشراء غير متاح حاليًا، ويفتح قريبًا.</p>
  }

  const clear = (field: Field) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e))
  const described = (field: Field) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `checkout-${field}-error` } : {}
  const problem = (field: Field) =>
    errors[field] && (
      <span id={`checkout-${field}-error`} className={styles.fieldError}>
        {errors[field]}
      </span>
    )

  const consentSentence = (
    <span>
      قرأت{' '}
      {consentPolicies.map((id, index) => (
        <span key={id}>
          {index > 0 ? ' و' : ''}
          {/* A new tab: the typed details live only in this page's state. */}
          <Link href={`/policies/${id}`} prefetch={false} target="_blank" rel="noopener">
            {POLICY_LABELS[id] ?? id}
            <span className="visually-hidden"> (تفتح في نافذة جديدة)</span>
          </Link>
        </span>
      ))}{' '}
      وأوافق عليها
    </span>
  )

  return (
    <form ref={formRef} className={`${styles.form} ${styles.withSummary}`} onSubmit={submit} noValidate>
      {/* The summary comes first: on a phone it is read before the fields; from 1024 it is the panel beside them. */}
      <fieldset className={`${styles.fields} ${styles.summaryPanel}`}>
        <legend>ملخص الطلب</legend>
        <ul className={styles.summaryLines}>
          {quote.lines.map((line) => (
            <li key={line.variantId}>
              {line.productTitle}: {line.variantTitle} × {line.quantity}
              <span className={styles.summaryPrice}>{formatMoney(line.total)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.coupon}>
          <label className={styles.field}>
            كود الخصم
            <input
              type="text"
              dir="ltr"
              value={couponDraft}
              onChange={(e) => setCouponDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter applies the code; it must not submit the order.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyCoupon()
                }
              }}
            />
          </label>
          <ActionButton variant="outline" onClick={applyCoupon}>
            تطبيق
          </ActionButton>
        </div>
        <dl className={styles.totals}>
          <div>
            <dt>المجموع الفرعي</dt>
            <dd>{formatMoney(quote.subtotal)}</dd>
          </div>
          {quote.discount > 0 && (
            <div>
              <dt>الخصم</dt>
              <dd>{'\u200E−'}{formatMoney(quote.discount)}</dd>
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
        {!quote.ok && (
          <ul className={styles.lineErrors} role="alert">
            {quote.errors.map((error, i) => (
              <li key={i}>{quoteErrorMessage(error)}</li>
            ))}
          </ul>
        )}
        <Link href="/cart" prefetch={false} className={styles.plainLink}>
          تعديل السلة
        </Link>
      </fieldset>
      <div className={styles.formMain}>
        <fieldset className={styles.fields}>
          <legend>بيانات التواصل</legend>
          <div className={styles.field}>
            <label htmlFor="checkout-email">البريد الإلكتروني</label>
            <input
              id="checkout-email"
              type="email"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                clear('email')
              }}
              required
              {...described('email')}
            />
            {problem('email')}
          </div>
          <div className={styles.field}>
            <label htmlFor="checkout-name">الاسم</label>
            <input
              id="checkout-name"
              type="text"
              dir="auto"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clear('name')
              }}
              required
              {...described('name')}
            />
            {problem('name')}
          </div>
          {quote.physical && (
            <>
              <div className={styles.field}>
                <label htmlFor="checkout-phone">رقم الجوال</label>
                <input
                  id="checkout-phone"
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    clear('phone')
                  }}
                  required
                  {...described('phone')}
                />
                {problem('phone')}
              </div>
              <div className={styles.field}>
                <label htmlFor="checkout-city">مدينة التوصيل</label>
                <select
                  id="checkout-city"
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value)
                    writeSessionValue(CITY_KEY, e.target.value)
                    clear('city')
                  }}
                  required
                  {...described('city')}
                >
                  <option value="">اختر المدينة</option>
                  {cities.map((rate) => (
                    <option key={rate.city_key} value={rate.city_key}>
                      {rate.name_ar}
                    </option>
                  ))}
                </select>
                {problem('city')}
              </div>
              <div className={styles.field}>
                <label htmlFor="checkout-address">عنوان التوصيل</label>
                <textarea
                  id="checkout-address"
                  rows={3}
                  dir="auto"
                  autoComplete="shipping street-address"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value)
                    clear('address')
                  }}
                  maxLength={500}
                  required
                  {...described('address')}
                />
                {problem('address')}
              </div>
            </>
          )}
        </fieldset>
        <div>
          <label className={styles.consent}>
            <input
              id="checkout-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked)
                clear('consent')
              }}
              {...described('consent')}
            />
            {consentSentence}
          </label>
          {problem('consent')}
        </div>

        <div className={styles.turnstileBox} ref={turnstileBox} />
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

        {quoteFailed && (
          <p className={styles.warning} role="alert">
            تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.
          </p>
        )}
        {submitError !== '' && (
          <p className={styles.warning} role="alert">
            {submitError}
          </p>
        )}
        <ActionButton type="submit" className={styles.submit} disabled={!turnstileAvailable || submitting || waiting || stale}>
          {submitting || waiting ? 'جارٍ الإرسال…' : 'تأكيد الطلب'}
        </ActionButton>
      </div>
    </form>
  )
}
