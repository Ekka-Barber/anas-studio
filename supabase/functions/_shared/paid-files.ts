/**
 * The owner's paid-file actions of the `admin` function (P08 round 7, PLANS/P08-CONTRACT.md section 7):
 * `paid-file-ticket` and `paid-file-complete`. `handleAdmin` has already checked that the caller is an
 * active owner (no fresh TOTP: nothing here moves money); `paid_asset_set` rechecks the owner again.
 *
 * - `paid-file-ticket` mints a ticket (a UUID) and one signed upload URL for `incoming/<ticket>` in the
 *   private `paid-files` bucket, which has no policy at all: only this function and `download` reach it.
 *   The browser uploads straight to Storage, and nothing is stored here for the ticket.
 * - `paid-file-complete` checks what was uploaded, and reads only what it needs: the object's size and
 *   stored content type from its metadata, and its first bytes by a ranged request, never the whole object.
 *   It refuses a stored type that differs from the declared one, a size above the bucket's limit, a head
 *   that is not `%PDF-` (for a PDF) and, for an EPUB, anything but a ZIP whose first entry is `mimetype`
 *   holding `application/epub+zip` (the container format's own rule). A refused object is removed. A
 *   good one moves to `assets/<variant>/<asset id>` and `paid_asset_set` records it, hands it to the
 *   orders that were waiting for it and mails them. When the SQL recorded nothing the object leaves `assets/`
 *   again, which nothing sweeps: removed, or, when Storage refuses that, put back under `incoming/` where the
 *   daily sweep owns it; a lock held elsewhere (a retry) puts it back under its ticket, so the same ticket
 *   completes again. A call whose outcome is unknown keeps it: it may have been recorded.
 *   Header checks only: not a scan, and not a guarantee about what follows the head.
 *
 * Whatever Storage or the SQL answers is only ever the few facts below; nothing here logs, and a storage
 * key, a token and a file name are never written anywhere but where the ledger keeps them.
 */
import { z } from 'zod'

import { noControlCharacters } from './commerce-settings.ts'
import { type Rpc, serviceClient } from './db.ts'
import { corsHeaders, fail as failWith, logCause, ok as okWith } from './http.ts'

export const PAID_BUCKET = 'paid-files'
/** The bucket's own limit (`file_size_limit` of the migration that created it): 100 MiB. */
export const PAID_FILE_MAX_BYTES = 104_857_600
const MIMES = ['application/pdf', 'application/epub+zip'] as const
/** What the head check reads: a ZIP header, its first name and its first 20 bytes fit in a few hundred. */
const HEAD_BYTES = 4096
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FAILED = 'تعذّر إكمال الإجراء.'
const FORBIDDEN = 'هذا الإجراء للمالك فقط.'

const CORS = corsHeaders('*')
const fail = (status: number, code: string, message: string, fields?: unknown): Response => failWith(status, code, message, fields, CORS)
const ok = (data: unknown, status = 200): Response => okWith(data, status, CORS)

/** The storage operations the two actions need; the default is Supabase Storage. */
export interface PaidFileStore {
  signedUpload(key: string): Promise<{ path: string; token: string }>
  /** The stored size and content type, or null when there is no such object; any other Storage failure throws. */
  info(key: string): Promise<{ size: number; contentType: string } | null>
  /** The first `bytes` bytes by a ranged request (never the whole object), or null when there is no such object. */
  head(key: string, bytes: number): Promise<Uint8Array | null>
  move(from: string, to: string): Promise<void>
  /** Throws when Storage refuses: a removal that did not happen is never silent. */
  remove(keys: string[]): Promise<void>
}

/** What the two actions need of `AdminDeps`. */
export interface PaidFileDeps {
  rpc: Rpc
  files: PaidFileStore
}

export const incomingKey = (ticket: string): string => `incoming/${ticket}`

/** At most `limit` bytes of a stream, then it is cancelled: a server that ignores the range still costs only the head. */
async function readHead(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const out = new Uint8Array(limit)
  let length = 0
  while (length < limit) {
    const { done, value } = await reader.read()
    if (done) break
    const part = value.subarray(0, limit - length)
    out.set(part, length)
    length += part.byteLength
  }
  await reader.cancel().catch(() => undefined)
  return out.subarray(0, length)
}

