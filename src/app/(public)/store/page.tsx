import type { Metadata } from 'next'
import Link from 'next/link'

import { Picture } from '@/components/public/Picture'
import { CartLink } from '@/components/store/CartLink'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { enter } from '@/components/weave/motion'
import { formatMoney } from '@/lib/format'
import { getProducts } from '@/lib/store'

export const metadata: Metadata = { title: 'المتجر' }

/**
 * المتجر (P07): built at build time from the published catalog (D32), in
 * direction B (D39): the aubergine title band, then the products. Each
 * card shows the lowest configured price as «من …»; a product with no
 * priced, enabled variant is honestly unavailable.
 */
export default async function StorePage() {
  const products = await getProducts()

  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="aub" edge="crenel" pad="hero" padEnd="m" className={styles.head}>
        <h1 className="t-title" {...enter(80, 'band')}>
          المتجر
        </h1>
        <CartLink />
      </Band>
      <Edge kind="weave" />
      <Band tone="sand" pad="l">
        {products.length === 0 ? (
          <p className={styles.note}>لا توجد منتجات بعد.</p>
        ) : (
          <ul className={styles.grid}>
            {products.map((product, i) => {
              const prices = product.variants
                .map((variant) => variant.priceHalalas)
                .filter((price): price is number => price !== null)
              const lowest = prices.length > 0 ? Math.min(...prices) : null
              return (
                <li key={product.id} className={styles.card}>
                  <Link href={`/store/${product.slug}`} prefetch={false} className={styles.cardLink}>
                    {product.cover !== null && (
                      <Picture
                        id={product.cover}
                        alt=""
                        sizes="(min-width: 640px) 50vw, 100vw"
                        // The first row is on the first screen; a lazy image there is fetched late.
                        loading={i < 2 ? 'eager' : 'lazy'}
                        className={styles.cover}
                        data-reveal=""
                        data-fx="media"
                        data-delay={(i % 3) * 120}
                      />
                    )}
                    <h2 className={styles.cardTitle}>{product.title}</h2>
                  </Link>
                  {product.summary !== '' && <p className={styles.summary}>{product.summary}</p>}
                  <p className={styles.price}>
                    {lowest === null ? 'غير متاح حاليًا' : `من ${formatMoney(lowest)}`}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Band>
    </main>
  )
}
