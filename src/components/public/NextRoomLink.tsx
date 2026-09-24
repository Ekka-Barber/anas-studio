import Link from 'next/link'

import styles from './public.module.css'

export function NextRoomLink({ href, label, jewel }: { href: string; label: string; jewel: string }) {
  return (
    <section className={styles.nextRoom}>
      <span className={styles.nextRoomLabel}>الغرفة التالية</span>
      <Link href={href} prefetch={false} className={styles.nextRoomLink} style={{ color: `var(--color-${jewel})` }}>
        {label} ←
      </Link>
    </section>
  )
}
