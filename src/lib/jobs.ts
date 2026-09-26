/**
 * HTTP-reachable jobs (PLANS/ARCHITECTURE.md "Jobs"): the single Worker Cron
 * Trigger calls `POST /api/jobs/run`, which runs these. pg_cron owns the
 * pure-SQL jobs elsewhere; nothing here keeps in-memory state.
 */

import { runOutbox, type OutboxSummary } from './outbox'

/** Runs every job once; the summaries carry counts only, never PII. */
export async function runJobs(): Promise<OutboxSummary[]> {
  // The email outbox is the only job for now (P06); reconciliation jobs
  // arrive with their packages (P07+).
  return [await runOutbox()]
}
