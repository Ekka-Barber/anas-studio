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
 * - `stats` (owner): the owner statistics; 5-minute per-isolate cache.
 * - `status` (owner): configuration booleans, never a secret's value.
 * - `commerce-settings-save` (owner, fresh TOTP): the store's seller details
 *   through `commerce_settings_save`; a stale version answers 409 so the
 *   owner can reload (D34: no tax field anywhere).
 * - `commerce-policies-approve` (owner, fresh TOTP): the P07 round 2
 *   approval of the published policy revisions through
 *   `commerce_policies_approve`; a stale version answers 409 and a missing
 *   required policy answers 422 POLICIES_NOT_PUBLISHED.
 *
 * Every SQL function rechecks the actor's role itself; the role check here
 * only shapes the reply. Tokens and bodies are never logged.
 */
import { createHash } from 'node:crypto'

import { commercePoliciesApproveSchema, commerceSettingsSaveSchema } from './commerce-settings.ts'
import { type Rpc, serviceClient, serviceRpc } from './db.ts'
import { emailProvider } from './email.ts'
import { optionalEnv } from './env.ts'
import { corsHeaders, fail as failWith, NO_STORE } from './http.ts'
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
import { ownerStats, type OwnerStats } from './stats.ts'
import { type StaffIdentity, type StaffResolver, staffFromRequest } from './staff.ts'
import { TEST_SECRETS } from './turnstile.ts'

export const PRIVATE_BUCKET = 'media-private'
export const PUBLIC_BUCKET = 'media-public'

const MAX_BODY_BYTES = 16_384
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CORS = corsHeaders('*')
const STATS_TTL_MS = 5 * 60 * 1000

/** The storage operations this handler needs; the default is Supabase Storage. */
export interface MediaStore {
  signedUpload(bucket: string, key: string): Promise<{ path: string; token: string }>
  /** The whole object, or null when it does not exist. */
  read(bucket: string, key: string): Promise<Uint8Array | null>
  write(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>
  move(bucket: string, from: string, to: string): Promise<void>
  remove(bucket: string, keys: string[]): Promise<void>
}

export interface AdminDeps {
  rpc: Rpc
  staff: StaffResolver
  store: MediaStore
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
      if (error || !data) return null
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
  return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
}

const canEdit = (staff: StaffIdentity) => staff.role === 'owner' || staff.role === 'editor'

export async function handleAdmin(request: Request, deps: AdminDeps = defaultDeps()): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'طلب غير مسموح.')

  const staff = await deps.staff(request)
  if (!staff) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
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
      return stats()
    case 'status':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذه الصفحة للمالك فقط.')
      return ok(settingsStatus())
    case 'commerce-settings-save':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return commerceSettingsSave(deps, staff.userId, body)
    case 'commerce-policies-approve':
      if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
      if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
      return commercePoliciesApprove(deps, staff.userId, body)
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
  //    bytes checked above); if the database refuses, undo everything.
  try {
    await rpc('media_complete', { p_actor: actor, p_ticket: ticketId, p_original_md5: originalMd5 })
  } catch (error) {
    await cleanupAll()
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
    if (code === '23503') return fail(409, 'IN_USE', 'الصورة مستخدمة؛ أزلها من المستندات أولًا.')
    if (code === 'P0002') return fail(404, 'NOT_FOUND', 'الصورة غير موجودة.')
    return sqlFail(error)
  }
  // The row is gone, so the objects are unreachable either way.
  // ponytail: a failed object removal still answers ok; the leftovers are
  // unreferenced and covered by the storage orphan sweep (I29 housekeeping).
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
    if ((error as { code?: string } | null)?.code === '40001') {
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
    if (code === '40001') {
      return fail(409, 'CONFLICT', 'تغيّرت الإعدادات من جلسة أخرى. أعد تحميل الصفحة.')
    }
    if (code === 'P0001') {
      return fail(422, 'POLICIES_NOT_PUBLISHED', 'انشر سياسات المتجر والتوصيل والاسترجاع أولًا.')
    }
    return sqlFail(error)
  }
}

let cachedStats: { at: number; value: OwnerStats } | null = null
// ponytail: a per-isolate single-entry cache for at most 5 minutes. Not a
// shared store; authorization always runs first, so a cached entry can never
// reach a caller that could not have fetched it.

async function stats(): Promise<Response> {
  if (cachedStats && Date.now() - cachedStats.at < STATS_TTL_MS) return ok(cachedStats.value)
  const value = await ownerStats()
  cachedStats = { at: Date.now(), value }
  return ok(value)
}

export interface SettingsStatus {
  email: { provider: 'resend' | 'mailpit' | 'none'; fromSet: boolean }
  turnstile: { configured: boolean; testSecret: boolean }
  webhook: boolean
  jobs: boolean
  siteHost: string
  analytics: boolean
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
    analytics: optionalEnv('ANALYTICS_TOKEN') !== undefined && optionalEnv('CLOUDFLARE_ZONE_ID') !== undefined,
  }
}
