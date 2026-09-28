'use client'

/**
 * The cart screen (P07): prices come from the live `quote` only, called on
 * load and after every change (debounced ~300 ms); localStorage holds nothing
 * but variant ids, quantities and dedications. Each line shows its title,
 * unit price, quantity, line total and «حذف», plus the quote's own error for
 * that line and the «إزالة غير المتاح» button for the invalid ones. The
 * city select appears when a line is physical or signed, the coupon is kept
 * in sessionStorage, and `checkoutEnabled` false hides the checkout button
 * while the cart itself keeps working (D34).
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import {
  CITY_KEY,
  COUPON_KEY,
  MAX_QUANTITY,
  readSessionValue,
  removeLine,
  removeLines,
  setDedication,
  setQuantity,
  toApiLines,
  writeSessionValue,
} from '@/lib/cart'
import { ActionButton, ActionLink } from '@/components/weave/Action'
import { formatMoney } from '@/lib/format'

import { useCart } from './CartProvider'
import { fetchCities, fetchQuote, quoteErrorMessage, type CityRate, type Quote } from './quote'
import styles from './store.module.css'

export function CartView() {
  const cartState = useCart()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [cities, setCities] = useState<CityRate[]>([])
  const [city, setCity] = useState('')
  const [couponDraft, setCouponDraft] = useState('')
  const [coupon, setCoupon] = useState('')
  const quoteRun = useRef(0)

  useEffect(() => {
    // Deferred to a microtask so the setStates are not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => {
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

  // The live quote: on load and after every change, debounced about 300 ms.
  // Stale replies are dropped by run number so a fast edit never shows an old
  // total. The cart object's identity changes only through `update`, so the
  // effect cannot refetch itself in a loop.
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
  }, [ready, storedCart, city, coupon])

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

  if (cart.lines.length === 0) {
    return (
      <div>
        <p className={styles.note}>سلتك فارغة.</p>
        <Link href="/store" prefetch={false} className={styles.plainLink}>
          العودة إلى المتجر
        </Link>
      </div>
    )
  }

  return (
    <div>
      {!cartState.persistent && (
        <p className={styles.warning} role="note">
          السلة مؤقتة في هذه الصفحة: المتصفح يمنع الحفظ.
        </p>
      )}
      {quoteFailed && <p className={styles.warning} role="note">تعذّر تحديث الأسعار؛ أعد المحاولة بعد لحظات.</p>}

      <ul className={styles.lineList}>
        {cart.lines.map((line) => {
          const quoteLine = quote?.lines.find((l) => l.variantId === line.variantId) ?? null
          const lineErrors = errors.filter((error) => error.variantId === line.variantId)
          return (
            <li key={line.variantId} className={styles.lineCard}>
              <div className={styles.lineHead}>
                <p className={styles.lineTitle}>
                  {/* A line the quote refused carries no title; its error below says why. */}
                  {quoteLine ? `${quoteLine.productTitle}: ${quoteLine.variantTitle}` : quote === null ? '…' : 'منتج في السلة'}
                </p>
                <p className={styles.linePrice}>
                  {quoteLine ? `${formatMoney(quoteLine.unitPrice)} × ${quoteLine.quantity}` : '…'}
                </p>
              </div>
              {lineErrors.length > 0 && (
                <ul className={styles.lineErrors}>
                  {lineErrors.map((error, i) => (
                    <li key={i}>{quoteErrorMessage(error)}</li>
                  ))}
                </ul>
              )}
              <div className={styles.lineControls}>
                <div className={styles.quantity}>
                  <button
                    type="button"
                    className={styles.stepButton}
                    aria-label="إنقاص الكمية"
                    onClick={() => update(setQuantity(cart, line.variantId, line.quantity - 1))}
                    disabled={line.quantity <= 1}
                  >
                    −
                  </button>
                  <input
                    className={styles.quantityInput}
                    type="number"
                    min={1}
                    max={MAX_QUANTITY}
                    inputMode="numeric"
                    value={line.quantity}
                    aria-label="الكمية"
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next) && next >= 1 && next <= MAX_QUANTITY) {
                        update(setQuantity(cart, line.variantId, next))
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.stepButton}
                    aria-label="زيادة الكمية"
                    onClick={() => update(setQuantity(cart, line.variantId, line.quantity + 1))}
                    disabled={line.quantity >= MAX_QUANTITY}
                  >
                    +
                  </button>
                </div>
                {quoteLine && <p className={styles.lineTotal}>{formatMoney(quoteLine.total)}</p>}
                <button type="button" className={styles.textButton} onClick={() => update(removeLine(cart, line.variantId))}>
                  حذف
                </button>
              </div>
              {quoteLine?.fulfillment === 'signed' && (
                <label className={styles.dedication}>
                  نص الإهداء
                  <input
                    type="text"
                    maxLength={200}
                    value={line.dedication ?? ''}
                    onChange={(event) => update(setDedication(cart, line.variantId, event.target.value))}
                  />
                </label>
              )}
            </li>
          )
        })}
      </ul>

      {invalidVariants.length > 0 && (
        <button type="button" className={styles.textButton} onClick={() => update(removeLines(cart, invalidVariants))}>
          إزالة غير المتاح
        </button>
      )}

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
          <input type="text" value={couponDraft} onChange={(event) => setCouponDraft(event.target.value)} dir="ltr" />
        </label>
        <ActionButton
          variant="outline"
          onClick={() => {
            const applied = couponDraft.trim().toUpperCase()
            setCoupon(applied)
            writeSessionValue(COUPON_KEY, applied)
          }}
        >
          تطبيق
        </ActionButton>
      </div>
      {couponErrors.length > 0 && (
        <ul className={styles.lineErrors}>
          {couponErrors.map((error, i) => (
            <li key={i}>{quoteErrorMessage(error)}</li>
          ))}
        </ul>
      )}

      {otherErrors.length > 0 && (
        <ul className={styles.lineErrors}>
          {otherErrors.map((error, i) => (
            <li key={i}>{quoteErrorMessage(error)}</li>
          ))}
        </ul>
      )}

      {quote && (
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
      )}

      {quote !== null && !quote.checkoutEnabled && (
        <p className={styles.warning} role="note">
          الشراء غير متاح حاليًا، ويفتح قريبًا.
        </p>
      )}
      {quote !== null && quote.checkoutEnabled && (
        <ActionLink href="/checkout">المتابعة لإتمام الطلب</ActionLink>
      )}
    </div>
  )
}
