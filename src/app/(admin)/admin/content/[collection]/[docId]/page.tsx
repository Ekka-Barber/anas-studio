import { notFound } from 'next/navigation'

import { collections, roomSchemas, SITE_SETTINGS_DOC_ID, type Collection } from '@/admin/collections'
import { AdminShell } from '@/components/admin/AdminShell'
import { CollectionForm } from '@/components/admin/CollectionForm'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function isCollection(value: string): value is Collection {
  return value in collections
}

function isValidDocId(collection: Collection, docId: string): boolean {
  if (collection === 'rooms') return docId in roomSchemas
  if (collection === 'site_settings') return docId === SITE_SETTINGS_DOC_ID
  if (collection === 'posts') return UUID_PATTERN.test(docId)
  return SLUG_PATTERN.test(docId)
}

/** `/admin/content/[collection]/[docId]`: edit, save, publish one document. */
export default async function DocumentPage({ params }: { params: Promise<{ collection: string; docId: string }> }) {
  const { collection, docId } = await params
  if (!isCollection(collection) || !isValidDocId(collection, docId)) notFound()

  return (
    <AdminShell>
      <CollectionForm collection={collection} docId={docId} />
    </AdminShell>
  )
}
