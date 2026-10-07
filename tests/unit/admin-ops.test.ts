// AUDIT-2 R06: the admin shell's width and draft rules, the one-time code
// digit folding, the owner home's job and publish-failure lines, and the
// customer phone rule the form now states before the database does.
// FABLE-AUDIT F2b: the payment reconciliation's job line, the team screen's
// success sentences and the step-up dialog's failure sentences. F3-5 and F3-12: the
// team screen's role edit that does not outlive a refusal, the revoke offered again
// and the confirmation before an owner changes their own role.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { customersConfig } from '../../src/admin/tables/customers'
import { emailWaiting, jobProblem, publishFailures } from '../../src/components/admin/AdminHome'
import { clearDrafts, isWidePath } from '../../src/components/admin/AdminShell'
import { stepUpError } from '../../src/components/admin/StepUp'
import { doneText, OWN_ROLE_CONFIRM, RETRY_REVOKE, unfinishedRevoke, withoutEdit } from '../../src/components/admin/TeamView'
import { otpDigits } from '../../src/lib/digits'

// AdminHome, AdminShell, StepUp and TeamView import through the `@/` alias, which the unit config does not resolve.
vi.mock('@/admin/collections', () => ({ COLLECTION_LABELS: {} }))
vi.mock('@/lib/digits', () => ({ otpDigits: String }))
vi.mock('@/lib/format', () => ({ formatNumber: String, formatRiyadh: String }))
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({}) }))
vi.mock('@/lib/supabase/functions', () => ({ callFunction: async () => ({}), documentHref: () => '' }))
vi.mock('../../src/components/admin/TableList', () => ({ ROLE_LABEL: {} }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('one-time codes', () => {
  it('folds Arabic-Indic and extended digits to Latin', () => {
    expect(otpDigits('٤٨٢٩١٣')).toBe('482913')
    expect(otpDigits('۴۸۲۹۱۳')).toBe('482913')
    expect(otpDigits('٤٨2٩١3')).toBe('482913')
  })

  it('drops spaces, direction marks, dashes and letters, and keeps six digits', () => {
    expect(otpDigits('482 913')).toBe('482913')
    expect(otpDigits('‏٤٨٢-٩١٣‎')).toBe('482913')
    expect(otpDigits('abc')).toBe('')
    expect(otpDigits('4829131')).toBe('482913')
  })
})

describe('the admin shell', () => {
  it('is wide for the email, team and store list screens only', () => {
    for (const path of ['/admin/email', '/admin/team', '/admin/team/', '/admin/store/products', '/admin/store/shipping-rates/']) {
      expect(isWidePath(path), path).toBe(true)
    }
    for (const path of ['/admin', '/admin/store', '/admin/store/', '/admin/store/products/edit', '/admin/content/rooms', '/admin/security']) {
      expect(isWidePath(path), path).toBe(false)
    }
  })

  it('clears every editor draft and nothing else', () => {
    const store: Record<string, string> = {
      'anasaq:draft:rooms:a': '{}',
      'anasaq:draft:posts:b': '{}',
      'sb-auth-token': 'keep',
    }
    Object.defineProperty(store, 'removeItem', { value: (key: string) => delete store[key], enumerable: false })
    vi.stubGlobal('window', { localStorage: store })
    clearDrafts()
    expect(Object.keys(store)).toEqual(['sb-auth-token'])
  })
})

describe('the owner home job lines', () => {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  const run = (status: string, reason?: string, job = 'email_outbox') => ({
    job,
    status,
    finished_at: ago(1),
    detail: reason ? { reason } : null,
  })

  it('reads a QUOTA_HELD run finished a minute ago as trouble while mail has been due for 15 minutes', () => {
    expect(emailWaiting(run('partial', 'QUOTA_HELD'), ago(15))).toBe(true)
    expect(jobProblem('email_outbox', run('partial', 'QUOTA_HELD'), ago(15))).toContain('حدّ الإرسال')
  })

  it('does not warn on the reason alone, nor on a run that sent something', () => {
    expect(emailWaiting(run('partial', 'QUOTA_HELD'), null)).toBe(false)
    expect(emailWaiting(run('partial', 'QUOTA_HELD'), ago(5))).toBe(false)
    expect(emailWaiting(run('ok'), ago(15))).toBe(false)
    expect(emailWaiting(run('partial'), ago(15))).toBe(false)
    expect(emailWaiting(undefined, ago(15))).toBe(true)
  })

  it('names a site build skipped for want of a rebuild hook', () => {
    expect(jobProblem('site_build', run('skipped', 'NO_HOOK', 'site_build'), null)).toContain('رابط بناء الموقع')
    expect(jobProblem('site_build', run('skipped', undefined, 'site_build'), null)).toBeNull()
    expect(jobProblem('site_build', run('ok', undefined, 'site_build'), null)).toBeNull()
  })

  it('warns when payment work has waited more than 10 minutes with no reconciliation run inside them, by the email job\'s rule', () => {
    const STALE = 'مدفوعات تنتظر المطابقة منذ أكثر من 10 دقائق. تأكد من الجدولة.'
    const payments = (status: string, reason?: string) => run(status, reason, 'payments_reconcile')
    // Nothing due, or due for less than 10 minutes: healthy, whatever the last run was.
    expect(jobProblem('payments_reconcile', undefined, null)).toBeNull()
    expect(jobProblem('payments_reconcile', { ...payments('ok'), finished_at: ago(600) }, null)).toBeNull()
    expect(jobProblem('payments_reconcile', undefined, ago(5))).toBeNull()
    // Due for 15 minutes: a run that finished a minute ago is alive; none, or one older than 10 minutes, is not.
    expect(jobProblem('payments_reconcile', payments('ok'), ago(15))).toBeNull()
    expect(jobProblem('payments_reconcile', payments('partial'), ago(15))).toBeNull()
    expect(jobProblem('payments_reconcile', undefined, ago(15))).toBe(STALE)
    expect(jobProblem('payments_reconcile', { ...payments('ok'), finished_at: ago(20) }, ago(15))).toBe(STALE)
  })

  it('says the reconciliation is stopped while the payments are not configured, whether or not work is due', () => {
    const OFF = 'الدفع غير مضبوط؛ المطابقة متوقفة.'
    const skipped = run('skipped', 'PAYMENTS_NOT_CONFIGURED', 'payments_reconcile')
    expect(jobProblem('payments_reconcile', skipped, null)).toBe(OFF)
    expect(jobProblem('payments_reconcile', skipped, ago(15))).toBe(OFF)
    expect(jobProblem('payments_reconcile', { ...skipped, finished_at: ago(600) }, ago(15))).toBe(OFF)
    // Another reason, or none, is no such sentence.
    expect(jobProblem('payments_reconcile', run('skipped', undefined, 'payments_reconcile'), null)).toBeNull()
  })
})

describe('the team screen and the step-up dialog', () => {
  it('says each success on the status line', () => {
    expect(doneText({ action: 'invite', email: 'a@b.sa', displayName: 'س', role: 'editor' })).toBe('أُرسلت الدعوة.')
    expect(doneText({ action: 'set_role', userId: 'x', role: 'operations' })).toBe('غُيّر الدور.')
    expect(doneText({ action: 'set_active', userId: 'x', active: false })).toBe('أُوقف العضو.')
    expect(doneText({ action: 'set_active', userId: 'x', active: true })).toBe('استُعيد العضو.')
  })

  it('forgets one member\'s unsaved role and no other\'s: after a refusal the row shows the role they really have (F3-5)', () => {
    const edits = { a: 'owner', b: 'editor' } as const
    expect(withoutEdit(edits, 'a')).toEqual({ b: 'editor' })
    expect(withoutEdit(withoutEdit(edits, 'a'), 'b')).toEqual({})
    // A member with no edit is no change, and the edits it was given are not touched.
    expect(withoutEdit(edits, 'c')).toEqual(edits)
    expect(edits).toEqual({ a: 'owner', b: 'editor' })
  })

  it('offers the revoke again only when the member stays revoked with their sign-in or sessions not shut (F3-12)', () => {
    const revoke = { action: 'set_active', userId: 'm1', active: false }
    // The ban held and the sessions would not end, or the ban failed and could not be rolled back: «حاول مرة أخرى» for that member.
    expect(unfinishedRevoke(revoke, 'SESSIONS_FAILED')).toBe('m1')
    expect(unfinishedRevoke(revoke, 'ROLLBACK_FAILED')).toBe('m1')
    expect(unfinishedRevoke(revoke, 'BAN_INCOMPLETE')).toBe('m1')
    // A ban that failed and was rolled back leaves the member active: the revoke button itself is the retry.
    for (const code of ['BAN_FAILED', 'UPDATE_FAILED', 'AUDIT_FAILED', 'LAST_OWNER', 'NOT_FOUND', 'UNKNOWN', 'INVALID']) expect(unfinishedRevoke(revoke, code), code).toBeNull()
    // Never for a restore, a role change or an invite, whatever they were refused with.
    for (const body of [{ ...revoke, active: true }, { action: 'set_role', userId: 'm1', role: 'editor' }, { action: 'invite', email: 'a@b.sa' }, { action: 'set_active', active: false }]) {
      expect(unfinishedRevoke(body, 'SESSIONS_FAILED'), JSON.stringify(body)).toBeNull()
    }
    expect(RETRY_REVOKE).toBe('حاول مرة أخرى')
  })

  it('asks before an owner changes their own role, in its own words (FIX-A1-02)', () => {
    expect(OWN_ROLE_CONFIRM).toBe('ستغيّر دورك أنت؛ متابعة؟')
  })

  it('tells a lost connection and Auth\'s attempt limit from a wrong code', () => {
    expect(stepUpError(undefined)).toBe('تعذّر الاتصال. حاول مرة أخرى.')
    expect(stepUpError(0)).toBe('تعذّر الاتصال. حاول مرة أخرى.')
    expect(stepUpError(429)).toBe('محاولات كثيرة. انتظر دقيقة ثم حاول.')
    for (const status of [400, 401, 422, 500]) expect(stepUpError(status), String(status)).toBe('الرمز غير صحيح.')
  })
})

describe('failed scheduled publishes', () => {
  it('lists each document once, newest first', () => {
    const rows = [
      { entity: 'posts', entity_id: 'b' },
      { entity: 'rooms', entity_id: 'a' },
      { entity: 'posts', entity_id: 'b' },
      { entity: 'posts', entity_id: null },
    ]
    expect(publishFailures(rows)).toEqual([
      { collection: 'posts', docId: 'b' },
      { collection: 'rooms', docId: 'a' },
    ])
  })
})

describe('the customer form', () => {
  const issues = (phone: unknown) => customersConfig.validate?.({ name: 'س', phone }) ?? []

  it('names the phone when it cannot be read as a Saudi mobile', () => {
    expect(issues('0601234567')).toEqual([{ field: 'phone', message: 'أدخل رقم جوال سعوديًا صحيحًا.' }])
    expect(issues('+44 7700 900123')).toHaveLength(1)
    expect(issues('05012345')).toHaveLength(1)
  })

  it('accepts an empty phone and every spelling normalizeSaudiMobile reads', () => {
    for (const phone of ['', '   ', null, '0501234567', '+966 50 123 4567', '٠٥٠١٢٣٤٥٦٧']) expect(issues(phone)).toEqual([])
  })
})
