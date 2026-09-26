import { z } from 'zod'

import { withDb } from '@/lib/db'
import { optionalEnv } from '@/lib/env'
import { clientKeyHash, requestIp } from '@/lib/rate-limit'
import { verifyTurnstile } from '@/lib/turnstile'

/**
 * The public contact form endpoint (P06 round 1; the P01 form posts here once
 * design reopens). Nothing is emailed directly: `contact_submit` throttles,
 * stores the message and queues the staff notices in one transaction, so the
 * inbox survives an email outage (DATA "Email delivery and retries").
 *
 * Order of checks: origin → content type → size → JSON → schema → honeypot →
 * Turnstile → throttle+store. The honeypot runs before Turnstile so a bot
 * never burns a siteverify call, and it replies exactly like a stored
 * submission so it cannot be told apart.
 */
export const dynamic = 'force-dynamic'

/** The contact body limit (ARCHITECTURE: "contact to 8 KiB"). */
const MAX_BODY_BYTES = 8_192
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NO_STORE = { 'cache-control': 'no-store' }

/** A deliberately simple shape; the database re-checks its own constraint. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((email) => EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' }),
  message: z.string().trim().min(1).max(5000),
  submissionKey: z.string().regex(UUID),
  turnstileToken: z.string().min(1).max(2048),
  website: z.string().max(200).optional(),
})

function fail(status: number, code: string, message: string, fields?: unknown): Response {
  return Response.json(
    { ok: false, error: { code, message, ...(fields ? { fields } : {}) }, requestId: crypto.randomUUID() },
    { status, headers: NO_STORE },
  )
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'أرسل الطلب بصيغة JSON.')
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  }
  const input = parsed.data

  // Honeypot: a filled `website` field means a bot; answer like a success and
  // store nothing.
  if (input.website !== undefined && input.website.trim() !== '') {
    return Response.json({ ok: true, data: { received: true } }, { status: 201, headers: NO_STORE })
  }

  const siteUrl = optionalEnv('SITE_URL')
  const secret = optionalEnv('TURNSTILE_SECRET_KEY')
  if (!secret || !siteUrl) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من النموذج.')
  const verdict = await verifyTurnstile({
    token: input.turnstileToken,
    secret,
    remoteIp: requestIp(request),
    expectedAction: 'contact',
    expectedHostname: new URL(siteUrl).hostname,
  })
  if (!verdict.ok) {
    if (verdict.code === 'UNREACHABLE') return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من النموذج.')
    return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
  }

  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  if (!pepper) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  const ipHash = await clientKeyHash(request, pepper)

  try {
    const result = await withDb((client) =>
      client.query<{ t: { duplicate: boolean } }>('select public.contact_submit($1, $2, $3, $4, $5, $6) as t', [
        ipHash,
        input.name,
        input.email,
        input.message,
        input.submissionKey,
        null,
      ]),
    )
    if (result.rows[0]?.t) {
      // Stored, or the same submission key already stored — one reply either way.
      return Response.json({ ok: true, data: { received: true } }, { status: 201, headers: NO_STORE })
    }
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '54000') {
      return fail(429, 'RATE_LIMITED', 'أرسلت رسائل كثيرة؛ حاول لاحقًا.')
    }
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
}
