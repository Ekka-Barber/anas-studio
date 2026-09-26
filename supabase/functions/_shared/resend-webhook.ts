import { z } from 'zod'

import { type Rpc, serviceRpc } from './db.ts'
import { verifySvixSignature } from './email.ts'
import { optionalEnv } from './env.ts'

/**
 * Resend delivery events (P06): the `resend-webhook` Edge Function (D32). The
 * Svix signature is verified against the
 * raw bounded body **before** parsing (RESEND_WEBHOOK_SECRET unset means this
 * endpoint does not exist), then `email_event_record` deduplicates by the
 * provider's event id, suppresses hard-bounced/complained recipients and
 * tracks delivery. The body is never logged.
 */
/** The webhook body limit (ARCHITECTURE: "webhooks to 256 KiB"): a request that declares more via content-length is refused before the body is read, and the post-read check below stays as the backstop. */
const MAX_BODY_BYTES = 262_144
/** A signed body past this size is recorded as a malformed event and acknowledged — never rejected once the signature checked out. */
const MAX_EVENT_BYTES = 32_768
const NO_STORE = { 'cache-control': 'no-store' }

/** The event types this endpoint records. Anything else is acknowledged and ignored. */
const RECORDED_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
])

const eventSchema = z.object({
  type: z.string().min(1).max(60),
  created_at: z.string().optional(),
  data: z
    .object({
      email_id: z.string().min(1).max(120).optional(),
      to: z.array(z.string().min(3).max(254)).optional(),
      bounce: z
        .object({
          type: z.string().max(60).optional(),
          subType: z.string().max(60).optional(),
        })
        .optional(),
    })
    .optional(),
})

/**
 * The event's own timestamp as ISO 8601, or null. `Date.parse` accepts
 * strings that Postgres's timestamptz input refuses (for example "1"), and a
 * value the database refuses would fail every redelivery the same way; the
 * ISO form of a date in years 1970–9999 is always accepted. Zone-naive ISO
 * strings are read as UTC — Edge Functions run UTC, and a machine-local read would
 * store a different instant per environment. Non-standard strings ("1") keep
 * V8's implementation-defined parse; their exact instant is garbage-in
 * anyway, the year window and toISOString() still guarantee Postgres shape.
 */
function eventTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const zoneNaiveIso = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(trimmed)
  const ms = Date.parse(zoneNaiveIso ? `${trimmed}Z` : trimmed)
  if (Number.isNaN(ms)) return null
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  return year >= 1970 && year <= 9999 ? date.toISOString() : null
}

/**
 * Best-effort record of a signed event the handler will not process — a body
 * past MAX_EVENT_BYTES, unparseable JSON, or an unrecognized shape. Whatever
 * parsed is salvaged within the columns' bounds; the evidence marks the event
 * malformed and carries only the body's byte size, never its content. The
 * Svix id is the dedupe key, as on the normal path, so one delivery can never
 * be recorded under two ids. Every value is bounded here, so the record can
 * fail only for an infrastructure reason — false then, and the caller asks
 * for a redelivery rather than lose a bounce.
 */
async function recordMalformedEvent(rpc: Rpc, rawEvent: unknown, svixId: string, bytes: number): Promise<boolean> {
  const source = typeof rawEvent === 'object' && rawEvent !== null && !Array.isArray(rawEvent) ? (rawEvent as Record<string, unknown>) : {}
  const data = typeof source.data === 'object' && source.data !== null && !Array.isArray(source.data) ? (source.data as Record<string, unknown>) : {}
  const bounce = typeof data.bounce === 'object' && data.bounce !== null && !Array.isArray(data.bounce) ? (data.bounce as Record<string, unknown>) : {}
  try {
    await rpc('email_event_record', {
      p_event_id: svixId,
      p_type: typeof source.type === 'string' && source.type.length > 0 && source.type.length <= 60 ? source.type : 'email.unknown',
      p_provider_message_id:
        typeof data.email_id === 'string' && data.email_id.length > 0 && data.email_id.length <= 120 ? data.email_id : null,
      p_recipient: Array.isArray(data.to) && typeof data.to[0] === 'string' ? data.to[0] : null,
      p_occurred_at: eventTime(source.created_at),
      p_evidence: { malformed: true, bytes },
      p_bounce_type: typeof bounce.type === 'string' && bounce.type.length > 0 && bounce.type.length <= 60 ? bounce.type : null,
    })
    return true
  } catch {
    console.warn('[resend-webhook] could not record a malformed signed event', { svixId })
    return false
  }
}

