'use client'

/**
 * The «السلة» link with the item count, filled in by the client after mount
 * (the count lives in localStorage, so the static HTML ships without it and
 * there is no hydration mismatch).
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { CART_EVENT, cartCount, readCart, readTestFragment } from '@/lib/cart'

import styles from './store.module.css'

export function CartLink() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    // The store pages have no CartProvider: the sandbox access code of a `#test=` link is kept here.
    readTestFragment()
    const refresh = () => setCount(cartCount(readCart().cart))
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect, like CollectionForm).
    void Promise.resolve().then(refresh)
    // A write in this page (AddToCart) or in another tab keeps the count current.
    window.addEventListener(CART_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CART_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return (
    <Link href="/cart" prefetch={false} className={styles.cartLink}>
      السلة{count === null ? '' : count > 0 ? ` (${count})` : ''}
    </Link>
  )
}
