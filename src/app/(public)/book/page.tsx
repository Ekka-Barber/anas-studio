import type { Metadata } from 'next'

import { BookView } from '@/components/public/book/BookView'
import { getJournalName } from '@/lib/content'

export const metadata: Metadata = { title: 'كتبتُ هنا: خوص | حكايات شارع 4' }

/** كتبتُ هنا (D39): the book's page, with the P02 preview reader inside it. */
export default async function BookPage() {
  return <BookView journalName={await getJournalName()} />
}