export async function handleResendWebhook(request: Request, rpc: Rpc = serviceRpc()): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const secret = optionalEnv('RESEND_WEBHOOK_SECRET')
  if (!secret) {
    return new Response(null, { status: 404 })
  }

  // Refuse an oversized request before reading the body; the post-read check
  // below stays as the backstop when content-length is absent or understates.
  // A real Svix delivery never approaches the limit — only oversized junk
  // does, so this early 413 can never trigger the Svix retry/disable loop.
  const declaredLength = Number(request.headers.get('content-length'))
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, error: { code: 'TOO_LARGE', message: 'Webhook body too large.' } },
      { status: 413, headers: NO_STORE },
    )
  }

  const rawBody = await request.text()
  const bodyBytes = new TextEncoder().encode(rawBody).length
  if (bodyBytes > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, error: { code: 'TOO_LARGE', message: 'Webhook body too large.' } },
      { status: 413, headers: NO_STORE },
    )
  }

  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')
  // The event id is stored as the dedupe key (1–200 characters).
  if (!svixId || svixId.length > 200 || !svixTimestamp || !svixSignature) {
    return new Response(null, { status: 401 })
  }
  const verified = await verifySvixSignature({
    secret,
    svixId,
    timestamp: svixTimestamp,
    signatureHeader: svixSignature,
    rawBody,
  })
  if (!verified) {
    return new Response(null, { status: 401 })
  }

  // Past this point the signature checked out, so the provider really sent
  // these bytes. An event the handler cannot process — a body past
  // MAX_EVENT_BYTES, unparseable JSON, or an unrecognized shape — is recorded
  // as malformed (R1: its bounce or suppression is too real to drop
  // silently) and acknowledged, never rejected with a 4xx: Svix retries
  // non-2xx deliveries and eventually disables the endpoint, and retrying the
  // same bytes can never make them parse. Only when the record itself fails
  // (the database, never the event's bounded values) is it a 503, exactly
  // like the normal path below. Only the event id is logged — never the body.
  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    event = undefined
  }
  const parsed = event === undefined ? null : eventSchema.safeParse(event)
  if (bodyBytes > MAX_EVENT_BYTES || parsed === null || !parsed.success) {
    console.warn('[resend-webhook] acknowledging a signed event it cannot process', { svixId })
    if (!(await recordMalformedEvent(rpc, event, svixId, bodyBytes))) {
      return Response.json(
        { ok: false, error: { code: 'UNAVAILABLE', message: 'Event not recorded; retry.' } },
        { status: 503, headers: NO_STORE },
      )
    }
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE })
  }
  if (!RECORDED_TYPES.has(parsed.data.type)) {
    return Response.json({ ok: true }, { headers: NO_STORE })
  }

  const data = parsed.data.data
  // The bounce type decides suppression in `email_event_record` (Resend sends
  // "Permanent"/"Temporary": temporary/soft/transient record only, everything
  // else — missing, permanent, undocumented — suppresses conservatively), so
  // it travels as its own argument in addition to the redacted evidence.
  const bounceType = parsed.data.type === 'email.bounced' ? (data?.bounce?.type ?? null) : null
  const evidence =
    parsed.data.type === 'email.bounced' && data?.bounce
      ? { bounceType: data.bounce.type ?? null, bounceSubType: data.bounce.subType ?? null }
      : {}
  try {
    await rpc('email_event_record', {
      p_event_id: svixId,
      p_type: parsed.data.type,
      p_provider_message_id: data?.email_id ?? null,
      p_recipient: data?.to?.[0] ?? null,
      p_occurred_at: eventTime(parsed.data.created_at),
      p_evidence: evidence,
      p_bounce_type: bounceType,
    })
  } catch {
    // Not recorded: ask the provider to redeliver (a 5xx is retried, and the
    // event id dedupe makes a redelivery safe). Acknowledging here would lose
    // a bounce or complaint, and with it the suppression. Every value passed
    // above is bounded to the columns' checks (the timestamp through
    // eventTime), so a retry cannot fail for the event's own data.
    return Response.json(
      { ok: false, error: { code: 'UNAVAILABLE', message: 'Event not recorded; retry.' } },
      { status: 503, headers: NO_STORE },
    )
  }
  return Response.json({ ok: true }, { headers: NO_STORE })
}
