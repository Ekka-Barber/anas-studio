import type { Metadata } from 'next'

import { CartProvider } from '@/components/store/CartProvider'
import { CheckoutForm } from '@/components/store/CheckoutForm'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'
import { getPublishedPolicies } from '@/lib/policies'

export const metadata: Metadata = { title: 'إتمام الطلب' }

/**
 * إتمام الطلب (P07): a client screen; the same live quote the cart showed. It
 * carries the revision of every policy this build rendered (P08 contract
 * section 6), so the form sends the revisions of the texts the buyer could read.
 */
export default async function CheckoutPage() {
  const builtRevisions: Record<string, number> = {}
  for (const [id, policy] of Object.entries(await getPublishedPolicies())) {
    if (policy !== null) builtRevisions[id] = policy.seq
  }
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>إتمام الطلب</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
          <noscript>السلة والطلب يحتاجان JavaScript.</noscript>
          <CartProvider>
            <CheckoutForm builtRevisions={builtRevisions} />
          </CartProvider>
        </div>
      </Band>
    </main>
  )
}
