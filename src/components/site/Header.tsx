import Link from 'next/link'

import { getNav } from '@/lib/content'

import { Navigation } from './Navigation'
import styles from './site.module.css'

export function Header() {
  const items = getNav()
  return (
    <header className={styles.header}>
      <Link href="/" prefetch={false} className={styles.wordmark}>
        <span className={styles.wordmarkName}>أنس</span>
        <span className={styles.wordmarkDomain}>anas.studio</span>
      </Link>
      <Navigation items={items} />
    </header>
  )
}
