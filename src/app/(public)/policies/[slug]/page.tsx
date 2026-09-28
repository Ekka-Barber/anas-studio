import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { z } from 'zod'

import { POLICY_DOC_IDS, POLICY_DOC_LABELS, policySchema, type PolicyDocId } from '@/admin/collections/policies'
import { RichText } from '@/lib/richtext'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { Edge } from '@/components/weave/Edge'
import { requireEnv } from '@/lib/env'

/**
 * The store's policies (P07): four fixed documents over the `policies`
 * content collection, rendered at build time exactly as `fetchPublished`
 * reads any collection (published_documents, publishable key, the
 * collection's Zod schema). An unpublished policy is a page that says so —
 * never a 404 and never invented text.
 */
export const dynamicParams = false

export function generateStaticParams(): Array<{ slug: string }> {
  return POLICY_DOC_IDS.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const id = POLICY_DOC_IDS.find((entry) => entry === slug)
  return { title: id === undefined ? undefined : POLICY_DOC_LABELS[id] }
}

async function getPublishedPolicy(id: PolicyDocId): Promise<z.infer<typeof policySchema> | null> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const params = new URLSearchParams({ collection: 'eq.policies', doc_id: `eq.${id}`, select: 'data' })
  const response = await fetch(`${url}/rest/v1/published_documents?${params}`, { headers: { apikey: key } })
  if (!response.ok) {
    throw new Error(`Failed to fetch policies/${id}: ${response.status}`)
  }
  const rows = (await response.json()) as Array<{ data: unknown }>
  if (rows.length === 0 || rows[0]!.data === null) return null
  return policySchema.parse(rows[0]!.data)
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const id = POLICY_DOC_IDS.find((entry) => entry === slug)
  if (id === undefined) notFound()
  const policy = await getPublishedPolicy(id)

  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" edge="crenel" pad="hero" padEnd="m">
        <h1 className={styles.title}>{policy?.title ?? POLICY_DOC_LABELS[id]}</h1>
      </Band>
      <Edge kind="weave" />
      <Band tone="sand" pad="l" padEnd="xl">
        {policy === null ? (
          <p className={styles.note}>لم تُنشر هذه السياسة بعد.</p>
        ) : (
          <div className={styles.policyBody}>
            <RichText document={policy.body} />
          </div>
        )}
      </Band>
    </main>
  )
}
