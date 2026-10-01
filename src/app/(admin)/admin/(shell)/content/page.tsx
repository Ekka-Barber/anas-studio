import type { Metadata } from 'next'
import Link from 'next/link'

import { COLLECTION_LABELS } from '@/admin/collections'
import styles from '@/components/admin/admin.module.css'

export const metadata: Metadata = { title: 'المحتوى' }

/** `/admin/content`: the content collections (`COLLECTION_LABELS`). */
export default function ContentHomePage() {
  return (
    <div className={styles.page}>
      <h1>المحتوى</h1>
      <div className={styles.grid}>
        {(Object.keys(COLLECTION_LABELS) as (keyof typeof COLLECTION_LABELS)[]).map((collection) => (
          <Link key={collection} href={`/admin/content/${collection}`} className={styles.tile}>
            {COLLECTION_LABELS[collection]}
          </Link>
        ))}
      </div>
    </div>
  )
}
