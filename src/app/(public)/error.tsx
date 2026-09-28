'use client'

import { ActionButton } from '@/components/weave/Action'

import styles from '@/components/public/lost.module.css'

/**
 * A render error (static export: only client-side). Said plainly, with a
 * retry; the rooms are linked from the header.
 */
export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className={styles.lost}>
      <div data-tone="aub" className={styles.panel}>
        <h1 className="t-band-xl">
          تعذّر عرض <span className="t-accent">هذه الصفحة</span>
        </h1>
        <p className="t-read">حاول مرة أخرى. إذا تكرر الخطأ، عد إلى الرئيسية من أعلى الصفحة.</p>
        <div>
          <ActionButton onClick={() => reset()}>إعادة المحاولة</ActionButton>
        </div>
      </div>
    </main>
  )
}
