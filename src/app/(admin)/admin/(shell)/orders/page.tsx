import type { Metadata } from 'next'

import { OrdersView } from '@/components/admin/OrdersView'

export const metadata: Metadata = { title: 'الطلبات' }

export default function OrdersPage() {
  return <OrdersView />
}
