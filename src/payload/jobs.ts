import type { JobsConfig, TaskConfig } from 'payload'

import { isNodeRuntimeTarget } from '../lib/env'
import { RUNTIME_PROBE_SLUG } from './collections/RuntimeProbe'

export const PROBE_HEARTBEAT_TASK = 'probeHeartbeat'

/**
 * One bounded scheduled task.
 *
 * "Bounded" is literal: it reads at most one document, writes at most one
 * document, and does no iteration. The Worker `scheduled` handler invokes
 * Payload's native job queue; there is no in-memory timer and no second
 * deployed worker.
 */
const probeHeartbeat: TaskConfig<'probeHeartbeat'> = {
  slug: PROBE_HEARTBEAT_TASK,
  label: 'نبضة الفحص المجدولة',
  retries: 0,
  schedule: [
    {
      cron: '*/15 * * * *',
      queue: 'default',
    },
  ],
  inputSchema: [],
  outputSchema: [
    { name: 'probeId', type: 'text' },
    { name: 'ranAt', type: 'text' },
    { name: 'updated', type: 'checkbox' },
  ],
  handler: async ({ req }) => {
    const ranAt = new Date().toISOString()

    const { docs } = await req.payload.find({
      collection: RUNTIME_PROBE_SLUG,
      depth: 0,
      limit: 1,
      sort: '-createdAt',
      // System job: it runs with no human actor, so access control is bypassed
      // deliberately and explicitly, not by relying on a Local API default.
      overrideAccess: true,
      req,
    })

    const doc = docs[0]
    if (!doc) {
      return { output: { probeId: '', ranAt, updated: false } }
    }

    await req.payload.update({
      collection: RUNTIME_PROBE_SLUG,
      id: doc.id,
      data: { lastScheduledRunAt: ranAt },
      depth: 0,
      overrideAccess: true,
      req,
    })

    return { output: { probeId: String(doc.id), ranAt, updated: true } }
  },
}

/** Length-independent comparison, so a wrong secret leaks no timing signal. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/**
 * The Worker cron trigger calls `GET /api/payload-jobs/run` with a bearer
 * secret, because a scheduled invocation has no signed-in user. If `JOBS_SECRET`
 * is unset the bearer path simply does not exist — there is no open fallback.
 */
function mayRunJobs(req: { headers: Headers; user?: unknown }): boolean {
  const expected = process.env.JOBS_SECRET
  const authorization = req.headers.get('authorization')
  if (expected && authorization?.startsWith('Bearer ')) {
    return secretsMatch(authorization.slice('Bearer '.length), expected)
  }
  return Boolean(req.user)
}

export const jobs: JobsConfig = {
  tasks: [probeHeartbeat],
  // Worker target (`RUNTIME_TARGET` unset): no `autoRun`. Schedules are driven
  // by the Worker cron trigger (`worker-entry.ts` `scheduled`), never by a
  // long-lived in-process timer — a Worker isolate does not stay alive long
  // enough to host one.
  //
  // Node target (`RUNTIME_TARGET=node`, I19/D27): the Docker/VM process IS
  // long-lived, so Payload's native `autoRun` timer can own scheduling
  // in-process. Read from `payload/dist/index.js` `_initializeCrons()`: each
  // `autoRun` tick calls `handleSchedules()` (enqueues jobs for any task whose
  // `schedule` cron is due on this queue) and then `jobs.run()` (drains up to
  // `limit`). It is guarded by `!isNextBuild()`, so it never starts during
  // `next build`, and it is only initialized by `getPayload({ cron: true })`
  // (called from every request via `@payloadcms/next`'s `initReq.js`), cached
  // per process — so it starts once, in the live server, never in the CLI.
  autoRun: isNodeRuntimeTarget()
    ? [{ cron: '*/15 * * * *', queue: 'default', limit: 5 }]
    : undefined,
  // Payload deletes a job row as soon as it completes successfully
  // (`deleteJobOnComplete` defaults to `true`). That would make a successful run
  // indistinguishable from a run that never happened: only pending and failed
  // jobs would survive, so any "last completed at" signal would be permanently
  // null. Completed jobs are retained so operations can prove a scheduled run
  // actually finished. Retention is bounded by the cron cadence (one row per
  // trigger); pruning old rows is a later operations task, not a default.
  deleteJobOnComplete: false,
  access: {
    run: ({ req }) => mayRunJobs(req),
    queue: ({ req }) => Boolean(req.user),
    cancel: ({ req }) => Boolean(req.user),
  },
}
