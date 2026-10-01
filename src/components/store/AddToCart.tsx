'use client'

/**
 * The product page's add control (P07): a quantity from 1 to 20 and
 * «أضف إلى السلة». It writes the cart directly through `src/lib/cart.ts`
 * (the product page has no `CartProvider`), so it also works when storage is
 * denied — the memory cart keeps it for the tab. After adding it says so and
 * links to the cart.
 */
import Link from 'next/link'
import { useState } from 'react'

import { ActionButton } from '@/components/weave/Action'
import { addLine, cartCount, MAX_LINES, MAX_QUANTITY, readCart, writeCart } from '@/lib/cart'

import styles from './store.module.css'

/** The field's text as a quantity: a whole number from 1 to 20, and 1 when it is empty or not a number. */
function toQuantity(text: string): number {
  const next = Math.trunc(Number(text))
  return Number.isFinite(next) ? Math.min(MAX_QUANTITY, Math.max(1, next)) : 1
}

export function AddToCart({ variantId, label }: { variantId: string; label: string }) {
  // The field keeps a draft so it can be emptied and retyped; leaving it clamps.
  const [draft, setDraft] = useState('1')
  // The status node stays mounted (a live region inserted already filled is
  // often missed) and its text differs on every add.
  const [note, setNote] = useState('')

  function add() {
    const quantity = toQuantity(draft)
    setDraft(String(quantity))
    const { cart } = readCart()
    const next = addLine(cart, { variantId, quantity })
    const added = cartCount(next) - cartCount(cart)
    if (added === 0) {
      setNote(`لم يُضف شيء: الحد الأقصى ${MAX_QUANTITY} لكل منتج و${MAX_LINES} منتجًا في السلة.`)
      return
    }
    writeCart(next)
    // addLine caps a merged line at 20: a partial add says so.
    setNote(
      added < quantity
        ? `أُضيف ${added} فقط: الحد الأقصى ${MAX_QUANTITY} لكل منتج. في السلة الآن ${cartCount(next)}.`
        : `أُضيف إلى السلة. في السلة الآن ${cartCount(next)}.`,
    )
  }

  return (
    <div className={styles.addToCart}>
      <label className={styles.quantityLabel}>
        الكمية
        <span className="visually-hidden">: {label}</span>
        <input
          className={styles.quantityInput}
          type="number"
          min={1}
          max={MAX_QUANTITY}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(String(toQuantity(draft)))}
        />
      </label>
      <ActionButton onClick={add} aria-label={`أضف إلى السلة: ${label}`}>
        أضف إلى السلة
      </ActionButton>
      <p className={note === '' ? 'visually-hidden' : styles.addedNote} role="status">
        {note}
        {note !== '' && (
          <>
            {' '}
            <Link href="/cart" prefetch={false}>
              عرض السلة
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
