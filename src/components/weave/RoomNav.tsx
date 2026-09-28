import Link from 'next/link'

import styles from './roomnav.module.css'
import type { Tone } from './tones'

export interface RoomLink {
  href: string
  label: string
}

/**
 * The two doors at the end of a room: back (or to the previous room) on the
 * paper band, onward on the band of the next room's colour.
 */
export function RoomNav({
  back,
  backLabel = 'الغرفة السابقة',
  next,
  nextLabel = 'الغرفة التالية',
  nextTone = 'aub',
}: {
  back: RoomLink
  backLabel?: string
  next?: RoomLink
  nextLabel?: string
  nextTone?: Tone
}) {
  return (
    <nav aria-label="الغرف المجاورة" className={styles.nav}>
      <Link href={back.href} prefetch={false} data-tone="paper" className={styles.door}>
        <span className={`t-label t-muted ${styles.kicker}`}>
          <span aria-hidden="true">→ </span>
          {backLabel}
        </span>
        <span className={styles.name}>{back.label}</span>
      </Link>
      {next && (
        <Link href={next.href} prefetch={false} data-tone={nextTone} className={`${styles.door} ${styles.next}`}>
          <span className={`t-label t-muted ${styles.kicker}`}>
            {nextLabel}
            <span aria-hidden="true"> ←</span>
          </span>
          <span className={styles.name}>{next.label}</span>
        </Link>
      )}
    </nav>
  )
}
