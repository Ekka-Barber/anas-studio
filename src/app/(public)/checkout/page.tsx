import type { Metadata } from 'next'

import { CartProvider } from '@/components/store/CartProvider'
import { CheckoutForm } from '@/components/store/CheckoutForm'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'

export const metadata: Metadata = { title: 'إتمام الطلب' }

/** إتمام الطلب (P07): a client screen; the same live quote the cart showed. */
export default function CheckoutPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>إتمام الطلب</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
          <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
          <CartProvider>
            <CheckoutForm />
          </CartProvider>
        </div>
      </Band>
    </main>
  )
}
