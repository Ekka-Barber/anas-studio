import { z } from 'zod'

import { type Rpc, serviceRpc } from './db.ts'
import { optionalEnv } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, logCause, NO_STORE, siteOrigin } from './http.ts'
import { clientKeyHash, requestIp } from './rate-limit.ts'
import { isTurnstileUnavailable, verifyTurnstile } from './turnstile.ts'

/**
 * The public contact form endpoint: the `contact` Edge Function (P06 round 1,
 * moved from a Next route by D32; the P01 form posts here once design
 * reopens). Nothing is emailed directly: `contact_submit` throttles,
 * stores the message and queues the staff notices in one transaction, so a
 * message survives an email outage: its notice waits in the outbox (DATA
 * "Email delivery and retries"). The notice is the owner's inbox (D31): it
 * reaches their own mailbox with Reply-To set to the visitor.
 *
 * Order of checks: origin → content type → size → JSON → schema → honeypot →
 * Turnstile → throttle+store. The honeypot runs before Turnstile so a bot
 * never burns a siteverify call, and it replies exactly like a stored
 * submission so it cannot be told apart. The site and this function are on
 * different origins, so the browser's own CORS check admits only `SITE_URL`.
 */

/**
 * The contact body limit (ARCHITECTURE: "contact to 8 KiB"). Arabic is two
 * bytes a character in UTF-8, so a message stops fitting near 4,000 Arabic
 * characters — before the schema's 5,000-character bound; the P01 form
 * measures the whole JSON body it will send (`fitsContactLimit`: the fields,
 * the submission key and the longest Turnstile token) before it spends a
 * Turnstile token. Only the message can push a body past the limit (the
 * name and the address are bounded far below it), so the 413 copy names it.
 */
const MAX_BODY_BYTES = 8_192
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The email grammar, shared verbatim with the database's own check: a local
 * part of header-safe characters, a bounded domain, and a TLD that is either
 * purely alphabetic or a punycode label (`xn--…`) — the only form in which an
 * internationalised domain like `.السعودية` reaches storage (`toAsciiAddress`
 * below converts it first). The stored address becomes the notice's
 * Reply-To, so a loose grammar would let an address like
 * `x@evil.test?bcc=…&body=…` reach the owner's reply; only this shape
 * reaches storage.
 */
export const EMAIL_SHAPE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$/

/**
 * Punycodes an address whose domain carries non-ASCII (e.g. the Saudi
 * `.السعودية`) via the URL parser's IDNA hostname, so the ASCII form is what
 * gets validated — and stored. A domain the parser refuses is returned
 * untouched and fails the grammar below.
 */
export function toAsciiAddress(email: string): string {
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

export async function handleContact(request: Request, rpc: Rpc = serviceRpc()): Promise<Response> {
  const allowed = siteOrigin()
  const cors = allowed ? corsHeaders(allowed) : {}
  const fail = (status: number, code: string, message: string, fields?: unknown): Response =>
    failWith(status, code, message, fields, cors)
  const received = (): Response =>
    Response.json({ ok: true, data: { received: true } }, { status: 201, headers: { ...NO_STORE, ...cors } })

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')
  // A browser always sends Origin on a cross-origin POST; only the site's own
  // origin is accepted. A request without one is not from the form's page.
  if (!allowed || request.headers.get('origin') !== allowed) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'أرسل الطلب بصيغة JSON.')
  }

  // The bounded read refuses an oversized body, declared or streamed, without buffering it.
  const text = await boundedText(request, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'TOO_LARGE', 'رسالتك أطول من المسموح؛ اختصرها وأرسلها من جديد.')
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
    return received()
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
    if (isTurnstileUnavailable(verdict.code)) return fail(503, 'TURNSTILE_UNAVAILABLE', 'تعذّر التحقق من النموذج.')
    return fail(400, 'TURNSTILE', 'تعذّر التحقق من أنك إنسان.')
  }

  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  if (!pepper) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  const ipHash = await clientKeyHash(request, pepper)

  try {
    const result = await rpc('contact_submit', {
      p_ip_hash: ipHash,
      p_name: input.name,
      p_email: input.email,
      p_message: input.message,
      p_submission_key: input.submissionKey,
      p_policy_revision: null,
    })
    if (result) {
      // Stored, or the same submission key already stored — one reply either way.
      return received()
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
      return fail(409, 'CONFLICT', 'وصلتنا رسالتك، فلا حاجة لإرسالها مرة ثانية.')
    }
    logCause('contact', error)
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
}
