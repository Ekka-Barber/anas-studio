import type { Metadata } from 'next'

import { ProjectsHome } from '@/components/admin/projects/ProjectsHome'

export const metadata: Metadata = { title: 'المشاريع' }

export default function ProjectsPage() {
  return <ProjectsHome />
}
