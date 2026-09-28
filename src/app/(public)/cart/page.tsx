import type { Metadata } from 'next'

import { CartProvider } from '@/components/store/CartProvider'
import { CartView } from '@/components/store/CartView'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'

export const metadata: Metadata = { title: 'السلة' }

/** السلة (P07): a client screen; prices come from the live quote, storage from src/lib/cart.ts. */
export default function CartPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>السلة</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
        <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
        <CartProvider>
          <CartView />
        </CartProvider>
        </div>
      </Band>
    </main>
  )
}
