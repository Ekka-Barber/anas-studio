import type { Metadata } from 'next'

import { BookView } from '@/components/public/book/BookView'

export const metadata: Metadata = { title: 'كتبتُ هنا: خوص | حكايات شارع 4' }

/** كتبتُ هنا (D39). The page-turning reader arrives with P02. */
export default function BookPage() {
  return <BookView />
}
