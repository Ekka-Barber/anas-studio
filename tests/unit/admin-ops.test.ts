// AUDIT-2 R06: the admin shell's width and draft rules, the one-time code
// digit folding, the owner home's job and publish-failure lines, and the
// customer phone rule the form now states before the database does.
// FABLE-AUDIT F2b: the payment reconciliation's job line, the team screen's
// success sentences and the step-up dialog's failure sentences. F3-5 and F3-12: the
// team screen's role edit that does not outlive a refusal, the revoke offered again
// and the confirmation before an owner changes their own role.
// FABLE-AUDIT F3-5 (g) and F3-15 add the owner home's failed run, passed schedule and failed scheduled jobs; F3-10 the
// sign-in's refused Turnstile token and the one sentence for a lost connection or a limit across the three code
// checks; F3-18 the reading of `outbox_close`.
// RESIDUALS-1 R3a: the owner home's failed schedules (ADMIN-CMS-06), the email screen's cap (ADMIN-CMS-10) and the
// documents list's states (ADMIN-CMS-18).
// P12 R2: the rail's «المشاريع» for every role, the board-only role's gate (its rail, its landing and the path it is sent
// back from), the store screens' allow-list and a project's board in `isWidePath`.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { customersConfig } from '../../src/admin/tables/customers'
import {
  cronFailureText,
  emailWaiting,
  jobProblem,
  jobRunLine,
  overdueText,
  parseCronFailures,
  publishFailureReason,
  publishFailures,
  SCHEDULE_GRACE_MS,
  scheduleCutoff,
  standingFailures,
  type FailureDocument,
} from '../../src/components/admin/AdminHome'
import {
  BOARD_HOME,
  boardMayVisit,
  chooseCopy,
  clearDrafts,
  currentEntry,
  draftKey,
  gateRedirect,
  isWidePath,
  localCopies,
  navGroups,
  storedCopies,
  STORE_ROLES,
  tabId,
  type StoredCopy,
} from '../../src/components/admin/AdminShell'
import { listState } from '../../src/components/admin/CollectionList'
import { ATTENTION_CAP, attentionCapped, CAPPED_NOTE, CLOSE_CONFIRM, CLOSED_MESSAGE, closeResult } from '../../src/components/admin/EmailView'
import { landingFor, sendOutcome } from '../../src/components/admin/SignIn'
import { stepUpError } from '../../src/components/admin/StepUp'
import { doneText, OWN_ROLE_CONFIRM, RETRY_REVOKE, unfinishedRevoke, withoutEdit } from '../../src/components/admin/TeamView'
import type { StaffRole } from '../../src/components/admin/TableList'
import { otpDigits } from '../../src/lib/digits'

