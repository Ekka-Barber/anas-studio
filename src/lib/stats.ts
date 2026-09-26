/**
 * The owner's statistics (P06 round 2, D21): what `/admin/stats` and the
 * owner home block read through `GET /api/admin/stats`. Unconfigured is
 * explicit — never an invented zero.
 */
import { fetchAnalytics, type AnalyticsResult } from './analytics'

export interface OwnerStats {
  generatedAt: string
  /** The order/payment tables arrive in P07/P08; until then commerce is explicitly not configured. */
  commerce: { status: 'not_configured' }
  analytics: AnalyticsResult
}

export async function ownerStats(): Promise<OwnerStats> {
  // P08: once the finance schema exists, the SQL counts (orders, paid,
  // refunds, net collected, customers — exact DB totals, excluding test and
  // unpaid rows, per PLANS/VERIFICATION.md) are queried here through
  // `src/lib/db.ts` and replace the `not_configured` placeholder.
  return {
    generatedAt: new Date().toISOString(),
    commerce: { status: 'not_configured' },
    analytics: await fetchAnalytics(),
  }
}
