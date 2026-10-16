'use client'

/**
 * The payment return page (P08 contract section 10): where the payment page
 * sends the buyer back. A redirect is a prompt, never proof, so this page asks
 * the `payments` function's `verify` (which settles what the provider holds
 * and answers the order's state) at 0, 2, 4, 8, 15 and 30 seconds, stops at
 * the first state other than `pending`, and after the last offers «تحديث»,
 * which verifies once more. Nothing but our own `order` query value is read
 * from the address (the provider appends its own `id`, `status` and
 * `message`: ignored), and the token comes from this tab's stored pending
 * order only, and only for the same order number.
 *
 * A settled state spends the order here (`returnRelease`): the stored order
 * and its idempotency key are cleared, so the checkout page no longer holds
 * it; `paid` is the one state that clears the cart too, and only while the cart
 * is still the one that bought the order (a buyer who edited it since keeps the
 * edit; an order stored without a digest of its lines empties it as it always
 * did). The order link (`/orders#<number>.<token>`) is shown only when this tab
 * holds the token.
 * An order this tab does not hold clears nothing: a number in the address is
 * no reason to empty anyone's cart. The state sits in one `role="status"`
 * region, empty until the address is read (the static page carries no loading
 * line); once the schedule has run out, or a throttle stopped it, with the last
 * answer still `pending`, it says «بانتظار الدفع.» (the order page's sentence)
 * instead of «جارٍ التحقق من الدفع…», and «تحديث» leaves it so until an answer
 * changes the state. The page is calm and official (D38): no countdown, no motion.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import {
  clearIdempotency,
  clearPendingOrder,
  emptyBoughtCart,
  readPendingOrder,
  returnOrder,
  returnRelease,
  VERIFY_SCHEDULE_SECONDS,
  type ReturnTarget,
} from '@/lib/cart'
import { ActionButton, ActionLink } from '@/components/weave/Action'

import { parseVerify, postPayments, type Verify } from './quote'
import styles from './store.module.css'

type Outcome = { kind: 'state'; verify: Verify } | { kind: 'limit' } | { kind: 'network' }

/** One `verify`. A throttle is its own outcome; every other failure, an unreadable reply included, is a network failure. */
async function checkOnce(target: ReturnTarget): Promise<Outcome> {
  try {
    const reply = await postPayments<unknown>({
      action: 'verify',
      orderNumber: target.orderNumber,
      ...(target.accessToken === null ? {} : { accessToken: target.accessToken }),
    })
    if (reply.ok && reply.data !== undefined) return { kind: 'state', verify: parseVerify(reply.data) }
    return reply.status === 429 ? { kind: 'limit' } : { kind: 'network' }
  } catch {
    return { kind: 'network' }
  }
}

/**
 * The order is over for this tab: its token and key are spent, and a paid one also empties the cart that bought it,
 * but only while the cart is still that one (`emptyBoughtCart`).
 */
function spend(target: ReturnTarget, paid: boolean): void {
  if (target.accessToken === null) return
  if (paid) emptyBoughtCart(target)
  clearPendingOrder()
  clearIdempotency()
}

const REVIEW = 'وصلتنا دفعتك ونراجع طلبك؛ سنتواصل معك عبر البريد.'
/** The order page's sentence for a payment that has not arrived (`STATUS_SENTENCES.pending`, not imported: `orders.ts` is not in this page's script). */
const PENDING = 'بانتظار الدفع.'

