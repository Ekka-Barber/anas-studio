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
import {
  type AlertEmailData,
  emailProvider,
  type NotifyEmailData,
  type OrderEmailData,
  renderAvailability,
  renderContactNotice,
  renderNotifyConfirm,
  renderOrderLink,
  renderOrderReady,
  renderOrderRefunded,
  renderOrderShipped,
  renderOwnerAlert,
  renderReceipt,
  type RenderedEmail,
  sendEmail,
  type SendOutcome,
} from './email.ts'
import { optionalEnv } from './env.ts'
import { siteOrigin } from './http.ts'
import { notificationToken, orderAccessToken } from './tokens.ts'

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
 * `DAILY_QUOTA - RESERVE` outbox sends, only priority 0 (receipts and the other
 * mail a payment or a staff action causes, and owner alerts) still goes; staff
 * notices and recovery links (1, which a visitor can trigger) and the
 * mail below wait for the next UTC day. Sign-in codes do not travel through the
 * outbox — Supabase Auth sends them over its own SMTP connection (I28) — so the
 * reserve keeps the last sends of the Resend daily limit free for them.
 */
export const RESERVE = 20

/**
 * Further sends held back from priority 2 (confirmation and availability mail,
 * which a visitor can trigger): it stops at `DAILY_QUOTA - RESERVE -
 * LOW_RESERVE`, so recovery links and receipts go before it (contract section 8).
 */
export const LOW_RESERVE = 30

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
  /**
   * Ids only, never a token or an address; an `owner_alert` carries `{alert, ...ids}`, and a refused invoice creation
   * (`payment_create_refused`) also its short ASCII `error` code.
   */
  payload: { contactId?: string; orderId?: string; refundId?: string; itemIds?: string[]; notificationId?: string; error?: string }
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

/** A row closed without sending (`permanent`, a short ASCII code for `last_error`), or kept for a later try (`retry`). */
type Stopped = { outcome: 'retry' | 'permanent'; error: string }

const closed = (error: string): Stopped => ({ outcome: 'permanent', error })

const MAIL_KINDS = ['receipt', 'order_link', 'order_ready', 'order_shipped', 'order_refunded', 'notify_confirm', 'availability', 'owner_alert']

/**
 * Renders the rows of round 5 from their data functions (contract section 7,
 * "The dispatcher"). The token of a link is derived here from the pepper and
 * put in the text and nowhere else: never in an outbox row, a log or an rpc
 * argument. A row whose data is gone, or whose state no longer allows the mail
 * (a confirmation or an availability notice whose subscriber is not in the
 * status it needs, a ready mail whose file was revoked), is closed with a short
 * code and nothing is sent. An unknown kind stays RENDER_FAILED. A missing
 * `SITE_URL` or pepper is a retry: nothing is wrong with the row.
 */
