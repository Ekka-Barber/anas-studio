import { optionalEnv, secretsMatch } from '@/lib/env'
import { runJobs } from '@/lib/jobs'

/**
 * The cron entry point (P06, ARCHITECTURE "Jobs"). Guarded by
 * `Authorization: Bearer ${JOBS_SECRET}`: an unset secret means the endpoint
 * does not exist (404), a wrong or missing bearer is 401 — the same rules as
 * `/api/revalidate`, and `worker-entry.ts` enforces them again before
 * OpenNext runs. The reply carries counts only, never a recipient or a
 * message.
 */
export const dynamic = 'force-dynamic'

const BEARER_PREFIX = 'Bearer '

export async function POST(request: Request): Promise<Response> {
  const secret = optionalEnv('JOBS_SECRET')
  if (!secret) {
    return new Response(null, { status: 404 })
  }
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith(BEARER_PREFIX) || !secretsMatch(authorization.slice(BEARER_PREFIX.length), secret)) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing jobs secret.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const summaries = await runJobs()
  return Response.json({ ok: true, data: summaries }, { headers: { 'cache-control': 'no-store' } })
}
