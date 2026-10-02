/**
 * Media housekeeping (I29, P08 round 7): once a day pg_cron asks the `outbox`
 * function for the `media_sweep` job. Upload parts left under `quarantine/` for
 * more than a day are removed through the Storage API (Storage refuses direct
 * deletes in SQL), then upload tickets older than a day are purged. The same
 * run removes the paid files' upload parts that were never completed: objects
 * under `incoming/` of the `paid-files` bucket older than a day. Nothing under
 * `assets/` is ever listed or removed: a listed key outside the swept prefix
 * fails the run before anything is removed. The run is recorded as
 * `media_sweep` for the owner home.
 */
import { PRIVATE_BUCKET, type MediaStore } from './admin.ts'
import type { Rpc } from './db.ts'
import { PAID_BUCKET } from './paid-files.ts'

const BATCH = 100
/** A daily run removes at most this many batches; the rest waits a day. */
const MAX_BATCHES = 10

export interface MediaSweepSummary {
  job: 'media_sweep'
  status: 'ok' | 'failed'
  objects: number
  tickets: number
  /** Uncompleted paid-file uploads removed. */
  paidFiles: number
}

/**
 * Removes what `candidates` lists, a batch at a time, from `bucket`. Throws when a listed key is outside
 * `prefix` (nothing is removed then) or Storage keeps a key it was asked to remove.
 */
async function sweepBucket(rpc: Rpc, store: MediaStore, candidates: string, bucket: string, prefix: string): Promise<number> {
  let total = 0
  let removed = new Set<string>()
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const keys = ((await rpc(candidates, { p_limit: BATCH })) as string[] | null) ?? []
    if (keys.some((key) => !key.startsWith(prefix))) throw new Error('UNEXPECTED_KEY')
    // The store does not report a failed removal, so a key that is still
    // listed after it was removed means Storage refused it.
    if (keys.some((key) => removed.has(key))) throw new Error('REMOVE_FAILED')
    if (keys.length === 0) break
    await store.remove(bucket, keys)
    total += keys.length
    removed = new Set(keys)
  }
  return total
}

/** One sweep. Never throws: a failure is recorded as a failed run. */
export async function runMediaSweep(rpc: Rpc, store: MediaStore): Promise<MediaSweepSummary> {
  const startedAt = new Date().toISOString()
  const summary: MediaSweepSummary = { job: 'media_sweep', status: 'ok', objects: 0, tickets: 0, paidFiles: 0 }
  try {
    summary.objects = await sweepBucket(rpc, store, 'media_sweep_candidates', PRIVATE_BUCKET, 'quarantine/')
    summary.tickets = ((await rpc('media_tickets_purge', {})) as number | null) ?? 0
  } catch {
    summary.status = 'failed'
  }
  // The paid files are swept on their own: a failure of one sweep never skips the other.
  try {
    summary.paidFiles = await sweepBucket(rpc, store, 'paid_files_sweep_candidates', PAID_BUCKET, 'incoming/')
  } catch {
    summary.status = 'failed'
  }
  try {
    await rpc('job_run_record', {
      p_job: 'media_sweep',
      p_status: summary.status,
      p_detail: { objects: summary.objects, tickets: summary.tickets, paidFiles: summary.paidFiles },
      p_started_at: startedAt,
    })
  } catch {
    // The database being down is already a failed run.
    summary.status = 'failed'
  }
  return summary
}
