/**
 * Media housekeeping (I29): once a day pg_cron asks the `outbox` function for
 * the `media_sweep` job. Upload parts left under `quarantine/` for more than
 * a day are removed through the Storage API (Storage refuses direct deletes
 * in SQL), then upload tickets older than a day are purged. The run is
 * recorded as `media_sweep` for the owner home.
 */
import { PRIVATE_BUCKET, type MediaStore } from './admin.ts'
import type { Rpc } from './db.ts'

const BATCH = 100
/** A daily run removes at most this many batches; the rest waits a day. */
const MAX_BATCHES = 10

export interface MediaSweepSummary {
  job: 'media_sweep'
  status: 'ok' | 'failed'
  objects: number
  tickets: number
}

/** One sweep. Never throws: a failure is recorded as a failed run. */
export async function runMediaSweep(rpc: Rpc, store: MediaStore): Promise<MediaSweepSummary> {
  const startedAt = new Date().toISOString()
  const summary: MediaSweepSummary = { job: 'media_sweep', status: 'ok', objects: 0, tickets: 0 }
  try {
    let removed = new Set<string>()
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const keys = ((await rpc('media_sweep_candidates', { p_limit: BATCH })) as string[] | null) ?? []
      // The store does not report a failed removal, so a key that is still
      // listed after it was removed means Storage refused it.
      if (keys.some((key) => removed.has(key))) throw new Error('REMOVE_FAILED')
      if (keys.length === 0) break
      await store.remove(PRIVATE_BUCKET, keys)
      summary.objects += keys.length
      removed = new Set(keys)
    }
    summary.tickets = ((await rpc('media_tickets_purge', {})) as number | null) ?? 0
  } catch {
    summary.status = 'failed'
  }
  try {
    await rpc('job_run_record', {
      p_job: 'media_sweep',
      p_status: summary.status,
      p_detail: { objects: summary.objects, tickets: summary.tickets },
      p_started_at: startedAt,
    })
  } catch {
    // The database being down is already a failed run.
    summary.status = 'failed'
  }
  return summary
}
