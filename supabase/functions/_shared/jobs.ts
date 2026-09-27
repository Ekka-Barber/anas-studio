/**
 * The scheduled-jobs entry point: the `outbox` Edge Function (P06,
 * ARCHITECTURE "Jobs"; was the Worker cron's `POST /api/jobs/run`, D32).
 * pg_cron calls it with `Authorization: Bearer ${JOBS_SECRET}` read from
 * Vault: each minute while an email row is due (an empty body or `{}`), and
 * once a day with `{"job": "media_sweep"}` (I29). An unset secret means the
 * endpoint does not exist (404); a wrong or missing bearer is 401. The reply
 * carries counts only, never a recipient, a message or a storage key.
 */
import { type MediaStore, storageStore } from './admin.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv, secretsMatch } from './env.ts'
import { NO_STORE } from './http.ts'
import { runMediaSweep } from './media-sweep.ts'
import { runOutbox } from './outbox.ts'

const BEARER_PREFIX = 'Bearer '

export async function handleJobs(
  request: Request,
  rpc: Rpc = serviceRpc(),
  store: () => MediaStore = storageStore,
): Promise<Response> {
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
  let job: unknown
  try {
    const text = await request.text()
    job = text ? (JSON.parse(text) as { job?: unknown } | null)?.job : undefined
  } catch {
    job = null
  }
  // Reconciliation jobs arrive with their packages (P08).
  if (job === undefined) {
    return Response.json({ ok: true, data: [await runOutbox(rpc)] }, { headers: NO_STORE })
  }
  if (job === 'media_sweep') {
    return Response.json({ ok: true, data: [await runMediaSweep(rpc, store())] }, { headers: NO_STORE })
  }
  return Response.json(
    { ok: false, error: { code: 'UNKNOWN_JOB', message: 'Unknown job.' } },
    { status: 400, headers: NO_STORE },
  )
}
