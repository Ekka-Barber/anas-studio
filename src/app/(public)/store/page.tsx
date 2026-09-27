import Link from 'next/link'

import { Picture } from '@/components/public/Picture'
import { CartLink } from '@/components/store/CartLink'
import styles from '@/components/store/store.module.css'
import { formatMoney } from '@/lib/format'
import { getProducts } from '@/lib/store'

/**
 * المتجر (P07): built at build time from the published catalog (D32), plain
 * on the current tokens until a v2 design direction is accepted (D38). Each
 * card shows the lowest configured price as «من …»; a product with no
 * priced, enabled variant is honestly unavailable.
 */
export default async function StorePage() {
  const products = await getProducts()

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.pageHead}>
          <h1 className={styles.title}>المتجر</h1>
          <CartLink />
        </div>
        {products.length === 0 ? (
          <p className={styles.note}>لا توجد منتجات بعد.</p>
        ) : (
          <ul className={styles.grid}>
            {products.map((product) => {
              const prices = product.variants
                .map((variant) => variant.priceHalalas)
                .filter((price): price is number => price !== null)
              const lowest = prices.length > 0 ? Math.min(...prices) : null
              return (
                <li key={product.id} className={styles.card}>
                  <Link href={`/store/${product.slug}`} prefetch={false} className={styles.cardLink}>
                    {product.cover !== null && (
                      <Picture id={product.cover} alt={product.title} sizes="(min-width: 640px) 50vw, 100vw" className={styles.cover} />
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
      </div>
    </main>
  )
}
