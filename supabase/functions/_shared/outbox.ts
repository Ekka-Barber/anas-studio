/**
 * The email outbox dispatcher (P06, DATA "Email delivery and retries").
 *
 * One run of the `outbox` Edge Function (pg_cron calls it each minute when a
 * row is due, D32): lease due rows most-important-first through
 * `outbox_claim` (as `service_role`), send each, and record the outcome under
 * the same lease. Durable writes always precede the provider call — a message
 * and its notice are committed together in `contact_submit`, so an email
 * outage never loses a message: its notice is sent once the provider is back.
 */

import { type Rpc, serviceRpc } from './db.ts'
import { emailProvider, renderContactNotice, sendEmail, type SendOutcome } from './email.ts'
import { optionalEnv } from './env.ts'

/**
 * Resend's free-plan daily sending quota: "daily email quota of 100
 * emails/day and 3,000 emails/month" (fetched 2026-09-26,
 * https://resend.com/docs/knowledge-base/account-quotas-and-limits.md). A UTC
 * calendar day, reset at midnight UTC. Raise this when the plan changes.
 */
export const DAILY_QUOTA = 100

/** The same free plan's monthly quota (a UTC calendar month). */
export const MONTHLY_QUOTA = 3_000

/**
 * Sends held back for what must never wait: once the day has used
 * `DAILY_QUOTA - RESERVE` outbox sends, only priority 0 (receipts) still
 * goes; staff notices (1, which anyone can trigger through the contact form)
 * and availability notices (2) wait for the next UTC day. Sign-in codes do
 * not travel through the outbox — Supabase Auth sends them over its own SMTP
 * connection (I28) — so the reserve keeps the last sends of the Resend daily
 * limit free for them.
 */
export const RESERVE = 20

/** Rows per claim, and the lease each holds while a send is in flight. */
const CLAIM_LIMIT = 10
const LEASE_SECONDS = 120

export interface OutboxSummary {
  job: 'email_outbox'
  status: 'ok' | 'partial' | 'failed' | 'skipped'
  claimed: number
  accepted: number
  retry: number
  permanent: number
  uncertain: number
  reason?: string
}

interface ClaimedRow {
  id: string
  lease_id: string
  kind: string
  recipient: string
  payload: { contactId?: string }
  idempotency_key: string
  attempts: number
}

function counts(summary: OutboxSummary): Record<string, number> {
  return {
    claimed: summary.claimed,
    accepted: summary.accepted,
    retry: summary.retry,
    permanent: summary.permanent,
    uncertain: summary.uncertain,
  }
}

function emailConfigured(): boolean {
  if (!optionalEnv('EMAIL_FROM')) return false
  try {
    return emailProvider() !== null
  } catch {
    // A misconfiguration (Mailpit set in production) sends nothing.
    return false
  }
}

/**
 * Renders one claimed row's email. Unknown kinds never reach the provider. A
 * contact notice replies to the visitor (D31); the address is the one the
 * contact route validated and the database CHECK re-checked.
 */
function renderFor(
  kind: string,
  payload: { contactId?: string },
  contact: { name: string; email: string; message: string; created_at: Date | string } | undefined,
): { subject: string; text: string; replyTo?: string } | null {
  if (kind !== 'contact_notice' || !payload.contactId || !contact) return null
  const createdAt =
    contact.created_at instanceof Date ? contact.created_at.toISOString() : new Date(contact.created_at).toISOString()
  const notice = renderContactNotice({ name: contact.name, email: contact.email, message: contact.message, createdAt })
  return { ...notice, replyTo: contact.email }
}

async function processRow(rpc: Rpc, row: ClaimedRow): Promise<SendOutcome | { outcome: 'permanent'; error: string }> {
  let rendered: { subject: string; text: string; replyTo?: string } | null = null
  if (row.kind === 'contact_notice') {
    const rows = (await rpc('contact_for_notice', { p_id: row.payload.contactId ?? null })) as Array<{
      name: string
      email: string
      message: string
      created_at: string
    }> | null
    rendered = renderFor(row.kind, row.payload, rows?.[0])
  } else {
    // Availability notices arrive in P07; until then such rows are never sent.
    rendered = null
  }
  if (!rendered) return { outcome: 'permanent', error: 'RENDER_FAILED' }
  return sendEmail({
    to: row.recipient,
    subject: rendered.subject,
    text: rendered.text,
    idempotencyKey: row.idempotency_key,
    replyTo: rendered.replyTo,
  })
}

/** One dispatch run. Never throws: a failure is recorded as a failed run. */
export async function runOutbox(rpc: Rpc = serviceRpc()): Promise<OutboxSummary> {
  if (!emailConfigured()) {
    const skipped: OutboxSummary = { job: 'email_outbox', status: 'skipped', claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0, reason: 'EMAIL_NOT_CONFIGURED' }
    try {
      await rpc('job_run_record', {
        p_job: 'email_outbox',
        p_status: 'skipped',
        p_detail: { reason: skipped.reason },
        p_started_at: new Date().toISOString(),
      })
    } catch {
      // The database being down does not change the answer: email is not configured.
    }
    return skipped
  }

  const startedAt = new Date()
  const summary: OutboxSummary = { job: 'email_outbox', status: 'ok', claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0 }
  try {
    // One row per claim: every claim recounts the day and the month, so both
    // quotas are checked immediately before each send (one batch claim could
    // overshoot by the whole batch), and when a cap is hit the rows never
    // claimed simply stay pending for the next run.
    for (let slot = 0; slot < CLAIM_LIMIT; slot += 1) {
      const claimed = (await rpc('outbox_claim', {
        p_limit: 1,
        p_lease_seconds: LEASE_SECONDS,
        p_daily_quota: DAILY_QUOTA,
        p_reserve: RESERVE,
        p_monthly_quota: MONTHLY_QUOTA,
      })) as ClaimedRow[] | null
      const row = claimed?.[0]
      if (!row) break
      summary.claimed += 1
      let outcome: SendOutcome | { outcome: 'permanent'; error: string }
      try {
        outcome = await processRow(rpc, row)
      } catch {
        // An unexpected failure before or during the send: the request may
        // or may not have left, so the row stays reconcilable.
        outcome = { outcome: 'uncertain', error: 'DISPATCH_FAILED' }
      }
      if (outcome.outcome === 'accepted') summary.accepted += 1
      else summary[outcome.outcome] += 1
      await rpc('outbox_result', {
        p_id: row.id,
        p_lease_id: row.lease_id,
        p_outcome: outcome.outcome,
        p_provider_id: outcome.outcome === 'accepted' ? outcome.providerId : null,
        p_error: outcome.outcome === 'accepted' ? null : outcome.error,
      })
      // The provider's quota is spent, so every further claim would be
      // refused too: stop. The row waits for the reset without using up an
      // attempt (outbox_result).
      if (outcome.outcome === 'retry' && outcome.error === 'QUOTA') break
    }
    summary.status =
      summary.claimed === 0 || summary.accepted === summary.claimed ? 'ok' : summary.accepted > 0 ? 'partial' : 'failed'
    await rpc('job_run_record', {
      p_job: 'email_outbox',
      p_status: summary.status,
      p_detail: counts(summary),
      p_started_at: startedAt.toISOString(),
    })
  } catch {
    // The database refused or was unreachable mid-run: report the failure.
    // A row claimed before the failure keeps its lease, and an expired lease
    // turns it `uncertain`, never back to a blind resend.
    summary.status = 'failed'
    return summary
  }
  return summary
}
