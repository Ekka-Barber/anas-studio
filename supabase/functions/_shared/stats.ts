/**
 * The owner's statistics (P06 round 2, D21): what `/admin/stats` and the
 * owner home block read through the `admin` Edge Function's `stats` action. Unconfigured is
 * explicit — never an invented zero.
 */
import { fetchAnalytics, type AnalyticsResult } from './analytics.ts'

/** The cached part of the `stats` answer; the `admin` function adds `commerce` (the ledger's figures, or null) on every call. */
export interface OwnerStats {
  generatedAt: string
  analytics: AnalyticsResult
}

export async function ownerStats(): Promise<OwnerStats> {
  return {
    generatedAt: new Date().toISOString(),
    analytics: await fetchAnalytics(),
  }
}