export function paidFileStore(): PaidFileStore {
  const bucket = () => serviceClient().storage.from(PAID_BUCKET)
  return {
    async signedUpload(key) {
      // No upsert: once the object exists its signed URL cannot replace it, so the bytes that are checked are the bytes that move.
      const { data, error } = await bucket().createSignedUploadUrl(key, { upsert: false })
      if (error || !data) throw new Error('SIGNED_URL_FAILED')
      return { path: data.path, token: data.token }
    },
    async info(key) {
      const { data, error } = await bucket().info(key)
      if (error) {
        const { status, statusCode } = error as { status?: number; statusCode?: string }
        if (status === 404 || statusCode === '404') return null
        throw new Error('INFO_FAILED')
      }
      if (typeof data?.size !== 'number' || typeof data.contentType !== 'string') throw new Error('INFO_FAILED')
      return { size: data.size, contentType: data.contentType }
    },
    async head(key, bytes) {
      const { data, error } = await bucket().createSignedUrl(key, 60)
      if (error || !data) throw new Error('HEAD_FAILED')
      const response = await fetch(data.signedUrl, { headers: { range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(10_000) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error('HEAD_FAILED')
      return response.body ? readHead(response.body, bytes) : new Uint8Array(0)
    },
    async move(from, to) {
      const { error } = await bucket().move(from, to)
      if (error) throw new Error('MOVE_FAILED')
    },
    async remove(keys) {
      if (keys.length === 0) return
      const { error } = await bucket().remove(keys)
      if (error) throw new Error('REMOVE_FAILED')
    },
  }
}

const ascii = (head: Uint8Array, start: number, length: number): string =>
  start + length > head.length ? '' : String.fromCharCode(...head.subarray(start, start + length))

/**
 * Whether the first bytes of an object are what its declared type says. A PDF starts with `%PDF-`. An EPUB
 * is a ZIP whose FIRST entry is stored (not compressed) and named `mimetype`, holding exactly
 * `application/epub+zip`: that is the container format's own rule, so a plain ZIP, an executable renamed
 * `.epub` and a PDF declared as an EPUB all fail it.
 */
export function paidFileHeadMatches(mime: string, head: Uint8Array): boolean {
  if (mime === 'application/pdf') return ascii(head, 0, 5) === '%PDF-'
  if (mime !== 'application/epub+zip' || head.length < 30) return false
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  // The local file header: signature `PK\x03\x04`, flags, method (0 = stored), sizes, name length, extra length.
  if (view.getUint32(0, true) !== 0x04034b50) return false
  const flags = view.getUint16(6, true)
  const method = view.getUint16(8, true)
  const size = view.getUint32(22, true)
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  if (method !== 0 || nameLength !== 8 || ascii(head, 30, 8) !== 'mimetype') return false
  // With a data descriptor (flag bit 3) the header's size is zero; otherwise it is the content's own length.
  if ((flags & 0x08) === 0 && size !== 20) return false
  return ascii(head, 30 + nameLength + extraLength, 20) === 'application/epub+zip'
}

const filenameField = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => noControlCharacters(value) && !/[/\\]/.test(value), { message: 'اسم الملف غير صالح.' })
const mimeField = z.enum(MIMES)
const uuid = z.string().regex(UUID)

const ticketSchema = z.strictObject({
  action: z.literal('paid-file-ticket'),
  variantId: uuid,
  filename: filenameField,
  mime: mimeField,
  bytes: z.number().int().min(1).max(PAID_FILE_MAX_BYTES),
})

const completeSchema = z.strictObject({
  action: z.literal('paid-file-complete'),
  variantId: uuid,
  ticket: uuid,
  filename: filenameField,
  mime: mimeField,
})

/** `paid-file-ticket` (owner): a signed upload URL for `incoming/<ticket>`; the browser uploads with the token it answers. */
export async function paidFileTicket(deps: Pick<PaidFileDeps, 'files'>, body: unknown): Promise<Response> {
  const parsed = ticketSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const ticket = crypto.randomUUID()
  try {
    const signed = await deps.files.signedUpload(incomingKey(ticket))
    return ok({ ticket, bucket: PAID_BUCKET, path: signed.path, token: signed.token }, 201)
  } catch {
    return fail(500, 'FAILED', 'تعذّر إنشاء رابط الرفع.')
  }
}

/** The SQL's business refusals: a stable code, a short Arabic message. */
const REFUSALS: Record<string, [status: number, message: string]> = {
  NOT_FOUND: [404, 'لم نجد هذا الخيار.'],
  NOT_DIGITAL: [422, 'الملفات المدفوعة للخيارات الرقمية فقط.'],
}

/** A database failure: a revoked owner is 403, a lock held elsewhere is a retry, a malformed call 422, anything else a detail-free 500. */
function sqlFailure(error: unknown): Response {
  switch ((error as { code?: string } | null)?.code) {
    case '42501':
      return fail(403, 'FORBIDDEN', FORBIDDEN)
    case '55P03':
      return fail(409, 'BUSY', 'الطلبات المرتبطة بهذا الملف قيد المعالجة؛ أعد المحاولة بعد لحظات.')
    case '23505':
      return fail(409, 'CONFLICT', 'سُجّل هذا الملف من قبل؛ ارفعه من جديد.')
    case '22023':
    case '22P02':
    case '23514':
      return fail(422, 'INVALID', 'بيانات غير صالحة.')
    default:
      logCause('paid-files', error)
      return fail(500, 'FAILED', FAILED)
  }
}

/**
 * A SQLSTATE that says the statement failed: the five characters of an error the database itself raised. A network
 * failure or a timeout reaches the caller with an empty or no code, and class 08 (a connection lost on the way) says
 * nothing about whether the commit went through, so neither counts.
 */
const SQLSTATE = /^(?!08)[0-9A-Z]{5}$/

/** The stored type without its parameters, in lower case. */
const typeOf = (contentType: string): string => (contentType.split(';')[0] ?? '').trim().toLowerCase()

/** `paid-file-complete` (owner): check the upload, move it, record it. Every refusal removes what was uploaded. */
export async function paidFileComplete(deps: PaidFileDeps, actor: string, body: unknown): Promise<Response> {
  const parsed = completeSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const { variantId, ticket, filename, mime } = parsed.data
  const { rpc, files } = deps
  const incoming = incomingKey(ticket)
  // A removal that fails leaves the object for the daily sweep of `incoming/`.
  const discard = async (key: string): Promise<void> => {
    try {
      await files.remove([key])
    } catch {
      // Deliberate: see above.
    }
  }
  const refuse = async (code: string, message: string): Promise<Response> => {
    await discard(incoming)
    return fail(422, code, message)
  }
  // The moved object once the SQL recorded nothing: `assets/` is never swept, so it must not stay there. Back under its
  // ticket when the owner will complete that ticket again; else removed, and, when Storage refuses the removal, put back
  // under `incoming/` all the same, where the daily sweep owns it. A move that fails too leaves it: nothing more can be done.
  const putBack = async (key: string): Promise<void> => {
    try {
      await files.move(key, incoming)
    } catch {
      // Deliberate: see above.
    }
  }
  const dropMoved = async (key: string): Promise<void> => {
    try {
      await files.remove([key])
    } catch {
      await putBack(key)
    }
  }
  const missing = (): Response => fail(422, 'MISSING_FILE', 'لم يُرفع الملف بعد أو انتهت مهلة رفعه؛ ابدأ الرفع من جديد.')

  let info: { size: number; contentType: string } | null
  let head: Uint8Array | null
  try {
    info = await files.info(incoming)
    if (!info) return missing()
    // The cheap checks first: the metadata, then a few bytes.
    if (typeOf(info.contentType) !== mime) return refuse('TYPE_MISMATCH', 'نوع الملف المخزّن لا يطابق النوع المُعلَن.')
    if (info.size > PAID_FILE_MAX_BYTES) return refuse('TOO_LARGE', 'حجم الملف أكبر من المسموح (100 ميغابايت).')
    head = await files.head(incoming, HEAD_BYTES)
  } catch {
    return fail(500, 'FAILED', FAILED)
  }
  if (!head) return missing()
  if (!paidFileHeadMatches(mime, head)) {
    return mime === 'application/pdf'
      ? refuse('NOT_A_PDF', 'الملف ليس بصيغة PDF صالحة.')
      : refuse('NOT_AN_EPUB', 'الملف ليس بصيغة EPUB صالحة.')
  }

  const key = `assets/${variantId}/${crypto.randomUUID()}`
  try {
    await files.move(incoming, key)
  } catch {
    return fail(500, 'FAILED', FAILED)
  }
  let result: { ok?: boolean; code?: string; assetId?: unknown; filled?: unknown } | null
  try {
    result = (await rpc('paid_asset_set', {
      p_actor: actor,
      p_variant: variantId,
      p_storage_key: key,
      p_filename: filename,
      p_mime: mime,
      p_bytes: info.size,
    })) as typeof result
  } catch (error) {
    // Nothing was recorded only when the database answered with an error of its own, which carries a SQLSTATE. A call whose
    // outcome is unknown (a network failure or a timeout reaches here with an empty code) may have been committed, and a
    // recorded file must never lose its object. A lock held elsewhere (55P03) is a retry: the object waits under its ticket.
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code === 'string' && SQLSTATE.test(code)) await (code === '55P03' ? putBack(key) : dropMoved(key))
    return sqlFailure(error)
  }
  if (result?.ok !== true) {
    // Only an explicit refusal says that nothing was recorded; any other answer keeps the object, like an unknown outcome.
    if (result?.ok === false) await dropMoved(key)
    const [status, message] = REFUSALS[result?.code ?? ''] ?? [500, FAILED]
    return fail(status, result?.code ?? 'FAILED', message)
  }
  return ok({ assetId: result.assetId, filled: result.filled }, 201)
}
