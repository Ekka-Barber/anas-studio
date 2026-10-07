/**
 * The `admin` Edge Function (D32): the staff actions that need server-side
 * checks or secrets, behind one bearer-authenticated endpoint. The admin's
 * browser client calls it with `supabase.functions.invoke('admin', {body})`.
 *
 * Actions (`body.action`):
 * - `media-ticket` (owner/editor): validates the upload declaration, creates
 *   the ticket (`media_create_ticket`, 5-minute expiry, at most 10 open per
 *   actor) and answers one signed upload URL per declared part, all under
 *   `quarantine/<ticket>/` in the private bucket.
 * - `media-complete` (owner/editor): the P05 checks, unchanged: the claim is
 *   once only; every part must exist with exactly its declared bytes; the
 *   original's magic bytes and dimensions must match; each derivative is
 *   verified and promoted to `media-public` from the same bytes; any failure
 *   removes everything the ticket wrote. Header checks only, never a full
 *   decode or a metadata-sterilization guarantee.
 * - `media-delete` (owner/editor): `media_delete` (where-used guard in SQL),
 *   then the objects.
 * - `stats` (owner): the owner statistics. `commerce` is the ledger's figures for the
 *   site's own mode over `{from?, to?}` (the last 30 days by default, at most 366 days)
 *   from `owner_commerce_stats`, read on every call and null while payments are not
 *   configured; the analytics part is cached per isolate (5 minutes, 30 seconds for a
 *   failed answer).
 * - `status` (owner): configuration booleans, never a secret's value.
 * - `payment-recheck` (owner, no TOTP; P08): the owner's «أعد الفحص» on one
 *   payment attempt. An uncertain creation is adopted or abandoned, any other
 *   attempt with an invoice is settled from what the provider holds, a closed
 *   attempt that never had an invoice (a creation the job could not verify) is
 *   looked for at the provider and, once the provider has answered, no longer
 *   marked unverified, and the reply is the attempt's status.
 * - `refund-create` (owner, fresh TOTP; P08 round 6): a refund of a paid attempt or of a
 *   review payment. The provider's refunded total is fetched first (a failed fetch is 503,
 *   nothing written), `refund_request` reserves the balance, only a new refund reaches the
 *   provider, and what it answered goes to `refund_result`. A replay answers the stored
 *   refund. `refund-recheck` (owner) settles one refund from a fresh fetch;
 *   `refund-record-external` (owner, fresh TOTP) records a refund or a void made at the
 *   provider. All three live in `refunds.ts`.
 * - `dispute-record` (owner, fresh TOTP; P08 round 9): one row of a chargeback, payout
 *   difference or fee difference the owner read in Moyasar's emails or settlement files,
 *   through `dispute_record` with the configured mode. Append-only: a repeat answers the
 *   stored row. It lives in `disputes.ts`.
 * - `commerce-settings-save` (owner, fresh TOTP): the store's seller details
 *   through `commerce_settings_save`; a stale version answers 409 so the
 *   owner can reload (D34: no tax field anywhere).
 * - `commerce-policies-approve` (owner, fresh TOTP): the P07 round 2
 *   approval of the published policy revisions through
 *   `commerce_policies_approve`; a stale version answers 409 and a missing
 *   required policy answers 422 POLICIES_NOT_PUBLISHED.
 * - `commerce-checkout-set` (owner, fresh TOTP; P08): the checkout switch
 *   through `commerce_checkout_set`. Turning it on is refused (409
 *   PAYMENTS_NOT_CONFIGURED) while the payment settings are not working, and
 *   (422 NOT_READY) until the seller is named and the policies approved; a
 *   stale version answers 409. Turning it off is always allowed.
 * - `order-link-reissue` (owner; a fresh TOTP only when `email` is given;
 *   FABLE-AUDIT): re-sends an order's link, rotated to the next version, to the
 *   order's address or to a corrected one (`email`). The order's key and link
 *   version are read with `order_email_data`, the next version's token is
 *   derived from them as recovery derives it, and only its peppered hash goes
 *   to `order_link_reissue`, which runs as the caller (the SQL checks the owner
 *   itself), kills the old link and queues the mail. Answers `{version,
 *   emailChanged}`.
 * - `paid-file-ticket` and `paid-file-complete` (owner; P08 round 7): the paid
 *   file of a digital variant. The ticket is a signed upload URL under
 *   `incoming/<ticket>` in the private `paid-files` bucket; the completion checks
 *   the object's stored type, its size and its first bytes (a PDF, or an EPUB's
 *   own first ZIP entry), moves it to `assets/<variant>/<asset>` and records it
 *   through `paid_asset_set`. Both live in `paid-files.ts`.
 *
 * The media and commerce SQL functions recheck the actor's role themselves;
 * the owner-only `stats` and `status` checks and every TOTP step-up (the SQL
 * cannot see aal/amr) are enforced only here and must stay. Tokens and
 * bodies are never logged.
 */
