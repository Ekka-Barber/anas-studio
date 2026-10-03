'use client'

/**
 * The two links of the availability mails (P08 contract sections 5, 7 and 10):
 * `/notify/confirm#<token>` and `/notify/unsubscribe#<token>`. The token is the
 * whole fragment. It is read once, kept in memory only (never stored) and taken
 * out of the address bar; nothing is sent until the visitor presses the one
 * button, so a mail scanner that opens the link changes nothing. One sentence,
 * one button: the sentence is the prompt, then the outcome, in one
 * `role="status"` line. A good answer or a dead link ends the page (the button
 * goes and the sentence takes the focus); a throttle or a lost connection keeps
 * the button for another try. The page is calm and official (D38): no motion.
 */

import { useEffect, useRef, useState } from 'react'

import { ActionButton } from '@/components/weave/Action'
import { LIMIT, NETWORK, notifyStatus, postFunction, takeFragment } from '@/lib/orders'

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
  const copy = COPY[kind]

  useEffect(() => {
    // One read: the fragment leaves the address bar when it is taken, so React's development double run must not read it again.
    if (read.current) return
    read.current = true
    // Deferred to a microtask so the setState is not synchronous within the effect body (react-hooks/set-state-in-effect, like PaymentReturn).
    void Promise.resolve().then(() => {
      const fragment = takeFragment()
      setToken(fragment === '' ? null : fragment)
    })
  }, [])

  // A second link opened in this tab (a fragment navigation) replaces the first, and its token leaves the address bar too.
  useEffect(() => {
    const onHashChange = () => {
      const fragment = takeFragment()
      if (fragment === '') return
      setToken(fragment)
      setMessage('')
      setDone(false)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // The sentence that ends the page takes the focus from the button that went.
  useEffect(() => {
    if (done) statusRef.current?.focus()
  }, [done])

  async function press(current: string) {
    if (busy) return
    setBusy(true)
    try {
      const reply = await postFunction('notify', { action: kind, token: current })
      if (notifyStatus(reply) === copy.status) {
        setMessage(copy.done)
        setDone(true)
      } else if (reply.ok) {
        // A success that is not the one asked for is not read as one.
        setMessage(NETWORK)
      } else if (reply.status === 404 || reply.status === 422) {
        // The link is dead: another press cannot change that.
        setMessage(NOT_VALID)
        setDone(true)
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
