import { withDb } from '@/lib/db'
import {
  HEAD_READ_BYTES,
  originalKey,
  publicKey,
  quarantineKey,
  sqlErrorToHttp,
  ticketRequestSchema,
  verifyObjectHead,
  type TicketRequest,
} from '@/lib/media'
import { privateBucket, publicBucket, readHead } from '@/lib/r2'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Ticket completion (P05): every part must already be stored with exactly its
 * declared bytes, and a bounded head read of each part must confirm its type
 * (magic bytes) and dimensions. Any failure deletes all of the ticket's
 * objects. Only then are the quarantine derivatives promoted to the public
 * bucket and `media_complete` called — if the database refuses, everything
 * just promoted is deleted again. Whole files are never hashed or decoded
 * here; verification reads at most `HEAD_READ_BYTES` per object.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8192
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NO_STORE = { 'cache-control': 'no-store' }

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: NO_STORE })
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

async function actorFrom(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const { data, error } = await getSupabaseServerClient().auth.getClaims(header.slice('Bearer '.length))
  if (error || !data) return null
  return data.claims.sub
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')
  const actor = await actorFrom(request)
  if (!actor) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
  let body: { ticketId?: unknown }
  try {
    body = JSON.parse(text) as { ticketId?: unknown }
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const ticketId = body.ticketId
  if (typeof ticketId !== 'string' || !UUID.test(ticketId)) return fail(422, 'INVALID', 'طلب غير صالح.')

  // The claim is once only: from here no part can be replaced and no other
  // completion of this ticket can run, so every cleanup below is safe.
  let declared: TicketRequest
  try {
    const result = await withDb((client) =>
      client.query<{ t: unknown }>('select public.media_claim($1, $2) as t', [actor, ticketId]),
    )
    const parsed = ticketRequestSchema.safeParse(result.rows[0]?.t)
    if (!parsed.success) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
    declared = parsed.data
  } catch (error) {
    return sqlFail(error)
  }

  const originalK = originalKey(ticketId)
  const quarantineKeys = declared.derivatives.map((d) => quarantineKey(ticketId, d.width))
  const publicKeys = declared.derivatives.map((d) => publicKey(ticketId, d.width))
  const privateKeys = [originalK, ...quarantineKeys]
  const cleanupPrivate = (): Promise<unknown> => privateBucket().delete(privateKeys)
  const cleanupAll = (): Promise<unknown[]> =>
    Promise.all([publicBucket().delete(publicKeys), privateBucket().delete(privateKeys)])

  // 1. Every part exists with exactly its declared bytes.
  const originalHead = await privateBucket().head(originalK)
  if (!originalHead) {
    await cleanupPrivate()
    return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
  }
  if (originalHead.size !== declared.original.bytes) {
    await cleanupPrivate()
    return fail(422, 'SIZE_MISMATCH', 'حجم الجزء الأصلي لا يطابق المُعلَن.')
  }
  for (let i = 0; i < declared.derivatives.length; i += 1) {
    const derivative = declared.derivatives[i]!
    const head = await privateBucket().head(quarantineKeys[i]!)
    if (!head) {
      await cleanupPrivate()
      return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
    }
    if (head.size !== derivative.bytes) {
      await cleanupPrivate()
      return fail(422, 'SIZE_MISMATCH', 'حجم أحد المشتقات لا يطابق المُعلَن.')
    }
  }

  // 2. A bounded head read confirms the original's type and dimensions.
  const originalHeadBytes = await readHead(privateBucket(), originalK, Math.min(originalHead.size, HEAD_READ_BYTES))
  if (!originalHeadBytes) {
    await cleanupPrivate()
    return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
  }
  const originalVerified = await verifyObjectHead(originalHeadBytes, {
    mime: declared.original.mime,
    width: declared.original.width,
    height: declared.original.height,
  })
  if (!originalVerified.ok) {
    await cleanupPrivate()
    return fail(422, originalVerified.code, originalVerified.message)
  }

  // 3. Each derivative is read once, verified and promoted from the same
  //    bytes, so what goes public is exactly what was checked.
  try {
    for (let i = 0; i < declared.derivatives.length; i += 1) {
      const derivative = declared.derivatives[i]!
      const object = await privateBucket().get(quarantineKeys[i]!)
      if (!object) {
        await cleanupAll()
        return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
      }
      // ponytail: the derivative (at most 4 MiB) is buffered instead of piping
      // object.body, because the local binding proxy hands over a stream
      // without a known length, which R2's put() refuses. The CPU cost of this
      // copy on Workers Free is unmeasured; P10 measures it.
      const bytes = new Uint8Array(await object.arrayBuffer())
      const verified = await verifyObjectHead(bytes.subarray(0, HEAD_READ_BYTES), {
        mime: 'image/webp',
        width: derivative.width,
        height: derivative.height,
      })
      if (!verified.ok) {
        await cleanupAll()
        return fail(422, verified.code, verified.message)
      }
      await publicBucket().put(publicKeys[i]!, bytes, {
        httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      })
    }
  } catch {
    await cleanupAll()
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }

  // 4. Record the media row. If the database refuses, undo the promotion.
  const md5 = originalHead.checksums.md5
  const md5Hex = md5 ? Array.from(new Uint8Array(md5), (byte) => byte.toString(16).padStart(2, '0')).join('') : ''
  try {
    await withDb((client) =>
      client.query('select public.media_complete($1, $2, $3)', [
        actor,
        ticketId,
        md5Hex.length === 32 ? md5Hex : null,
      ]),
    )
  } catch (error) {
    await cleanupAll()
    return sqlFail(error)
  }

  // 5. Success: quarantine is empty again.
  await privateBucket().delete(quarantineKeys)
  return Response.json({ ok: true, data: { id: ticketId } }, { status: 201, headers: NO_STORE })
}
