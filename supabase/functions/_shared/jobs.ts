/**
 * The scheduled-jobs entry point: the `outbox` Edge Function (P06,
 * ARCHITECTURE "Jobs"; was the Worker cron's `POST /api/jobs/run`, D32).
 * pg_cron calls it each minute while a row is due, with
 * `Authorization: Bearer ${JOBS_SECRET}` read from Vault. An unset secret
 * means the endpoint does not exist (404); a wrong or missing bearer is 401.
 * The reply carries counts only, never a recipient or a message.
 */
import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv, secretsMatch } from './env.ts'
import { NO_STORE } from './http.ts'
import { runOutbox } from './outbox.ts'

const BEARER_PREFIX = 'Bearer '

export async function handleJobs(request: Request, rpc: Rpc = serviceRpc()): Promise<Response> {
  const secret = optionalEnv('JOBS_SECRET')
  if (!secret) return new Response(null, { status: 404 })
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith(BEARER_PREFIX) || !secretsMatch(authorization.slice(BEARER_PREFIX.length), secret)) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing jobs secret.' } },
      { status: 401, headers: NO_STORE },
    )
  }
  // The email outbox is the only job for now (P06); reconciliation jobs
  // arrive with their packages (P08).
  const summaries = [await runOutbox(rpc)]
  return Response.json({ ok: true, data: summaries }, { headers: NO_STORE })
}
