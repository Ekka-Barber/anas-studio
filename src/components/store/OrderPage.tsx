'use client'

/**
 * The buyer's order page (P08 contract section 10): `/orders#<orderNumber>.<token>`,
 * the link the receipt mail carries. A static shell; the order comes from the
 * `orders` Edge Function at run time and the files from `download`.
 *
 * The link's two parts are the only thing read from the address. They are kept
 * in sessionStorage (`anasaq:order-access`) and the fragment leaves the address
 * bar at once, so the token stays out of the URL and out of a Referer; with no
 * fragment the page uses what the tab kept, and a second link opened in the same
 * tab (`hashchange`) replaces it. With a link the page asks `get` on load and
 * again after each action; a 404 forgets the link and shows the recovery form,
 * which is also what a tab with no link sees. Every reply is parsed strictly
 * (`src/lib/orders.ts`): one that does not fit is the network sentence.
 *
 * The page is calm and official (D38): no countdown, no motion. One
 * `role="status"` line holds the page's state (loading, a refusal, then what
 * the order says of itself); it is empty until the address has been read, so the
 * static page holds no loading line that only script could end. The alert
 * regions are in the page before they have words, so a screen reader announces
 * what is put into them; a button that is busy is `aria-disabled`, not disabled,
 * so it keeps the focus; and the sentence that replaces a control (a filed
 * return, a sent recovery, a lost order, the order that «تحديث» fetched) takes
 * the focus. A download that finds its file gone keeps its words in the line,
 * and the focus on them, when the order is read again and the button goes. The
 * download token and the signed URL are never stored or shown.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'

import { instantOf } from '@/lib/cart'
import { formatDate, formatMoney } from '@/lib/format'
import {
  clampQuantity,
  clearOrderAccess,
  fetchOrder,
  FAILURE_SENTENCES,
  formProblem,
  FULFILLMENT_LABELS,
  isFiled,
  isSent,
  lineName,
  LOADING,
  NETWORK,
  normalizeReason,
  NOT_FOUND,
  NOTHING_CHOSEN,
  postFunction,
  readOrderAccess,
  RECOVERED,
  requestDownload,
  RETURN_LABELS,
  returnableItems,
  returnRequestItems,
  STATUS_SENTENCES,
  statusKind,
  takeOrderFragment,
  type Failure,
  type OrderAccess,
  type OrderLine,
  type OrderView,
} from '@/lib/orders'
import { useTurnstile } from '@/lib/turnstile'
import { ActionButton, ActionLink } from '@/components/weave/Action'

import styles from './store.module.css'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** One question to `get`: the link it is for, how many times it has been asked again, and whether the buyer's «تحديث» asked it. */
interface Request {
  access: OrderAccess
  n: number
  retry: boolean
}

/** The request after a link was read: the same link keeps its request (React's development double run asks once). */
function nextRequest(previous: Request | null | undefined, access: OrderAccess | null): Request | null {
  if (access === null) return null
  if (previous && previous.access.orderNumber === access.orderNumber && previous.access.accessToken === access.accessToken) return previous
  return { access, n: 0, retry: false }
}

/** An alert region that is always in the page, so a screen reader announces what is put into it; it looks like a warning only while it has words. Script can focus it, for a result that must outlive the control that asked. */
function Alert({ text, ref }: { text: string; ref?: RefObject<HTMLParagraphElement | null> }) {
  return (
    <p ref={ref} tabIndex={-1} role="alert" className={text === '' ? 'visually-hidden' : styles.warning}>
      {text}
    </p>
  )
}

