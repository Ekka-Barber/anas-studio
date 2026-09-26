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
/** Requests that declare more than this via content-length are refused before the body is read. */
const MAX_DECLARED_BODY_BYTES = 32_768
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NO_STORE = { 'cache-control': 'no-store' }

/**
 * The email grammar, shared verbatim with the database's own check: a local
 * part of header-safe characters, a bounded domain, and a TLD that is either
 * purely alphabetic or a punycode label (`xn--…`) — the only form in which an
 * internationalised domain like `.السعودية` reaches storage (`toAsciiAddress`
 * below converts it first). Loose grammars let an address like
 * `x@evil.test?bcc=…&body=…` flow into the inbox's mailto: links, so only
 * this shape reaches storage.
 */
const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$/

/**
 * Punycodes an address whose domain carries non-ASCII (e.g. the Saudi
 * `.السعودية`) via the URL parser's IDNA hostname, so the ASCII form is what
 * gets validated — and stored. A domain the parser refuses is returned
 * untouched and fails the grammar below.
 */
function toAsciiAddress(email: string): string {
  const at = email.lastIndexOf('@')
  if (at === -1) return email
  const domain = email.slice(at + 1)
  if (/^[\x00-\x7F]*$/.test(domain)) return email
  // The URL parser would silently drop a path, query, fragment or port after
  // the host (`x@ü.test/…` → `x@xn--tda.test`) and decode `%xx`; such a
  // "domain" is left untouched so the grammar refuses it rather than storing
  // an address the visitor never typed.
  if (/[\s/\\?#:@%]/.test(domain)) return email
  try {
    return `${email.slice(0, at)}@${new URL(`http://${domain}`).hostname}`
  } catch {
    return email
  }
}

const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((email) => toAsciiAddress(email))
    // Punycode can expand the domain, so the stored length is re-bounded here.
    .refine((email) => email.length <= 254 && EMAIL_SHAPE.test(email), { message: 'بريد غير صالح.' }),
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

  // Refuse an oversized request before reading the body; the post-read check
  // below stays as the backstop when content-length is absent or understates.
  const declaredLength = Number(request.headers.get('content-length'))
  if (declaredLength > MAX_DECLARED_BODY_BYTES) {
    return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
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
    if ((error as { code?: string } | null)?.code === '23505') {
      // A simultaneous double submit raced past the submission-key lookup and
      // lost the unique insert: its twin already stored the message, so the
      // visitor is told it arrived — accurately and without any internal
      // detail. The 409 stays so the form's own retry logic still steps aside.
      return fail(409, 'CONFLICT', 'وصلتنا رسالتك — لا حاجة للإعادة.')
    }
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
}
