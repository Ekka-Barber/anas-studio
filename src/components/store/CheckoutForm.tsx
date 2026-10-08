'use client'

/**
 * The checkout screen (P07, P08): the same live `quote` as the cart, shown as
 * the summary the buyer confirms. Digital-only carts see no phone, city or
 * address, and send no phone (one typed before the cart changed is dropped);
 * physical and signed carts require all three. Policy consent links
 * the exact revisions the quote carried; what `create` sends are the revisions
 * this build rendered (`builtRevisions`, from `src/lib/policies.ts`), and while
 * they differ from the quote's the policies are being updated and the button
 * stays off (the function rejects any other set with POLICY_CHANGED).
 * Turnstile renders explicitly with the site key and
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
 * Success keeps `{orderNumber, accessToken}` and a digest of the lines the order
 * was made from in sessionStorage only, and never clears the cart (DATA step 5:
 * nothing settles before payment verification). The hold view (`HoldView.tsx`,
 * loaded on demand: the page's first script is at the public budget) then shows
 * the order, the time the hold ends and, per the reply's `payment`, «ادفع الآن»
 * (a plain link to the invoice), a retry (`pay`) or why payment cannot start; after a reload one
 * `pay` brings the same view back. It tells this form when the order ends
 * (cancelled, expired, hold over) or is not found, and the stored order is
 * forgotten then; it is kept when a payment of it arrived: the return page
 * clears the cart and the order on `paid`. A preorder line shows its date and
 * note in the summary before the buyer confirms. When the cart is no longer what
 * the stored order was made from (its digest), or an ACTIVE_HOLD handed back an
 * order for another request, the hold view says the order was made before the
 * buyer's edit (`orderChanged`, `heldOrder` in `src/lib/cart.ts`).
 */

import Link from 'next/link'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, FormEvent } from 'react'

