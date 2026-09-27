// staff-admin: invite, role change and revoke/restore for the owner (D13).
//
// Like every Edge Function (D32), it holds the Supabase secret key inside
// Supabase only, never in the browser or the static site. Every action
// requires an active owner whose session is at aal2 with a TOTP verification
// from the last five minutes. The last-owner guard is the database trigger
// on public.staff, so it holds here too. CORS allows any origin because the
// caller authenticates with a bearer token the browser never attaches on its
// own.
import { createClient } from 'npm:@supabase/supabase-js@2'

import { hasRecentTotp } from '../_shared/recent-totp.ts'

const ROLES = ['owner', 'editor', 'operations'] as const
type Role = (typeof ROLES)[number]
const BAN_FOREVER = '876000h'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } })
}
function fail(status: number, code: string, message: string): Response {
  return reply(status, { ok: false, error: { code, message } })
}

// 23514 is the last-owner trigger (check_violation); anything else is unexpected.
const updateFailed = (error: { code?: string }) =>
  error.code === '23514'
    ? fail(409, 'LAST_OWNER', 'يجب أن يبقى مالك نشط واحد على الأقل.')
    : fail(500, 'UPDATE_FAILED', 'تعذّر التحديث. حاول مرة أخرى.')

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 120

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'الطريقة غير مسموحة.')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Who is calling: a verified JWT, an active owner, a fresh TOTP.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')
  const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token)
  const claims = claimsData?.claims
  if (claimsError || !claims?.sub) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')

  const { data: caller } = await admin.from('staff').select('role, active').eq('user_id', claims.sub).maybeSingle()
  if (!caller || !caller.active || caller.role !== 'owner') {
    return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
  }
  if (!hasRecentTotp(claims, Math.floor(Date.now() / 1000))) {
    return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
  }

  // 2. What to do.
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > 4096) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
    body = JSON.parse(text)
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  const audit = (action: string, entityId: string, summary: Record<string, unknown>) =>
    admin.from('audit_events').insert({ actor: claims.sub, action, entity: 'staff', entity_id: entityId, summary })

  switch (body.action) {
    case 'invite': {
      const { email, displayName, role } = body
      if (!isEmail(email) || !isName(displayName) || !isRole(role)) {
        return fail(422, 'INVALID', 'تحقق من البريد والاسم والدور.')
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        email_confirm: true,
      })
      if (error || !created.user) return fail(409, 'USER_EXISTS', 'هذا البريد مسجّل مسبقًا.')
      const { error: staffError } = await admin
        .from('staff')
        .insert({ user_id: created.user.id, display_name: displayName.trim(), role })
      if (staffError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return fail(500, 'INVITE_FAILED', 'تعذّرت الدعوة. حاول مرة أخرى.')
      }
      await audit('staff.invite', created.user.id, { role })
      return reply(200, { ok: true, data: { userId: created.user.id } })
    }

    case 'set_role': {
      const { userId, role } = body
      if (!isUuid(userId) || !isRole(role)) return fail(422, 'INVALID', 'تحقق من العضو والدور.')
      const { data, error } = await admin.from('staff').update({ role }).eq('user_id', userId).select('user_id')
      if (error) return updateFailed(error)
      if (!data?.length) return fail(404, 'NOT_FOUND', 'العضو غير موجود.')
      await audit('staff.set_role', userId, { role })
      return reply(200, { ok: true, data: { userId, role } })
    }

    case 'set_active': {
      const { userId, active } = body
      if (!isUuid(userId) || typeof active !== 'boolean') return fail(422, 'INVALID', 'تحقق من العضو والحالة.')
      const { data, error } = await admin.from('staff').update({ active }).eq('user_id', userId).select('user_id')
      if (error) return updateFailed(error)
      if (!data?.length) return fail(404, 'NOT_FOUND', 'العضو غير موجود.')
      // RLS already denies a revoked member on the next query; the ban also
      // stops sign-in and refresh-token use.
      const { error: banError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: active ? 'none' : BAN_FOREVER,
      })
      await audit(active ? 'staff.restore' : 'staff.revoke', userId, { banApplied: !banError })
      if (banError) return fail(500, 'BAN_FAILED', 'حُدّثت الحالة لكن تعذّر إيقاف الدخول. حاول مرة أخرى.')
      return reply(200, { ok: true, data: { userId, active } })
    }

    default:
      return fail(400, 'UNKNOWN_ACTION', 'إجراء غير معروف.')
  }
})