/** One line of the order: what it is, what became of it, and, for a file that is ready, the button. */
function OrderLineCard({ item, access, onRefresh }: { item: OrderLine; access: OrderAccess; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const alertRef = useRef<HTMLParagraphElement>(null)
  const name = lineName(item)
  const ready = item.download?.available === true

  async function download() {
    if (busy) return
    setBusy(true)
    setProblem('')
    const outcome = await requestDownload(access, item.itemId)
    setBusy(false)
    if ('url' in outcome) {
      // The file reply is an attachment: the page stays where it is.
      window.location.assign(outcome.url)
      onRefresh()
    } else {
      setProblem(outcome.problem)
      if (outcome.refresh) {
        // A refund or a revocation may have taken the file: read the order again. The button may go with it, so the
        // words, which stay in the line, take the focus now instead of letting it fall to the page.
        alertRef.current?.focus()
        onRefresh()
      }
    }
  }

  return (
    <li className={styles.lineCard}>
      <div className={styles.lineHead}>
        <p className={styles.lineTitle}>{item.title}</p>
        <p className={`${styles.linePrice} ${styles.wrap}`}>
          {item.variantTitle !== '' && <>{item.variantTitle} · </>}
          الكمية: <span dir="ltr">{item.quantity}</span>
        </p>
        {item.preorder !== null && (
          <>
            <p className={styles.note}>طلب مسبق: يُسلَّم في {formatDate(item.preorder.shipsOn)}</p>
            <p className={`${styles.note} ${styles.wrap}`}>{item.preorder.note}</p>
          </>
        )}
        {item.state !== null && <p className={styles.note}>{FULFILLMENT_LABELS[item.state]}</p>}
        {item.carrier !== null && (
          <p className={`${styles.note} ${styles.wrap}`}>
            شركة الشحن: <span dir="auto">{item.carrier}</span>
          </p>
        )}
        {item.tracking !== null && (
          <p className={`${styles.note} ${styles.wrap}`}>
            رقم التتبع: <span dir="ltr">{item.tracking}</span>
          </p>
        )}
        {item.download !== null && !item.download.available && (
          <p className={styles.note}>{item.download.revoked ? 'أُلغي حق التنزيل.' : 'الملف غير جاهز بعد؛ سنراسلك عند توفره.'}</p>
        )}
        {/* Mounted for every file line, ready or not: a 404 can take the button, and its words must stay. */}
        {item.download !== null && <Alert text={problem} ref={alertRef} />}
      </div>
      {ready && (
        <div className={styles.lineControls}>
          {/* aria-disabled, not disabled: the button keeps the focus while its own request runs. */}
          <ActionButton variant="outline" aria-disabled={busy || undefined} onClick={() => void download()}>
            {busy ? 'جارٍ التجهيز…' : 'تنزيل'}
            <span className="visually-hidden">: {name}</span>
          </ActionButton>
        </div>
      )}
    </li>
  )
}

/** The return request: a quantity for each returnable line, the reason, and a link to the refund policy. It files a request; nothing is promised. */
function ReturnForm({
  items,
  access,
  onStart,
  onFiled,
  onRefresh,
}: {
  items: OrderLine[]
  access: OrderAccess
  onStart: () => void
  onFiled: () => void
  onRefresh: () => void
}) {
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const chosen = returnRequestItems(items, texts)
    const why = normalizeReason(reason)
    // In the fields' own order: the quantities, then the reason.
    if (chosen.length === 0) {
      setReasonError('')
      setProblem(NOTHING_CHOSEN)
      firstRef.current?.focus()
      return
    }
    if (why === '') {
      setProblem('')
      setReasonError('اكتب سبب الإرجاع.')
      reasonRef.current?.focus()
      return
    }
    setReasonError('')
    setProblem('')
    setBusy(true)
    onStart()
    try {
      const reply = await postFunction('orders', {
        action: 'return-request',
        orderNumber: access.orderNumber,
        accessToken: access.accessToken,
        items: chosen,
        reason: why,
      })
      if (isFiled(reply)) {
        setTexts({})
        setReason('')
        onFiled()
      } else if (reply.ok) {
        // A success that does not name the request it filed is not read as one.
        setProblem(NETWORK)
      } else {
        setProblem(formProblem(reply))
        // The order is gone (or its link ran out): the page reads it again and says so.
        if (reply.status === 404) onRefresh()
      }
    } catch {
      setProblem(NETWORK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`${styles.smallForm} ${styles.orderSection}`} onSubmit={submit} noValidate aria-label="طلب إرجاع">
      {items.map((item, index) => (
        <label key={item.itemId} className={styles.quantityLabel}>
          {/* One item of the label's row, so the words wrap together and the field stays beside them. */}
          <span>
            الكمية: {lineName(item)} (حتى <span dir="ltr">{item.returnable}</span>)
          </span>
          <input
            ref={index === 0 ? firstRef : undefined}
            className={styles.quantityInput}
            type="number"
            dir="ltr"
            inputMode="numeric"
            min={0}
            max={item.returnable}
            step={1}
            value={texts[item.itemId] ?? '0'}
            onChange={(event) => setTexts((current) => ({ ...current, [item.itemId]: event.target.value }))}
            onBlur={() => setTexts((current) => ({ ...current, [item.itemId]: String(clampQuantity(texts[item.itemId] ?? '', item.returnable)) }))}
          />
        </label>
      ))}
      <div className={styles.field}>
        <label htmlFor="order-return-reason">سبب الإرجاع</label>
        <textarea
          ref={reasonRef}
          id="order-return-reason"
          rows={4}
          dir="auto"
          maxLength={500}
          required
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            setReasonError('')
          }}
          aria-invalid={reasonError !== '' ? true : undefined}
          aria-describedby="order-return-reason-error"
        />
        <span id="order-return-reason-error" className={styles.fieldError} role="alert">
          {reasonError}
        </span>
      </div>
      {/* A new tab: what is typed here lives only in this page's state. */}
      <Link href="/policies/refund" prefetch={false} target="_blank" rel="noopener" className={styles.plainLink}>
        سياسة الاسترجاع
        <span className="visually-hidden"> (تفتح في نافذة جديدة)</span>
      </Link>
      <div>
        <ActionButton type="submit" aria-disabled={busy || undefined}>
          {busy ? 'جارٍ الإرسال…' : 'إرسال طلب الإرجاع'}
        </ActionButton>
        <Alert text={problem} />
      </div>
    </form>
  )
}

