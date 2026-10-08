'use client'

/**
 * The cart screen (P07): prices come from the live `quote` only, called on
 * load and after every change (debounced ~300 ms); localStorage holds nothing
 * but variant ids, quantities and dedications. Each line shows its title,
 * unit price, quantity, line total and «حذف» (a line the quote reads as
 * digital is one copy: no quantity control), plus the quote's own error for
 * that line and the «إزالة غير المتاح» button for the invalid ones. The
 * city select appears when a line is physical or signed, the coupon is kept
 * in sessionStorage, and `checkoutEnabled` false hides the checkout button
 * while the cart itself keeps working (D34). Every edit is applied to the
 * latest stored cart (see CartProvider), and a removal moves focus on to the
 * next line and is announced.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import {
  CITY_KEY,
  COUPON_KEY,
  MAX_COUPON,
  MAX_QUANTITY,
  normalizeCoupon,
  readSavedCoupon,
  readSessionValue,
  removeLines,
  setDedication,
  setQuantity,
  toApiLines,
  writeSessionValue,
} from '@/lib/cart'
import { ActionButton, ActionLink } from '@/components/weave/Action'
import { formatMoney } from '@/lib/format'

import { useCart } from './CartProvider'
import { fetchCities, fetchQuote, oneCopyOnly, preorderSentence, quoteErrorMessage, type CityRate, type Quote } from './quote'
import styles from './store.module.css'

/**
 * A line's quantity field. It keeps what is typed as a draft so it can be
 * emptied and retyped: a valid number is committed at once, and leaving the
 * field clamps whatever is left to 1..20.
 */