export function PaymentReturn() {
  // undefined: the address is not read yet; null: there is no order to ask about.
  const [target, setTarget] = useState<ReturnTarget | null | undefined>(undefined)
  const [verified, setVerified] = useState<Verify | null>(null)
  const [problem, setProblem] = useState<'limit' | 'network' | null>(null)
  const [busy, setBusy] = useState(false)
  // The schedule has run out (or a throttle stopped it): from here only «تحديث» asks again.
  const [done, setDone] = useState(false)
  const [again, setAgain] = useState(0)

  useEffect(() => {
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => setTarget(returnOrder(window.location.search, readPendingOrder())))
  }, [])

  useEffect(() => {
    if (!target) return
    let live = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const stop = () => {
      live = false
      timers.forEach(clearTimeout)
    }
    // «تحديث» asks once more; the first run follows the schedule.
    const delays: readonly number[] = again === 0 ? VERIFY_SCHEDULE_SECONDS : [0]
    delays.forEach((seconds, index) => {
      timers.push(
        setTimeout(async () => {
          setBusy(true)
          const outcome = await checkOnce(target)
          if (!live) return
          setBusy(false)
          if (outcome.kind !== 'state') {
            setProblem(outcome.kind)
            // A throttle ends the schedule; a lost connection may recover by the next one.
            if (outcome.kind === 'limit') stop()
          } else {
            setProblem(null)
            setVerified(outcome.verify)
            const release = returnRelease(outcome.verify.state)
            if (release !== null) spend(target, release === 'cart')
            if (outcome.verify.state !== 'pending') stop()
          }
          if (!live || index === delays.length - 1) setDone(true)
        }, seconds * 1000),
      )
    })
    return stop
  }, [target, again])

  if (target === null) {
    return (
      <div className={styles.orderBox}>
        <p className={styles.note} role="status" aria-live="polite">
          لم نجد هذا الطلب.
        </p>
        <Link href="/orders" prefetch={false} className={styles.plainLink}>
          استعادة رابط الطلب
        </Link>
      </div>
    )
  }

  const state = verified?.state ?? 'pending'
  const orderLink =
    target !== undefined && target.accessToken !== null && verified?.hasToken === true
      ? `/orders#${target.orderNumber}.${target.accessToken}`
      : null

  // Empty while the address is not read (`target` undefined): the static page is made in that state, and a line there
  // would never end without script (R10A-5, STORE-UI-03). Once the schedule has run out, or a throttle stopped it, with
  // the last answer still `pending`, nothing is being checked any more: the order page's sentence for that state.
  // Once nothing is asked any more: «بانتظار الدفع.» after an answer that said pending; with no answer read at all (a throttle
  // stopped the first ask), nothing, since the page cannot know (the alert beside it says why nothing is being checked).
  let headline: ReactNode = target === undefined ? '' : !done ? 'جارٍ التحقق من الدفع…' : verified !== null ? PENDING : ''
  if (state === 'paid') {
    headline = (
      <>
        تم الدفع. رقم الطلب <span dir="ltr">{target?.orderNumber}</span>
      </>
    )
  } else if (state === 'needs_resolution' || state === 'review') headline = REVIEW
  else if (state === 'refunded') headline = 'أُعيد مبلغ هذا الطلب.'
  else if (state === 'expired') headline = 'انتهت مدة حجز الطلب.'
  else if (state === 'cancelled') headline = 'أُلغي الطلب.'
  else if (state === 'unknown') headline = 'لم نجد هذا الطلب.'

  return (
    <div className={styles.orderBox}>
      <p className={headline === '' ? 'visually-hidden' : state === 'paid' ? styles.orderNumber : styles.note} role="status" aria-live="polite">
        {headline}
      </p>
      {state === 'paid' && (
        <>
          {orderLink !== null && (
            <a href={orderLink} className={styles.plainLink}>
              عرض الطلب
            </a>
          )}
          <p className={styles.note}>أرسلنا رابط الطلب إلى بريدك.</p>
        </>
      )}
      {state === 'pending' && verified?.hasToken === true && verified.invoiceUrl !== null && (
        <ActionLink href={verified.invoiceUrl}>متابعة الدفع</ActionLink>
      )}
      {(state === 'expired' || state === 'cancelled') && (
        <Link href="/cart" prefetch={false} className={styles.plainLink}>
          العودة إلى السلة
        </Link>
      )}
      {state === 'unknown' && (
        <Link href="/orders" prefetch={false} className={styles.plainLink}>
          استعادة رابط الطلب
        </Link>
      )}
      {verified?.testMode === true && (
        <p className={styles.note} role="note">
          وضع تجريبي: لا يُخصم أي مبلغ حقيقي
        </p>
      )}
      {problem !== null && (
        <p className={styles.warning} role="alert">
          {problem === 'limit' ? 'حاول بعد قليل.' : 'تعذّر الاتصال بالخدمة؛ أعد المحاولة.'}
        </p>
      )}
      {state === 'pending' && (done || problem !== null) && (
        // aria-disabled, not disabled: the button keeps the focus while its own request runs.
        <ActionButton variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && setAgain((n) => n + 1)}>
          تحديث
        </ActionButton>
      )}
    </div>
  )
}
