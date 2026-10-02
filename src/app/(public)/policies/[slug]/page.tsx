import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { POLICY_DOC_IDS, POLICY_DOC_LABELS } from '@/admin/collections/policies'
import { RichText } from '@/lib/richtext'
import styles from '@/components/store/store.module.css'
import { Band } from '@/components/weave/Band'
import { calmEnter } from '@/components/weave/motion'
import { getPublishedPolicies } from '@/lib/policies'

/**
 * The store's policies (P07): four fixed documents over the `policies`
 * content collection, rendered at build time from `getPublishedPolicies`
 * (the loader the checkout page shares, so the text shown and the revision the
 * checkout sends come from one fetch). An unpublished policy is a page that
 * says so — never a 404 and never invented text.
 */
export const dynamicParams = false

export function generateStaticParams(): Array<{ slug: string }> {
  return POLICY_DOC_IDS.map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const id = POLICY_DOC_IDS.find((entry) => entry === slug)
  if (id === undefined) return {}
  // The published title, like the page's h1 (the same loader call: React's cache shares it).
  const policy = (await getPublishedPolicies())[id]?.data
  return { title: policy?.title ?? POLICY_DOC_LABELS[id] }
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const id = POLICY_DOC_IDS.find((entry) => entry === slug)
  if (id === undefined) notFound()
  const policy = (await getPublishedPolicies())[id]?.data ?? null

  return (
    <main id="main" className={styles.page}>
      <Band as="header" tone="paper" pad="hero" padEnd="m" className={styles.docHead}>
        <h1 className={styles.title} {...calmEnter}>{policy?.title ?? POLICY_DOC_LABELS[id]}</h1>
      </Band>
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
