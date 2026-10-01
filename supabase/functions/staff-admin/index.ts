// staff-admin: invite, role change and revoke/restore for the owner (D13).
//
// Like every Edge Function (D32), it holds the Supabase secret key inside
// Supabase only, never in the browser or the static site. Every action
// requires an active owner whose session is at aal2 with a TOTP verification
// from the last five minutes (`staffFromRequest`, the same identity check as
// `admin`). The last-owner guard is the database trigger on public.staff, so
// it holds here too. CORS allows any origin because the caller authenticates
// with a bearer token the browser never attaches on its own.
import { serviceClient } from '../_shared/db.ts'
import { corsHeaders, fail as failWith, ok as okWith } from '../_shared/http.ts'
import { type StaffIdentity, staffFromRequest } from '../_shared/staff.ts'

const ROLES = ['owner', 'editor', 'operations'] as const
type Role = (typeof ROLES)[number]
const BAN_FOREVER = '876000h'

const CORS = corsHeaders('*')
const fail = (status: number, code: string, message: string): Response => failWith(status, code, message, undefined, CORS)
const ok = (data: unknown): Response => okWith(data, 200, CORS)

// 23514 is the last-owner trigger (check_violation); anything else is unexpected.
const updateFailed = (error: { code?: string }) =>
  error.code === '23514'
    ? fail(409, 'LAST_OWNER', 'يجب أن يبقى مالك نشط واحد على الأقل.')
    : fail(500, 'UPDATE_FAILED', 'تعذّر التحديث. حاول مرة أخرى.')

// The change committed but its audit row did not: say so, never answer plain success.
const auditFailed = () => fail(500, 'AUDIT_FAILED', 'تم الإجراء لكن تعذّر تسجيله في سجل التدقيق.')

const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isEmail = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 120

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'الطريقة غير مسموحة.')

  // 1. Who is calling: a verified JWT, an active owner, a fresh TOTP.
  let staff: StaffIdentity | null
  try {
    staff = await staffFromRequest(req)
  } catch {
    // A failed staff lookup is a server fault, not a bad token.
    return fail(500, 'FAILED', 'تعذّر إكمال الإجراء.')
  }
  if (!staff) return fail(401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.')
  if (staff.role !== 'owner') return fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.')
  if (!staff.recentTotp) return fail(403, 'STEP_UP_REQUIRED', 'أدخل رمز تطبيق المصادقة للمتابعة.')
  const admin = serviceClient()
  const actor = staff.userId

  // 2. What to do.
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > 4096) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')
    const parsed = JSON.parse(text) as unknown
    // `null`, an array or a scalar is not a request: BAD_JSON, like `admin`.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape')
    body = parsed as Record<string, unknown>
  } catch {
    return fail(400, 'BAD_JSON', 'تعذّرت قراءة الطلب.')
  }
  // Resolves to the insert's error (null when the row was written).
  const audit = async (action: string, entityId: string, summary: Record<string, unknown>) =>
    (await admin.from('audit_events').insert({ actor, action, entity: 'staff', entity_id: entityId, summary })).error

  // A failed invite can leave a confirmed auth user with no staff row (its
  // rollback delete may fail too), and that orphan would answer USER_EXISTS
  // for the address for ever. The id of such a user, or null when the address
  // belongs to a real member (or the lookup failed, which keeps USER_EXISTS).
  // ponytail: one page of 1000 auth users; public sign-up is off, so they are staff and orphans.
  const orphanedUserId = async (address: string): Promise<string | null> => {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const user = error ? undefined : data.users.find((u) => u.email?.toLowerCase() === address)
    if (!user) return null
    const row = await admin.from('staff').select('user_id').eq('user_id', user.id).maybeSingle()
    return row.error || row.data ? null : user.id
  }

  switch (body.action) {
    case 'invite': {
      const { email, displayName, role } = body
      if (!isEmail(email) || !isName(displayName) || !isRole(role)) {
        return fail(422, 'INVALID', 'تحقق من البريد والاسم والدور.')
      }
      const address = email.trim().toLowerCase()
      const { data: created, error } = await admin.auth.admin.createUser({ email: address, email_confirm: true })
      const adopted = error?.code === 'email_exists'
      const userId = adopted ? await orphanedUserId(address) : created?.user?.id
      if (adopted && !userId) return fail(409, 'USER_EXISTS', 'هذا البريد مسجّل مسبقًا.')
      if (!userId) return fail(500, 'INVITE_FAILED', 'تعذّرت الدعوة. حاول مرة أخرى.')
      const { error: staffError } = await admin
        .from('staff')
        .insert({ user_id: userId, display_name: displayName.trim(), role })
      if (staffError) {
        // A user created here is rolled back; if that delete fails too, the
        // next invite of this address adopts the orphan (above).
        if (!adopted) await admin.auth.admin.deleteUser(userId)
        return fail(500, 'INVITE_FAILED', 'تعذّرت الدعوة. حاول مرة أخرى.')
      }
      if (await audit('staff.invite', userId, { role })) return auditFailed()
      return ok({ userId })
    }

    case 'set_role': {
      const { userId, role } = body
      if (!isUuid(userId) || !isRole(role)) return fail(422, 'INVALID', 'تحقق من العضو والدور.')
      const { data, error } = await admin.from('staff').update({ role }).eq('user_id', userId).select('user_id')
      if (error) return updateFailed(error)
      if (!data?.length) return fail(404, 'NOT_FOUND', 'العضو غير موجود.')
      if (await audit('staff.set_role', userId, { role })) return auditFailed()
      return ok({ userId, role })
    }

    case 'set_active': {
      const { userId, active } = body
      if (!isUuid(userId) || typeof active !== 'boolean') return fail(422, 'INVALID', 'تحقق من العضو والحالة.')
      // A restore lifts the ban first: if that fails the member stays revoked
      // and the restore button still works.
      if (active) {
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
        if (unbanError) return fail(500, 'UNBAN_FAILED', 'تعذّر رفع إيقاف الدخول. حاول مرة أخرى.')
      }
      const { data, error } = await admin.from('staff').update({ active }).eq('user_id', userId).select('user_id')
      if (error) return updateFailed(error)
      if (!data?.length) return fail(404, 'NOT_FOUND', 'العضو غير موجود.')
      // RLS already denies a revoked member on the next query; the ban also
      // stops sign-in and refresh-token use.
      const banError = active ? null : (await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER })).error
      const auditError = await audit(active ? 'staff.restore' : 'staff.revoke', userId, { banApplied: !banError })
      if (banError) return fail(500, 'BAN_FAILED', 'حُدّثت الحالة لكن تعذّر إيقاف الدخول. حاول مرة أخرى.')
      if (auditError) return auditFailed()
      return ok({ userId, active })
    }

    default:
      return fail(400, 'UNKNOWN_ACTION', 'إجراء غير معروف.')
  }
})
