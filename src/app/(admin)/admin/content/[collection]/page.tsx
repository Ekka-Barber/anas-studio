import { notFound } from 'next/navigation'

import { collections, type Collection } from '@/admin/collections'
import { AdminShell } from '@/components/admin/AdminShell'
import { CollectionList } from '@/components/admin/CollectionList'

function isCollection(value: string): value is Collection {
  return value in collections
}

/** `/admin/content/[collection]`: the documents of one collection. */
export default async function CollectionPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params
  if (!isCollection(collection)) notFound()

  return (
    <AdminShell>
      <CollectionList collection={collection} />
    </AdminShell>
  )
}
