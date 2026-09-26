/**
 * Server-only publish actions (P04, D29). Each verifies the caller's staff
 * access token, validates the draft against its collection's Zod schema,
 * then calls the matching SQL function through `withDb` as `app_server`
 * (which rechecks the actor's role itself). Used by part 2's server
 * actions; never imported by client code and never logs a token.
 */
import { revalidateTag } from 'next/cache'

import { schemaFor, type Collection } from '../admin/collections'

import { withDb } from './db'
import { requireEnv } from './env'
import { collectMediaIds } from './media-ref'
import { getSupabaseServerClient } from './supabase/server'

export interface PublishActionError {
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID' | 'NOT_FOUND' | 'FAILED'
  message: string
  fields?: unknown
}
export type PublishActionResult = { ok: true } | { ok: false; error: PublishActionError }

const UNAUTHENTICATED: PublishActionResult = {
  ok: false,
  error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول.' },
}

async function verifyStaffToken(accessToken: string): Promise<{ sub: string } | null> {
  const { data, error } = await getSupabaseServerClient().auth.getClaims(accessToken)
  if (error || !data) return null
  return { sub: data.claims.sub }
}

/**
 * Validates a draft before it can go live. Fails closed: if the caller cannot
 * read the version (missing, or hidden from them by RLS) or the read fails,
 * nothing is published. Versions are append-only, so the data validated here
 * is exactly the data the SQL function publishes.
 */
async function validateDraft(
  accessToken: string,
  collection: Collection,
  docId: string,
  seq: number,
): Promise<PublishActionResult | null> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  const params = new URLSearchParams({
    collection: `eq.${collection}`,
    doc_id: `eq.${docId}`,
    seq: `eq.${seq}`,
    select: 'data',
  })
  const response = await fetch(`${url}/rest/v1/content_versions?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!response.ok) return pgErrorResult(null)
  const rows = (await response.json()) as Array<{ data: unknown }>
  const row = rows[0]
  if (!row) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'النسخة غير موجودة أو لا تملك صلاحية الوصول إليها.' } }
  }
  let schema
  try {
    schema = schemaFor(collection, docId)
  } catch {
    return { ok: false, error: { code: 'INVALID', message: 'مستند غير معروف.' } }
  }
  const parsed = schema.safeParse(row.data)
  if (parsed.success) {
    // P05: a document may reference media-library images. Every referenced id
    // must still exist, and an unreadable library fails closed — a broken
    // image reference never goes live.
    const ids = collectMediaIds(parsed.data)
    if (ids.length > 0) {
      const params = new URLSearchParams({ select: 'id', id: `in.(${ids.join(',')})` })
      const mediaResponse = await fetch(`${url}/rest/v1/media?${params}`, {
        headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      if (!mediaResponse.ok) {
        return { ok: false, error: { code: 'FAILED', message: 'تعذّر التحقق من صور المكتبة.' } }
      }
      const mediaRows = (await mediaResponse.json()) as Array<{ id: string }>
      const present = new Set(mediaRows.map((row) => row.id))
      const missing = ids.filter((id) => !present.has(id))
      if (missing.length > 0) {
        return { ok: false, error: { code: 'INVALID', message: 'صورة من المكتبة لم تعد موجودة.', fields: { missing } } }
      }
    }
    return null
  }
  return { ok: false, error: { code: 'INVALID', message: 'البيانات غير صالحة.', fields: parsed.error.flatten() } }
}

function pgErrorResult(error: unknown): PublishActionResult {
  const code = (error as { code?: string } | null | undefined)?.code
  if (code === '42501') {
    return { ok: false, error: { code: 'FORBIDDEN', message: 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.' } }
  }
  if (code === '22023') {
    return { ok: false, error: { code: 'INVALID', message: 'قيمة غير صالحة لهذا الإجراء.' } }
  }
  if (code === 'P0002') {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'النسخة غير موجودة.' } }
  }
  return { ok: false, error: { code: 'FAILED', message: 'تعذّر إكمال الإجراء.' } }
}

function revalidateDocument(collection: Collection, docId: string): void {
  revalidateTag(`content:${collection}`, { expire: 0 })
  revalidateTag(`content:${collection}:${docId}`, { expire: 0 })
}

export async function publishDocument(params: {
  accessToken: string
  collection: Collection
  docId: string
  seq: number
}): Promise<PublishActionResult> {
  const claims = await verifyStaffToken(params.accessToken)
  if (!claims) return UNAUTHENTICATED

  const invalid = await validateDraft(params.accessToken, params.collection, params.docId, params.seq)
  if (invalid) return invalid

  try {
    await withDb((client) =>
      client.query('select public.publish_version($1, $2, $3, $4)', [
        claims.sub,
        params.collection,
        params.docId,
        params.seq,
      ]),
    )
  } catch (error) {
    return pgErrorResult(error)
  }

  revalidateDocument(params.collection, params.docId)
  return { ok: true }
}

export async function scheduleDocument(params: {
  accessToken: string
  collection: Collection
  docId: string
  seq: number
  at: string
}): Promise<PublishActionResult> {
  const claims = await verifyStaffToken(params.accessToken)
  if (!claims) return UNAUTHENTICATED

  const invalid = await validateDraft(params.accessToken, params.collection, params.docId, params.seq)
  if (invalid) return invalid

  try {
    await withDb((client) =>
      client.query('select public.schedule_version($1, $2, $3, $4, $5)', [
        claims.sub,
        params.collection,
        params.docId,
        params.seq,
        params.at,
      ]),
    )
  } catch (error) {
    return pgErrorResult(error)
  }

  return { ok: true }
}

export async function cancelSchedule(params: {
  accessToken: string
  collection: Collection
  docId: string
}): Promise<PublishActionResult> {
  const claims = await verifyStaffToken(params.accessToken)
  if (!claims) return UNAUTHENTICATED

  try {
    await withDb((client) =>
      client.query('select public.cancel_schedule($1, $2, $3)', [claims.sub, params.collection, params.docId]),
    )
  } catch (error) {
    return pgErrorResult(error)
  }

  return { ok: true }
}

export async function archiveDocument(params: {
  accessToken: string
  collection: Collection
  docId: string
}): Promise<PublishActionResult> {
  const claims = await verifyStaffToken(params.accessToken)
  if (!claims) return UNAUTHENTICATED

  try {
    await withDb((client) =>
      client.query('select public.archive_document($1, $2, $3)', [claims.sub, params.collection, params.docId]),
    )
  } catch (error) {
    return pgErrorResult(error)
  }

  revalidateDocument(params.collection, params.docId)
  return { ok: true }
}
