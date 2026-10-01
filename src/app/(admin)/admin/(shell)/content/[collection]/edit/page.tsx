import type { Metadata } from 'next'
import { Suspense } from 'react'

import { collections, COLLECTION_LABELS, type Collection } from '@/admin/collections'
import { DocumentEditor } from '@/components/admin/DocumentEditor'

// D32: one static page per collection; the document id travels in `?id=`,
// because a static export cannot know post ids created after the build.
export const dynamicParams = false

export function generateStaticParams(): Array<{ collection: string }> {
  return Object.keys(collections).map((collection) => ({ collection }))
}

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params
  return { title: `تحرير: ${COLLECTION_LABELS[collection as Collection] ?? 'المحتوى'}` }
}

/** `/admin/content/[collection]/edit?id=…`: edit, save, publish one document. */
export default async function DocumentPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params
  return (
    <Suspense>
      <DocumentEditor collection={collection as Collection} />
    </Suspense>
  )
}
