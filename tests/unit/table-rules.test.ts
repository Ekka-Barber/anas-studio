// AUDIT-1 S11.3 / S11.7 / S10.12: the catalog forms refuse what the database's
// own checks would (no more «تحقق من القيم.» with no field named), validate only
// the fields they show, and the home counts only the email rows a person can act on.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { schemaFromFields } from '../../src/admin/fields'
import { tables } from '../../src/admin/tables'
import { replayableCount } from '../../src/components/admin/AdminHome'

// AdminHome imports through the `@/` alias, which the unit config does not resolve.
vi.mock('@/admin/collections', () => ({ COLLECTION_LABELS: {} }))
vi.mock('@/lib/format', () => ({ formatNumber: String, formatRiyadh: String }))
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: () => ({}) }))
vi.mock('@/lib/supabase/functions', () => ({ callFunction: async () => ({}) }))
vi.mock('../../src/components/admin/TableList', () => ({ ROLE_LABEL: {} }))

const rate = { city_key: 'riyadh', name_ar: 'الرياض', fee_halalas: 1500, enabled: true, sort_order: 0 }
const variant = {
  sku: 'BOOK-01',
  title: 'نسخة',
  fulfillment: 'physical',
  price_halalas: 5000,
  enabled: true,
  stock: 3,
  preorder: false,
  preorder_capacity: null,
  preorder_ships_on: null,
  preorder_note: null,
  low_stock_threshold: null,
  sort_order: 0,
}
const coupon = {
  code: 'EID10',
  kind: 'percent',
  percent: 1000,
  amount_halalas: 0,
  starts_at: null,
  ends_at: null,
  min_subtotal_halalas: 0,
  usage_limit: null,
  product_ids: [],
  enabled: true,
}

const ok = (fields: Parameters<typeof schemaFromFields>[0], values: Record<string, unknown>) =>
  schemaFromFields(fields).safeParse(values).success

describe('the catalog forms mirror the database checks', () => {
  it('coupon code: Latin letters and digits, 3 to 32 (the save upper-cases it)', () => {
    const fields = tables.coupons.fields
    expect(ok(fields.filter((f) => f.name !== 'amount_halalas'), { ...coupon, code: 'eid10' })).toBe(true)
    expect(ok(fields.filter((f) => f.name !== 'amount_halalas'), { ...coupon, code: 'EID-10' })).toBe(false)
    expect(ok(fields.filter((f) => f.name !== 'amount_halalas'), { ...coupon, code: 'AB' })).toBe(false)
  })

  it('coupon ends_at must come after starts_at, and the message names the field', () => {
    const fields = tables.coupons.fields.filter((f) => f.name !== 'amount_halalas')
    const dates = (starts_at: string | null, ends_at: string | null) => ({ ...coupon, starts_at, ends_at })
    expect(ok(fields, dates('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'))).toBe(false)
    expect(ok(fields, dates('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'))).toBe(false)
    expect(ok(fields, dates('2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'))).toBe(true)
    expect(ok(fields, dates(null, '2026-10-01T00:00:00.000Z'))).toBe(true)
    const issue = schemaFromFields(fields).safeParse(dates('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'))
    expect(issue.error?.issues[0]?.path).toEqual(['ends_at'])
    expect(issue.error?.issues[0]?.message).toContain('يبدأ في')
  })

  it('SKU: no spaces, no leading dash; title not blank', () => {
    const fields = tables.variants.fields
    expect(ok(fields, variant)).toBe(true)
    expect(ok(fields, { ...variant, sku: 'book-01' })).toBe(true)
    expect(ok(fields, { ...variant, sku: 'BOOK 01' })).toBe(false)
    expect(ok(fields, { ...variant, sku: '-BOOK' })).toBe(false)
    expect(ok(fields, { ...variant, title: '   ' })).toBe(false)
  })

  it('shipping rate: city key, name and the fee ceiling', () => {
    const fields = tables['shipping-rates'].fields
    expect(ok(fields, rate)).toBe(true)
    expect(ok(fields, { ...rate, city_key: '1st' })).toBe(false)
    expect(ok(fields, { ...rate, city_key: 'a' })).toBe(false)
    expect(ok(fields, { ...rate, name_ar: ' ' })).toBe(false)
    expect(ok(fields, { ...rate, fee_halalas: 1_500_000 })).toBe(false)
    expect(ok(fields, { ...rate, fee_halalas: null })).toBe(true)
  })
})

