/**
 * Server-only media deletion (P05 round 2), patterned on `src/lib/publish.ts`:
 * verify the caller's staff access token, then call `media_delete(actor, id)`
 * through `withDb` as `app_server` (which rechecks the actor's role and the
 * where-used guard itself). When the row is gone, the returned R2 keys are
 * removed from the two buckets. Never imported by client code and never logs
 * a token.
 */
import { withDb } from './db'
import { privateBucket, publicBucket } from './r2'
import { getSupabaseServerClient } from './supabase/server'

export interface MediaDeleteError {
  code: 'UNAUTHENTICATED' | 'IN_USE' | 'FORBIDDEN' | 'NOT_FOUND' | 'FAILED'
  message: string
}
export type MediaDeleteResult = { ok: true } | { ok: false; error: MediaDeleteError }

/** What `media_delete` hands back for the Worker to remove from R2. */
interface DeleteKeys {
  originalKey: string
  derivativeKeys: string[] | null
}

export async function deleteMedia({ accessToken, id }: { accessToken: string; id: string }): Promise<MediaDeleteResult> {
  const { data, error } = await getSupabaseServerClient().auth.getClaims(accessToken)
  if (error || !data) {
    return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول.' } }
  }

  let keys: DeleteKeys
  try {
    const result = await withDb((client) =>
      client.query<{ keys: DeleteKeys }>('select public.media_delete($1, $2) as keys', [data.claims.sub, id]),
    )
    const row = result.rows[0]?.keys
    if (!row) {
      return { ok: false, error: { code: 'FAILED', message: 'تعذّر حذف الصورة.' } }
    }
    keys = row
  } catch (dbError) {
    const code = (dbError as { code?: string } | null)?.code
    if (code === '23503') {
      return { ok: false, error: { code: 'IN_USE', message: 'الصورة مستخدمة؛ أزلها من المستندات أولًا.' } }
    }
    if (code === '42501') {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'هذا الإجراء متاح فقط لمالك أو محرر نشِط.' } }
    }
    if (code === 'P0002') {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'الصورة غير موجودة.' } }
    }
    return { ok: false, error: { code: 'FAILED', message: 'تعذّر حذف الصورة.' } }
  }

  // The row is gone, so the objects are unreachable either way.
  // ponytail: if the R2 delete throws, ok is still returned — the leftover
  // objects (an unreachable original and public derivatives the `/media`
  // route keeps serving until they are swept) are covered by I29's orphan
  // check, which lists and compares bucket contents.
  try {
    await privateBucket().delete(keys.originalKey)
    await publicBucket().delete(keys.derivativeKeys ?? [])
  } catch {
    // Deliberate: see the ponytail note above.
  }
  return { ok: true }
}