function QuantityInput({
  id,
  value,
  label,
  onCommit,
}: {
  id: string
  value: number
  label: string
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [seen, setSeen] = useState(value)
  // A quantity changed from outside (the ± buttons) replaces the draft.
  if (seen !== value) {
    setSeen(value)
    setDraft(String(value))
  }
  return (
    <input
      id={id}
      className={styles.quantityInput}
      type="number"
      min={1}
      max={MAX_QUANTITY}
      inputMode="numeric"
      value={draft}
      aria-label={label}
      onChange={(event) => {
        setDraft(event.target.value)
        const next = Number(event.target.value)
        if (Number.isInteger(next) && next >= 1 && next <= MAX_QUANTITY && next !== value) onCommit(next)
      }}
      onBlur={() => {
        const typed = Math.trunc(Number(draft))
        const next = draft !== '' && Number.isFinite(typed) ? Math.min(MAX_QUANTITY, Math.max(1, typed)) : value
        setDraft(String(next))
        if (next !== value) onCommit(next)
      }}
    />
  )
}

export function CartView() {
  const cartState = useCart()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [cities, setCities] = useState<CityRate[]>([])
  const [city, setCity] = useState('')
  const [couponDraft, setCouponDraft] = useState('')
  const [coupon, setCoupon] = useState('')
  const [couponNote, setCouponNote] = useState('')
  const [retry, setRetry] = useState(0)
  const [announce, setAnnounce] = useState('')
  const quoteRun = useRef(0)
  // Where focus goes once a removal has re-rendered: a variant id, or '' for the empty-cart note.
  const focusAfter = useRef<string | null>(null)
  const emptyNote = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    // Deferred to a microtask so the setStates are not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => {
      const savedCity = readSessionValue(CITY_KEY)
      if (savedCity) setCity(savedCity)
      const { coupon: savedCoupon, tooLong } = readSavedCoupon()
      if (savedCoupon) {
        setCoupon(savedCoupon)
        setCouponDraft(savedCoupon)
      }
      if (tooLong) setCouponNote('كود الخصم المحفوظ أطول من المسموح، فأُزيل. أعد إدخاله.')
    })
    fetchCities().then(setCities).catch(() => setCities([]))
  }, [])

  // The live quote: on load and after every change, debounced about 300 ms.
  // Stale replies are dropped by run number so a fast edit never shows an old
  // total. The cart object's identity changes only through `update` or another
  // tab's write, so the effect cannot refetch itself in a loop. `retry` is the
  // «أعد المحاولة» button after a failed quote.
  const storedCart = cartState?.cart
  const ready = cartState?.ready ?? false
  useEffect(() => {
    if (!ready || !storedCart) return
    if (storedCart.lines.length === 0) {
      // Same microtask deferral as above.
      void Promise.resolve().then(() => {
        setQuote(null)
        setQuoteFailed(false)
      })
      return
    }
    const run = ++quoteRun.current
    const timer = setTimeout(() => {
      fetchQuote({ lines: toApiLines(storedCart.lines), cityKey: city || undefined, couponCode: coupon || undefined })
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
  }, [ready, storedCart, city, coupon, retry])

  // After a removal the focused button is gone: focus follows to the next line.
  useEffect(() => {
    const target = focusAfter.current
    if (target === null) return
    focusAfter.current = null
    // A digital line has no quantity field: its «حذف» takes the focus instead.
    const element =
      target === '' ? emptyNote.current : (document.getElementById(`cart-quantity-${target}`) ?? document.getElementById(`cart-remove-${target}`))
    element?.focus()
  }, [storedCart])

  // Line errors are matched by variant id, not by position: a quote still in
  // flight after a removal must not pin its errors on the wrong line.
  const errors = quote?.errors ?? []
  const cartErrors = errors.filter((error) => error.line === undefined)
  const invalidVariants = errors.flatMap((error) => (error.variantId === undefined ? [] : [error.variantId]))
  const couponErrors = cartErrors.filter((error) => error.code.startsWith('COUPON_'))
  const otherErrors = cartErrors.filter((error) => !error.code.startsWith('COUPON_'))

  if (cartState === null || !cartState.ready) {
    return <p className={styles.note}>جارٍ تحميل السلة…</p>
  }

  const { cart, update } = cartState

  /** Removes lines and sends focus to where the list continues: the next line's quantity, or the empty note. */
  function remove(variantIds: string[], message: string) {
    const first = cart.lines.findIndex((l) => variantIds.includes(l.variantId))
    const left = cart.lines.filter((l) => !variantIds.includes(l.variantId))
    focusAfter.current = (left[first] ?? left[left.length - 1])?.variantId ?? ''
    setAnnounce(message)
    update((latest) => removeLines(latest, variantIds))
  }

  // Always mounted, in the empty view too: focus alone reads only the control it lands on.
  const removedStatus = (
    <p role="status" className="visually-hidden">
      {announce}
    </p>
  )

  if (cart.lines.length === 0) {
    return (
      <div>
        {removedStatus}
        <p ref={emptyNote} tabIndex={-1} className={styles.note}>
          سلتك فارغة.
        </p>
        <Link href="/store" prefetch={false} className={styles.plainLink}>
          العودة إلى المتجر
        </Link>
      </div>
    )
  }

  return (
    <div>
      {removedStatus}
      {!cartState.persistent && (
        <p className={styles.warning} role="note">
          السلة مؤقتة في هذه الصفحة: المتصفح يمنع الحفظ.
        </p>
      )}
      {quoteFailed && (
        <div>
          <p className={styles.warning} role="alert">تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.</p>
          <ActionButton variant="outline" onClick={() => setRetry((n) => n + 1)}>
            أعد المحاولة
          </ActionButton>
        </div>
      )}

      <div className={styles.withSummary}>
        <div>
          <ul className={styles.lineList}>
            {cart.lines.map((line) => {
              const quoteLine = quote?.lines.find((l) => l.variantId === line.variantId) ?? null
              const lineErrors = errors.filter((error) => error.variantId === line.variantId)
              // The line's name for its controls: never empty, even when the quote refused the line.
              const name = quoteLine ? `${quoteLine.productTitle}: ${quoteLine.variantTitle}` : 'منتج في السلة'
              const preorder = quoteLine?.preorder ?? null
              return (
                <li key={line.variantId} className={styles.lineCard}>
                  <div className={styles.lineHead}>
                    <p className={styles.lineTitle}>
                      {/* A line the quote refused carries no title; its error below says why. */}
                      {quote === null ? '…' : name}
                    </p>
                    <p className={styles.linePrice}>
                      {quoteLine ? `${formatMoney(quoteLine.unitPrice)} × ${quoteLine.quantity}` : '…'}
                    </p>
                  </div>
                  {lineErrors.length > 0 && (
                    <ul className={styles.lineErrors} role="alert">
                      {lineErrors.map((error, i) => (
                        <li key={i}>{quoteErrorMessage(error)}</li>
                      ))}
                    </ul>
                  )}
                  {/* A digital line holds one copy: the refusal names it, and one press sets it right. «حذف» keeps the focus as the quote comes back. */}
                  {lineErrors.some(oneCopyOnly) && (
                    <button
                      type="button"
                      className={styles.textButton}
                      aria-label={`اجعل الكمية 1: ${name}`}
                      onClick={() => {
                        document.getElementById(`cart-remove-${line.variantId}`)?.focus()
                        update((latest) => setQuantity(latest, line.variantId, 1))
                      }}
                    >
                      اجعل الكمية 1
                    </button>
                  )}
                  <div className={styles.lineControls}>
                    {quoteLine?.fulfillment !== 'digital' && (
                      <div className={styles.quantity}>
                        {/* aria-disabled at the limits, not disabled: the pressed button keeps the focus, and a press at the limit does nothing. */}
                        <button
                          type="button"
                          className={styles.stepButton}
                          aria-label={`إنقاص الكمية: ${name}`}
                          onClick={() => {
                            if (line.quantity > 1) update((latest) => setQuantity(latest, line.variantId, line.quantity - 1))
                          }}
                          aria-disabled={line.quantity <= 1 || undefined}
                        >
                          −
                        </button>
                        <QuantityInput
                          id={`cart-quantity-${line.variantId}`}
                          value={line.quantity}
                          label={`الكمية: ${name}`}
                          onCommit={(next) => update((latest) => setQuantity(latest, line.variantId, next))}
                        />
                        <button
                          type="button"
                          className={styles.stepButton}
                          aria-label={`زيادة الكمية: ${name}`}
                          onClick={() => {
                            if (line.quantity < MAX_QUANTITY) update((latest) => setQuantity(latest, line.variantId, line.quantity + 1))
                          }}
                          aria-disabled={line.quantity >= MAX_QUANTITY || undefined}
                        >
                          +
                        </button>
                      </div>
                    )}
                    {quoteLine && <p className={styles.lineTotal}>{formatMoney(quoteLine.total)}</p>}
                    <button
                      id={`cart-remove-${line.variantId}`}
                      type="button"
                      className={styles.textButton}
                      aria-label={`حذف ${name}`}
                      onClick={() => remove([line.variantId], `حُذف ${name}.`)}
                    >
                      حذف
                    </button>
                  </div>
                  {/* A preorder's date and note are read before the buyer pays. */}
                  {preorder !== null && (
                    <div className={styles.preorderNote}>
                      <p className={styles.note}>{preorderSentence(preorder)}</p>
                      <p className={`${styles.note} ${styles.wrap}`}>{preorder.note}</p>
                    </div>
                  )}
                  {(quoteLine?.fulfillment === 'signed' || line.dedication !== undefined) && (
                    <label className={styles.dedication}>
                      نص الإهداء
                      <input
                        type="text"
                        maxLength={200}
                        aria-label={`نص الإهداء: ${name}`}
                        value={line.dedication ?? ''}
                        onChange={(event) => update((latest) => setDedication(latest, line.variantId, event.target.value))}
                      />
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          {invalidVariants.length > 0 && (
            <button type="button" className={styles.textButton} onClick={() => remove(invalidVariants, 'أُزيلت المنتجات غير المتاحة.')}>
              إزالة غير المتاح
            </button>
          )}
        </div>
        <div className={styles.summaryPanel}>
          <h2 className={styles.panelTitle}>ملخص الطلب</h2>
          {quote?.physical && (
            <label className={styles.field}>
              مدينة التوصيل
              <select
                value={city}
                onChange={(event) => {
                  setCity(event.target.value)
                  writeSessionValue(CITY_KEY, event.target.value)
                }}
              >
                <option value="">اختر المدينة</option>
                {cities.map((rate) => (
                  <option key={rate.city_key} value={rate.city_key}>
                    {rate.name_ar}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.coupon}>
            <label className={styles.field}>
              كود الخصم
              <input
                type="text"
                value={couponDraft}
                maxLength={MAX_COUPON}
                onChange={(event) => setCouponDraft(event.target.value)}
                dir="ltr"
              />
            </label>
            <ActionButton
              variant="outline"
              onClick={() => {
                const applied = normalizeCoupon(couponDraft)
                setCoupon(applied)
                setCouponNote('')
                writeSessionValue(COUPON_KEY, applied)
              }}
            >
              تطبيق
            </ActionButton>
          </div>
          {couponNote !== '' && (
            <p className={styles.warning} role="alert">
              {couponNote}
            </p>
          )}
          {couponErrors.length > 0 && (
            <ul className={styles.lineErrors} role="alert">
              {couponErrors.map((error, i) => (
                <li key={i}>{quoteErrorMessage(error)}</li>
              ))}
            </ul>
          )}

          {otherErrors.length > 0 && (
            <ul className={styles.lineErrors} role="alert">
              {otherErrors.map((error, i) => (
                <li key={i}>{quoteErrorMessage(error)}</li>
              ))}
            </ul>
          )}

          {/* Always mounted: a new total after a coupon, a city or a quantity change is announced. */}
          <p role="status" className="visually-hidden">
            {quote ? `الإجمالي ${formatMoney(quote.total)}` : ''}
          </p>

          {quote && (
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
          )}

          {quote !== null && !quote.checkoutEnabled && (
            <p className={styles.warning} role="note">
              الشراء غير متاح حاليًا، ويفتح قريبًا.
            </p>
          )}
          {/* A refused line (sold out, held for another order, short) cannot be bought: no way on until it is dealt with. */}
          {quote !== null && quote.checkoutEnabled && invalidVariants.length > 0 && (
            <p className={styles.note}>أزل غير المتاح أو عدّل الكمية لإتمام الطلب.</p>
          )}
          {quote !== null && quote.checkoutEnabled && invalidVariants.length === 0 && (
            <ActionLink href="/checkout">المتابعة لإتمام الطلب</ActionLink>
          )}
        </div>
      </div>
    </div>
  )
}