import { createHash } from 'node:crypto'

import { z } from 'zod'

import { commerceCheckoutSetSchema, commercePoliciesApproveSchema, commerceSettingsSaveSchema } from './commerce-settings.ts'
import { toAsciiAddress } from './contact.ts'
import { callerRpc, type Rpc, serviceClient, serviceRpc } from './db.ts'
import { disputeRecord } from './disputes.ts'
import { emailProvider } from './email.ts'
import { LOCAL_HOSTS, optionalEnv } from './env.ts'
import { boundedText, corsHeaders, fail as failWith, logCause, NO_STORE } from './http.ts'
import {
  HEAD_READ_BYTES,
  originalKey,
  publicKey,
  quarantineKey,
  quarantineOriginalKey,
  sqlErrorToHttp,
  ticketRequestSchema,
  verifyObjectHead,
  type TicketRequest,
} from './media.ts'
import { paidFileComplete, type PaidFileStore, paidFileStore, paidFileTicket } from './paid-files.ts'
import { checkAttempt, defaultPaymentDeps, type PaymentDeps, readOnly, resolveUncertain, settleInvoice } from './payments.ts'
import { paymentsConfig, type PaymentsConfigReason } from './payments/moyasar.ts'
import { refundCreate, refundRecheck, refundRecordExternal } from './refunds.ts'
import { ownerStats, type OwnerStats } from './stats.ts'
import { type StaffIdentity, type StaffResolver, staffFromRequest } from './staff.ts'
import { orderAccessToken, orderAccessTokenHash } from './tokens.ts'
import { TEST_SECRETS } from './turnstile.ts'

export const PRIVATE_BUCKET = 'media-private'
export const PUBLIC_BUCKET = 'media-public'

const MAX_BODY_BYTES = 16_384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CORS = corsHeaders('*')
const STATS_TTL_MS = 5 * 60 * 1000
const STATS_RETRY_TTL_MS = 30 * 1000
const DAY_MS = 86_400_000

