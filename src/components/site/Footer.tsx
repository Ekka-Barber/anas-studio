import Link from 'next/link'

import { Edge } from '@/components/weave/Edge'
import { Lines } from '@/components/weave/Lines'
import { Signature } from '@/components/weave/Signature'
import { getFooter, getSocial } from '@/lib/content'

import styles from './site.module.css'

/**
 * The closing of every page: the weave strip, then Anas's line in place of
 * "all rights reserved" (his brief), his signature, and the way out. The
 * first social link from the admin follows the two page links; with none
 * set, the footer shows no handle.
 */
export async function Footer() {
  const footer = await getFooter()
  const [first] = await getSocial()
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
            {first && (
              <a href={first.href} dir="ltr" aria-label={`${first.network}: ${first.handle}`}>
                {first.handle}
              </a>
            )}
          </nav>
        </div>
      </footer>
    </>
  )
}
