import { notFound } from 'next/navigation'

import { Picture } from '@/components/public/Picture'
import { AddToCart } from '@/components/store/AddToCart'
import styles from '@/components/store/store.module.css'
import { RichText } from '@/lib/richtext'
import { formatMoney } from '@/lib/format'
import { getProducts } from '@/lib/store'

/**
 * One published product (P07): a static page per published slug, rebuilt
 * after each catalog change (D32). Every enabled variant is a row with its
 * title and its configured price; an unpriced variant says «غير مسعّر» and
 * gets no button (D06: unconfigured means unavailable, never free).
 */
export const dynamicParams = false

// Next's static export refuses an empty generateStaticParams ("at least one
// route must be generated", nextjs.org/docs/messages/generate-static-params),
// and the hosted project has no products yet. The placeholder `_` can never
// be a product slug (the products table allows only lower-case letters,
// digits and hyphens): its page is the 404, never a fake product, and
// out/store.html says «لا توجد منتجات بعد.».
const NO_PRODUCTS = '_'

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = (await getProducts()).map((product) => ({ slug: product.slug }))
  return slugs.length > 0 ? slugs : [{ slug: NO_PRODUCTS }]
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = (await getProducts()).find((entry) => entry.slug === slug)
  if (!product) notFound()

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{product.title}</h1>
        {product.cover !== null && (
          <Picture id={product.cover} alt={product.title} sizes="(min-width: 768px) 480px, 100vw" className={styles.productCover} />
        )}
        {product.summary !== '' && <p className={styles.productSummary}>{product.summary}</p>}
        <div className={styles.productBody}>
          <RichText document={product.body} />
        </div>
        <ul className={styles.variants}>
          {product.variants.map((variant) => (
            <li key={variant.id} className={styles.variant}>
              <p className={styles.variantTitle}>{variant.title}</p>
              {variant.priceHalalas === null ? (
                <p className={styles.unpriced}>غير مسعّر</p>
              ) : (
                <>
                  <p className={styles.variantPrice}>{formatMoney(variant.priceHalalas)}</p>
                  <AddToCart variantId={variant.id} />
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