/** The storage operations this handler needs; the default is Supabase Storage. */
export interface MediaStore {
  signedUpload(bucket: string, key: string): Promise<{ path: string; token: string }>
  /** The whole object, or null when it does not exist; any other Storage failure throws. */
  read(bucket: string, key: string): Promise<Uint8Array | null>
  write(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>
  move(bucket: string, from: string, to: string): Promise<void>
  remove(bucket: string, keys: string[]): Promise<void>
}

export interface AdminDeps {
  rpc: Rpc
  staff: StaffResolver
  store: MediaStore
  /** Only tests set it; otherwise the payment dependencies come from the environment (null while payments are not configured). */
  payments?: PaymentDeps
  /** Only tests set it; otherwise the paid-file actions use the `paid-files` bucket of Supabase Storage. */
  paidFiles?: PaidFileStore
  /** Only tests set it; otherwise the caller's own client (`callerRpc`), for the SQL that checks the caller itself. */
  asCaller?: Rpc
}

export function storageStore(): MediaStore {
  const storage = () => serviceClient().storage
  return {
    async signedUpload(bucket, key) {
      // No upsert: once a part exists its signed URL cannot replace it, so
      // the bytes `media-complete` verified are the bytes it moves and
      // promotes. A retry in the browser always starts a new ticket.
      const { data, error } = await storage().from(bucket).createSignedUploadUrl(key, { upsert: false })
      if (error || !data) throw new Error('SIGNED_URL_FAILED')
      return { path: data.path, token: data.token }
    },
    async read(bucket, key) {
      const { data, error } = await storage().from(bucket).download(key)
      if (error) {
        // Only a missing object means "never uploaded"; a Storage 5xx or a
        // network failure is a server fault and must not be blamed on the upload.
        const { status, statusCode } = error as { status?: number; statusCode?: string }
        if (status === 404 || statusCode === '404') return null
        throw new Error('READ_FAILED')
      }
      if (!data) throw new Error('READ_FAILED')
      return new Uint8Array(await data.arrayBuffer())
    },
    async write(bucket, key, bytes, contentType) {
      const { error } = await storage()
        .from(bucket)
        .upload(key, bytes, { contentType, cacheControl: '31536000', upsert: true })
      if (error) throw new Error('WRITE_FAILED')
    },
    async move(bucket, from, to) {
      const { error } = await storage().from(bucket).move(from, to)
      if (error) throw new Error('MOVE_FAILED')
    },
    async remove(bucket, keys) {
      if (keys.length === 0) return
      await storage().from(bucket).remove(keys)
    },
  }
}

function defaultDeps(): AdminDeps {
  return { rpc: serviceRpc(), staff: staffFromRequest, store: storageStore() }
}

const fail = (status: number, code: string, message: string, fields?: unknown): Response =>
  failWith(status, code, message, fields, CORS)
const ok = (data: unknown, status = 200): Response =>
  Response.json({ ok: true, data }, { status, headers: { ...NO_STORE, ...CORS } })

function sqlFail(error: unknown): Response {
  const mapped = sqlErrorToHttp((error as { code?: string } | null)?.code)
  if (mapped) return fail(mapped.status, mapped.code, mapped.message)
  logCause('admin', error)
  return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
}

const canEdit = (staff: StaffIdentity) => staff.role === 'owner' || staff.role === 'editor'

export async function handleAdmin(request: Request, deps: AdminDeps = defaultDeps()): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')

