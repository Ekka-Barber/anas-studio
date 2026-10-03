import type { Metadata } from 'next'

import { OrderPage } from '@/components/store/OrderPage'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'

// The link carries the order's token in its fragment, so the page is never indexed (and `public/_headers` sends no referrer).
export const metadata: Metadata = { title: 'طلبك', robots: { index: false, follow: false } }

/** طلبك (P08): the buyer's order, from the link the receipt mail carries. A static shell; everything comes from the `orders` and `download` functions. */
export default function OrdersPage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>طلبك</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
          <noscript>عرض الطلب يحتاج JavaScript.</noscript>
          <OrderPage />
        </div>
      </Band>
    </main>
  )
}
