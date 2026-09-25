import { cookies, draftMode } from 'next/headers'

import { PREVIEW_COOKIE } from '@/lib/content'
import { requireEnv } from '@/lib/env'
import { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Staff preview (P04 part 2). POST `{ accessToken, path }` from the admin:
 * the token is verified, the caller must be an active owner or editor, and
 * only public pages that read collections can be previewed. It then enables
 * Next draft mode and stores the token in an httpOnly cookie that expires
 * with the token (at most an hour), so the loaders read the latest version
 * through RLS. DELETE ends the preview. Nothing public changes.
 */
export const dynamic = 'force-dynamic'

const PREVIEW_PATHS = new Set(['/', '/started', '/built', '/passed', '/shelf'])
const MAX_BODY_BYTES = 8192
const MAX_AGE_SECONDS = 3600
const NO_STORE = { 'cache-control': 'no-store' }

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: NO_STORE })
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'FORBIDDEN', 'طلب غير مسموح.')

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
  let body: { accessToken?: unknown; path?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const { accessToken, path } = body
  if (typeof accessToken !== 'string' || typeof path !== 'string' || !PREVIEW_PATHS.has(path)) {
    return fail(422, 'INVALID', 'لا يمكن معاينة هذه الصفحة.')
  }

  const { data, error } = await getSupabaseServerClient().auth.getClaims(accessToken)
  if (error || !data) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const roleResponse = await fetch(`${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/rpc/current_staff_role`, {
    method: 'POST',
    headers: {
      apikey: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  })
  const role = roleResponse.ok ? ((await roleResponse.json()) as unknown) : null
  if (role !== 'owner' && role !== 'editor') return fail(403, 'FORBIDDEN', 'المعاينة للمالك والمحرر فقط.')

  const secondsLeft = Math.floor((data.claims.exp ?? 0) - Date.now() / 1000)
  const maxAge = Math.min(MAX_AGE_SECONDS, secondsLeft)
  if (maxAge <= 0) return fail(401, 'UNAUTHENTICATED', 'انتهت الجلسة. سجّل الدخول مرة أخرى.')

  ;(await draftMode()).enable()
  ;(await cookies()).set(PREVIEW_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge,
  })
  return Response.json({ ok: true, data: { path } }, { headers: NO_STORE })
}

export async function DELETE(): Promise<Response> {
  ;(await draftMode()).disable()
  ;(await cookies()).delete(PREVIEW_COOKIE)
  return Response.json({ ok: true }, { headers: NO_STORE })
}
