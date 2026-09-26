/**
 * Publishing from the admin (P04, D32; was the server actions over
 * `src/lib/publish.ts`). The signed-in staff member calls the publishing SQL
 * functions directly; each one takes the actor from `auth.uid()` and rechecks
 * that it is an active owner or editor, so RLS-style enforcement stays in the
 * database.
 *
 * Validation before publishing happens here, in the browser: the saved
 * version must satisfy its collection's Zod schema and every referenced
 * media-library image must still exist. That is for the editor's sake. The
 * public site is guarded by the same schemas at build time
 * (`src/lib/content.ts`): a document that fails them fails the build, and the
 * last good deployment stays live, so nothing invalid can ever reach a page.
 */
import { schemaFor, type Collection } from '../admin/collections'

import { collectMediaIds } from './media-ref'
import { getSupabaseBrowserClient } from './supabase/browser'

export interface PublishActionError {
  code: 'FORBIDDEN' | 'INVALID' | 'NOT_FOUND' | 'FAILED'
  message: string
  fields?: unknown
}
export type PublishActionResult = { ok: true } | { ok: false; error: PublishActionError }

function sqlErrorResult(error: { code?: string } | null): PublishActionResult {
  const code = error?.code
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

/**
 * Validates one saved version before it can go live. Fails closed: if the
 * version cannot be read, nothing is published. Versions are append-only, so
 * the data validated here is exactly the data the SQL function publishes.
 */
async function validateVersion(collection: Collection, docId: string, seq: number): Promise<PublishActionResult | null> {
  const supabase = getSupabaseBrowserClient()
  const { data, error } = await supabase
    .from('content_versions')
    .select('data')
    .eq('collection', collection)
    .eq('doc_id', docId)
    .eq('seq', seq)
    .maybeSingle()
  if (error) return sqlErrorResult(error)
  if (!data) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'النسخة غير موجودة أو لا تملك صلاحية الوصول إليها.' } }
  }
  let schema
  try {
    schema = schemaFor(collection, docId)
  } catch {
    return { ok: false, error: { code: 'INVALID', message: 'مستند غير معروف.' } }
  }
  const parsed = schema.safeParse(data.data)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID', message: 'البيانات غير صالحة.', fields: parsed.error.flatten() } }
  }
  // P05: every referenced library image must still exist; an unreadable
  // library fails closed.
  const ids = collectMediaIds(parsed.data)
  if (ids.length > 0) {
    const media = await supabase.from('media').select('id').in('id', ids)
    if (media.error) return { ok: false, error: { code: 'FAILED', message: 'تعذّر التحقق من صور المكتبة.' } }
    const present = new Set((media.data ?? []).map((row: { id: string }) => row.id))
    const missing = ids.filter((id) => !present.has(id))
    if (missing.length > 0) {
      return { ok: false, error: { code: 'INVALID', message: 'صورة من المكتبة لم تعد موجودة.', fields: { missing } } }
    }
  }
  return null
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<PublishActionResult> {
  const { error } = await getSupabaseBrowserClient().rpc(fn, args)
  return error ? sqlErrorResult(error) : { ok: true }
}

export async function publishDocument(collection: Collection, docId: string, seq: number): Promise<PublishActionResult> {
  const invalid = await validateVersion(collection, docId, seq)
  if (invalid) return invalid
  return callRpc('publish_version', { p_collection: collection, p_doc_id: docId, p_seq: seq })
}

export async function scheduleDocument(
  collection: Collection,
  docId: string,
  seq: number,
  at: string,
): Promise<PublishActionResult> {
  const invalid = await validateVersion(collection, docId, seq)
  if (invalid) return invalid
  return callRpc('schedule_version', { p_collection: collection, p_doc_id: docId, p_seq: seq, p_at: at })
}

export async function cancelSchedule(collection: Collection, docId: string): Promise<PublishActionResult> {
  return callRpc('cancel_schedule', { p_collection: collection, p_doc_id: docId })
}

export async function archiveDocument(collection: Collection, docId: string): Promise<PublishActionResult> {
  return callRpc('archive_document', { p_collection: collection, p_doc_id: docId })
}
