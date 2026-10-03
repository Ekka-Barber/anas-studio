import type { Metadata } from 'next'

import { NotifyAction } from '@/components/store/NotifyAction'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'

// The link carries its token in the fragment, so the page is never indexed (and `public/_headers` sends no referrer).
export const metadata: Metadata = { title: 'إلغاء الإشعار', robots: { index: false, follow: false } }

/** إلغاء الإشعار (P08): the unsubscribe link every availability notice carries. A static shell; the press calls the `notify` function. */
export default function NotifyUnsubscribePage() {
  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>إلغاء الإشعار</h1>
      </Band>
      <Band tone="sand" pad="l" padEnd="xl">
        <div className={styles.innerWide}>
          <noscript>إلغاء الإشعار يحتاج JavaScript.</noscript>
          <NotifyAction kind="unsubscribe" />
        </div>
      </Band>
    </main>
  )
}
