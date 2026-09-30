/**
 * Outbound email (P06, DATA "Email delivery and retries").
 *
 * Plain text only: user-supplied content is never placed in HTML, so it can
 * never inject markup. Nothing here logs a recipient, a body or an
 * idempotency key.
 *
 * Provider selection (`emailProvider()` below):
 * 1. A hosted site (non-local `SITE_URL`) with `RESEND_API_KEY` set —
 *    Resend (`POST https://api.resend.com/emails`,
 *    fetched 2026-09-26, resend.com/docs/api-reference/emails/send-email).
 *    The `Idempotency-Key` header (1–256 characters, kept 24 hours; the same
 *    key and payload give the same response without sending again —
 *    resend.com/docs/dashboard/emails/idempotency-keys) makes the retry
 *    classification below safe: a retried send cannot send twice within 24
 *    hours.
 * 2. a local site (local `SITE_URL`) with `EMAIL_DEV_MAILPIT_URL` set — the
 *    local Supabase stack's Mailpit (`POST /api/v1/send`, verified locally
 *    2026-09-26). Local hosts only (the functions reach it from Docker as
 *    `host.docker.internal`), never for a hosted site.
 * 3. else `EmailNotConfiguredError` — unconfigured means unavailable.
 */

import { isHostedSite, LOCAL_HOSTS, optionalEnv, requireEnv, secretsMatch } from './env.ts'

const RESEND_SEND_URL = 'https://api.resend.com/emails'
const RESEND_TIMEOUT_MS = 10_000

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('No email provider is configured (RESEND_API_KEY or EMAIL_DEV_MAILPIT_URL).')
    this.name = 'EmailNotConfiguredError'
  }
}

/**
 * `accepted` — the provider took the message (`providerId` is its id).
 * `retry` — a transient error; the caller backs off and tries again (the
 * idempotency key makes that safe).
 * `permanent` — retrying with this key/payload cannot succeed.
 * `uncertain` — the request may have left; reconcile before/inside the retry
 * window (the outbox re-claims uncertain rows while the key is still valid).
 * `error` is a short ASCII code only, safe to store in `last_error`.
 */
export type SendOutcome =
  | { outcome: 'accepted'; providerId: string }
  | { outcome: 'retry' | 'permanent' | 'uncertain'; error: string }

/** Resend error classification, from the fetched errors page
 * (resend.com/docs/api-reference/errors, 2026-09-26):
 * - 409 `concurrent_idempotent_requests` "Try the request again later" → retry;
 * - 409 `resource_locked` "Retry the request after a short delay" → retry;
 * - 409 `invalid_idempotent_request` "Change your idempotency key or payload"
 *   → permanent (retrying the same key and payload is useless);
 * - 429 `daily_quota_exceeded` / `monthly_quota_exceeded` → retry as `QUOTA`
 *   (the daily quota resets at midnight UTC; the outbox gives the attempt
 *   back and waits for the reset instead of counting it), and
 *   `rate_limit_exceeded` → retry as `RATE_LIMIT` (a short backoff;
 *   resend.com/docs/api-reference/errors, fetched 2026-09-30);
 * - other 4xx (400 `validation_error`, 401, 403 unverified domain or
 *   suspended key, 404, 405, 422 …) → permanent;
 * - 5xx (`application_error` 500, `service_unavailable` 503) "Try the request
 *   again later" → retry. */
function classifyResendFailure(status: number, name: string | undefined): { outcome: 'retry' | 'permanent'; error: string } {
  if (status === 429) {
    const quota = name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded'
    return { outcome: 'retry', error: quota ? 'QUOTA' : 'RATE_LIMIT' }
  }
  if (status === 409) {
    if (name === 'concurrent_idempotent_requests') return { outcome: 'retry', error: 'CONCURRENT_IDEMPOTENT' }
    if (name === 'resource_locked') return { outcome: 'retry', error: 'RESOURCE_LOCKED' }
    return { outcome: 'permanent', error: 'IDEMPOTENCY_CONFLICT' }
  }
  if (status >= 500) return { outcome: 'retry', error: `HTTP_${status}` }
  return { outcome: 'permanent', error: `HTTP_${status}` }
}

/** `EMAIL_FROM` is a display address like `Name <user@host>`; split it. */
function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  if (match) return { name: match[1] || undefined, email: match[2]! }
  return { email: from.trim() }
}

async function sendWithResend(params: {
  to: string
  subject: string
  text: string
  idempotencyKey: string
  from: string
  replyTo?: string
}): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
        'content-type': 'application/json',
        'idempotency-key': params.idempotencyKey,
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch {
    // The request may already have left; only a same-key retry is safe.
    return { outcome: 'uncertain', error: 'NETWORK' }
  }
  if (response.ok) {
    try {
      const body = (await response.json()) as { id?: unknown }
      if (typeof body.id === 'string' && body.id.length > 0) return { outcome: 'accepted', providerId: body.id }
    } catch {
      // fall through to uncertain
    }
    // Accepted but unusable reply: never resend blindly.
    return { outcome: 'uncertain', error: 'MALFORMED_REPLY' }
  }
  let name: string | undefined
  try {
    name = ((await response.json()) as { name?: unknown }).name as string | undefined
  } catch {
    // Classification below works from the status alone.
  }
  const failure = classifyResendFailure(response.status, name)
  return { outcome: failure.outcome, error: failure.error }
}

