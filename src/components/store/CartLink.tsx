'use client'

/**
 * The «السلة» link with the item count, filled in by the client after mount
 * (the count lives in localStorage, so the static HTML ships without it and
 * there is no hydration mismatch).
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { cartCount, readCart } from '@/lib/cart'

import styles from './store.module.css'

export function CartLink() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(() => setCount(cartCount(readCart().cart)))
  }, [])

  return (
    <Link href="/cart" prefetch={false} className={styles.cartLink}>
      السلة{count === null ? '' : count > 0 ? ` (${count})` : ''}
    </Link>
  )
}
