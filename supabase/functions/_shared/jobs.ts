/**
 * The scheduled-jobs entry point: the `outbox` Edge Function (P06,
 * ARCHITECTURE "Jobs"; was the Worker cron's `POST /api/jobs/run`, D32).
 * pg_cron calls it with `Authorization: Bearer ${JOBS_SECRET}` read from
 * Vault: each minute while an email row is due (an empty body or `{}`), once a
 * day with `{"job": "media_sweep"}` (I29), and each minute while a payment
 * attempt, a webhook event or a refund is due with `{"job": "payments_reconcile"}`
 * (P08). An unset secret means the endpoint does not exist (404); a wrong or
 * missing bearer is 401. The reply carries counts only, never a recipient, a
 * message, a storage key or a provider id.
 */
import { type MediaStore, storageStore } from './admin.ts'
import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv, secretsMatch } from './env.ts'
import { NO_STORE } from './http.ts'
import { runMediaSweep } from './media-sweep.ts'
import { runOutbox } from './outbox.ts'
import { defaultPaymentDeps, type PaymentDeps, type PaymentsReconcileSummary, runPaymentsReconcile } from './payments.ts'

const BEARER_PREFIX = 'Bearer '

/** The payment reconciliation, or a recorded skip while payments are not configured (the job must not look healthy then). */
async function paymentsJob(rpc: Rpc, injected?: PaymentDeps): Promise<PaymentsReconcileSummary> {
  const deps = injected ?? defaultPaymentDeps(rpc)
  if (deps) return runPaymentsReconcile(deps)
  const skipped: PaymentsReconcileSummary = {
    job: 'payments_reconcile',
    status: 'skipped',
    attempts: 0,
    events: 0,
    settled: 0,
    cancelled: 0,
    errors: 0,
    skipped: 0,
    reason: 'PAYMENTS_NOT_CONFIGURED',
  }
  try {
    await rpc('job_run_record', {
      p_job: 'payments_reconcile',
      p_status: 'skipped',
      p_detail: { reason: skipped.reason },
      p_started_at: new Date().toISOString(),
    })
  } catch {
    // The database being down does not change the answer: payments are not configured.
  }
  return skipped
}

export async function handleJobs(
  request: Request,
  rpc: Rpc = serviceRpc(),
  store: () => MediaStore = storageStore,
  payments?: PaymentDeps,
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
  if (job === undefined) {
    return Response.json({ ok: true, data: [await runOutbox(rpc)] }, { headers: NO_STORE })
  }
  if (job === 'media_sweep') {
    return Response.json({ ok: true, data: [await runMediaSweep(rpc, store())] }, { headers: NO_STORE })
  }
  if (job === 'payments_reconcile') {
    return Response.json({ ok: true, data: [await paymentsJob(rpc, payments)] }, { headers: NO_STORE })
  }
  return Response.json(
    { ok: false, error: { code: 'UNKNOWN_JOB', message: 'Unknown job.' } },
    { status: 400, headers: NO_STORE },
  )
}
