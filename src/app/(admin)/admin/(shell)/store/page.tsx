import type { Metadata } from 'next'

import { StoreHome } from './StoreHome'

export const metadata: Metadata = { title: 'المتجر' }

/** `/admin/store`: the store's tables and the policies link (P07 round 2). */
export default function StorePage() {
  return <StoreHome />
}
