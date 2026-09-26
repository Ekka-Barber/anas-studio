'use client'

import { useSearchParams } from 'next/navigation'

import { roomSchemas, SITE_SETTINGS_DOC_ID, type Collection } from '@/admin/collections'

import { CollectionForm } from './CollectionForm'
import styles from './admin.module.css'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function isValidDocId(collection: Collection, docId: string): boolean {
  if (collection === 'rooms') return docId in roomSchemas
  if (collection === 'site_settings') return docId === SITE_SETTINGS_DOC_ID
  if (collection === 'posts') return UUID_PATTERN.test(docId)
  return SLUG_PATTERN.test(docId)
}

/** Reads `?id=` and opens that document, or says it does not exist (D32). */
export function DocumentEditor({ collection }: { collection: Collection }) {
  const docId = useSearchParams().get('id') ?? ''
  if (!isValidDocId(collection, docId)) {
    return <p className={styles.error}>المستند غير موجود.</p>
  }
  // Keyed by the id: opening another document starts a fresh form.
  return <CollectionForm key={`${collection}:${docId}`} collection={collection} docId={docId} />
}