/** The way back to an order whose link is lost or ran out: an email, Turnstile, and one answer whatever the address has. */
function RecoveryForm({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const { box: turnstileBox, token, failed: turnstileFailed, reset: resetTurnstile, available: turnstileAvailable } = useTurnstile('order-recover')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const address = email.trim()
    if (!EMAIL.test(address)) {
      setProblem('')
      setEmailError('أدخل بريدًا إلكترونيًا صحيحًا.')
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
      const reply = await postFunction('orders', { action: 'recover', email: address, turnstileToken: token })
      if (isSent(reply)) {
        // The same sentence whatever the address has: the form is replaced by it.
        onSent()
      } else if (reply.ok) {
        setProblem(NETWORK)
      } else if (reply.status === 422) {
        setEmailError('أدخل بريدًا إلكترونيًا صحيحًا.')
        emailRef.current?.focus()
      } else {
        setProblem(formProblem(reply))
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
    <form className={`${styles.smallForm} ${styles.orderSection}`} onSubmit={submit} noValidate aria-labelledby="order-recover-title">
      <h2 id="order-recover-title" className={styles.panelTitle}>
        استعادة رابط الطلب
      </h2>
      <div className={styles.field}>
        <label htmlFor="order-recover-email">البريد الإلكتروني</label>
        <input
          ref={emailRef}
          id="order-recover-email"
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
          aria-describedby="order-recover-email-error"
        />
        <span id="order-recover-email-error" className={styles.fieldError} role="alert">
          {emailError}
        </span>
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
      <div>
        <ActionButton type="submit" disabled={!turnstileAvailable} aria-disabled={busy || undefined}>
          {busy ? 'جارٍ الإرسال…' : 'أرسل الرابط'}
        </ActionButton>
        <Alert text={problem} />
      </div>
    </form>
  )
}

export function OrderPage() {
  // undefined: the address is not read yet; null: this tab holds no order link.
  const [request, setRequest] = useState<Request | null | undefined>(undefined)
  // The request whose answer arrived last: the page is busy while the current one is not that.
  const [settled, setSettled] = useState<Request | null>(null)
  const [view, setView] = useState<OrderView | null>(null)
  const [problem, setProblem] = useState<Failure | null>(null)
  const [recovered, setRecovered] = useState(false)
  const [filed, setFiled] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const filedRef = useRef<HTMLParagraphElement>(null)
  // The element that takes the focus once the page has rendered what an action said.
  const focusNext = useRef<RefObject<HTMLElement | null> | null>(null)
  const started = useRef(false)

  useEffect(() => {
    // One read: the fragment leaves the address bar when it is taken, so React's development double run must not read it again.
    if (!started.current) {
      started.current = true
      // Deferred to a microtask so the setState is not synchronous within the effect body (react-hooks/set-state-in-effect, like PaymentReturn).
      void Promise.resolve().then(() => {
        const access = takeOrderFragment() ?? readOrderAccess()
        setRequest((previous) => nextRequest(previous, access))
      })
    }
    // A second link opened in this tab changes the fragment without loading the page.
    const onHashChange = () => {
      const access = takeOrderFragment()
      if (access === null) return
      // A new link starts the page over: what the last one said is not this order's.
      setRecovered(false)
      setFiled('')
      setRequest((previous) => nextRequest(previous, access))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // `get` for the current request: on load, and again after each action or «تحديث».
  useEffect(() => {
    if (!request) return
    let live = true
    void fetchOrder(request.access).then((outcome) => {
      if (!live) return
      if ('view' in outcome) {
        setView(outcome.view)
        setProblem(null)
        // The «تحديث» that asked goes with the problem: the sentence that answers it takes the focus. A refusal keeps the button, and the focus on it.
        if (request.retry) focusNext.current = statusRef
      } else if (outcome.failure === 'missing') {
        // The function does not know the order, or its link ran out: forget it and offer the recovery.
        clearOrderAccess()
        setView(null)
        setFiled('')
        setProblem('missing')
        setRequest(null)
        // Asked again by the buyer's own action: the control that had the focus is gone.
        if (request.n > 0) focusNext.current = statusRef
      } else {
        setProblem(outcome.failure)
      }
      setSettled(request)
    })
    return () => {
      live = false
    }
  }, [request])

  // Focus follows the buyer's own action into its result, after the page has rendered it.
  useEffect(() => {
    focusNext.current?.current?.focus()
    focusNext.current = null
  })

  const refresh = (retry = false) => setRequest((current) => (current ? { access: current.access, n: current.n + 1, retry } : current))
  const busy = request != null && settled !== request
  const access = request ? request.access : null
  // The order of the link this page is asking about, and no other.
  const shown = view !== null && access !== null && view.order.orderNumber === access.orderNumber ? view : null

  // Empty while `request` is undefined (the address is not read yet): the static page is made in that state, and a loading line there would never end without script.
  let status = ''
  if (request === null) status = recovered ? RECOVERED : problem === 'missing' ? NOT_FOUND : ''
  else if (request !== undefined) {
    if (shown === null) status = busy || problem === null ? LOADING : FAILURE_SENTENCES[problem]
    else status = problem !== null ? FAILURE_SENTENCES[problem] : STATUS_SENTENCES[statusKind(shown.order.status, shown.payment.state)]
  }

  const kind = shown === null ? null : statusKind(shown.order.status, shown.payment.state)
  // Only while the order still waits for its payment: the invoice ends with the hold.
  const invoiceUrl = shown !== null && kind === 'pending' && shown.order.status === 'pending_payment' ? shown.payment.invoiceUrl : null
  const returnable = shown === null ? [] : returnableItems(shown.items)

  return (
    <div>
      <div className={styles.orderBox}>
        {shown !== null && (
          <p className={styles.orderNumber}>
            رقم الطلب: <span dir="ltr">{shown.order.orderNumber}</span>
          </p>
        )}
        <p ref={statusRef} tabIndex={-1} className={status === '' ? 'visually-hidden' : styles.note} role="status" aria-live="polite">
          {status}
        </p>
        {invoiceUrl !== null && <ActionLink href={invoiceUrl}>متابعة الدفع</ActionLink>}
        {shown?.order.testMode === true && (
          <p className={styles.note} role="note">
            وضع تجريبي: لا يُخصم أي مبلغ حقيقي
          </p>
        )}
        {request && (problem === 'limit' || problem === 'network') && (
          // aria-disabled, not disabled: the button keeps the focus while its own request runs.
          <ActionButton variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && refresh(true)}>
            تحديث
          </ActionButton>
        )}
      </div>

      {shown !== null && access !== null && (
        <div className={styles.orderSection}>
          <ul className={styles.lineList}>
            {shown.items.map((item) => (
              <OrderLineCard key={item.itemId} item={item} access={access} onRefresh={refresh} />
            ))}
          </ul>
          <dl className={styles.totals}>
            <div>
              <dt>المجموع الفرعي</dt>
              <dd>{formatMoney(shown.order.subtotal)}</dd>
            </div>
            {shown.order.discount > 0 && (
              <div>
                <dt>الخصم</dt>
                <dd>
                  {'‎−'}
                  {formatMoney(shown.order.discount)}
                </dd>
              </div>
            )}
            {shown.items.some((item) => item.fulfillment !== 'digital') && (
              <div>
                <dt>التوصيل</dt>
                <dd>{formatMoney(shown.order.shipping)}</dd>
              </div>
            )}
            <div className={styles.totalRow}>
              <dt>الإجمالي</dt>
              <dd>{formatMoney(shown.order.total)}</dd>
            </div>
            {shown.order.refunded > 0 && (
              <div>
                <dt>المبلغ المُعاد</dt>
                <dd>{formatMoney(shown.order.refunded)}</dd>
              </div>
            )}
          </dl>
          {(shown.returns.length > 0 || returnable.length > 0) && (
            <div>
              {shown.returns.length > 0 && (
                <ul className={styles.summaryLines} aria-label="طلبات الإرجاع">
                  {shown.returns.map((entry) => (
                    <li key={entry.id}>
                      <span>
                        طلب إرجاع {formatDate(new Date(instantOf(entry.createdAt)))}
                      </span>
                      <strong>{RETURN_LABELS[entry.state]}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <p ref={filedRef} tabIndex={-1} className={filed === '' ? 'visually-hidden' : styles.note} role="status" aria-live="polite">
                {filed}
              </p>
              {returnable.length > 0 && (
                <ReturnForm
                  items={returnable}
                  access={access}
                  onStart={() => setFiled('')}
                  onFiled={() => {
                    setFiled('وصلنا طلب الإرجاع.')
                    focusNext.current = filedRef
                    refresh()
                  }}
                  onRefresh={refresh}
                />
              )}
            </div>
          )}
        </div>
      )}

      {request === null && !recovered && (
        <RecoveryForm
          onSent={() => {
            setRecovered(true)
            focusNext.current = statusRef
          }}
        />
      )}
    </div>
  )
}
