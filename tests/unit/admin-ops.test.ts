// AUDIT-2 R06: the admin shell's width and draft rules, the one-time code
// digit folding, the owner home's job and publish-failure lines, and the
// customer phone rule the form now states before the database does.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { customersConfig } from '../../src/admin/tables/customers'
import { emailWaiting, jobProblem, publishFailures } from '../../src/components/admin/AdminHome'
import { clearDrafts, isWidePath } from '../../src/components/admin/AdminShell'
import { otpDigits } from '../../src/lib/digits'

// AdminHome and AdminShell import through the `@/` alias, which the unit config does not resolve.
vi.mock('@/admin/collections', () => ({ COLLECTION_LABELS: {} }))
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
