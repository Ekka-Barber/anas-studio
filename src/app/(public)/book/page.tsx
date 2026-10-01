import type { Metadata } from 'next'

import { BookView } from '@/components/public/book/BookView'
import { getBookRoom, getJournalName } from '@/lib/content'

export const metadata: Metadata = { title: 'كتبتُ هنا: خوص | حكايات شارع 4' }

/** كتبتُ هنا (D39): the book's page, with the P02 preview reader inside it. Built from its published document; the admin preview renders the same view with a draft. */
export default async function BookPage() {
  const [book, journalName] = await Promise.all([getBookRoom(), getJournalName()])
  return <BookView book={book} journalName={journalName} />
}
