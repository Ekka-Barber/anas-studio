import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ProjectView } from '@/components/admin/projects/ProjectView'

export const metadata: Metadata = { title: 'المشاريع' }

// D32: one static page; the project's id travels in `?id=` (and a card's in `&card=`), because a static export cannot
// know the projects made after the build.
export default function ProjectViewPage() {
  return (
    <Suspense>
      <ProjectView />
    </Suspense>
  )
}
