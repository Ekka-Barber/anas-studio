import type { Metadata } from 'next'

import { documentTitle } from '@/admin/collections'
import { BookView } from '@/components/public/book/BookView'
import { getBookRoom, getJournalName, getNav, navLabel } from '@/lib/content'
import { editionOffer, getProducts } from '@/lib/store'

/**
 * The book's names are Anas's to change (its document), so the title waits for them: «كتبتُ هنا: خوص | حكايات شارع 4»
 * while the seed stands.
 */
export async function generateMetadata(): Promise<Metadata> {
  const book = await getBookRoom()
  const subtitle = book.subtitle.trim()
  return { title: `${documentTitle('rooms', 'book', book)}${subtitle ? ` | ${subtitle}` : ''}` }
}

/**
 * كتبتُ هنا (D39): the book's page, with the P02 preview reader inside it. Built from its published document; the admin
 * preview renders the same view with a draft. Each edition that names a priced store variant (`variantSku`) shows that
 * variant's price and the way to its product's page: the catalog is read here, at build time, so the view stays free of
 * the loaders.
 */
export default async function BookPage() {
  const [book, journalName, nav, products] = await Promise.all([getBookRoom(), getJournalName(), getNav(), getProducts()])
  return (
    <BookView
      book={book}
      journalName={journalName}
      backName={navLabel(nav, '/shelf')}
      offers={book.editions.map((edition) => editionOffer(products, edition.variantSku))}
    />
  )
}
