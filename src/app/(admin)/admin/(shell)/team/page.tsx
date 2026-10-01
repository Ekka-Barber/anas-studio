import type { Metadata } from 'next'

import { TeamView } from '@/components/admin/TeamView'

export const metadata: Metadata = { title: 'الفريق' }

export default function TeamPage() {
  return <TeamView />
}
