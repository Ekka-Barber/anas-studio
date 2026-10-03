import type { Metadata } from 'next'

import { ReconciliationView } from '@/components/admin/ReconciliationView'

export const metadata: Metadata = { title: 'المطابقة' }

export default function ReconciliationPage() {
  return <ReconciliationView />
}
