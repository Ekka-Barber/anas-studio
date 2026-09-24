import Link from 'next/link'

import styles from '@/components/public/public.module.css'

export default function NotFound() {
  return (
    <main className={styles.roomPaper}>
      <div className={styles.roomInner}>
        <div className={styles.comingSoon}>
          <span className={styles.comingSoonLabel}>404</span>
          <h1 className={styles.comingSoonTitle}>هذه الصفحة غير موجودة</h1>
          <p className={styles.comingSoonNote}>
            تحقق من الرابط، أو عد إلى <Link href="/" prefetch={false}>الرئيسية</Link>.
          </p>
        </div>
      </div>
    </main>
  )
}
