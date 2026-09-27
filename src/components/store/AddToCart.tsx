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

import { addLine, MAX_QUANTITY, readCart, writeCart } from '@/lib/cart'

import styles from './store.module.css'

export function AddToCart({ variantId }: { variantId: string }) {
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)

  function add() {
    const { cart } = readCart()
    writeCart(addLine(cart, { variantId, quantity }))
    setAdded(true)
  }

  return (
    <div className={styles.addToCart}>
      <label className={styles.quantityLabel}>
        الكمية
        <input
          className={styles.quantityInput}
          type="number"
          min={1}
          max={MAX_QUANTITY}
          inputMode="numeric"
          value={quantity}
          onChange={(event) => {
            const next = Number(event.target.value)
            setQuantity(Number.isFinite(next) ? Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(next))) : 1)
          }}
        />
      </label>
      <button type="button" className={styles.button} onClick={add}>
        أضف إلى السلة
      </button>
      {added && (
        <p className={styles.addedNote} role="status">
          أُضيف إلى السلة. <Link href="/cart" prefetch={false}>عرض السلة</Link>
        </p>
      )}
    </div>
  )
}
