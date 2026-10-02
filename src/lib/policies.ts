import { cache } from 'react'

import { POLICY_DOC_IDS, policySchema, type PolicyDocId } from '@/admin/collections/policies'
import { requireEnv } from '@/lib/env'

/** One published policy: its content, and the revision (`seq`) this build was made from. */
export type PublishedPolicy = { data: ReturnType<typeof policySchema.parse>; seq: number }

/**
 * The store's published policies in one fetch per render (P08 contract
 * section 6, "Policy consent"). The policy pages show `data`, and the checkout
 * page hands the `seq` of each to the form: the revision a buyer agrees to is
 * the revision of the text the same build shows. Read like any collection
 * (published_documents, publishable key, the collection's Zod schema); a
 * policy that was never published is null.
 */
export const getPublishedPolicies = cache(async (): Promise<Record<PolicyDocId, PublishedPolicy | null>> => {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const params = new URLSearchParams({ collection: 'eq.policies', select: 'doc_id,data,seq' })
  const response = await fetch(`${url}/rest/v1/published_documents?${params}`, { headers: { apikey: key } })
  if (!response.ok) {
    throw new Error(`Failed to fetch policies: ${response.status}`)
  }
  const rows = (await response.json()) as Array<{ doc_id: string; data: unknown; seq: number }>
  const policies: Record<PolicyDocId, PublishedPolicy | null> = { store: null, delivery: null, refund: null, privacy: null }
  for (const row of rows) {
    const id = POLICY_DOC_IDS.find((entry) => entry === row.doc_id)
    if (id !== undefined && row.data !== null) policies[id] = { data: policySchema.parse(row.data), seq: row.seq }
  }
  return policies
})
