import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'

import { getPayloadClient } from '@/lib/payload'
import { runtimeProbeTag } from '@/lib/revalidate'
import { RUNTIME_PROBE_SLUG } from '@/payload/collections/RuntimeProbe'
import type { RuntimeProbe } from '@/payload-types'

/**
 * I20/D27 public read-path spike.
 *
 * Reads one published RuntimeProbe document through the Payload Local API,
 * anonymously (`overrideAccess: false`, no user) — the collection's `read`
 * access decides, and it now allows anonymous readers only `_status:
 * 'published'` documents (see `RuntimeProbe.ts`). Drafts and deleted/missing
 * documents both 404; nothing here distinguishes "draft" from "gone" to an
 * anonymous visitor.
 *
 * Wrapped in `unstable_cache` with a per-id tag so the R2/D1 incremental
 * cache (`open-next.config.ts`) can serve this page without invoking Payload
 * on a cache hit, and so `POST /api/revalidate` can target this one page by
 * id without touching any other probe.
 */

async function readPublishedProbe(id: string): Promise<RuntimeProbe | null> {
  return unstable_cache(
    async () => {
      const payload = await getPayloadClient()
      try {
        return await payload.findByID({
          collection: RUNTIME_PROBE_SLUG,
          id,
          depth: 0,
          overrideAccess: false,
        })
      } catch {
        // Payload's Local API throws NotFound for a missing id and for an id
        // the access constraint excludes (draft, or does not exist) — the two
        // are indistinguishable here on purpose, same as any 404.
        return null
      }
    },
    ['runtime-probe-public', id],
    { tags: [runtimeProbeTag(id)] },
  )()
}

interface ProbePageProps {
  params: Promise<{ id: string }>
}

// An empty list, not the route's absence: this is what puts `/probe/[id]` in
// the prerender manifest's `dynamicRoutes` (verified against the built
// `.next/prerender-manifest.json` in the `anasaq-bundle` container — without
// it Next treats an unlisted dynamic segment as plain SSR, and OpenNext's
// cache interceptor (`isISR` in `cacheInterceptor.js`) never intercepts it,
// so every request would still boot Payload). Every id is generated on first
// visit and then cached; nothing is pre-rendered at build time.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return []
}

export default async function ProbePage({ params }: ProbePageProps) {
  const { id } = await params
  const probe = await readPublishedProbe(id)
  if (!probe) {
    notFound()
  }

  return (
    <main>
      <h1>{probe.title}</h1>
      <p>سجل فحص منشور — آخر تحديث {probe.updatedAt}</p>
    </main>
  )
}
