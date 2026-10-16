import type { Metadata } from 'next'

import { MyCards } from '@/components/admin/projects/MyCards'

export const metadata: Metadata = { title: 'مهامي' }

export default function MyCardsPage() {
  return <MyCards />
}
