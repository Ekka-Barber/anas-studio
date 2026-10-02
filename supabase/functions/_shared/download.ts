import { z } from 'zod'

import { type Rpc, serviceClient, serviceRpc } from './db.ts'
import { optionalEnv } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, ok as okWith, siteOrigin } from './http.ts'
import { PAID_BUCKET } from './paid-files.ts'
import { type PaymentsConfig, paymentsConfig } from './payments/moyasar.ts'
import { clientKeyHash } from './rate-limit.ts'
import { downloadToken, downloadTokenHash, orderAccessTokenHash } from './tokens.ts'

/**
 * The buyer's file endpoint: the `download` Edge Function (P08 round 7, PLANS/P08-CONTRACT.md
 * sections 5 to 7). Two actions on one discriminated body:
 *
 * - `issue` turns the order's access token into a download token (`download_issue`): 32 random bytes,
 *   minted here, of which only the peppered hash is stored; it lives 15 minutes. The reply is
 *   `{downloadToken, expiresAt}`.
 * - `redeem` turns a download token into one file link (`download_redeem`: at most 3 per token, never
 *   once the entitlement is revoked or the order refunded): a 60-second signed Storage URL with the
 *   file's own name as its download name, answered as `{url}`. The storage key is unguessable
 *   (`assets/<variant>/<asset>`) and appears only inside that URL; it is never mailed, stored in the
 *   browser or logged.
 *
 * The signed URL comes from the Storage client on the runtime's own (internal) address; it is rebuilt on
 * the public Storage base of `paymentsConfig()` so a browser can follow it. The download name is added
 * here, not by the client library: that one percent-encodes it twice, so an Arabic name would reach
 * the browser as `%D9%83...` text.
 *
 * Order of checks, like `orders`: method → site and pepper → origin → content type → size → JSON →
 * schema → payments configured → database. Every reply carries `Referrer-Policy: no-referrer` and
 * `Cache-Control: no-store`. A throttle is 429 and anything else a detail-free 500. A token, a storage
 * key and a signed URL are never logged.
 */

const MAX_BODY_BYTES = 65_536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** How long a file link lives. */
const SIGNED_SECONDS = 60
const FAILED = 'تعذّر إكمال الإجراء.'

const issueSchema = z.strictObject({
  action: z.literal('issue'),
  orderNumber: z.string().trim().toUpperCase().regex(/^[2-9A-HJ-NP-Z]{8}$/),
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  itemId: z.string().regex(UUID),
})

const redeemSchema = z.strictObject({
  action: z.literal('redeem'),
  // 32 random bytes in base64url.
  downloadToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

const bodySchema = z.discriminatedUnion('action', [issueSchema, redeemSchema])

/** SQL refusals → HTTP status and a short Arabic message (no internal detail). */
const REFUSALS: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'تعذّر تنزيل الملف؛ اطلب رابطًا جديدًا من صفحة الطلب.' },
  TOO_MANY_DOWNLOADS: { status: 429, message: 'طلبت روابط تنزيل كثيرة لهذا الملف اليوم؛ حاول غدًا.' },
}

/** What the SQL functions answer (a subset is read per call). */
type SqlReply = { ok?: boolean; code?: string; expiresAt?: unknown; storageKey?: unknown; filename?: unknown } | null

/** A signed URL for one object of the paid files' bucket, on the runtime's own Storage address. */
export type DownloadSigner = (storageKey: string, seconds: number) => Promise<string>

export type DownloadDeps = {
  /** The database path; the service-role Data API rpc unless a test injects one. */
  rpc?: Rpc
  /** What `paymentsConfig()` says; read from the environment unless a test injects it. */
  config?: PaymentsConfig
  /** The Storage signer; the service-role client unless a test injects one. */
  signer?: DownloadSigner
}

const storageSigner: DownloadSigner = async (storageKey, seconds) => {
  const { data, error } = await serviceClient().storage.from(PAID_BUCKET).createSignedUrl(storageKey, seconds)
  if (error || !data) throw new Error('SIGN_FAILED')
  return data.signedUrl
}

/**
 * The signed URL on the public Storage base, with the download name; null when the signer's URL is not a
 * Storage signed-object URL at all.
 */
export function publicFileUrl(signedUrl: string, storageBase: string, filename: string): string | null {
  const at = signedUrl.indexOf('/object/sign/')
  if (at === -1) return null
  try {
    const url = new URL(`${storageBase}${signedUrl.slice(at)}`)
    url.searchParams.set('download', filename)
    return url.toString()
  } catch {
    return null
  }
}

export async function handleDownload(request: Request, deps: DownloadDeps = {}): Promise<Response> {
  const rpc = deps.rpc ?? serviceRpc()
  const signer = deps.signer ?? storageSigner

  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  const siteUrl = optionalEnv('SITE_URL')
  const allowed = siteOrigin()
  const headers = { ...(allowed ? corsHeaders(allowed) : {}), 'referrer-policy': 'no-referrer' }
  const fail = (status: number, code: string, message: string, fields?: unknown): Response => failWith(status, code, message, fields, headers)
  const okReply = (data: unknown): Response => okWith(data, 200, headers)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')
  // Without the site origin nothing below can be checked, and without the pepper no token can be hashed.
  if (!siteUrl || !allowed || !pepper) return fail(503, 'UNAVAILABLE', FAILED)
  if (request.headers.get('origin') !== allowed) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')

  const contentType = request.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'أرسل الطلب بصيغة JSON.')
  }
  // The bounded read refuses an oversized body, declared or streamed, without buffering it.
  const text = await boundedText(request, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'TOO_LARGE', 'الطلب أطول من المسموح.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const input = parsed.data
  // The mode both SQL functions are bound to and the storage base a file link is rebuilt on come from the payment
  // settings; without them there are no orders to serve.
  const config = deps.config ?? paymentsConfig()
  if (!config.ok) return fail(503, 'UNAVAILABLE', FAILED)

  const ipHash = await clientKeyHash(request, pepper)
  let result: SqlReply
  let minted = ''
  try {
    if (input.action === 'issue') {
      minted = downloadToken()
      result = (await rpc('download_issue', {
        p_order_number: input.orderNumber,
        p_access_token_hash: await orderAccessTokenHash(pepper, input.accessToken),
        p_item: input.itemId,
        p_download_token_hash: await downloadTokenHash(pepper, minted),
        p_ip_hash: ipHash,
        p_mode: config.mode,
      })) as SqlReply
    } else {
      result = (await rpc('download_redeem', {
        p_download_token_hash: await downloadTokenHash(pepper, input.downloadToken),
        p_ip_hash: ipHash,
        p_mode: config.mode,
      })) as SqlReply
    }
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '54000') return fail(429, 'RATE_LIMITED', 'أرسلت طلبات كثيرة؛ حاول لاحقًا.')
    return fail(500, 'FAILED', FAILED)
  }
  if (result?.ok !== true) {
    const mapped = REFUSALS[result?.code ?? '']
    return mapped ? fail(mapped.status, result!.code!, mapped.message) : fail(500, 'FAILED', FAILED)
  }

  if (input.action === 'issue') return okReply({ downloadToken: minted, expiresAt: result.expiresAt })

  if (typeof result.storageKey !== 'string' || typeof result.filename !== 'string') return fail(500, 'FAILED', FAILED)
  let url: string | null
  try {
    url = publicFileUrl(await signer(result.storageKey, SIGNED_SECONDS), config.storageBase, result.filename)
  } catch {
    return fail(500, 'FAILED', FAILED)
  }
  return url ? okReply({ url }) : fail(500, 'FAILED', FAILED)
}
