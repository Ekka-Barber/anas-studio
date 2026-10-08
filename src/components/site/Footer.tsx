import Link from 'next/link'

import { Edge } from '@/components/weave/Edge'
import { Lines } from '@/components/weave/Lines'
import { Signature } from '@/components/weave/Signature'
import { getFooter, getNav, getSocial, navLabel } from '@/lib/content'

import styles from './site.module.css'

/**
 * The closing of every page: the weave strip, then Anas's line in place of
 * "all rights reserved" (his brief), his signature, and the way out. The
 * first social link from the admin follows the two page links; with none
 * set, the footer shows no handle. The two page links carry the menu's names
 * for them, so the footer spells each room as the header does.
 */
export async function Footer() {
  const [footer, nav, [first]] = await Promise.all([getFooter(), getNav(), getSocial()])
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
              {navLabel(nav, '/scenes') ?? 'المَشاهد'}
            </Link>
            <Link href="/contact" prefetch={false}>
              {navLabel(nav, '/contact') ?? 'تواصل'}
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
