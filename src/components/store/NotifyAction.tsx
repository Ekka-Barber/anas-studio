'use client'

/**
 * The two links of the availability mails (P08 contract sections 5, 7 and 10):
 * `/notify/confirm#<token>` and `/notify/unsubscribe#<token>`. The token is the
 * whole fragment, shaped as the function writes it (any other fragment, the skip link's `#main` say, is
 * no link and is left alone). It is taken out of the address bar and kept in this tab's
 * sessionStorage (`anasaq:notify:<kind>`, as `/orders` keeps its pair) until the
 * page's last word, so a reload after a throttle still has the link (STORE-UI-10);
 * a page opened with no fragment reads it from there, and a good answer or a dead
 * link removes it. Storage that throws leaves it in memory only. Nothing is sent
 * until the visitor presses the one button, so a mail scanner that opens the link
 * changes nothing. One sentence, one button: the sentence is the prompt, then the
 * outcome, in one `role="status"` line. A good answer or a dead link ends the page
 * (the button goes and the sentence takes the focus); a throttle or a lost
 * connection keeps the button for another try. The page is calm and official
 * (D38): no motion.
 */

import { useEffect, useRef, useState } from 'react'

import { ActionButton } from '@/components/weave/Action'
import { clearNotifyToken, LIMIT, NETWORK, notifyStatus, postFunction, readNotifyToken, takeNotifyFragment } from '@/lib/orders'

import styles from './store.module.css'

const COPY = {
  confirm: {
    prompt: 'أكّد رغبتك في إشعارك عند توفر المنتج.',
    button: 'تأكيد',
    done: 'تم التأكيد. سنراسلك عند توفر المنتج.',
    status: 'confirmed',
  },
  unsubscribe: {
    prompt: 'أوقف إشعارات توفر هذا المنتج.',
    button: 'إلغاء الاشتراك',
    done: 'أُلغي الاشتراك.',
    status: 'unsubscribed',
  },
} as const

const INCOMPLETE = 'الرابط غير مكتمل.'
const NOT_VALID = 'الرابط غير صالح أو انتهت صلاحيته.'

export function NotifyAction({ kind }: { kind: keyof typeof COPY }) {
  // undefined: the address is not read yet; null: the link carries no token.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  // What the last press said; empty until then, so the prompt shows.
  const [message, setMessage] = useState('')
  // The page has said its last word: the button goes.
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const read = useRef(false)
  // The token the page now stands on: an answer to a link a second one has since replaced is not this page's.
  const current = useRef<string | null | undefined>(undefined)
  const copy = COPY[kind]

  useEffect(() => {
    // One read: the fragment leaves the address bar when it is taken, so React's development double run must not read it again.
    if (read.current) return
    read.current = true
    // Deferred to a microtask so the setState is not synchronous within the effect body (react-hooks/set-state-in-effect, like PaymentReturn).
    void Promise.resolve().then(() => {
      // A reload has no link in its address: the tab's kept token, while the page has not said its last word.
      const taken = takeNotifyFragment(kind) ?? readNotifyToken(kind)
      current.current = taken
      setToken(taken)
    })
  }, [kind])

  // A second link opened in this tab (a fragment navigation) replaces the first, and its token leaves the address bar too.
  useEffect(() => {
    const onHashChange = () => {
      const taken = takeNotifyFragment(kind)
      if (taken === null) return
      current.current = taken
      setToken(taken)
      setMessage('')
      setDone(false)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [kind])

  // The sentence that ends the page takes the focus from the button that went.
  useEffect(() => {
    if (done) statusRef.current?.focus()
  }, [done])

  // The page's last word: the button goes, and so does the token this tab kept.
  function finish(text: string, pressed: string) {
    setMessage(text)
    setDone(true)
    clearNotifyToken(kind, pressed)
  }

  async function press(pressed: string) {
    if (busy) return
    setBusy(true)
    try {
      const reply = await postFunction('notify', { action: kind, token: pressed })
      if (current.current !== pressed) return
      if (notifyStatus(reply) === copy.status) {
        finish(copy.done, pressed)
      } else if (reply.ok) {
        // A success that is not the one asked for is not read as one.
        setMessage(NETWORK)
      } else if (reply.status === 404 || reply.status === 422) {
        // The link is dead: another press cannot change that.
        finish(NOT_VALID, pressed)
      } else {
        setMessage(reply.status === 429 ? LIMIT : NETWORK)
      }
    } catch {
      setMessage(NETWORK)
    } finally {
      setBusy(false)
    }
  }

  const text = token === undefined ? '' : token === null ? INCOMPLETE : message !== '' ? message : copy.prompt

  return (
    <div className={styles.orderBox}>
      <p ref={statusRef} tabIndex={-1} className={text === '' ? 'visually-hidden' : styles.note} role="status" aria-live="polite">
        {text}
      </p>
      {typeof token === 'string' && !done && (
        // aria-disabled, not disabled: the button keeps the focus while its own request runs.
        <ActionButton aria-disabled={busy || undefined} onClick={() => void press(token)}>
          {busy ? 'جارٍ الإرسال…' : copy.button}
        </ActionButton>
      )}
    </div>
  )
}
