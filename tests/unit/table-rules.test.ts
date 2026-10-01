// AUDIT-1 S11.3 / S11.7 / S10.12: the catalog forms refuse what the database's
// own checks would (no more «تحقق من القيم.» with no field named), validate only
// the fields they show, and the home counts only the email rows a person can act on.
import { describe, expect, it, vi } from 'vitest'

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
const variant = { sku: 'BOOK-01', title: 'نسخة', fulfillment: 'physical', price_halalas: 5000, enabled: true, stock: 3, low_stock_threshold: null, sort_order: 0 }
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
