import type { Metadata } from 'next'
import { Suspense } from 'react'

import { OrderView } from '@/components/admin/OrderView'

export const metadata: Metadata = { title: 'الطلب' }

// D32: one static page; the order id travels in `?id=`, because a static
// export cannot know the orders made after the build.
export default function OrderViewPage() {
  return (
    <Suspense>
      <OrderView />
    </Suspense>
  )
}
