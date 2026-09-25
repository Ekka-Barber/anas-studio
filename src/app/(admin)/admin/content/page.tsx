import Link from 'next/link'

import { COLLECTION_LABELS } from '@/admin/collections'
import { AdminShell } from '@/components/admin/AdminShell'
import styles from '@/components/admin/admin.module.css'

/** `/admin/content`: the four collections (P04 part 2). */
export default function ContentHomePage() {
  return (
    <AdminShell>
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
    </AdminShell>
  )
}
