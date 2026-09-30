// AUDIT-1 S11.2: `MoneyFieldInput` reports invalid text as NaN so the form's
// schema rejects it and Save stays off, instead of saving the old amount.
import { describe, expect, it, vi } from 'vitest'

import { schemaFromFields, type Field } from '../../src/admin/fields'
import { moneyChange } from '../../src/components/admin/FieldInput'

// These siblings import through the `@/` alias, which the unit config does not resolve.
vi.mock('../../src/components/admin/MediaLibrary', () => ({}))
vi.mock('../../src/components/admin/MediaPicker', () => ({}))
vi.mock('../../src/components/admin/RichTextEditor', () => ({}))

const price = { name: 'price_halalas', label: 'السعر', type: 'money', nullable: true } as const satisfies Field
const minimum = { name: 'min_subtotal_halalas', label: 'الحد الأدنى', type: 'money', min: 0 } as const satisfies Field

describe('what a money field reports for the text typed', () => {
  it('is NaN for invalid text, so the old amount cannot be saved', () => {
    expect(moneyChange('75,00', false)).toBeNaN()
    expect(moneyChange('75,00', true)).toBeNaN()
    expect(moneyChange('75.505', false)).toBeNaN()
  })

  it('is NaN for empty text where the field is not nullable, null where it is', () => {
    expect(moneyChange('', false)).toBeNaN()
    expect(moneyChange('', true)).toBeNull()
  })

  it('is the integer halalas for a real amount', () => {
    expect(moneyChange('75', false)).toBe(7500)
    expect(moneyChange('69.5', true)).toBe(6950)
  })
})

describe('a money field whose text is invalid', () => {
  it('fails the schema when reported as NaN, nullable or not', () => {
    expect(schemaFromFields([price]).safeParse({ price_halalas: Number.NaN }).success).toBe(false)
    expect(schemaFromFields([minimum]).safeParse({ min_subtotal_halalas: Number.NaN }).success).toBe(false)
  })

  it('still accepts a real amount and, where allowed, null', () => {
    expect(schemaFromFields([price]).safeParse({ price_halalas: 7500 }).success).toBe(true)
    expect(schemaFromFields([price]).safeParse({ price_halalas: null }).success).toBe(true)
    expect(schemaFromFields([minimum]).safeParse({ min_subtotal_halalas: 0 }).success).toBe(true)
  })
})