describe('a coupon form checks only the value its kind shows', () => {
  const visible = (values: Record<string, unknown>) => tables.coupons.fields.filter((f) => f.visibleWhen?.(values) ?? true)

  it('a percent coupon with no percentage is refused, whatever the hidden amount holds', () => {
    const empty = { ...coupon, percent: null, amount_halalas: null }
    expect(ok(visible(empty), empty)).toBe(false)
    const typed = { ...empty, percent: 1000 }
    expect(ok(visible(typed), typed)).toBe(true)
  })

  it('a fixed coupon with no amount is refused', () => {
    const empty = { ...coupon, kind: 'fixed', percent: null, amount_halalas: null }
    expect(ok(visible(empty), empty)).toBe(false)
    const typed = { ...empty, amount_halalas: 5000 }
    expect(ok(visible(typed), typed)).toBe(true)
  })
})

describe('the variant form: the preorder fields (P08 round 11c)', () => {
  const config = tables.variants
  const preorder = { ...variant, preorder: true, preorder_capacity: 40, preorder_ships_on: '2030-01-01', preorder_note: 'يصلك بعد الطباعة' }
  const visible = (values: Record<string, unknown>) => config.fields.filter((f) => f.visibleWhen?.(values) ?? true)
  /** What the form would list for these values: the schema's issues and `validate`'s, each as «field: message». */
  const problems = (values: Record<string, unknown>): string[] => {
    const parsed = schemaFromFields(visible(values)).safeParse(values)
    return [
      ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`)),
      ...(config.validate?.(values) ?? []).map((issue) => `${issue.field}: ${issue.message}`),
    ]
  }
  // The delivery date is judged against today in Riyadh: the clock is set, and only `Date` is faked.
  const today = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('has the four fields after «المخزون», with the words of the brief, and the three show only while it is on', () => {
    const names = config.fields.map((field) => field.name)
    expect(names.slice(names.indexOf('stock'), names.indexOf('stock') + 5)).toEqual(['stock', 'preorder', 'preorder_capacity', 'preorder_ships_on', 'preorder_note'])
    const field = (name: string) => config.fields.find((candidate) => candidate.name === name)
    expect(field('preorder')).toMatchObject({ label: 'طلب مسبق', type: 'boolean' })
    expect(field('preorder_capacity')).toMatchObject({ label: 'سعة الطلب المسبق', type: 'number', min: 1 })
    expect(field('preorder_ships_on')).toMatchObject({ label: 'موعد التسليم', type: 'date' })
    expect(field('preorder_note')).toMatchObject({ label: 'ملاحظة الطلب المسبق', type: 'text', maxLength: 300, hint: 'تظهر للمشتري قبل الدفع.' })
    const shown = (values: Record<string, unknown>) => visible(values).map((candidate) => candidate.name).filter((name) => name.startsWith('preorder'))
    expect(shown(variant)).toEqual(['preorder'])
    expect(shown(preorder)).toEqual(['preorder', 'preorder_capacity', 'preorder_ships_on', 'preorder_note'])
  })

  it('passes a variant that is not a preorder with the three null, and does not check what a hidden field still holds', () => {
    expect(problems(variant)).toEqual([])
    expect(problems({ ...variant, preorder_capacity: 0, preorder_ships_on: '2020-01-01', preorder_note: '' })).toEqual([])
  })

  it('passes a complete preorder', () => {
    today('2026-10-03T12:00:00Z')
    expect(problems(preorder)).toEqual([])
  })

  it('requires the capacity, the date and the note while it is on, naming each', () => {
    today('2026-10-03T12:00:00Z')
    expect(problems({ ...preorder, preorder_capacity: null, preorder_ships_on: null, preorder_note: null })).toEqual([
      'preorder_capacity: أدخل رقمًا.',
      'preorder_ships_on: اختر يومًا.',
      'preorder_note: لا يمكن أن يكون فارغًا.',
    ])
    expect(problems({ ...preorder, preorder_ships_on: '' })).toEqual(['preorder_ships_on: تاريخ غير صالح.'])
  })

  it('refuses a capacity below 1 or not whole, and takes 1', () => {
    today('2026-10-03T12:00:00Z')
    expect(problems({ ...preorder, preorder_capacity: 0 })).toEqual(['preorder_capacity: أقل قيمة 1.'])
    expect(problems({ ...preorder, preorder_capacity: -3 })).toEqual(['preorder_capacity: أقل قيمة 1.'])
    expect(problems({ ...preorder, preorder_capacity: 1.5 })).toEqual(['preorder_capacity: أدخل عددًا صحيحًا.'])
    expect(problems({ ...preorder, preorder_capacity: 1 })).toEqual([])
  })

  it('refuses a note of blanks, with a control character or over 300 characters, and takes 1 and 300', () => {
    today('2026-10-03T12:00:00Z')
    expect(problems({ ...preorder, preorder_note: '   ' })).toEqual(['preorder_note: لا يمكن أن يكون فارغًا.'])
    expect(problems({ ...preorder, preorder_note: 'يصلك\nبعد' })).toEqual(['preorder_note: لا يُقبل نص فيه رموز تحكم.'])
    expect(problems({ ...preorder, preorder_note: 'ا'.repeat(301) })).toEqual(['preorder_note: الحد الأقصى 300 حرفًا.'])
    expect(problems({ ...preorder, preorder_note: 'ا'.repeat(300) })).toEqual([])
    expect(problems({ ...preorder, preorder_note: 'ا' })).toEqual([])
  })

  it('refuses a delivery date before today in Riyadh (it would take the variant off sale), and takes today and later', () => {
    today('2026-10-03T12:00:00Z')
    const refused = ['preorder_ships_on: يجب ألا يكون قبل اليوم، وإلا خرج الخيار من البيع.']
    expect(problems({ ...preorder, preorder_ships_on: '2026-10-02' })).toEqual(refused)
    expect(problems({ ...preorder, preorder_ships_on: '2020-01-01' })).toEqual(refused)
    expect(problems({ ...preorder, preorder_ships_on: '2026-10-03' })).toEqual([])
    expect(problems({ ...preorder, preorder_ships_on: '2026-10-04' })).toEqual([])
    // Riyadh is three hours ahead of UTC: at 22:00 UTC it is already the next day there.
    vi.setSystemTime(new Date('2026-10-03T22:00:00Z'))
    expect(problems({ ...preorder, preorder_ships_on: '2026-10-03' })).toEqual(refused)
    expect(problems({ ...preorder, preorder_ships_on: '2026-10-04' })).toEqual([])
  })

  it('does not look at the date while the preorder is off, so turning it off after the date has passed saves', () => {
    today('2026-10-03T12:00:00Z')
    expect(problems({ ...preorder, preorder: false, preorder_ships_on: '2026-09-01' })).toEqual([])
    expect(config.toRow({ ...preorder, preorder: false, preorder_ships_on: '2026-09-01' })).toMatchObject({ preorder: false, preorder_ships_on: null })
  })
})

describe('the owner home counts only email problems a person can act on', () => {
  it('leaves out suppressed recipients and sent rows with a bounce', () => {
    const rows = [
      { status: 'exhausted' },
      { status: 'uncertain' },
      { status: 'suppressed' },
      { status: 'sent' },
      { status: 'sent' },
    ]
    expect(replayableCount(rows)).toBe(2)
    expect(replayableCount([{ status: 'sent' }])).toBe(0)
  })
})
