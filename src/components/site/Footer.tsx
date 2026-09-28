import Link from 'next/link'

import { Edge } from '@/components/weave/Edge'
import { Lines } from '@/components/weave/Lines'
import { Signature } from '@/components/weave/Signature'
import { SOCIAL } from '@/content/site'
import { getFooter } from '@/lib/content'

import styles from './site.module.css'

/**
 * The closing of every page: the weave strip, then Anas's line in place of
 * "all rights reserved" (his brief), his signature, and the way out.
 */
export async function Footer() {
  const footer = await getFooter()
  const instagram = SOCIAL[0]
  return (
    <>
      <Edge kind="weave" />
      <footer data-tone="aub" className={styles.footer}>
        <p className={styles.poem} data-reveal="">
          {footer.poem.map((line, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <Lines text={line} />
            </span>
          ))}
        </p>
        <Signature width={230} />
        <div className={styles.footerRow}>
          <span dir="ltr">{footer.domain}</span>
          <nav aria-label="روابط" className={styles.footerLinks}>
            <Link href="/scenes" prefetch={false}>
              المَشاهد
            </Link>
            <Link href="/contact" prefetch={false}>
              تواصل
            </Link>
            <a href={instagram.href} dir="ltr" aria-label={`${instagram.network}: ${instagram.handle}`}>
              {instagram.handle}
            </a>
          </nav>
        </div>
      </footer>
    </>
  )
}
