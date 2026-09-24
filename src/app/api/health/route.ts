import { withDb } from '@/lib/db'

/**
 * Public health endpoint (D29).
 *
 * It lives at `/api/health`. The response contains no secrets, no hostnames,
 * no credentials and no stack traces — it is polled by an external monitor.
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
    const startedAt = Date.now()
    await withDb((client) => client.query('select public.health()'))
    const databaseLatencyMs = Date.now() - startedAt

    return Response.json(
      {
        ok: true,
        data: {
          status: 'ok',
          checkedAt: new Date().toISOString(),
          database: { ok: true, latencyMs: databaseLatencyMs },
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
