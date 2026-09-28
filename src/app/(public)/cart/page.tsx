import type { Metadata } from 'next'

import { CartProvider } from '@/components/store/CartProvider'
import { CartView } from '@/components/store/CartView'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'

export const metadata: Metadata = { title: 'السلة' }

/** السلة (P07): a client screen; prices come from the live quote, storage from src/lib/cart.ts. */
export default function CartPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" edge="crenel" pad="hero" padEnd="m">
        <h1 className={styles.title}>السلة</h1>
      </Band>
      <Edge kind="weave" />
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.inner}>
        <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
        <CartProvider>
          <CartView />
        </CartProvider>
        </div>
      </Band>
    </main>
  )
}
