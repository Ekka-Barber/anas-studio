'use client'

import Link from 'next/link'

import styles from '@/components/public/public.module.css'

export default function PublicError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.roomPaper}>
      <div className={styles.roomInner}>
        <div className={styles.comingSoon}>
          <span className={styles.comingSoonLabel}>خطأ</span>
          <h1 className={styles.comingSoonTitle}>حدث خطأ غير متوقع</h1>
          <p className={styles.comingSoonNote}>
            حاول مرة أخرى. إذا استمرت المشكلة، عد إلى <Link href="/" prefetch={false}>الرئيسية</Link>.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginBlockStart: '24px',
              background: 'var(--color-forest)',
              color: 'var(--color-paper)',
              border: 'none',
              padding: '12px 32px',
              fontFamily: 'var(--font-body)',
              fontSize: '14.5px',
              cursor: 'pointer',
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    </main>
  )
}