async function renderMail(rpc: Rpc, row: ClaimedRow): Promise<RenderedEmail | Stopped> {
  const { kind, payload } = row
  if (!MAIL_KINDS.includes(kind)) return closed('RENDER_FAILED')
  const siteUrl = siteOrigin()
  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  if (!siteUrl || !pepper) return { outcome: 'retry', error: 'NOT_CONFIGURED' }

  if (kind === 'owner_alert') {
    const alert = (await rpc('alert_email_data', { p_payload: payload })) as AlertEmailData | null
    // `alert_email_data` has no branch for the kinds of FABLE-AUDIT round M1a and answers them with `{alert}` alone, so
    // the code of a refused invoice creation is taken from the alert's own payload until it carries one itself.
    return alert ? renderOwnerAlert({ error: payload.error ?? null, ...alert }, siteUrl) : closed('GONE')
  }

  if (kind === 'notify_confirm' || kind === 'availability') {
    const id = payload.notificationId
    const data = id ? ((await rpc('notify_email_data', { p_id: id })) as NotifyEmailData | null) : null
    if (!id || !data) return closed('GONE')
    if (kind === 'notify_confirm') {
      if (data.status !== 'pending') return closed('NOT_PENDING')
      return renderNotifyConfirm(data, siteUrl, await notificationToken(pepper, id, data.tokenVersion))
    }
    if (data.status !== 'confirmed') return closed('NOT_CONFIRMED')
    return renderAvailability(data, siteUrl, await notificationToken(pepper, id, data.tokenVersion))
  }

  const { orderId } = payload
  const data = orderId
    ? ((await rpc('order_email_data', {
        p_order: orderId,
        ...(kind === 'order_refunded' ? { p_refund: payload.refundId ?? null } : {}),
        ...(kind === 'order_shipped' ? { p_item_ids: payload.itemIds ?? null } : {}),
      })) as OrderEmailData | null)
    : null
  if (!data) return closed('GONE')
  const token = await orderAccessToken(pepper, data.idempotencyKey, data.tokenVersion)
  switch (kind) {
    case 'receipt':
      return renderReceipt(data, siteUrl, token)
    case 'order_link':
      return renderOrderLink(data, siteUrl, token)
    case 'order_ready': {
      // The listed items must be lines of the order: anything else is a producer's mistake and stays in the attention list.
      const listed = data.lines.filter((line) => payload.itemIds?.includes(line.itemId))
      if (listed.length === 0) return closed('GONE')
      const files = listed.filter((line) => line.hasFile)
      return files.length > 0 ? renderOrderReady(data, files, siteUrl, token) : closed('NO_FILE')
    }
    case 'order_shipped':
      return data.shipment ? renderOrderShipped(data, data.shipment, siteUrl, token) : closed('NO_SHIPMENT')
    default: // order_refunded: MAIL_KINDS holds no other kind here
      return data.refund ? renderOrderRefunded(data, data.refund, siteUrl, token) : closed('NO_REFUND')
  }
}

async function processRow(rpc: Rpc, row: ClaimedRow): Promise<SendOutcome | Stopped> {
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
    const mail = await renderMail(rpc, row)
    if ('outcome' in mail) return mail
    rendered = mail
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
  // Nothing is claimed while the function cannot send, or cannot build a link (the site address and the pepper every
  // order and notify mail needs): the rows wait as they are, and no attempt is spent on a deployment's mistake.
  const unconfigured = !emailConfigured() ? 'EMAIL_NOT_CONFIGURED' : !siteOrigin() || !optionalEnv('TOKEN_HASH_PEPPER') ? 'SITE_NOT_CONFIGURED' : null
  if (unconfigured) {
    const skipped: OutboxSummary = { job: 'email_outbox', status: 'skipped', claimed: 0, accepted: 0, retry: 0, permanent: 0, uncertain: 0, reason: unconfigured }
    try {
      await rpc('job_run_record', {
        p_job: 'email_outbox',
        p_status: 'skipped',
        p_detail: { reason: skipped.reason },
        p_started_at: new Date().toISOString(),
      })
    } catch {
      // The database being down does not change the answer: nothing can be sent.
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
        p_low_reserve: LOW_RESERVE,
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
      // The account refused the call (a revoked key, an unverified domain):
      // every further send would be refused the same way, so stop here too.
      // The row waits without using up an attempt (outbox_result), and the run
      // is recorded failed with the reason, for the owner to fix the account.
      if (outcome.outcome === 'retry' && outcome.error === 'PROVIDER_CONFIG') {
        summary.reason = 'PROVIDER_CONFIG'
        break
      }
    }
    if (summary.reason === 'PROVIDER_CONFIG') {
      summary.status = 'failed'
    } else if (summary.claimed === 0) {
      // `outbox_kick` calls this function only while a row is due, so an empty
      // claim means a daily, reserve or monthly cap is holding mail back. An
      // 'ok' run every minute hid that from the owner home: record it as a
      // partial run with a reason the home can read.
      // ponytail: inferred from the empty claim (no service_role-readable due
      // predicate); AdminHome pairs the reason with `outbox_due_since`, so a
      // one-off empty claim after a lease flip cannot warn by itself.
      summary.status = 'partial'
      summary.reason = 'QUOTA_HELD'
    } else {
      summary.status = summary.accepted === summary.claimed ? 'ok' : summary.accepted > 0 ? 'partial' : 'failed'
    }
    await rpc('job_run_record', {
      p_job: 'email_outbox',
      p_status: summary.status,
      p_detail: summary.reason ? { ...counts(summary), reason: summary.reason } : counts(summary),
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
