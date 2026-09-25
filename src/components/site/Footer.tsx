import { getFooter } from '@/lib/content'

import styles from './site.module.css'

export async function Footer() {
  const footer = await getFooter()
  const [firstLine, secondLine] = footer.poem
  return (
    <footer className={styles.footer}>
      <p className={styles.footerPoem}>
        {firstLine}
        <br />
        <span>{secondLine}</span>
      </p>
      <div className={styles.footerSignature} aria-hidden="true">
        {footer.signature}
      </div>
      <div className={styles.footerDomain}>{footer.domain}</div>
    </footer>
  )
}
