import { getPayloadClient } from '@/lib/payload'

/**
 * Public health endpoint.
 *
 * It lives at `/api/health`, directly beside Payload's REST catch-all at
 * `/api/[...slug]`. A literal path segment wins over a catch-all in Next's
 * route matching, which is exactly the coexistence P00 has to prove rather than
 * assume.
 *
 * The response contains no secrets, no hostnames, no credentials and no stack
 * traces — it is polled by an external monitor.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-robots-tag': 'noindex',
}

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID()

  try {
    const payload = await getPayloadClient()

    const startedAt = Date.now()
    await payload.db.pool.query('select 1')
    const databaseLatencyMs = Date.now() - startedAt

    // Bounded job-freshness probe: the single newest *completed* job.
    // Filtering on `completedAt` matters — sorting the whole collection by
    // `updatedAt` returns whichever job was queued most recently, which is by
    // definition not finished yet, and would report `null` forever.
    const jobs = await payload.find({
      collection: 'payload-jobs',
      depth: 0,
      limit: 1,
      sort: '-completedAt',
      where: { completedAt: { exists: true } },
      overrideAccess: true,
    })
    const lastJob = jobs.docs[0]
    const lastJobCompletedAt =
      lastJob && typeof lastJob.completedAt === 'string' ? lastJob.completedAt : null

    return Response.json(
      {
        ok: true,
        data: {
          status: 'ok',
          checkedAt: new Date().toISOString(),
          database: { ok: true, latencyMs: databaseLatencyMs },
          jobs: { lastCompletedAt: lastJobCompletedAt },
        },
      },
      { headers: NO_STORE },
    )
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: 'تعذّر التحقق من حالة الخدمة الآن.',
        },
        requestId,
      },
      { status: 503, headers: NO_STORE },
    )
  }
}
