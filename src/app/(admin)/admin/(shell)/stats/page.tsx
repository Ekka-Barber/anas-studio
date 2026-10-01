import type { Metadata } from 'next'

import { StatsView } from '@/components/admin/StatsView'

export const metadata: Metadata = { title: 'الإحصاءات' }

export default function StatsPage() {
  return <StatsView />
}
