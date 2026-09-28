import Link from 'next/link'
import type { ReactNode } from 'react'

import { Picture } from '@/components/public/Picture'
import { enter } from '@/components/weave/motion'
import { ROOM_ORDER } from '@/content/site'

import styles from './lost.module.css'

/**
 * The 404 and the error page (D39): a road not built yet, on aubergine, with
 * the rooms that are, beside the Street No. 4 sign.
 */
export function Lost({ title, accent, children }: { title: string; accent: string; children?: ReactNode }) {
  return (
    <main id="main" className={styles.lost}>
      <div data-tone="aub" className={styles.panel}>
        <h1 className={`t-band-xl ${styles.title}`}>
          <span {...enter(80, 'band')}>{title}</span> <span className="t-accent" {...enter(260, 'band')}>{accent}</span>
        </h1>
        {children}
        <nav aria-label="طرق مبنية" className={styles.ways} {...enter(520)}>
          <Link href="/" prefetch={false} data-tone="coral">
            الرئيسية
          </Link>
          {ROOM_ORDER.map((room) => (
            <Link key={room.href} href={room.href} prefetch={false}>
              {room.label}
            </Link>
          ))}
        </nav>
      </div>
      <figure className={styles.photo} {...enter(200, 'media')}>
        <Picture id="street4-street-sign" alt="لوحة شارع رقم 4 في تبوك" sizes="(min-width: 1024px) 40vw, 100vw" loading="eager" />
      </figure>
    </main>
  )
}
