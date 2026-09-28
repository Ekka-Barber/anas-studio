import type { Metadata } from 'next'

import { Picture } from '@/components/public/Picture'
import { AddToCart } from '@/components/store/AddToCart'
import { CartLink } from '@/components/store/CartLink'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { RichText } from '@/lib/richtext'
import { formatMoney } from '@/lib/format'
import { getProducts } from '@/lib/store'

import NotFound from '../../not-found'

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
// digits and hyphens): its page is the site's not-found page inside the
// public layout (`notFound()` would export Next's bare error document, with
// no `lang`), never a fake product, and out/store.html says «لا توجد منتجات بعد.».
const NO_PRODUCTS = '_'

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = (await getProducts()).map((product) => ({ slug: product.slug }))
  return slugs.length > 0 ? slugs : [{ slug: NO_PRODUCTS }]
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const product = (await getProducts()).find((entry) => entry.slug === slug)
  return { title: product?.title ?? 'هذا الطريق لم يُبنَ بعد' }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = (await getProducts()).find((entry) => entry.slug === slug)
  if (!product) return <NotFound />

  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="saffron" edge="crenel" pad="hero" padEnd="l" className={styles.head}>
        <div>
          <h1 className="t-band-xl">{product.title}</h1>
          {product.summary !== '' && <p className={styles.productSummary}>{product.summary}</p>}
        </div>
        <CartLink />
      </Band>
      <Edge kind="weave" />
      <Band tone="sand" pad="l">
        {product.cover !== null && (
          <Picture id={product.cover} alt={product.title} sizes="(min-width: 768px) 480px, 100vw" className={styles.productCover} />
        )}
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
      </Band>
    </main>
  )
}
