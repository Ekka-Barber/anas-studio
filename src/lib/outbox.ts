/**
 * The email outbox dispatcher (P06, DATA "Email delivery and retries").
 *
 * One Worker Cron Trigger run: lease due rows most-important-first through
 * `outbox_claim` (as `app_server`), send each, and record the outcome under
 * the same lease. Durable writes always precede the provider call — a message
 * and its notice are committed together in `contact_submit`, so an email
 * outage never loses the inbox.
 */

import { optionalEnv } from './env'
import { emailProvider, renderContactNotice, sendEmail, type SendOutcome } from './email'
import { withDb } from './db'
import type { Client, QueryResult } from 'pg'

/**
 * Resend's free-plan daily sending quota: "daily email quota of 100
 * emails/day and 3,000 emails/month" (fetched 2026-09-26,
 * https://resend.com/docs/knowledge-base/account-quotas-and-limits.md). A UTC
 * calendar day, reset at midnight UTC. Raise this when the plan changes.
 */
export const DAILY_QUOTA = 100

/**
 * Sends kept free of notices at the top of the priority order: once the day
 * has used `DAILY_QUOTA - RESERVE` sends, priority 2 (availability notices)
 * waits while 0 (sign-in, receipts) and 1 (staff notices) still go.
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

/** Renders one claimed row's email. Unknown kinds never reach the provider. */
function renderFor(
  kind: string,
  payload: { contactId?: string },
  contact: { name: string; email: string; message: string; created_at: Date | string } | undefined,
) {
  if (kind !== 'contact_notice' || !payload.contactId || !contact) return null
  const createdAt =
    contact.created_at instanceof Date ? contact.created_at.toISOString() : new Date(contact.created_at).toISOString()
  return renderContactNotice({
    name: contact.name,
    email: contact.email,
    message: contact.message,
    createdAt,
    siteUrl: optionalEnv('SITE_URL') ?? '',
  })
}

async function processRow(client: Client, row: ClaimedRow): Promise<SendOutcome | { outcome: 'permanent'; error: string }> {
  let rendered: { subject: string; text: string } | null = null
  if (row.kind === 'contact_notice') {
    const result = await client.query<{ name: string; email: string; message: string; created_at: Date }>(
      'select name, email, message, created_at from public.contact_for_notice($1)',
      [row.payload.contactId ?? null],
    )
    rendered = renderFor(row.kind, row.payload, result.rows[0])
  } else {
    // Availability notices arrive in P07; until then such rows are never sent.
    rendered = null
  }
  if (!rendered) return { outcome: 'permanent', error: 'RENDER_FAILED' }
  return sendEmail({ to: row.recipient, subject: rendered.subject, text: rendered.text, idempotencyKey: row.idempotency_key })
}

/** One dispatch run. Never throws: a failure is recorded as a failed run. */
export async function runOutbox(): Promise<OutboxSummary> {
  if (!emailConfigured()) {
    const skipped: OutboxSummary = { job: 'email_outbox', status: 'skipped', claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0, reason: 'EMAIL_NOT_CONFIGURED' }
    try {
      await withDb((client) =>
        client.query('select public.job_run_record($1, $2, $3, $4)', ['email_outbox', 'skipped', JSON.stringify({ reason: skipped.reason }), new Date()]),
      )
    } catch {
      // The database being down does not change the answer: email is not configured.
    }
    return skipped
  }

  const startedAt = new Date()
  const summary: OutboxSummary = { job: 'email_outbox', status: 'ok', claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0 }
  try {
    await withDb(async (client) => {
      const claimed: QueryResult<ClaimedRow> = await client.query(
        'select id, lease_id, kind, recipient, payload, idempotency_key, attempts from public.outbox_claim($1, $2, $3, $4)',
        [CLAIM_LIMIT, LEASE_SECONDS, DAILY_QUOTA, RESERVE],
      )
      summary.claimed = claimed.rows.length
      for (const row of claimed.rows) {
        let outcome: SendOutcome | { outcome: 'permanent'; error: string }
        try {
          outcome = await processRow(client, row)
        } catch {
          // An unexpected failure before or during the send: the request may
          // or may not have left, so the row stays reconcilable.
          outcome = { outcome: 'uncertain', error: 'DISPATCH_FAILED' }
        }
        if (outcome.outcome === 'accepted') summary.accepted += 1
        else summary[outcome.outcome] += 1
        await client.query('select public.outbox_result($1, $2, $3, $4, $5)', [
          row.id,
          row.lease_id,
          outcome.outcome,
          outcome.outcome === 'accepted' ? outcome.providerId : null,
          outcome.outcome === 'accepted' ? null : outcome.error,
        ])
      }
      summary.status =
        summary.claimed === 0 || summary.accepted === summary.claimed ? 'ok' : summary.accepted > 0 ? 'partial' : 'failed'
      await client.query('select public.job_run_record($1, $2, $3, $4)', [
        'email_outbox',
        summary.status,
        JSON.stringify(counts(summary)),
        startedAt,
      ])
    })
  } catch {
    // withDb itself failed (no connection / the claim query failed): this
    // connection claimed nothing and recorded nothing; report the failure.
    summary.status = 'failed'
    return summary
  }
  return summary
}
