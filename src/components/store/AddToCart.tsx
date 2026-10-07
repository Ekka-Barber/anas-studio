'use client'

/**
 * The product page's add control (P07): a quantity from 1 to 20 and
 * «أضف إلى السلة». It writes the cart directly through `src/lib/cart.ts`
 * (the product page has no `CartProvider`), so it also works when storage is
 * denied — the memory cart keeps it for the tab. After adding it says so and
 * links to the cart. A variant that is a preorder right now (`preorder`, from
 * `VariantAction`) says «اطلب مسبقًا» on its button: the same cart line, and
 * the cart and the checkout carry its note and date before payment. A digital
 * variant (`digital`) is one copy: no quantity field, and a second add changes
 * nothing and says the book is in the cart.
 */
// Relative, not `@/`: the unit tests import `VariantAction`, which imports this file, and the unit config has no alias.
import Link from 'next/link'
import { useState } from 'react'

import { addLine, cartCount, MAX_LINES, MAX_QUANTITY, readCart, writeCart } from '../../lib/cart'
import { ActionButton } from '../weave/Action'

import styles from './store.module.css'

/** The field's text as a quantity: a whole number from 1 to 20, and 1 when it is empty or not a number. */
function toQuantity(text: string): number {
  const next = Math.trunc(Number(text))
  return Number.isFinite(next) ? Math.min(MAX_QUANTITY, Math.max(1, next)) : 1
}

export function AddToCart({
  variantId,
  label,
  preorder = false,
  digital = false,
}: {
  variantId: string
  label: string
  preorder?: boolean
  digital?: boolean
}) {
  const verb = preorder ? 'اطلب مسبقًا' : 'أضف إلى السلة'
  // The field keeps a draft so it can be emptied and retyped; leaving it clamps.
  const [draft, setDraft] = useState('1')
  // The status node stays mounted (a live region inserted already filled is
  // often missed) and its text differs on every add.
  const [note, setNote] = useState('')

  function add() {
    const quantity = digital ? 1 : toQuantity(draft)
    setDraft(String(quantity))
    const { cart } = readCart()
    const next = addLine(cart, { variantId, quantity }, digital)
    const added = cartCount(next) - cartCount(cart)
    if (added === 0) {
      const held = digital && cart.lines.some((line) => line.variantId === variantId.toLowerCase())
      setNote(held ? 'الكتاب الرقمي في سلتك.' : `لم يُضف شيء: الحد الأقصى ${MAX_QUANTITY} لكل منتج و${MAX_LINES} منتجًا في السلة.`)
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
      {!digital && (
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
      )}
      <ActionButton onClick={add} aria-label={`${verb}: ${label}`}>
        {verb}
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
