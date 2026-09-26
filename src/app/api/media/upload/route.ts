import { declaredParts, originalKey, quarantineKey, sqlErrorToHttp, ticketRequestSchema, type TicketRequest } from '@/lib/media'
import { withDb } from '@/lib/db'
import { privateBucket } from '@/lib/r2'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Media upload (P05): `POST` issues a server-owned ticket (5-minute expiry,
 * at most 10 open per actor), `PUT ?ticket=<uuid>&part=<original|wNNN>` stores
 * one declared part in the private bucket — the original at `originals/<id>`,
 * a derivative in quarantine — and the stored size must equal the declared
 * bytes. Ownership, expiry and the actor's role are rechecked by the SQL
 * functions on every call. Tokens and bodies are never logged.
 */
export const dynamic = 'force-dynamic'

const MAX_TICKET_BODY_BYTES = 16_384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NO_STORE = { 'cache-control': 'no-store' }

function fail(status: number, code: string, message: string, fields?: unknown): Response {
  return Response.json({ ok: false, error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers: NO_STORE })
}

function sqlFail(error: unknown): Response {
  const mapped = sqlErrorToHttp((error as { code?: string } | null)?.code)
  if (mapped) return fail(mapped.status, mapped.code, mapped.message)
  return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

/** Verifies the `Authorization: Bearer` staff token and returns its subject, or null. */
async function actorFrom(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const { data, error } = await getSupabaseServerClient().auth.getClaims(header.slice('Bearer '.length))
  if (error || !data) return null
  return data.claims.sub
}

/** Reads a ticket's declaration back; the stored object was validated on creation. */
async function readTicket(
  actor: string,
  ticket: string,
): Promise<{ ok: true; declared: TicketRequest } | { ok: false; response: Response }> {
  try {
    const result = await withDb((client) =>
      client.query<{ t: unknown }>('select public.media_ticket($1, $2) as t', [actor, ticket]),
    )
    const parsed = ticketRequestSchema.safeParse(result.rows[0]?.t)
    if (!parsed.success) return { ok: false, response: fail(500, 'FAILED', 'تعذّر إكمال الإجراء.') }
    return { ok: true, declared: parsed.data }
  } catch (error) {
    return { ok: false, response: sqlFail(error) }
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')
  const actor = await actorFrom(request)
  if (!actor) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const text = await request.text()
  if (text.length > MAX_TICKET_BODY_BYTES) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = ticketRequestSchema.safeParse(body)
  if (!parsed.success) {
    return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  }

  try {
    const result = await withDb((client) =>
      client.query<{ t: { id: string; expiresAt: string } }>('select public.media_create_ticket($1, $2) as t', [
        actor,
        parsed.data,
      ]),
    )
    const ticket = result.rows[0]?.t
    if (!ticket) return fail(500, 'FAILED', 'تعذّر إنشاء التذكرة.')
    return Response.json(
      { ok: true, data: { ticketId: ticket.id, expiresAt: ticket.expiresAt, parts: declaredParts(parsed.data) } },
      { status: 201, headers: NO_STORE },
    )
  } catch (error) {
    return sqlFail(error)
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')
  const actor = await actorFrom(request)
  if (!actor) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const url = new URL(request.url)
  const ticket = url.searchParams.get('ticket')
  const part = url.searchParams.get('part')
  if (!ticket || !UUID.test(ticket) || !part) return fail(422, 'INVALID', 'طلب غير صالح.')

  const read = await readTicket(actor, ticket)
  if (!read.ok) return read.response
  const declared = read.declared

  let key: string
  let bytes: number
  let contentType: string
  if (part === 'original') {
    key = originalKey(ticket)
    bytes = declared.original.bytes
    contentType = declared.original.mime
  } else {
    const width = /^w(\d{1,4})$/.exec(part)
    const derivative = width ? declared.derivatives.find((d) => d.width === Number(width[1])) : undefined
    if (!derivative) return fail(422, 'INVALID', 'جزء غير معروف لهذه التذكرة.')
    key = quarantineKey(ticket, derivative.width)
    bytes = derivative.bytes
    contentType = 'image/webp'
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength === null || !/^\d+$/.test(contentLength)) {
    return fail(422, 'INVALID', 'يجب إرسال حجم المحتوى.')
  }
  const length = Number(contentLength)
  if (length > bytes) return fail(413, 'TOO_LARGE', 'حجم الجزء أكبر من المُعلَن.')
  if (length !== bytes) return fail(422, 'INVALID', 'حجم الجزء لا يطابق المُعلَن.')

  // Uploading a part again simply overwrites it.
  // ponytail: R2's put() refuses a stream of unknown length, and the body the
  // local next dev binding proxy hands over has none (TypeError "Provided
  // readable stream must have a known length"), so the part is buffered with
  // arrayBuffer() instead of piped from request.body. The size is bounded by
  // the declared bytes (at most 15 MiB, checked above). The CPU cost of this
  // copy on Workers Free is unmeasured; P10 measures it, and streaming with a
  // known length is the upgrade if it is too high.
  await privateBucket().put(key, new Uint8Array(await request.arrayBuffer()), { httpMetadata: { contentType } })
  const stored = await privateBucket().head(key)
  if (!stored || stored.size !== bytes) {
    await privateBucket().delete(key)
    return fail(422, 'INVALID', 'حجم الجزء المرفوع لا يطابق المُعلَن.')
  }
  return Response.json({ ok: true, data: { part } }, { headers: NO_STORE })
}