// AdminHome, AdminShell, CollectionList, StepUp and TeamView import through the `@/` alias, which the unit config does not
// resolve. The home names a failed schedule's document by its real title, so the collections are the real ones.
vi.mock('@/admin/collections', async () => import('../../src/admin/collections'))
vi.mock('@/lib/admin-publish', async () => import('../../src/lib/admin-publish'))
vi.mock('@/lib/digits', () => ({ otpDigits: String }))
vi.mock('@/lib/admin-commerce', async () => import('../../src/lib/admin-commerce'))
vi.mock('@/lib/format', () => ({ formatNumber: String, formatRiyadh: String }))
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({}) }))
vi.mock('@/lib/supabase/functions', () => ({ callFunction: async () => ({}), documentHref: () => '' }))
vi.mock('@/components/weave/Action', () => ({ Mark: () => null }))
vi.mock('@/lib/turnstile', () => ({ useTurnstile: () => ({}) }))
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
  it('is wide for the email, team, store list and a project\'s board screens only', () => {
    for (const path of ['/admin/email', '/admin/team', '/admin/team/', '/admin/store/products', '/admin/store/shipping-rates/', '/admin/projects/view', '/admin/projects/view/']) {
      expect(isWidePath(path), path).toBe(true)
    }
    for (const path of ['/admin', '/admin/store', '/admin/store/', '/admin/store/products/edit', '/admin/content/rooms', '/admin/security', '/admin/projects', '/admin/projects/mine', '/admin/projects/archived', '/admin/projectsx/view']) {
      expect(isWidePath(path), path).toBe(false)
    }
  })

  // D49: the rail marks the screen the visitor is on (aria-current="page"); the home only by itself.
  it('marks the nav entry a screen belongs to, the home only by itself', () => {
    expect(currentEntry('/admin')).toBe('/admin')
    expect(currentEntry('/admin/')).toBe('/admin')
    expect(currentEntry('/admin/orders')).toBe('/admin/orders')
    expect(currentEntry('/admin/orders/view')).toBe('/admin/orders')
    expect(currentEntry('/admin/orders/reconciliation/')).toBe('/admin/orders')
    expect(currentEntry('/admin/content/rooms/edit')).toBe('/admin/content')
    expect(currentEntry('/admin/store/products')).toBe('/admin/store')
    expect(currentEntry('/admin/security')).toBe('/admin/security')
    expect(currentEntry('/admin/projects')).toBe('/admin/projects')
    expect(currentEntry('/admin/projects/view')).toBe('/admin/projects')
    expect(currentEntry('/admin/projects/mine/')).toBe('/admin/projects')
    expect(currentEntry('/admin/projectsx')).toBeNull()
    // A path that only starts like an entry is not under it, and the sign-in and the preview have none.
    expect(currentEntry('/admin/ordersx')).toBeNull()
    expect(currentEntry('/admin/sign-in')).toBeNull()
    expect(currentEntry('/admin/preview')).toBeNull()
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

describe('the projects entry and the board-only role (P12 R2)', () => {
  const hrefs = (role: StaffRole) => navGroups(role).flatMap((group) => group.map((entry) => entry.href))

  it('puts «المشاريع» after «الرئيسية» for every role, in the first group', () => {
    expect(hrefs('owner')).toEqual(['/admin', '/admin/projects', '/admin/email', '/admin/content', '/admin/media', '/admin/store', '/admin/orders', '/admin/stats', '/admin/settings', '/admin/security', '/admin/team'])
    expect(hrefs('editor')).toEqual(['/admin', '/admin/projects', '/admin/content', '/admin/media', '/admin/security'])
    expect(hrefs('operations')).toEqual(['/admin', '/admin/projects', '/admin/email', '/admin/store', '/admin/orders', '/admin/security'])
    expect(navGroups('owner')[0]!.map((entry) => entry.label)).toEqual(['الرئيسية', 'المشاريع', 'البريد'])
  })

  it('shows the board-only role «المشاريع» and «الأمان» and nothing else', () => {
    expect(hrefs('board')).toEqual(['/admin/projects', '/admin/security'])
    expect(navGroups('board').map((group) => group.map((entry) => entry.label))).toEqual([['المشاريع'], ['الأمان']])
  })

  it('lets the board-only role open the routes of the board and «الأمان», with or without the closing slash', () => {
    for (const path of ['/admin/projects', '/admin/projects/', '/admin/projects/mine', '/admin/projects/view', '/admin/projects/archived', '/admin/security', '/admin/security/']) {
      expect(boardMayVisit(path), path).toBe(true)
      expect(gateRedirect('board', path), path).toBeNull()
    }
  })

  it('sends the board-only role to «مهامي» from every other admin path, the store and the orders among them', () => {
    expect(BOARD_HOME).toBe('/admin/projects/mine')
    for (const path of ['/admin', '/admin/', '/admin/store', '/admin/store/products', '/admin/store/products/edit', '/admin/orders', '/admin/orders/view', '/admin/email', '/admin/media', '/admin/stats', '/admin/settings', '/admin/team', '/admin/content', '/admin/content/rooms/edit', '/admin/projectsx', '/admin/security-x', '/admin/projects-old']) {
      expect(boardMayVisit(path), path).toBe(false)
      expect(gateRedirect('board', path), path).toBe(BOARD_HOME)
    }
  })

  it('sends no other role anywhere', () => {
    for (const role of ['owner', 'editor', 'operations'] as const) {
      for (const path of ['/admin', '/admin/store', '/admin/projects/mine', '/admin/team']) expect(gateRedirect(role, path), `${role} ${path}`).toBeNull()
    }
  })

  it('lands the board-only role on «مهامي» after sign-in and everyone else on the home', () => {
    expect(landingFor('board')).toBe('/admin/projects/mine')
    for (const role of ['owner', 'editor', 'operations', null, undefined, 'unknown']) expect(landingFor(role), String(role)).toBe('/admin')
  })

  it('names the roles of the store screens by allow-list: the owner and operations, so neither the editor nor the board-only role', () => {
    expect([...STORE_ROLES]).toEqual(['owner', 'operations'])
    expect(STORE_ROLES.includes('board')).toBe(false)
    expect(STORE_ROLES.includes('editor')).toBe(false)
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

  it('says the same for the sign-in\'s and the enrolment\'s code, each with its own wrong-code sentence (F3-10)', () => {
    const SIGN_IN_WRONG = 'الرمز غير صحيح أو انتهت صلاحيته.'
    expect(stepUpError(undefined, SIGN_IN_WRONG)).toBe('تعذّر الاتصال. حاول مرة أخرى.')
    expect(stepUpError(429, SIGN_IN_WRONG)).toBe('محاولات كثيرة. انتظر دقيقة ثم حاول.')
    for (const status of [400, 403, 422]) expect(stepUpError(status, SIGN_IN_WRONG), String(status)).toBe(SIGN_IN_WRONG)
  })
})

describe('failed scheduled publishes (ADMIN-CMS-06)', () => {
  it('lists each document once, newest first, by its newest failure with the seq and the SQLSTATE publish_due recorded', () => {
    const rows = [
      { entity: 'posts', entity_id: 'b', summary: { seq: 5, sqlstate: '23505' } },
      { entity: 'rooms', entity_id: 'a', summary: { seq: 2, sqlstate: '23514' } },
      // The same document's older failure is not listed, nor is a row with no document.
      { entity: 'posts', entity_id: 'b', summary: { seq: 3, sqlstate: '22023' } },
      { entity: 'posts', entity_id: null, summary: { seq: 1, sqlstate: '23505' } },
    ]
    expect(publishFailures(rows)).toEqual([
      { collection: 'posts', docId: 'b', seq: 5, sqlstate: '23505' },
      { collection: 'rooms', docId: 'a', seq: 2, sqlstate: '23514' },
    ])
  })

  it('reads a summary without a usable seq or sqlstate as null for each', () => {
    const noSummary = [
      { entity: 'posts', entity_id: 'a' },
      { entity: 'posts', entity_id: 'b', summary: null },
      { entity: 'posts', entity_id: 'c', summary: {} },
      { entity: 'posts', entity_id: 'd', summary: { seq: '4', sqlstate: 23505 } },
      { entity: 'posts', entity_id: 'e', summary: { seq: 1.5 } },
      { entity: 'posts', entity_id: 'f', summary: 'text' },
    ]
    for (const failure of publishFailures(noSummary)) expect(failure, failure.docId).toMatchObject({ seq: null, sqlstate: null })
    expect(publishFailures(noSummary)).toHaveLength(6)
  })

  describe('which failures still stand', () => {
    const failure = (docId: string, seq: number | null) => ({ collection: 'posts', docId, seq, sqlstate: null })
    const postRow = (docId: string, live: number | null, title = `مقال ${docId}`): FailureDocument => ({
      collection: 'posts',
      doc_id: docId,
      latest_data: { title },
      live_seq: live,
    })
    const standing = (failures: ReturnType<typeof failure>[], documents: FailureDocument[]) =>
      standingFailures(failures, documents).map((entry) => entry.docId)

    it('drops a failure once its document is live at the failed seq or later, and keeps it while the live one is older', () => {
      const documents = [postRow('at', 4), postRow('after', 7), postRow('older', 3), postRow('never', null)]
      const failures = [failure('at', 4), failure('after', 4), failure('older', 4), failure('never', 4)]
      expect(standing(failures, documents)).toEqual(['older', 'never'])
    })

    it('keeps a failure with no seq, and one whose document was not found', () => {
      expect(standing([failure('noseq', null), failure('gone', 2)], [postRow('noseq', 9)])).toEqual(['noseq', 'gone'])
      expect(standing([], [postRow('x', 1)])).toEqual([])
    })

    it('matches a document by its collection and id together', () => {
      const room = { collection: 'rooms', docId: 'started', seq: 3, sqlstate: null }
      const postWithSameId: FailureDocument = { collection: 'posts', doc_id: 'started', latest_data: { title: 'مقال' }, live_seq: 9 }
      expect(standingFailures([room], [postWithSameId])).toHaveLength(1)
    })

    it('labels each entry with its document\'s title, not its id (a post\'s id is a uuid)', () => {
      const id = '3f9c2a1e-4b7d-4c1a-9e0f-5a6b7c8d9e01'
      const [entry] = standingFailures([failure(id, 4)], [postRow(id, null, 'رحلتي إلى الدرعية')])
      expect(entry).toMatchObject({ docId: id, title: 'رحلتي إلى الدرعية' })
      // A post with no title, a room by its fixed label, a document not found at all.
      expect(standingFailures([failure(id, 4)], [{ ...postRow(id, null), latest_data: {} }])[0]!.title).toBe('بلا عنوان')
      expect(standingFailures([{ collection: 'rooms', docId: 'started', seq: 1, sqlstate: null }], [])[0]!.title).toBe('بدأتُ من هنا')
      expect(standingFailures([failure(id, 4)], [])[0]!.title).toBe('بلا عنوان')
    })
  })

  it('says why for a slug another post already has live (23505), and for no other SQLSTATE', () => {
    expect(publishFailureReason('23505')).toBe('معرّف المقال مستخدم في مقال منشور آخر.')
    for (const other of ['23514', '22023', 'P0001', '', null]) expect(publishFailureReason(other), String(other)).toBeNull()
  })
})

describe('the email problems screen says when its list was cut (ADMIN-CMS-10)', () => {
  it('shares one cap of 200 with the home, and the note shows when the list holds that many rows', () => {
    expect(ATTENTION_CAP).toBe(200)
    expect(attentionCapped(0)).toBe(false)
    expect(attentionCapped(199)).toBe(false)
    expect(attentionCapped(200)).toBe(true)
    expect(attentionCapped(201)).toBe(true)
  })

  it('says it in the words of the brief', () => {
    expect(CAPPED_NOTE).toBe('تُعرض 200 مشكلة فقط: ما يحتاج تدخلًا أولًا، ثم الأحدث.')
  })
})

describe('the documents list: loading, failure and empty states (ADMIN-CMS-18)', () => {
  const fixed = { fixed: true, rows: 0, unsaved: 0 }
  const open = { fixed: false, rows: 0, unsaved: 0 }

  it('shows «يحمّل...» until the query answers, whatever the collection', () => {
    expect(listState({ ...fixed, loaded: false, failed: false })).toBe('loading')
    expect(listState({ ...open, loaded: false, failed: false })).toBe('loading')
  })

  it('after a failed read, a collection of fixed documents keeps its titles and an open one shows the error alone', () => {
    expect(listState({ ...fixed, loaded: false, failed: true })).toBe('titles')
    expect(listState({ ...open, loaded: false, failed: true })).toBe('failed')
  })

  it('says «لا توجد مقالات بعد.» only for an open collection that answered with no document and no local copy', () => {
    expect(listState({ ...open, loaded: true, failed: false })).toBe('empty')
    expect(listState({ ...open, loaded: true, failed: false, rows: 1 })).toBe('table')
    expect(listState({ ...open, loaded: true, failed: false, unsaved: 1 })).toBe('table')
    // The fixed documents are listed whether or not any was saved.
    expect(listState({ ...fixed, loaded: true, failed: false })).toBe('table')
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

describe('the owner home: a failed run, a schedule that passed, the scheduled jobs that failed (F3-5 g, F3-15)', () => {
  const at = '2026-10-07T12:30:00.123456+00:00'
  const run = (status: string) => ({ job: 'backup', status, finished_at: at, detail: null })

  it('draws a failed run as a problem, with the same words, and every other run as a plain fact', () => {
    expect(jobRunLine(run('failed'))).toEqual({ text: `فاشل (${at})`, problem: true })
    expect(jobRunLine(run('ok'))).toEqual({ text: `سليم (${at})`, problem: false })
    expect(jobRunLine(run('partial'))).toEqual({ text: `جزئي (${at})`, problem: false })
    expect(jobRunLine(run('skipped'))).toEqual({ text: `متجاوز (${at})`, problem: false })
    // A status the home has no word for prints as it is, and is no problem it can name.
    expect(jobRunLine(run('weird'))).toEqual({ text: `weird (${at})`, problem: false })
  })

  it('reads a schedule as passed once its time is more than five minutes back, and says when it was due', () => {
    expect(SCHEDULE_GRACE_MS).toBe(5 * 60 * 1000)
    expect(scheduleCutoff(Date.parse('2026-10-07T10:00:00Z'))).toBe('2026-10-07T09:55:00.000Z')
    expect(scheduleCutoff()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(overdueText(at)).toBe(`موعد النشر فات: ${at}`)
    expect(overdueText(at, 1)).toBe(`موعد النشر فات: ${at}`)
    // The deep audit's FD-B-02: several passed schedules are counted, not hidden behind the oldest.
    expect(overdueText(at, 3)).toBe(`مستندات فات موعد نشرها: 3، أقدمها: ${at}`)
  })

  it('reads cron_failures_recent as the SQL builds it: [{jobname, failures, lastFailedAt}], and [] when nothing failed', () => {
    expect(parseCronFailures([])).toEqual([])
    const rows = [
      { jobname: 'content-publish-due', failures: 3, lastFailedAt: at },
      { jobname: 'email-outbox-run', failures: 1, lastFailedAt: '2026-10-07T09:00:00+00:00' },
    ]
    expect(parseCronFailures(rows)).toEqual(rows)
    // Keys beyond those three are not carried (the SQL sends no command and no error text).
    expect(parseCronFailures([{ ...rows[0], command: 'select 1' }])).toEqual([rows[0]])
  })

  it('reads anything else as no reading, never as an empty list: an empty list says the jobs are healthy', () => {
    const good = { jobname: 'content-publish-due', failures: 3, lastFailedAt: at }
    for (const bad of [
      null,
      undefined,
      {},
      'content-publish-due',
      [null],
      [{}],
      [{ ...good, jobname: '' }],
      [{ ...good, jobname: 7 }],
      [{ ...good, failures: 0 }],
      [{ ...good, failures: 1.5 }],
      [{ ...good, failures: '3' }],
      [{ ...good, lastFailedAt: 'yesterday' }],
      [{ ...good, lastFailedAt: null }],
      [good, { jobname: 'x' }],
    ]) {
      expect(parseCronFailures(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('prints one line per failing job: its name, how often and when it last failed', () => {
    expect(cronFailureText({ jobname: 'content-publish-due', failures: 3, lastFailedAt: at })).toBe(
      `مهام مجدولة فشلت خلال 24 ساعة: content-publish-due ×3 (آخرها ${at})`,
    )
  })
})

describe('closing a mail that needs nothing more (F3-18)', () => {
  it('asks before it closes, and announces it when it has', () => {
    expect(CLOSE_CONFIRM).toBe('إغلاق الرسالة يخرجها من القائمة ولا تُرسل بعد ذلك. متابعة؟')
    expect(CLOSED_MESSAGE).toBe('أُغلقت الرسالة.')
  })

  it('reads {ok: true} as closed', () => {
    expect(closeResult({ data: { ok: true, id: 7, status: 'closed' }, error: null })).toEqual({ kind: 'closed' })
  })

  it('reads a row that changed meanwhile (BAD_STATUS) or is gone (NOT_FOUND) as a list out of date', () => {
    expect(closeResult({ data: { ok: false, code: 'BAD_STATUS', status: 'sending' }, error: null })).toEqual({ kind: 'stale' })
    expect(closeResult({ data: { ok: false, code: 'BAD_STATUS', status: 'closed' }, error: null })).toEqual({ kind: 'stale' })
    expect(closeResult({ data: { ok: false, code: 'NOT_FOUND' }, error: null })).toEqual({ kind: 'stale' })
  })

  it('says the access sentence for a member who may not close mail (42501) and «تعذّر إغلاق الرسالة.» for anything else', () => {
    expect(closeResult({ data: null, error: { code: '42501' } })).toEqual({ kind: 'failed', message: 'لا تملك صلاحية الوصول' })
    expect(closeResult({ data: null, error: { code: '' } })).toEqual({ kind: 'failed', message: 'تعذّر إغلاق الرسالة.' })
    expect(closeResult({ data: null, error: { code: 'XX000' } })).toEqual({ kind: 'failed', message: 'تعذّر إغلاق الرسالة.' })
    for (const data of [null, undefined, [], 'ok', {}, { ok: 'true' }, { ok: false }, { ok: false, code: 'SOMETHING' }]) {
      expect(closeResult({ data, error: null }), JSON.stringify(data)).toEqual({ kind: 'failed', message: 'تعذّر إغلاق الرسالة.' })
    }
  })
})

describe('the sign-in\'s request for a code (F3-10)', () => {
  const MASKED = 'إن كان هذا البريد مسجّلًا لدينا فقد أرسلنا إليه رمزًا من 8 أرقام.'
  const CAPTCHA = 'تعذّر التحقق من أنك لست روبوتًا؛ حدّث الصفحة وحاول مرة أخرى.'

  it('moves to the code step, with the masked sentence, when Auth answers well', () => {
    expect(sendOutcome(null)).toEqual({ message: MASKED, step: 'code' })
  })

  it('stays on the e-mail step and says so when Auth refuses the Turnstile token (a 400 with the code captcha_failed)', () => {
    expect(sendOutcome({ status: 400, code: 'captcha_failed' })).toEqual({ message: CAPTCHA, step: 'email' })
  })

  it('keeps every other refusal masked: the answer must not tell whether the address is a staff email', () => {
    for (const error of [
      { status: 400, code: 'validation_failed' },
      { status: 400, code: 'email_address_invalid' },
      { status: 400 },
      { status: 401, code: 'bad_jwt' },
      { status: 403, code: 'otp_disabled' },
      { status: 422, code: 'otp_disabled' },
      { status: 422, code: 'signup_disabled' },
    ]) {
      expect(sendOutcome(error), JSON.stringify(error)).toEqual({ message: MASKED, step: 'code' })
    }
  })

  it('still tells the network, the rate limit and a failure on Auth\'s side, which say nothing about the address', () => {
    expect(sendOutcome({})).toMatchObject({ step: 'email', message: 'تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.' })
    expect(sendOutcome({ status: 0 })).toMatchObject({ step: 'email', message: 'تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.' })
    expect(sendOutcome({ status: 429, code: 'over_email_send_rate_limit' })).toEqual({
      message: 'أُرسلت رموز كثيرة في وقت قصير. انتظر قليلًا ثم اطلب رمزًا جديدًا.',
      step: 'email',
    })
    for (const status of [500, 502, 503]) {
      expect(sendOutcome({ status }), String(status)).toEqual({ message: 'تعذّر الإرسال الآن. حاول بعد قليل.', step: 'email' })
    }
  })
})

// RESIDUALS-1 R1, ADMIN-CMS-01 and ADMIN-CMS-02: the editor's local copy is kept per tab as well as per document, and a
// document that was never saved is found again through its copy.
describe('the editor\'s local copies', () => {
  /** A storage: its keys are its own properties (what `Object.keys(localStorage)` lists), its methods are not. */
  function storage(entries: Record<string, string> = {}): Record<string, string> {
    const store: Record<string, string> = { ...entries }
    Object.defineProperty(store, 'getItem', { value: (key: string) => store[key] ?? null, enumerable: false })
    Object.defineProperty(store, 'setItem', { value: (key: string, value: string) => (store[key] = value), enumerable: false })
    Object.defineProperty(store, 'removeItem', { value: (key: string) => delete store[key], enumerable: false })
    return store
  }
  const draft = (over: Record<string, unknown> = {}) => JSON.stringify({ baseSeq: 1, data: { title: 'نص' }, savedAt: 1000, userId: 'u1', ...over })
  const copy = (key: string, over: Record<string, unknown> = {}): StoredCopy => ({
    key,
    docId: 'doc',
    draft: { baseSeq: 1, data: { title: 'نص' }, savedAt: 1000, userId: 'u1', ...over } as StoredCopy['draft'],
  })

  it('keys a copy by collection, document and tab, under the prefix the sign-out clears by', () => {
    expect(draftKey('posts', 'abc', 'tab-1')).toBe('anasaq:draft:posts:abc:tab-1')
    const store = storage({ [draftKey('posts', 'abc', 'tab-1')]: draft(), [draftKey('posts', 'abc', 'tab-2')]: draft(), 'sb-auth-token': 'keep' })
    vi.stubGlobal('window', { localStorage: store })
    clearDrafts()
    expect(Object.keys(store)).toEqual(['sb-auth-token'])
  })

  it('gives a tab one id that its reloads keep, and another tab another: sessionStorage is per tab', () => {
    const first = storage()
    vi.stubGlobal('window', { sessionStorage: first })
    const id = tabId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tabId()).toBe(id)
    // The same tab after a reload: the same storage, the same id.
    vi.stubGlobal('window', { sessionStorage: first })
    expect(tabId()).toBe(id)
    // Another tab of the same browser: its own storage, its own id.
    vi.stubGlobal('window', { sessionStorage: storage() })
    expect(tabId()).not.toBe(id)
  })

  it('keeps one id for the page load when sessionStorage is blocked, so the autosave never writes a key a second time under another name', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    vi.stubGlobal('window', { sessionStorage: blocked })
    const id = tabId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tabId()).toBe(id)
  })

  it('finds every copy of one collection\'s documents, whatever tab wrote it, and an old key with no tab id; unreadable copies and other keys are skipped', () => {
    const store = storage({
      [draftKey('posts', 'a', 'tab-1')]: draft({ savedAt: 3 }),
      [draftKey('posts', 'a', 'tab-2')]: draft({ savedAt: 5 }),
      'anasaq:draft:posts:a': draft({ savedAt: 1 }),
      [draftKey('posts', 'b', 'tab-1')]: '{ not json',
      [draftKey('posts', 'c', 'tab-1')]: 'null',
      [draftKey('taxonomies', 'a', 'tab-1')]: draft(),
      'anasaq:draft:postsx:a': draft(),
      'sb-auth-token': '{}',
    })
    vi.stubGlobal('window', { localStorage: store })
    expect(storedCopies('posts').map(({ key, docId }) => [key, docId]).sort()).toEqual(
      [
        ['anasaq:draft:posts:a', 'a'],
        [draftKey('posts', 'a', 'tab-1'), 'a'],
        [draftKey('posts', 'a', 'tab-2'), 'a'],
      ].sort(),
    )
    expect(storedCopies('taxonomies').map(({ docId }) => docId)).toEqual(['a'])
    // Storage that cannot be listed has no copies.
    vi.stubGlobal('window', {})
    expect(storedCopies('posts')).toEqual([])
  })

  it('offers this tab\'s own copy first, else the newest copy another tab (or an old key) left', () => {
    const own = copy('anasaq:draft:posts:doc:tab-me', { savedAt: 10 })
    const newer = copy('anasaq:draft:posts:doc:tab-other', { savedAt: 99 })
    const old = copy('anasaq:draft:posts:doc', { savedAt: 50 })
    expect(chooseCopy([newer, old, own], own.key, 'u1')).toBe(own)
    // No copy of its own: the newest of the others, an old key among them.
    expect(chooseCopy([old, newer], own.key, 'u1')).toBe(newer)
    expect(chooseCopy([old, copy('anasaq:draft:posts:doc:tab-x', { savedAt: 20 })], own.key, 'u1')).toBe(old)
    expect(chooseCopy([], own.key, 'u1')).toBeNull()
  })

  it('offers only a copy this user wrote; one from before the user was recorded is anyone\'s', () => {
    const mine = copy('anasaq:draft:posts:doc:a', { savedAt: 1, userId: 'u1' })
    const theirs = copy('anasaq:draft:posts:doc:b', { savedAt: 9, userId: 'u2' })
    const unsigned = copy('anasaq:draft:posts:doc:c', { savedAt: 5, userId: undefined })
    expect(chooseCopy([mine, theirs], '', 'u1')).toBe(mine)
    expect(chooseCopy([theirs], '', 'u1')).toBeNull()
    expect(chooseCopy([mine, theirs, unsigned], '', 'u1')).toBe(unsigned)
    // This tab's own copy, written by someone else, is not offered either; the user's other copy is.
    expect(chooseCopy([copy('anasaq:draft:posts:doc:me', { userId: 'u2' }), mine], 'anasaq:draft:posts:doc:me', 'u1')).toBe(mine)
    // A copy whose time cannot be read is the oldest.
    const timeless = copy('anasaq:draft:posts:doc:d', { savedAt: 'yesterday' })
    expect(chooseCopy([timeless, mine], '', 'u1')).toBe(mine)
  })

  it('ADMIN-CMS-01: a save in one tab removes only that tab\'s copy, so the other tab\'s text is offered after its reload', () => {
    const store = storage()
    vi.stubGlobal('window', { localStorage: store })
    const a = draftKey('posts', 'doc', 'tab-a')
    const b = draftKey('posts', 'doc', 'tab-b')
    // Tab B types (its autosave writes its key); tab A types, saves, and its autosave removes ITS key.
    store[b] = draft({ data: { excerpt: 'B text' }, savedAt: 10 })
    store[a] = draft({ data: { title: 'A' }, savedAt: 20 })
    delete store[a]
    // Tab B reloads: its own key is still there and is the copy it is offered.
    const offered = chooseCopy(storedCopies('posts').filter((entry) => entry.docId === 'doc'), b, 'u1')
    expect(offered?.key).toBe(b)
    expect(offered?.draft.data).toEqual({ excerpt: 'B text' })
    // A new tab C is offered the same text, as the newest copy of another tab; «تجاهل» in C removes the key it was offered.
    const forC = chooseCopy(storedCopies('posts'), draftKey('posts', 'doc', 'tab-c'), 'u1')
    expect(forC?.key).toBe(b)
    delete store[forC!.key]
    expect(storedCopies('posts')).toEqual([])
  })

  it('ADMIN-CMS-02: lists this user\'s copies of a collection one per document, the newest copy of each, the newest document first', () => {
    const store = storage({
      [draftKey('posts', 'one', 'tab-1')]: draft({ data: { title: 'قديم' }, savedAt: 100 }),
      [draftKey('posts', 'one', 'tab-2')]: draft({ data: { title: 'أحدث' }, savedAt: 300 }),
      [draftKey('posts', 'two', 'tab-1')]: draft({ data: { title: 'ثانٍ' }, savedAt: 200 }),
      [draftKey('posts', 'other-user', 'tab-1')]: draft({ userId: 'u2', savedAt: 900 }),
      [draftKey('taxonomies', 'tag', 'tab-1')]: draft({ data: { label: 'وسم' }, savedAt: 400 }),
    })
    vi.stubGlobal('window', { localStorage: store })
    const posts = localCopies('posts', 'u1')
    expect(posts.map(({ docId }) => docId)).toEqual(['one', 'two'])
    expect(posts[0]!.draft.data).toEqual({ title: 'أحدث' })
    expect(localCopies('taxonomies', 'u1').map(({ docId }) => docId)).toEqual(['tag'])
    expect(localCopies('posts', 'nobody')).toEqual([])
  })
})
