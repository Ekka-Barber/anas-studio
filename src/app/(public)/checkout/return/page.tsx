import type { Metadata } from 'next'

import { PaymentReturn } from '@/components/store/PaymentReturn'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'

// The order number is in the query, so the page is never indexed (and `public/_headers` sends no referrer).
export const metadata: Metadata = { title: 'حالة الدفع', robots: { index: false, follow: false } }

/** حالة الدفع (P08): where the payment page sends the buyer back. A static shell; the state comes from the `payments` function. */
export default function PaymentReturnPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>حالة الدفع</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
          <noscript>التحقق من الدفع يحتاج JavaScript.</noscript>
          <PaymentReturn />
        </div>
      </Band>
    </main>
  )
}