  let staff: StaffIdentity | null
  try {
    staff = await deps.staff(request)
  } catch (error) {
    // A failed staff lookup is a server fault, not a bad token.
    logCause('admin', error)
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
  if (!staff) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  // The bounded read refuses an oversized body, declared or streamed, before it is ever held whole.
  const text = await boundedText(request, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape')
    body = parsed as Record<string, unknown>
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }

  switch (body.action) {
    case 'media-ticket':
      if (!canEdit(staff)) return fail(403, 'FORBIDDEN', 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.')
      return mediaTicket(deps, staff.userId, body.declaration)
    case 'media-complete':
      if (!canEdit(staff)) return fail(403, 'FORBIDDEN', 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.')
      return mediaComplete(deps, staff.userId, body.ticketId)
    case 'media-delete':
      if (!canEdit(staff)) return fail(403, 'FORBIDDEN', 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.')
      return mediaDelete(deps, staff.userId, body.id)
    case 'stats':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذه الصفحة للمالك فقط.')
      return stats(deps, body)
    case 'status':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذه الصفحة للمالك فقط.')
      return ok(settingsStatus())
    case 'payment-recheck':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      return paymentRecheck(deps, staff.userId, body.attemptId)
    case 'order-link-reissue':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      // A plain re-send goes to the address the order has; another address needs a fresh TOTP, like the money actions.
      if (body.email !== undefined && !staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return orderLinkReissue(deps, deps.asCaller ?? callerRpc(request.headers.get('authorization') ?? ''), body)
    case 'refund-create':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return refundCreate(deps, staff.userId, body)
    case 'refund-recheck':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      return refundRecheck(deps, staff.userId, body)
    case 'refund-record-external':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return refundRecordExternal(deps, staff.userId, body)
    case 'dispute-record':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return disputeRecord(deps, staff.userId, body)
    case 'commerce-settings-save':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return commerceSettingsSave(deps, staff.userId, body)
    case 'commerce-policies-approve':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return commercePoliciesApprove(deps, staff.userId, body)
    case 'commerce-checkout-set':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return commerceCheckoutSet(deps, staff.userId, body)
    case 'paid-file-ticket':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      return paidFileTicket({ files: deps.paidFiles ?? paidFileStore() }, body)
    case 'paid-file-complete':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      return paidFileComplete({ rpc: deps.rpc, files: deps.paidFiles ?? paidFileStore() }, staff.userId, body)
    default:
      return fail(422, 'INVALID', 'إجراء غير معروف.')
  }
}

// ---------------------------------------------------------------------------
// Media

/** The ticket's declaration, read back; it was validated on creation. */
async function readTicket(rpc: Rpc, fn: 'media_ticket' | 'media_claim', actor: string, ticket: string) {
  const declared = await rpc(fn, { p_actor: actor, p_ticket: ticket })
  const parsed = ticketRequestSchema.safeParse(declared)
  return parsed.success ? parsed.data : null
}

async function mediaTicket(deps: AdminDeps, actor: string, declaration: unknown): Promise<Response> {
  const parsed = ticketRequestSchema.safeParse(declaration)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())

  let ticket: { id: string; expiresAt: string }
  try {
    ticket = (await deps.rpc('media_create_ticket', { p_actor: actor, p_declared: parsed.data })) as {
      id: string
      expiresAt: string
    }
    if (!ticket?.id) return fail(500, 'FAILED', 'تعذّر إنشاء التذكرة.')
  } catch (error) {
    return sqlFail(error)
  }

  // One signed URL per declared part; the browser uploads straight to
  // storage, and `media-complete` checks every byte count before anything
  // becomes public.
  try {
    const parts = [
      { part: 'original', bytes: parsed.data.original.bytes, key: quarantineOriginalKey(ticket.id), mime: parsed.data.original.mime },
      ...parsed.data.derivatives.map((d) => ({
        part: `w${d.width}`,
        bytes: d.bytes,
        key: quarantineKey(ticket.id, d.width),
        mime: 'image/webp',
      })),
    ]
    const signed = await Promise.all(
      parts.map(async (p) => ({ part: p.part, bytes: p.bytes, mime: p.mime, ...(await deps.store.signedUpload(PRIVATE_BUCKET, p.key)) })),
    )
    return ok({ ticketId: ticket.id, expiresAt: ticket.expiresAt, bucket: PRIVATE_BUCKET, parts: signed }, 201)
  } catch {
    return fail(500, 'FAILED', 'تعذّر إنشاء روابط الرفع.')
  }
}

async function mediaComplete(deps: AdminDeps, actor: string, ticketId: unknown): Promise<Response> {
  if (typeof ticketId !== 'string' || !UUID.test(ticketId)) return fail(422, 'INVALID', 'طلب غير صالح.')
  const { rpc, store } = deps

  // The claim is once only: from here no other completion of this ticket can
  // run, so every cleanup below is safe.
  let declared: TicketRequest | null
  try {
    declared = await readTicket(rpc, 'media_claim', actor, ticketId)
  } catch (error) {
    return sqlFail(error)
  }
  if (!declared) return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')

  const stagedOriginal = quarantineOriginalKey(ticketId)
  const quarantineKeys = declared.derivatives.map((d) => quarantineKey(ticketId, d.width))
  const publicKeys = declared.derivatives.map((d) => publicKey(ticketId, d.width))
  const privateKeys = [stagedOriginal, ...quarantineKeys, originalKey(ticketId)]
  const cleanupPrivate = () => store.remove(PRIVATE_BUCKET, privateKeys)
  const cleanupAll = () => Promise.all([store.remove(PUBLIC_BUCKET, publicKeys), cleanupPrivate()])
  let originalMd5 = ''

  try {
    // 1. The original exists with exactly its declared bytes, and a bounded
    //    head of it confirms its type and dimensions. The bucket's own size
    //    limit (15 MiB) bounds this read.
    const original = await store.read(PRIVATE_BUCKET, stagedOriginal)
    if (!original) {
      await cleanupPrivate()
      return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
    }
    if (original.byteLength !== declared.original.bytes) {
      await cleanupPrivate()
      return fail(422, 'SIZE_MISMATCH', 'حجم الجزء الأصلي لا يطابق المُعلَن.')
    }
    const originalVerified = await verifyObjectHead(original.subarray(0, HEAD_READ_BYTES), {
      mime: declared.original.mime,
      width: declared.original.width,
      height: declared.original.height,
    })
    if (!originalVerified.ok) {
      await cleanupPrivate()
      return fail(422, originalVerified.code, originalVerified.message)
    }

    // 2. Every derivative is read once, checked, and promoted from the same
    //    bytes, so what goes public is exactly what was verified.
    const derivatives: Uint8Array[] = []
    for (let i = 0; i < declared.derivatives.length; i += 1) {
      const derivative = declared.derivatives[i]!
      const bytes = await store.read(PRIVATE_BUCKET, quarantineKeys[i]!)
      if (!bytes) {
        await cleanupPrivate()
        return fail(422, 'MISSING_PART', 'لم يُرفع كل جزء من الصورة.')
      }
      if (bytes.byteLength !== derivative.bytes) {
        await cleanupPrivate()
        return fail(422, 'SIZE_MISMATCH', 'حجم أحد المشتقات لا يطابق المُعلَن.')
      }
      const verified = await verifyObjectHead(bytes.subarray(0, HEAD_READ_BYTES), {
        mime: 'image/webp',
        width: derivative.width,
        height: derivative.height,
      })
      if (!verified.ok) {
        await cleanupPrivate()
        return fail(422, verified.code, verified.message)
      }
      derivatives.push(bytes)
    }
    for (let i = 0; i < derivatives.length; i += 1) {
      await store.write(PUBLIC_BUCKET, publicKeys[i]!, derivatives[i]!, 'image/webp')
    }
    // The kept original moves out of quarantine, so a late upload to the
    // signed staging path can never replace it.
    await store.move(PRIVATE_BUCKET, stagedOriginal, originalKey(ticketId))
    originalMd5 = createHash('md5').update(original).digest('hex')
  } catch {
    await cleanupAll()
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }

  // 3. Record the media row with the original's MD5 (hex, computed from the
  //    bytes checked above). Only a refusal the function raised (a SQLSTATE
  //    that `sqlErrorToHttp` knows) proves no row was written: then everything
  //    is undone. Any other failure (the network, a timeout, an unknown code)
  //    may have committed the row, so its objects stay: an orphan object is
  //    cheaper than a media row that points at nothing. The daily sweep takes
  //    only the quarantine parts; the promoted ones of a row that was not
  //    written stay.
  try {
    await rpc('media_complete', { p_actor: actor, p_ticket: ticketId, p_original_md5: originalMd5 })
  } catch (error) {
    if (sqlErrorToHttp((error as { code?: string } | null)?.code)) await cleanupAll()
    return sqlFail(error)
  }

  // 4. Success: quarantine is empty again.
  await store.remove(PRIVATE_BUCKET, quarantineKeys)
  return ok({ id: ticketId }, 201)
}

async function mediaDelete(deps: AdminDeps, actor: string, id: unknown): Promise<Response> {
  if (typeof id !== 'string' || !UUID.test(id)) return fail(422, 'INVALID', 'طلب غير صالح.')
  let keys: { originalKey: string; derivativeKeys: string[] | null }
  try {
    keys = (await deps.rpc('media_delete', { p_actor: actor, p_id: id })) as typeof keys
    if (!keys?.originalKey) return fail(500, 'FAILED', 'تعذّر حذف الصورة.')
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23503') return fail(409, 'IN_USE', 'الصورة مستخدمة؛ أزلها من المستندات أو المنتجات أولًا.')
    if (code === 'P0002') return fail(404, 'NOT_FOUND', 'الصورة غير موجودة.')
    return sqlFail(error)
  }
  // The row is gone, so the objects are unreachable either way.
  // ponytail: a failed object removal still answers ok, and `storageStore().remove`
  // does not surface Storage errors, so the catch below is only a guard. The
  // leftovers (`media-private/originals/<id>` and the `media-public` derivatives)
  // are NOT swept: the I29 sweep covers only `quarantine/` (I29 "Not covered",
  // I34 residual).
  try {
    await deps.store.remove(PRIVATE_BUCKET, [keys.originalKey])
    await deps.store.remove(PUBLIC_BUCKET, keys.derivativeKeys ?? [])
  } catch {
    // Deliberate: see the ponytail note above.
  }
  return ok({ id })
}

// ---------------------------------------------------------------------------
// Owner screens

/** The store's seller details (P06 round 3, D34). The role and step-up checks ran in `handleAdmin`. */
async function commerceSettingsSave(deps: AdminDeps, actor: string, body: Record<string, unknown>): Promise<Response> {
  const parsed = commerceSettingsSaveSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  try {
    const version = await deps.rpc('commerce_settings_save', {
      p_actor: actor,
      p_expected_version: parsed.data.expectedVersion,
      p_seller_legal_name: parsed.data.settings.sellerLegalName,
      p_seller_address: parsed.data.settings.sellerAddress,
      p_seller_registration: parsed.data.settings.sellerRegistration,
    })
    return ok({ version })
  } catch (error) {
    // The SQL raises unique_violation (23505) for a stale version: PostgREST retries a 40001 without bound.
    if ((error as { code?: string } | null)?.code === '23505') {
      return fail(409, 'CONFLICT', 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.')
    }
    return sqlFail(error)
  }
}

/** The P07 round 2 policy approval. The role and step-up checks ran in `handleAdmin`. */
async function commercePoliciesApprove(deps: AdminDeps, actor: string, body: Record<string, unknown>): Promise<Response> {
  const parsed = commercePoliciesApproveSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  try {
    const result = await deps.rpc('commerce_policies_approve', {
      p_actor: actor,
      p_expected_version: parsed.data.expectedVersion,
    })
    return ok(result)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') {
      return fail(409, 'CONFLICT', 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.')
    }
    if (code === 'P0001') {
      return fail(422, 'POLICIES_NOT_PUBLISHED', 'انشر سياسات المتجر والتوصيل والاسترجاع أولًا.')
    }
    return sqlFail(error)
  }
}

/**
 * P08: the owner's checkout switch. The role and step-up checks ran in `handleAdmin`. Turning it on needs working
 * payment settings, which only this function can see; the SQL checks the seller and the policies.
 */
async function commerceCheckoutSet(deps: AdminDeps, actor: string, body: Record<string, unknown>): Promise<Response> {
  const parsed = commerceCheckoutSetSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  if (parsed.data.enabled && !deps.payments && !paymentsConfig().ok) {
    return fail(409, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')
  }
  try {
    const version = await deps.rpc('commerce_checkout_set', {
      p_actor: actor,
      p_expected_version: parsed.data.expectedVersion,
      p_enabled: parsed.data.enabled,
    })
    return ok({ version, checkoutEnabled: parsed.data.enabled })
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return fail(409, 'CONFLICT', 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.')
    if (code === 'P0001') return fail(422, 'NOT_READY', 'أكمل بيانات البائع واعتمد السياسات أولًا.')
    return sqlFail(error)
  }
}

/** What `payment_attempt_ref` answers: the attempt's references, or NOT_FOUND. */
type AttemptRef =
  | { ok: false; code: string }
  | { ok: true; attemptId: string; status: string; providerInvoiceId: string | null; createdAt: string; amount: number; currency: string }

/**
 * The statuses a closed attempt can have with no invoice id: a creation the provider refused (failed), one that never landed
 * (abandoned), one the job gave up on (expired). Never paid or review, which an invoice always settled.
 */
const CLOSED_WITHOUT_INVOICE = new Set(['failed', 'abandoned', 'expired', 'cancelled'])

/** P08: the owner's «أعد الفحص». The role check ran in `handleAdmin`; the SQL rechecks the owner again. */
async function paymentRecheck(deps: AdminDeps, actor: string, attemptId: unknown): Promise<Response> {
  if (typeof attemptId !== 'string' || !UUID.test(attemptId)) return fail(422, 'INVALID', 'طلب غير صالح.')
  const payments = deps.payments ?? defaultPaymentDeps(deps.rpc)
  if (!payments) return fail(503, 'PAYMENTS_NOT_CONFIGURED', 'لم تُضبط إعدادات الدفع بعد.')
  const ref = async (): Promise<AttemptRef> =>
    (await payments.rpc('payment_attempt_ref', { p_actor: actor, p_attempt: attemptId, p_mode: payments.config.mode })) as AttemptRef
  try {
    const before = await ref()
    if (!before.ok) return fail(404, 'NOT_FOUND', 'لم نجد محاولة الدفع هذه.')
    if (before.status === 'uncertain') await resolveUncertain(payments, before)
    else if (before.providerInvoiceId) await settleInvoice(payments, before.attemptId, before.providerInvoiceId, 'prompt')
    else if (CLOSED_WITHOUT_INVOICE.has(before.status)) {
      // DB-OPS-01: the job marks an uncertain creation it could never verify UNVERIFIED when it expires it, with no invoice id, and
      // only a prompt the provider answered clears the mark. So the provider is asked for the invoices that carry this attempt's id (a
      // list, through a client that can only read), and once it has answered, the check is recorded as a prompt. The status never
      // moves here: `payment_attempt_close` has no transition out of these statuses (it answers BAD_TRANSITION), so the prompt
      // check, which clears UNVERIFIED and MODE_CHANGED and nothing else, is the only thing that can clear the mark. An invoice the
      // list does find is stored on the attempt by `resolveUncertain` for the last check; a payment on it is the review path's.
      if ((await resolveUncertain(readOnly(payments), before)).kind !== 'unavailable') {
        await checkAttempt(payments, before.attemptId, 'prompt', true, null, null)
      }
    }
    const after = await ref()
    return ok({ status: after.ok ? after.status : before.status })
  } catch (error) {
    // The SQL rechecks the owner: one revoked a moment ago is refused there.
    if ((error as { code?: string } | null)?.code === '42501') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
    return sqlFail(error)
  }
}

const orderLinkReissueSchema = z.strictObject({
  action: z.literal('order-link-reissue'),
  orderId: z.string().regex(UUID),
  // Normalized like checkout's address (lower case, an international domain in its ASCII form); the SQL checks the shape.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((email) => toAsciiAddress(email))
    .optional(),
})

/** `order_link_reissue`'s refusals: a stable code, a short Arabic message. */
const LINK_REFUSALS: Record<string, [status: number, message: string]> = {
  NOT_FOUND: [404, 'لم نجد هذا الطلب.'],
  BAD_STATUS: [409, 'لا يُرسل رابط لطلب لم يُدفع.'],
  VERSION_MISMATCH: [409, 'تغيّر الطلب؛ أعد التحميل.'],
  INVALID_EMAIL: [422, 'تحقق من البريد.'],
}

/**
 * FABLE-AUDIT: the owner re-sends an order's link. The role and, with an
 * address, the step-up checks ran in `handleAdmin`. The order's key and link
 * version come from `order_email_data` (the service client); the next
 * version's token is derived from them as recovery derives it
 * (`recoveryItems`), and only its peppered hash reaches `order_link_reissue`,
 * called as the owner: a version that is no longer the next answers 409.
 */
async function orderLinkReissue(deps: AdminDeps, asCaller: Rpc, body: Record<string, unknown>): Promise<Response> {
  const parsed = orderLinkReissueSchema.safeParse(body)
  if (!parsed.success) return fail(422, 'INVALID', 'بيانات غير صالحة.', parsed.error.flatten())
  const pepper = optionalEnv('TOKEN_HASH_PEPPER')
  if (!pepper) return fail(503, 'UNAVAILABLE', 'تعذّر إكمال الإجراء.')
  const { orderId, email } = parsed.data
  try {
    const order = (await deps.rpc('order_email_data', { p_order: orderId })) as { idempotencyKey?: unknown; tokenVersion?: unknown } | null
    if (typeof order?.idempotencyKey !== 'string' || typeof order.tokenVersion !== 'number') return fail(404, 'NOT_FOUND', 'لم نجد هذا الطلب.')
    const version = order.tokenVersion + 1
    const reply = (await asCaller('order_link_reissue', {
      p_order: orderId,
      p_version: version,
      p_token_hash: await orderAccessTokenHash(pepper, await orderAccessToken(pepper, order.idempotencyKey, version)),
      p_email: email ?? null,
    })) as { ok?: boolean; code?: string; version?: unknown; emailChanged?: unknown } | null
    if (reply?.ok === true) return ok({ version: reply.version, emailChanged: reply.emailChanged })
    const refused = LINK_REFUSALS[reply?.code ?? '']
    return refused ? fail(refused[0], reply!.code!, refused[1]) : fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  } catch (error) {
    // The SQL rechecks the owner: one revoked a moment ago is refused there.
    if ((error as { code?: string } | null)?.code === '42501') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
    logCause('admin', error)
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
}

let cachedStats: { at: number; ttl: number; value: OwnerStats } | null = null
// ponytail: a per-isolate single-entry cache for at most 5 minutes. Not a
// shared store; authorization always runs first, so a cached entry can never
// reach a caller that could not have fetched it.

const statsSchema = z.strictObject({
  action: z.literal('stats'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})

/** The range of `stats` as ISO instants: the request's, else the last 30 days; null when it is malformed or over 366 days. */
function statsRange(body: Record<string, unknown>): { from: string; to: string } | null {
  const parsed = statsSchema.safeParse(body)
  if (!parsed.success) return null
  const to = parsed.data.to === undefined ? Date.now() : Date.parse(parsed.data.to)
  const from = parsed.data.from === undefined ? to - 30 * DAY_MS : Date.parse(parsed.data.from)
  if (!(from < to) || to - from > 366 * DAY_MS) return null
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

async function stats(deps: AdminDeps, body: Record<string, unknown>): Promise<Response> {
  const range = statsRange(body)
  if (!range) return fail(422, 'INVALID', 'نطاق التاريخ غير صالح؛ الحد الأقصى 366 يومًا.')
  // The ledger's figures are read on every call (only the analytics answer is cached), for the site's own mode: null
  // while payments are not configured, and the rest still answers.
  let commerce: unknown = null
  const config = deps.payments?.config ?? paymentsConfig()
  if (config.ok) {
    try {
      commerce = await deps.rpc('owner_commerce_stats', { p_from: range.from, p_to: range.to, p_environment: config.mode })
    } catch (error) {
      return sqlFail(error)
    }
  }
  if (cachedStats && Date.now() - cachedStats.at < cachedStats.ttl) return ok({ ...cachedStats.value, commerce })
  const value = await ownerStats()
  // A good answer is kept five minutes. Any other (a failure, or «not
  // configured» just before the owner sets the token) only 30 seconds: long
  // enough to spare a failing analytics API a call per page, short enough
  // that a fix shows at once.
  cachedStats = { at: Date.now(), ttl: value.analytics.status === 'ok' ? STATS_TTL_MS : STATS_RETRY_TTL_MS, value }
  return ok({ ...value, commerce })
}

export interface SettingsStatus {
  email: { provider: 'resend' | 'mailpit' | 'none'; fromSet: boolean }
  turnstile: { configured: boolean; testSecret: boolean }
  webhook: boolean
  jobs: boolean
  siteHost: string
  analytics: boolean
  /** The reason is a code and the mode a name; `emulator` is true when the API base is a local host. */
  payments: { configured: boolean; reason?: PaymentsConfigReason; mode?: 'test' | 'live'; emulator: boolean }
}

function paymentsStatus(): SettingsStatus['payments'] {
  const config = paymentsConfig()
  const base = optionalEnv('MOYASAR_API_BASE_URL')
  let emulator = false
  try {
    emulator = base !== undefined && LOCAL_HOSTS.has(new URL(base).hostname)
  } catch {
    // An unparseable base is not a local one.
  }
  return config.ok ? { configured: true, mode: config.mode, emulator } : { configured: false, reason: config.reason, emulator }
}

/** Owner-only configuration status: booleans and names only, never a secret's value. */
export function settingsStatus(): SettingsStatus {
  let provider: 'resend' | 'mailpit' | 'none' = 'none'
  try {
    provider = emailProvider() ?? 'none'
  } catch {
    // A misconfiguration (Mailpit for a hosted site) shows as "none".
    provider = 'none'
  }
  const turnstileSecret = optionalEnv('TURNSTILE_SECRET_KEY')
  let siteHost = ''
  const siteUrl = optionalEnv('SITE_URL')
  if (siteUrl) {
    try {
      siteHost = new URL(siteUrl).hostname
    } catch {
      siteHost = ''
    }
  }
  return {
    email: { provider, fromSet: optionalEnv('EMAIL_FROM') !== undefined },
    turnstile: {
      configured: turnstileSecret !== undefined,
      testSecret: turnstileSecret !== undefined && TEST_SECRETS.has(turnstileSecret),
    },
    webhook: optionalEnv('RESEND_WEBHOOK_SECRET') !== undefined,
    jobs: optionalEnv('JOBS_SECRET') !== undefined,
    siteHost,
    // The same gate as `fetchAnalytics`: it also needs a SITE_URL host.
    analytics:
      optionalEnv('ANALYTICS_TOKEN') !== undefined && optionalEnv('CLOUDFLARE_ZONE_ID') !== undefined && siteHost !== '',
    payments: paymentsStatus(),
  }
}
