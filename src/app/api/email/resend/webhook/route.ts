import { z } from 'zod'

import { withDb } from '@/lib/db'
import { optionalEnv } from '@/lib/env'
import { verifySvixSignature } from '@/lib/email'

/**
 * Resend delivery events (P06). The Svix signature is verified against the
 * raw bounded body **before** parsing (RESEND_WEBHOOK_SECRET unset means this
 * endpoint does not exist), then `email_event_record` deduplicates by the
 * provider's event id, suppresses hard-bounced/complained recipients and
 * tracks delivery. The body is never logged.
 */
export const dynamic = 'force-dynamic'

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
 * Best-effort record of a signed event the handler will not process — a body
 * past MAX_EVENT_BYTES, unparseable JSON, or an unrecognized shape. Whatever
 * parsed is salvaged within the columns' bounds; the evidence marks the event
 * malformed and carries only the body's byte size, never its content. A
 * record failure is logged and swallowed: the same bytes can never be made
 * processable, so there is nothing a redelivery could fix.
 */
async function recordMalformedEvent(rawEvent: unknown, svixId: string, bytes: number): Promise<void> {
  const source = typeof rawEvent === 'object' && rawEvent !== null && !Array.isArray(rawEvent) ? (rawEvent as Record<string, unknown>) : {}
  const data = typeof source.data === 'object' && source.data !== null && !Array.isArray(source.data) ? (source.data as Record<string, unknown>) : {}
  const bounce = typeof data.bounce === 'object' && data.bounce !== null && !Array.isArray(data.bounce) ? (data.bounce as Record<string, unknown>) : {}
  // The provider's own event id wins when it parsed; otherwise the Svix id
  // dedupes the row. With neither, there is nothing worth recording.
  const id = typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 200 ? source.id : svixId
  if (!id) return
  const createdAt =
    typeof source.created_at === 'string' && !Number.isNaN(Date.parse(source.created_at)) ? source.created_at : new Date().toISOString()
  try {
    await withDb((client) =>
      client.query('select public.email_event_record($1, $2, $3, $4, $5, $6, $7)', [
        id,
        typeof source.type === 'string' && source.type.length > 0 && source.type.length <= 60 ? source.type : 'email.unknown',
        typeof data.email_id === 'string' && data.email_id.length > 0 && data.email_id.length <= 120 ? data.email_id : null,
        Array.isArray(data.to) && typeof data.to[0] === 'string' ? data.to[0] : null,
        createdAt,
        JSON.stringify({ malformed: true, bytes }),
        typeof bounce.type === 'string' && bounce.type.length > 0 && bounce.type.length <= 60 ? bounce.type : null,
      ]),
    )
  } catch {
    console.warn('[resend-webhook] could not record a malformed signed event', { svixId })
  }
}

export async function POST(request: Request): Promise<Response> {
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
  // best-effort as malformed (R1: its bounce or suppression is too real to
  // drop silently) and then acknowledged, never rejected: Svix retries
  // non-2xx deliveries and eventually disables the endpoint, which would
  // lose later bounces, and retrying the same bytes can never make them
  // parse. Only the event id is logged — the body never is.
  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    event = undefined
  }
  const parsed = event === undefined ? null : eventSchema.safeParse(event)
  if (bodyBytes > MAX_EVENT_BYTES || parsed === null || !parsed.success) {
    console.warn('[resend-webhook] acknowledging a signed event it cannot process', { svixId })
    await recordMalformedEvent(event, svixId, bodyBytes)
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
      ? JSON.stringify({ bounceType: data.bounce.type ?? null, bounceSubType: data.bounce.subType ?? null })
      : JSON.stringify({})
  try {
    await withDb((client) =>
      client.query('select public.email_event_record($1, $2, $3, $4, $5, $6, $7)', [
        svixId,
        parsed.data.type,
        data?.email_id ?? null,
        data?.to?.[0] ?? null,
        parsed.data.created_at && !Number.isNaN(Date.parse(parsed.data.created_at)) ? parsed.data.created_at : null,
        evidence,
        bounceType,
      ]),
    )
  } catch {
    // Not recorded: ask the provider to redeliver (a 5xx is retried, and the
    // event id dedupe makes a redelivery safe). Acknowledging here would lose
    // a bounce or complaint, and with it the suppression. Every value passed
    // above is bounded to the columns' checks, so a retry cannot fail for
    // the event's own data.
    return Response.json(
      { ok: false, error: { code: 'UNAVAILABLE', message: 'Event not recorded; retry.' } },
      { status: 503, headers: NO_STORE },
    )
  }
  return Response.json({ ok: true }, { headers: NO_STORE })
}