async function sendWithMailpit(params: {
  to: string
  subject: string
  text: string
  mailpitUrl: string
  from: string
  replyTo?: string
}): Promise<SendOutcome> {
  const url = new URL(params.mailpitUrl)
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('EMAIL_DEV_MAILPIT_URL must point at a loopback host.')
  }
  const from = parseFrom(params.from)
  let response: Response
  try {
    response = await fetch(new URL('/api/v1/send', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: { Email: from.email, ...(from.name ? { Name: from.name } : {}) },
        To: [{ Email: params.to }],
        ...(params.replyTo ? { ReplyTo: [{ Email: params.replyTo }] } : {}),
        Subject: params.subject,
        Text: params.text,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    })
  } catch {
    return { outcome: 'uncertain', error: 'NETWORK' }
  }
  if (response.ok) {
    try {
      const body = (await response.json()) as { ID?: unknown }
      if (typeof body.ID === 'string' && body.ID.length > 0) return { outcome: 'accepted', providerId: body.ID }
    } catch {
      // fall through
    }
    return { outcome: 'uncertain', error: 'MALFORMED_REPLY' }
  }
  return { outcome: 'retry', error: `HTTP_${response.status}` }
}

/**
 * Which provider this process may use. Real email goes out only for a hosted
 * site (`SITE_URL` not a local address): a local run once reached Resend with
 * the real key (P06 audit), so a local `SITE_URL` never sends real email,
 * whatever keys are present. Mailpit is used only for a local site.
 */
export function emailProvider(): 'resend' | 'mailpit' | null {
  if (isHostedSite()) {
    if (optionalEnv('EMAIL_DEV_MAILPIT_URL')) {
      throw new Error('EMAIL_DEV_MAILPIT_URL must never be set for a hosted site.')
    }
    return optionalEnv('RESEND_API_KEY') ? 'resend' : null
  }
  return optionalEnv('EMAIL_DEV_MAILPIT_URL') ? 'mailpit' : null
}

/**
 * `replyTo` must be an address already validated by a strict grammar (the
 * contact route's, shared with the database CHECK); providers take it as a
 * JSON field, never as a raw header.
 */
export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  idempotencyKey: string
  replyTo?: string
}): Promise<SendOutcome> {
  const provider = emailProvider()
  if (provider === 'resend') return sendWithResend({ ...params, from: requireEnv('EMAIL_FROM') })
  if (provider === 'mailpit') {
    return sendWithMailpit({ ...params, mailpitUrl: requireEnv('EMAIL_DEV_MAILPIT_URL'), from: requireEnv('EMAIL_FROM') })
  }
  throw new EmailNotConfiguredError()
}

// ---------------------------------------------------------------------------
// Templates

/** How much of a submitted message an email ever carries. */
export const NOTICE_MESSAGE_LIMIT = 5_000

const FSI = '⁨'
const PDI = '⁩'

/** One user-supplied value, isolated so mixed-direction text cannot reorder the line around it. */
function isolated(value: string): string {
  return `${FSI}${value}${PDI}`
}

export interface ContactNoticeData {
  name: string
  email: string
  message: string
  createdAt: string
}

/**
 * The staff notice about one contact message: plain text, isolates around
 * every user line. It is the whole inbox (D31): the full message, sent with
 * Reply-To set to the visitor, so the owner answers from their own mailbox.
 */
export function renderContactNotice(data: ContactNoticeData): { subject: string; text: string } {
  const message = data.message.slice(0, NOTICE_MESSAGE_LIMIT)
  // The name is one line: a line break in it would forge the lines below.
  const name = data.name.replace(/[\r\n\u0085\u2028\u2029]+/gu, ' ')
  const lines = [
    'رسالة جديدة من نموذج التواصل',
    '',
    `الاسم: ${isolated(name)}`,
    `البريد: ${isolated(data.email)}`,
    `الوقت: ${data.createdAt}`,
    '',
    'نص الرسالة:',
    ...message.split('\n').map((line) => isolated(line)),
    '',
    'للرد: اضغط «رد»، ويوصل ردّك للمرسل مباشرة.',
  ]
  return { subject: 'رسالة جديدة من نموذج التواصل', text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Resend delivery webhooks (Svix signatures)
//
// Fetched 2026-09-26: resend.com/docs/dashboard/webhooks/verify-webhooks-requests
// and docs.svix.com/receiving/verifying-payloads/how-manual. The signed content
// is `${svix_id}.${svix_timestamp}.${rawBody}`; the key is the base64 after
// `whsec_`; the signature is HMAC-SHA256, base64; `svix-signature` is a
// space-separated list of `v1,<sig>` entries and any one match accepts.

const SVIX_TOLERANCE_MS = 5 * 60 * 1000

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Verifies a Svix-signed Resend webhook against the raw body text. Accepts
 * only a well-formed `v1` signature list with a timestamp inside the 5-minute
 * tolerance; every comparison is constant-time.
 */
export async function verifySvixSignature(params: {
  secret: string
  svixId: string
  timestamp: string
  signatureHeader: string
  rawBody: string
  now?: Date
}): Promise<boolean> {
  const when = Number(params.timestamp)
  if (!/^\d+$/.test(params.timestamp) || !Number.isFinite(when)) return false
  const now = params.now ?? new Date()
  if (Math.abs(now.getTime() - when * 1000) > SVIX_TOLERANCE_MS) return false

  const keyText = params.secret.startsWith('whsec_') ? params.secret.slice('whsec_'.length) : params.secret
  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = base64ToBytes(keyText)
  } catch {
    return false
  }

  const content = new TextEncoder().encode(`${params.svixId}.${params.timestamp}.${params.rawBody}`)
  let cryptoKey: CryptoKey
  let expected: Uint8Array
  try {
    cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    expected = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, content))
  } catch {
    return false
  }

  // Svix's own libraries compare the base64 signature strings the same way.
  const expectedSignature = bytesToBase64(expected)
  for (const entry of params.signatureHeader.split(' ')) {
    if (entry.startsWith('v1,') && secretsMatch(entry.slice('v1,'.length), expectedSignature)) return true
  }
  return false
}