import {
  builtPolicyRevisions,
  checkoutSession,
  clearIdempotency,
  clearPendingOrder,
  CITY_KEY,
  COUPON_KEY,
  digestText,
  fingerprintCreate,
  formatRiyadhTime,
  handedLinesDigest,
  heldOrder,
  instantOf,
  linesDigest,
  MAX_COUPON,
  normalizeCoupon,
  orderChanged,
  pendingOrderOf,
  phoneToSend,
  readIdempotency,
  readPendingOrder,
  readSavedCoupon,
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
import type { HoldStart, HoldView as HoldViewComponent } from './HoldView'
import {
  fetchCities,
  fetchQuote,
  orderSchema,
  parsePayment,
  postCheckout,
  preorderSentence,
  priceSchema,
  quoteErrorMessage,
  RECEIVED,
  type CityRate,
  type Quote,
} from './quote'
import styles from './store.module.css'

// What the buyer sees only after `create` is its own chunk: the checkout page's first script is at the public budget.
// The fallback is the sentence the page already shows while the cart is read. When the chunk cannot be loaded (the
// connection, or the site changed since this page was opened) the order is still kept in this tab, so a reload brings
// the view back through `pay`.
function HoldViewLost(_props: ComponentProps<typeof HoldViewComponent>) {
  return (
    <p className={styles.warning} role="alert">
      تعذّر تحميل الطلب؛ حدّث الصفحة.
    </p>
  )
}
const HoldView = lazy(() =>
  import('./HoldView').then((module) => ({ default: module.HoldView })).catch(() => ({ default: HoldViewLost })),
)

type Field = 'email' | 'name' | 'phone' | 'city' | 'address' | 'consent'

/** What a quote is for: the lines, city and coupon it priced. A quote with another key than the current one is stale. */
const quoteKeyOf = (lines: CartLine[], city: string, coupon: string) => JSON.stringify([toApiLines(lines), city, coupon])

/** What sits under a field that failed, here or at the function (whose own text is English). */
const FIELD_ERRORS: Record<Field, string> = {
  email: 'أدخل بريدًا إلكترونيًا صحيحًا.',
  name: 'أدخل الاسم.',
  phone: 'أدخل رقم جوال سعوديًا صحيحًا.',
  city: 'اختر مدينة التوصيل.',
  address: 'أدخل عنوان التوصيل.',
  consent: 'يجب الموافقة على السياسات.',
}

const POLICY_LABELS: Record<string, string> = {
  store: 'سياسة المتجر',
  delivery: 'سياسة التوصيل',
  refund: 'سياسة الاسترجاع',
  privacy: 'سياسة الخصوصية',
}

export function CheckoutForm({ builtRevisions }: { builtRevisions: Record<string, number> }) {
  const cartState = useCart()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteKey, setQuoteKey] = useState('')
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [cities, setCities] = useState<CityRate[]>([])
  const [citiesState, setCitiesState] = useState<'loading' | 'failed' | 'loaded'>('loading')
  const [citiesTry, setCitiesTry] = useState(0)
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [couponDraft, setCouponDraft] = useState('')
  const [coupon, setCoupon] = useState('')
  const [couponNote, setCouponNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState<PendingOrder | null>(null)
  // What `create` said of the pending order (null: the hold view asks `pay`), and whether the buyer's own action
  // opened the view, which then takes the focus.
  const [start, setStart] = useState<HoldStart | null>(null)
  const [openedByBuyer, setOpenedByBuyer] = useState(false)
  // ACTIVE_HOLD without the order: the clock time the buyer's session holds one until.
  const [heldUntil, setHeldUntil] = useState('')
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
      const { coupon: savedCoupon, tooLong } = readSavedCoupon()
      if (savedCoupon) {
        setCoupon(savedCoupon)
        setCouponDraft(savedCoupon)
      }
      if (tooLong) setCouponNote('كود الخصم المحفوظ أطول من المسموح، فأُزيل. أعد إدخاله.')
    })
  }, [])

  // The city list, loaded again by the «أعد المحاولة» button after a failure.
  useEffect(() => {
    fetchCities()
      .then((rates) => {
        setCities(rates)
        setCitiesState('loaded')
      })
      .catch(() => setCitiesState('failed'))
  }, [citiesTry])

  // The live quote, debounced like the cart's.
  const cart = cartState?.cart
  const ready = cartState?.ready ?? false
  const currentKey = cart ? quoteKeyOf(cart.lines, city, coupon) : ''
  // Stale: the buyer changed the cart, city or coupon and the new quote is not in
  // yet, or its refresh failed: the summary on screen is not the current one.
  const stale = quote !== null && quoteKey !== currentKey
  // The build's policy texts against the quote's: while they differ the form waits.
  const policiesStale = quote !== null && builtPolicyRevisions(builtRevisions, quote.policyRevisions).stale
  // A press that Turnstile answered with a failure is over: a later recovery
  // must not submit it without a new press.
  if (turnstileFailed && awaitingToken) setAwaitingToken(false)
  // A digital-only cart shows no phone field: a number typed while it held a physical line goes, with its error.
  if (quote !== null && !quote.physical && (phone !== '' || errors.phone !== undefined)) {
    setPhone('')
    setErrors((e) => ({ ...e, phone: undefined }))
  }
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

  // The order is over (cancelled, or its hold is over): this tab forgets its token and its key, so the same cart can
  // be ordered again. Not for a payment that arrived: nothing is cleared until the return page sees `paid`.
  const endKey = useCallback(() => {
    clearPendingOrder()
    clearIdempotency()
    idempotencyRef.current = null
    fingerprintRef.current = null
  }, [])

  // The function does not know the order, or its token no longer fits: forget it and show the form again.
  const forget = useCallback(
    (message: string) => {
      endKey()
      setStart(null)
      setPending(null)
      setSubmitError(message)
    },
    [endKey],
  )

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
    const applied = normalizeCoupon(couponDraft)
    setCoupon(applied)
    setCouponNote('')
    writeSessionValue(COUPON_KEY, applied)
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!quote || !cart || submitting) return
    // In the fields' own order, so the first one found is the first on screen.
    const found: Partial<Record<Field, string>> = {}
    const trimmedEmail = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(trimmedEmail)) found.email = FIELD_ERRORS.email
    if (!name.trim()) found.name = FIELD_ERRORS.name
    if (quote.physical) {
      if (normalizeSaudiMobile(phone) === null) found.phone = FIELD_ERRORS.phone
      if (!city) found.city = FIELD_ERRORS.city
      if (address.replace(/\s+/g, ' ').trim().length < 5) found.address = FIELD_ERRORS.address
    }
    if (!consent) found.consent = FIELD_ERRORS.consent
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first !== undefined) {
      setAwaitingToken(false)
      setSubmitError('')
      document.getElementById(`checkout-${first}`)?.focus()
      return
    }
    const policies = builtPolicyRevisions(builtRevisions, quote.policyRevisions)
    if (policies.stale) {
      // The note under the form says why; nothing is sent until the build and the quote agree.
      setAwaitingToken(false)
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
      phone: phoneToSend(quote.physical, phone),
      policyRevisions: policies.revisions,
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
    // The hold view's chunk loads while `create` runs, so it is there when the reply is (the same module `lazy` asks for).
    void import('./HoldView').catch(() => undefined)

    setSubmitting(true)
    setSubmitError('')
    setHeldUntil('')
    try {
      const reply = await postCheckout<{ order: unknown; accessToken?: string; payment?: unknown }>({
        action: 'create',
        idempotencyKey: idempotencyRef.current,
        checkoutSession: sessionRef.current,
        ...core,
        turnstileToken: token,
      })
      if (reply.ok && reply.data !== undefined) {
        const order = orderSchema.parse(reply.data.order)
        const accessToken = reply.data.accessToken
        const over = order.status === 'expired' || order.status === 'cancelled'
        if (!accessToken && !over && !RECEIVED.has(order.status)) {
          setSubmitError('تعذّر إتمام الطلب.')
          return
        }
        // A duplicate reply for an order that already ended is no live hold: the hold view shows it closed and
        // tells this form, which forgets the key, so its token stays out of storage and the next order gets a new key.
        const saved: PendingOrder = { orderNumber: order.orderNumber, accessToken: accessToken ?? '', lines: linesDigest(core.lines) }
        if (accessToken && !over) writePendingOrder(saved)
        const reported = reply.data.payment === undefined ? null : parsePayment(reply.data.payment)
        setStart({ order, payment: reported })
        setOpenedByBuyer(true)
        setPending(saved)
        return
      }
      const error = reply.error
      if (error?.fields?.quote !== undefined) {
        // QUOTE_CHANGED or a cart refusal: re-render with the fresh quote (the
        // new total, or the cart's own errors) and ask the buyer to confirm.
        const fresh = priceSchema.parse(error.fields.quote)
        setQuote({ ...fresh, checkoutEnabled: quote.checkoutEnabled, policyRevisions: quote.policyRevisions, testMode: quote.testMode })
        setQuoteFailed(false)
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
          if (Array.isArray(messages) && messages.length > 0) mapped[field] = FIELD_ERRORS[field]
        }
        const firstInvalid = Object.keys(mapped)[0]
        if (firstInvalid !== undefined) {
          setErrors(mapped)
          document.getElementById(`checkout-${firstInvalid}`)?.focus()
          return
        }
      }
      if (error?.code === 'ACTIVE_HOLD') {
        // The function hands the held order and its token back to the buyer who made it (the same email);
        // a tab that kept it in storage has it already. Either way the hold view takes over and `pay` follows.
        const fields = error.fields ?? {}
        const handedNumber =
          typeof fields.order === 'object' && fields.order !== null ? (fields.order as { orderNumber?: unknown }).orderNumber : undefined
        // An order handed back to a tab with no record of it is compared with this cart by its own lines, read through the
        // quote just sent (`handedLinesDigest`); one whose lines cannot be read carries OTHER_REQUEST (`heldOrder`).
        let handedLines: string | undefined
        try {
          handedLines = handedLinesDigest(orderSchema.parse(fields.order).lines, quote.lines)
        } catch {
          handedLines = undefined
        }
        const mine = heldOrder(
          pendingOrderOf({ orderNumber: handedNumber, accessToken: fields.accessToken, lines: handedLines }),
          readPendingOrder(),
        )
        if (mine) {
          writePendingOrder(mine)
          setStart(null)
          setOpenedByBuyer(true)
          setPending(mine)
          setSubmitError('')
          return
        }
        if (typeof fields.holdExpiresAt === 'string' && !Number.isNaN(instantOf(fields.holdExpiresAt))) {
          setHeldUntil(formatRiyadhTime(fields.holdExpiresAt))
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

  if (cartState === null || !cartState.ready) {
    return <p className={styles.note}>جارٍ تحميل الطلب…</p>
  }

  // A pending order this tab created: the hold view, with its payment and its cancel.
  if (pending !== null) {
    return (
      <Suspense fallback={<p className={styles.note}>جارٍ تحميل الطلب…</p>}>
        <HoldView
          pending={pending}
          start={start}
          testMode={quote?.testMode === true}
          focusOnOpen={openedByBuyer}
          changed={orderChanged(pending, cart?.lines ?? [])}
          onEnd={endKey}
          onForget={forget}
        />
      </Suspense>
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

  // A physical cart with no city to ship to cannot be ordered: the list loaded and is empty.
  const noCities = quote.physical && citiesState === 'loaded' && cities.length === 0
  const clear = (field: Field) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e))
  const described = (field: Field) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `checkout-${field}-error` } : {}
  const problem = (field: Field) =>
    errors[field] && (
      <span id={`checkout-${field}-error`} className={styles.fieldError} role="alert">
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
              {/* A preorder's date and note are read before the buyer confirms. */}
              {line.preorder !== null && (
                <div className={styles.preorderNote}>
                  <p className={styles.note}>{preorderSentence(line.preorder)}</p>
                  <p className={`${styles.note} ${styles.wrap}`}>{line.preorder.note}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.coupon}>
          <label className={styles.field}>
            كود الخصم
            <input
              type="text"
              dir="ltr"
              maxLength={MAX_COUPON}
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
        {couponNote !== '' && (
          <p className={styles.warning} role="alert">
            {couponNote}
          </p>
        )}
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
              maxLength={254}
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
                  maxLength={64}
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
                {citiesState === 'failed' && (
                  <div>
                    <p className={styles.warning} role="alert">
                      تعذّر تحميل قائمة المدن.
                    </p>
                    <ActionButton
                      variant="outline"
                      onClick={() => {
                        setCitiesState('loading')
                        setCitiesTry((n) => n + 1)
                      }}
                    >
                      أعد المحاولة
                    </ActionButton>
                  </div>
                )}
                {noCities && (
                  <p className={styles.warning} role="alert">
                    لا نوصل إلى أي مدينة حاليًا.
                  </p>
                )}
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
          <div>
            <p className={styles.warning} role="alert">
              تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.
            </p>
            <ActionButton variant="outline" onClick={() => void refreshQuote()}>
              أعد المحاولة
            </ActionButton>
          </div>
        )}
        {submitError !== '' && (
          <p className={styles.warning} role="alert">
            {submitError}
          </p>
        )}
        {heldUntil !== '' && (
          <p className={styles.note}>
            لديك طلب محجوز من هذه الجلسة حتى <span dir="ltr">{heldUntil}</span> بتوقيت الرياض.
          </p>
        )}
        {policiesStale && (
          <p className={styles.warning} role="note">
            نحدّث السياسات الآن؛ حاول بعد قليل.
          </p>
        )}
        {/* `disabled` only for what cannot change by itself (no check, a stale summary, no city, policies being updated); while
            a press is being sent it is aria-disabled, so the button keeps the focus (`submit` returns early when submitting). */}
        <ActionButton
          type="submit"
          className={styles.submit}
          disabled={!turnstileAvailable || stale || noCities || policiesStale}
          aria-disabled={submitting || waiting || undefined}
        >
          {submitting || waiting ? 'جارٍ الإرسال…' : 'تأكيد الطلب'}
        </ActionButton>
      </div>
    </form>
  )
}
