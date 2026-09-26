import { Suspense } from 'react'

import { collections, type Collection } from '@/admin/collections'
import { AdminShell } from '@/components/admin/AdminShell'
import { DocumentEditor } from '@/components/admin/DocumentEditor'

// D32: one static page per collection; the document id travels in `?id=`,
// because a static export cannot know post ids created after the build.
export const dynamicParams = false

export function generateStaticParams(): Array<{ collection: string }> {
  return Object.keys(collections).map((collection) => ({ collection }))
}

/** `/admin/content/[collection]/edit?id=…`: edit, save, publish one document. */
export default async function DocumentPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params
  return (
    <AdminShell>
      <Suspense>
        <DocumentEditor collection={collection as Collection} />
      </Suspense>
    </AdminShell>
  )
}
