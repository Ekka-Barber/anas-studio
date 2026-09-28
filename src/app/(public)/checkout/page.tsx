import type { Metadata } from 'next'

import { CartProvider } from '@/components/store/CartProvider'
import { CheckoutForm } from '@/components/store/CheckoutForm'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'

export const metadata: Metadata = { title: 'إتمام الطلب' }

/** إتمام الطلب (P07): a client screen; the same live quote the cart showed. */
export default function CheckoutPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" edge="crenel" pad="hero" padEnd="m">
        <h1 className={styles.title}>إتمام الطلب</h1>
      </Band>
      <Edge kind="weave" />
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.inner}>
          <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
          <CartProvider>
            <CheckoutForm />
          </CartProvider>
        </div>
      </Band>
    </main>
  )
}
