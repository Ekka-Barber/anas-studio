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

/** The webhook body limit (ARCHITECTURE: "webhooks to 256 KiB"). */
const MAX_BODY_BYTES = 262_144
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

export async function POST(request: Request): Promise<Response> {
  const secret = optionalEnv('RESEND_WEBHOOK_SECRET')
  if (!secret) {
    return new Response(null, { status: 404 })
  }

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
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

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return Response.json(
      { ok: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } },
      { status: 400, headers: NO_STORE },
    )
  }
  const parsed = eventSchema.safeParse(event)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: 'INVALID', message: 'Unrecognized event shape.' } },
      { status: 422, headers: NO_STORE },
    )
  }
  if (!RECORDED_TYPES.has(parsed.data.type)) {
    return Response.json({ ok: true }, { headers: NO_STORE })
  }

  const data = parsed.data.data
  const evidence =
    parsed.data.type === 'email.bounced' && data?.bounce
      ? JSON.stringify({ bounceType: data.bounce.type ?? null, bounceSubType: data.bounce.subType ?? null })
      : JSON.stringify({})
  try {
    await withDb((client) =>
      client.query('select public.email_event_record($1, $2, $3, $4, $5, $6)', [
        svixId,
        parsed.data.type,
        data?.email_id ?? null,
        data?.to?.[0] ?? null,
        parsed.data.created_at && !Number.isNaN(Date.parse(parsed.data.created_at)) ? parsed.data.created_at : null,
        evidence,
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
